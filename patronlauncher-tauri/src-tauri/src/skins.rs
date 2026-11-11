//! Oyuncu skinleri. Mojang'ın profil servisinden alınır (NameMC de aynı kaynağı gösterir):
//! yerel hesapta ada kayıtlı lisanslı hesabın skini, Microsoft hesabında oyuncunun kendi skini.
//! Sonuç kısa süre diskte tutulur; ağ yoksa eski kayıt kullanılır.
use anyhow::{Context, Result, bail};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const FRESH_FOR: u64 = 30 * 60;
const MAX_PNG: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Skin {
    /// data:image/png;base64,… (arayüz doğrudan kullanır; CSP data: izinli).
    pub data_url: String,
    /// İnce kollu (Alex) model.
    pub slim: bool,
}

#[derive(Serialize, Deserialize)]
struct Cached {
    fetched: u64,
    skin: Option<Skin>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn valid_name(name: &str) -> bool {
    (1..=16).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Tiresiz 32 haneli UUID'ye çevirir; geçersizse None.
fn compact_uuid(uuid: &str) -> Option<String> {
    let id: String = uuid.chars().filter(|c| *c != '-').collect::<String>().to_ascii_lowercase();
    (id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())).then_some(id)
}

fn cache_file(root: &Path, key: &str) -> PathBuf {
    root.join("skins").join(format!("{key}.json"))
}

/// Skini getirir. uuid verilirse (Microsoft hesabı) doğrudan o profil, yoksa ada kayıtlı profil kullanılır.
/// Ada kayıtlı lisanslı hesap yoksa Ok(None) döner.
pub fn fetch(root: &Path, name: &str, uuid: Option<&str>) -> Result<Option<Skin>> {
    let uuid = uuid.and_then(compact_uuid);
    if uuid.is_none() && !valid_name(name) {
        bail!("Geçersiz oyuncu adı.");
    }
    let key = uuid.clone().unwrap_or_else(|| format!("name-{}", name.to_ascii_lowercase()));
    let file = cache_file(root, &key);
    let cached: Option<Cached> = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok());
    if let Some(c) = &cached
        && now().saturating_sub(c.fetched) < FRESH_FOR
    {
        return Ok(c.skin.clone());
    }
    match download(name, uuid.as_deref()) {
        Ok(skin) => {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let body = serde_json::to_vec(&Cached { fetched: now(), skin: skin.clone() })?;
            let _ = crate::profiles::atomic_write(&file, &body);
            Ok(skin)
        }
        // Ağ hatasında eski kayıt varsa o gösterilir.
        Err(error) => match cached {
            Some(c) => Ok(c.skin),
            None => Err(error),
        },
    }
}

fn client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(12))
        .https_only(true)
        .build()?)
}

fn download(name: &str, uuid: Option<&str>) -> Result<Option<Skin>> {
    let client = client()?;
    let id = match uuid {
        Some(id) => id.to_string(),
        None => {
            let response = client
                .get(format!("https://api.mojang.com/users/profiles/minecraft/{name}"))
                .send()
                .context("Mojang profil servisine ulaşılamadı")?;
            // Bu ada kayıtlı lisanslı hesap yok.
            if matches!(response.status().as_u16(), 204 | 404) {
                return Ok(None);
            }
            let body: serde_json::Value = response.error_for_status()?.json()?;
            body["id"].as_str().and_then(compact_uuid).context("Mojang yanıtında oyuncu kimliği yok")?
        }
    };
    let response = client
        .get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{id}"))
        .send()
        .context("Mojang oturum servisine ulaşılamadı")?;
    if matches!(response.status().as_u16(), 204 | 404) {
        return Ok(None);
    }
    let profile: serde_json::Value = response.error_for_status()?.json()?;
    let Some((url, slim)) = texture(&profile)? else {
        return Ok(None);
    };
    let png = client.get(&url).send()?.error_for_status()?.bytes()?;
    if png.len() > MAX_PNG || !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        bail!("Skin dosyası geçersiz.");
    }
    Ok(Some(Skin {
        data_url: format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png)),
        slim,
    }))
}

/// Profilin "textures" özelliğinden skin adresini ve modelini çıkarır.
fn texture(profile: &serde_json::Value) -> Result<Option<(String, bool)>> {
    let Some(value) = profile["properties"]
        .as_array()
        .and_then(|p| p.iter().find(|p| p["name"] == "textures"))
        .and_then(|p| p["value"].as_str())
    else {
        return Ok(None);
    };
    let decoded = base64::engine::general_purpose::STANDARD.decode(value).context("Skin verisi çözülemedi")?;
    let textures: serde_json::Value = serde_json::from_slice(&decoded)?;
    let skin = &textures["textures"]["SKIN"];
    let Some(url) = skin["url"].as_str() else {
        return Ok(None);
    };
    // Yalnızca Mojang'ın doku sunucusu kabul edilir.
    let url = url.replacen("http://", "https://", 1);
    if !url.starts_with("https://textures.minecraft.net/texture/") {
        bail!("Beklenmeyen skin adresi.");
    }
    Ok(Some((url, skin["metadata"]["model"] == "slim")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_uuids_are_validated() {
        assert!(valid_name("Justt_"));
        assert!(!valid_name("bad name"));
        assert!(!valid_name("../x"));
        assert!(!valid_name("abcdefghijklmnopq"));
        assert_eq!(
            compact_uuid("069A79F4-44E9-4726-A5BE-FCA90E38AAF5").as_deref(),
            Some("069a79f444e94726a5befca90e38aaf5")
        );
        assert_eq!(compact_uuid("../../etc"), None);
    }

    #[test]
    fn texture_is_read_from_profile_property() {
        let inner = serde_json::json!({"textures": {"SKIN": {"url": "http://textures.minecraft.net/texture/abc", "metadata": {"model": "slim"}}}});
        let value = base64::engine::general_purpose::STANDARD.encode(inner.to_string());
        let profile = serde_json::json!({"properties": [{"name": "textures", "value": value}]});
        assert_eq!(
            texture(&profile).unwrap(),
            Some(("https://textures.minecraft.net/texture/abc".into(), true))
        );
        let evil = serde_json::json!({"textures": {"SKIN": {"url": "https://evil.example/x.png"}}});
        let value = base64::engine::general_purpose::STANDARD.encode(evil.to_string());
        assert!(texture(&serde_json::json!({"properties": [{"name": "textures", "value": value}]})).is_err());
        assert_eq!(texture(&serde_json::json!({})).unwrap(), None);
    }
}
