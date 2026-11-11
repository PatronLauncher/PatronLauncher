//! Verified, non-destructive first-run data and credential migration.
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
};
use uuid::Uuid;
pub const APP_NAME: &str = "PatronLauncher";
pub const DATA_DIR_NAME: &str = "#PatronLauncher";
pub const CREDENTIAL_SERVICE: &str = "PatronLauncher.Microsoft";
pub const PROFILE_META: &str = ".patronlauncher-profile.json";
pub const BACKUP_META: &str = ".patronlauncher-backup.json";
// These compatibility identifiers must remain literal to locate existing user data.
pub const LEGACY_APP_NAME: &str = "PLauncher";
pub const LEGACY_CREDENTIAL_SERVICE: &str = "PLauncher.Microsoft";
pub const LEGACY_DATA_ENV: &str = "PLAUNCHER_DATA_DIR";
pub const LEGACY_PROFILE_META: &str = ".plauncher-profile.json";
pub const LEGACY_BACKUP_META: &str = ".plauncher-backup.json";
const MARKER: &str = ".patronlauncher-data-migration-v2.json";

pub fn data_root() -> PathBuf {
    std::env::var_os("PATRONLAUNCHER_DATA_DIR")
        .or_else(|| std::env::var_os(LEGACY_DATA_ENV))
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("data"))
                .join(DATA_DIR_NAME)
        })
}
pub fn ensure_for_root(root: &Path) -> Result<()> {
    if root != data_root() {
        return Ok(());
    }
    // Explicit development/test roots never import real user data.
    if std::env::var_os("PATRONLAUNCHER_DATA_DIR").is_some()
        || std::env::var_os(LEGACY_DATA_ENV).is_some()
    {
        return Ok(());
    }
    let parent = root.parent().context("Veri klasörü geçersiz")?;
    migrate_default(parent, &SystemVault)
}
fn migrate_default(parent: &Path, vault: &impl Vault) -> Result<()> {
    let target = parent.join(DATA_DIR_NAME);
    // An existing destination is authoritative; never re-import older copies.
    if target.try_exists()? {
        regular(&target)?;
        return Ok(());
    }
    let current = parent.join(APP_NAME);
    let source = if current.try_exists()? {
        current
    } else {
        parent.join(LEGACY_APP_NAME)
    };
    migrate(&source, &target, vault)
}
trait Vault {
    fn read(&self, service: &str, id: &str) -> Result<Option<String>>;
    fn write(&self, service: &str, id: &str, secret: &str) -> Result<()>;
}
struct SystemVault;
impl Vault for SystemVault {
    fn read(&self, service: &str, id: &str) -> Result<Option<String>> {
        match keyring::Entry::new(service, id)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => bail!("Windows kimlik bilgileri okunamadı; eski kayıtlar korunuyor."),
        }
    }
    fn write(&self, service: &str, id: &str, secret: &str) -> Result<()> {
        keyring::Entry::new(service, id)?
            .set_password(secret)
            .map_err(|_| {
                anyhow::anyhow!(
                    "Windows kimlik bilgisi yeni adla yazılamadı; eski kayıt korunuyor."
                )
            })
    }
}
fn copy_secret(vault: &impl Vault, id: &str) -> Result<Option<String>> {
    if let Some(secret) = vault.read(CREDENTIAL_SERVICE, id)? {
        if !secret.is_empty() {
            return Ok(Some(secret));
        }
    }
    let Some(secret) = vault.read(LEGACY_CREDENTIAL_SERVICE, id)? else {
        return Ok(None);
    };
    if secret.is_empty() {
        return Ok(None);
    }
    vault.write(CREDENTIAL_SERVICE, id, &secret)?;
    if vault.read(CREDENTIAL_SERVICE, id)?.as_deref() != Some(secret.as_str()) {
        bail!("Yeni Windows kimlik bilgisi doğrulanamadı; eski kayıt korunuyor.");
    }
    Ok(Some(secret))
}
pub fn refresh_token(id: Uuid) -> Result<String> {
    copy_secret(&SystemVault, &id.to_string())?
        .context("Kaydedilmiş Microsoft oturumu bulunamadı. Yeniden giriş yapın.")
}
#[derive(Deserialize)]
struct AccountRef {
    id: Uuid,
    kind: String,
}
#[derive(Deserialize)]
struct SavedAccounts {
    #[serde(default)]
    accounts: Vec<AccountRef>,
}
fn copy_credentials(root: &Path, vault: &impl Vault) -> Result<usize> {
    let primary = root.join("settings.json");
    let backup = root.join("settings.json.bak");
    if !primary.exists() && !backup.exists() {
        return Ok(0);
    }
    let read = |p: &Path| -> Result<SavedAccounts> { Ok(serde_json::from_slice(&fs::read(p)?)?) };
    let accounts = read(&primary)
        .or_else(|_| read(&backup))
        .context("Eski hesap ayarları okunamadı; veri göçü tamamlanmadı.")?;
    let mut count = 0;
    for account in accounts
        .accounts
        .into_iter()
        .filter(|a| a.kind == "Microsoft")
    {
        if copy_secret(vault, &account.id.to_string())?.is_some() {
            count += 1;
        }
    }
    Ok(count)
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Fingerprint {
    path: String,
    size: u64,
    sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Tree {
    directories: Vec<String>,
    files: Vec<Fingerprint>,
}
#[derive(Serialize, Deserialize)]
struct Receipt {
    format: u32,
    verified: bool,
    credentials_verified: usize,
    tree: Tree,
}
fn regular(path: &Path) -> Result<fs::Metadata> {
    let meta = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    let reparse = {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let reparse = false;
    if meta.is_symlink() || reparse || (!meta.is_dir() && !meta.is_file()) {
        bail!(
            "Veri göçü bağlantı/özel dosya nedeniyle durdu; eski klasör korunuyor: {}",
            path.display()
        );
    }
    Ok(meta)
}
fn fingerprint(path: &Path, relative: String) -> Result<Fingerprint> {
    let meta = regular(path)?;
    let mut reader = File::open(path)?;
    let mut hash = Sha256::new();
    let mut bytes = 0u64;
    let mut buf = [0u8; 65536];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        hash.update(&buf[..n]);
    }
    if bytes != meta.len() {
        bail!(
            "Göç sırasında kaynak dosya değişti; eski uygulama ve oyunu kapatıp yeniden deneyin."
        );
    }
    Ok(Fingerprint {
        path: relative,
        size: bytes,
        sha256: format!("{:x}", hash.finalize()),
    })
}
fn snapshot(root: &Path) -> Result<Tree> {
    fn walk(root: &Path, dir: &Path, tree: &mut Tree) -> Result<()> {
        regular(dir)?;
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            let relative = path
                .strip_prefix(root)?
                .to_str()
                .context("Veri yolu UTF-8 biçimine çevrilemedi")?
                .replace('\\', "/");
            if relative == "launcher.lock" {
                continue;
            }
            let meta = regular(&path)?;
            if meta.is_dir() {
                tree.directories.push(relative);
                walk(root, &path, tree)?;
            } else {
                tree.files.push(fingerprint(&path, relative)?);
            }
        }
        Ok(())
    }
    let mut tree = Tree {
        directories: vec![],
        files: vec![],
    };
    walk(root, root, &mut tree)?;
    tree.directories.sort();
    tree.files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(tree)
}
fn lock(path: &Path) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    file.try_lock().map_err(|_|anyhow::anyhow!("Veri göçü için eski launcherı ve oyunu kapatıp yeniden deneyin. Eski veriler korunuyor."))?;
    Ok(file)
}
fn migrate(source: &Path, target: &Path, vault: &impl Vault) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }
    regular(source)?;
    let parent = target.parent().context("Göç hedefi geçersiz")?;
    if source
        .parent()
        .context("Göç kaynağı geçersiz")?
        .canonicalize()?
        != parent.canonicalize()?
    {
        bail!("Göç klasörleri aynı üst klasörde olmalı.");
    }
    let _migration_lock = lock(&parent.join(".patronlauncher-migration.lock"))?;
    if target.exists() {
        regular(target)?;
        let marker = target.join(MARKER);
        if marker.exists() {
            regular(&marker)?;
            let receipt: Receipt = serde_json::from_slice(&fs::read(marker)?)
                .context("Göç kaydı doğrulanamadı; iki veri klasörü korunuyor.")?;
            if receipt.format == 1 && receipt.verified {
                return Ok(());
            }
            bail!("Göç kaydı tamamlanmamış; iki klasör de korunuyor.");
        }
        if fs::read_dir(target)?
            .any(|e| e.is_err() || e.is_ok_and(|e| e.file_name() != "launcher.lock"))
        {
            bail!(
                "Yeni veri klasöründe mevcut veriler var; otomatik göç durduruldu. İki klasör de korunuyor."
            );
        }
    }
    let _source_lock = lock(&source.join("launcher.lock"))?;
    let _target_lock = if target.exists() {
        Some(lock(&target.join("launcher.lock"))?)
    } else {
        None
    };
    let stage = parent.join(format!(".patronlauncher-migration-{}", Uuid::new_v4()));
    fs::create_dir(&stage)?;
    let result = (|| -> Result<()> {
        let tree = snapshot(source)?;
        for dir in &tree.directories {
            fs::create_dir_all(crate::net::safe_join(&stage, dir)?)?;
        }
        for item in &tree.files {
            let to = crate::net::safe_join(&stage, &item.path)?;
            fs::create_dir_all(to.parent().unwrap())?;
            fs::copy(crate::net::safe_join(source, &item.path)?, to)?;
        }
        if snapshot(&stage)? != tree || snapshot(source)? != tree {
            bail!(
                "Kopyalanan veriler doğrulanamadı veya kaynak değişti. Eski klasör silinmedi; göç yeniden denenebilir."
            );
        }
        let credentials_verified = copy_credentials(&stage, vault)?;
        let marker = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(stage.join(MARKER))?;
        serde_json::to_writer_pretty(
            &marker,
            &Receipt {
                format: 1,
                verified: true,
                credentials_verified,
                tree,
            },
        )?;
        marker.sync_all()?;
        drop(marker);
        drop(_target_lock);
        if target.exists() {
            let preserved = parent.join(format!(".patronlauncher-empty-{}", Uuid::new_v4()));
            fs::rename(target, preserved)?;
        }
        fs::rename(&stage, target)
            .context("Doğrulanmış veri klasörü yayınlanamadı; eski klasör korunuyor")?;
        Ok(())
    })();
    if result.is_err() {
        // Only this invocation's random staging directory can be removed.
        if stage.parent() == Some(parent)
            && stage.file_name().is_some_and(|n| {
                n.to_string_lossy()
                    .starts_with(".patronlauncher-migration-")
            })
            && !stage.is_symlink()
        {
            let _ = fs::remove_dir_all(&stage);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};
    #[derive(Default)]
    pub(super) struct FakeVault {
        values: RefCell<HashMap<(String, String), String>>,
        fail: bool,
        wrong: bool,
    }
    impl Vault for FakeVault {
        fn read(&self, s: &str, id: &str) -> Result<Option<String>> {
            Ok(self.values.borrow().get(&(s.into(), id.into())).cloned())
        }
        fn write(&self, s: &str, id: &str, secret: &str) -> Result<()> {
            if self.fail {
                bail!("simulated vault failure");
            }
            self.values.borrow_mut().insert(
                (s.into(), id.into()),
                if self.wrong {
                    "incorrect".into()
                } else {
                    secret.into()
                },
            );
            Ok(())
        }
    }
    fn fixture() -> (PathBuf, PathBuf, PathBuf, Uuid, FakeVault) {
        let base =
            std::env::temp_dir().join(format!("patronlauncher-migration-test-{}", Uuid::new_v4()));
        let old = base.join(LEGACY_APP_NAME);
        let new = base.join(DATA_DIR_NAME);
        fs::create_dir_all(&old).unwrap();
        let id = Uuid::new_v4();
        fs::write(
            old.join("settings.json"),
            serde_json::to_vec(&serde_json::json!({"accounts":[{"id":id,"kind":"Microsoft"}]}))
                .unwrap(),
        )
        .unwrap();
        let vault = FakeVault::default();
        vault.values.borrow_mut().insert(
            (LEGACY_CREDENTIAL_SERVICE.into(), id.to_string()),
            "synthetic-refresh".into(),
        );
        (base, old, new, id, vault)
    }
    #[test]
    fn copies_verified_tree_and_credentials_preserving_every_legacy_file() {
        let (base, old, new, id, vault) = fixture();
        for file in [
            "settings.json.bak",
            "instances/profile/options.txt",
            "instances/profile/saves/world.dat",
            "backups/profile/backup.zip",
            "runtimes/21/bin/java.exe",
        ] {
            let p = old.join(file);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, file.as_bytes()).unwrap();
        }
        fs::create_dir_all(old.join("instances/profile/empty")).unwrap();
        let before = snapshot(&old).unwrap();
        migrate(&old, &new, &vault).unwrap();
        assert_eq!(snapshot(&old).unwrap(), before);
        for f in before.files {
            assert_eq!(
                fs::read(old.join(&f.path)).unwrap(),
                fs::read(new.join(&f.path)).unwrap()
            );
        }
        assert!(new.join("instances/profile/empty").is_dir());
        assert_eq!(
            vault
                .read(CREDENTIAL_SERVICE, &id.to_string())
                .unwrap()
                .as_deref(),
            Some("synthetic-refresh")
        );
        assert_eq!(
            vault
                .read(LEGACY_CREDENTIAL_SERVICE, &id.to_string())
                .unwrap()
                .as_deref(),
            Some("synthetic-refresh")
        );
        fs::write(new.join("settings.json"), b"newer-settings").unwrap();
        migrate(&old, &new, &vault).unwrap();
        assert_eq!(
            fs::read(new.join("settings.json")).unwrap(),
            b"newer-settings"
        );
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn refuses_to_overwrite_existing_destination() {
        let (base, old, new, _, vault) = fixture();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.json"), b"keep-new").unwrap();
        assert!(migrate(&old, &new, &vault).is_err());
        assert_eq!(fs::read(new.join("settings.json")).unwrap(), b"keep-new");
        assert!(old.join("settings.json").exists());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn locked_source_cannot_be_migrated() {
        let (base, old, new, _, vault) = fixture();
        let guard = lock(&old.join("launcher.lock")).unwrap();
        assert!(migrate(&old, &new, &vault).is_err());
        assert!(!new.exists());
        drop(guard);
        migrate(&old, &new, &vault).unwrap();
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn credential_failure_never_publishes_unverified_data_or_removes_old_secrets() {
        for wrong in [false, true] {
            let (base, old, new, id, mut vault) = fixture();
            vault.fail = !wrong;
            vault.wrong = wrong;
            assert!(migrate(&old, &new, &vault).is_err());
            assert!(!new.exists());
            assert!(old.join("settings.json").is_file());
            assert_eq!(
                vault
                    .read(LEGACY_CREDENTIAL_SERVICE, &id.to_string())
                    .unwrap()
                    .as_deref(),
                Some("synthetic-refresh")
            );
            fs::remove_dir_all(base).unwrap();
        }
    }
    #[test]
    fn newer_credentials_are_not_overwritten_by_older_ones() {
        let (base, old, new, id, vault) = fixture();
        vault.values.borrow_mut().insert(
            (CREDENTIAL_SERVICE.into(), id.to_string()),
            "newer-refresh".into(),
        );
        migrate(&old, &new, &vault).unwrap();
        assert_eq!(
            vault
                .read(CREDENTIAL_SERVICE, &id.to_string())
                .unwrap()
                .as_deref(),
            Some("newer-refresh")
        );
        assert_eq!(
            vault
                .read(LEGACY_CREDENTIAL_SERVICE, &id.to_string())
                .unwrap()
                .as_deref(),
            Some("synthetic-refresh")
        );
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn corrupt_receipt_is_not_accepted_as_completed_migration() {
        let (base, old, new, _, vault) = fixture();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join(MARKER), b"bad").unwrap();
        assert!(migrate(&old, &new, &vault).is_err());
        assert_eq!(fs::read(new.join(MARKER)).unwrap(), b"bad");
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn refuses_links_outside_source() {
        let (base, old, new, _, vault) = fixture();
        std::os::unix::fs::symlink(std::env::temp_dir(), old.join("outside")).unwrap();
        assert!(migrate(&old, &new, &vault).is_err());
        assert!(!new.exists());
        fs::remove_dir_all(base).unwrap();
    }
}

#[cfg(test)]
mod additional_migration_tests {
    use super::*;
    #[test]
    fn hash_root_prefers_current_folder_and_preserves_prior_receipt() {
        let base = std::env::temp_dir().join(format!("patronlauncher-priority-{}", Uuid::new_v4()));
        let current = base.join(APP_NAME);
        let legacy = base.join(LEGACY_APP_NAME);
        fs::create_dir_all(&current).unwrap();
        fs::create_dir_all(&legacy).unwrap();
        fs::write(current.join("settings.json"), br#"{"accounts":[]}"#).unwrap();
        fs::write(
            current.join(".patronlauncher-migration-v1.json"),
            b"prior receipt",
        )
        .unwrap();
        fs::write(legacy.join("keep"), b"legacy").unwrap();
        let before = snapshot(&current).unwrap();
        migrate_default(&base, &tests::FakeVault::default()).unwrap();
        let target = base.join(DATA_DIR_NAME);
        assert!(target.join("settings.json").exists());
        assert!(!target.join("keep").exists());
        assert_eq!(
            fs::read(target.join(".patronlauncher-migration-v1.json")).unwrap(),
            b"prior receipt"
        );
        assert_eq!(snapshot(&current).unwrap(), before);
        assert_eq!(fs::read(legacy.join("keep")).unwrap(), b"legacy");
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn hash_root_falls_back_to_legacy_and_existing_destination_is_authoritative() {
        let base = std::env::temp_dir().join(format!("patronlauncher-hash-{}", Uuid::new_v4()));
        let legacy = base.join(LEGACY_APP_NAME);
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("world"), b"original").unwrap();
        let vault = tests::FakeVault::default();
        migrate_default(&base, &vault).unwrap();
        let target = base.join(DATA_DIR_NAME);
        assert_eq!(fs::read(target.join("world")).unwrap(), b"original");
        fs::write(target.join("world"), b"newer").unwrap();
        fs::remove_file(target.join(MARKER)).unwrap();
        migrate_default(&base, &vault).unwrap();
        assert_eq!(fs::read(target.join("world")).unwrap(), b"newer");
        assert_eq!(fs::read(legacy.join("world")).unwrap(), b"original");
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn hash_root_rejects_locked_source_without_publishing_destination() {
        let base = std::env::temp_dir().join(format!("patronlauncher-lock-{}", Uuid::new_v4()));
        let current = base.join(APP_NAME);
        fs::create_dir_all(&current).unwrap();
        fs::write(current.join("world"), b"original").unwrap();
        let held = lock(&current.join("launcher.lock")).unwrap();
        assert!(migrate_default(&base, &tests::FakeVault::default()).is_err());
        assert!(!base.join(DATA_DIR_NAME).exists());
        assert_eq!(fs::read(current.join("world")).unwrap(), b"original");
        drop(held);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn an_empty_destination_can_be_published_on_windows() {
        let base =
            std::env::temp_dir().join(format!("patronlauncher-empty-migration-{}", Uuid::new_v4()));
        let old = base.join(LEGACY_APP_NAME);
        let new = base.join(DATA_DIR_NAME);
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("launcher.lock"), b"").unwrap();
        fs::write(old.join("file"), b"preserve").unwrap();
        migrate(&old, &new, &tests::FakeVault::default()).unwrap();
        assert_eq!(fs::read(new.join("file")).unwrap(), b"preserve");
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "Uses synthetic Credential Manager records for a random test account only"]
    fn windows_credential_copy_is_verified_and_keeps_original() {
        let id = Uuid::new_v4().to_string();
        let old = keyring::Entry::new(LEGACY_CREDENTIAL_SERVICE, &id).unwrap();
        let new = keyring::Entry::new(CREDENTIAL_SERVICE, &id).unwrap();
        assert!(matches!(old.get_password(), Err(keyring::Error::NoEntry)));
        assert!(matches!(new.get_password(), Err(keyring::Error::NoEntry)));
        old.set_password("synthetic-migration-fixture").unwrap();
        let result = copy_secret(&SystemVault, &id);
        let verified = result.is_ok_and(|s| s.as_deref() == Some("synthetic-migration-fixture"))
            && new
                .get_password()
                .is_ok_and(|s| s == "synthetic-migration-fixture")
            && old
                .get_password()
                .is_ok_and(|s| s == "synthetic-migration-fixture");
        // Tear down only this test's freshly created random account records.
        let _ = new.delete_credential();
        let _ = old.delete_credential();
        assert!(verified);
    }
}
