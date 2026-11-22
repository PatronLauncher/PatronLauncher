//! Untrusted artwork stays behind a bounded HTTPS allowlist, never a webview URL.
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Read,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
const MAX: usize = 8 * 1024 * 1024;
#[derive(Clone, Serialize)]
pub struct Image {
    pub mime: String,
    pub data: String,
}
static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Image)>>> = OnceLock::new();
pub fn allowed(src: &str) -> bool {
    reqwest::Url::parse(src).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
            && u.fragment().is_none()
            && match u.host_str() {
                Some(
                    "cdn.modrinth.com"
                    | "media.forgecdn.net"
                    | "i.scdn.co"
                    | "image-cdn-ak.spotifycdn.com"
                    | "image-cdn-fa.spotifycdn.com"
                    | "raw.githubusercontent.com"
                    | "i.imgur.com"
                    | "user-images.githubusercontent.com",
                ) => true,
                // Sunucu banner'ları: yalnızca sitenin onaylı banner adresi.
                Some("patronlauncher.net") => u.path().starts_with("/api/servers/banner-"),
                Some("github.com") => u
                    .path_segments()
                    .is_some_and(|mut s| s.any(|x| x == "assets")),
                _ => false,
            }
    })
}
fn validate(mime: &str, bytes: &[u8]) -> Result<()> {
    ensure!(bytes.len() <= MAX, "Görsel 8 MB sınırını aşıyor.");
    let format = image::guess_format(bytes).context("Görsel dosyası tanınmadı")?;
    let expected = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Gif => "image/gif",
        _ => "",
    };
    ensure!(
        !expected.is_empty() && mime == expected,
        "Görsel içerik türü reddedildi."
    );
    let (w, h) =
        image::ImageReader::with_format(std::io::Cursor::new(bytes), format).into_dimensions()?;
    ensure!(
        w > 0 && h > 0 && w <= 8192 && h <= 8192 && (w as u64 * h as u64) <= 16_777_216,
        "Görsel çözünürlüğü sınırı aşıldı."
    );
    Ok(())
}
fn strict(mime: &str, bytes: &[u8]) -> Result<String> {
    validate(mime, bytes)?;
    Ok(mime.to_string())
}
/// Biçimi başlıktan değil içerikten belirler; yalnızca webview'e verilmeyen, PNG'ye çevrilecek görseller için.
fn sniff(_: &str, bytes: &[u8]) -> Result<String> {
    let mime = match image::guess_format(bytes).context("Görsel dosyası tanınmadı")? {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Gif => "image/gif",
        _ => anyhow::bail!("Görsel biçimi desteklenmiyor."),
    };
    strict(mime, bytes)
}
pub fn fetch(src: &str) -> Result<Image> {
    fetch_with(src, "", strict)
}
/// Modrinth CDN'i WebP simgeleri image/png başlığıyla sunar; oyun içi simgeler bu yolu kullanır.
pub fn fetch_sniffed(src: &str) -> Result<Image> {
    fetch_with(src, "sniffed:", sniff)
}
fn fetch_with(src: &str, prefix: &str, check: fn(&str, &[u8]) -> Result<String>) -> Result<Image> {
    let key = format!("{prefix}{src}");
    ensure!(
        src.len() <= 4096 && allowed(src),
        "Görsel güvenlik nedeniyle engellendi"
    );
    let cache = CACHE.get_or_init(Default::default);
    {
        let c = cache
            .lock()
            .map_err(|_| anyhow::anyhow!("Görsel önbelleği açılamadı"))?;
        if let Some((at, v)) = c.get(&key) {
            if at.elapsed() < Duration::from_secs(120) {
                return Ok(v.clone());
            }
        }
    }
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .user_agent(crate::modrinth::user_agent())
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() < 5 && allowed(a.url().as_str()) {
                a.follow()
            } else {
                a.error("Görsel yönlendirmesi güvenlik nedeniyle reddedildi")
            }
        }))
        .build()?;
    let r = client.get(src).send()?.error_for_status()?;
    ensure!(
        r.content_length().is_none_or(|n| n <= MAX as u64),
        "Görsel çok büyük."
    );
    let mime = r
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    ensure!(
        ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(&mime.as_str()),
        "Görsel içerik türü reddedildi."
    );
    let mut bytes = Vec::new();
    r.take(MAX as u64 + 1).read_to_end(&mut bytes)?;
    let mime = check(&mime, &bytes)?;
    let result = Image {
        mime,
        data: STANDARD.encode(&bytes),
    };
    let mut c = cache
        .lock()
        .map_err(|_| anyhow::anyhow!("Görsel önbelleği açılamadı"))?;
    c.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(120));
    while c.values().map(|(_, v)| v.data.len()).sum::<usize>() + result.data.len()
        > 32 * 1024 * 1024
    {
        if let Some(key) = c.iter().min_by_key(|(_, v)| v.0).map(|(k, _)| k.clone()) {
            c.remove(&key);
        } else {
            break;
        }
    }
    c.insert(key, (Instant::now(), result.clone()));
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_and_content() {
        for u in [
            "http://cdn.modrinth.com/a.png",
            "https://evil.test/a.png",
            "https://cdn.modrinth.com.evil.test/a.png",
            "https://github.com/user/repo/blob/main/a.png",
            "data:image/png;base64,a",
            "https://cdn.modrinth.com:8443/a.png",
        ] {
            assert!(!allowed(u));
        }
        assert!(allowed("https://github.com/user/repo/assets/1234"));
        assert!(allowed("https://i.imgur.com/a.gif"));
        assert!(validate("image/png", b"<svg onload='bad()'/>").is_err());
        let mut c = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut c, image::ImageFormat::Png)
            .unwrap();
        assert!(validate("image/png", c.get_ref()).is_ok());
        assert!(validate("image/gif", c.get_ref()).is_err());
        // Yanlış etiketli görsel yalnızca içeriğe bakan yolda kabul edilir; görsel olmayan veri yine reddedilir.
        assert_eq!(sniff("image/gif", c.get_ref()).unwrap(), "image/png");
        assert!(sniff("image/png", b"<svg onload='bad()'/>").is_err());
    }
}
