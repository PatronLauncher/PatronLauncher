//! Spotify Web API bağlantısı. Yetkilendirme PKCE ile yapılır: istemci sırrı (client secret)
//! uygulamaya gömülmez. Geri dönüş adresi yalnızca 127.0.0.1 üzerinde kısa süre dinlenir ve
//! yenileme anahtarı Windows Kimlik Bilgisi Yöneticisi'nde saklanır.
use anyhow::{Context, Result, bail, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Method, StatusCode, Url, blocking::Client};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    io::{ErrorKind, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

const DEFAULT_CLIENT_ID: &str = "1749af91617543aabc5f8353b40527b8";
pub const PORT: u16 = 43821;
pub const REDIRECT_URI: &str = "http://127.0.0.1:43821/callback";
const SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing";
const SERVICE: &str = "PatronLauncher.Spotify";
const USER: &str = "refresh-token";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);
const PREMIUM_ERROR: &str = "Bu işlem Spotify Premium gerektirir.";

fn client_id() -> &'static str {
    match option_env!("PATRONLAUNCHER_SPOTIFY_CLIENT_ID") {
        Some(id) if !id.trim().is_empty() => id,
        _ => DEFAULT_CLIENT_ID,
    }
}

static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);
static LOGIN: AtomicBool = AtomicBool::new(false);

fn entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, USER)?)
}
fn refresh_token() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.trim().is_empty())
}
fn forget_access() {
    if let Ok(mut a) = ACCESS.lock() {
        *a = None;
    }
}

pub fn verifier() -> String {
    // İki UUIDv4 (işletim sistemi rastgeleliği) = 64 onaltılık karakter; PKCE 43-128 ister.
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
pub fn authorize_url(state: &str, challenge: &str) -> String {
    Url::parse_with_params(
        "https://accounts.spotify.com/authorize",
        &[
            ("client_id", client_id()),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT_URI),
            ("code_challenge_method", "S256"),
            ("code_challenge", challenge),
            ("scope", SCOPES),
            ("state", state),
        ],
    )
    .expect("sabit adres")
    .into()
}

/// Geri dönüş isteğinin ilk satırından ("GET /callback?... HTTP/1.1") kodu çıkarır.
/// Ok(None): bizimle ilgisiz bir istek (ör. favicon).
pub fn parse_callback(request_line: &str, state: &str) -> Result<Option<String>> {
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Ok(None);
    };
    let url = Url::parse(&format!("http://127.0.0.1{target}"))?;
    if url.path() != "/callback" {
        return Ok(None);
    }
    let get = |k: &str| url.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    ensure!(get("state").as_deref() == Some(state), "Spotify yanıtı doğrulanamadı (state eşleşmiyor).");
    if let Some(e) = get("error") {
        if e == "access_denied" {
            bail!("Spotify izni reddedildi.");
        }
        bail!("Spotify yetkilendirmesi başarısız: {e}");
    }
    let code = get("code").filter(|c| !c.is_empty() && c.len() < 2048).context("Spotify yetki kodu eksik.")?;
    Ok(Some(code))
}

fn respond(mut stream: &TcpStream, ok: bool) {
    let (status, title, text) = if ok {
        ("200 OK", "PatronLauncher ♪ Spotify", "Spotify connected — you can close this tab and return to PatronLauncher.")
    } else {
        ("400 Bad Request", "PatronLauncher ♪ Spotify", "Spotify connection failed — return to PatronLauncher for details.")
    };
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>{title}</title><body style=\"margin:0;display:grid;place-items:center;height:100vh;background:#0c0a12;color:#fff;font:600 18px system-ui\"><div style=\"text-align:center\"><div style=\"font-size:48px;color:{}\">{}</div><p>{text}</p></div>",
        if ok { "#1ed760" } else { "#ff5a36" },
        if ok { "✓" } else { "✕" }
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

fn read_line(stream: &mut TcpStream) -> Result<String> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buf.windows(2).any(|w| w == b"\r\n") {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        ensure!(buf.len() <= 8192, "Geri dönüş isteği çok büyük.");
    }
    let text = String::from_utf8_lossy(&buf);
    Ok(text.lines().next().unwrap_or_default().to_string())
}

fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        ensure!(Instant::now() < deadline, "Spotify girişi zaman aşımına uğradı. Tekrar dene.");
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false)?;
                let line = match read_line(&mut stream) {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                match parse_callback(&line, state) {
                    Ok(Some(code)) => {
                        respond(&stream, true);
                        return Ok(code);
                    }
                    Ok(None) => {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                    Err(e) => {
                        respond(&stream, false);
                        return Err(e);
                    }
                }
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(120)),
            Err(e) => return Err(e.into()),
        }
    }
}

fn http() -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}

fn token_request(form: &[(&str, &str)]) -> Result<Value> {
    let response = http()?.post("https://accounts.spotify.com/api/token").form(form).send()?;
    let status = response.status();
    let body: Value = response.json().unwrap_or(Value::Null);
    if !status.is_success() {
        let reason = body["error_description"].as_str().or(body["error"].as_str()).unwrap_or("");
        if body["error"] == "invalid_grant" {
            bail!("invalid_grant: {reason}");
        }
        if body["error"] == "invalid_client" {
            bail!("Spotify uygulama kimliği (Client ID) reddedildi: {reason}");
        }
        bail!("Spotify anahtar isteği başarısız ({status}): {reason}");
    }
    Ok(body)
}

fn store_tokens(body: &Value) -> Result<String> {
    let access = body["access_token"].as_str().context("Spotify erişim anahtarı eksik.")?.to_string();
    let expires = body["expires_in"].as_u64().unwrap_or(3600).clamp(60, 86_400);
    if let Some(refresh) = body["refresh_token"].as_str().filter(|r| !r.is_empty()) {
        entry()?.set_password(refresh)?;
    }
    *ACCESS.lock().map_err(|_| anyhow::anyhow!("kilit"))? =
        Some((access.clone(), Instant::now() + Duration::from_secs(expires)));
    Ok(access)
}

fn access_token() -> Result<String> {
    if let Some((token, until)) = ACCESS.lock().ok().and_then(|a| a.clone()) {
        if until > Instant::now() + Duration::from_secs(30) {
            return Ok(token);
        }
    }
    let refresh = refresh_token().context("Spotify bağlı değil.")?;
    match token_request(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh),
        ("client_id", client_id()),
    ]) {
        Ok(body) => store_tokens(&body),
        Err(e) if e.to_string().starts_with("invalid_grant") => {
            let _ = logout();
            bail!("Spotify oturumu sona erdi. Yeniden bağlan.")
        }
        Err(e) => Err(e),
    }
}

/// Tarayıcıda Spotify iznini açar ve kullanıcı onaylayana kadar bekler.
pub fn login() -> Result<()> {
    ensure!(!LOGIN.swap(true, Ordering::SeqCst), "Spotify girişi zaten sürüyor; tarayıcıyı kontrol et.");
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            LOGIN.store(false, Ordering::SeqCst);
        }
    }
    let _reset = Reset;
    let listener = TcpListener::bind(("127.0.0.1", PORT))
        .with_context(|| format!("Spotify geri dönüş portu ({PORT}) kullanımda."))?;
    let verifier = verifier();
    let state = uuid::Uuid::new_v4().simple().to_string();
    webbrowser::open(&authorize_url(&state, &challenge(&verifier))).context("Tarayıcı açılamadı")?;
    let code = wait_for_code(&listener, &state)?;
    drop(listener);
    let body = token_request(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", client_id()),
        ("code_verifier", &verifier),
    ])?;
    ensure!(body["refresh_token"].as_str().is_some(), "Spotify yenileme anahtarı vermedi.");
    store_tokens(&body)?;
    Ok(())
}

pub fn logout() -> Result<()> {
    forget_access();
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn api_error(status: StatusCode, body: &Value) -> anyhow::Error {
    let reason = body["error"]["reason"].as_str().unwrap_or("");
    let message = body["error"]["message"].as_str().unwrap_or("");
    match status {
        StatusCode::FORBIDDEN if reason == "PREMIUM_REQUIRED" || message.contains("Premium") => {
            anyhow::anyhow!(PREMIUM_ERROR)
        }
        StatusCode::FORBIDDEN if message.to_lowercase().contains("registered") => anyhow::anyhow!(
            "Bu Spotify hesabı, geliştirici panelindeki uygulamaya kullanıcı olarak eklenmemiş."
        ),
        StatusCode::NOT_FOUND if reason == "NO_ACTIVE_DEVICE" || message.contains("device") => anyhow::anyhow!(
            "Etkin bir Spotify cihazı yok. Spotify uygulamasını açıp bir şarkı başlat."
        ),
        StatusCode::TOO_MANY_REQUESTS => anyhow::anyhow!("Spotify çok fazla istek aldı; biraz bekle."),
        _ => anyhow::anyhow!("Spotify isteği başarısız ({status}) {message}"),
    }
}

fn api(method: Method, path: &str, query: &[(&str, String)]) -> Result<Option<Value>> {
    let mut url = Url::parse("https://api.spotify.com/v1/")?.join(path)?;
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query.iter().map(|(k, v)| (*k, v.as_str())));
    }
    for attempt in 0..2 {
        let token = access_token()?;
        let mut request = http()?.request(method.clone(), url.clone()).bearer_auth(token);
        if matches!(method, Method::PUT | Method::POST) {
            request = request.header(reqwest::header::CONTENT_LENGTH, "0");
        }
        let response = request.send()?;
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED && attempt == 0 {
            forget_access();
            continue;
        }
        if status == StatusCode::NO_CONTENT {
            return Ok(None);
        }
        let text = response.text().unwrap_or_default();
        let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(api_error(status, &body));
        }
        return Ok((!body.is_null()).then_some(body));
    }
    bail!("Spotify oturumu doğrulanamadı. Yeniden bağlan.")
}

#[derive(Serialize)]
pub struct Status {
    pub connected: bool,
    pub name: Option<String>,
    pub redirect_uri: &'static str,
}

pub fn status() -> Result<Status> {
    let mut s = Status { connected: false, name: None, redirect_uri: REDIRECT_URI };
    if refresh_token().is_none() {
        return Ok(s);
    }
    let me = api(Method::GET, "me", &[])?.unwrap_or(Value::Null);
    s.connected = true;
    s.name = me["display_name"].as_str().or(me["id"].as_str()).map(str::to_string);
    Ok(s)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct NowPlaying {
    pub title: String,
    pub artists: String,
    pub album: String,
    pub image: Option<String>,
    pub url: Option<String>,
    pub duration_ms: u64,
    pub progress_ms: u64,
    pub is_playing: bool,
    pub shuffle: bool,
    pub device: Option<String>,
    pub volume: Option<u8>,
}

pub fn parse_player(v: &Value) -> Option<NowPlaying> {
    let item = v.get("item").filter(|i| i.is_object())?;
    let names = |list: &Value| {
        list.as_array()
            .map(|a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(", "))
            .unwrap_or_default()
    };
    // Şarkı: album.images, podcast bölümü: images.
    let images = item["album"]["images"].as_array().or(item["images"].as_array());
    let image = images.and_then(|imgs| {
        imgs.iter()
            .filter_map(|i| Some((i["url"].as_str()?, i["width"].as_u64().unwrap_or(0))))
            .min_by_key(|(_, w)| w.abs_diff(300))
            .map(|(u, _)| u.to_string())
    });
    Some(NowPlaying {
        title: item["name"].as_str().unwrap_or_default().to_string(),
        artists: if item["artists"].is_array() { names(&item["artists"]) } else { item["show"]["name"].as_str().unwrap_or_default().to_string() },
        album: item["album"]["name"].as_str().unwrap_or_default().to_string(),
        image,
        url: item["external_urls"]["spotify"].as_str().map(str::to_string),
        duration_ms: item["duration_ms"].as_u64().unwrap_or(0),
        progress_ms: v["progress_ms"].as_u64().unwrap_or(0),
        is_playing: v["is_playing"].as_bool().unwrap_or(false),
        shuffle: v["shuffle_state"].as_bool().unwrap_or(false),
        device: v["device"]["name"].as_str().map(str::to_string),
        volume: v["device"]["volume_percent"].as_u64().map(|x| x.min(100) as u8),
    })
}

/// Spotify kapatılınca /me/player bir süre son durumu döndürmeye devam eder; cihaz listesi
/// ise hemen boşalır. Kimliği olmayan cihazda (özel oturum) karar verilemez, açık sayılır.
pub fn device_listed(devices: &Value, id: Option<&str>) -> bool {
    let Some(id) = id else { return true };
    devices["devices"].as_array().is_some_and(|list| list.iter().any(|d| d["id"].as_str() == Some(id)))
}

pub fn now_playing() -> Result<Option<NowPlaying>> {
    let Some(state) = api(Method::GET, "me/player", &[("additional_types", "track,episode".into())])? else {
        return Ok(None);
    };
    if !state["is_playing"].as_bool().unwrap_or(false) {
        let devices = api(Method::GET, "me/player/devices", &[])?.unwrap_or(Value::Null);
        if !device_listed(&devices, state["device"]["id"].as_str()) {
            return Ok(None);
        }
    }
    Ok(parse_player(&state))
}

/// Önce Spotify Web API denenir; Premium olmayan hesaplarda Spotify isteği reddettiğinde bu
/// bilgisayardaki Spotify uygulaması Windows medya kontrolleriyle yönetilir.
pub fn control(action: &str, value: Option<i64>) -> Result<()> {
    match web_control(action, value) {
        Err(error) if error.to_string() == PREMIUM_ERROR => media_session::control(action, value),
        result => result,
    }
}

mod media_session {
    use anyhow::{Context, Result, bail, ensure};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    };

    /// Windows konumları 100 nanosaniyelik birimlerle ister.
    const TICKS_PER_MS: i64 = 10_000;

    fn spotify() -> Result<Session> {
        let sessions = Manager::RequestAsync()?.join()?.GetSessions()?;
        for i in 0..sessions.Size()? {
            let session = sessions.GetAt(i)?;
            if session.SourceAppUserModelId()?.to_string().to_lowercase().contains("spotify") {
                return Ok(session);
            }
        }
        bail!("Premium olmadan kontrol için Spotify masaüstü uygulamasının bu bilgisayarda açık olması gerekir.")
    }

    pub fn control(action: &str, value: Option<i64>) -> Result<()> {
        let session = spotify()?;
        let accepted = match action {
            "play" => session.TryPlayAsync()?.join()?,
            "pause" => session.TryPauseAsync()?.join()?,
            "next" => session.TrySkipNextAsync()?.join()?,
            "previous" => session.TrySkipPreviousAsync()?.join()?,
            "seek" => session
                .TryChangePlaybackPositionAsync(value.context("Konum geçersiz.")? * TICKS_PER_MS)?
                .join()?,
            "shuffle" => session.TryChangeShuffleActiveAsync(matches!(value, Some(1)))?.join()?,
            _ => bail!(super::PREMIUM_ERROR),
        };
        ensure!(accepted, "Spotify bu işlemi şu anda kabul etmedi.");
        Ok(())
    }
}

fn web_control(action: &str, value: Option<i64>) -> Result<()> {
    match action {
        "play" => api(Method::PUT, "me/player/play", &[])?,
        "pause" => api(Method::PUT, "me/player/pause", &[])?,
        "next" => api(Method::POST, "me/player/next", &[])?,
        "previous" => api(Method::POST, "me/player/previous", &[])?,
        "volume" => {
            let v = value.filter(|v| (0..=100).contains(v)).context("Ses düzeyi geçersiz.")?;
            api(Method::PUT, "me/player/volume", &[("volume_percent", v.to_string())])?
        }
        "seek" => {
            let v = value.filter(|v| (0..=86_400_000).contains(v)).context("Konum geçersiz.")?;
            api(Method::PUT, "me/player/seek", &[("position_ms", v.to_string())])?
        }
        "shuffle" => {
            let v = matches!(value, Some(1));
            api(Method::PUT, "me/player/shuffle", &[("state", v.to_string())])?
        }
        _ => bail!("Spotify işlemi geçersiz."),
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_challenge_is_base64url_sha256() {
        assert_eq!(
            challenge("patron-verifier-0123456789-abcdefghijklmnopq"),
            "TaK0lWQZBKhaL1krzZl6CQJOH_rqypgzMzORb0K0I_c"
        );
        let v = verifier();
        assert_eq!(v.len(), 64);
        assert!(v.bytes().all(|b| b.is_ascii_alphanumeric()));
        let url = authorize_url("st", "ch");
        assert!(url.starts_with("https://accounts.spotify.com/authorize?"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A43821%2Fcallback"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(!url.contains("secret"));
    }
    #[test]
    fn callback_is_checked() {
        assert_eq!(parse_callback("GET /callback?code=abc&state=s1 HTTP/1.1", "s1").unwrap().as_deref(), Some("abc"));
        assert!(parse_callback("GET /favicon.ico HTTP/1.1", "s1").unwrap().is_none());
        assert!(parse_callback("POST /callback?code=abc&state=s1 HTTP/1.1", "s1").unwrap().is_none());
        assert!(parse_callback("GET /callback?code=abc&state=evil HTTP/1.1", "s1").is_err());
        let denied = parse_callback("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1").unwrap_err();
        assert!(denied.to_string().contains("reddedildi"));
        assert!(parse_callback("GET /callback?state=s1 HTTP/1.1", "s1").is_err());
    }
    #[test]
    fn player_payload_is_parsed() {
        let v: Value = serde_json::from_str(r#"{
            "is_playing": true, "progress_ms": 1200, "shuffle_state": true,
            "device": {"name": "PC", "volume_percent": 64},
            "item": {"name": "Song", "duration_ms": 200000,
                "artists": [{"name": "A"}, {"name": "B"}],
                "album": {"name": "Alb", "images": [
                    {"url": "https://i.scdn.co/image/big", "width": 640},
                    {"url": "https://i.scdn.co/image/mid", "width": 300},
                    {"url": "https://i.scdn.co/image/small", "width": 64}]},
                "external_urls": {"spotify": "https://open.spotify.com/track/x"}}
        }"#).unwrap();
        let p = parse_player(&v).unwrap();
        assert_eq!(p.artists, "A, B");
        assert_eq!(p.image.as_deref(), Some("https://i.scdn.co/image/mid"));
        assert_eq!(p.volume, Some(64));
        assert!(p.is_playing && p.shuffle);
        assert!(parse_player(&serde_json::json!({"is_playing": false, "item": null})).is_none());
        assert!(control("explode", None).is_err());
        assert!(control("volume", Some(101)).is_err());
    }
    #[test]
    fn closed_device_is_not_listed() {
        let devices = serde_json::json!({"devices": [{"id": "pc"}, {"id": "phone"}]});
        assert!(device_listed(&devices, Some("phone")));
        assert!(!device_listed(&devices, Some("laptop")));
        assert!(!device_listed(&serde_json::json!({"devices": []}), Some("pc")));
        assert!(device_listed(&Value::Null, None));
    }
}
