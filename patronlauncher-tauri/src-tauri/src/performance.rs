//! Server-owned Modrinth plans: metadata preview never downloads a mod JAR.
use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sha2::Sha512;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use uuid::Uuid;
const MAX_MODS: usize = 32;
const MAX_FILE: u64 = 128 * 1024 * 1024;
const MAX_PACK: u64 = 512 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(15 * 60);
#[derive(Debug, Clone, Deserialize)]
struct Project {
    id: String,
    title: String,
    project_type: String,
    client_side: String,
}
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub(crate) struct Hashes {
    pub(crate) sha1: Option<String>,
    pub(crate) sha512: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct File {
    pub(crate) filename: String,
    pub(crate) url: String,
    pub(crate) size: u64,
    #[serde(default)]
    pub(crate) primary: bool,
    pub(crate) hashes: Hashes,
}
#[derive(Debug, Clone, Deserialize)]
struct Dependency {
    project_id: Option<String>,
    version_id: Option<String>,
    file_name: Option<String>,
    dependency_type: String,
}
#[derive(Debug, Clone, Deserialize)]
struct Version {
    id: String,
    project_id: String,
    version_number: String,
    version_type: String,
    date_published: String,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    files: Vec<File>,
    dependencies: Vec<Dependency>,
}
#[derive(Debug, Clone, Serialize)]
pub struct ModSummary {
    pub project_id: String,
    pub title: String,
    pub version_id: String,
    pub version: String,
    pub filename: String,
    pub size: u64,
    pub dependency: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct PlanSummary {
    pub plan_id: Uuid,
    pub minecraft_version: String,
    pub mods: Vec<ModSummary>,
    pub total_size: u64,
    pub warnings: Vec<String>,
}
#[derive(Debug, Clone)]
pub struct ApprovedPlan {
    pub minecraft_version: String,
    files: Vec<(ModSummary, File)>,
    warnings: Vec<String>,
}
#[derive(Default)]
pub struct PlanStore(Mutex<HashMap<Uuid, (Instant, ApprovedPlan)>>);
impl PlanStore {
    pub fn insert(&self, plan: ApprovedPlan) -> Result<PlanSummary> {
        let mut plans = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("Mod planı kilidi açılamadı"))?;
        plans.retain(|_, (at, _)| at.elapsed() < TTL);
        if plans.len() >= 8 {
            if let Some(id) = plans
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(id, _)| *id)
            {
                plans.remove(&id);
            }
        }
        let id = Uuid::new_v4();
        let summary = PlanSummary {
            plan_id: id,
            minecraft_version: plan.minecraft_version.clone(),
            mods: plan.files.iter().map(|(m, _)| m.clone()).collect(),
            total_size: plan.files.iter().map(|(_, f)| f.size).sum(),
            warnings: plan.warnings.clone(),
        };
        plans.insert(id, (Instant::now(), plan));
        Ok(summary)
    }
    pub fn approve(&self, id: Uuid, mc: &str, confirmed: bool) -> Result<ApprovedPlan> {
        if !confirmed {
            bail!("Mod indirmesi için açık kullanıcı onayı gerekli.");
        }
        let mut plans = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("Mod planı kilidi açılamadı"))?;
        let (at, plan) = plans
            .get(&id)
            .context("Mod planı yok veya daha önce kullanılmış; listeyi yeniden alın.")?;
        if at.elapsed() >= TTL {
            plans.remove(&id);
            bail!("Mod planının süresi doldu; listeyi yeniden alın.");
        }
        if plan.minecraft_version != mc {
            bail!("Onaylanan mod planı farklı bir Minecraft sürümüne ait.");
        }
        Ok(plans.remove(&id).unwrap().1)
    }
}
fn identifier(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        bail!("Modrinth kimliği geçersiz.");
    }
    Ok(())
}
pub(crate) fn approved(url: &str, cdn_only: bool) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
            && u.fragment().is_none()
            && if cdn_only {
                u.host_str() == Some("cdn.modrinth.com") && u.query().is_none()
            } else {
                matches!(u.host_str(), Some("api.modrinth.com" | "cdn.modrinth.com"))
            }
    })
}
pub(crate) fn client(cdn: bool) -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .user_agent(crate::modrinth::user_agent())
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 || !approved(attempt.url().as_str(), cdn) {
                attempt.error("Modrinth yönlendirmesi reddedildi")
            } else {
                attempt.follow()
            }
        }))
        .build()?)
}
trait Source {
    fn project(&mut self, id: &str) -> Result<Project>;
    fn versions(&mut self, id: &str, mc: &str) -> Result<Vec<Version>>;
    fn version(&mut self, id: &str) -> Result<Version>;
}
struct HttpSource(Client);
impl HttpSource {
    fn get<T: serde::de::DeserializeOwned>(&self, url: reqwest::Url) -> Result<T> {
        if url.host_str() != Some("api.modrinth.com") || !approved(url.as_str(), false) {
            bail!("Modrinth API adresi reddedildi.");
        }
        let response = self.0.get(url).send()?.error_for_status()?;
        let mut bytes = vec![];
        response.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > 8 * 1024 * 1024 {
            bail!("Modrinth yanıtı çok büyük.");
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
}
impl Source for HttpSource {
    fn project(&mut self, id: &str) -> Result<Project> {
        identifier(id)?;
        self.get(reqwest::Url::parse(&format!(
            "https://api.modrinth.com/v2/project/{id}"
        ))?)
    }
    fn versions(&mut self, id: &str, mc: &str) -> Result<Vec<Version>> {
        identifier(id)?;
        let mut url =
            reqwest::Url::parse(&format!("https://api.modrinth.com/v2/project/{id}/version"))?;
        url.query_pairs_mut()
            .append_pair("loaders", "[\"fabric\"]")
            .append_pair("game_versions", &serde_json::to_string(&[mc])?)
            .append_pair("include_changelog", "false");
        self.get(url)
    }
    fn version(&mut self, id: &str) -> Result<Version> {
        identifier(id)?;
        self.get(reqwest::Url::parse(&format!(
            "https://api.modrinth.com/v2/version/{id}"
        ))?)
    }
}
fn compatible(v: &Version, mc: &str) -> bool {
    v.game_versions.iter().any(|g| g == mc) && v.loaders.iter().any(|l| l == "fabric")
}
pub(crate) fn valid_file(f: &File) -> Result<()> {
    valid_file_with(f, &[".jar"])
}
/// Paket ve shader dosyaları için izin verilen uzantılarla aynı denetim.
pub(crate) fn valid_file_with(f: &File, extensions: &[&str]) -> Result<()> {
    let n = &f.filename;
    let stem = n.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix)
                .is_some_and(|tail| tail.len() == 1 && matches!(tail.as_bytes()[0], b'1'..=b'9'))
        });
    if n.is_empty()
        || n.starts_with('.')
        || reserved
        || n.len() > 180
        || !extensions.iter().any(|e| n.to_ascii_lowercase().ends_with(e))
        || n.contains("..")
        || !n
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-_+".contains(&b))
    {
        bail!("Mod dosya adı güvenli değil.");
    }
    if !approved(&f.url, true) {
        bail!("Mod dosyası onaylı Modrinth CDN adresinde değil.");
    }
    if f.size == 0 || f.size > MAX_FILE {
        bail!("Mod dosya boyutu geçersiz.");
    }
    if f.hashes.sha1.is_none() && f.hashes.sha512.is_none() {
        bail!("Mod sağlama toplamı eksik.");
    }
    for (hash, len) in [(&f.hashes.sha1, 40), (&f.hashes.sha512, 128)] {
        if let Some(h) = hash {
            if h.len() != len || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
                bail!("Mod sağlama toplamı geçersiz.");
            }
        }
    }
    Ok(())
}
struct Resolver<'a, S: Source> {
    source: &'a mut S,
    mc: &'a str,
    chosen: BTreeMap<String, (Project, Version, bool)>,
    warnings: Vec<String>,
}
impl<S: Source> Resolver<'_, S> {
    fn latest(&mut self, id: &str) -> Result<Option<Version>> {
        let mut list = self.source.versions(id, self.mc)?;
        list.retain(|v| {
            v.project_id == id && v.version_type == "release" && compatible(v, self.mc)
        });
        list.sort_by(|a, b| b.date_published.cmp(&a.date_published));
        Ok(list.into_iter().next())
    }
    fn add(&mut self, version: Version, dependency: bool) -> Result<()> {
        identifier(&version.id)?;
        identifier(&version.project_id)?;
        if !compatible(&version, self.mc) {
            bail!("Gerekli mod sürümü Minecraft/Fabric seçimiyle uyumlu değil.");
        }
        if let Some((_, old, _)) = self.chosen.get(&version.project_id) {
            if old.id != version.id {
                bail!("Bağımlılık sürümü çakışıyor: {}", version.project_id);
            }
            return Ok(());
        }
        if self.chosen.len() >= MAX_MODS {
            bail!("Bağımlılık sayısı sınırı aşıldı.");
        }
        let project = self.source.project(&version.project_id)?;
        if project.id != version.project_id
            || project.project_type != "mod"
            || project.client_side == "unsupported"
        {
            bail!("Gerekli proje istemci modu değil.");
        }
        if version.version_type != "release" {
            self.warnings.push(format!(
                "{}: gerekli bağımlılık {} türünde.",
                project.title, version.version_type
            ));
        }
        let dependencies = version.dependencies.clone();
        if dependencies.iter().any(|d| {
            !matches!(
                d.dependency_type.as_str(),
                "required" | "optional" | "embedded" | "incompatible"
            )
        }) {
            bail!("Bilinmeyen bağımlılık türü; paket güvenli biçimde durduruldu.");
        }
        self.chosen
            .insert(project.id.clone(), (project, version, dependency));
        for dep in dependencies
            .iter()
            .filter(|d| d.dependency_type == "required")
        {
            let next = if let Some(id) = &dep.version_id {
                let v = self.source.version(id)?;
                if v.id != *id || dep.project_id.as_ref().is_some_and(|p| p != &v.project_id) {
                    bail!("Bağımlılık kimliği eşleşmiyor.");
                }
                v
            } else if let Some(id) = &dep.project_id {
                if self.chosen.contains_key(id) {
                    continue;
                }
                self.latest(id)?
                    .context("Uyumlu kararlı bağımlılık bulunamadı")?
            } else {
                bail!("Dosya adına bağlı bağımlılık güvenli biçimde çözülemedi.");
            };
            self.add(next, true)?;
        }
        Ok(())
    }
    fn finish(self) -> Result<ApprovedPlan> {
        let mut files = vec![];
        let mut names = HashSet::new();
        for (project, version, dependency) in self.chosen.values() {
            for dep in version
                .dependencies
                .iter()
                .filter(|d| d.dependency_type == "incompatible")
            {
                let incompatible_project = self.chosen.values().any(|(_, v, _)| {
                    if let Some(id) = &dep.version_id {
                        id == &v.id
                    } else {
                        dep.project_id
                            .as_ref()
                            .is_some_and(|id| id == &v.project_id)
                    }
                });
                let incompatible_file = dep.file_name.as_ref().is_some_and(|n| {
                    self.chosen
                        .values()
                        .any(|(_, v, _)| v.files.iter().any(|f| &f.filename == n))
                });
                if incompatible_project || incompatible_file {
                    bail!("Paket içinde uyumsuz modlar var: {}", project.title);
                }
            }
            let file = version
                .files
                .iter()
                .find(|f| f.primary && f.filename.ends_with(".jar"))
                .or_else(|| version.files.iter().find(|f| f.filename.ends_with(".jar")))
                .context("Mod JAR dosyası bulunamadı")?
                .clone();
            valid_file(&file)?;
            if !names.insert(file.filename.to_ascii_lowercase()) {
                bail!("Mod dosya adları çakışıyor.");
            }
            files.push((
                ModSummary {
                    project_id: project.id.clone(),
                    title: project.title.clone(),
                    version_id: version.id.clone(),
                    version: version.version_number.clone(),
                    filename: file.filename.clone(),
                    size: file.size,
                    dependency: *dependency,
                },
                file,
            ));
        }
        if files.is_empty() {
            bail!("Bu Minecraft sürümü için uyumlu performans modu bulunamadı.");
        }
        if files.iter().map(|(_, f)| f.size).sum::<u64>() > MAX_PACK {
            bail!("Performans paketi boyut sınırını aşıyor.");
        }
        files.sort_by(|a, b| a.0.title.cmp(&b.0.title));
        Ok(ApprovedPlan {
            minecraft_version: self.mc.into(),
            files,
            warnings: self.warnings,
        })
    }
}
/// Sürümle birlikte tek tek seçilebilen Fabric modları (anahtar, Modrinth kimliği, ad).
pub const ADDONS: [(&str, &str, &str); 9] = [
    ("sodium", "AANobbMI", "Sodium"),
    ("lithium", "gvQqBUqZ", "Lithium"),
    ("ferritecore", "uXXizFIs", "FerriteCore"),
    ("iris", "YL57xq9U", "Iris Shaders"),
    ("immediatelyfast", "5ZwdcRci", "ImmediatelyFast"),
    ("entityculling", "NNAgCjsB", "Entity Culling"),
    ("modmenu", "mOgUt4GM", "Mod Menu"),
    ("zoomify", "w7ThoJFB", "Zoomify"),
    ("continuity", "1IjD5062", "Continuity"),
];
pub fn preview(mc: &str) -> Result<ApprovedPlan> {
    preview_selected(mc, &["sodium".into(), "lithium".into(), "ferritecore".into()])
}
pub fn preview_selected(mc: &str, picks: &[String]) -> Result<ApprovedPlan> {
    crate::fabric::identifier(mc)?;
    if picks.is_empty() || picks.len() > ADDONS.len() {
        bail!("En az bir mod seçin.");
    }
    let mut selected = Vec::new();
    for key in picks {
        let addon = ADDONS
            .iter()
            .find(|(k, _, _)| k == key)
            .context("Bilinmeyen mod seçimi.")?;
        if !selected.contains(addon) {
            selected.push(*addon);
        }
    }
    let mut source = HttpSource(client(false)?);
    let mut r = Resolver {
        source: &mut source,
        mc,
        chosen: BTreeMap::new(),
        warnings: vec![],
    };
    for (_, id, name) in selected {
        if let Some(v) = r.latest(id)? {
            r.add(v, false)?;
        } else {
            r.warnings.push(format!(
                "{name}: {mc} için uyumlu kararlı Fabric sürümü yok; pakete eklenmedi."
            ));
        }
    }
    r.finish()
}
pub(crate) fn receive(
    response: impl Read,
    file: &File,
    path: &Path,
    cancel: &AtomicBool,
    progress: impl FnMut(u64),
) -> Result<()> {
    receive_with(response, file, path, cancel, progress, &[".jar"])
}
pub(crate) fn receive_with(
    mut response: impl Read,
    file: &File,
    path: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
    extensions: &[&str],
) -> Result<()> {
    valid_file_with(file, extensions)?;
    let part = path.with_extension("part");
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part)?;
    let result = (|| -> Result<()> {
        let mut h1 = Sha1::new();
        let mut h512 = Sha512::new();
        let mut bytes = 0u64;
        let mut last = Instant::now();
        let mut buf = [0u8; 65536];
        loop {
            if cancel.load(Ordering::Relaxed) {
                bail!("İşlem iptal edildi.");
            }
            let count = response.read(&mut buf)?;
            if count == 0 {
                break;
            }
            bytes += count as u64;
            if bytes > file.size || bytes > MAX_FILE {
                bail!("Mod boyutu beklenen değeri aşıyor.");
            }
            output.write_all(&buf[..count])?;
            h1.update(&buf[..count]);
            h512.update(&buf[..count]);
            if last.elapsed() >= Duration::from_millis(100) {
                progress(bytes);
                last = Instant::now();
            }
        }
        if bytes != file.size {
            bail!("Mod dosyası eksik indirildi.");
        }
        let h1 = format!("{:x}", h1.finalize());
        let h512 = format!("{:x}", h512.finalize());
        if file
            .hashes
            .sha1
            .as_ref()
            .is_some_and(|h| !h.eq_ignore_ascii_case(&h1))
            || file
                .hashes
                .sha512
                .as_ref()
                .is_some_and(|h| !h.eq_ignore_ascii_case(&h512))
        {
            bail!("Mod sağlama toplamı doğrulanamadı.");
        }
        output.flush()?;
        output.sync_all()?;
        progress(bytes);
        Ok(())
    })();
    drop(output);
    if result.is_err() {
        let _ = fs::remove_file(&part);
        return result;
    }
    fs::rename(&part, path)?;
    Ok(())
}
fn cancelled(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        bail!("İşlem iptal edildi.");
    }
    Ok(())
}
pub fn cleanup_profile(root: &Path, id: Uuid) {
    let target = root.join("instances").join(id.to_string());
    if let (Ok(base), Ok(path)) = (root.canonicalize(), target.canonicalize()) {
        if path == base.join("instances").join(id.to_string()) && !target.is_symlink() {
            let _ = fs::remove_dir_all(target);
        }
    }
}
pub fn install_quick(
    root: &Path,
    profile: &crate::model::Profile,
    plan: &ApprovedPlan,
    cancel: &AtomicBool,
    notify: impl Fn(String),
) -> Result<()> {
    let staging = crate::model::Profile {
        id: Uuid::new_v4(),
        ..profile.clone()
    };
    let result = (|| -> Result<()> {
        install(root, &staging, Some(plan), cancel, notify)?;
        let destination = crate::core::security::owned_path(
            root,
            &crate::profiles::dir(root, profile).join("mods"),
        )?;
        let source = crate::profiles::dir(root, &staging).join("mods");
        for entry in fs::read_dir(&source)? {
            let e = entry?;
            let to = destination.join(e.file_name());
            if to.exists() && fs::read(&to)? != fs::read(e.path())? {
                bail!("Aynı adlı farklı bir mod var; mevcut dosyalar korundu.")
            }
        }
        cancelled(cancel)?;
        for entry in fs::read_dir(source)? {
            let e = entry?;
            let to = destination.join(e.file_name());
            if !to.exists() {
                fs::rename(e.path(), to)?;
            }
        }
        Ok(())
    })();
    cleanup_profile(root, staging.id);
    result
}
pub fn install(
    root: &Path,
    profile: &crate::model::Profile,
    plan: Option<&ApprovedPlan>,
    cancel: &AtomicBool,
    notify: impl Fn(String),
) -> Result<()> {
    if let Some(plan) = plan {
        if profile.loader != crate::model::Loader::Fabric
            || plan.minecraft_version != profile.version
        {
            bail!("Onaylı paket profil seçimiyle eşleşmiyor.");
        }
    }
    let staging = crate::core::security::owned_path(
        root,
        &root.join(".install-staging").join(profile.id.to_string()),
    )?;
    let result = (|| -> Result<()> {
        cancelled(cancel)?;
        let mods = crate::core::security::owned_path(root, &staging.join("mods"))?;
        if let Some(plan) = plan {
            let client = client(true)?;
            let total: u64 = plan.files.iter().map(|(_, f)| f.size).sum();
            let mut done = 0;
            for (summary, file) in &plan.files {
                cancelled(cancel)?;
                valid_file(file)?;
                let path = crate::net::safe_join(&mods, &file.filename)?;
                notify(format!("{} indiriliyor…", summary.title));
                let response = client.get(&file.url).send()?.error_for_status()?;
                receive(response, file, &path, cancel, |bytes| {
                    notify(format!("Modlar: {} / {total}", done + bytes))
                })?;
                done += file.size;
            }
            let receipt: Vec<_> = plan.files.iter().map(|(summary, _)| summary).collect();
            crate::profiles::atomic_write(
                &staging.join(".patronlauncher-mods.json"),
                &serde_json::to_vec_pretty(&receipt)?,
            )?;
        }
        cancelled(cancel)?;
        let instances = crate::core::security::owned_path(root, &root.join("instances"))?;
        let destination = instances.join(profile.id.to_string());
        if destination.exists() {
            bail!("Profil klasörü zaten var; var olan dosyalar korunuyor.");
        }
        fs::rename(&staging, &destination)?;
        Ok(())
    })();
    if result.is_err() {
        if let (Ok(base), Ok(path)) = (root.canonicalize(), staging.canonicalize()) {
            if path == base.join(".install-staging").join(profile.id.to_string())
                && !staging.is_symlink()
            {
                let _ = fs::remove_dir_all(staging);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(bytes: &[u8]) -> File {
        File {
            filename: "example.jar".into(),
            url: "https://cdn.modrinth.com/data/mod/versions/v/example.jar".into(),
            size: bytes.len() as u64,
            primary: true,
            hashes: Hashes {
                sha1: Some(format!("{:x}", Sha1::digest(bytes))),
                sha512: Some(format!("{:x}", Sha512::digest(bytes))),
            },
        }
    }
    fn version(id: &str, deps: Vec<Dependency>) -> Version {
        Version {
            id: format!("v-{id}"),
            project_id: id.into(),
            version_number: "1.0".into(),
            version_type: "release".into(),
            date_published: "2026-01-01".into(),
            game_versions: vec!["1.21.11".into()],
            loaders: vec!["fabric".into()],
            files: vec![File {
                filename: format!("{id}.jar"),
                ..file(b"test")
            }],
            dependencies: deps,
        }
    }
    fn dep(project: &str, kind: &str) -> Dependency {
        Dependency {
            project_id: Some(project.into()),
            version_id: None,
            file_name: None,
            dependency_type: kind.into(),
        }
    }
    struct Fake {
        versions: HashMap<String, Version>,
    }
    impl Source for Fake {
        fn project(&mut self, id: &str) -> Result<Project> {
            Ok(Project {
                id: id.into(),
                title: id.into(),
                project_type: "mod".into(),
                client_side: "required".into(),
            })
        }
        fn versions(&mut self, id: &str, _: &str) -> Result<Vec<Version>> {
            Ok(self.versions.get(id).cloned().into_iter().collect())
        }
        fn version(&mut self, id: &str) -> Result<Version> {
            self.versions
                .values()
                .find(|v| v.id == id)
                .cloned()
                .context("missing")
        }
    }
    fn plan() -> ApprovedPlan {
        let mut fake = Fake {
            versions: HashMap::new(),
        };
        let mut r = Resolver {
            source: &mut fake,
            mc: "1.21.11",
            chosen: BTreeMap::new(),
            warnings: vec![],
        };
        r.add(version("root", vec![]), false).unwrap();
        r.finish().unwrap()
    }
    #[test]
    fn resolves_required_dependencies_deduplicates_cycles_and_skips_optional() {
        let root = version(
            "root",
            vec![dep("dependency", "required"), dep("optional", "optional")],
        );
        let dependency = version("dependency", vec![dep("root", "required")]);
        let mut fake = Fake {
            versions: HashMap::from([
                ("root".into(), root.clone()),
                ("dependency".into(), dependency),
            ]),
        };
        let mut r = Resolver {
            source: &mut fake,
            mc: "1.21.11",
            chosen: BTreeMap::new(),
            warnings: vec![],
        };
        r.add(root, false).unwrap();
        let p = r.finish().unwrap();
        assert_eq!(p.files.len(), 2);
        assert!(
            p.files
                .iter()
                .any(|(s, _)| s.project_id == "dependency" && s.dependency)
        );
    }
    #[test]
    fn rejects_incompatible_mods_missing_dependencies_and_pinned_version_conflicts() {
        let mut fake = Fake {
            versions: HashMap::new(),
        };
        let mut r = Resolver {
            source: &mut fake,
            mc: "1.21.11",
            chosen: BTreeMap::new(),
            warnings: vec![],
        };
        assert!(
            r.add(version("root", vec![dep("missing", "required")]), false)
                .is_err()
        );
        let mut r = Resolver {
            source: &mut fake,
            mc: "1.21.11",
            chosen: BTreeMap::new(),
            warnings: vec![],
        };
        r.add(version("root", vec![dep("other", "incompatible")]), false)
            .unwrap();
        r.add(version("other", vec![]), false).unwrap();
        assert!(r.finish().is_err());
        let mut r = Resolver {
            source: &mut fake,
            mc: "1.21.11",
            chosen: BTreeMap::new(),
            warnings: vec![],
        };
        r.add(version("root", vec![]), false).unwrap();
        let mut changed = version("root", vec![]);
        changed.id = "different".into();
        assert!(r.add(changed, false).is_err());
    }
    #[test]
    fn approval_is_required_bound_to_version_and_single_use() {
        let store = PlanStore::default();
        let summary = store.insert(plan()).unwrap();
        assert!(store.approve(summary.plan_id, "1.21.11", false).is_err());
        assert!(store.approve(summary.plan_id, "1.18.2", true).is_err());
        assert!(store.approve(summary.plan_id, "1.21.11", true).is_ok());
        assert!(store.approve(summary.plan_id, "1.21.11", true).is_err());
        let summary = store.insert(plan()).unwrap();
        store.0.lock().unwrap().get_mut(&summary.plan_id).unwrap().0 = Instant::now() - TTL;
        assert!(store.approve(summary.plan_id, "1.21.11", true).is_err());
    }
    #[test]
    fn rejects_unsafe_artifacts_and_checks_both_hashes() {
        for url in [
            "http://cdn.modrinth.com/a.jar",
            "https://cdn.modrinth.com.evil.invalid/a.jar",
            "https://evil@cdn.modrinth.com/a.jar",
            "https://api.modrinth.com/a.jar",
        ] {
            let mut f = file(b"test");
            f.url = url.into();
            assert!(valid_file(&f).is_err());
        }
        for filename in ["../evil.jar", "C:/evil.jar", "folder\\evil.jar", "bad.exe"] {
            let mut f = file(b"test");
            f.filename = filename.into();
            assert!(valid_file(&f).is_err());
        }
        let root = std::env::temp_dir().join(format!("patronlauncher-mod-hash-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("mod.jar");
        let mut f = file(b"test");
        f.hashes.sha512 = Some("a".repeat(128));
        assert!(receive(&b"test"[..], &f, &path, &AtomicBool::new(false), |_| {}).is_err());
        assert!(!path.exists());
        assert!(!path.with_extension("part").exists());
        let mut f = file(b"test");
        f.hashes.sha1 = None;
        receive(&b"test"[..], &f, &path, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"test");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cancellation_does_not_publish_profile_or_leave_partial_files() {
        let root =
            std::env::temp_dir().join(format!("patronlauncher-mod-cancel-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let p = crate::model::Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "Test".into(),
            version: "1.21.11".into(),
            loader: crate::model::Loader::Fabric,
            loader_version: Some("0.20.1".into()),
        };
        assert!(install(&root, &p, Some(&plan()), &AtomicBool::new(true), |_| {}).is_err());
        assert!(!root.join("instances").join(p.id.to_string()).exists());
        assert!(
            !root
                .join(".install-staging")
                .join(p.id.to_string())
                .exists()
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "Official Modrinth API/CDN integration; installs only a consented plan into a temporary profile"]
    fn modrinth_live_plan_and_verified_download() {
        let p = preview("1.21.11").unwrap();
        let store = PlanStore::default();
        let summary = store.insert(p).unwrap();
        assert!(summary.mods.iter().any(|m| m.title.contains("Sodium")));
        let p = store.approve(summary.plan_id, "1.21.11", true).unwrap();
        let root =
            std::env::temp_dir().join(format!("patronlauncher-live-mods-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let profile = crate::model::Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "Test".into(),
            version: "1.21.11".into(),
            loader: crate::model::Loader::Fabric,
            loader_version: Some("0.20.1".into()),
        };
        let result = install(&root, &profile, Some(&p), &AtomicBool::new(false), |s| {
            println!("{s}")
        });
        if result.is_ok() {
            for m in &summary.mods {
                assert!(
                    root.join("instances")
                        .join(profile.id.to_string())
                        .join("mods")
                        .join(&m.filename)
                        .is_file()
                );
            }
        }
        fs::remove_dir_all(root).unwrap();
        result.unwrap();
    }
}
