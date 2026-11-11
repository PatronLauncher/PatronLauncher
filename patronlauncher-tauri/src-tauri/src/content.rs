//! Modrinth kaynak paketi, shader ve veri paketi kurulumu. Dosyalar onaylı CDN'den
//! indirilir, boyut ve SHA özetleri doğrulanır, yalnızca profilin ilgili klasörüne yazılır.
use crate::{model::Profile, modrinth, performance};
use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
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
        return Ok(file.filename);
    }
    let response = performance::client(true)?
        .get(&file.url)
        .send()?
        .error_for_status()?;
    performance::receive_with(response, &file, &path, &AtomicBool::new(false), |_| {}, &[".zip", ".jar"])?;
    Ok(file.filename)
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
    }
}
