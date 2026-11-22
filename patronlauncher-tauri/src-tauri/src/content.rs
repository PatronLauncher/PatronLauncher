//! Modrinth kaynak paketi, shader ve veri paketi kurulumu. Dosyalar onaylı CDN'den
//! indirilir, boyut ve SHA özetleri doğrulanır, yalnızca profilin ilgili klasörüne yazılır.
use crate::{model::Profile, modrinth, performance};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    ResourcePack,
    Shader,
    DataPack,
}
impl Kind {
    fn key(self) -> &'static str {
        match self {
            Self::ResourcePack => "resourcepack",
            Self::Shader => "shader",
            Self::DataPack => "datapack",
        }
    }
    pub fn parse(kind: &str) -> Result<Self> {
        Ok(match kind {
            "resourcepack" => Self::ResourcePack,
            "shader" => Self::Shader,
            "datapack" => Self::DataPack,
            _ => bail!("İçerik türü geçersiz."),
        })
    }
    fn project_ok(self, project_type: &str) -> bool {
        match self {
            Self::ResourcePack => project_type == "resourcepack",
            Self::Shader => project_type == "shader",
            // Modrinth veri paketlerini çoğunlukla "mod" türüyle döndürür.
            Self::DataPack => matches!(project_type, "datapack" | "mod"),
        }
    }
    fn version_ok(self, loaders: &[String]) -> bool {
        match self {
            Self::DataPack => loaders.iter().any(|l| l == "datapack"),
            Self::Shader => loaders.iter().any(|l| matches!(l.as_str(), "iris" | "optifine" | "canvas" | "vanilla")),
            Self::ResourcePack => true,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ContentVersion {
    pub id: String,
    pub version_number: String,
    pub version_type: String,
    pub date_published: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
}

fn project_type(project: &str) -> Result<String> {
    modrinth::id(project)?;
    Ok(modrinth::get(&format!("project/{project}"), &[])?["project_type"]
        .as_str()
        .unwrap_or_default()
        .to_string())
}

/// Profilin Minecraft sürümüyle uyumlu sürümler; kararlılar ve yeniler önce.
pub fn versions(kind: Kind, project: &str, mc: &str) -> Result<Vec<ContentVersion>> {
    ensure!(kind.project_ok(&project_type(project)?), "Proje bu içerik türünde değil.");
    let all: Vec<modrinth::Version> =
        serde_json::from_value(modrinth::get(&format!("project/{project}/version"), &[])?)?;
    let mut list: Vec<_> = all
        .into_iter()
        .filter(|v| v.game_versions.iter().any(|g| g == mc) && kind.version_ok(&v.loaders))
        .collect();
    list.sort_by(|a, b| {
        (a.version_type != "release")
            .cmp(&(b.version_type != "release"))
            .then_with(|| b.date_published.cmp(&a.date_published))
    });
    Ok(list
        .into_iter()
        .map(|v| ContentVersion {
            id: v.id,
            version_number: v.version_number,
            version_type: v.version_type,
            date_published: v.date_published,
            game_versions: v.game_versions,
            loaders: v.loaders,
        })
        .collect())
}

fn world_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && name != "."
        && name != ".."
        && !name.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
}
/// İçinde level.dat bulunan dünya klasörleri.
pub fn worlds(root: &Path, profile: &Profile) -> Vec<String> {
    let saves = crate::profiles::dir(root, profile).join("saves");
    let mut names: Vec<String> = fs::read_dir(saves)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()) && e.path().join("level.dat").is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| world_ok(n))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names
}
pub(crate) fn target(root: &Path, profile: &Profile, kind: Kind, world: Option<&str>) -> Result<PathBuf> {
    let base = crate::profiles::dir(root, profile);
    let dir = match kind {
        Kind::ResourcePack => base.join("resourcepacks"),
        Kind::Shader => base.join("shaderpacks"),
        Kind::DataPack => {
            let world = world.context("Veri paketi için bir dünya seç.")?;
            ensure!(world_ok(world), "Dünya adı geçersiz.");
            let saves = base.join("saves").join(world);
            ensure!(saves.join("level.dat").is_file(), "Dünya bulunamadı.");
            saves.join("datapacks")
        }
    };
    for path in [base.as_path(), dir.as_path()] {
        if let Ok(meta) = fs::symlink_metadata(path) {
            ensure!(!meta.file_type().is_symlink(), "Bağlantı klasörü reddedildi.");
        }
    }
    Ok(dir)
}
pub fn installed(root: &Path, profile: &Profile, kind: Kind, world: Option<&str>) -> Vec<String> {
    target(root, profile, kind, world)
        .ok()
        .and_then(|dir| fs::read_dir(dir).ok())
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

pub fn install(
    root: &Path,
    profile: &Profile,
    kind: Kind,
    project: &str,
    version: &str,
    world: Option<&str>,
) -> Result<String> {
    modrinth::id(version)?;
    let v: modrinth::Version = serde_json::from_value(modrinth::get(&format!("version/{version}"), &[])?)?;
    ensure!(v.project_id == project, "Sürüm bu projeye ait değil.");
    ensure!(kind.project_ok(&project_type(project)?), "Proje bu içerik türünde değil.");
    ensure!(kind.version_ok(&v.loaders), "Sürüm bu içerik türü için uygun değil.");
    ensure!(
        v.game_versions.iter().any(|g| *g == profile.version),
        "Bu sürüm profilin Minecraft sürümüyle uyumlu değil."
    );
    let file = v
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| v.files.first())
        .context("Sürümde indirilecek dosya yok.")?
        .clone();
    performance::valid_file_with(&file, &[".zip", ".jar"])?;
    let dir = target(root, profile, kind, world)?;
    fs::create_dir_all(&dir)?;
    let path = dir.join(&file.filename);
    if path.exists() {
        // Aynı dosya zaten varsa yeniden indirilmez; farklıysa üzerine yazılmaz.
        let same = file.hashes.sha1.as_ref().is_some_and(|h| {
            crate::net::digest_file(&path, false).is_ok_and(|d| d.eq_ignore_ascii_case(h))
        });
        ensure!(same, "Aynı adlı farklı bir dosya zaten var: {}", file.filename);
        remember(root, profile, kind, project, version, &file.filename, world);
        return Ok(file.filename);
    }
    let response = performance::client(true)?
        .get(&file.url)
        .send()?
        .error_for_status()?;
    performance::receive_with(response, &file, &path, &AtomicBool::new(false), |_| {}, &[".zip", ".jar"])?;
    remember(root, profile, kind, project, version, &file.filename, world);
    Ok(file.filename)
}

/// Modrinth'ten kurulan içeriklerin kaydı (`content.lock.json`): kütüphanede dosyanın hangi projeye
/// ait olduğunu göstermek için. Yalnızca bilgi amaçlıdır; dosyalar her zaman klasörden okunur.
const INDEX: &str = "content.lock.json";
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Indexed {
    kind: String,
    project_id: String,
    version_id: String,
    filename: String,
    #[serde(default)]
    world: Option<String>,
    #[serde(default)]
    installed_at: u64,
}
fn index_path(root: &Path, profile: &Profile) -> PathBuf {
    crate::profiles::dir(root, profile).join(INDEX)
}
fn read_index(root: &Path, profile: &Profile) -> Vec<Indexed> {
    fs::read(index_path(root, profile))
        .ok()
        .filter(|b| b.len() <= 2 * 1024 * 1024)
        .and_then(|b| serde_json::from_slice::<Vec<Indexed>>(&b).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|e| modrinth::id(&e.project_id).is_ok() && Kind::parse(&e.kind).is_ok())
        .take(5000)
        .collect()
}
fn write_index(root: &Path, profile: &Profile, list: &[Indexed]) {
    if let Ok(bytes) = serde_json::to_vec_pretty(list) {
        let _ = crate::profiles::atomic_write(&index_path(root, profile), &bytes);
    }
}
fn remember(root: &Path, profile: &Profile, kind: Kind, project: &str, version: &str, filename: &str, world: Option<&str>) {
    let mut list = read_index(root, profile);
    list.retain(|e| !(e.kind == kind.key() && e.filename == filename && e.world.as_deref() == world));
    list.push(Indexed {
        kind: kind.key().into(),
        project_id: project.into(),
        version_id: version.into(),
        filename: filename.into(),
        world: world.map(str::to_string),
        installed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    });
    write_index(root, profile, &list);
}

/// Kütüphanede gösterilen bir dosya: mod, shader, kaynak paketi ya da veri paketi.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct LibraryItem {
    pub kind: &'static str,
    pub filename: String,
    pub world: Option<String>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub enabled: bool,
    /// Modlarda: launcher'ın mod manifestinde mi (kaldırma/devre dışı bırakma yalnızca bunlarda).
    pub managed: bool,
    pub size: u64,
    /// Kurulum ya da son değişiklik zamanı (Unix saniye).
    pub added: u64,
}
fn stamp(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
fn entries(dir: &Path) -> Vec<(String, fs::Metadata)> {
    let Ok(meta) = fs::symlink_metadata(dir) else { return vec![] };
    if meta.file_type().is_symlink() {
        return vec![];
    }
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| Some((e.file_name().into_string().ok()?, e.metadata().ok()?)))
        .filter(|(name, _)| !name.starts_with('.'))
        .collect()
}
/// Profilde kurulu tüm içerik. Modlar `mods.lock.json` ve mods klasöründen, diğerleri kendi klasörlerinden.
pub fn library(root: &Path, profile: &Profile) -> Vec<LibraryItem> {
    let mut out = Vec::new();
    if let Ok(dir) = crate::mods::directory(root, profile)
        && let Ok(manifest) = crate::mods::read(&dir)
    {
        let found: std::collections::HashMap<_, _> = entries(&dir.join("mods")).into_iter().collect();
        let mut known = std::collections::HashSet::new();
        for e in manifest.entries {
            let file = if e.enabled { e.filename.clone() } else { format!("{}.disabled", e.filename) };
            known.insert(file.clone());
            let Some(meta) = found.get(&file) else { continue };
            out.push(LibraryItem {
                kind: "mod",
                filename: e.filename,
                world: None,
                project_id: Some(e.project_id),
                version_id: Some(e.version_id),
                enabled: e.enabled,
                managed: true,
                size: meta.len(),
                added: if e.installed_at > 0 { e.installed_at } else { stamp(meta) },
            });
        }
        for (name, meta) in &found {
            if known.contains(name) || !(name.ends_with(".jar") || name.ends_with(".jar.disabled")) {
                continue;
            }
            out.push(LibraryItem {
                kind: "mod",
                filename: name.trim_end_matches(".disabled").to_string(),
                world: None,
                project_id: None,
                version_id: None,
                enabled: !name.ends_with(".disabled"),
                managed: false,
                size: meta.len(),
                added: stamp(meta),
            });
        }
    }
    let index = read_index(root, profile);
    let mut push = |kind: Kind, world: Option<String>| {
        let Ok(dir) = target(root, profile, kind, world.as_deref()) else { return };
        for (name, meta) in entries(&dir) {
            if !(meta.is_dir() || name.ends_with(".zip") || name.ends_with(".jar")) {
                continue;
            }
            let known = index
                .iter()
                .find(|e| e.kind == kind.key() && e.filename == name && e.world == world);
            out.push(LibraryItem {
                kind: kind.key(),
                world: world.clone(),
                project_id: known.map(|e| e.project_id.clone()),
                version_id: known.map(|e| e.version_id.clone()),
                enabled: true,
                managed: true,
                size: if meta.is_dir() { 0 } else { meta.len() },
                added: known.map(|e| e.installed_at).filter(|t| *t > 0).unwrap_or_else(|| stamp(&meta)),
                filename: name,
            });
        }
    };
    push(Kind::ResourcePack, None);
    push(Kind::Shader, None);
    for world in worlds(root, profile) {
        push(Kind::DataPack, Some(world));
    }
    out
}

fn file_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('.')
        && !name.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
}
/// Kaynak paketi, shader ya da veri paketi dosyasını siler (modlar `mods::remove` ile kaldırılır).
pub fn remove(root: &Path, profile: &Profile, kind: Kind, filename: &str, world: Option<&str>) -> Result<()> {
    ensure!(file_ok(filename), "Dosya adı geçersiz.");
    let path = target(root, profile, kind, world)?.join(filename);
    let meta = fs::symlink_metadata(&path).context("Dosya bulunamadı.")?;
    ensure!(!meta.file_type().is_symlink(), "Bağlantı dosyası reddedildi.");
    if meta.is_dir() {
        fs::remove_dir_all(&path)?;
    } else {
        fs::remove_file(&path)?;
    }
    let mut list = read_index(root, profile);
    let before = list.len();
    list.retain(|e| !(e.kind == kind.key() && e.filename == filename && e.world.as_deref() == world));
    if list.len() != before {
        write_index(root, profile, &list);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kinds_and_world_names_are_validated() {
        assert!(Kind::parse("mod").is_err());
        assert!(Kind::DataPack.project_ok("mod") && !Kind::ResourcePack.project_ok("mod"));
        assert!(Kind::DataPack.version_ok(&["datapack".into()]));
        assert!(!Kind::DataPack.version_ok(&["fabric".into()]));
        assert!(Kind::Shader.version_ok(&["iris".into()]));
        for bad in ["", "..", "a/b", "a\\b", "c:", "x\u{1}"] {
            assert!(!world_ok(bad), "{bad:?}");
        }
        assert!(world_ok("Yeni Dünya (2)"));
        for bad in ["", ".hidden", "a/b", "..\\x", "c:x", "a\u{0}"] {
            assert!(!file_ok(bad), "{bad:?}");
        }
        assert!(file_ok("BSL_v9.0.zip"));
    }
}
