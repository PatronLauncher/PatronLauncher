use crate::{
    auth,
    model::{Profile, State},
    net, profiles, runtime,
};
use anyhow::{Context, Result, bail};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Version {
    pub id: String,
    pub url: String,
    pub sha1: String,
    #[serde(rename = "type")]
    pub kind: String,
}
impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.id)
    }
}
pub type Notify = Arc<dyn Fn(String) + Send + Sync>;
/// Oyun ilk menüye ulaşınca gönderilen durum metninin başı (çekirdek bununla game_ready'yi açar).
pub const READY_STATUS: &str = "Minecraft açıldı";
/// PClient'ın yükleme ekranı bitince oyun çıktısına yazdığı işaret.
const READY_MARKER: &str = "PCLIENT_READY";
/// PClient modu sunucuya girince/çıkınca oyun çıktısına bunları yazar.
const SERVER_JOIN_MARKER: &str = "PCLIENT_SERVER_JOIN ";
const SERVER_LEFT_MARKER: &str = "PCLIENT_SERVER_LEFT";
/// Çekirdeğe giden, kullanıcıya gösterilmeyen sunucu durum iletileri.
pub const SERVER_JOIN_STATUS: &str = "game-server-join:";
pub const SERVER_CONNECT_STATUS: &str = "game-server-connect:";
pub const SERVER_LEFT_STATUS: &str = "game-server-left";

/// Oyun çıktısındaki bir satırı sunucu olayına çevirir. Sohbet satırları yok sayılır.
fn server_event(line: &str) -> Option<String> {
    if line.contains("[CHAT]") {
        return None;
    }
    if line.contains(SERVER_LEFT_MARKER) || line.contains("Starting integrated minecraft server") {
        return Some(SERVER_LEFT_STATUS.into());
    }
    if let Some((_, address)) = line.split_once(SERVER_JOIN_MARKER) {
        return Some(format!("{SERVER_JOIN_STATUS}{}", address.trim()));
    }
    let (_, target) = line.split_once("Connecting to ")?;
    let (host, port) = target.trim().rsplit_once(", ")?;
    port.parse::<u16>().ok()?;
    Some(format!("{SERVER_CONNECT_STATUS}{host}:{port}"))
}

fn supported(id: &str) -> bool {
    if let Some(rest) = id.strip_prefix("1.") {
        rest.split('.')
            .next()
            .and_then(|n| n.parse::<u32>().ok())
            .is_some_and(|n| n >= 13)
    } else {
        id.split('.')
            .next()
            .and_then(|n| n.parse::<u32>().ok())
            .is_some_and(|n| n >= 26)
    }
}
/// Sürüm listesi: ağdan koşullu istekle (ETag/Last-Modified) tazelenir; değişmediyse
/// sunucu yalnızca 304 döner. Ağ yoksa diskteki önbellek kullanılır.
pub fn versions(root: &Path) -> Result<Vec<Version>> {
    fs::create_dir_all(root)?;
    let network = crate::catalog::refresh(root);
    match cached_versions(root) {
        Some(Ok(list)) => Ok(list),
        Some(Err(e)) => Err(e),
        None => Err(anyhow::anyhow!(
            "Sürüm listesi indirilemedi, önbellek yok: {:#}",
            network.err().map(|e| format!("{e:#}")).unwrap_or_default()
        )),
    }
}
/// Yalnızca diskteki önbellekten okunan sürüm listesi (ağ isteği yok). Önbellek yoksa None.
pub fn cached_versions(root: &Path) -> Option<Result<Vec<Version>>> {
    let bytes = fs::read(root.join("version-manifest.json")).ok()?;
    Some((|| {
        let value: Value = serde_json::from_slice(&bytes)?;
        let all: Vec<Version> = serde_json::from_value(value["versions"].clone())?;
        Ok(all
            .into_iter()
            .filter(|v| v.kind == "release" && supported(&v.id))
            .collect())
    })())
}
fn s<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .with_context(|| format!("Minecraft tanımında {key} eksik"))
}
fn cancelled(flag: &AtomicBool) -> Result<()> {
    if flag.load(Ordering::Relaxed) {
        bail!("İşlem iptal edildi.");
    }
    Ok(())
}

pub(crate) fn allowed(rules: Option<&Value>) -> bool {
    let Some(rules) = rules.and_then(Value::as_array) else {
        return true;
    };
    let mut allow = false;
    for rule in rules {
        let os = &rule["os"];
        let name = os["name"].as_str().is_none_or(|n| n == "windows");
        let arch = os["arch"]
            .as_str()
            .is_none_or(|a| a == "x86_64" || a == "amd64");
        let version = os["version"]
            .as_str()
            .is_none_or(|v| Regex::new(v).is_ok_and(|re| re.is_match("10.0")));
        let features = rule["features"]
            .as_object()
            .is_none_or(|f| f.values().all(|v| v == false));
        if name && arch && version && features {
            allow = rule["action"] == "allow";
        }
    }
    allow
}
fn arguments(values: &Value, vars: &HashMap<&str, String>) -> Result<Vec<String>> {
    let mut result = vec![];
    for value in values.as_array().context("Başlatma argümanları eksik")? {
        let item = if value.is_string() {
            value
        } else {
            if !allowed(value.get("rules")) {
                continue;
            }
            &value["value"]
        };
        let strings: Vec<&str> = if let Some(v) = item.as_str() {
            vec![v]
        } else {
            item.as_array()
                .context("Geçersiz argüman")?
                .iter()
                .map(|v| v.as_str().context("Geçersiz argüman metni"))
                .collect::<Result<_>>()?
        };
        for value in strings {
            let mut value = value.to_string();
            for (key, replacement) in vars {
                value = value.replace(&format!("${{{key}}}"), replacement);
            }
            if value.contains("${") {
                bail!("Bu sürümün başlatma argümanları henüz desteklenmiyor.");
            }
            result.push(value);
        }
    }
    Ok(result)
}
fn artifact(
    client: &reqwest::blocking::Client,
    data: &Value,
    root: &Path,
    cancel: &AtomicBool,
) -> Result<PathBuf> {
    let path = net::safe_join(root, s(data, "path")?)?;
    net::download_cancellable(
        client,
        s(data, "url")?,
        &path,
        s(data, "sha1")?,
        false,
        cancel,
    )?;
    Ok(path)
}
/// Yükleyici kütüphanesi: adresi varsa doğrulanarak indirilir; yoksa kurulum adımının
/// ürettiği dosya yerinde olmalıdır (özet verilmişse denetlenir).
fn loader_artifact(
    client: &reqwest::blocking::Client,
    data: &Value,
    root: &Path,
    cancel: &AtomicBool,
) -> Result<PathBuf> {
    let url = data["url"].as_str().unwrap_or("");
    let path = net::safe_join(root, s(data, "path")?)?;
    let sha1 = data["sha1"].as_str().unwrap_or("");
    if url.is_empty() {
        if !path.is_file() {
            bail!("Yükleyici dosyası eksik; sürümü yeniden kurun: {}", path.display());
        }
        if sha1.len() == 40 && !crate::verified::is_verified(&path, sha1) {
            if !net::digest_file(&path, false)?.eq_ignore_ascii_case(sha1) {
                bail!("Yükleyici dosyası bozuk; sürümü yeniden kurun: {}", path.display());
            }
            crate::verified::remember(&path, sha1);
        }
        return Ok(path);
    }
    if !crate::forge::approved(url) {
        bail!("Yükleyici kütüphanesi izin verilen alan adlarının dışında.");
    }
    net::download_cancellable(client, url, &path, sha1, false, cancel)?;
    Ok(path)
}
/// Oyun açılır açılmaz bağlanılacak çok oyunculu sunucu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerTarget {
    pub host: String,
    /// Yoksa Minecraft adresin SRV kaydını kendisi çözer.
    pub port: Option<u16>,
}
pub fn launch(
    root: &Path,
    state: &State,
    version: &Version,
    cancel: Arc<AtomicBool>,
    notify: Notify,
) -> Result<()> {
    run(root, state, version, cancel, notify, false, None)
}
pub fn launch_to(
    root: &Path,
    state: &State,
    version: &Version,
    cancel: Arc<AtomicBool>,
    notify: Notify,
    server: Option<&ServerTarget>,
) -> Result<()> {
    run(root, state, version, cancel, notify, false, server)
}
/// 1.20+ sürümleri Quick Play argümanını tanır; eskiler --server/--port kullanır.
fn join_arguments(game_arguments: &Value, server: &ServerTarget) -> Vec<String> {
    if game_arguments.to_string().contains("quickPlayMultiplayer") {
        let target = match server.port {
            Some(port) => format!("{}:{port}", server.host),
            None => server.host.clone(),
        };
        vec!["--quickPlayMultiplayer".into(), target]
    } else {
        let mut args = vec!["--server".into(), server.host.clone()];
        if let Some(port) = server.port {
            args.extend(["--port".into(), port.to_string()]);
        }
        args
    }
}
pub fn install(
    root: &Path,
    state: &State,
    version: &Version,
    cancel: Arc<AtomicBool>,
    notify: Notify,
) -> Result<()> {
    run(root, state, version, cancel, notify, true, None)
}
fn run(
    root: &Path,
    state: &State,
    version: &Version,
    cancel: Arc<AtomicBool>,
    notify: Notify,
    download_only: bool,
    server: Option<&ServerTarget>,
) -> Result<()> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        bail!("Bu ilk sürüm Windows x64 içindir.");
    }
    let profile = state.profile().context("Bir oyun profili seçin.")?;
    if profile.version != version.id {
        bail!("Profil sürümü ile seçilen sürüm eşleşmiyor.");
    }
    let session = if download_only {
        None
    } else {
        let account = state.account().context("Bir hesap seçin.")?;
        notify("Oturum hazırlanıyor…".into());
        Some(auth::session(&account, &state.microsoft_client_id)?)
    };
    cancelled(&cancel)?;
    let client = net::client()?;
    let shared = root.join("minecraft");
    // Doğrulama önbelleği bu çalıştırma boyunca açık; kapanınca diske yazılır.
    let verified = crate::verified::Session::open(shared.join("verified-files.json"), root);
    let version_dir = net::safe_join(&shared.join("versions"), &version.id)?;
    let metadata_path = version_dir.join(format!("{}.json", version.id));
    net::download_cancellable(
        &client,
        &version.url,
        &metadata_path,
        &version.sha1,
        false,
        &cancel,
    )?;
    let vanilla: Value = serde_json::from_slice(&fs::read(metadata_path)?)?;
    let vanilla_major = vanilla["javaVersion"]["majorVersion"].as_u64().unwrap_or(8) as u32;
    // Forge/NeoForge/OptiFine kurulum adımları Java gerektirir; yalnızca o an istenir.
    let processor_java = || runtime::require(root, &state.java_path, vanilla_major);
    let metadata = crate::loaders::prepare(
        root,
        &profile,
        &vanilla,
        &processor_java,
        &cancel,
        &|s| notify(s),
    )?;
    let fabric_client = if matches!(
        profile.loader,
        crate::model::Loader::Fabric | crate::model::Loader::Quilt
    ) {
        Some(crate::fabric::client_any()?)
    } else {
        None
    };
    let loader_client = crate::forge::client()?;
    let major = metadata["javaVersion"]["majorVersion"]
        .as_u64()
        .unwrap_or(8) as u32;
    let java = if download_only {
        None
    } else {
        Some(runtime::require(root, &state.java_path, major)?)
    };
    cancelled(&cancel)?;
    notify(format!(
        "Minecraft {} indiriliyor ve doğrulanıyor…",
        version.id
    ));
    let jar = version_dir.join(format!("{}.jar", version.id));
    let data = &metadata["downloads"]["client"];
    net::download_cancellable(
        &client,
        s(data, "url")?,
        &jar,
        s(data, "sha1")?,
        false,
        &cancel,
    )?;
    let library_root = shared.join("libraries");
    let natives = version_dir.join("natives");
    fs::create_dir_all(&natives)?;
    let mut classpath = vec![];
    let libraries = metadata["libraries"]
        .as_array()
        .context("Kütüphane listesi eksik")?;
    for (index, lib) in libraries.iter().enumerate() {
        cancelled(&cancel)?;
        if !allowed(lib.get("rules")) {
            continue;
        }
        let library_client = if lib["patronlauncher_fabric"] == true {
            fabric_client
                .as_ref()
                .context("Fabric kütüphanesi vanilla profilinde kullanılamaz")?
        } else if lib["patronlauncher_loader"].is_string() {
            &loader_client
        } else {
            &client
        };
        if let Some(data) = lib["downloads"].get("artifact") {
            if lib["patronlauncher_fabric"] == true && !crate::fabric::approved_any(s(data, "url")?)
            {
                bail!("Fabric kütüphanesi izin verilen alan adlarının dışında.");
            }
            if lib["patronlauncher_loader"].is_string() {
                classpath.push(loader_artifact(library_client, data, &library_root, &cancel)?);
            } else {
                classpath.push(artifact(library_client, data, &library_root, &cancel)?);
            }
        }
        if let Some(classifier) = lib["natives"]["windows"].as_str() {
            let classifier = classifier.replace("${arch}", "64");
            let data = &lib["downloads"]["classifiers"][&classifier];
            let native = artifact(library_client, data, &library_root, &cancel)?;
            let excludes: Vec<String> = lib["extract"]["exclude"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            net::extract(&native, &natives, &excludes)?;
        }
        notify(format!("Kütüphaneler: {} / {}", index + 1, libraries.len()));
    }
    classpath.push(jar);
    let asset_root = shared.join("assets");
    let index_data = &metadata["assetIndex"];
    let index_id = s(index_data, "id")?;
    let index_path = net::safe_join(&asset_root.join("indexes"), &format!("{index_id}.json"))?;
    net::download_cancellable(
        &client,
        s(index_data, "url")?,
        &index_path,
        s(index_data, "sha1")?,
        false,
        &cancel,
    )?;
    let asset_index: Value = serde_json::from_slice(&fs::read(index_path)?)?;
    let mut hashes: Vec<String> = asset_index["objects"]
        .as_object()
        .context("Kaynak listesi eksik")?
        .values()
        .map(|v| s(v, "hash").map(String::from))
        .collect::<Result<_>>()?;
    hashes.sort_unstable();
    hashes.dedup();
    if hashes
        .iter()
        .any(|h| h.len() != 40 || !h.bytes().all(|c| c.is_ascii_hexdigit()))
    {
        bail!("Geçersiz kaynak özeti.");
    }
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let failure = Mutex::new(None::<String>);
    thread::scope(|scope| {
        for _ in 0..8 {
            let client = &client;
            let hashes = &hashes;
            let asset_root = &asset_root;
            let notify = &notify;
            let next = &next;
            let done = &done;
            let failure = &failure;
            let cancel = &cancel;
            scope.spawn(move || {
                loop {
                    if cancel.load(Ordering::Relaxed) || failure.lock().unwrap().is_some() {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(hash) = hashes.get(i) else {
                        break;
                    };
                    let relative = format!("{}/{hash}", &hash[..2]);
                    if let Err(e) = net::download_cancellable(
                        client,
                        &format!("https://resources.download.minecraft.net/{relative}"),
                        &asset_root.join("objects").join(relative),
                        hash,
                        false,
                        cancel,
                    ) {
                        *failure.lock().unwrap() = Some(e.to_string());
                        break;
                    }
                    let count = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if count.is_multiple_of(25) || count == hashes.len() {
                        notify(format!("Oyun kaynakları: {count} / {}", hashes.len()));
                    }
                }
            });
        }
    });
    if let Some(error) = failure.into_inner().unwrap() {
        bail!("Kaynak indirilemedi: {error}");
    }
    // Doğrulama bitti: kayıt oyun başlamadan diske yazılır.
    drop(verified);
    cancelled(&cancel)?;
    let game_dir = instance_dir(root, &profile);
    fs::create_dir_all(&game_dir)?;
    if crate::loaders::uses_mods(profile.loader) {
        fs::create_dir_all(game_dir.join("mods"))?;
    }
    crate::profile_management::record_install(root, &profile, version)?;
    crate::store::record(root, &profile, version, &cancel)?;
    if download_only {
        notify("Profil dosyaları indirildi ve doğrulandı.".into());
        return Ok(());
    }
    let session = session.context("Oturum eksik")?;
    let java = java.context("Java eksik")?;
    if profiles::snapshot(root, &profile)?.is_some() {
        notify("Profil ayarları yedeklendi.".into());
    }
    let cp = std::env::join_paths(&classpath)?
        .to_string_lossy()
        .into_owned();
    let vars = HashMap::from([
        ("auth_player_name", session.name),
        ("auth_uuid", session.uuid),
        ("auth_access_token", session.access_token.clone()),
        ("auth_xuid", session.xuid),
        ("clientid", state.microsoft_client_id.clone()),
        ("user_type", "msa".into()),
        ("version_name", s(&metadata, "id")?.into()),
        ("version_type", version.kind.clone()),
        ("game_directory", game_dir.to_string_lossy().into_owned()),
        ("assets_root", asset_root.to_string_lossy().into_owned()),
        ("assets_index_name", index_id.into()),
        ("natives_directory", natives.to_string_lossy().into_owned()),
        ("launcher_name", "PatronLauncher".into()),
        ("launcher_version", env!("CARGO_PKG_VERSION").into()),
        ("classpath", cp),
        ("classpath_separator", ";".into()),
        (
            "library_directory",
            library_root.to_string_lossy().into_owned(),
        ),
        ("user_properties", "{}".into()),
    ]);
    let mut args = arguments(&metadata["arguments"]["jvm"], &vars)?;
    args.push("-Xms512M".into());
    args.push(format!("-Xmx{}M", state.memory_mb.clamp(1024, 32768)));
    args.push(s(&metadata, "mainClass")?.into());
    args.extend(arguments(&metadata["arguments"]["game"], &vars)?);
    if let Some(server) = server {
        args.extend(join_arguments(&metadata["arguments"]["game"], server));
    }
    let log = Arc::new(Mutex::new(fs::File::create(
        game_dir.join("patronlauncher-game.log"),
    )?));
    notify("Minecraft başlatılıyor…".into());
    let mut child = runtime::quiet_command(&java)
        .args(args)
        .current_dir(&game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Minecraft başlatılamadı")?;
    notify(format!("Minecraft çalışıyor · işlem {}", child.id()));
    let mut readers = vec![];
    let token = session.access_token;
    let ready = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Some(out) = child.stdout.take() {
        readers.push(log_reader(out, log.clone(), token.clone(), Some((notify.clone(), ready.clone()))));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(log_reader(err, log, token, None));
    }
    let status = child.wait()?;
    // Some Windows helper processes can retain an inherited pipe after Java exits.
    // Drain normal output, but never keep the launcher busy waiting on that helper.
    let drain_deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
    while readers.iter().any(|reader| !reader.is_finished())
        && std::time::Instant::now() < drain_deadline
    {
        thread::sleep(std::time::Duration::from_millis(20));
    }
    for reader in readers {
        if reader.is_finished() {
            let _ = reader.join();
        }
    }
    if let Err(error) = profiles::snapshot(root, &profile) {
        notify(format!(
            "Oyun ayarları profil klasöründe duruyor; ek yedek oluşturulamadı: {error:#}"
        ));
    }
    if !status.success() {
        bail!(
            "Minecraft hata koduyla kapandı: {status}. Profil klasöründeki patronlauncher-game.log dosyasını kontrol edin."
        );
    }
    notify("Oyun kapandı. Yeniden oynamaya hazır.".into());
    Ok(())
}
fn log_reader(
    stream: impl std::io::Read + Send + 'static,
    file: Arc<Mutex<fs::File>>,
    token: String,
    ready: Option<(Notify, Arc<std::sync::atomic::AtomicBool>)>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(|line| line.ok()) {
            if let Some((notify, seen)) = &ready
                && line.contains(READY_MARKER)
                && !seen.swap(true, std::sync::atomic::Ordering::Relaxed)
            {
                notify(format!("{READY_STATUS}. İyi oyunlar!"));
            }
            if let Some((notify, _)) = &ready
                && let Some(event) = server_event(&line)
            {
                notify(event);
            }
            let line = if token != "0" {
                line.replace(&token, "[OTURUM GİZLENDİ]")
            } else {
                line
            };
            if let Ok(mut file) = file.lock() {
                let _ = writeln!(file, "{line}");
            }
        }
    })
}
pub fn instance_dir(root: &Path, profile: &Profile) -> PathBuf {
    profiles::dir(root, profile)
}

pub fn java_status(root: &Path, custom: &str, version: &Version) -> Result<runtime::JavaStatus> {
    let folder = net::safe_join(&root.join("minecraft/versions"), &version.id)?;
    let path = folder.join(format!("{}.json", version.id));
    net::download(&net::client()?, &version.url, &path, &version.sha1, false)?;
    let metadata: Value = serde_json::from_slice(&fs::read(path)?)?;
    let major = metadata["javaVersion"]["majorVersion"]
        .as_u64()
        .unwrap_or(8) as u32;
    Ok(runtime::detect(root, custom, major))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn server_lines_become_presence_events() {
        assert_eq!(
            server_event("[12:00:00] [Render thread/INFO]: Connecting to play.test.net, 25565").as_deref(),
            Some("game-server-connect:play.test.net:25565")
        );
        assert_eq!(
            server_event("[12:00:00] [Render thread/INFO] (PClient) PCLIENT_SERVER_JOIN play.test.net").as_deref(),
            Some("game-server-join:play.test.net")
        );
        assert_eq!(server_event("x PCLIENT_SERVER_LEFT").as_deref(), Some(SERVER_LEFT_STATUS));
        assert_eq!(server_event("[Server thread/INFO]: Starting integrated minecraft server version 26.3").as_deref(), Some(SERVER_LEFT_STATUS));
        assert_eq!(server_event("[CHAT] Connecting to evil.net, 25565"), None);
        assert_eq!(server_event("Connecting to nowhere"), None);
    }
    #[test]
    fn windows_rules_and_features() {
        assert!(allowed(None));
        assert!(allowed(Some(
            &json!([{"action":"allow","os":{"name":"windows"}}])
        )));
        assert!(!allowed(Some(
            &json!([{"action":"allow","os":{"name":"linux"}}])
        )));
        assert!(!allowed(Some(
            &json!([{"action":"allow","os":{"arch":"x86"}}])
        )));
        assert!(!allowed(Some(
            &json!([{"action":"allow","features":{"is_demo_user":true}}])
        )));
        assert!(!allowed(Some(
            &json!([{"action":"allow"},{"action":"disallow","os":{"name":"windows"}}])
        )));
    }
    #[test]
    fn expands_without_shell_interpretation() {
        let vars = HashMap::from([("game_directory", "C:/a path/world".into())]);
        assert_eq!(
            arguments(&json!(["--gameDir", "${game_directory}"]), &vars).unwrap(),
            vec!["--gameDir", "C:/a path/world"]
        );
        assert!(arguments(&json!(["${unknown}"]), &vars).is_err());
    }
    #[test]
    fn supported_versions() {
        assert!(supported("1.13"));
        assert!(supported("1.21.11"));
        assert!(supported("26.3"));
        assert!(!supported("1.12.2"));
    }
    #[test]
    fn join_arguments_follow_quick_play_support() {
        let server = super::ServerTarget { host: "play.example.net".into(), port: Some(25566) };
        let modern = serde_json::json!(["--quickPlayMultiplayer", "${quickPlayMultiplayer}"]);
        assert_eq!(
            super::join_arguments(&modern, &server),
            ["--quickPlayMultiplayer", "play.example.net:25566"]
        );
        let old = serde_json::json!(["--username", "${auth_player_name}"]);
        assert_eq!(
            super::join_arguments(&old, &server),
            ["--server", "play.example.net", "--port", "25566"]
        );
        let srv = super::ServerTarget { host: "play.example.net".into(), port: None };
        assert_eq!(super::join_arguments(&modern, &srv), ["--quickPlayMultiplayer", "play.example.net"]);
    }
}
