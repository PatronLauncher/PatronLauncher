use crate::{model::Profile, net};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const RETAIN: usize = 10;
const MAX_BACKUP_BYTES: u64 = 256 * 1024 * 1024;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameFolder {
    Root,
    Mods,
    Shaderpacks,
    Schematics,
    Saves,
    Resourcepacks,
    Screenshots,
    Logs,
    Config,
}
impl GameFolder {
    pub const ALL: [Self; 8] = [
        Self::Mods,
        Self::Shaderpacks,
        Self::Schematics,
        Self::Saves,
        Self::Resourcepacks,
        Self::Screenshots,
        Self::Logs,
        Self::Config,
    ];
    pub fn name(self) -> &'static str {
        match self {
            Self::Root => "",
            Self::Mods => "mods",
            Self::Shaderpacks => "shaderpacks",
            Self::Schematics => "schematics",
            Self::Saves => "saves",
            Self::Resourcepacks => "resourcepacks",
            Self::Screenshots => "screenshots",
            Self::Logs => "logs",
            Self::Config => "config",
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Record {
    profile: Profile,
    fingerprint: String,
    files: Vec<String>,
}
pub fn dir(root: &Path, profile: &Profile) -> PathBuf {
    // PClient launcher profillerinden ayrı, kendi klasöründe yaşar.
    if profile.id == crate::pclient::PROFILE_ID {
        return crate::pclient::game_dir(root);
    }
    root.join("instances").join(profile.id.to_string())
}
pub fn ensure_layout(root: &Path, profile: &Profile) -> Result<PathBuf> {
    let base = dir(root, profile);
    fs::create_dir_all(&base)?;
    for folder in GameFolder::ALL {
        fs::create_dir_all(base.join(folder.name()))?;
    }
    Ok(base)
}
pub fn folder(root: &Path, profile: &Profile, folder: GameFolder) -> Result<PathBuf> {
    Ok(ensure_layout(root, profile)?.join(folder.name()))
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::create_dir_all(path.parent().context("Kayıt klasörü yok")?)?;
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn save_metadata(root: &Path, profile: &Profile) -> Result<()> {
    ensure_layout(root, profile)?;
    atomic_write(
        &dir(root, profile).join(crate::migration::PROFILE_META),
        &serde_json::to_vec_pretty(profile)?,
    )
}
pub fn recover(root: &Path) -> Result<Vec<Profile>> {
    let base = root.join("instances");
    if !base.is_dir() {
        return Ok(vec![]);
    }
    let mut result = vec![];
    for entry in fs::read_dir(base)?.flatten() {
        if !entry.file_type()?.is_dir() || entry.file_type()?.is_symlink() {
            continue;
        }
        let Ok(id) = Uuid::parse_str(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        let profile = [
            crate::migration::PROFILE_META,
            crate::migration::LEGACY_PROFILE_META,
        ]
        .into_iter()
        .find_map(|name| {
            fs::read(entry.path().join(name))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Profile>(&bytes).ok())
        });
        let Some(profile) = profile else {
            continue;
        };
        if profile.id == id {
            result.push(profile);
        }
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}
fn setting_path(name: &str) -> bool {
    if name.starts_with("config/") {
        return true;
    }
    !name.contains('/')
        && ((name.starts_with("options") && name.ends_with(".txt"))
            || matches!(
                name,
                "servers.dat" | "servers.dat_old" | "hotbar.nbt" | "realms_persistence.json"
            ))
}
fn walk_config(base: &Path, folder: &Path, files: &mut Vec<String>) -> Result<()> {
    if !folder.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            bail!("Ayar klasöründe bağlantı var; yedekleme güvenli biçimde durduruldu.");
        }
        if kind.is_dir() {
            walk_config(base, &entry.path(), files)?;
        } else if kind.is_file() {
            files.push(
                entry
                    .path()
                    .strip_prefix(base)?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}
fn settings(base: &Path) -> Result<Vec<String>> {
    let mut files = vec![];
    if !base.is_dir() {
        return Ok(files);
    }
    for entry in fs::read_dir(base)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if setting_path(&name) {
            if entry.file_type()?.is_symlink() {
                bail!("Ayar dosyası bağlantı içeriyor.");
            }
            if entry.file_type()?.is_file() {
                files.push(name);
            }
        }
    }
    let config = base.join("config");
    if fs::symlink_metadata(&config).is_ok_and(|m| m.file_type().is_symlink()) {
        bail!("config klasörü bağlantı içeriyor.");
    }
    walk_config(base, &config, &mut files)?;
    files.sort();
    Ok(files)
}
fn backup_dir(root: &Path, profile: &Profile) -> PathBuf {
    root.join("backups").join(profile.id.to_string())
}
fn archives(root: &Path, profile: &Profile) -> Result<Vec<PathBuf>> {
    let base = backup_dir(root, profile);
    if !base.exists() {
        return Ok(vec![]);
    }
    let mut files: Vec<PathBuf> = fs::read_dir(base)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension().is_some_and(|e| e == "zip")
                && p.file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(|s| s.split_once('-'))
                    .is_some_and(|(time, id)| {
                        time.parse::<u128>().is_ok() && Uuid::parse_str(id).is_ok()
                    })
        })
        .collect();
    files.sort();
    Ok(files)
}
fn record(path: &Path) -> Result<Record> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path)?)?;
    let name = if zip.file_names().any(|n| n == crate::migration::BACKUP_META) {
        crate::migration::BACKUP_META
    } else {
        crate::migration::LEGACY_BACKUP_META
    };
    let entry = zip.by_name(name)?;
    Ok(serde_json::from_reader(entry.take(1024 * 1024))?)
}
pub fn snapshot(root: &Path, profile: &Profile) -> Result<Option<PathBuf>> {
    save_metadata(root, profile)?;
    let base = dir(root, profile);
    let files = settings(&base)?;
    if files.is_empty() {
        return Ok(None);
    }
    let mut total = 0u64;
    let mut fingerprint = Sha256::new();
    fingerprint.update(profile.version.as_bytes());
    for name in &files {
        let path = net::safe_join(&base, name)?;
        total += fs::metadata(&path)?.len();
        if total > MAX_BACKUP_BYTES {
            bail!("Ayar yedeği 256 MB sınırını aşıyor. Dosyalarınız değiştirilmedi.");
        }
        fingerprint.update(name.as_bytes());
        fingerprint.update(net::digest_file(&path, true)?.as_bytes());
    }
    let fingerprint = format!("{:x}", fingerprint.finalize());
    if let Some(latest) = archives(root, profile)?.last()
        && record(latest).is_ok_and(|r| r.profile.id == profile.id && r.fingerprint == fingerprint)
    {
        return Ok(Some(latest.clone()));
    }
    let destination = backup_dir(root, profile).join(format!(
        "{}-{}.zip",
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos(),
        Uuid::new_v4()
    ));
    fs::create_dir_all(destination.parent().unwrap())?;
    let temp = destination.with_extension("tmp");
    let result = (|| -> Result<()> {
        let mut writer = zip::ZipWriter::new(fs::File::create(&temp)?);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer.start_file(crate::migration::BACKUP_META, options)?;
        writer.write_all(&serde_json::to_vec(&Record {
            profile: profile.clone(),
            fingerprint,
            files: files.clone(),
        })?)?;
        for name in &files {
            writer.start_file(name, options)?;
            std::io::copy(
                &mut fs::File::open(net::safe_join(&base, name)?)?,
                &mut writer,
            )?;
        }
        writer.finish()?.sync_all()?;
        fs::rename(&temp, &destination)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result?;
    let old = archives(root, profile)?;
    for path in old.iter().take(old.len().saturating_sub(RETAIN)) {
        fs::remove_file(path)?;
    }
    Ok(Some(destination))
}
pub fn latest(root: &Path, profile: &Profile) -> Result<Option<PathBuf>> {
    Ok(archives(root, profile)?.pop())
}
pub fn restore_latest(root: &Path, profile: &Profile) -> Result<()> {
    let backup = latest(root, profile)?.context("Bu profil için ayar yedeği yok.")?;
    let info = record(&backup)?;
    if info.profile.id != profile.id {
        bail!("Yedek başka bir profile ait.");
    }
    let base = dir(root, profile);
    let mut zip = zip::ZipArchive::new(fs::File::open(&backup)?)?;
    let mut restored = vec![];
    let mut total = 0u64;
    let mut fingerprint = Sha256::new();
    fingerprint.update(info.profile.version.as_bytes());
    for name in &info.files {
        if !setting_path(name) {
            bail!("Yedekte beklenmeyen dosya var.");
        }
        let target = net::safe_join(&base, name)?;
        let mut cursor = target.as_path();
        while cursor.starts_with(&base) {
            if fs::symlink_metadata(cursor).is_ok_and(|m| m.file_type().is_symlink()) {
                bail!("Hedef ayar yolu bağlantı içeriyor.");
            }
            let Some(parent) = cursor.parent() else {
                break;
            };
            cursor = parent;
        }
        let mut entry = zip.by_name(name)?;
        total += entry.size();
        if total > MAX_BACKUP_BYTES {
            bail!("Yedek çok büyük.");
        }
        let mut bytes = vec![];
        entry.read_to_end(&mut bytes)?;
        fingerprint.update(name.as_bytes());
        fingerprint.update(format!("{:x}", Sha256::digest(&bytes)).as_bytes());
        restored.push((target, bytes));
    }
    if format!("{:x}", fingerprint.finalize()) != info.fingerprint {
        bail!("Yedek bütünlük kontrolü başarısız; mevcut ayarlar değiştirilmedi.");
    }
    // Protect the current state before replacing any settings. Worlds are untouched.
    snapshot(root, profile)?;
    for (path, bytes) in restored {
        atomic_write(&path, &bytes)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn standard_layout_preserves_existing_profile_files() {
        let root = std::env::temp_dir().join(format!("patronlauncher-layout-{}", Uuid::new_v4()));
        let a = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "Existing".into(),
            version: "26.3".into(),
            loader: Default::default(),
            loader_version: None,
        };
        let b = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "New".into(),
            version: "26.3".into(),
            loader: Default::default(),
            loader_version: None,
        };
        let base = dir(&root, &a);
        fs::create_dir_all(base.join("resourcepacks")).unwrap();
        fs::write(base.join("options.txt"), b"keep my options").unwrap();
        fs::write(base.join("resourcepacks/my-pack.zip"), b"keep my pack").unwrap();
        for _ in 0..2 {
            assert_eq!(ensure_layout(&root, &a).unwrap(), base);
            for target in GameFolder::ALL {
                assert_eq!(folder(&root, &a, target).unwrap(), base.join(target.name()));
                assert!(base.join(target.name()).is_dir());
            }
        }
        ensure_layout(&root, &b).unwrap();
        assert_eq!(
            fs::read(base.join("options.txt")).unwrap(),
            b"keep my options"
        );
        assert_eq!(
            fs::read(base.join("resourcepacks/my-pack.zip")).unwrap(),
            b"keep my pack"
        );
        assert!(!dir(&root, &b).join("options.txt").exists());
        assert!(!dir(&root, &b).join("resourcepacks/my-pack.zip").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn profile_settings_are_isolated_and_recoverable() {
        let root = std::env::temp_dir().join(format!("patronlauncher-profiles-{}", Uuid::new_v4()));
        let a = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "A".into(),
            version: "26.3".into(),
            loader: Default::default(),
            loader_version: None,
        };
        let b = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "B".into(),
            version: "26.3".into(),
            loader: Default::default(),
            loader_version: None,
        };
        save_metadata(&root, &a).unwrap();
        save_metadata(&root, &b).unwrap();
        let options = b"fov:0.7\nkey_key.forward:key.keyboard.i\nsoundCategory_master:0.3\nrenderDistance:20\n";
        fs::write(dir(&root, &a).join("options.txt"), options).unwrap();
        assert!(!dir(&root, &b).join("options.txt").exists());
        fs::write(dir(&root, &b).join("options.txt"), b"fov:0.1\n").unwrap();
        fs::create_dir_all(dir(&root, &a).join("config/controls")).unwrap();
        fs::write(
            dir(&root, &a).join("config/controls/keys.json"),
            b"{\"key\":\"i\"}",
        )
        .unwrap();
        let first = snapshot(&root, &a).unwrap().unwrap();
        assert_eq!(snapshot(&root, &a).unwrap().unwrap(), first);
        fs::write(dir(&root, &a).join("options.txt"), b"fov:1.0\n").unwrap();
        fs::write(dir(&root, &a).join("config/controls/keys.json"), b"changed").unwrap();
        fs::create_dir_all(dir(&root, &a).join("saves/world")).unwrap();
        fs::write(dir(&root, &a).join("saves/world/level.dat"), b"world").unwrap();
        restore_latest(&root, &a).unwrap();
        assert_eq!(
            fs::read(dir(&root, &a).join("options.txt")).unwrap(),
            options
        );
        assert_eq!(
            fs::read(dir(&root, &b).join("options.txt")).unwrap(),
            b"fov:0.1\n"
        );
        assert_eq!(
            fs::read(dir(&root, &a).join("config/controls/keys.json")).unwrap(),
            b"{\"key\":\"i\"}"
        );
        assert_eq!(
            fs::read(dir(&root, &a).join("saves/world/level.dat")).unwrap(),
            b"world"
        );
        assert_eq!(recover(&root).unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn history_keeps_ten_distinct_snapshots() {
        let root = std::env::temp_dir().join(format!("patronlauncher-history-{}", Uuid::new_v4()));
        let profile = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "A".into(),
            version: "26.3".into(),
            loader: Default::default(),
            loader_version: None,
        };
        save_metadata(&root, &profile).unwrap();
        for i in 0..12 {
            fs::write(
                dir(&root, &profile).join("options.txt"),
                format!("fov:{i}\n"),
            )
            .unwrap();
            snapshot(&root, &profile).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert_eq!(archives(&root, &profile).unwrap().len(), RETAIN);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_backup_does_not_overwrite_settings() {
        let root =
            std::env::temp_dir().join(format!("patronlauncher-bad-backup-{}", Uuid::new_v4()));
        let profile = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "A".into(),
            version: "26.3".into(),
            loader: Default::default(),
            loader_version: None,
        };
        save_metadata(&root, &profile).unwrap();
        fs::write(
            dir(&root, &profile).join("options.txt"),
            b"keep these settings",
        )
        .unwrap();
        let folder = backup_dir(&root, &profile);
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(format!("1-{}.zip", Uuid::new_v4()));
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file(crate::migration::BACKUP_META, options)
            .unwrap();
        zip.write_all(
            &serde_json::to_vec(&Record {
                profile: profile.clone(),
                fingerprint: "wrong".into(),
                files: vec!["options.txt".into()],
            })
            .unwrap(),
        )
        .unwrap();
        zip.start_file("options.txt", options).unwrap();
        zip.write_all(b"bad content").unwrap();
        zip.finish().unwrap();
        assert!(restore_latest(&root, &profile).is_err());
        assert_eq!(
            fs::read(dir(&root, &profile).join("options.txt")).unwrap(),
            b"keep these settings"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
#[cfg(test)]
mod legacy_storage_tests {
    use super::*;
    #[test]
    fn restores_legacy_metadata_and_backup_names_without_altering_worlds() {
        let root =
            std::env::temp_dir().join(format!("patronlauncher-legacy-storage-{}", Uuid::new_v4()));
        let profile: Profile = serde_json::from_value(
            serde_json::json!({"id":Uuid::new_v4(),"name":"Existing","version":"1.21.11"}),
        )
        .unwrap();
        let base = ensure_layout(&root, &profile).unwrap();
        fs::write(base.join("options.txt"), b"fov:75").unwrap();
        fs::write(base.join("saves/marker"), b"world").unwrap();
        let backup = snapshot(&root, &profile).unwrap().unwrap();
        let temp = backup.with_extension("rewrite");
        {
            let mut reader = zip::ZipArchive::new(fs::File::open(&backup).unwrap()).unwrap();
            let mut writer = zip::ZipWriter::new(fs::File::create(&temp).unwrap());
            for i in 0..reader.len() {
                let mut entry = reader.by_index(i).unwrap();
                let name = if entry.name() == crate::migration::BACKUP_META {
                    crate::migration::LEGACY_BACKUP_META
                } else {
                    entry.name()
                }
                .to_string();
                writer
                    .start_file(name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                std::io::copy(&mut entry, &mut writer).unwrap();
            }
            writer.finish().unwrap();
        }
        fs::rename(&temp, &backup).unwrap();
        fs::rename(
            base.join(crate::migration::PROFILE_META),
            base.join(crate::migration::LEGACY_PROFILE_META),
        )
        .unwrap();
        assert_eq!(recover(&root).unwrap()[0].id, profile.id);
        fs::write(base.join("options.txt"), b"fov:90").unwrap();
        restore_latest(&root, &profile).unwrap();
        assert_eq!(fs::read(base.join("options.txt")).unwrap(), b"fov:75");
        assert_eq!(fs::read(base.join("saves/marker")).unwrap(), b"world");
        fs::remove_dir_all(root).unwrap();
    }
}
