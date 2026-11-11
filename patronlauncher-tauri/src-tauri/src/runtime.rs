use crate::net;
use anyhow::{Context, Result, bail};
use regex::Regex;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JavaStatus {
    Ready { major: u32, path: PathBuf },
    Missing { major: u32, reason: String },
}
impl JavaStatus {
    pub fn major(&self) -> u32 {
        match self {
            Self::Ready { major, .. } | Self::Missing { major, .. } => *major,
        }
    }
}
pub fn official_url() -> &'static str {
    "https://adoptium.net/temurin/releases/"
}
pub const ORACLE_URL: &str = "https://www.oracle.com/java/technologies/downloads/";

pub fn quiet_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
fn parse_major(text: &str) -> Result<u32> {
    Regex::new(r#"(?:openjdk|java) version "(?:1\.)?(\d+)"#)?
        .captures(text)
        .and_then(|c| c.get(1))
        .context("Java sürümü belirlenemedi")?
        .as_str()
        .parse()
        .context("Java sürümü geçersiz")
}
pub fn java_major(path: &Path) -> Result<u32> {
    let output = quiet_command(path)
        .arg("-version")
        .output()
        .context("Java çalıştırılamadı")?;
    if !output.status.success() {
        bail!("Java sürüm kontrolü başarısız.");
    }
    parse_major(&format!(
        "{}{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    ))
}
fn managed(root: &Path, major: u32) -> Option<PathBuf> {
    let base = root.join("runtimes").join(major.to_string());
    let mut candidates = vec![base.clone()];
    if let Ok(entries) = fs::read_dir(&base) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                candidates.push(entry.path());
                if let Ok(children) = fs::read_dir(entry.path()) {
                    candidates.extend(
                        children
                            .flatten()
                            .filter(|c| c.path().is_dir())
                            .map(|c| c.path()),
                    );
                }
            }
        }
    }
    candidates
        .into_iter()
        .map(|p| p.join("bin/java.exe"))
        .find(|p| p.is_file() && java_major(p).ok() == Some(major))
}
pub fn detect(root: &Path, custom: &str, major: u32) -> JavaStatus {
    if !custom.trim().is_empty() {
        let path = PathBuf::from(custom.trim());
        return match java_major(&path) {
            Ok(found) if found == major => JavaStatus::Ready { major, path },
            Ok(found) => JavaStatus::Missing { major, reason: format!("Seçtiğiniz Java {found}; bu Minecraft sürümü Java {major} gerektiriyor.") },
            Err(_) => JavaStatus::Missing { major, reason: "Seçilen Java çalıştırılamıyor. Java yolunu kontrol edin veya PatronLauncher ile kurun.".into() },
        };
    }
    if let Some(path) = managed(root, major) {
        return JavaStatus::Ready { major, path };
    }
    // Prefer actual executable paths over vendor launcher shims where possible.
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        let path = PathBuf::from(home).join("bin/java.exe");
        if java_major(&path).ok() == Some(major) {
            return JavaStatus::Ready { major, path };
        }
    }
    if java_major(Path::new("java")).ok() == Some(major) {
        return JavaStatus::Ready {
            major,
            path: PathBuf::from("java"),
        };
    }
    JavaStatus::Missing {
        major,
        reason: format!("Uyumlu Java {major} bulunamadı. Nasıl kurmak istediğinizi seçin."),
    }
}
pub fn require(root: &Path, custom: &str, major: u32) -> Result<PathBuf> {
    match detect(root, custom, major) {
        JavaStatus::Ready { path, .. } => Ok(path),
        JavaStatus::Missing { reason, .. } => {
            bail!("{reason} Java yönetimi bölümünü kullanın; izniniz olmadan Java indirilmez.")
        }
    }
}
fn extracted_java(root: &Path) -> Option<PathBuf> {
    fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|e| e.path().join("bin/java.exe"))
        .find(|p| p.is_file())
}
pub fn install(
    root: &Path,
    major: u32,
    cancel: &AtomicBool,
    notify: impl Fn(String),
) -> Result<PathBuf> {
    if let Some(path) = managed(root, major) {
        notify(format!("Java {major} zaten PatronLauncher içinde kurulu."));
        return Ok(path);
    }
    if cancel.load(Ordering::Relaxed) {
        bail!("Java kurulumu iptal edildi.");
    }
    notify(format!(
        "Java {major}, Eclipse Temurin resmî kaynağından indiriliyor…"
    ));
    let client = net::client()?;
    let info = net::json(
        &client,
        &format!(
            "https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse"
        ),
    )?;
    let package = &info[0]["binary"]["package"];
    let url = package["link"]
        .as_str()
        .context("Java indirme bağlantısı yok")?;
    let checksum = package["checksum"]
        .as_str()
        .context("Java sağlama toplamı yok")?;
    if !url.starts_with("https://github.com/adoptium/")
        || checksum.len() != 64
        || !checksum.bytes().all(|b| b.is_ascii_hexdigit())
    {
        bail!("Java indirme kaynağı veya sağlama toplamı geçersiz.");
    }
    let runtimes = root.join("runtimes");
    let archive = runtimes.join(format!("java-{major}.zip"));
    net::download(&client, url, &archive, checksum, true)?;
    if cancel.load(Ordering::Relaxed) {
        bail!("Java kurulumu iptal edildi. Doğrulanmış arşiv sonraki deneme için saklandı.");
    }
    let stage = runtimes.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    let result = (|| -> Result<PathBuf> {
        notify("Java arşivi doğrulandı; kurulum hazırlanıyor…".into());
        net::extract(&archive, &stage, &[])?;
        let path = extracted_java(&stage).context("Java arşivinde java.exe bulunamadı")?;
        if java_major(&path)? != major {
            bail!("İndirilen Java sürümü eşleşmiyor.");
        }
        if cancel.load(Ordering::Relaxed) {
            bail!("Java kurulumu iptal edildi.");
        }
        let relative = path.strip_prefix(&stage)?.to_owned();
        let destination = runtimes
            .join(major.to_string())
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(destination.parent().unwrap())?;
        fs::rename(&stage, &destination)?;
        Ok(destination.join(relative))
    })();
    if result.is_err() && stage.is_dir() {
        fs::remove_dir_all(&stage)?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn java_version_formats() {
        assert_eq!(parse_major("java version \"1.8.0_472\"").unwrap(), 8);
        assert_eq!(
            parse_major("openjdk version \"21.0.9\" 2025-10-21 LTS").unwrap(),
            21
        );
        assert_eq!(parse_major("java version \"25.0.4\"").unwrap(), 25);
        assert!(parse_major("unexpected").is_err());
    }
    #[test]
    fn missing_custom_java_never_downloads() {
        let root =
            std::env::temp_dir().join(format!("patronlauncher-java-{}", uuid::Uuid::new_v4()));
        assert!(matches!(
            detect(&root, "C:/does-not-exist-patronlauncher/java.exe", 21),
            JavaStatus::Missing { major: 21, .. }
        ));
        assert!(require(&root, "C:/does-not-exist-patronlauncher/java.exe", 21).is_err());
        assert!(!root.exists());
    }
}
