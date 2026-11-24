//! Arkadaşlar ve mesajlar. Launcher, PatronLauncher hesabına girişliyken sitenin anlık bağlantısını
//! (WebSocket, 60 sn'lik biletle) açık tutar; gelen olayları arayüze (Tauri olayı) ve oyuna (PClient köprüsü,
//! uzun sorgu) iletir. Yazmalar (mesaj, istek, gizlilik) sitenin REST uçlarına oturum anahtarıyla gider; oyun ve
//! arayüz yalnızca `/api/social/*` yollarını kullanabilir.
use anyhow::{Context, Result, anyhow, bail};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    io::ErrorKind,
    net::TcpStream,
    sync::{Condvar, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use tungstenite::{Message, stream::MaybeTlsStream};

pub const EVENT: &str = "patronlauncher://social";
const PING_EVERY: Duration = Duration::from_secs(25);
/// Oyun için tutulan son olaylar (uzun sorgu kaçırırsa bile yetişir).
const KEEP: usize = 200;

struct Queue {
    seq: u64,
    items: VecDeque<(u64, Value)>,
    connected: bool,
}

fn queue() -> &'static (Mutex<Queue>, Condvar) {
    static Q: OnceLock<(Mutex<Queue>, Condvar)> = OnceLock::new();
    Q.get_or_init(|| (Mutex::new(Queue { seq: 0, items: VecDeque::new(), connected: false }), Condvar::new()))
}

fn app_handle() -> &'static Mutex<Option<AppHandle>> {
    static APP: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();
    APP.get_or_init(|| Mutex::new(None))
}

/// Olayı kuyruğa ekler, arayüze yollar ve bekleyen oyun isteğini uyandırır.
fn publish(event: Value) {
    let (lock, cv) = queue();
    {
        let mut q = lock.lock().unwrap_or_else(|e| e.into_inner());
        q.seq += 1;
        let seq = q.seq;
        q.items.push_back((seq, event.clone()));
        while q.items.len() > KEEP {
            q.items.pop_front();
        }
    }
    cv.notify_all();
    if let Some(app) = app_handle().lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        let _ = app.emit_to("main", EVENT, event);
    }
}

fn set_connected(on: bool) {
    let changed = {
        let mut q = queue().0.lock().unwrap_or_else(|e| e.into_inner());
        let changed = q.connected != on;
        q.connected = on;
        changed
    };
    if changed {
        publish(json!({ "type": "connection", "online": on }));
    }
}

pub fn connected() -> bool {
    queue().0.lock().map(|q| q.connected).unwrap_or(false)
}

/// `since`'ten sonraki olaylar; yoksa en çok `wait` kadar bekler (oyunun uzun sorgusu).
pub fn events_since(since: u64, wait: Duration) -> Value {
    let (lock, cv) = queue();
    let mut q = lock.lock().unwrap_or_else(|e| e.into_inner());
    // Launcher yeniden başladıysa (sıra geride kaldıysa) baştan başlanır.
    let since = if since > q.seq { 0 } else { since };
    if q.seq <= since {
        let (guard, _) = cv.wait_timeout_while(q, wait, |q| q.seq <= since).unwrap_or_else(|e| e.into_inner());
        q = guard;
    }
    let events: Vec<Value> = q.items.iter().filter(|(s, _)| *s > since).map(|(_, e)| e.clone()).collect();
    json!({ "seq": q.seq, "connected": q.connected, "events": events })
}

/// Arayüz ve oyun için sitenin sosyal uçlarına aracı: yalnızca `/api/social/` altı, GET ya da POST.
pub fn api(method: &str, path: &str, body: Option<Value>) -> Result<Value> {
    if !path.starts_with("/api/social/") || path.contains("..") || path.contains('#') || path.len() > 300 {
        bail!("Geçersiz istek yolu.");
    }
    if method != "GET" && method != "POST" {
        bail!("Geçersiz yöntem.");
    }
    let token = crate::patron_account::read_token().ok_or_else(|| anyhow!("NOT_SIGNED_IN"))?;
    let base = crate::patron_account::base_url()?;
    let http = crate::patron_account::client(&base)?;
    let url = format!("{base}{path}");
    let req = if method == "GET" { http.get(&url) } else { http.post(&url).json(&body.unwrap_or(Value::Null)) };
    let res = req.bearer_auth(token).send().context("PatronLauncher sitesine ulaşılamadı.")?;
    let status = res.status().as_u16();
    let data: Value = res.json().unwrap_or(Value::Null);
    if status == 401 {
        bail!("NOT_SIGNED_IN");
    }
    if !(200..300).contains(&status) {
        bail!("{}", data["code"].as_str().unwrap_or("ERROR"));
    }
    Ok(data)
}

/// Arka plan bağlantısını başlatır (giriş yoksa bekler, kopunca artan aralıklarla yeniden dener).
pub fn start(app: AppHandle) {
    *app_handle().lock().unwrap_or_else(|e| e.into_inner()) = Some(app);
    // rustls için süreç geneli şifreleme sağlayıcısı (reqwest kendi yapılandırmasını kullanır).
    let _ = rustls::crypto::ring::default_provider().install_default();
    thread::spawn(|| {
        let mut backoff = Duration::from_secs(2);
        loop {
            if crate::patron_account::read_token().is_none() {
                set_connected(false);
                thread::sleep(Duration::from_secs(3));
                continue;
            }
            let started = Instant::now();
            let result = connect_once();
            set_connected(false);
            if let Err(e) = result {
                eprintln!("Sosyal bağlantı koptu: {e:#}");
            }
            // Uzun süre açık kalmış bağlantı koptuysa hemen yeniden denenir.
            if started.elapsed() > Duration::from_secs(60) {
                backoff = Duration::from_secs(2);
            }
            thread::sleep(backoff);
            backoff = (backoff * 2).min(Duration::from_secs(60));
        }
    });
}

fn set_timeout(stream: &MaybeTlsStream<TcpStream>) {
    let tcp = match stream {
        MaybeTlsStream::Plain(s) => Some(s),
        MaybeTlsStream::Rustls(s) => Some(s.get_ref()),
        _ => None,
    };
    if let Some(tcp) = tcp {
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(1)));
    }
}

/// Sitenin adresini WebSocket adresine çevirir (https → wss, yerel http → ws).
pub fn ws_url(base: &str, ticket: &str) -> String {
    let scheme = if base.starts_with("https://") { "wss://" } else { "ws://" };
    let rest = base.split_once("://").map(|(_, r)| r).unwrap_or(base);
    match reqwest::Url::parse(&format!("{scheme}{rest}/api/social/ws")) {
        Ok(mut url) => {
            url.query_pairs_mut().append_pair("ticket", ticket);
            url.to_string()
        }
        Err(_) => String::new(),
    }
}

fn connect_once() -> Result<()> {
    let token = crate::patron_account::read_token().ok_or_else(|| anyhow!("giriş yok"))?;
    let base = crate::patron_account::base_url()?;
    let http = crate::patron_account::client(&base)?;
    let res = http.post(format!("{base}/api/launcher/ws-ticket")).bearer_auth(&token).send()?;
    if res.status().as_u16() == 401 {
        bail!("oturum geçersiz");
    }
    let ticket: Value = res.error_for_status()?.json()?;
    let ticket = ticket["ticket"].as_str().ok_or_else(|| anyhow!("bilet yok"))?;
    let (mut socket, _) = tungstenite::connect(ws_url(&base, ticket)).context("anlık bağlantı açılamadı")?;
    set_timeout(socket.get_ref());
    set_connected(true);
    let mut last_ping = Instant::now();
    loop {
        // Çıkış yapılınca (ya da başka hesaba geçilince) bağlantı kapanır.
        if crate::patron_account::read_token().as_deref() != Some(token.as_str()) {
            let _ = socket.close(None);
            return Ok(());
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                let text = text.as_str();
                if text != "pong"
                    && let Ok(event) = serde_json::from_str::<Value>(text)
                {
                    publish(event);
                }
            }
            Ok(Message::Close(_)) => bail!("sunucu bağlantıyı kapattı"),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(e) => return Err(e.into()),
        }
        if last_ping.elapsed() >= PING_EVERY {
            socket.send(Message::text("ping"))?;
            last_ping = Instant::now();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn websocket_address_follows_the_site() {
        assert_eq!(ws_url("https://patronlauncher.net", "a.1.b"), "wss://patronlauncher.net/api/social/ws?ticket=a.1.b");
        assert_eq!(ws_url("http://localhost:4321", "x"), "ws://localhost:4321/api/social/ws?ticket=x");
    }

    #[test]
    fn api_only_reaches_social_paths() {
        assert!(api("GET", "/api/account/export", None).is_err());
        assert!(api("GET", "/api/social/../account/export", None).is_err());
        assert!(api("DELETE", "/api/social/friends", None).is_err());
    }

    #[test]
    fn events_are_queued_in_order_and_returned_after_since() {
        publish(json!({ "type": "test", "n": 1 }));
        publish(json!({ "type": "test", "n": 2 }));
        let all = events_since(0, Duration::from_millis(1));
        let seq = all["seq"].as_u64().unwrap();
        let later = events_since(seq - 1, Duration::from_millis(1));
        assert_eq!(later["events"].as_array().unwrap().len(), 1);
        assert_eq!(later["events"][0]["n"], 2);
        // Gelecekteki bir sıra (launcher yeniden başlamış) baştan verir.
        assert!(!events_since(seq + 100, Duration::from_millis(1))["events"].as_array().unwrap().is_empty());
    }
}
