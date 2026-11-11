//! PClient: launcher'ın oyuncuya sunduğu kendi oyun istemcisi.
//!
//! PClient, PatronLauncher profillerinden tamamen ayrıdır. Profil listesinde görünmez; oyun
//! klasörü `<veri>/pclient/game` altındadır ve yalnızca başlatma anında, sabit kimlikli gizli bir
//! profille çalıştırılır. Oyuncunun seçili profili ve diğer profilleri hiç değişmez.
use crate::modrinth::Version;
use anyhow::{Context, Result};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
use uuid::Uuid;

/// PClient'ın varsayılan (en güncel) Minecraft sürümü.
pub const MINECRAFT: &str = "26.3";

/// PClient'ın bir Minecraft sürümü için yayını. Her sürüm ayrı derlenmiş bir PClient gerektirir;
/// `ready` olmayanlar arayüzde "Yakında" olarak gösterilir.
pub struct Release {
    pub minecraft: &'static str,
    pub loader: &'static str,
    pub ready: bool,
}
pub const RELEASES: &[Release] = &[
    Release { minecraft: MINECRAFT, loader: FABRIC_LOADER, ready: true },
    Release { minecraft: "26.2", loader: FABRIC_LOADER, ready: false },
    Release { minecraft: "26.1.2", loader: FABRIC_LOADER, ready: false },
    Release { minecraft: "1.21.11", loader: FABRIC_LOADER, ready: false },
    Release { minecraft: "1.21.8", loader: FABRIC_LOADER, ready: false },
    Release { minecraft: "1.21.4", loader: FABRIC_LOADER, ready: false },
    Release { minecraft: "1.20.1", loader: FABRIC_LOADER, ready: false },
];
pub const PROFILE_NAME: &str = "PClient";
/// PClient'ın derlendiği Fabric Loader sürümü (pclient-fabric/gradle.properties loader_version).
/// Sabit tutulur: ilk açılış Fabric sunucusundan sürüm listesi beklemez.
pub const FABRIC_LOADER: &str = "0.20.1";
/// Gizli PClient profilinin sabit kimliği ("PCLIENT" baytlarından türetilmiştir).
pub const PROFILE_ID: Uuid = Uuid::from_u128(0x5043_4c49_454e_5400_8000_0000_0000_0001);
/// Derleme sırasında gömülen mod (pclient-fabric çıktısı).
const JAR: &[u8] = include_bytes!("../resources/pclient/PClient.jar");
const JAR_NAME: &str = "PClient.jar";

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Stored {
    /// Eski sürümlerin profil listesine eklediği görünür profil (taşınınca temizlenir).
    #[serde(default)]
    profile: Option<Uuid>,
    /// İsteğe bağlı Fabric yükleyici sürümü (yoksa FABRIC_LOADER).
    #[serde(default)]
    loader: Option<String>,
    /// Oyuncunun seçtiği PClient Minecraft sürümü (yoksa MINECRAFT).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    minecraft: Option<String>,
    /// Minecraft sürümüne göre Sodium ve Lithium kararı.
    #[serde(default)]
    performance: HashMap<String, PerformanceChoice>,
    /// Kurulumun hangi mod listesiyle yapıldığı (sürüme göre).
    #[serde(default)]
    performance_revision: HashMap<String, u32>,
    /// Oyuncu "bir daha gösterme" dedi.
    #[serde(default)]
    performance_notice_hidden: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum PerformanceChoice {
    Installed,
    Declined,
}

/// Modrinth proje kimliği, mods klasöründeki sabit dosya adı ve zorunlu olup olmadığı.
/// Zorunlu olmayanlar bir Minecraft sürümü için yayımlanmamışsa atlanır.
const PERFORMANCE_MODS: [(&str, &str, bool); 6] = [
    ("sodium", "PatronPerf-sodium.jar", true),
    ("lithium", "PatronPerf-lithium.jar", true),
    ("ferrite-core", "PatronPerf-ferritecore.jar", false),
    ("immediatelyfast", "PatronPerf-immediatelyfast.jar", false),
    ("krypton", "PatronPerf-krypton.jar", false),
    ("badoptimizations", "PatronPerf-badoptimizations.jar", false),
];
/// Mod listesi değişince artar; eski kurulumlardaki oyuncudan yeni modlar için onay alınır.
const PERFORMANCE_REVISION: u32 = 2;
/// Modrinth'teki Sodium proje kimliği (Iris bağımlılığını eşlemek için).
const SODIUM_PROJECT: &str = "AANobbMI";
const SODIUM_JAR: &str = "PatronPerf-sodium.jar";
const IRIS_JAR: &str = "PatronPerf-iris.jar";

/// Arayüze gönderilen sürüm durumu.
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
pub struct ReleaseInfo {
    pub minecraft: String,
    pub ready: bool,
    pub installed: bool,
    pub selected: bool,
    /// "installed", "declined" ya da henüz sorulmadıysa None.
    pub performance: Option<&'static str>,
}

/// Seçili yayın; kayıttaki sürüm hazır değilse ya da bilinmiyorsa varsayılan.
pub fn selected(root: &Path) -> &'static Release {
    let wanted = read(root).minecraft;
    RELEASES
        .iter()
        .find(|r| r.ready && Some(r.minecraft) == wanted.as_deref())
        .unwrap_or(&RELEASES[0])
}

/// PClient sürümünü seçer; yalnızca hazır yayınlar seçilebilir.
pub fn select(root: &Path, minecraft: &str) -> Result<()> {
    let release = RELEASES
        .iter()
        .find(|r| r.minecraft == minecraft)
        .context("PClient bu Minecraft sürümünü desteklemiyor.")?;
    if !release.ready {
        anyhow::bail!("PClient {minecraft} henüz hazır değil.");
    }
    let mut stored = read(root);
    stored.minecraft = Some(minecraft.to_string());
    write(root, &stored)
}

/// Sürüm dosyaları indirilmiş ve PClient kurulmuşsa true.
fn installed(root: &Path, minecraft: &str) -> bool {
    root.join("minecraft").join("versions").join(minecraft).join(format!("{minecraft}.jar")).is_file()
        && game_dir(root).join("mods").join(JAR_NAME).is_file()
}

pub fn releases(root: &Path) -> Vec<ReleaseInfo> {
    let current = selected(root).minecraft;
    let stored = read(root);
    RELEASES
        .iter()
        .map(|r| ReleaseInfo {
            minecraft: r.minecraft.into(),
            ready: r.ready,
            installed: r.ready && installed(root, r.minecraft),
            selected: r.minecraft == current,
            performance: performance_state(root, &stored, r.minecraft),
        })
        .collect()
}

fn performance_dir(root: &Path, minecraft: &str) -> PathBuf {
    root.join("pclient").join("performance").join(minecraft)
}

fn performance_ready(root: &Path, minecraft: &str) -> bool {
    let dir = performance_dir(root, minecraft);
    PERFORMANCE_MODS.iter().filter(|(_, _, required)| *required).all(|(_, name, _)| dir.join(name).is_file())
}

fn performance_state(root: &Path, stored: &Stored, minecraft: &str) -> Option<&'static str> {
    match stored.performance.get(minecraft)? {
        // Dosyalar silinmişse oyuncuya yeniden sorulur.
        PerformanceChoice::Installed => (stored.performance_revision.get(minecraft) == Some(&PERFORMANCE_REVISION)
            && performance_ready(root, minecraft))
        .then_some("installed"),
        PerformanceChoice::Declined => Some("declined"),
    }
}

fn ready_release(minecraft: &str) -> Result<&'static Release> {
    RELEASES
        .iter()
        .find(|r| r.ready && r.minecraft == minecraft)
        .context("PClient bu Minecraft sürümü için hazır değil.")
}

fn fabric_versions(project: &str, minecraft: &str) -> Result<Vec<Version>> {
    let query = [("loaders", "[\"fabric\"]".to_string()), ("game_versions", format!("[\"{minecraft}\"]"))];
    Ok(serde_json::from_value(crate::modrinth::get(&format!("project/{project}/version"), &query)?)?)
}

/// Modrinth en yeniyi başa koyar; beta ve alfa yalnızca kararlı dosya yoksa kullanılır.
/// Beta bir Sodium'un kararlı Iris'i reddetmesi oyunu açılamaz hâle getirmişti.
fn newest_stable(versions: &[Version]) -> Option<&Version> {
    versions.iter().find(|v| v.version_type == "release").or_else(|| versions.first())
}

/// Bir modun bu Minecraft sürümüne ait en güncel kararlı Fabric dosyasını Modrinth'ten indirir.
/// Bu sürüm için yayımlanmamışsa false döner.
fn download_performance_mod(project: &str, minecraft: &str, target: &Path) -> Result<bool> {
    let versions = fabric_versions(project, minecraft)?;
    let Some(version) = newest_stable(&versions) else {
        return Ok(false);
    };
    download_version(version, project, target)?;
    Ok(true)
}

/// Dosya boyutu ve SHA-512 özeti `performance::receive_with` içinde doğrulanır.
fn download_version(version: &Version, project: &str, target: &Path) -> Result<()> {
    let file = version
        .files
        .iter()
        .find(|f| f.primary && f.filename.ends_with(".jar"))
        .or_else(|| version.files.iter().find(|f| f.filename.ends_with(".jar")))
        .with_context(|| format!("{project} için indirilecek dosya bulunamadı."))?;
    crate::performance::valid_file(file)?;
    let response = crate::performance::client(true)?.get(&file.url).send()?.error_for_status()?;
    let _ = fs::remove_file(target);
    crate::performance::receive_with(response, file, target, &AtomicBool::new(false), |_| {}, &[".jar"])
}

/// Bir modun `fabric.mod.json` dosyasındaki uyumluluk alanları.
#[derive(serde::Deserialize, Debug)]
struct FabricMeta {
    id: String,
    version: String,
    #[serde(default)]
    depends: HashMap<String, serde_json::Value>,
    #[serde(default)]
    breaks: HashMap<String, serde_json::Value>,
}

fn parse_fabric_meta(raw: &[u8]) -> Result<FabricMeta> {
    // Bazı modların JSON metinlerinde ham satır sonu bulunur; serde bunları reddeder.
    let clean: Vec<u8> = raw.iter().map(|b| if matches!(b, b'\n' | b'\r' | b'\t') { b' ' } else { *b }).collect();
    Ok(serde_json::from_slice(&clean)?)
}

fn fabric_meta(jar: &Path) -> Result<FabricMeta> {
    let mut zip = zip::ZipArchive::new(fs::File::open(jar)?)?;
    let mut raw = Vec::new();
    zip.by_name("fabric.mod.json")?.take(1024 * 1024).read_to_end(&mut raw)?;
    parse_fabric_meta(&raw)
}

fn version_numbers(version: &str) -> Vec<u64> {
    version
        .split(['+', '-'])
        .next()
        .unwrap_or("")
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let (a, b) = (version_numbers(a), version_numbers(b));
    (0..a.len().max(b.len()))
        .map(|i| a.get(i).unwrap_or(&0).cmp(b.get(i).unwrap_or(&0)))
        .find(|order| order.is_ne())
        .unwrap_or(std::cmp::Ordering::Equal)
}

/// Fabric sürüm koşulu: `*`, `0.9.x`, `<=1.2.3`, `<`, `>=`, `>`, `=` ve tam sürüm.
fn constraint_matches(constraint: &str, version: &str) -> bool {
    use std::cmp::Ordering::{Equal, Greater, Less};
    let constraint = constraint.trim();
    if constraint == "*" {
        return true;
    }
    if let Some(prefix) = constraint.strip_suffix(".x") {
        let want = version_numbers(prefix);
        return version_numbers(version).get(..want.len()) == Some(want.as_slice());
    }
    let order = |rest: &str| compare_versions(version, rest);
    if let Some(rest) = constraint.strip_prefix(">=") {
        order(rest) != Less
    } else if let Some(rest) = constraint.strip_prefix("<=") {
        order(rest) != Greater
    } else if let Some(rest) = constraint.strip_prefix('>') {
        order(rest) == Greater
    } else if let Some(rest) = constraint.strip_prefix('<') {
        order(rest) == Less
    } else {
        order(constraint.trim_start_matches(['=', '^', '~'])) == Equal
    }
}

/// Fabric'te dizi "bunlardan biri" demektir; alan yoksa koşul da yoktur.
fn any_constraint(value: Option<&serde_json::Value>, version: &str) -> Option<bool> {
    match value? {
        serde_json::Value::String(c) => Some(constraint_matches(c, version)),
        serde_json::Value::Array(list) => {
            Some(list.iter().filter_map(|c| c.as_str()).any(|c| constraint_matches(c, version)))
        }
        _ => None,
    }
}

/// Fabric Loader'ın başlangıçta reddedeceği bir eşleşme varsa false.
fn pair_compatible(sodium: &FabricMeta, iris: &FabricMeta) -> bool {
    any_constraint(iris.depends.get("sodium"), &sodium.version) != Some(false)
        && any_constraint(sodium.breaks.get("iris"), &iris.version) != Some(true)
        && any_constraint(iris.breaks.get("sodium"), &sodium.version) != Some(true)
}

/// En güncel kararlı Iris ve Iris'in Modrinth'te bildirdiği Sodium sürümü.
fn iris_pair(minecraft: &str) -> Result<(Version, Version)> {
    let irises = fabric_versions("iris", minecraft)?;
    let iris = newest_stable(&irises)
        .with_context(|| format!("Iris, Minecraft {minecraft} için henüz yayımlanmadı."))?
        .clone();
    let pinned = iris
        .dependencies
        .iter()
        .find(|d| d.dependency_type == "required" && d.project_id.as_deref() == Some(SODIUM_PROJECT))
        .and_then(|d| d.version_id.clone());
    let sodium = match pinned {
        Some(id) => {
            crate::modrinth::id(&id)?;
            serde_json::from_value(crate::modrinth::get(&format!("version/{id}"), &[])?)?
        }
        None => newest_stable(&fabric_versions("sodium", minecraft)?)
            .with_context(|| format!("Sodium, Minecraft {minecraft} için henüz yayımlanmadı."))?
            .clone(),
    };
    Ok((iris, sodium))
}

/// Iris'i uyumlu Sodium ile birlikte önbelleğe alır; dosyalar bir sonraki başlatmada mods klasörüne
/// geçer (oyun açıkken Sodium kilitli olur). İkisi birlikte doğrulanmadan önceki kurulum değişmez.
pub fn install_iris(root: &Path, minecraft: &str) -> Result<()> {
    ready_release(minecraft)?;
    anyhow::ensure!(
        read(root).performance.get(minecraft) == Some(&PerformanceChoice::Installed),
        "Iris için önce launcher'dan performans modlarını kur."
    );
    let dir = performance_dir(root, minecraft);
    let staging = dir.join(".iris-new");
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;
    let result = (|| -> Result<()> {
        let (iris, sodium) = iris_pair(minecraft)?;
        download_version(&iris, "iris", &staging.join(IRIS_JAR))?;
        download_version(&sodium, "sodium", &staging.join(SODIUM_JAR))?;
        anyhow::ensure!(
            pair_compatible(&fabric_meta(&staging.join(SODIUM_JAR))?, &fabric_meta(&staging.join(IRIS_JAR))?),
            "Iris {} ile Sodium {} bu Minecraft sürümünde uyumlu değil.",
            iris.version_number,
            sodium.version_number
        );
        for name in [SODIUM_JAR, IRIS_JAR] {
            fs::rename(staging.join(name), dir.join(name))?;
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

/// Elle ya da eski PClient'ın indirdiği Iris dosyaları.
fn stray_iris(mods: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(mods) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            name.ends_with(".jar")
                && name.contains("iris")
                && name != IRIS_JAR.to_lowercase()
                && fabric_meta(path).is_ok_and(|meta| meta.id == "iris")
        })
        .collect()
}

/// Sodium'la eşleşmeyen bir Iris oyunu daha menüye gelmeden kapatır. Dosya silinmez, kenara alınır
/// ve yerine uyumlu çift kurulur; internet yoksa oyun Iris'siz açılır.
fn adopt_stray_iris(root: &Path, profile: &crate::model::Profile) -> Result<()> {
    let mods = crate::mods::directory(root, profile)?.join("mods");
    let strays = stray_iris(&mods);
    if strays.is_empty() {
        return Ok(());
    }
    let disabled = game_dir(root).join("pclient").join("disabled-mods");
    fs::create_dir_all(&disabled)?;
    for path in strays {
        let target = disabled.join(path.file_name().context("Mod dosyası adı geçersiz")?);
        let _ = fs::remove_file(&target);
        fs::rename(&path, &target).context("Uyumsuz Iris dosyası kenara alınamadı")?;
    }
    if read(root).performance.get(&profile.version) == Some(&PerformanceChoice::Installed) {
        if let Err(error) = install_iris(root, &profile.version) {
            eprintln!("Uyumlu Iris kurulamadı: {error:#}");
        }
    }
    Ok(())
}

/// Tek düzenleme noktası: Discord ve web adresleri bu dosyadan okunur.
const SUPPORT: &str = include_str!("../resources/pclient/support.json");

fn support_links() -> [String; 2] {
    let links: serde_json::Value = serde_json::from_str(SUPPORT).unwrap_or_default();
    ["discord", "website"].map(|key| links[key].as_str().unwrap_or("").to_string())
}

/// Destek bağlantılarının alan adları harici bağlantı listesine eklenir.
pub fn is_support_host(host: Option<&str>) -> bool {
    host.is_some_and(|host| {
        support_links().iter().any(|link| reqwest::Url::parse(link).is_ok_and(|u| u.host_str() == Some(host)))
    })
}

/// Oyun çalışırken de açılabilecek tam destek adresleri.
pub fn is_support_url(url: &str) -> bool {
    !url.is_empty() && support_links().iter().any(|link| link == url)
}

fn write_support(root: &Path) -> Result<()> {
    let dir = game_dir(root).join("pclient");
    fs::create_dir_all(&dir)?;
    crate::profiles::atomic_write(&dir.join("support.json"), SUPPORT.as_bytes())
}

/// Performans modlarını indirir. Biri başarısız olursa karar kaydedilmez, oyuncuya yeniden sorulur.
pub fn install_performance(root: &Path, minecraft: &str) -> Result<()> {
    ready_release(minecraft)?;
    let dir = performance_dir(root, minecraft);
    fs::create_dir_all(&dir)?;
    for (project, name, required) in PERFORMANCE_MODS {
        let target = dir.join(name);
        let found = download_performance_mod(project, minecraft, &target)
            .with_context(|| format!("{project} indirilemedi"))?;
        if !found {
            anyhow::ensure!(!required, "{project}, Minecraft {minecraft} için henüz yayımlanmadı.");
            let _ = fs::remove_file(&target);
        }
    }
    let mut stored = read(root);
    stored.performance.insert(minecraft.to_string(), PerformanceChoice::Installed);
    stored.performance_revision.insert(minecraft.to_string(), PERFORMANCE_REVISION);
    write(root, &stored)?;
    // Sodium yenilendi: kurulu Iris'in eşi de yenilenir, olmuyorsa uyumsuz kalmasın diye kaldırılır.
    if dir.join(IRIS_JAR).is_file() {
        if let Err(error) = install_iris(root, minecraft) {
            eprintln!("Iris yenilenemedi: {error:#}");
            fs::remove_file(dir.join(IRIS_JAR))?;
        }
    }
    Ok(())
}

/// Oyuncu bu sürüm için istemiyor: dosyalar silinir, bir sonraki başlatmada mods klasöründen de çıkar.
pub fn decline_performance(root: &Path, minecraft: &str) -> Result<()> {
    ready_release(minecraft)?;
    let dir = performance_dir(root, minecraft);
    if dir.is_dir() {
        fs::remove_dir_all(&dir).context("Sodium ve Lithium dosyaları kaldırılamadı")?;
    }
    let mut stored = read(root);
    stored.performance.insert(minecraft.to_string(), PerformanceChoice::Declined);
    write(root, &stored)
}

pub fn performance_notice_hidden(root: &Path) -> bool {
    read(root).performance_notice_hidden
}

pub fn hide_performance_notice(root: &Path, hidden: bool) -> Result<()> {
    let mut stored = read(root);
    stored.performance_notice_hidden = hidden;
    write(root, &stored)
}

/// Başlatılacak sürümün kararını mods klasörüne yansıtır ve oyun içi uyarının tercihini yazar.
fn sync_performance(root: &Path, profile: &crate::model::Profile) -> Result<()> {
    let mods = crate::mods::directory(root, profile)?.join("mods");
    let stored = read(root);
    let wanted = stored.performance.get(&profile.version) == Some(&PerformanceChoice::Installed);
    let source = performance_dir(root, &profile.version);
    for name in PERFORMANCE_MODS.iter().map(|(_, name, _)| *name).chain([IRIS_JAR]) {
        let from = source.join(name);
        let target = mods.join(name);
        if wanted && from.is_file() {
            let bytes = fs::read(&from)?;
            if fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
                crate::profiles::atomic_write(&target, &bytes)?;
            }
        } else if target.is_file() {
            fs::remove_file(&target)?;
        }
    }
    let dir = game_dir(root).join("pclient");
    fs::create_dir_all(&dir)?;
    let body = serde_json::to_vec(&serde_json::json!({ "hide_notice": stored.performance_notice_hidden }))?;
    crate::profiles::atomic_write(&dir.join("performance.json"), &body)
}

fn record(root: &Path) -> PathBuf {
    root.join("pclient.json")
}

fn read(root: &Path) -> Stored {
    fs::read(record(root))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write(root: &Path, stored: &Stored) -> Result<()> {
    crate::profiles::atomic_write(&record(root), &serde_json::to_vec(stored)?)
}

/// PClient oyun klasörü (dünyalar, ayarlar, modlar).
pub fn game_dir(root: &Path) -> PathBuf {
    root.join("pclient").join("game")
}

/// Eski sürümün profil listesine eklediği görünür PClient profili (varsa).
pub fn legacy_profile(root: &Path) -> Option<Uuid> {
    read(root).profile.filter(|id| *id != PROFILE_ID)
}

/// Eski görünür profilin klasörünü PClient klasörüne taşır (dünyalar korunur) ve kaydı temizler.
pub fn migrate_legacy(root: &Path) -> Result<()> {
    let mut stored = read(root);
    let Some(old) = stored.profile.take() else {
        return Ok(());
    };
    let from = root.join("instances").join(old.to_string());
    let to = game_dir(root);
    if from.is_dir() && !to.exists() {
        fs::create_dir_all(to.parent().context("PClient klasörü geçersiz")?)?;
        fs::rename(&from, &to).context("Eski PClient klasörü taşınamadı")?;
    }
    write(root, &stored)
}

/// Gizli PClient profilini hazırlar: yükleyici sürümü (gerekirse bir kez çözülür), klasörler ve
/// gömülü PClient jar'ı. Dönen profil yalnızca bu başlatmada kullanılır, kayda yazılmaz.
pub fn prepare(root: &Path) -> Result<crate::model::Profile> {
    migrate_legacy(root)?;
    let release = selected(root);
    // Kayıtta özel bir sürüm yoksa PClient'ın derlendiği sürüm kullanılır.
    let loader = read(root).loader.unwrap_or_else(|| release.loader.to_string());
    crate::fabric::identifier(&loader)?;
    let profile = crate::model::Profile {
        appearance: Default::default(),
        kind: crate::model::ProfileKind::Custom,
        id: PROFILE_ID,
        name: PROFILE_NAME.into(),
        version: release.minecraft.into(),
        loader: crate::model::Loader::Fabric,
        loader_version: Some(loader),
    };
    crate::profiles::ensure_layout(root, &profile)?;
    install(root, &profile)?;
    adopt_stray_iris(root, &profile)?;
    sync_performance(root, &profile)?;
    // Oyun içi sunucu listesi launcher'daki listeyle aynıdır; yazılamazsa oyun yine açılır.
    if let Err(error) = write_servers(root) {
        eprintln!("PClient sunucu listesi yazılamadı: {error:#}");
    }
    if let Err(error) = write_support(root) {
        eprintln!("PClient destek bağlantıları yazılamadı: {error:#}");
    }
    Ok(profile)
}

/// Launcher sunucu listesini oyunun okuyacağı yere yazar: <oyun>/pclient/servers.json.
fn write_servers(root: &Path) -> Result<()> {
    let listing = crate::servers::load(root);
    let dir = game_dir(root).join("pclient");
    fs::create_dir_all(&dir)?;
    let body = serde_json::to_vec(&serde_json::json!({ "servers": listing.servers }))?;
    crate::profiles::atomic_write(&dir.join("servers.json"), &body)
}

/// Gömülü jar'ı mods klasörüne yazar; içerik aynıysa dokunmaz. Eski PClient kopyaları kaldırılır.
fn install(root: &Path, profile: &crate::model::Profile) -> Result<()> {
    let mods = crate::mods::directory(root, profile)?.join("mods");
    fs::create_dir_all(&mods)?;
    for entry in fs::read_dir(&mods)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let stale = name.starts_with("pclient") && name.ends_with(".jar") && name != JAR_NAME.to_lowercase();
        if stale && entry.file_type()?.is_file() {
            fs::remove_file(entry.path()).context("Eski PClient dosyası kaldırılamadı")?;
        }
    }
    let target = mods.join(JAR_NAME);
    if fs::read(&target).ok().as_deref() != Some(JAR) {
        crate::profiles::atomic_write(&target, JAR).context("PClient yazılamadı")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let root = std::env::temp_dir().join(format!("patronlauncher-pclient-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn pinned_loader_matches_the_mod_build() {
        let props = include_str!("../../../pclient-fabric/gradle.properties");
        assert!(props.lines().any(|l| l.trim() == format!("loader_version={FABRIC_LOADER}")));
        assert!(props.lines().any(|l| l.trim() == format!("minecraft_version={MINECRAFT}")));
    }

    #[test]
    fn bundled_jar_is_a_fabric_mod() {
        assert!(JAR.starts_with(b"PK"));
        assert!(String::from_utf8_lossy(JAR).contains("fabric.mod.json"));
    }

    #[test]
    fn pclient_lives_outside_launcher_profiles() {
        let root = temp();
        let profile = crate::model::Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: PROFILE_ID,
            name: PROFILE_NAME.into(),
            version: MINECRAFT.into(),
            loader: crate::model::Loader::Fabric,
            loader_version: Some("0.20.1".into()),
        };
        assert_eq!(crate::profiles::dir(&root, &profile), game_dir(&root));
        install(&root, &profile).unwrap();
        assert!(game_dir(&root).join("mods").join(JAR_NAME).is_file());
        assert!(!root.join("instances").join(PROFILE_ID.to_string()).exists());
        fs::remove_dir_all(root).unwrap();
    }

    fn profile_for(version: &str) -> crate::model::Profile {
        crate::model::Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: PROFILE_ID,
            name: PROFILE_NAME.into(),
            version: version.into(),
            loader: crate::model::Loader::Fabric,
            loader_version: Some(FABRIC_LOADER.into()),
        }
    }

    #[test]
    fn performance_choice_is_kept_per_version_and_synced_to_mods() {
        let root = temp();
        let profile = profile_for(MINECRAFT);
        install(&root, &profile).unwrap();
        let mods = game_dir(&root).join("mods");
        assert_eq!(releases(&root)[0].performance, None);

        let dir = performance_dir(&root, MINECRAFT);
        fs::create_dir_all(&dir).unwrap();
        for (_, name, _) in PERFORMANCE_MODS {
            fs::write(dir.join(name), b"jar").unwrap();
        }
        let mut stored = read(&root);
        stored.performance.insert(MINECRAFT.into(), PerformanceChoice::Installed);
        // Eski mod listesiyle kurulmuş oyuncudan yeni modlar için onay istenir.
        write(&root, &stored).unwrap();
        assert_eq!(releases(&root)[0].performance, None);
        stored.performance_revision.insert(MINECRAFT.into(), PERFORMANCE_REVISION);
        write(&root, &stored).unwrap();
        sync_performance(&root, &profile).unwrap();
        assert_eq!(releases(&root)[0].performance, Some("installed"));
        // Zorunlu olmayan bir mod bu sürüm için yayımlanmamış olabilir.
        fs::remove_file(dir.join("PatronPerf-krypton.jar")).unwrap();
        assert_eq!(releases(&root)[0].performance, Some("installed"));
        fs::write(dir.join("PatronPerf-krypton.jar"), b"jar").unwrap();
        assert!(PERFORMANCE_MODS.iter().all(|(_, name, _)| mods.join(name).is_file()));
        // Sürüm değişince önceki sürümün dosyaları oyuna karışmaz.
        sync_performance(&root, &profile_for("1.21.11")).unwrap();
        assert!(PERFORMANCE_MODS.iter().all(|(_, name, _)| !mods.join(name).exists()));

        decline_performance(&root, MINECRAFT).unwrap();
        sync_performance(&root, &profile).unwrap();
        assert_eq!(releases(&root)[0].performance, Some("declined"));
        assert!(!dir.exists());
        assert!(PERFORMANCE_MODS.iter().all(|(_, name, _)| !mods.join(name).exists()));
        assert!(decline_performance(&root, "1.20.1").is_err());

        hide_performance_notice(&root, true).unwrap();
        assert!(performance_notice_hidden(&root));
        sync_performance(&root, &profile).unwrap();
        let notice: serde_json::Value =
            serde_json::from_slice(&fs::read(game_dir(&root).join("pclient/performance.json")).unwrap()).unwrap();
        assert_eq!(notice["hide_notice"], true);
        fs::remove_dir_all(root).unwrap();
    }

    fn meta(json: &str) -> FabricMeta {
        parse_fabric_meta(json.as_bytes()).unwrap()
    }

    /// Oyuncunun karşılaştığı gerçek çakışma: beta Sodium, Iris 1.11.7'yi reddeder.
    #[test]
    fn sodium_beta_that_breaks_iris_is_rejected_and_the_pinned_pair_passes() {
        let iris = meta(r#"{"id":"iris","version":"1.11.7+mc26.3","depends":{"sodium":["0.9.x"]}}"#);
        let beta = meta(r#"{"id":"sodium","version":"0.9.3-beta.4+mc26.3","breaks":{"iris":"<=1.11.7"}}"#);
        let stable = meta(r#"{"id":"sodium","version":"0.9.2+mc26.3","breaks":{"canvas":"*"}}"#);
        let other_line = meta(r#"{"id":"sodium","version":"0.10.0+mc26.3"}"#);
        assert!(!pair_compatible(&beta, &iris));
        assert!(pair_compatible(&stable, &iris));
        assert!(!pair_compatible(&other_line, &iris));
    }

    #[test]
    fn fabric_constraints_follow_the_loader() {
        assert!(constraint_matches("*", "1.0"));
        assert!(constraint_matches("0.9.x", "0.9.2+mc26.3"));
        assert!(!constraint_matches("0.9.x", "0.10.0"));
        assert!(constraint_matches("<=1.11.7", "1.11.7+mc26.3"));
        assert!(!constraint_matches("<1.11.7", "1.11.7+mc26.3"));
        assert!(constraint_matches(">=0.16.0", "0.20.1"));
        assert!(!constraint_matches(">1.2", "1.2.0"));
        assert!(constraint_matches("1.2.3", "1.2.3+build"));
        // Mod metinlerindeki ham satır sonları okumayı bozmaz.
        assert_eq!(meta("{\"id\":\"a\",\"version\":\"1\",\"description\":\"x\ny\"}").id, "a");
    }

    fn version(kind: &str, number: &str) -> Version {
        serde_json::from_value(serde_json::json!({
            "id": number, "project_id": "p", "version_number": number, "version_type": kind,
            "date_published": "", "game_versions": [], "loaders": [], "files": [], "dependencies": [],
        }))
        .unwrap()
    }

    #[test]
    fn stable_versions_win_over_newer_betas() {
        let list = [version("beta", "2"), version("release", "1")];
        assert_eq!(newest_stable(&list).unwrap().version_number, "1");
        let only_beta = [version("alpha", "3"), version("beta", "2")];
        assert_eq!(newest_stable(&only_beta).unwrap().version_number, "3");
        assert!(newest_stable(&[]).is_none());
    }

    fn write_jar(path: &Path, id: &str) {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        zip.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
        write!(zip, r#"{{"id":"{id}","version":"1.0"}}"#).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn stray_iris_is_set_aside_so_the_game_can_start() {
        let root = temp();
        let profile = profile_for(MINECRAFT);
        install(&root, &profile).unwrap();
        let mods = game_dir(&root).join("mods");
        write_jar(&mods.join("iris-fabric-1.11.7+mc26.3.jar"), "iris");
        // Adında "iris" geçen başka bir moda ve yönetilen dosyaya dokunulmaz.
        write_jar(&mods.join("irisflw.jar"), "irisflw");
        write_jar(&mods.join(IRIS_JAR), "iris");
        adopt_stray_iris(&root, &profile).unwrap();
        assert!(!mods.join("iris-fabric-1.11.7+mc26.3.jar").exists());
        assert!(game_dir(&root).join("pclient/disabled-mods/iris-fabric-1.11.7+mc26.3.jar").is_file());
        assert!(mods.join("irisflw.jar").is_file());
        assert!(mods.join(IRIS_JAR).is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn support_file_is_well_formed() {
        let links: serde_json::Value = serde_json::from_str(SUPPORT).unwrap();
        for key in ["discord", "website", "presence"] {
            let link = links[key].as_str().unwrap();
            assert!(link.is_empty() || link.starts_with("https://"));
        }
        assert!(!is_support_url(""));
        assert!(!is_support_host(Some("evil.test")));
    }

    /// Yalnızca Modrinth API'sine bağlanır, dosya indirmez: cargo test live_iris_pair -- --ignored
    #[test]
    #[ignore]
    fn live_iris_pair_uses_the_sodium_iris_asks_for() {
        let (iris, sodium) = iris_pair(MINECRAFT).unwrap();
        assert_eq!(iris.version_type, "release");
        assert!(sodium.game_versions.iter().any(|v| v == MINECRAFT));
        println!("{} + {}", iris.version_number, sodium.version_number);
    }

    /// Modrinth'e gerçekten bağlanır: cargo test live_performance -- --ignored
    #[test]
    #[ignore]
    fn live_performance_mods_download_and_verify() {
        let root = temp();
        install_performance(&root, MINECRAFT).unwrap();
        let dir = performance_dir(&root, MINECRAFT);
        assert!(PERFORMANCE_MODS.iter().all(|(_, name, _)| dir.join(name).metadata().unwrap().len() > 0));
        assert_eq!(releases(&root)[0].performance, Some("installed"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_ready_releases_can_be_selected() {
        let root = temp();
        assert_eq!(selected(&root).minecraft, MINECRAFT);
        assert!(select(&root, "1.20.1").is_err());
        assert!(select(&root, "9.9").is_err());
        select(&root, MINECRAFT).unwrap();
        let list = releases(&root);
        assert_eq!(list.iter().filter(|r| r.selected).count(), 1);
        assert!(list.iter().all(|r| !r.installed));
        // Elle bozulmuş bir kayıt varsayılana döner.
        write(&root, &Stored { minecraft: Some("1.20.1".into()), ..Default::default() }).unwrap();
        assert_eq!(selected(&root).minecraft, MINECRAFT);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prepare_writes_the_server_list_for_the_game() {
        let root = temp();
        write_servers(&root).unwrap();
        let file = game_dir(&root).join("pclient").join("servers.json");
        let doc: serde_json::Value = serde_json::from_slice(&fs::read(file).unwrap()).unwrap();
        assert!(doc["servers"].as_array().is_some_and(|s| !s.is_empty()));
        assert!(doc["servers"][0]["address"].is_string());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_profile_folder_moves_with_worlds() {
        let root = temp();
        let old = Uuid::new_v4();
        let world = root.join("instances").join(old.to_string()).join("saves").join("Dunya");
        fs::create_dir_all(&world).unwrap();
        write(&root, &Stored { profile: Some(old), ..Default::default() }).unwrap();
        assert_eq!(legacy_profile(&root), Some(old));
        migrate_legacy(&root).unwrap();
        assert!(game_dir(&root).join("saves").join("Dunya").is_dir());
        assert_eq!(legacy_profile(&root), None);
        fs::write(record(&root), b"{bozuk").unwrap();
        assert_eq!(legacy_profile(&root), None);
        fs::remove_dir_all(root).unwrap();
    }
}
