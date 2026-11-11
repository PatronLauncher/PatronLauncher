//! Profile-scoped mod ownership, dependency plans and transactional file operations.
use crate::{
    model::{Loader, Profile},
    modrinth::{self, Source, Version},
    performance::{self, File},
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sha2::Sha512;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub project_id: String,
    pub version_id: String,
    pub filename: String,
    pub sha512: Option<String>,
    pub sha1: Option<String>,
    pub installed_at: u64,
    pub user_selected: bool,
    pub enabled: bool,
    pub requires: Vec<String>,
    pub incompatible: Vec<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub entries: Vec<Entry>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub installed: Vec<Entry>,
    pub promote: Vec<String>,
    pub id: Uuid,
    pub profile: Uuid,
    pub mc: String,
    pub loader_version: Option<String>,
    pub entries: Vec<Entry>,
    pub warnings: Vec<String>,
    pub total_bytes: u64,
    #[serde(skip)]
    pub files: Vec<File>,
    #[serde(skip)]
    pub before: Vec<u8>,
}
#[derive(Default)]
pub struct Plans(pub Mutex<HashMap<Uuid, (Instant, Plan)>>);
impl Plans {
    pub fn put(&self, p: Plan) -> Result<Plan> {
        let mut m = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("Plan kilidi açılamadı"))?;
        m.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(600));
        ensure!(m.len() < 16, "Çok fazla mod planı var.");
        m.insert(p.id, (Instant::now(), p.clone()));
        Ok(p)
    }
    pub fn take(&self, id: Uuid, profile: Uuid, confirmed: bool) -> Result<Plan> {
        ensure!(confirmed, "Mod kurmak için açık kullanıcı onayı gerekli.");
        let mut m = self.0.lock().unwrap();
        let (at, p) = m
            .get(&id)
            .context("Mod planı bulunamadı veya kullanılmış.")?;
        ensure!(
            p.profile == profile && at.elapsed() < Duration::from_secs(600),
            "Plan profili veya süresi geçersiz."
        );
        Ok(m.remove(&id).unwrap().1)
    }
}
pub fn supports(p: &Profile) -> Result<()> {
    ensure!(
        !modrinth::loader_keys(p.loader).is_empty(),
        "Bu profil mod desteklemiyor; Fabric, Quilt, NeoForge veya Forge profili oluştur."
    );
    Ok(())
}
fn plain(path: &Path) -> Result<()> {
    if let Ok(m) = fs::symlink_metadata(path) {
        ensure!(
            !m.file_type().is_symlink(),
            "Bağlantı dosyası veya klasörü reddedildi."
        );
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            ensure!(
                m.file_attributes() & 0x400 == 0,
                "Reparse point reddedildi."
            );
        }
    }
    Ok(())
}
pub fn directory(root: &Path, p: &Profile) -> Result<PathBuf> {
    let dir = crate::profiles::dir(root, p);
    for path in [
        root.to_path_buf(),
        root.join("instances"),
        dir.clone(),
        dir.join("mods"),
    ] {
        plain(&path)?;
    }
    Ok(dir)
}
pub(crate) fn raw(dir: &Path) -> Result<Vec<u8>> {
    let path = dir.join("mods.lock.json");
    plain(&path)?;
    match fs::File::open(path) {
        Ok(f) => {
            let mut bytes = Vec::new();
            f.take(4 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
            ensure!(bytes.len() <= 4 * 1024 * 1024, "Mod manifesti çok büyük.");
            Ok(bytes)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.into()),
    }
}
pub fn read(dir: &Path) -> Result<Manifest> {
    let b = raw(dir)?;
    let m: Manifest = if b.is_empty() {
        Manifest::default()
    } else {
        serde_json::from_slice(&b).context("mods.lock.json bozuk; hiçbir mod değiştirilmedi")?
    };
    ensure!(m.entries.len() <= 256, "Mod sayısı sınırı aşıldı.");
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for e in &m.entries {
        validate_entry(e)?;
        ensure!(
            ids.insert(&e.project_id) && names.insert(e.filename.to_ascii_lowercase()),
            "Mod manifestinde çakışma var."
        );
    }
    Ok(m)
}
fn validate_entry(e: &Entry) -> Result<()> {
    modrinth::id(&e.project_id)?;
    modrinth::id(&e.version_id)?;
    performance::valid_file(&File {
        filename: e.filename.clone(),
        url: "https://cdn.modrinth.com/validated.jar".into(),
        size: 1,
        primary: true,
        hashes: performance::Hashes {
            sha1: e.sha1.clone(),
            sha512: e.sha512.clone(),
        },
    })
}
fn path(dir: &Path, e: &Entry) -> PathBuf {
    dir.join("mods").join(format!(
        "{}{}",
        e.filename,
        if e.enabled { "" } else { ".disabled" }
    ))
}
fn verify(path: &Path, e: &Entry) -> Result<()> {
    plain(path)?;
    let f = fs::File::open(path)?;
    ensure!(
        f.metadata()?.len() <= 128 * 1024 * 1024,
        "Mod boyutu sınırı aşıldı."
    );
    let mut a = Sha1::new();
    let mut b = Sha512::new();
    let mut r = f;
    let mut buf = [0; 65536];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        a.update(&buf[..n]);
        b.update(&buf[..n]);
    }
    if let Some(h) = &e.sha512 {
        ensure!(
            format!("{:x}", b.finalize()).eq_ignore_ascii_case(h),
            "Mod hash uyuşmazlığı; dosya korundu."
        );
    } else {
        ensure!(
            e.sha1
                .as_ref()
                .is_some_and(|h| format!("{:x}", a.finalize()).eq_ignore_ascii_case(h)),
            "Mod hash uyuşmazlığı; dosya korundu."
        );
    }
    Ok(())
}
fn entry(v: &Version, user: bool) -> Result<(Entry, File)> {
    let f = v
        .files
        .iter()
        .find(|f| f.primary && f.filename.ends_with(".jar"))
        .or_else(|| v.files.iter().find(|f| f.filename.ends_with(".jar")))
        .context("Mod JAR dosyası bulunamadı.")?
        .clone();
    performance::valid_file(&f)?;
    let e = Entry {
        project_id: v.project_id.clone(),
        version_id: v.id.clone(),
        filename: f.filename.clone(),
        sha512: f.hashes.sha512.clone(),
        sha1: f.hashes.sha1.clone(),
        installed_at: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        user_selected: user,
        enabled: true,
        requires: vec![],
        incompatible: vec![],
    };
    validate_entry(&e)?;
    Ok((e, f))
}
pub fn resolve(
    source: &mut impl Source,
    p: &Profile,
    dir: &Path,
    projects: &[String],
) -> Result<Plan> {
    resolve_selected(source, p, dir, projects, None)
}
pub fn resolve_selected(
    source: &mut impl Source,
    p: &Profile,
    dir: &Path,
    projects: &[String],
    version_id: Option<&str>,
) -> Result<Plan> {
    supports(p)?;
    ensure!(
        !projects.is_empty() && projects.len() <= 32,
        "1–32 mod seçin."
    );
    let old = read(dir)?;
    for e in &old.entries {
        verify(&path(dir, e), e)?;
    }
    let mut chosen = BTreeMap::<String, (Entry, File)>::new();
    let mut promote = Vec::new();
    let mut warnings =
        vec!["Manifestte olmayan harici modların uyumluluğu otomatik belirlenemez.".into()];
    fn add(
        s: &mut impl Source,
        v: Version,
        p: &Profile,
        old: &Manifest,
        chosen: &mut BTreeMap<String, (Entry, File)>,
        warnings: &mut Vec<String>,
        user: bool,
    ) -> Result<()> {
        ensure!(
            modrinth::compatible(&v, &p.version, modrinth::loader_keys(p.loader)),
            "Mod/bağımlılık profilin Minecraft ve Fabric sürümüyle uyumsuz."
        );
        if let Some(e) = old.entries.iter().find(|e| e.project_id == v.project_id) {
            ensure!(e.enabled, "Gerekli mod devre dışı; önce etkinleştirin.");
            ensure!(
                e.version_id == v.id,
                "Kurulu modun farklı sürümü var: {}. Önce kaldırın.",
                e.project_id
            );
            return Ok(());
        }
        if let Some((e, _)) = chosen.get_mut(&v.project_id) {
            ensure!(e.version_id == v.id, "Bağımlılık sürümleri çakışıyor.");
            e.user_selected |= user;
            return Ok(());
        }
        ensure!(chosen.len() < 64, "Bağımlılık sayısı sınırı aşıldı.");
        let (e, f) = entry(&v, user)?;
        chosen.insert(v.project_id.clone(), (e, f));
        for d in v.dependencies {
            match d.dependency_type.as_str() {
                "required" => {
                    let next = if let Some(id) = d.version_id {
                        modrinth::id(&id)?;
                        let n = s.version(&id)?;
                        ensure!(
                            n.id == id && d.project_id.as_ref().is_none_or(|p| p == &n.project_id),
                            "Bağımlılık kimliği eşleşmiyor."
                        );
                        n
                    } else {
                        let id = d
                            .project_id
                            .context("Dosya adı bağımlılığı güvenli çözülemedi.")?;
                        modrinth::id(&id)?;
                        if let Some(e) = old.entries.iter().find(|e| e.project_id == id) {
                            let n = s.version(&e.version_id)?;
                            ensure!(
                                n.project_id == id
                                    && n.id == e.version_id
                                    && modrinth::compatible(&n, &p.version, modrinth::loader_keys(p.loader))
                                    && e.enabled,
                                "Kurulu bağımlılık uyumsuz veya devre dışı."
                            );
                            n
                        } else {
                            modrinth::ranked(s.versions(&id)?, &p.version, modrinth::loader_keys(p.loader))
                                .into_iter()
                                .find(|v| v.project_id == id)
                                .context("Uyumlu bağımlılık yok.")?
                        }
                    };
                    chosen
                        .get_mut(&v.project_id)
                        .unwrap()
                        .0
                        .requires
                        .push(next.project_id.clone());
                    add(s, next, p, old, chosen, warnings, false)?;
                }
                "optional" => warnings.push(format!(
                    "{}: isteğe bağlı bağımlılık {} otomatik kurulmadı.",
                    v.project_id,
                    d.project_id
                        .or(d.version_id)
                        .or(d.file_name)
                        .unwrap_or_default()
                )),
                "incompatible" => {
                    let conflict = if let Some(id) = d.project_id {
                        modrinth::id(&id)?;
                        id
                    } else if let Some(id) = d.version_id {
                        s.version(&id)?.project_id
                    } else {
                        ensure!(
                            d.file_name.is_none(),
                            "Dosya adına bağlı uyumsuzluk çözülemedi."
                        );
                        bail!("Uyumsuzluk kimliği eksik.")
                    };
                    warnings.push(format!("{} ile uyumsuz: {conflict}", v.project_id));
                    chosen
                        .get_mut(&v.project_id)
                        .unwrap()
                        .0
                        .incompatible
                        .push(conflict);
                }
                "embedded" => {}
                _ => bail!("Bilinmeyen bağımlılık türü."),
            }
        }
        Ok(())
    }
    for id in projects {
        modrinth::id(id)?;
        let versions = modrinth::ranked(source.versions(id)?, &p.version, modrinth::loader_keys(p.loader));
        let v = if let Some(selected) = version_id {
            ensure!(projects.len() == 1, "Belirli sürüm için tek mod seçin.");
            versions.into_iter().find(|v| v.id == selected)
        } else {
            versions.into_iter().next()
        }
        .context("Uyumlu mod sürümü bulunamadı.")?;
        if old.entries.iter().any(|e| e.project_id == v.project_id) {
            promote.push(v.project_id.clone());
        }
        add(source, v, p, &old, &mut chosen, &mut warnings, true)?;
    }
    ensure!(
        old.entries.len() + chosen.len() <= 256,
        "Profil başına 256 mod sınırı aşıldı."
    );
    let all: Vec<&Entry> = old
        .entries
        .iter()
        .chain(chosen.values().map(|(e, _)| e))
        .collect();
    let ids: HashSet<_> = all.iter().map(|e| e.project_id.as_str()).collect();
    for e in &all {
        ensure!(
            !e.incompatible.iter().any(|i| ids.contains(i.as_str())),
            "Kurulumda/kurulu modlarda uyumsuzluk: {}",
            e.project_id
        );
    }
    let mut names: HashSet<String> = old
        .entries
        .iter()
        .map(|e| e.filename.to_ascii_lowercase())
        .collect();
    let mut plan = Plan {
        installed: old.entries.clone(),
        promote,
        id: Uuid::new_v4(),
        profile: p.id,
        mc: p.version.clone(),
        loader_version: p.loader_version.clone(),
        entries: vec![],
        files: vec![],
        warnings,
        total_bytes: 0,
        before: raw(dir)?,
    };
    for (_, (e, f)) in chosen {
        ensure!(
            names.insert(e.filename.to_ascii_lowercase()),
            "Mod dosya adları çakışıyor."
        );
        plan.total_bytes += f.size;
        plan.entries.push(e);
        plan.files.push(f);
    }
    ensure!(
        plan.total_bytes <= 512 * 1024 * 1024,
        "Toplu kurulum 512 MB sınırını aşıyor."
    );
    Ok(plan)
}
pub fn install_with(
    dir: &Path,
    p: &Profile,
    plan: &Plan,
    cancel: &AtomicBool,
    mut fetch: impl FnMut(&File, &Path) -> Result<()>,
) -> Result<()> {
    supports(p)?;
    ensure!(
        p.id == plan.profile && p.version == plan.mc && p.loader_version == plan.loader_version,
        "Profil plan hazırlandıktan sonra değişmiş."
    );
    ensure!(
        raw(dir)? == plan.before,
        "Mod listesi değişti; planı yeniden oluşturun."
    );
    let mut manifest = read(dir)?;
    for e in &manifest.entries {
        verify(&path(dir, e), e)?;
    }
    for e in &mut manifest.entries {
        if plan.promote.contains(&e.project_id) {
            e.user_selected = true;
        }
    }
    fs::create_dir_all(dir.join("mods"))?;
    plain(&dir.join("mods"))?;
    for e in &plan.entries {
        validate_entry(e)?;
        ensure!(
            fs::symlink_metadata(path(dir, e)).is_err()
                && !dir
                    .join("mods")
                    .join(format!("{}.disabled", e.filename))
                    .exists(),
            "Dosya zaten var; harici modun üzerine yazılmaz."
        );
    }
    let stage = dir.join(format!(".mods-install-{}", Uuid::new_v4()));
    fs::create_dir(&stage)?;
    let mut added = vec![];
    let result = (|| -> Result<()> {
        for (e, f) in plan.entries.iter().zip(&plan.files) {
            ensure!(
                !cancel.load(Ordering::Relaxed),
                "Mod kurulumu iptal edildi."
            );
            let target = stage.join(&e.filename);
            fetch(f, &target)?;
            verify(&target, e)?;
        }
        for e in &plan.entries {
            ensure!(
                !cancel.load(Ordering::Relaxed),
                "Mod kurulumu iptal edildi."
            );
            let dest = path(dir, e);
            fs::hard_link(stage.join(&e.filename), &dest)?;
            added.push(dest);
            manifest.entries.push(e.clone());
        }
        crate::profiles::atomic_write(
            &dir.join("mods.lock.json"),
            &serde_json::to_vec_pretty(&manifest)?,
        )?;
        Ok(())
    })();
    if result.is_err() {
        for f in added.iter().rev() {
            fs::remove_file(f).context("Kurulum geri alınamadı")?;
        }
    }
    fs::remove_dir_all(&stage).context("Geçici mod dosyaları temizlenemedi")?;
    result.context("Mod kurulumu başarısız; bu işlemde eklenen dosyalar geri alındı.")
}
#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub profile_id: Uuid,
    pub filename: String,
    pub file_bytes: u64,
    pub file_total: u64,
    pub completed_bytes: u64,
    pub total_bytes: u64,
}
pub fn install(
    root: &Path,
    p: &Profile,
    plan: Plan,
    cancel: &AtomicBool,
    notify: &dyn Fn(String),
    progress: &dyn Fn(Progress),
) -> Result<()> {
    let dir = directory(root, p)?;
    let client = performance::client(true)?;
    let mut completed = 0;
    install_with(&dir, p, &plan, cancel, |f, target| {
        notify(format!("Mod indiriliyor: {}", f.filename));
        let r = client
            .get(&f.url)
            .send()
            .context("Mod CDN bağlantısı kurulamadı")?
            .error_for_status()
            .context("Mod CDN isteği başarısız")?;
        performance::receive(r, f, target, cancel, |n| {
            progress(Progress {
                profile_id: p.id,
                filename: f.filename.clone(),
                file_bytes: n,
                file_total: f.size,
                completed_bytes: completed + n,
                total_bytes: plan.total_bytes,
            });
        })?;
        completed += f.size;
        Ok(())
    })
}
#[derive(Serialize)]
pub struct Listing {
    pub managed: Vec<Entry>,
    pub external: Vec<String>,
}
pub fn list(dir: &Path) -> Result<Listing> {
    let m = read(dir)?;
    let names: HashSet<_> = m
        .entries
        .iter()
        .map(|e| {
            path(dir, e)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string()
        })
        .collect();
    let mut external = vec![];
    if dir.join("mods").exists() {
        plain(&dir.join("mods"))?;
        for e in fs::read_dir(dir.join("mods"))? {
            let e = e?;
            let name = e.file_name().to_string_lossy().to_string();
            if !names.contains(&name) && (name.ends_with(".jar") || name.ends_with(".jar.disabled"))
            {
                external.push(name);
            }
        }
    }
    Ok(Listing {
        managed: m.entries,
        external,
    })
}
pub fn removal(dir: &Path, id: &str) -> Result<Vec<Entry>> {
    modrinth::id(id)?;
    let m = read(dir)?;
    ensure!(
        m.entries.iter().any(|e| e.project_id == id),
        "Mod manifestte yok; harici dosyalar değiştirilemez."
    );
    ensure!(
        !m.entries
            .iter()
            .any(|e| e.project_id != id && e.requires.iter().any(|r| r == id)),
        "Başka modlar bu modu gerektiriyor."
    );
    let map: HashMap<_, _> = m
        .entries
        .iter()
        .map(|e| (e.project_id.clone(), e))
        .collect();
    fn walk(id: &str, map: &HashMap<String, &Entry>, seen: &mut HashSet<String>) {
        if !seen.insert(id.into()) {
            return;
        }
        if let Some(e) = map.get(id) {
            for d in &e.requires {
                walk(d, map, seen);
            }
        }
    }
    let mut removed = HashSet::new();
    walk(id, &map, &mut removed);
    let mut retained = HashSet::new();
    for e in &m.entries {
        if e.project_id != id && (e.user_selected || !removed.contains(&e.project_id)) {
            walk(&e.project_id, &map, &mut retained);
        }
    }
    Ok(m.entries
        .into_iter()
        .filter(|e| {
            e.project_id == id
                || (!e.user_selected
                    && removed.contains(&e.project_id)
                    && !retained.contains(&e.project_id))
        })
        .collect())
}
pub fn remove(dir: &Path, id: &str, dependencies: bool) -> Result<()> {
    let mut candidates = removal(dir, id)?;
    if !dependencies {
        candidates.retain(|e| e.project_id == id);
    }
    let mut m = read(dir)?;
    ensure!(
        !m.entries
            .iter()
            .filter(|e| !candidates.iter().any(|c| c.project_id == e.project_id))
            .any(|e| e
                .requires
                .iter()
                .any(|r| candidates.iter().any(|c| &c.project_id == r))),
        "Kalan modlar kaldırılacak bir bağımlılığı kullanıyor."
    );
    let stage = dir.join(format!(".mods-remove-{}", Uuid::new_v4()));
    fs::create_dir(&stage)?;
    let mut moved = vec![];
    let result = (|| -> Result<()> {
        for e in &candidates {
            let from = path(dir, e);
            verify(&from, e)?;
            let to = stage.join(from.file_name().unwrap());
            fs::rename(&from, &to)?;
            moved.push((from, to));
        }
        m.entries
            .retain(|e| !candidates.iter().any(|c| c.project_id == e.project_id));
        crate::profiles::atomic_write(
            &dir.join("mods.lock.json"),
            &serde_json::to_vec_pretty(&m)?,
        )?;
        Ok(())
    })();
    if result.is_err() {
        for (a, b) in moved.iter().rev() {
            fs::rename(b, a).context("Mod kaldırma geri alınamadı")?;
        }
    }
    fs::remove_dir_all(stage)?;
    result
}
pub fn toggle(dir: &Path, id: &str, enabled: bool) -> Result<()> {
    let mut m = read(dir)?;
    if !enabled {
        ensure!(
            !m.entries
                .iter()
                .any(|e| e.enabled && e.project_id != id && e.requires.iter().any(|r| r == id)),
            "Etkin modlar bu bağımlılığı kullanıyor; önce onları devre dışı bırakın."
        );
    }
    let e = m
        .entries
        .iter_mut()
        .find(|e| e.project_id == id)
        .context("Mod manifestte yok; harici dosyalar değiştirilemez.")?;
    if e.enabled == enabled {
        return Ok(());
    }
    let old = path(dir, e);
    verify(&old, e)?;
    e.enabled = enabled;
    let new = path(dir, e);
    ensure!(!new.exists(), "Hedef dosya zaten var; değiştirilmedi.");
    fs::hard_link(&old, &new)?;
    fs::remove_file(&old)?;
    if let Err(error) =
        crate::profiles::atomic_write(&dir.join("mods.lock.json"), &serde_json::to_vec_pretty(&m)?)
    {
        fs::rename(&new, &old)?;
        return Err(error);
    }
    Ok(())
}
pub struct Job(
    pub  Box<
        dyn FnOnce(
                PathBuf,
                Profile,
                std::sync::Arc<AtomicBool>,
                Box<dyn Fn(String) + Send>,
            ) -> Result<()>
            + Send,
    >,
);
impl std::fmt::Debug for Job {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ModJob")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fake(Vec<Version>);
    impl Source for Fake {
        fn versions(&mut self, id: &str) -> Result<Vec<Version>> {
            Ok(self
                .0
                .iter()
                .filter(|v| v.project_id == id)
                .cloned()
                .collect())
        }
        fn version(&mut self, id: &str) -> Result<Version> {
            self.0
                .iter()
                .find(|v| v.id == id)
                .cloned()
                .context("Mock version missing")
        }
    }
    fn version(id: &str, dep: Option<&str>) -> Version {
        serde_json::from_value(serde_json::json!({"id":format!("{id}v"),"project_id":id,"version_number":"1","version_type":"release","date_published":"2026-11-03","game_versions":["1.21.11"],"loaders":["fabric"],"files":[{"filename":format!("{id}.jar"),"url":format!("https://cdn.modrinth.com/{id}.jar"),"size":3,"primary":true,"hashes":{"sha512":format!("{:x}",Sha512::digest(b"jar"))}}],"dependencies":dep.map(|d|vec![serde_json::json!({"project_id":d,"version_id":null,"file_name":null,"dependency_type":"required"})]).unwrap_or_default()})).unwrap()
    }
    fn setup() -> (PathBuf, Profile) {
        let root = std::env::temp_dir().join(format!("patron-mod-tests-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let p = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "Mods".into(),
            version: "1.21.11".into(),
            loader: Loader::Fabric,
            loader_version: Some("0.16.10".into()),
        };
        (root, p)
    }
    fn fetch(_: &File, p: &Path) -> Result<()> {
        fs::write(p, b"jar")?;
        Ok(())
    }
    #[test]
    fn dependencies_manifest_external_toggle_and_remove_are_safe() {
        let (dir, p) = setup();
        let mut api = Fake(vec![version("a", Some("b")), version("b", None)]);
        let plan = resolve(&mut api, &p, &dir, &["a".into()]).unwrap();
        assert_eq!(plan.entries.len(), 2);
        install_with(&dir, &p, &plan, &AtomicBool::new(false), fetch).unwrap();
        fs::write(dir.join("mods/manual.jar"), b"manual").unwrap();
        let l = list(&dir).unwrap();
        assert_eq!(l.external, vec!["manual.jar"]);
        assert_eq!(l.managed.len(), 2);
        assert!(
            !l.managed
                .iter()
                .find(|e| e.project_id == "b")
                .unwrap()
                .user_selected
        );
        toggle(&dir, "a", false).unwrap();
        assert!(dir.join("mods/a.jar.disabled").exists());
        toggle(&dir, "a", true).unwrap();
        assert_eq!(removal(&dir, "a").unwrap().len(), 2);
        remove(&dir, "a", true).unwrap();
        assert!(read(&dir).unwrap().entries.is_empty());
        assert_eq!(fs::read(dir.join("mods/manual.jar")).unwrap(), b"manual");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rollback_on_manifest_failure_hash_failure_and_cancel() {
        let (dir, p) = setup();
        let plan = resolve(&mut Fake(vec![version("a", None)]), &p, &dir, &["a".into()]).unwrap();
        assert!(
            install_with(&dir, &p, &plan, &AtomicBool::new(false), |_, path| {
                fs::write(path, b"bad")?;
                Ok(())
            })
            .is_err()
        );
        assert!(!dir.join("mods/a.jar").exists());
        assert!(install_with(&dir, &p, &plan, &AtomicBool::new(true), fetch).is_err());
        assert!(
            install_with(&dir, &p, &plan, &AtomicBool::new(false), |f, path| {
                fetch(f, path)?;
                fs::create_dir(dir.join("mods.lock.json"))?;
                Ok(())
            })
            .is_err()
        );
        assert!(!dir.join("mods/a.jar").exists());
        assert!(!fs::read_dir(&dir).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".mods-install")
        }));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn installed_dependencies_are_skipped_and_shared_dependencies_are_not_removed() {
        let (dir, p) = setup();
        let mut api = Fake(vec![
            version("a", Some("b")),
            version("b", None),
            version("c", Some("b")),
        ]);
        let plan = resolve(&mut api, &p, &dir, &["a".into()]).unwrap();
        install_with(&dir, &p, &plan, &AtomicBool::new(false), fetch).unwrap();
        let plan = resolve(&mut api, &p, &dir, &["c".into()]).unwrap();
        assert_eq!(plan.entries.len(), 1);
        install_with(&dir, &p, &plan, &AtomicBool::new(false), fetch).unwrap();
        assert_eq!(removal(&dir, "a").unwrap().len(), 1);
        assert!(remove(&dir, "b", true).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_conflicts_and_handles_cycles() {
        let (dir, p) = setup();
        let mut a = version("a", Some("b"));
        let b = version("b", Some("a"));
        assert_eq!(
            resolve(
                &mut Fake(vec![a.clone(), b.clone()]),
                &p,
                &dir,
                &["a".into()]
            )
            .unwrap()
            .entries
            .len(),
            2
        );
        a.dependencies.push(modrinth::Dependency {
            project_id: Some("b".into()),
            version_id: None,
            file_name: None,
            dependency_type: "incompatible".into(),
        });
        assert!(resolve(&mut Fake(vec![a, b]), &p, &dir, &["a".into()]).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn filenames_hosts_hashes_and_manual_collisions_are_rejected() {
        let (dir, p) = setup();
        let v = version("a", None);
        for name in [
            "../a.jar",
            "C:/a.jar",
            "/a.jar",
            "CON.jar",
            "a..jar",
            "a.jar:stream",
            "a?.jar",
        ] {
            let mut v = v.clone();
            v.files[0].filename = name.into();
            assert!(entry(&v, true).is_err(), "{name}");
        }
        for host in [
            "http://cdn.modrinth.com/a.jar",
            "https://evil.test/a.jar",
            "https://cdn.modrinth.com.evil.test/a.jar",
            "https://user@cdn.modrinth.com/a.jar",
        ] {
            let mut v = v.clone();
            v.files[0].url = host.into();
            assert!(entry(&v, true).is_err());
        }
        let plan = resolve(&mut Fake(vec![v]), &p, &dir, &["a".into()]).unwrap();
        fs::create_dir(dir.join("mods")).unwrap();
        fs::write(dir.join("mods/a.jar"), b"manual").unwrap();
        assert!(install_with(&dir, &p, &plan, &AtomicBool::new(false), fetch).is_err());
        assert_eq!(fs::read(dir.join("mods/a.jar")).unwrap(), b"manual");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn release_recommended_before_newer_beta_and_vanilla_denied() {
        let (dir, mut p) = setup();
        let a = version("a", None);
        let mut b = a.clone();
        b.id = "beta".into();
        b.version_type = "beta".into();
        b.date_published = "2099".into();
        assert_eq!(modrinth::ranked(vec![b, a.clone()], &p.version, modrinth::loader_keys(p.loader))[0].id, a.id);
        let mut beta = a.clone();
        beta.id = "beta".into();
        beta.version_type = "beta".into();
        let selected = resolve_selected(
            &mut Fake(vec![a.clone(), beta]),
            &p,
            &dir,
            &["a".into()],
            Some("beta"),
        )
        .unwrap();
        assert_eq!(selected.entries[0].version_id, "beta");
        assert!(
            resolve_selected(
                &mut Fake(vec![a.clone()]),
                &p,
                &dir,
                &["a".into()],
                Some("unknown")
            )
            .is_err()
        );
        p.loader = Loader::Vanilla;
        assert!(
            resolve(&mut Fake(vec![a]), &p, &dir, &["a".into()])
                .unwrap_err()
                .to_string()
                .contains("profili oluştur")
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
