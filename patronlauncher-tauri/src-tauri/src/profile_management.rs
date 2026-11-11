//! Profile management helpers. User worlds are copied, never moved or removed.
use crate::{
    game::Version,
    model::{Loader, Profile},
    net, profiles,
};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
const RECEIPT: &str = ".patronlauncher-install.json";
#[derive(Serialize, Deserialize)]
struct Installation {
    version: String,
    sha1: String,
    loader: Loader,
    loader_version: Option<String>,
}
pub fn record_install(root: &Path, p: &Profile, v: &Version) -> Result<()> {
    profiles::atomic_write(
        &profiles::dir(root, p).join(RECEIPT),
        &serde_json::to_vec(&Installation {
            version: p.version.clone(),
            sha1: v.sha1.clone(),
            loader: p.loader,
            loader_version: p.loader_version.clone(),
        })?,
    )
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InstallStatus {
    Installed,
    NotInstalled,
    UpdateAvailable,
}
pub fn status(root: &Path, p: &Profile, versions: &[Version]) -> InstallStatus {
    use InstallStatus::*;
    let Ok(dir) = net::safe_join(&root.join("minecraft/versions"), &p.version) else {
        return NotInstalled;
    };
    let Ok(bytes) = fs::read(dir.join(format!("{}.json", p.version))) else {
        return NotInstalled;
    };
    let Ok(jar) = fs::metadata(dir.join(format!("{}.jar", p.version))) else {
        return NotInstalled;
    };
    if !jar.is_file() || jar.len() == 0 {
        return NotInstalled;
    }
    if let Some(v) = versions.iter().find(|v| v.id == p.version) {
        if format!("{:x}", Sha1::digest(&bytes)) != v.sha1 {
            return UpdateAvailable;
        }
    }
    let Ok(mut meta) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return UpdateAvailable;
    };
    if meta["downloads"]["client"]["size"]
        .as_u64()
        .is_some_and(|s| jar.len() != s)
    {
        return UpdateAvailable;
    }
    if p.loader != Loader::Vanilla {
        let Some(loader) = &p.loader_version else {
            return NotInstalled;
        };
        let Ok((_, raw)) = crate::loaders::child(root, p.loader, &p.version, loader) else {
            return NotInstalled;
        };
        let Ok(merged) = crate::loaders::merge(p.loader, &meta, &raw, &p.version) else {
            return UpdateAvailable;
        };
        meta = merged;
    }
    // Presence checks are deliberately cheap; every download is checksum-verified
    // by game::install/launch before use. No network or full-JAR hashing in the UI.
    if let Some(libs) = meta["libraries"].as_array() {
        for lib in libs {
            if !crate::game::allowed(lib.get("rules")) {
                continue;
            }
            if let Some(path) = lib["downloads"]["artifact"]["path"].as_str() {
                if !net::safe_join(&root.join("minecraft/libraries"), path)
                    .is_ok_and(|p| p.is_file())
                {
                    return NotInstalled;
                }
            }
        }
    }
    if let Some(id) = meta["assetIndex"]["id"].as_str() {
        if !net::safe_join(
            &root.join("minecraft/assets/indexes"),
            &format!("{id}.json"),
        )
        .is_ok_and(|p| p.is_file())
        {
            return NotInstalled;
        }
    }
    if let Some(v) = versions.iter().find(|v| v.id == p.version) {
        if !crate::store::installed(root, &crate::store::Combination::of(p), v) {
            return NotInstalled;
        }
    }
    Installed
}
fn copy_tree(source: &Path, target: &Path, cancel: &AtomicBool) -> Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            bail!("Bağlantılı dosyalar kopyalanamaz.")
        }
    }
    if metadata.is_symlink() {
        bail!("Sembolik bağlantılar kopyalanamaz.")
    }
    if cancel.load(Ordering::Relaxed) {
        bail!("İşlem iptal edildi.")
    }
    if metadata.is_dir() {
        fs::create_dir(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &target.join(entry.file_name()), cancel)?;
        }
    } else if metadata.is_file() {
        let mut input = fs::File::open(source)?;
        let mut output = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(target)?;
        let mut buffer = [0u8; 65536];
        loop {
            if cancel.load(Ordering::Relaxed) {
                bail!("İşlem iptal edildi.")
            }
            let len = input.read(&mut buffer)?;
            if len == 0 {
                break;
            }
            output.write_all(&buffer[..len])?;
        }
        output.sync_all()?;
    } else {
        bail!("Özel dosyalar kopyalanamaz.")
    }
    Ok(())
}
pub fn duplicate(
    root: &Path,
    source: &Profile,
    name: String,
    cancel: &AtomicBool,
) -> Result<Profile> {
    let profile = Profile {
        kind: crate::model::ProfileKind::Custom,
        id: uuid::Uuid::new_v4(),
        name,
        ..source.clone()
    };
    let parent = root.join("instances");
    fs::create_dir_all(&parent)?;
    let stage = parent.join(format!(".copy-{}", profile.id));
    let source_dir = profiles::dir(root, source);
    let result = (|| {
        if source_dir.try_exists()? {
            copy_tree(&source_dir, &stage, cancel)?;
        } else {
            fs::create_dir(&stage)?;
        }
        if cancel.load(Ordering::Relaxed) {
            bail!("İşlem iptal edildi.")
        }
        // Replace copied identity before publication; source metadata is untouched.
        profiles::atomic_write(
            &stage.join(crate::migration::PROFILE_META),
            &serde_json::to_vec_pretty(&profile)?,
        )?;
        fs::rename(&stage, profiles::dir(root, &profile))?;
        Ok(profile)
    })();
    if result.is_err() && stage.is_dir() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copy_has_new_identity_keeps_loader_and_never_changes_worlds() {
        let root = std::env::temp_dir().join(format!("profile-copy-{}", uuid::Uuid::new_v4()));
        let p = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: uuid::Uuid::new_v4(),
            name: "Source".into(),
            version: "1.21.11".into(),
            loader: Loader::Fabric,
            loader_version: Some("0.20.1".into()),
        };
        let dir = profiles::dir(&root, &p);
        fs::create_dir_all(dir.join("saves/World")).unwrap();
        fs::write(dir.join("saves/World/level.dat"), b"world-data").unwrap();
        fs::write(dir.join("options.txt"), b"fov:0.7").unwrap();
        let cloned = duplicate(&root, &p, "Copy".into(), &AtomicBool::new(false)).unwrap();
        assert_ne!(cloned.id, p.id);
        assert_eq!(cloned.loader, Loader::Fabric);
        assert_eq!(cloned.loader_version, p.loader_version);
        assert_eq!(
            fs::read(profiles::dir(&root, &cloned).join("saves/World/level.dat")).unwrap(),
            b"world-data"
        );
        fs::write(
            profiles::dir(&root, &cloned).join("options.txt"),
            b"changed",
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("options.txt")).unwrap(), b"fov:0.7");
        let count = fs::read_dir(root.join("instances")).unwrap().count();
        assert!(duplicate(&root, &p, "Cancelled".into(), &AtomicBool::new(true)).is_err());
        assert_eq!(fs::read_dir(root.join("instances")).unwrap().count(), count);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn install_status_distinguishes_missing_installed_and_changed_manifest() {
        let (root, p, mut v) = crate::store::tests::fixture();
        assert_eq!(status(&root, &p, &[v.clone()]), InstallStatus::Installed);
        record_install(&root, &p, &v).unwrap();
        v.sha1 = "a".repeat(40);
        assert_eq!(status(&root, &p, &[v]), InstallStatus::UpdateAvailable);
        fs::remove_dir_all(root).unwrap();
    }
}
