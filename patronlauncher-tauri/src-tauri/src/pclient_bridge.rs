//! PClient köprüsü: oyun içi arayüzün launcher'daki hesap ve müzik işlevlerine ulaştığı yerel kanal.
//!
//! Yenileme anahtarları Windows Kimlik Bilgisi Yöneticisi'nde kalır; oyuna yalnızca kısa ömürlü
//! Minecraft oturumu verilir. Sunucu yalnızca 127.0.0.1 üzerinde dinler, her açılışta rastgele bir
//! parola üretir ve parolayı PClient oyun klasöründeki `pclient/bridge.json` dosyasına yazar. Host
//! başlığı da denetlendiği için tarayıcıdaki bir sayfa bu kanala istek gönderemez.
use crate::{
    auth,
    core::{
        CoreService,
        types::{Action, Snapshot},
    },
    media,
    model::Account,
};
use anyhow::{Context, Result, anyhow, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Cursor, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 8 * 1024;
const MAX_CONNECTIONS: usize = 16;
/// Oyundaki HUD ve müzik ekranı aynı anda sorsa da medya oturumu bir kez okunur.
const NOW_PLAYING_TTL: Duration = Duration::from_millis(1500);

#[derive(Default)]
struct Login {
    active: bool,
    code: Option<String>,
    error: Option<String>,
    done: Option<String>,
    cancel: Option<Arc<AtomicBool>>,
}

struct Bridge {
    app: AppHandle,
    root: PathBuf,
    login: Mutex<Login>,
    now_playing: Mutex<Option<(Instant, Value)>>,
}

#[derive(Debug, PartialEq)]
struct Head {
    method: String,
    path: String,
    host: String,
    authorization: String,
    length: usize,
}

fn parse_head(text: &str) -> Option<Head> {
    let mut lines = text.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let (mut host, mut authorization, mut length) = (String::new(), String::new(), 0usize);
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "host" => host = value.to_string(),
            "authorization" => authorization = value.to_string(),
            "content-length" => length = value.parse().ok()?,
            _ => {}
        }
    }
    Some(Head { method, path, host, authorization, length })
}

/// Süre sızdırmayan karşılaştırma.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn authorized(head: &Head, token: &str, port: u16) -> bool {
    same(&head.authorization, &format!("Bearer {token}")) && head.host == format!("127.0.0.1:{port}")
}

/// `auth::login` bildiriminden cihaz kodunu çıkarır.
fn device_code(status: &str) -> Option<String> {
    let code = status.strip_prefix("Microsoft girişi: ")?.rsplit_once("Kod: ")?.1.trim();
    (!code.is_empty()).then(|| code.to_string())
}

fn read_request(stream: &mut TcpStream) -> Result<(Head, Vec<u8>)> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let end = loop {
        if let Some(i) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        let n = stream.read(&mut chunk)?;
        ensure!(n > 0, "bağlantı kapandı");
        buffer.extend_from_slice(&chunk[..n]);
        ensure!(buffer.len() <= MAX_HEAD, "istek çok büyük");
    };
    let head = parse_head(std::str::from_utf8(&buffer[..end])?).context("istek okunamadı")?;
    ensure!(head.length <= MAX_BODY, "istek gövdesi çok büyük");
    let mut body = buffer[end + 4..].to_vec();
    while body.len() < head.length {
        let n = stream.read(&mut chunk)?;
        ensure!(n > 0, "bağlantı kapandı");
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(head.length);
    Ok((head, body))
}

fn respond(stream: &mut TcpStream, status: &str, body: &Value) {
    let text = body.to_string();
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{text}",
        text.len()
    );
    let _ = stream.flush();
}

fn call(bridge: &Bridge, action: Action) -> Result<Snapshot> {
    let service = bridge.app.state::<CoreService>();
    tauri::async_runtime::block_on(service.call(action))
        .map(|reply| reply.state)
        .map_err(|e| anyhow!(e))
}

fn accounts_json(state: &Snapshot) -> Value {
    json!({ "accounts": state.accounts, "selected": state.selected_account })
}

fn text_field(body: &Value, key: &str) -> Result<String> {
    Ok(body[key].as_str().with_context(|| format!("{key} alanı eksik."))?.to_string())
}

fn session_json(account: &Account, client_id: &str) -> Result<Value> {
    let session = auth::session(account, client_id)?;
    Ok(json!({
        "name": session.name,
        "uuid": session.uuid,
        "access_token": session.access_token,
        "xuid": session.xuid,
        "kind": account.kind,
    }))
}

/// Oturum alınamazsa (ör. süresi dolmuş giriş) seçim değişmez.
fn select(bridge: &Bridge, id: Uuid) -> Result<Value> {
    let state = call(bridge, Action::Read)?;
    let account = state.accounts.iter().find(|a| a.id == id).context("Hesap bulunamadı.")?;
    let session = session_json(account, &state.settings.microsoft_client_id)?;
    let state = call(bridge, Action::SelectAccount { id })?;
    Ok(json!({ "session": session, "state": accounts_json(&state) }))
}

fn microsoft_start(bridge: &Arc<Bridge>) -> Result<Value> {
    let client_id = call(bridge, Action::Read)?.settings.microsoft_client_id;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut login = bridge.login.lock().map_err(|_| anyhow!("kilit"))?;
        ensure!(!login.active, "Microsoft girişi zaten sürüyor.");
        *login = Login { active: true, cancel: Some(cancel.clone()), ..Login::default() };
    }
    let bridge = bridge.clone();
    thread::spawn(move || {
        let notify = bridge.clone();
        let result = auth::login(&client_id, cancel, move |status| {
            if let (Some(code), Ok(mut login)) = (device_code(&status), notify.login.lock()) {
                login.code = Some(code);
            }
        });
        let outcome = result.map_err(|e| format!("{e:#}")).and_then(|account| {
            let name = account.name.clone();
            call(&bridge, Action::AccountLoggedIn { account }).map_err(|e| format!("{e:#}"))?;
            // Çekirdek olayı bir sonraki tikte işler; oyun hesabı listede bulabilsin.
            for _ in 0..40 {
                if call(&bridge, Action::Read).is_ok_and(|s| s.accounts.iter().any(|a| a.name == name)) {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Ok(name)
        });
        if let Ok(mut login) = bridge.login.lock() {
            login.active = false;
            login.cancel = None;
            match outcome {
                Ok(name) => login.done = Some(name),
                Err(error) => login.error = Some(error),
            }
        }
    });
    Ok(json!({ "ok": true }))
}

fn microsoft_status(bridge: &Bridge) -> Result<Value> {
    let login = bridge.login.lock().map_err(|_| anyhow!("kilit"))?;
    Ok(json!({
        "active": login.active,
        "code": login.code,
        "error": login.error,
        "done": login.done,
        "url": "https://microsoft.com/devicelogin",
    }))
}

fn microsoft_cancel(bridge: &Bridge) -> Result<Value> {
    let login = bridge.login.lock().map_err(|_| anyhow!("kilit"))?;
    if let Some(cancel) = &login.cancel {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(json!({ "ok": true }))
}

fn now_playing(bridge: &Bridge) -> Result<Value> {
    let mut cache = bridge.now_playing.lock().map_err(|_| anyhow!("kilit"))?;
    if let Some((at, value)) = cache.as_ref() {
        if at.elapsed() < NOW_PLAYING_TTL {
            return Ok(value.clone());
        }
    }
    let value = serde_json::to_value(media::now_playing()?)?;
    *cache = Some((Instant::now(), value.clone()));
    Ok(value)
}

/// Modrinth görselleri WebP'dir ve oyun bu biçimi çözemez; izinli adreslerden PNG üretilir.
fn icon_png(url: &str, size: u32) -> Result<Value> {
    let image = crate::mod_images::fetch_sniffed(url)?;
    let bytes = STANDARD.decode(image.data)?;
    let mut png = Cursor::new(Vec::new());
    image::load_from_memory(&bytes)?.thumbnail(size, size).write_to(&mut png, image::ImageFormat::Png)?;
    Ok(json!({ "png": STANDARD.encode(png.into_inner()) }))
}

/// Launcher'ın zaten getirdiği haberler; görseller küçültülmüş PNG veri adresleridir.
fn news(bridge: &Bridge) -> Result<Value> {
    let service = bridge.app.state::<CoreService>();
    let reply = tauri::async_runtime::block_on(service.call(Action::News { refresh: false })).map_err(|e| anyhow!(e))?;
    Ok(json!({ "articles": reply.news.unwrap_or_default() }))
}

fn install_iris(bridge: &Bridge) -> Result<Value> {
    let minecraft = crate::pclient::selected(&bridge.root).minecraft;
    crate::pclient::install_iris(&bridge.root, minecraft)?;
    Ok(json!({ "ok": true }))
}

fn route(bridge: &Arc<Bridge>, head: &Head, body: &[u8]) -> Result<Value> {
    let parsed: Value = if body.is_empty() { Value::Null } else { serde_json::from_slice(body)? };
    match (head.method.as_str(), head.path.as_str()) {
        ("GET", "/v1/ping") => Ok(json!({ "ok": true })),
        ("GET", "/v1/accounts") => Ok(accounts_json(&call(bridge, Action::Read)?)),
        ("POST", "/v1/accounts/local") => {
            let name = text_field(&parsed, "name")?;
            Ok(accounts_json(&call(bridge, Action::AddLocal { name })?))
        }
        ("POST", "/v1/accounts/select") => {
            let id = Uuid::parse_str(&text_field(&parsed, "id")?).context("Hesap kimliği geçersiz.")?;
            select(bridge, id)
        }
        ("POST", "/v1/accounts/microsoft/start") => microsoft_start(bridge),
        ("GET", "/v1/accounts/microsoft/status") => microsoft_status(bridge),
        ("POST", "/v1/accounts/microsoft/cancel") => microsoft_cancel(bridge),
        ("POST", "/v1/image") => {
            let size = parsed["size"].as_u64().unwrap_or(64).clamp(32, 1024) as u32;
            icon_png(&text_field(&parsed, "url")?, size)
        }
        ("GET", "/v1/news") => news(bridge),
        ("POST", "/v1/iris/install") => install_iris(bridge),
        ("GET", "/v1/media/now") => now_playing(bridge),
        ("POST", "/v1/media/cover") => Ok(json!({ "png": media::cover(&text_field(&parsed, "key")?)? })),
        ("POST", "/v1/media/control") => {
            let action = text_field(&parsed, "action")?;
            media::control(&action, parsed["value"].as_i64())?;
            *bridge.now_playing.lock().map_err(|_| anyhow!("kilit"))? = None;
            Ok(json!({ "ok": true }))
        }
        _ => Err(anyhow!("Bilinmeyen istek.")),
    }
}

fn handle(bridge: &Arc<Bridge>, mut stream: TcpStream, token: &str, port: u16) {
    let Ok((head, body)) = read_request(&mut stream) else {
        respond(&mut stream, "400 Bad Request", &json!({ "error": "İstek okunamadı." }));
        return;
    };
    if !authorized(&head, token, port) {
        respond(&mut stream, "403 Forbidden", &json!({ "error": "Yetkisiz istek." }));
        return;
    }
    match route(bridge, &head, &body) {
        Ok(value) => respond(&mut stream, "200 OK", &value),
        Err(error) => respond(&mut stream, "400 Bad Request", &json!({ "error": format!("{error:#}") })),
    }
}

fn publish(root: &Path, port: u16, token: &str) -> Result<()> {
    let dir = crate::pclient::game_dir(root).join("pclient");
    fs::create_dir_all(&dir)?;
    let body = serde_json::to_vec(&json!({ "port": port, "token": token }))?;
    crate::profiles::atomic_write(&dir.join("bridge.json"), &body)
}

/// Köprüyü arka planda başlatır. Başlatılamazsa launcher çalışmaya devam eder; yalnızca oyun içi
/// hesap ve Spotify özellikleri "launcher'a ulaşılamıyor" uyarısı gösterir.
pub fn start(app: AppHandle, root: &Path) {
    let prepare = || -> Result<(TcpListener, u16, String)> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let port = listener.local_addr()?.port();
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        publish(root, port, &token)?;
        Ok((listener, port, token))
    };
    let (listener, port, token) = match prepare() {
        Ok(ready) => ready,
        Err(error) => {
            eprintln!("PClient köprüsü başlatılamadı: {error:#}");
            return;
        }
    };
    let bridge = Arc::new(Bridge { app, root: root.to_path_buf(), login: Mutex::default(), now_playing: Mutex::new(None) });
    let token = Arc::new(token);
    let active = Arc::new(AtomicUsize::new(0));
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if active.load(Ordering::Relaxed) >= MAX_CONNECTIONS {
                continue;
            }
            active.fetch_add(1, Ordering::Relaxed);
            let (bridge, token, active) = (bridge.clone(), token.clone(), active.clone());
            thread::spawn(move || {
                handle(&bridge, stream, &token, port);
                active.fetch_sub(1, Ordering::Relaxed);
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head(host: &str, authorization: &str) -> Head {
        Head {
            method: "GET".into(),
            path: "/v1/ping".into(),
            host: host.into(),
            authorization: authorization.into(),
            length: 0,
        }
    }

    #[test]
    fn request_head_is_parsed() {
        let parsed = parse_head("POST /v1/x HTTP/1.1\r\nHost: 127.0.0.1:9\r\nAuthorization: Bearer t\r\ncontent-length: 12").unwrap();
        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.path, "/v1/x");
        assert_eq!(parsed.host, "127.0.0.1:9");
        assert_eq!(parsed.authorization, "Bearer t");
        assert_eq!(parsed.length, 12);
        assert!(parse_head("").is_none());
        assert!(parse_head("GET /\r\nContent-Length: x").is_none());
    }

    #[test]
    fn only_the_token_holder_on_loopback_is_authorized() {
        assert!(authorized(&head("127.0.0.1:9", "Bearer abc"), "abc", 9));
        assert!(!authorized(&head("127.0.0.1:9", "Bearer abd"), "abc", 9));
        assert!(!authorized(&head("127.0.0.1:9", ""), "abc", 9));
        // DNS yeniden bağlama: tarayıcıdan gelen başka bir Host reddedilir.
        assert!(!authorized(&head("evil.test:9", "Bearer abc"), "abc", 9));
        assert!(!authorized(&head("127.0.0.1:8", "Bearer abc"), "abc", 9));
    }

    #[test]
    fn device_code_comes_from_the_login_notice() {
        assert_eq!(
            device_code("Microsoft girişi: https://microsoft.com/devicelogin adresini açın. Kod: AB12-CD").as_deref(),
            Some("AB12-CD")
        );
        assert_eq!(device_code("Minecraft hesabı doğrulanıyor…"), None);
    }
}
