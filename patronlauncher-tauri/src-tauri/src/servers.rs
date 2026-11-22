//! Sunucu listesi: uzak JSON → yerel önbellek → gömülü liste sırasıyla okunur.
//! Canlı durum Minecraft'ın Server List Ping protokolüyle alınır. Arayüz yalnızca
//! listedeki sunucu kimliklerini gönderebilir; rastgele adres kabul edilmez.
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};

/// PatronLauncher sitesinin onaylı sunucu listesi. Ulaşılamazsa önbellek, o da yoksa gömülü liste kullanılır.
pub const REMOTE_URL: &str = "https://patronlauncher.net/api/servers/launcher.json";
/// Sunucu sayfaları (oy verme dahil) sitede açılır; oylar orada Turnstile ile korunur.
pub const SITE: &str = "https://patronlauncher.net";
const BUNDLED: &str = include_str!("../servers.json");
const CACHE: &str = "servers-cache.json";
const VOTES: &str = "server-votes.json";
/// Listede kullanılabilen ülke kodları (ISO 3166-1 alpha-2, küçük harf).
pub const COUNTRIES: [&str; 15] = [
    "tr", "us", "gb", "de", "es", "cl", "fr", "in", "it", "pl", "br", "ru", "nl", "id", "pt",
];
const PING_TTL: Duration = Duration::from_secs(60);

// Bilinmeyen alanlar yok sayılır: site yeni alan eklediğinde eski launcher'lar listeyi okumaya devam eder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub address: String,
    #[serde(default)]
    pub port: Option<u16>,
    pub country: String,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub description: HashMap<String, String>,
    #[serde(default)]
    pub versions: String,
    #[serde(default)]
    pub website: Option<String>,
    #[serde(default)]
    pub discord: Option<String>,
    #[serde(default)]
    pub sponsored: bool,
    #[serde(default)]
    pub featured: bool,
    /// Sitedeki bu ayın oyları.
    #[serde(default)]
    pub votes: u32,
    /// Sitedeki aylık sıra (1 = en çok oy).
    #[serde(default)]
    pub rank: Option<u32>,
    /// Sunucu sahibinin onaylı banner'ı (yalnızca site adresi).
    #[serde(default)]
    pub banner: Option<String>,
}
#[derive(Debug, Deserialize)]
struct Document {
    version: u32,
    servers: Vec<Server>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Listing {
    pub servers: Vec<Server>,
    /// "remote", "cache" veya "bundled".
    pub source: &'static str,
}
#[derive(Debug, Clone, Serialize)]
pub struct Ping {
    pub online: bool,
    pub players: Option<u32>,
    pub max_players: Option<u32>,
    pub version: Option<String>,
    pub motd: Option<String>,
    pub favicon: Option<String>,
    pub latency_ms: Option<u32>,
}

#[derive(Default)]
pub struct Store {
    servers: Mutex<Vec<Server>>,
    pings: Mutex<HashMap<String, (Instant, Ping)>>,
}

fn host_ok(host: &str) -> bool {
    (1..=253).contains(&host.len())
        && host.split('.').count() >= 2
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}
fn link_ok(url: &Option<String>) -> bool {
    url.as_deref()
        .is_none_or(|u| u.starts_with("https://") && u.len() <= 200 && !u.contains(char::is_whitespace))
}
fn banner_ok(url: &str) -> bool {
    url.len() <= 200
        && url
            .strip_prefix("https://patronlauncher.net/api/servers/banner-")
            .is_some_and(|rest| rest.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.?=".contains(&b)))
}
/// Sitedeki sunucu sayfası; `lang` launcher dilidir (İngilizce önek almaz).
pub fn page_url(id: &str, lang: &str) -> String {
    let prefix = match lang {
        "tr" | "de" | "es" | "fr" | "it" | "pl" | "pt" | "ru" | "hi" => format!("/{lang}"),
        _ => String::new(),
    };
    format!("{SITE}{prefix}/servers/{id}")
}
fn validate(doc: Document) -> Result<Vec<Server>> {
    if doc.version != 2 {
        bail!("Desteklenmeyen sunucu listesi sürümü.");
    }
    let mut seen = std::collections::HashSet::new();
    let mut servers = Vec::new();
    for mut s in doc.servers.into_iter().take(1000) {
        s.address = s.address.trim().to_ascii_lowercase();
        let ok = seen.insert(s.id.clone())
            && (1..=40).contains(&s.id.len())
            && s.id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && (1..=60).contains(&s.name.chars().count())
            && host_ok(&s.address)
            && s.port.is_none_or(|p| p > 0)
            && COUNTRIES.contains(&s.country.as_str())
            && s.languages.len() <= 6
            && s.languages.iter().all(|l| l.len() == 2 && l.bytes().all(|b| b.is_ascii_lowercase()))
            && s.tags.len() <= 12
            && s.tags.iter().all(|t| (1..=24).contains(&t.len()))
            && s.description.values().all(|d| d.chars().count() <= 300)
            && s.versions.len() <= 40
            && link_ok(&s.website)
            && link_ok(&s.discord);
        if s.banner.as_deref().is_some_and(|b| !banner_ok(b)) {
            s.banner = None;
        }
        if ok {
            servers.push(s);
        }
    }
    // Sponsorlar ve öne çıkanlar her zaman üstte; sonra ad sırası.
    servers.sort_by(|a, b| {
        (b.sponsored, b.featured)
            .cmp(&(a.sponsored, a.featured))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(servers)
}
fn parse(bytes: &[u8]) -> Result<Vec<Server>> {
    validate(serde_json::from_slice(bytes).context("Sunucu listesi okunamadı")?)
}

pub fn load(root: &Path) -> Listing {
    if !REMOTE_URL.is_empty()
        && let Ok(bytes) = fetch_remote()
        && let Ok(servers) = parse(&bytes)
    {
        let _ = crate::profiles::atomic_write(&root.join(CACHE), &bytes);
        return Listing { servers, source: "remote" };
    }
    if let Ok(bytes) = std::fs::read(root.join(CACHE))
        && let Ok(servers) = parse(&bytes)
    {
        return Listing { servers, source: "cache" };
    }
    Listing {
        servers: parse(BUNDLED.as_bytes()).unwrap_or_default(),
        source: "bundled",
    }
}
fn fetch_remote() -> Result<Vec<u8>> {
    let response = crate::net::client()?
        .get(REMOTE_URL)
        .timeout(Duration::from_secs(8))
        .send()?
        .error_for_status()?;
    let mut bytes = Vec::new();
    response.take(1 << 20).read_to_end(&mut bytes)?;
    Ok(bytes)
}

impl Store {
    pub fn remember(&self, servers: &[Server]) {
        if let Ok(mut list) = self.servers.lock() {
            *list = servers.to_vec();
        }
    }
    pub fn find(&self, id: &str) -> Option<Server> {
        let list = self.servers.lock().ok()?;
        list.iter().find(|s| s.id == id).cloned()
    }
    pub fn cached_ping(&self, id: &str) -> Option<Ping> {
        let pings = self.pings.lock().ok()?;
        pings
            .get(id)
            .filter(|(at, _)| at.elapsed() < PING_TTL)
            .map(|(_, p)| p.clone())
    }
    pub fn store_ping(&self, id: &str, ping: &Ping) {
        if let Ok(mut pings) = self.pings.lock() {
            pings.insert(id.to_string(), (Instant::now(), ping.clone()));
        }
    }
}

/// Bir sunucu için bu cihazdaki puan ve favori kaydı. Oylar sitede verilir (`page_url`);
/// `votes`/`last_vote` eski sürümlerin yerel oy kayıtlarıdır ve yalnızca okunur.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Vote {
    #[serde(default)]
    pub votes: u32,
    /// Son oyun Unix zamanı (saniye).
    #[serde(default)]
    pub last_vote: u64,
    /// 1-5 yıldız.
    #[serde(default)]
    pub rating: Option<u8>,
    #[serde(default)]
    pub favorite: bool,
}
pub type Votes = HashMap<String, Vote>;

fn id_ok(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
pub fn load_votes(root: &Path) -> Votes {
    std::fs::read(root.join(VOTES))
        .ok()
        .and_then(|b| serde_json::from_slice::<Votes>(&b).ok())
        .map(|v| {
            v.into_iter()
                .filter(|(id, e)| id_ok(id) && e.rating.is_none_or(|r| (1..=5).contains(&r)))
                .take(2000)
                .collect()
        })
        .unwrap_or_default()
}
fn save_votes(root: &Path, votes: &Votes) -> Result<()> {
    crate::profiles::atomic_write(&root.join(VOTES), &serde_json::to_vec_pretty(votes)?)
}
/// 0 puanı kaldırır.
pub fn rate(root: &Path, id: &str, stars: u8) -> Result<Vote> {
    if stars > 5 {
        bail!("Puan 1 ile 5 arasında olmalı.");
    }
    let mut votes = load_votes(root);
    let entry = votes.entry(id.to_string()).or_default();
    entry.rating = (stars > 0).then_some(stars);
    let result = entry.clone();
    save_votes(root, &votes)?;
    Ok(result)
}
pub fn favorite(root: &Path, id: &str, on: bool) -> Result<Vote> {
    let mut votes = load_votes(root);
    let entry = votes.entry(id.to_string()).or_default();
    entry.favorite = on;
    let result = entry.clone();
    save_votes(root, &votes)?;
    Ok(result)
}

/// `_minecraft._tcp` SRV kaydı varsa gerçek hedefi ve portu döndürür.
#[cfg(windows)]
fn srv(host: &str) -> Option<(String, u16)> {
    use std::ffi::c_void;
    #[repr(C)]
    struct SrvData {
        target: *const u16,
        priority: u16,
        weight: u16,
        port: u16,
        pad: u16,
    }
    #[repr(C)]
    struct Record {
        next: *mut Record,
        name: *const u16,
        kind: u16,
        length: u16,
        flags: u32,
        ttl: u32,
        reserved: u32,
        data: SrvData,
    }
    #[link(name = "dnsapi")]
    unsafe extern "system" {
        fn DnsQuery_W(
            name: *const u16,
            kind: u16,
            options: u32,
            extra: *mut c_void,
            results: *mut *mut Record,
            reserved: *mut c_void,
        ) -> i32;
        fn DnsRecordListFree(list: *mut Record, free_type: i32);
    }
    const SRV: u16 = 33;
    let name: Vec<u16> = format!("_minecraft._tcp.{host}")
        .encode_utf16()
        .chain([0])
        .collect();
    let mut list: *mut Record = std::ptr::null_mut();
    // SAFETY: ad NUL ile biter; dönen liste aşağıda tek kez serbest bırakılır.
    let status = unsafe {
        DnsQuery_W(name.as_ptr(), SRV, 0, std::ptr::null_mut(), &mut list, std::ptr::null_mut())
    };
    if status != 0 || list.is_null() {
        return None;
    }
    let mut best: Option<(u16, String, u16)> = None;
    let mut cursor = list;
    while !cursor.is_null() {
        // SAFETY: Windows'un döndürdüğü bağlı liste; yalnızca SRV kayıtlarının verisi okunur.
        let record = unsafe { &*cursor };
        if record.kind == SRV && !record.data.target.is_null() {
            let mut len = 0;
            // SAFETY: hedef ad NUL ile biten geniş karakter dizisidir.
            while unsafe { *record.data.target.add(len) } != 0 && len < 255 {
                len += 1;
            }
            let target = String::from_utf16_lossy(unsafe {
                std::slice::from_raw_parts(record.data.target, len)
            });
            if best.as_ref().is_none_or(|(p, _, _)| record.data.priority < *p) {
                best = Some((record.data.priority, target, record.data.port));
            }
        }
        cursor = record.next;
    }
    // SAFETY: liste DnsQuery_W tarafından ayrıldı; 1 = DnsFreeRecordList.
    unsafe { DnsRecordListFree(list, 1) };
    best.and_then(|(_, target, port)| {
        let target = target.trim_end_matches('.').to_ascii_lowercase();
        host_ok(&target).then_some((target, port))
    })
}
#[cfg(not(windows))]
fn srv(_: &str) -> Option<(String, u16)> {
    None
}

fn write_varint(out: &mut Vec<u8>, mut value: u32) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}
fn read_varint(stream: &mut impl Read) -> Result<u32> {
    let mut value = 0u32;
    for shift in 0..5 {
        let mut byte = [0u8];
        stream.read_exact(&mut byte)?;
        value |= u32::from(byte[0] & 0x7f) << (7 * shift);
        if byte[0] & 0x80 == 0 {
            return Ok(value);
        }
    }
    bail!("Geçersiz sunucu yanıtı.")
}
fn packet(id: u8, body: &[u8]) -> Vec<u8> {
    let mut inner = vec![id];
    inner.extend_from_slice(body);
    let mut out = Vec::new();
    write_varint(&mut out, inner.len() as u32);
    out.extend(inner);
    out
}

/// Sohbet bileşenini düz metne çevirir ve § renk kodlarını temizler.
fn flatten(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::String(s) => out.push_str(s),
        serde_json::Value::Array(items) => items.iter().for_each(|v| flatten(v, out)),
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text") {
                flatten(text, out);
            }
            if let Some(extra) = map.get("extra") {
                flatten(extra, out);
            }
        }
        _ => {}
    }
}
fn strip_codes(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}
fn status_from(json: &serde_json::Value, latency: u32) -> Ping {
    let mut motd = String::new();
    flatten(&json["description"], &mut motd);
    let motd = strip_codes(&motd).chars().take(200).collect::<String>();
    let favicon = json["favicon"]
        .as_str()
        .filter(|f| f.starts_with("data:image/png;base64,") && f.len() <= 120_000)
        .map(str::to_string);
    Ping {
        online: true,
        players: json["players"]["online"].as_u64().map(|v| v.min(10_000_000) as u32),
        max_players: json["players"]["max"].as_u64().map(|v| v.min(10_000_000) as u32),
        version: json["version"]["name"]
            .as_str()
            .map(|v| strip_codes(v).chars().take(40).collect()),
        motd: (!motd.is_empty()).then_some(motd),
        favicon,
        latency_ms: Some(latency),
    }
}

pub fn ping(server: &Server) -> Ping {
    ping_inner(server).unwrap_or(Ping {
        online: false,
        players: None,
        max_players: None,
        version: None,
        motd: None,
        favicon: None,
        latency_ms: None,
    })
}
fn ping_inner(server: &Server) -> Result<Ping> {
    let (host, port) = match server.port {
        Some(port) => (server.address.clone(), port),
        None => srv(&server.address).unwrap_or((server.address.clone(), 25565)),
    };
    let address = (host.as_str(), port)
        .to_socket_addrs()?
        .next()
        .context("Sunucu adresi çözülemedi.")?;
    let timeout = Duration::from_secs(4);
    let mut stream = TcpStream::connect_timeout(&address, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let mut handshake = Vec::new();
    write_varint(&mut handshake, 767);
    write_varint(&mut handshake, host.len() as u32);
    handshake.extend_from_slice(host.as_bytes());
    handshake.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake, 1);
    let started = Instant::now();
    stream.write_all(&packet(0, &handshake))?;
    stream.write_all(&packet(0, &[]))?;
    let length = read_varint(&mut stream)?;
    if length > 300_000 {
        bail!("Sunucu yanıtı çok büyük.");
    }
    let latency = started.elapsed().as_millis().min(60_000) as u32;
    let mut body = vec![0u8; length as usize];
    stream.read_exact(&mut body)?;
    let mut cursor = &body[..];
    if read_varint(&mut cursor)? != 0 {
        bail!("Beklenmeyen sunucu yanıtı.");
    }
    let text_len = read_varint(&mut cursor)? as usize;
    let text = cursor.get(..text_len).context("Eksik sunucu yanıtı.")?;
    let json: serde_json::Value = serde_json::from_slice(text)?;
    Ok(status_from(&json, latency))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_list_is_valid_and_sorted() {
        let servers = parse(BUNDLED.as_bytes()).unwrap();
        assert!(servers.len() >= 10);
        let first_plain = servers.iter().position(|s| !s.sponsored && !s.featured).unwrap();
        assert!(servers[first_plain..].iter().all(|s| !s.sponsored && !s.featured));
    }
    #[test]
    fn invalid_entries_are_dropped() {
        let doc = br#"{"version":2,"servers":[
            {"id":"ok","name":"Ok","address":"play.example.net","country":"de"},
            {"id":"bad-host","name":"Bad","address":"http://x.y/z","country":"de"},
            {"id":"bad-country","name":"Bad","address":"a.example.net","country":"mars"},
            {"id":"ok","name":"Duplicate","address":"b.example.net","country":"de"},
            {"id":"bad-link","name":"Bad","address":"c.example.net","country":"de","website":"http://x.y"},
            {"id":"bad-lang","name":"Bad","address":"d.example.net","country":"de","languages":["DEU"]}
        ]}"#;
        let servers = parse(doc).unwrap();
        assert_eq!(servers.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["ok"]);
        assert!(parse(br#"{"version":1,"servers":[]}"#).is_err());
        // Yeni alanlar eski sürümleri bozmaz; site dışı banner atılır.
        let doc = br#"{"version":2,"future":1,"servers":[
            {"id":"a","name":"A","address":"a.example.net","country":"de","votes":7,"rank":1,"extra":true,
             "banner":"https://patronlauncher.net/api/servers/banner-a.gif?v=1"},
            {"id":"b","name":"B","address":"b.example.net","country":"de","banner":"https://evil.example/x.gif"}
        ]}"#;
        let servers = parse(doc).unwrap();
        assert_eq!((servers[0].votes, servers[0].rank), (7, Some(1)));
        assert!(servers[0].banner.is_some() && servers[1].banner.is_none());
        assert_eq!(page_url("a", "tr"), "https://patronlauncher.net/tr/servers/a");
        assert_eq!(page_url("a", "en"), "https://patronlauncher.net/servers/a");
    }
    #[test]
    fn bundled_list_covers_every_launcher_language_country() {
        let servers = parse(BUNDLED.as_bytes()).unwrap();
        assert!(servers.len() >= 80);
        for country in ["tr", "us", "gb", "de", "es", "fr", "in", "pl", "br", "ru"] {
            assert!(servers.iter().any(|s| s.country == country), "{country}");
        }
    }
    #[test]
    fn ratings_are_bounded_and_favorites_saved() {
        let root = std::env::temp_dir().join(format!("patron-votes-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(rate(&root, "hypixel", 4).unwrap().rating, Some(4));
        assert!(rate(&root, "hypixel", 6).is_err());
        assert_eq!(rate(&root, "hypixel", 0).unwrap().rating, None);
        assert!(favorite(&root, "hypixel", true).unwrap().favorite);
        let saved = load_votes(&root);
        assert!(saved["hypixel"].favorite);
        // Bozuk ya da elle değiştirilmiş kayıtlar yok sayılır.
        std::fs::write(root.join(VOTES), br#"{"BAD ID":{"votes":9},"x":{"rating":9}}"#).unwrap();
        assert!(load_votes(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
    #[test]
    fn varints_round_trip_and_status_is_sanitized() {
        for value in [0, 1, 127, 128, 25565, 767, u32::MAX] {
            let mut out = Vec::new();
            write_varint(&mut out, value);
            assert_eq!(read_varint(&mut &out[..]).unwrap(), value);
        }
        let json = serde_json::json!({
            "description": {"text": "§aHello ", "extra": [{"text": "§lWorld"}, "!"]},
            "players": {"online": 12, "max": 100},
            "version": {"name": "Paper 1.21.11"},
            "favicon": "data:text/html;base64,AAAA"
        });
        let ping = status_from(&json, 42);
        assert_eq!(ping.motd.as_deref(), Some("Hello World!"));
        assert_eq!((ping.players, ping.max_players), (Some(12), Some(100)));
        assert!(ping.favicon.is_none());
    }
    #[test]
    fn pings_a_local_status_server() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            for _ in 0..2 {
                let len = read_varint(&mut socket).unwrap();
                let mut buf = vec![0; len as usize];
                socket.read_exact(&mut buf).unwrap();
            }
            let json = br#"{"version":{"name":"26.3"},"players":{"online":5,"max":20},"description":"Test"}"#;
            let mut body = Vec::new();
            write_varint(&mut body, json.len() as u32);
            body.extend_from_slice(json);
            socket.write_all(&packet(0, &body)).unwrap();
        });
        let server = Server {
            id: "local".into(),
            name: "Local".into(),
            address: "localhost.localdomain".into(),
            port: Some(port),
            country: "de".into(),
            languages: vec![],
            tags: vec![],
            description: HashMap::new(),
            versions: String::new(),
            website: None,
            discord: None,
            sponsored: false,
            featured: false,
            votes: 0,
            rank: None,
            banner: None,
        };
        // localhost.localdomain her sistemde çözülmeyebilir; doğrudan iç fonksiyonu IP ile dene.
        let server = Server { address: "127.0.0.1".into(), ..server };
        let ping = ping_inner(&server).unwrap();
        assert!(ping.online);
        assert_eq!(ping.players, Some(5));
        assert_eq!(ping.motd.as_deref(), Some("Test"));
    }
}
