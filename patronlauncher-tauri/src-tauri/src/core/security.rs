use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};

pub fn approved_external(url: &str) -> bool {
    url.len() <= 4096
        && !url.chars().any(char::is_control)
        && reqwest::Url::parse(url).is_ok_and(|u| {
            u.scheme() == "https"
                && u.username().is_empty()
                && u.password().is_none()
                && u.port().is_none()
                && (matches!(
                    u.host_str(),
                    Some(
                        "optifine.net"
                            | "open.spotify.com"
                            | "www.youtube.com"
                            | "youtube.com"
                            | "youtu.be"
                            | "vimeo.com"
                            | "modrinth.com"
                            | "github.com"
                            | "www.curseforge.com"
                            | "minecraft.net"
                            | "www.minecraft.net"
                            | "microsoft.com"
                            | "www.microsoft.com"
                            | "adoptium.net"
                            | "www.adoptium.net"
                            | "www.oracle.com"
                    )
                ) || crate::pclient::is_support_host(u.host_str()))
        })
}
pub fn open_external(url: &str) -> Result<()> {
    if !approved_external(url) {
        bail!("Harici bağlantı onaylı bir HTTPS alan adına ait değil.");
    }
    webbrowser::open(url)?;
    Ok(())
}
pub fn text(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > max || value.chars().any(char::is_control)
    {
        bail!("Metin alanı geçersiz.");
    }
    Ok(())
}
pub fn settings(value: &super::types::Settings) -> Result<()> {
    if !(1024..=32768).contains(&value.memory_mb) {
        bail!("Bellek 1024–32768 MB arasında olmalı.");
    }
    if !value.microsoft_client_id.trim().is_empty() {
        uuid::Uuid::parse_str(value.microsoft_client_id.trim())
            .context("Microsoft uygulama kimliği geçersiz")?;
    }
    if !value.discord_client_id.trim().is_empty()
        && !crate::discord::valid_id(value.discord_client_id.trim())
    {
        bail!("Discord uygulama kimliği geçersiz.");
    }
    let java = value.java_path.trim();
    if !java.is_empty() {
        let path = Path::new(java);
        if java.len() > 32768
            || java.chars().any(char::is_control)
            || java.starts_with(r"\")
            || !path.is_absolute()
            || !path.is_file()
            || !path.file_name().is_some_and(|n| {
                n.eq_ignore_ascii_case("java.exe") || n.eq_ignore_ascii_case("javaw.exe")
            })
        {
            bail!("Özel Java yolu yerel, mutlak bir java.exe/javaw.exe dosyası olmalı.");
        }
    }
    Ok(())
}
pub fn owned_path(root: &Path, target: &Path) -> Result<PathBuf> {
    let root = root.canonicalize()?;
    let mut existing = target;
    while !existing.exists() {
        existing = existing.parent().context("Klasör yolu geçersiz")?;
    }
    if !existing.canonicalize()?.starts_with(&root) {
        bail!("Klasör launcher veri alanı dışında.");
    }
    std::fs::create_dir_all(target)?;
    let canonical = target.canonicalize()?;
    if !canonical.starts_with(root) {
        bail!("Klasör launcher veri alanı dışında.");
    }
    Ok(canonical)
}
pub fn open_folder(root: &Path, target: &Path) -> Result<()> {
    let target = owned_path(root, target)?;
    let explorer = PathBuf::from(std::env::var_os("WINDIR").context("Windows klasörü bulunamadı")?)
        .join("explorer.exe");
    std::process::Command::new(explorer).arg(target).spawn()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn external_urls_are_constrained() {
        assert!(super::approved_external(
            "https://www.minecraft.net/article/test"
        ));
        for url in [
            "https://minecraft.net.evil.invalid/",
            "https://evil@minecraft.net/",
            "file:///C:/Windows",
            "http://minecraft.net/",
            "https://minecraft.net:444/",
            "javascript:alert(1)",
        ] {
            assert!(!super::approved_external(url));
        }
    }
    #[test]
    fn folder_scope_rejects_escape() {
        let base =
            std::env::temp_dir().join(format!("patronlauncher-scope-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        assert!(super::owned_path(&base, &base.join("instances/test/mods")).is_ok());
        assert!(super::owned_path(&base, &base.join("../escape")).is_err());
        std::fs::remove_dir_all(base).unwrap();
    }
}

pub fn approved_navigation(url: &reqwest::Url) -> bool {
    if url.username() != "" || url.password().is_some() {
        return false;
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
        || (cfg!(dev)
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(1420))
}
