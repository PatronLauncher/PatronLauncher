//! CurseForge Core API: arama, proje ayrıntısı, dosyalar ve doğrulanmış kurulum.
//! Anahtar önce Windows Kimlik Bilgisi Yöneticisi'nden, yoksa derlemeye gömülü
//! değerden okunur; arayüze hiçbir zaman gönderilmez.
use crate::{content, model::Profile, mods, performance};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    fs,
    io::{Read, Write},
    path::Path,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const GAME: u32 = 432;
const SERVICE: &str = "PatronLauncher.CurseForge";
const USER: &str = "api-key";
const FABRIC: u32 = 4;
/// CurseForge modLoaderType ve dosya etiketleri.
fn loader_type(loader: crate::model::Loader) -> Option<(u32, &'static [&'static str])> {
    use crate::model::Loader;
    match loader {
        Loader::Fabric => Some((4, &["fabric"])),
        Loader::Quilt => Some((5, &["quilt", "fabric"])),
        Loader::Forge => Some((1, &["forge"])),
        Loader::NeoForge => Some((6, &["neoforge"])),
        _ => None,
    }
}
const MAX_MODS: usize = 40;
const MAX_FILE: u64 = 128 * 1024 * 1024;
const MAX_PLAN: u64 = 512 * 1024 * 1024;

pub fn class(kind: &str) -> Result<u32> {
    Ok(match kind {
        "mod" => 6,
        "resourcepack" => 12,
        "shader" => 6552,
        "datapack" => 6945,
        "modpack" => 4471,
        _ => bail!("İçerik türü geçersiz."),
    })
}

fn entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, USER)?)
}
fn stored_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}
fn bundled_key() -> Option<&'static str> {
    option_env!("PATRONLAUNCHER_CURSEFORGE_KEY").filter(|k| !k.trim().is_empty())
}
fn key() -> Result<String> {
    stored_key()
        .or_else(|| bundled_key().map(str::to_string))
        .context("CurseForge API anahtarı ayarlanmadı. Ayarlar › Gelişmiş bölümünden ekleyin.")
}
/// "user": kullanıcı anahtarı, "bundled": derlemeye gömülü, "missing": yok.
pub fn key_status() -> &'static str {
    if stored_key().is_some() {
        "user"
    } else if bundled_key().is_some() {
        "bundled"
    } else {
        "missing"
    }
}
fn key_format_ok(key: &str) -> bool {
    (20..=200).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_graphic())
}
pub fn set_key(key: &str) -> Result<()> {
    let key = key.trim();
    ensure!(key_format_ok(key), "API anahtarı biçimi geçersiz.");
    request_with(key, "games/432", &[]).context("Anahtar CurseForge tarafından doğrulanamadı")?;
    entry()?.set_password(key)?;
    clear_cache();
    Ok(())
}
pub fn clear_key() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            clear_cache();
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

type Cache = Mutex<HashMap<String, (Instant, Value)>>;
static CACHE: OnceLock<Cache> = OnceLock::new();
fn clear_cache() {
    if let Ok(mut c) = CACHE.get_or_init(Default::default).lock() {
        c.clear();
    }
}
fn api_client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .https_only(true)
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}
fn request_with(key: &str, path: &str, query: &[(&str, String)]) -> Result<Value> {
    let mut url = reqwest::Url::parse("https://api.curseforge.com/v1/")?.join(path)?;
    ensure!(url.host_str() == Some("api.curseforge.com"), "CurseForge adresi reddedildi.");
    url.query_pairs_mut()
        .extend_pairs(query.iter().map(|(k, v)| (*k, v.as_str())));
    let response = api_client()?
        .get(url)
        .header("x-api-key", key)
        .header("Accept", "application/json")
        .send()
        .context("CurseForge bağlantısı kurulamadı")?;
    match response.status().as_u16() {
        403 | 401 => bail!("CurseForge API anahtarı geçersiz veya yetkisiz."),
        404 => bail!("CurseForge içeriği bulunamadı."),
        429 => bail!("CurseForge istek sınırına ulaşıldı. Biraz sonra tekrar deneyin."),
        _ => {}
    }
    let response = response.error_for_status()?;
    let mut bytes = Vec::new();
    response.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 8 * 1024 * 1024, "CurseForge yanıtı çok büyük.");
    Ok(serde_json::from_slice(&bytes)?)
}
fn get(path: &str, query: &[(&str, String)]) -> Result<Value> {
    let cache_key = format!("{path}?{query:?}");
    let cache = CACHE.get_or_init(Default::default);
    if let Ok(c) = cache.lock()
        && let Some((at, v)) = c.get(&cache_key)
        && at.elapsed() < Duration::from_secs(120)
    {
        return Ok(v.clone());
    }
    let value = request_with(&key()?, path, query)?;
    if let Ok(mut c) = cache.lock() {
        if c.len() >= 128 {
            c.clear();
        }
        c.insert(cache_key, (Instant::now(), value.clone()));
    }
    Ok(value)
}

fn version_ok(v: &str) -> bool {
    (1..=32).contains(&v.len()) && v.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Search {
    pub kind: String,
    pub query: String,
    pub sort: String,
    pub category: Option<u32>,
    pub game_version: Option<String>,
    pub fabric: bool,
    #[serde(default)]
    pub loader: Option<crate::model::Loader>,
    pub index: u32,
    pub page_size: u32,
}
pub fn search(s: Search) -> Result<Value> {
    ensure!(
        s.query.chars().count() <= 100 && (1..=50).contains(&s.page_size) && s.index <= 9_950,
        "Arama sınırları geçersiz."
    );
    let sort = match s.sort.as_str() {
        "popularity" => 2,
        "updated" => 3,
        "name" => 4,
        "downloads" => 6,
        "newest" => 11,
        _ => bail!("Sıralama geçersiz."),
    };
    let class = class(&s.kind)?;
    let mut query = vec![
        ("gameId", GAME.to_string()),
        ("classId", class.to_string()),
        ("searchFilter", s.query),
        ("sortField", sort.to_string()),
        ("sortOrder", if sort == 4 { "asc" } else { "desc" }.to_string()),
        ("index", s.index.to_string()),
        ("pageSize", s.page_size.to_string()),
    ];
    if let Some(v) = s.game_version {
        ensure!(version_ok(&v), "Oyun sürümü geçersiz.");
        query.push(("gameVersion", v));
    }
    if class == 6 {
        match s.loader.and_then(loader_type) {
            Some((kind, _)) => query.push(("modLoaderType", kind.to_string())),
            None if s.fabric => query.push(("modLoaderType", FABRIC.to_string())),
            None => {}
        }
    }
    if let Some(c) = s.category {
        query.push(("categoryId", c.to_string()));
    }
    get("mods/search", &query)
}
pub fn categories(kind: &str) -> Result<Value> {
    let class = class(kind)?;
    get(
        "categories",
        &[("gameId", GAME.to_string()), ("classId", class.to_string())],
    )
}
pub fn project(id: u32) -> Result<Value> {
    let project = get(&format!("mods/{id}"), &[])?;
    ensure!(project["data"]["gameId"] == GAME, "Bu içerik Minecraft için değil.");
    let description = get(&format!("mods/{id}/description"), &[])
        .map(|v| v["data"].clone())
        .unwrap_or(Value::Null);
    Ok(json!({"project": project["data"], "description": description}))
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hash {
    pub value: String,
    pub algo: u32,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub mod_id: u32,
    pub relation_type: u32,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfFile {
    pub id: u32,
    pub mod_id: u32,
    pub display_name: String,
    pub file_name: String,
    pub file_length: u64,
    pub release_type: u32,
    pub file_date: String,
    pub game_versions: Vec<String>,
    pub download_url: Option<String>,
    #[serde(default)]
    pub hashes: Vec<Hash>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
    #[serde(default = "available")]
    pub is_available: bool,
}
fn available() -> bool {
    true
}
impl CfFile {
    fn sha1(&self) -> Option<String> {
        self.hashes
            .iter()
            .find(|h| h.algo == 1 && h.value.len() == 40 && h.value.bytes().all(|b| b.is_ascii_hexdigit()))
            .map(|h| h.value.to_ascii_lowercase())
    }
}
/// Sürüme (ve modlarda Fabric'e) uyan dosyalar; kararlılar ve yeniler önce.
pub fn files(id: u32, mc: &str, loader: Option<crate::model::Loader>) -> Result<Vec<CfFile>> {
    ensure!(version_ok(mc), "Oyun sürümü geçersiz.");
    let mut query = vec![("gameVersion", mc.to_string()), ("pageSize", "50".to_string())];
    let tags: &[&str] = match loader {
        Some(l) => {
            let (kind, tags) = loader_type(l).context("Bu profil mod desteklemiyor.")?;
            if kind != 5 {
                query.push(("modLoaderType", kind.to_string()));
            }
            tags
        }
        None => &[],
    };
    let list: Vec<CfFile> = serde_json::from_value(get(&format!("mods/{id}/files"), &query)?["data"].clone())?;
    let mut list: Vec<_> = list
        .into_iter()
        .filter(|f| {
            f.is_available
                && f.mod_id == id
                && f.game_versions.iter().any(|g| g == mc)
                && (tags.is_empty() || f.game_versions.iter().any(|g| tags.iter().any(|t| g.eq_ignore_ascii_case(t))))
        })
        .collect();
    list.sort_by(|a, b| a.release_type.cmp(&b.release_type).then_with(|| b.file_date.cmp(&a.file_date)));
    Ok(list)
}
fn file(project: u32, file: u32) -> Result<CfFile> {
    let f: CfFile = serde_json::from_value(get(&format!("mods/{project}/files/{file}"), &[])?["data"].clone())?;
    ensure!(f.mod_id == project, "Dosya bu projeye ait değil.");
    Ok(f)
}

fn download_ok(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
            && matches!(u.host_str(), Some("edge.forgecdn.net" | "mediafilez.forgecdn.net"))
    })
}
/// CurseForge dosyasını performans/mod denetimlerinin beklediği biçime çevirir.
fn as_file(name: &str, f: &CfFile, extensions: &[&str]) -> Result<performance::File> {
    let url = f.download_url.clone().filter(|u| download_ok(u)).with_context(|| {
        format!("{name}: yazarı başka launcher'lardan indirmeye izin vermiyor; CurseForge sitesinden indirin.")
    })?;
    let sha1 = f.sha1().with_context(|| format!("{name}: SHA-1 özeti eksik."))?;
    ensure!(f.file_length > 0 && f.file_length <= MAX_FILE, "{name}: dosya boyutu geçersiz.");
    // Ad ve özet denetimleri Modrinth dosyalarıyla aynıdır; adres ayrıca doğrulandı.
    performance::valid_file_with(
        &performance::File {
            filename: f.file_name.clone(),
            url: "https://cdn.modrinth.com/validated".into(),
            size: f.file_length,
            primary: true,
            hashes: performance::Hashes { sha1: Some(sha1.clone()), sha512: None },
        },
        extensions,
    )
    .with_context(|| format!("{name}: dosya adı güvenli değil."))?;
    Ok(performance::File {
        filename: f.file_name.clone(),
        url,
        size: f.file_length,
        primary: true,
        hashes: performance::Hashes { sha1: Some(sha1), sha512: None },
    })
}
fn download(f: &performance::File, target: &Path, cancel: &AtomicBool, mut progress: impl FnMut(u64)) -> Result<()> {
    ensure!(download_ok(&f.url), "İndirme adresi onaylı CurseForge CDN'inde değil.");
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 || !download_ok(a.url().as_str()) {
                a.error("CurseForge yönlendirmesi reddedildi")
            } else {
                a.follow()
            }
        }))
        .build()?;
    let mut response = client.get(&f.url).send()?.error_for_status()?;
    let part = target.with_extension("part");
    let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&part)?;
    let result = (|| -> Result<()> {
        let mut hash = Sha1::new();
        let mut total = 0u64;
        let mut buf = [0u8; 65536];
        loop {
            ensure!(!cancel.load(Ordering::Relaxed), "İşlem iptal edildi.");
            let n = response.read(&mut buf)?;
            if n == 0 {
                break;
            }
            total += n as u64;
            ensure!(total <= f.size, "Dosya beklenen boyutu aşıyor.");
            out.write_all(&buf[..n])?;
            hash.update(&buf[..n]);
            progress(total);
        }
        ensure!(total == f.size, "Dosya eksik indirildi.");
        let digest = format!("{:x}", hash.finalize());
        ensure!(
            f.hashes.sha1.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(&digest)),
            "Dosya sağlama toplamı doğrulanamadı."
        );
        out.sync_all()?;
        Ok(())
    })();
    drop(out);
    if result.is_err() {
        let _ = fs::remove_file(&part);
        return result;
    }
    fs::rename(&part, target)?;
    Ok(())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default()
}
fn cf_id(id: u32) -> String {
    format!("cf-{id}")
}

/// Seçilen mod ve zorunlu bağımlılıkları için kurulum planı. Kurulu olanlar atlanır.
pub fn plan(p: &Profile, dir: &Path, project: u32, chosen: Option<u32>) -> Result<mods::Plan> {
    mods::supports(p)?;
    let before = mods::raw(dir)?;
    let manifest = mods::read(dir)?;
    let mut installed = Vec::new();
    let mut promote = Vec::new();
    let mut entries = Vec::new();
    let mut files_out = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = BTreeSet::new();
    let mut queue = VecDeque::from([(project, chosen, true)]);
    while let Some((id, explicit, root)) = queue.pop_front() {
        if !seen.insert(id) {
            continue;
        }
        ensure!(seen.len() <= MAX_MODS, "Bağımlılık sayısı sınırı aşıldı.");
        if let Some(e) = manifest.entries.iter().find(|e| e.project_id == cf_id(id)) {
            installed.push(e.clone());
            if root {
                promote.push(e.project_id.clone());
            }
            continue;
        }
        let info = &get(&format!("mods/{id}"), &[])?["data"];
        let name = info["name"].as_str().unwrap_or("Mod").to_string();
        ensure!(info["classId"] == 6, "{name} bir mod değil.");
        let f = match explicit {
            Some(file_id) => file(id, file_id)?,
            None => files(id, &p.version, Some(p.loader))?
                .into_iter()
                .next()
                .with_context(|| {
                    format!("{name}: Minecraft {} ve {} için uyumlu dosya yok.", p.version, crate::loaders::name(p.loader))
                })?,
        };
        let tags = loader_type(p.loader).map(|(_, t)| t).unwrap_or(&[]);
        ensure!(
            f.game_versions.iter().any(|g| *g == p.version)
                && f.game_versions.iter().any(|g| tags.iter().any(|t| g.eq_ignore_ascii_case(t))),
            "{name}: seçilen dosya bu profille uyumlu değil."
        );
        if f.release_type != 1 {
            warnings.push(format!("{name}: kararlı olmayan sürüm ({})", f.display_name));
        }
        let file = as_file(&name, &f, &[".jar"])?;
        let requires: Vec<String> = f
            .dependencies
            .iter()
            .filter(|d| d.relation_type == 3)
            .map(|d| cf_id(d.mod_id))
            .collect();
        for d in f.dependencies.iter().filter(|d| d.relation_type == 3) {
            queue.push_back((d.mod_id, None, false));
        }
        entries.push(mods::Entry {
            project_id: cf_id(id),
            version_id: cf_id(f.id),
            filename: f.file_name.clone(),
            sha512: None,
            sha1: file.hashes.sha1.clone(),
            installed_at: now(),
            user_selected: root,
            enabled: true,
            requires,
            incompatible: f
                .dependencies
                .iter()
                .filter(|d| d.relation_type == 5)
                .map(|d| cf_id(d.mod_id))
                .collect(),
        });
        files_out.push(file);
    }
    let total_bytes: u64 = files_out.iter().map(|f| f.size).sum();
    ensure!(total_bytes <= MAX_PLAN, "Kurulum boyutu sınırı aşıldı.");
    ensure!(!entries.is_empty() || !installed.is_empty(), "Kurulacak dosya yok.");
    Ok(mods::Plan {
        installed,
        promote,
        id: Uuid::new_v4(),
        profile: p.id,
        mc: p.version.clone(),
        loader_version: p.loader_version.clone(),
        entries,
        warnings,
        total_bytes,
        files: files_out,
        before,
    })
}
pub fn install(
    root: &Path,
    p: &Profile,
    plan: mods::Plan,
    cancel: &AtomicBool,
    notify: &dyn Fn(String),
    progress: &dyn Fn(mods::Progress),
) -> Result<()> {
    let dir = mods::directory(root, p)?;
    let mut completed = 0;
    mods::install_with(&dir, p, &plan, cancel, |f, target| {
        notify(format!("CurseForge'dan indiriliyor: {}", f.filename));
        download(f, target, cancel, |n| {
            progress(mods::Progress {
                profile_id: p.id,
                filename: f.filename.clone(),
                file_bytes: n,
                file_total: f.size,
                completed_bytes: completed + n,
                total_bytes: plan.total_bytes,
            })
        })?;
        completed += f.size;
        Ok(())
    })
}

/// Kaynak paketi, shader veya veri paketini profilin ilgili klasörüne kurar.
pub fn install_content(
    root: &Path,
    p: &Profile,
    kind: content::Kind,
    kind_name: &str,
    project: u32,
    file_id: u32,
    world: Option<&str>,
) -> Result<String> {
    let info = &get(&format!("mods/{project}"), &[])?["data"];
    ensure!(info["classId"] == class(kind_name)?, "Proje bu içerik türünde değil.");
    let name = info["name"].as_str().unwrap_or("Paket").to_string();
    let f = file(project, file_id)?;
    ensure!(
        f.game_versions.iter().any(|g| *g == p.version),
        "Bu dosya profilin Minecraft sürümüyle uyumlu değil."
    );
    let file = as_file(&name, &f, &[".zip", ".jar"])?;
    let dir = content::target(root, p, kind, world)?;
    fs::create_dir_all(&dir)?;
    let path = dir.join(&file.filename);
    if path.exists() {
        let same = crate::net::digest_file(&path, false)
            .is_ok_and(|d| file.hashes.sha1.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(&d)));
        ensure!(same, "Aynı adlı farklı bir dosya zaten var: {}", file.filename);
        return Ok(file.filename);
    }
    download(&file, &path, &AtomicBool::new(false), |_| {})?;
    Ok(file.filename)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classes_hosts_and_keys_are_constrained() {
        assert_eq!(class("mod").unwrap(), 6);
        assert_eq!(class("shader").unwrap(), 6552);
        assert!(class("plugin").is_err());
        assert!(download_ok("https://edge.forgecdn.net/files/1/2/a.jar"));
        for bad in [
            "http://edge.forgecdn.net/a.jar",
            "https://edge.forgecdn.net.evil.test/a.jar",
            "https://user@edge.forgecdn.net/a.jar",
            "https://edge.forgecdn.net:444/a.jar",
            "https://cdn.modrinth.com/a.jar",
        ] {
            assert!(!download_ok(bad), "{bad}");
        }
        assert!(!key_format_ok("short"));
        assert!(!key_format_ok("has space inside the api key value"));
        assert!(key_format_ok("$2a$10$abcdefghijklmnopqrstuv"));
    }
    #[test]
    fn files_require_cdn_url_and_sha1() {
        let mut f = CfFile {
            id: 1,
            mod_id: 2,
            display_name: "x".into(),
            file_name: "sodium-fabric-0.8.13+mc1.21.1.jar".into(),
            file_length: 10,
            release_type: 1,
            file_date: String::new(),
            game_versions: vec!["1.21.1".into(), "Fabric".into()],
            download_url: Some("https://edge.forgecdn.net/files/1/2/sodium.jar".into()),
            hashes: vec![Hash { value: "a".repeat(40), algo: 1 }],
            dependencies: vec![],
            is_available: true,
        };
        assert!(as_file("Sodium", &f, &[".jar"]).is_ok());
        f.download_url = None;
        assert!(format!("{:#}", as_file("Sodium", &f, &[".jar"]).unwrap_err()).contains("izin vermiyor"));
        f.download_url = Some("https://edge.forgecdn.net/files/1/2/sodium.jar".into());
        f.hashes.clear();
        assert!(as_file("Sodium", &f, &[".jar"]).is_err());
    }
}
