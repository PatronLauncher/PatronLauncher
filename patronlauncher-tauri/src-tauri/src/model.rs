use anyhow::{Context, Result, bail};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AccountKind {
    Local,
    Microsoft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: Uuid,
    pub name: String,
    pub uuid: String,
    pub kind: AccountKind,
}

impl std::fmt::Display for Account {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} · {}",
            self.name,
            if self.kind == AccountKind::Local {
                "Yerel"
            } else {
                "Microsoft"
            }
        )
    }
}
impl PartialEq for Account {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

pub fn local_account(name: &str) -> Result<Account> {
    let name = name.trim();
    if !(3..=16).contains(&name.len())
        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        bail!("Oyuncu adı 3–16 karakter olmalı; yalnızca harf, rakam ve alt çizgi kullanılabilir.");
    }
    let mut bytes: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}")).into();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(Account {
        id: Uuid::new_v4(),
        name: name.into(),
        uuid: Uuid::from_bytes(bytes).simple().to_string(),
        kind: AccountKind::Local,
    })
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Loader {
    #[default]
    #[serde(alias = "None")]
    Vanilla,
    Fabric,
    Quilt,
    NeoForge,
    Forge,
    OptiFine,
}
fn default_loader<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Loader, D::Error> {
    Ok(Option::<Loader>::deserialize(deserializer)?.unwrap_or_default())
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    #[serde(default)]
    pub appearance: crate::profile_appearance::Appearance,
    #[serde(default)]
    pub kind: ProfileKind,
    pub id: Uuid,
    pub name: String,
    pub version: String,
    #[serde(default, deserialize_with = "default_loader")]
    pub loader: Loader,
    #[serde(default)]
    pub loader_version: Option<String>,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProfileKind {
    Quick,
    #[default]
    Custom,
}
impl std::fmt::Display for Profile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} · {}", self.name, self.version)
    }
}
impl PartialEq for Profile {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct State {
    pub accounts: Vec<Account>,
    pub profiles: Vec<Profile>,
    pub selected_account: Option<Uuid>,
    pub selected_profile: Option<Uuid>,
    pub microsoft_client_id: String,
    pub discord_client_id: String,
    pub java_path: String,
    pub memory_mb: u32,
}
impl Default for State {
    fn default() -> Self {
        Self {
            accounts: vec![],
            profiles: vec![],
            selected_account: None,
            selected_profile: None,
            microsoft_client_id: String::new(),
            discord_client_id: crate::discord::DEFAULT_CLIENT_ID.into(),
            java_path: String::new(),
            memory_mb: 4096,
        }
    }
}
impl State {
    #[cfg(test)]
    pub fn load(root: &Path) -> Result<Self> {
        Self::load_with_notice(root).map(|(state, _)| state)
    }
    pub fn load_with_notice(root: &Path) -> Result<(Self, bool)> {
        let file = root.join("settings.json");
        let backup = root.join("settings.json.bak");
        if !file.exists() && !backup.exists() {
            return Ok((Self::default(), false));
        }
        if let Ok(bytes) = fs::read(&file)
            && let Ok(state) = serde_json::from_slice(&bytes)
        {
            return Ok((state, false));
        }
        let state = serde_json::from_slice(
            &fs::read(backup)
                .context("Ayar dosyası okunamadı ve kurtarma kopyası yok; dosyalar korunuyor.")?,
        )
        .context("Ayar dosyası ve kurtarma kopyası okunamadı; dosyalar korunuyor.")?;
        Ok((state, true))
    }
    pub fn save(&self, root: &Path) -> Result<()> {
        fs::create_dir_all(root)?;
        let bytes = serde_json::to_vec_pretty(self)?;
        for profile in &self.profiles {
            crate::profiles::save_metadata(root, profile)?;
        }
        let primary = root.join("settings.json");
        if let Ok(old) = fs::read(&primary)
            && serde_json::from_slice::<Self>(&old).is_err()
        {
            crate::profiles::atomic_write(
                &root.join(format!("settings.corrupt-{}.json", Uuid::new_v4())),
                &old,
            )?;
        }
        crate::profiles::atomic_write(&root.join("settings.json.bak"), &bytes)?;
        crate::profiles::atomic_write(&primary, &bytes)?;
        Ok(())
    }
    pub fn account(&self) -> Option<Account> {
        self.accounts
            .iter()
            .find(|a| Some(a.id) == self.selected_account)
            .cloned()
    }
    pub fn profile(&self) -> Option<Profile> {
        self.profiles
            .iter()
            .find(|p| Some(p.id) == self.selected_profile)
            .cloned()
    }
}
pub fn data_root() -> PathBuf {
    crate::migration::data_root()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_uuid_matches_java() {
        assert_eq!(
            local_account("Notch").unwrap().uuid,
            "b50ad385829d3141a2167e7d7539ba7f"
        );
        assert!(local_account("../test").is_err());
        assert!(local_account("aa").is_err());
    }
    #[test]
    fn state_roundtrip_and_corruption() {
        let root = std::env::temp_dir().join(format!("patronlauncher-test-{}", Uuid::new_v4()));
        let mut state = State::default();
        state.accounts.push(local_account("Player").unwrap());
        state.selected_account = Some(state.accounts[0].id);
        state.save(&root).unwrap();
        state.memory_mb = 2048;
        state.save(&root).unwrap();
        assert_eq!(State::load(&root).unwrap().memory_mb, 2048);
        assert_eq!(
            State::load(&root).unwrap().account().unwrap().name,
            "Player"
        );
        fs::write(root.join("settings.json"), "broken").unwrap();
        let (recovered, notice) = State::load_with_notice(&root).unwrap();
        assert!(notice);
        assert_eq!(recovered.account().unwrap().name, "Player");
        assert_eq!(recovered.memory_mb, 2048);
        recovered.save(&root).unwrap();
        assert!(fs::read_dir(&root).unwrap().flatten().any(|p| {
            p.file_name()
                .to_string_lossy()
                .starts_with("settings.corrupt-")
        }));
        fs::write(root.join("settings.json"), "broken").unwrap();
        fs::write(root.join("settings.json.bak"), "broken").unwrap();
        assert!(State::load(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod loader_compatibility_tests {
    use super::*;
    #[test]
    fn old_settings_and_metadata_default_to_vanilla_and_fabric_roundtrips() {
        let id = Uuid::new_v4();
        let legacy = serde_json::json!({"id":id,"name":"OldWorld","version":"1.18.2"});
        let mut profile: Profile = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(profile.loader, Loader::Vanilla);
        assert!(profile.loader_version.is_none());
        for value in [
            serde_json::Value::Null,
            serde_json::json!("None"),
            serde_json::json!("Vanilla"),
        ] {
            let mut p = legacy.clone();
            p["loader"] = value;
            assert_eq!(
                serde_json::from_value::<Profile>(p).unwrap().loader,
                Loader::Vanilla
            );
        }
        let state: State =
            serde_json::from_value(serde_json::json!({"profiles":[legacy],"selected_profile":id}))
                .unwrap();
        assert_eq!(state.profile().unwrap().loader, Loader::Vanilla);
        profile.loader = Loader::Fabric;
        profile.loader_version = Some("0.18.4".into());
        let root = std::env::temp_dir().join(format!("patronlauncher-loader-{}", Uuid::new_v4()));
        let state = State {
            profiles: vec![profile.clone()],
            selected_profile: Some(id),
            ..Default::default()
        };
        state.save(&root).unwrap();
        let loaded = State::load(&root).unwrap().profile().unwrap();
        assert_eq!(loaded.loader, Loader::Fabric);
        assert_eq!(loaded.loader_version.as_deref(), Some("0.18.4"));
        let recovered = crate::profiles::recover(&root).unwrap();
        assert_eq!(recovered[0].loader, Loader::Fabric);
        assert_eq!(
            crate::profiles::dir(&root, &profile),
            root.join("instances").join(id.to_string())
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
