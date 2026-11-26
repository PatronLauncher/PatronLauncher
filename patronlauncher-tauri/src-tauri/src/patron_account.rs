//! PatronLauncher hesabı (Minecraft hesaplarından ayrı): cihaz girişi (RFC 8628), oturum anahtarı
//! Windows Kimlik Bilgileri Yöneticisi'nde, oyun etkinliği bildirimi ve "Yardım al" adresi.
//!
//! Launcher şifre görmez: kod gösterilir, oyuncu patronlauncher.net/device sayfasında onaylar, launcher
//! yalnızca oturum anahtarını alır. Anahtar yalnızca `/api/launcher/*` isteklerinde gönderilir.
use anyhow::{Context, Result, anyhow, bail};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError, Sender},
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const SERVICE: &str = "PatronLauncher.Account";
const SECRET_KEY: &str = "session";
const CLIENT_ID: &str = "patronlauncher-launcher";
const CACHE_FILE: &str = "patron-account.json";
pub const EVENT: &str = "patronlauncher://patron-account";
/// Oyun açıkken etkinlik bildirimi aralığı (site iki bildirim arasını en fazla 150 sn sayar).
const BEAT: Duration = Duration::from_secs(60);
const SUPPORT: &str = include_str!("../resources/pclient/support.json");
const PCLIENT_JAR: &[u8] = include_bytes!("../resources/pclient/PClient.jar");

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum State {
    #[default]
    SignedOut,
    Pending,
    SignedIn,
}

/// Arayüze giden durum (olay ve `patron_account_status`).
#[derive(Clone, Debug, Default, Serialize)]
pub struct Status {
    pub state: State,
    /// Bekleyen girişte launcher'da gösterilen kod (ABCD-EFGH).
    pub code: Option<String>,
    pub username: Option<String>,
    pub display: Option<String>,
    pub profile_url: Option<String>,
    /// Son hata (ör. kod süresi doldu, reddedildi).
    pub error: Option<String>,
    /// Site şu an ulaşılamıyor; hesap bilgisi önbellekten.
    pub offline: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct Cache {
    username: Option<String>,
    display: Option<String>,
    profile_url: Option<String>,
}

struct Inner {
    app: Option<AppHandle>,
    root: PathBuf,
    status: Status,
    /// Bekleyen girişi iptal etmek için.
    cancel: Option<Arc<AtomicBool>>,
    /// Bekleyen girişin tarayıcı adresi (yeniden açmak için).
    verify_url: Option<String>,
    lang: String,
}

fn inner() -> &'static Mutex<Inner> {
    static INNER: OnceLock<Mutex<Inner>> = OnceLock::new();
    INNER.get_or_init(|| {
        Mutex::new(Inner { app: None, root: PathBuf::new(), status: Status::default(), cancel: None, verify_url: None, lang: "en".into() })
    })
}

fn lock() -> std::sync::MutexGuard<'static, Inner> {
    inner().lock().unwrap_or_else(|e| e.into_inner())
}

/// Durumu değiştirir ve arayüze bildirir.
fn set_status(update: impl FnOnce(&mut Status)) {
    let (app, status) = {
        let mut g = lock();
        update(&mut g.status);
        (g.app.clone(), g.status.clone())
    };
    if let Some(app) = app {
        let _ = app.emit_to("main", EVENT, status);
    }
}

pub fn status() -> Status {
    lock().status.clone()
}

// ── Site adresi ─────────────────────────────────────────────────────────────────────────────────────

/// support.json'daki site; `PATRONLAUNCHER_WEB` yerel deneme için ezer (http yalnızca localhost'ta).
pub(crate) fn base_url() -> Result<String> {
    let configured = std::env::var("PATRONLAUNCHER_WEB").ok().filter(|v| !v.trim().is_empty());
    let raw = match configured {
        Some(v) => v,
        None => serde_json::from_str::<Value>(SUPPORT)?["website"].as_str().unwrap_or("").to_string(),
    };
    valid_base(&raw).ok_or_else(|| anyhow!("PatronLauncher web adresi geçersiz."))
}

fn valid_base(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    let ok = (url.scheme() == "https" || (url.scheme() == "http" && local))
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none();
    ok.then(|| url.as_str().trim_end_matches('/').to_string())
}

/// Site dil öneki: İngilizce öneksiz, diğerleri /xx.
fn lang_prefix(lang: &str) -> String {
    const SITE: [&str; 9] = ["tr", "de", "es", "fr", "it", "pl", "pt", "ru", "hi"];
    if SITE.contains(&lang) { format!("/{lang}") } else { String::new() }
}

pub(crate) fn client(base: &str) -> Result<Client> {
    Ok(Client::builder()
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .https_only(base.starts_with("https://"))
        .build()?)
}

// ── Oturum anahtarı ve önbellek ────────────────────────────────────────────────────────────────────

fn entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, SECRET_KEY)?)
}
pub(crate) fn read_token() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}
fn save_token(token: &str) -> Result<()> {
    entry()?.set_password(token).context("Oturum Windows Kimlik Bilgileri Yöneticisi'ne kaydedilemedi.")
}
fn forget_token() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}
fn cache_path(root: &Path) -> PathBuf {
    root.join(CACHE_FILE)
}
fn read_cache(root: &Path) -> Cache {
    std::fs::read(cache_path(root)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn write_cache(root: &Path, cache: &Cache) {
    if let Ok(bytes) = serde_json::to_vec(cache) {
        let _ = crate::profiles::atomic_write(&cache_path(root), &bytes);
    }
}

/// Siteden hesap özetini alır. `Ok(None)`: oturum geçersiz (çıkış yapılmış ya da kapatılmış).
fn fetch_me(token: &str, lang: &str) -> Result<Option<Cache>> {
    let base = base_url()?;
    let res = client(&base)?
        .get(format!("{base}/api/launcher/me?lang={lang}"))
        .bearer_auth(token)
        .send()?;
    if res.status().as_u16() == 401 {
        return Ok(None);
    }
    let body: Value = res.error_for_status()?.json()?;
    let text = |k: &str| body[k].as_str().map(str::to_string);
    Ok(Some(Cache { username: text("username"), display: text("displayUsername"), profile_url: text("profileUrl") }))
}

fn signed_in(cache: &Cache, offline: bool) -> impl FnOnce(&mut Status) + '_ {
    move |s| {
        *s = Status {
            state: State::SignedIn,
            username: cache.username.clone(),
            display: cache.display.clone().or_else(|| cache.username.clone()),
            profile_url: cache.profile_url.clone(),
            offline,
            ..Status::default()
        }
    }
}

/// Uygulama açılışında: kayıtlı oturum varsa hesabı yükler; etkinlik bildiricisini başlatır.
pub fn start(app: AppHandle, root: &Path) {
    {
        let mut g = lock();
        g.app = Some(app);
        g.root = root.to_path_buf();
    }
    reporter();
    if read_token().is_none() {
        return;
    }
    let cache = read_cache(root);
    set_status(signed_in(&cache, true));
    let root = root.to_path_buf();
    thread::spawn(move || refresh(&root));
}

/// Hesap özetini siteden yeniler; oturum kapatılmışsa yerelde de çıkış yapar.
fn refresh(root: &Path) {
    let Some(token) = read_token() else { return };
    let lang = lock().lang.clone();
    match fetch_me(&token, &lang) {
        Ok(Some(cache)) => {
            write_cache(root, &cache);
            set_status(signed_in(&cache, false));
        }
        Ok(None) => sign_out_locally(),
        Err(_) => set_status(|s| s.offline = true),
    }
}

/// Arayüz dili değişince profil bağlantısı o dilde yenilenir.
pub fn set_language(lang: &str) {
    let lang = clean_lang(lang);
    let changed = {
        let mut g = lock();
        let changed = g.lang != lang;
        g.lang = lang;
        changed && g.status.state == State::SignedIn
    };
    if changed {
        let root = lock().root.clone();
        thread::spawn(move || refresh(&root));
    }
}

fn clean_lang(lang: &str) -> String {
    if lang.len() == 2 && lang.chars().all(|c| c.is_ascii_lowercase()) { lang.to_string() } else { "en".into() }
}

fn sign_out_locally() {
    forget_token();
    let root = lock().root.clone();
    let _ = std::fs::remove_file(cache_path(&root));
    set_status(|s| *s = Status::default());
}

// ── Cihaz girişi ───────────────────────────────────────────────────────────────────────────────────

/// "ABCDEFGH" → "ABCD-EFGH" (okunması kolay).
pub fn display_code(code: &str) -> String {
    let clean: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    if clean.len() == 8 { format!("{}-{}", &clean[..4], &clean[4..]) } else { clean }
}

#[derive(Debug, PartialEq)]
enum Poll {
    Pending,
    SlowDown,
    Token(String),
    Denied,
    Expired,
}

/// /device/token yanıtını yorumlar.
fn read_poll(status: u16, body: &Value) -> Result<Poll> {
    if status == 200 {
        return body["access_token"]
            .as_str()
            .filter(|t| !t.is_empty())
            .map(|t| Poll::Token(t.into()))
            .ok_or_else(|| anyhow!("Sunucu yanıtı eksik."));
    }
    Ok(match body["error"].as_str().unwrap_or("") {
        "authorization_pending" => Poll::Pending,
        "slow_down" => Poll::SlowDown,
        "access_denied" => Poll::Denied,
        "expired_token" | "invalid_grant" => Poll::Expired,
        other => bail!("Giriş tamamlanamadı ({status} {other})."),
    })
}

/// Girişi başlatır: kod alınır, tarayıcıda onay sayfası açılır, onay arka planda beklenir.
pub fn login(lang: &str) -> Result<Status> {
    if lock().status.state == State::Pending {
        reopen()?;
        return Ok(status());
    }
    // Boş dil (oyun içinden): launcher arayüzünün dili kullanılır.
    let lang = if lang.is_empty() { lock().lang.clone() } else { clean_lang(lang) };
    lock().lang = lang.clone();
    let base = base_url()?;
    let http = client(&base)?;
    let res = http
        .post(format!("{base}/api/auth/device/code"))
        .json(&json!({ "client_id": CLIENT_ID }))
        .send()
        .context("PatronLauncher sitesine ulaşılamadı.")?;
    let body: Value = res.error_for_status().context("PatronLauncher sitesi girişi başlatamadı.")?.json()?;
    let device_code = body["device_code"].as_str().ok_or_else(|| anyhow!("Sunucu yanıtı eksik."))?.to_string();
    let user_code = body["user_code"].as_str().ok_or_else(|| anyhow!("Sunucu yanıtı eksik."))?.to_string();
    let interval = body["interval"].as_u64().unwrap_or(5).clamp(2, 60);
    let expires = body["expires_in"].as_u64().unwrap_or(600).clamp(60, 1800);
    // Onay sayfası oyuncunun dilinde; kod adreste hazır gelir.
    let verify = format!("{base}{}/device?user_code={}", lang_prefix(&lang), user_code);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut g = lock();
        g.cancel = Some(cancel.clone());
        g.verify_url = Some(verify.clone());
    }
    set_status(|s| {
        *s = Status { state: State::Pending, code: Some(display_code(&user_code)), ..Status::default() };
    });
    let _ = webbrowser::open(&verify);
    thread::spawn(move || {
        let result = wait_for_approval(&http, &base, &device_code, interval, expires, &cancel);
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        {
            let mut g = lock();
            g.cancel = None;
            g.verify_url = None;
        }
        if let Err(e) = result.and_then(|token| finish(&token)) {
            set_status(|s| *s = Status { error: Some(format!("{e:#}")), ..Status::default() });
        }
    });
    Ok(status())
}

fn wait_for_approval(http: &Client, base: &str, device_code: &str, interval: u64, expires: u64, cancel: &AtomicBool) -> Result<String> {
    let deadline = Instant::now() + Duration::from_secs(expires);
    let mut wait = Duration::from_secs(interval);
    while Instant::now() < deadline {
        // Kısa adımlarla beklenir ki iptal hemen işlesin.
        let until = Instant::now() + wait;
        while Instant::now() < until {
            if cancel.load(Ordering::Relaxed) {
                bail!("cancelled");
            }
            thread::sleep(Duration::from_millis(200));
        }
        let res = http
            .post(format!("{base}/api/auth/device/token"))
            .json(&json!({ "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": device_code, "client_id": CLIENT_ID }))
            .send();
        let Ok(res) = res else { continue };
        let code = res.status().as_u16();
        let body: Value = res.json().unwrap_or_default();
        match read_poll(code, &body)? {
            Poll::Pending => {}
            Poll::SlowDown => wait += Duration::from_secs(5),
            Poll::Token(token) => return Ok(token),
            Poll::Denied => bail!("Giriş tarayıcıda reddedildi."),
            Poll::Expired => bail!("Kodun süresi doldu. Yeniden giriş yap."),
        }
    }
    bail!("Kodun süresi doldu. Yeniden giriş yap.")
}

fn finish(token: &str) -> Result<()> {
    save_token(token)?;
    let (root, lang) = {
        let g = lock();
        (g.root.clone(), g.lang.clone())
    };
    let cache = fetch_me(token, &lang)?.ok_or_else(|| anyhow!("Oturum açılamadı."))?;
    write_cache(&root, &cache);
    set_status(signed_in(&cache, false));
    Ok(())
}

/// Bekleyen girişin onay sayfasını yeniden açar.
pub fn reopen() -> Result<()> {
    let url = lock().verify_url.clone().ok_or_else(|| anyhow!("Bekleyen giriş yok."))?;
    webbrowser::open(&url).context("Tarayıcı açılamadı.")?;
    Ok(())
}

pub fn cancel() -> Status {
    let pending = {
        let mut g = lock();
        if let Some(flag) = g.cancel.take() {
            flag.store(true, Ordering::Relaxed);
        }
        g.verify_url = None;
        g.status.state == State::Pending
    };
    if pending {
        set_status(|s| *s = Status::default());
    }
    status()
}

/// Çıkış: oturum sitede de kapatılır (site ulaşılamazsa yalnızca yerelde).
pub fn logout() -> Status {
    if let Some(token) = read_token() {
        thread::spawn(move || {
            if let Ok(base) = base_url()
                && let Ok(http) = client(&base)
            {
                let _ = http.post(format!("{base}/api/launcher/signout")).bearer_auth(token).send();
            }
        });
    }
    sign_out_locally();
    status()
}

/// Profil sayfasını tarayıcıda açar.
pub fn open_profile() -> Result<()> {
    let url = lock().status.profile_url.clone().ok_or_else(|| anyhow!("Profil adresi yok."))?;
    let base = base_url()?;
    if !url.starts_with(&format!("{base}/")) {
        bail!("Profil adresi beklenen sitede değil.");
    }
    webbrowser::open(&url).context("Tarayıcı açılamadı.")?;
    Ok(())
}

/// Başka bir oyuncunun site profilini tarayıcıda açar (arkadaşlar menüsü). Ad sitenin kuralıyla denetlenir.
pub fn open_player(username: &str) -> Result<()> {
    let name = username.trim().to_ascii_lowercase();
    if !(3..=16).contains(&name.len()) || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        bail!("Kullanıcı adı geçersiz.");
    }
    webbrowser::open(&format!("{}/u/{name}", base_url()?)).context("Tarayıcı açılamadı.")?;
    Ok(())
}

/// Launcher'daki Microsoft girişinin bitiş sayfası (oyuncunun dilinde).
pub fn login_complete_url(status: &str) -> Option<String> {
    let status = match status {
        "ok" | "cancelled" | "error" => status,
        _ => "error",
    };
    let base = base_url().ok()?;
    let lang = lock().lang.clone();
    Some(format!("{base}{}/login-complete?status={status}", lang_prefix(&lang)))
}

// ── Yardım al ──────────────────────────────────────────────────────────────────────────────────────

/// Paketteki PClient.jar'ın sürümü (fabric.mod.json).
fn pclient_version() -> Option<String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(PCLIENT_JAR)).ok()?;
    let file = zip.by_name("fabric.mod.json").ok()?;
    let json: Value = serde_json::from_reader(file).ok()?;
    json["version"].as_str().map(str::to_string)
}

/// "Windows 11 (26100)" gibi; okunamazsa "Windows".
fn os_name() -> String {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let build = std::process::Command::new("cmd")
        .args(["/C", "ver"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|v| windows_build(&v));
    match build {
        Some(b) if b >= 22000 => format!("Windows 11 ({b})"),
        Some(b) => format!("Windows 10 ({b})"),
        None => "Windows".into(),
    }
}

/// `ver` çıktısından derleme numarası: "Microsoft Windows [Version 10.0.22631.4460]" → 22631.
fn windows_build(ver: &str) -> Option<u32> {
    let start = ver.find("10.0.")? + 5;
    ver[start..].split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

/// Sitenin destek formu, launcher/PClient sürümü ve işletim sistemiyle doldurulmuş.
pub fn help_url(lang: &str, minecraft: Option<&str>) -> Result<String> {
    let base = base_url()?;
    let mut url = reqwest::Url::parse(&format!("{base}{}/support", lang_prefix(lang)))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("v", env!("CARGO_PKG_VERSION"));
        if let Some(v) = pclient_version() {
            q.append_pair("pclient", &v);
        }
        q.append_pair("os", &os_name());
        if let Some(mc) = minecraft.filter(|m| !m.is_empty() && m.len() <= 32) {
            q.append_pair("mc", mc);
        }
    }
    Ok(url.to_string())
}

pub fn open_help(lang: &str, minecraft: Option<&str>) -> Result<()> {
    let url = help_url(lang, minecraft)?;
    webbrowser::open(&url).context("Tarayıcı açılamadı.")?;
    Ok(())
}

// ── Oyun etkinliği ─────────────────────────────────────────────────────────────────────────────────

enum Activity {
    Prepare { version: String, pclient: bool },
    Started,
    Server(Option<String>),
    Stopped,
}

fn reporter_tx() -> &'static Mutex<Option<Sender<Activity>>> {
    static TX: OnceLock<Mutex<Option<Sender<Activity>>>> = OnceLock::new();
    TX.get_or_init(|| Mutex::new(None))
}

fn send(event: Activity) {
    if let Some(tx) = reporter_tx().lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        let _ = tx.send(event);
    }
}

/// Oyun başlatılmadan önce sürüm bilgisi (başlatma kodundan).
pub fn game_preparing(version: &str, pclient: bool) {
    send(Activity::Prepare { version: version.to_string(), pclient });
}
/// Oyun penceresi açıldı (Discord etkinliğiyle aynı an).
pub fn game_started() {
    send(Activity::Started);
}
/// Oyuncunun bağlandığı sunucu (None: sunucudan çıktı / tek oyunculu).
pub fn game_server(address: Option<&str>) {
    send(Activity::Server(address.map(str::to_string)));
}
pub fn game_stopped() {
    send(Activity::Stopped);
}

fn post_activity(body: Value) {
    let Some(token) = read_token() else { return };
    let Ok(base) = base_url() else { return };
    let Ok(http) = client(&base) else { return };
    // Oturum sitede kapatılmışsa launcher'da da çıkış yapılır.
    if let Ok(res) = http.post(format!("{base}/api/launcher/activity")).bearer_auth(token).json(&body).send()
        && res.status().as_u16() == 401
    {
        sign_out_locally();
    }
}

/// Etkinlik iş parçacığı: başlangıç, dakikada bir "beat" (sunucuyla), bitiş. Giriş yoksa hiçbir şey gönderilmez.
fn reporter() {
    let mut slot = reporter_tx().lock().unwrap_or_else(|e| e.into_inner());
    if slot.is_some() {
        return;
    }
    let (tx, rx) = mpsc::channel::<Activity>();
    *slot = Some(tx);
    thread::spawn(move || {
        let mut version: Option<String> = None;
        let mut pclient = false;
        let mut running = false;
        let mut server: Option<String> = None;
        let mut next_beat = Instant::now() + BEAT;
        loop {
            let timeout = if running { next_beat.saturating_duration_since(Instant::now()) } else { Duration::from_secs(3600) };
            match rx.recv_timeout(timeout) {
                Ok(Activity::Prepare { version: v, pclient: p }) => {
                    version = Some(v);
                    pclient = p;
                }
                Ok(Activity::Started) => {
                    running = true;
                    server = None;
                    next_beat = Instant::now() + BEAT;
                    post_activity(json!({ "event": "start", "version": version, "pclient": pclient }));
                }
                Ok(Activity::Server(address)) => {
                    if !running || address == server {
                        continue;
                    }
                    server = address;
                    next_beat = Instant::now() + BEAT;
                    post_activity(json!({ "event": "beat", "version": version, "pclient": pclient, "server": server }));
                }
                Ok(Activity::Stopped) => {
                    if running {
                        running = false;
                        server = None;
                        post_activity(json!({ "event": "stop" }));
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if running {
                        next_beat = Instant::now() + BEAT;
                        post_activity(json!({ "event": "beat", "version": version, "pclient": pclient, "server": server }));
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_shown_in_two_groups() {
        assert_eq!(display_code("abcdefgh"), "ABCD-EFGH");
        assert_eq!(display_code("ABCD-EFGH"), "ABCD-EFGH");
        assert_eq!(display_code("abc"), "ABC");
    }

    #[test]
    fn only_https_or_local_http_bases_are_used() {
        assert_eq!(valid_base("https://patronlauncher.net").as_deref(), Some("https://patronlauncher.net"));
        assert_eq!(valid_base("https://patronlauncher.net/").as_deref(), Some("https://patronlauncher.net"));
        assert_eq!(valid_base("http://localhost:4321").as_deref(), Some("http://localhost:4321"));
        assert_eq!(valid_base("http://evil.example"), None);
        assert_eq!(valid_base("https://a@patronlauncher.net"), None);
        assert_eq!(valid_base("https://patronlauncher.net/?x=1"), None);
        assert_eq!(valid_base("not a url"), None);
    }

    #[test]
    fn language_prefix_matches_the_site() {
        assert_eq!(lang_prefix("en"), "");
        assert_eq!(lang_prefix("tr"), "/tr");
        assert_eq!(lang_prefix("xx"), "");
        assert_eq!(clean_lang("TR; drop"), "en");
    }

    #[test]
    fn token_poll_answers_are_understood() {
        assert_eq!(read_poll(400, &json!({ "error": "authorization_pending" })).unwrap(), Poll::Pending);
        assert_eq!(read_poll(400, &json!({ "error": "slow_down" })).unwrap(), Poll::SlowDown);
        assert_eq!(read_poll(400, &json!({ "error": "access_denied" })).unwrap(), Poll::Denied);
        assert_eq!(read_poll(400, &json!({ "error": "expired_token" })).unwrap(), Poll::Expired);
        assert_eq!(read_poll(200, &json!({ "access_token": "abc" })).unwrap(), Poll::Token("abc".into()));
        assert!(read_poll(200, &json!({})).is_err());
        assert!(read_poll(500, &json!({ "error": "server_error" })).is_err());
    }

    #[test]
    fn windows_build_is_read_from_ver() {
        assert_eq!(windows_build("\r\nMicrosoft Windows [Version 10.0.22631.4460]\r\n"), Some(22631));
        assert_eq!(windows_build("Microsoft Windows [Version 10.0.19045.5737]"), Some(19045));
        assert_eq!(windows_build("garbage"), None);
    }

    #[test]
    fn bundled_pclient_version_is_readable() {
        assert!(pclient_version().is_some_and(|v| !v.is_empty()));
    }

    #[test]
    fn login_complete_page_is_on_the_site() {
        let url = login_complete_url("ok").unwrap();
        assert!(url.ends_with("/login-complete?status=ok"), "{url}");
        assert!(login_complete_url("<x>").unwrap().ends_with("status=error"));
    }

    #[test]
    fn help_url_carries_versions_and_language() {
        let url = help_url("tr", Some("26.3")).unwrap();
        assert!(url.contains("/tr/support?v="), "{url}");
        assert!(url.contains("&os=Windows"), "{url}");
        assert!(url.contains("&mc=26.3"), "{url}");
        assert!(!help_url("en", None).unwrap().contains("/en/"));
    }
}
