use crate::net;
use anyhow::{Context, Result, bail};
use regex::Regex;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
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
/// Resmî Java indirme sayfası (Oracle).
pub fn official_url() -> &'static str {
    ORACLE_URL
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
/// Klasör adındaki sürüm ipucu ("jdk-21.0.2" → 21, "jre1.8.0_401" → 8). Adında sayı olmayan
/// klasörler (ör. Mojang'ın "java-runtime-delta") için yok döner ve java.exe'ye sorulur.
fn folder_major(java: &Path) -> Option<u32> {
    let name = java.parent()?.parent()?.file_name()?.to_string_lossy().to_lowercase();
    let captures = Regex::new(r"(?:1\.)?(\d+)").ok()?.captures(&name)?;
    captures.get(1)?.as_str().parse().ok()
}
fn children(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default()
}
/// Bilgisayarda kurulu Java'lar: JAVA_HOME, yaygın dağıtımların kurulum klasörleri ve
/// Minecraft'ın resmî launcher'ının indirdiği Java paketleri.
fn system_candidates() -> Vec<PathBuf> {
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let mut out = Vec::new();
    if let Some(home) = env("JAVA_HOME") {
        out.push(home.join("bin/java.exe"));
    }
    let mut roots: Vec<PathBuf> = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|v| env(v))
        .collect();
    if let Some(local) = env("LOCALAPPDATA") {
        roots.push(local.join("Programs"));
    }
    roots.dedup();
    const VENDORS: &[&str] = &[
        "Java", "Eclipse Adoptium", "Eclipse Foundation", "Microsoft", "Zulu", "BellSoft",
        "Amazon Corretto", "Semeru", "OpenJDK", "Oracle",
    ];
    for root in &roots {
        for vendor in VENDORS {
            out.extend(children(&root.join(vendor)).into_iter().map(|d| d.join("bin/java.exe")));
        }
    }
    let mut mojang = Vec::new();
    if let Some(appdata) = env("APPDATA") {
        mojang.push(appdata.join(".minecraft/runtime"));
    }
    if let Some(local) = env("LOCALAPPDATA") {
        mojang.push(local.join("Packages/Microsoft.4297127D64EC6_8wekyb3d8bbwe/LocalCache/Local/runtime"));
    }
    for runtime in mojang {
        for component in children(&runtime) {
            for build in children(&component.join("windows-x64")) {
                out.push(build.join("bin/java.exe"));
            }
        }
    }
    out
}
fn system(major: u32) -> Option<PathBuf> {
    system_candidates()
        .into_iter()
        .filter(|p| p.is_file() && folder_major(p).is_none_or(|hint| hint == major))
        .find(|p| java_major(p).ok() == Some(major))
        .or_else(|| (java_major(Path::new("java")).ok() == Some(major)).then(|| PathBuf::from("java")))
}
/// Sürümün istediği Java'yı bulur. Ayarlarda seçilen Java bu sürüme uymuyorsa (ör. Java 21
/// seçili ama sürüm Java 25 istiyor) PatronLauncher'ın kurduğu ya da bilgisayardaki uygun
/// Java kullanılır; böylece farklı Java isteyen sürümler arasında geçiş elle ayar istemez.
pub fn detect(root: &Path, custom: &str, major: u32) -> JavaStatus {
    let custom = custom.trim();
    if !custom.is_empty() {
        let path = PathBuf::from(custom);
        if java_major(&path).ok() == Some(major) {
            return JavaStatus::Ready { major, path };
        }
    }
    if let Some(path) = managed(root, major).or_else(|| system(major)) {
        return JavaStatus::Ready { major, path };
    }
    JavaStatus::Missing {
        major,
        reason: format!("Bu Minecraft sürümü Java {major} gerektiriyor ve bilgisayarında bulunamadı."),
    }
}
pub fn require(root: &Path, custom: &str, major: u32) -> Result<PathBuf> {
    match detect(root, custom, major) {
        JavaStatus::Ready { path, .. } => Ok(path),
        JavaStatus::Missing { reason, .. } => {
            bail!("{reason} Java'yı PatronLauncher ile kurabilirsin; izni olmadan Java indirilmez.")
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
/// Minecraft'ın resmî launcher'ının kullandığı Java paketlerinin listesi (Mojang).
const MOJANG_RUNTIMES: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

/// "8u51-cacert…" → 8, "17.0.15" → 17, "25.0.1" → 25.
fn runtime_major(name: &str) -> Option<u32> {
    name.split(|c: char| !c.is_ascii_digit()).find(|p| !p.is_empty())?.parse().ok()
}
fn hex(value: &str, len: usize) -> bool {
    value.len() == len && value.bytes().all(|b| b.is_ascii_hexdigit())
}

/// İstenen Java sürümünü sunan Mojang paketi: (ad, manifest adresi, sha1).
pub fn mojang_component(index: &serde_json::Value, major: u32) -> Option<(String, String, String)> {
    let os = index["windows-x64"].as_object()?;
    let mut names: Vec<&String> = os
        .keys()
        .filter(|k| !k.contains("snapshot") && k.as_str() != "minecraft-java-exe")
        .collect();
    names.sort();
    names.into_iter().find_map(|name| {
        let entry = os[name].get(0)?;
        (runtime_major(entry["version"]["name"].as_str()?)? == major).then_some(())?;
        let url = entry["manifest"]["url"].as_str()?;
        let sha1 = entry["manifest"]["sha1"].as_str()?;
        (url.starts_with("https://piston-meta.mojang.com/") && hex(sha1, 40))
            .then(|| (name.clone(), url.to_string(), sha1.to_string()))
    })
}

/// Mojang paketini dosya dosya (sha1 doğrulamalı) indirir. Paket bu Java sürümünü sunmuyorsa yok döner.
fn install_mojang(root: &Path, major: u32, cancel: &AtomicBool, notify: &impl Fn(String)) -> Result<Option<PathBuf>> {
    let client = net::client()?;
    let index = net::json(&client, MOJANG_RUNTIMES)?;
    let Some((name, url, sha1)) = mojang_component(&index, major) else {
        return Ok(None);
    };
    notify(format!("Java {major}, Minecraft'ın resmî Java paketinden (Mojang) indiriliyor…"));
    let runtimes = root.join("runtimes");
    let manifest_path = runtimes.join(format!("mojang-{name}.json"));
    net::download(&client, &url, &manifest_path, &sha1, false)?;
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    let files = manifest["files"].as_object().context("Java paket listesi eksik")?;
    // Dosyalar önce sha1 adıyla (her içerik bir kez) indirilir, sonra yerine kopyalanır: aynı
    // klasördeki java.exe ve java.dll gibi dosyaların geçici adları böylece çakışmaz. Sabit
    // klasörler sayesinde yarıda kalan kurulum sonraki denemede kaldığı yerden sürer.
    let stage = runtimes.join(format!(".download-{name}"));
    let objects = runtimes.join(format!(".objects-{name}"));
    let mut placements = Vec::new();
    let mut jobs: Vec<(PathBuf, String, String)> = Vec::new();
    for (path, entry) in files {
        match entry["type"].as_str() {
            Some("directory") => fs::create_dir_all(net::safe_join(&stage, path)?)?,
            Some("file") => {
                let raw = &entry["downloads"]["raw"];
                let (Some(url), Some(sha1)) = (raw["url"].as_str(), raw["sha1"].as_str()) else {
                    bail!("Java paketinde eksik dosya bilgisi: {path}");
                };
                if !url.starts_with("https://piston-data.mojang.com/") || !hex(sha1, 40) {
                    bail!("Java paketinde geçersiz dosya kaynağı: {path}");
                }
                let object = objects.join(sha1);
                if !jobs.iter().any(|(p, ..)| *p == object) {
                    jobs.push((object.clone(), url.to_string(), sha1.to_string()));
                }
                placements.push((object, net::safe_join(&stage, path)?));
            }
            _ => {}
        }
    }
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let failure = Mutex::new(None::<String>);
    let workers = AtomicUsize::new(8);
    thread::scope(|scope| {
        for _ in 0..8 {
            let (client, jobs, next, done, failure, workers) = (&client, &jobs, &next, &done, &failure, &workers);
            scope.spawn(move || {
                struct Exit<'a>(&'a AtomicUsize);
                impl Drop for Exit<'_> {
                    fn drop(&mut self) {
                        self.0.fetch_sub(1, Ordering::Relaxed);
                    }
                }
                let _exit = Exit(workers);
                loop {
                    if cancel.load(Ordering::Relaxed) || failure.lock().is_ok_and(|f| f.is_some()) {
                        break;
                    }
                    let Some((path, url, sha1)) = jobs.get(next.fetch_add(1, Ordering::Relaxed)) else {
                        break;
                    };
                    if let Err(e) = net::download_cancellable(client, url, path, sha1, false, cancel) {
                        if let Ok(mut f) = failure.lock() {
                            *f = Some(format!("{e:#}"));
                        }
                        break;
                    }
                    done.fetch_add(1, Ordering::Relaxed);
                }
            });
        }
        // İlerleme yalnızca bu iş parçacığından bildirilir (bildirim işlevi paylaşılamaz).
        let mut last = usize::MAX;
        while workers.load(Ordering::Relaxed) > 0 {
            let count = done.load(Ordering::Relaxed);
            if count != last {
                last = count;
                notify(format!("Java {major} indiriliyor: {count} / {} dosya", jobs.len()));
            }
            thread::sleep(std::time::Duration::from_millis(300));
        }
    });
    if cancel.load(Ordering::Relaxed) {
        bail!("Java kurulumu iptal edildi. İndirilen dosyalar sonraki deneme için saklandı.");
    }
    if let Some(error) = failure.into_inner().ok().flatten() {
        bail!("Java dosyası indirilemedi: {error}");
    }
    for (object, target) in &placements {
        fs::create_dir_all(target.parent().context("Java dosya klasörü yok")?)?;
        fs::copy(object, target)?;
    }
    let java = stage.join("bin/java.exe");
    if java_major(&java)? != major {
        bail!("İndirilen Java sürümü eşleşmiyor.");
    }
    let destination = runtimes.join(major.to_string()).join(&name);
    if destination.exists() {
        fs::remove_dir_all(&destination)?;
    }
    fs::create_dir_all(runtimes.join(major.to_string()))?;
    fs::rename(&stage, &destination)?;
    // Kurulum tamamlandı; indirme önbelleği artık gerekmez (silinemezse kurulum yine geçerli).
    let _ = fs::remove_dir_all(&objects);
    Ok(Some(destination.join("bin/java.exe")))
}

/// Java'yı PatronLauncher klasörüne kurar: önce Minecraft'ın resmî Java paketi (Mojang),
/// o sürüm orada yoksa ya da indirilemezse Eclipse Temurin.
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
    match install_mojang(root, major, cancel, &notify) {
        Ok(Some(path)) => return Ok(path),
        Ok(None) => {}
        Err(error) if cancel.load(Ordering::Relaxed) => return Err(error),
        Err(error) => notify(format!("Mojang Java paketi kurulamadı ({error:#}); Eclipse Temurin deneniyor…")),
    }
    install_temurin(root, major, cancel, notify)
}
fn install_temurin(
    root: &Path,
    major: u32,
    cancel: &AtomicBool,
    notify: impl Fn(String),
) -> Result<PathBuf> {
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
    fn folder_names_hint_java_version() {
        assert_eq!(folder_major(Path::new(r"C:\Program Files\Java\jdk-21.0.2\bin\java.exe")), Some(21));
        assert_eq!(folder_major(Path::new(r"C:\Program Files\Java\jre1.8.0_401\bin\java.exe")), Some(8));
        assert_eq!(folder_major(Path::new(r"C:\Zulu\zulu25.0.1-ca\bin\java.exe")), Some(25));
        assert_eq!(folder_major(Path::new(r"C:\rt\java-runtime-delta\bin\java.exe")), None);
    }
    #[test]
    fn mojang_runtime_is_picked_by_major() {
        let index = serde_json::json!({"windows-x64": {
            "java-runtime-delta": [{"version": {"name": "21.0.7"}, "manifest": {"url": "https://piston-meta.mojang.com/v1/packages/a/manifest.json", "sha1": "cb4394a27089d19f65d5baa6cf0482c27c3c7865"}}],
            "java-runtime-epsilon": [{"version": {"name": "25.0.1"}, "manifest": {"url": "https://piston-meta.mojang.com/v1/packages/b/manifest.json", "sha1": "b374544c680d965fb5535977d7cb04c6befe1930"}}],
            "jre-legacy": [{"version": {"name": "8u51-cacert462b08"}, "manifest": {"url": "https://piston-meta.mojang.com/v1/packages/c/manifest.json", "sha1": "03828bb8455f3cef94869286a0d941dd16933239"}}],
            "java-runtime-evil": [{"version": {"name": "17.0.1"}, "manifest": {"url": "https://evil.invalid/manifest.json", "sha1": "03828bb8455f3cef94869286a0d941dd16933239"}}],
            "minecraft-java-exe": [{"version": {"name": "14"}, "manifest": {"url": "https://piston-meta.mojang.com/x", "sha1": "03828bb8455f3cef94869286a0d941dd16933239"}}]
        }});
        assert_eq!(mojang_component(&index, 25).unwrap().0, "java-runtime-epsilon");
        assert_eq!(mojang_component(&index, 21).unwrap().0, "java-runtime-delta");
        assert_eq!(mojang_component(&index, 8).unwrap().0, "jre-legacy");
        assert!(mojang_component(&index, 17).is_none());
        assert!(mojang_component(&index, 14).is_none());
    }
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
            detect(&root, "C:/does-not-exist-patronlauncher/java.exe", 99),
            JavaStatus::Missing { major: 99, .. }
        ));
        assert!(require(&root, "C:/does-not-exist-patronlauncher/java.exe", 99).is_err());
        assert!(!root.exists());
    }
}
