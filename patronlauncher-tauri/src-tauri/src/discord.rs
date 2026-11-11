//! Discord masaüstü uygulamasıyla yerel Rich Presence bağlantısı.
use discord_rich_presence::{DiscordIpc, DiscordIpcClient, activity};
use std::{
    sync::mpsc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub struct Presence(mpsc::Sender<String>);

pub const DEFAULT_CLIENT_ID: &str = "1566023032466571287";
/// PClient arayüzündeyken kullanılan ayrı Discord uygulaması.
pub const PCLIENT_CLIENT_ID: &str = "1568645992314568784";
/// Launcher şu an PClient arayüzünde mi? Rich Presence buna göre uygulama seçer.
static PCLIENT_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Etkinlikte gösterilen sunucu. Yalnızca doğrulanmış sunucu listesindekiler verilir; böylece
/// oyuncunun özel sunucusunun adresi Discord'da görünmez.
#[derive(Clone, Debug, PartialEq)]
pub struct ServerPresence {
    pub name: String,
    pub address: String,
    pub website: Option<String>,
}
#[derive(Clone, Debug, PartialEq)]
struct Game {
    pclient: bool,
    started: i64,
    server: Option<ServerPresence>,
}
static GAME: std::sync::Mutex<Option<Game>> = std::sync::Mutex::new(None);
/// Oyun durumu değişince etkinlik 15 sn beklemeden yayımlanır.
static REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn change_game(update: impl FnOnce(&mut Option<Game>)) {
    if let Ok(mut game) = GAME.lock() {
        update(&mut game);
        REVISION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

fn now_seconds() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

pub fn game_started(pclient: bool) {
    change_game(|game| *game = Some(Game { pclient, started: now_seconds(), server: None }));
}

/// Oyun açıkken sunucuya girildiğini ya da çıkıldığını bildirir.
pub fn game_server(server: Option<ServerPresence>) {
    change_game(|game| {
        if let Some(game) = game {
            game.server = server;
        }
    });
}

pub fn game_stopped() {
    change_game(|game| *game = None);
}

fn current_game() -> Option<Game> {
    GAME.lock().ok().and_then(|game| game.clone())
}

pub fn set_pclient_mode(on: bool) {
    PCLIENT_MODE.store(on, std::sync::atomic::Ordering::Relaxed);
}

/// Ayarlarda Discord kapalıysa (boş kimlik) iki arayüzde de kapalı kalır.
fn effective_id(configured: &str) -> String {
    let pclient = current_game().map_or_else(|| PCLIENT_MODE.load(std::sync::atomic::Ordering::Relaxed), |game| game.pclient);
    if configured.trim().is_empty() {
        String::new()
    } else if pclient {
        PCLIENT_CLIENT_ID.into()
    } else {
        configured.into()
    }
}
// Public application icon currently published in the Discord Developer Portal.
const PRESENCE_ICON: &str = "https://cdn.discordapp.com/app-icons/1566023032466571287/ff6655a4405f2cfb405257fd8324219a.png?size=256";
const PCLIENT_ICON: &str = "https://cdn.discordapp.com/app-icons/1568645992314568784/3c8cdfb0efdee8bc80b82a87113a8769.png?size=256";
/// Discord düğme etiketi sınırı.
const MAX_BUTTON_LABEL: usize = 32;
static LANGUAGE: std::sync::RwLock<&'static str> = std::sync::RwLock::new("en");

/// Etkinlik metninin dilini değiştirir; bir sonraki yayınlamada (en geç 15 sn) uygulanır.
pub fn set_language(code: &str) {
    if let Some(known) = crate::appearance::LANGUAGES.iter().find(|l| **l == code)
        && let Ok(mut current) = LANGUAGE.write()
    {
        *current = known;
    }
}

fn menu_suffix(code: &str) -> &'static str {
    match code {
        "de" => "Hauptmenü",
        "es" => "Menú principal",
        "pt" => "Menu principal",
        "fr" => "Menu principal",
        "it" => "Menu principale",
        "pl" => "Menu główne",
        "hi" => "मुख्य मेनू",
        "ru" => "Главное меню",
        "tr" => "Ana menü",
        _ => "Main menu",
    }
}

fn in_game_suffix(code: &str) -> &'static str {
    match code {
        "de" => "Im Spiel",
        "es" => "En el juego",
        "pt" => "Em jogo",
        "fr" => "En jeu",
        "it" => "In gioco",
        "pl" => "W grze",
        "hi" => "गेम में",
        "ru" => "В игре",
        "tr" => "Oyunda",
        _ => "In game",
    }
}

fn playing_on(code: &str, server: &str) -> String {
    match code {
        "de" => format!("Spielt auf {server}"),
        "es" => format!("Jugando en {server}"),
        "pt" => format!("Jogando em {server}"),
        "fr" => format!("Joue sur {server}"),
        "it" => format!("Gioca su {server}"),
        "pl" => format!("Gra na {server}"),
        "hi" => format!("{server} पर खेल रहे हैं"),
        "ru" => format!("Играет на {server}"),
        "tr" => format!("{server} üzerinde oynuyor"),
        _ => format!("Playing on {server}"),
    }
}

fn website_label(code: &str) -> &'static str {
    match code {
        "de" => "Webseite",
        "es" => "Sitio web",
        "pt" => "Site",
        "fr" => "Site web",
        "it" => "Sito web",
        "pl" => "Strona",
        "hi" => "वेबसाइट",
        "ru" => "Сайт",
        "tr" => "Web Sitesi",
        _ => "Website",
    }
}

#[cfg(test)]
fn menu_text(code: &str) -> String {
    format!("PatronLauncher · {}", menu_suffix(code))
}

/// Bir yayın için hazırlanan metin ve görseller.
#[derive(Debug, PartialEq)]
struct PresenceText {
    brand: &'static str,
    details: String,
    state: Option<String>,
    started: i64,
    server_icon: Option<String>,
    server_name: Option<String>,
    icon: Option<&'static str>,
    buttons: Vec<(String, String)>,
}

fn presence_text(started: i64, pclient: bool, game: Option<&Game>, code: &str) -> PresenceText {
    let brand = if pclient { "PClient" } else { "PatronLauncher" };
    let icon = if pclient { PCLIENT_ICON } else { PRESENCE_ICON };
    let Some(game) = game else {
        // Menüde PClient uygulamasının kendi simgesi Discord tarafından gösterilir.
        return PresenceText {
            brand,
            details: format!("{brand} · {}", menu_suffix(code)),
            state: None,
            started,
            server_icon: None,
            server_name: None,
            icon: (!pclient).then_some(PRESENCE_ICON),
            buttons: vec![],
        };
    };
    let Some(server) = &game.server else {
        return PresenceText {
            brand,
            details: format!("{brand} · {}", in_game_suffix(code)),
            state: None,
            started: game.started,
            server_icon: None,
            server_name: None,
            icon: (!pclient).then_some(PRESENCE_ICON),
            buttons: vec![],
        };
    };
    let status_page = format!("https://mcstatus.io/status/java/{}", server.address);
    let mut buttons = vec![];
    if let Some(site) = &server.website {
        buttons.push((website_label(code).to_string(), site.clone()));
    }
    if server.address.chars().count() <= MAX_BUTTON_LABEL {
        buttons.push((server.address.clone(), server.website.clone().unwrap_or(status_page)));
    }
    PresenceText {
        brand,
        details: playing_on(code, &server.name),
        state: Some(server.address.clone()),
        started: game.started,
        server_icon: Some(format!("https://api.mcstatus.io/v2/icon/{}", server.address)),
        server_name: Some(server.name.clone()),
        icon: Some(icon),
        buttons,
    }
}

impl PresenceText {
    fn activity(&self) -> activity::Activity<'_> {
        let mut out = activity::Activity::new()
            .name(self.brand)
            .details(self.details.as_str())
            .timestamps(activity::Timestamps::new().start(self.started));
        if let Some(state) = &self.state {
            out = out.state(state.as_str());
        }
        match (&self.server_icon, self.icon) {
            (Some(server), Some(icon)) => {
                out = out.assets(
                    activity::Assets::new()
                        .large_image(server.as_str())
                        .large_text(self.server_name.as_deref().unwrap_or(self.brand))
                        .small_image(icon)
                        .small_text(self.brand),
                );
            }
            (None, Some(icon)) => {
                out = out.assets(activity::Assets::new().large_image(icon).large_text(self.brand));
            }
            _ => {}
        }
        if !self.buttons.is_empty() {
            out = out.buttons(
                self.buttons.iter().map(|(label, url)| activity::Button::new(label.as_str(), url.as_str())).collect(),
            );
        }
        out
    }
}

fn current_text(started: i64, pclient: bool) -> PresenceText {
    let code = LANGUAGE.read().map(|l| *l).unwrap_or("en");
    presence_text(started, pclient, current_game().as_ref(), code)
}

impl Presence {
    pub fn start(client_id: String) -> Self {
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            // configured: ayarlardaki kimlik; active: o an bağlı olunan uygulama.
            let mut configured = client_id;
            let mut active = effective_id(&configured);
            let started = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let mut client: Option<DiscordIpcClient> = None;
            let mut last_publish = std::time::Instant::now();
            let mut published_revision = REVISION.load(std::sync::atomic::Ordering::Relaxed);
            let mut next_attempt = std::time::Instant::now();
            let close = |client: &mut Option<DiscordIpcClient>| {
                if let Some(mut previous) = client.take() {
                    let _ = previous.clear_activity();
                    let _ = previous.close();
                }
            };
            loop {
                let pclient = active == PCLIENT_CLIENT_ID;
                // Discord kapalıysa bağlantı her saniye değil, 15 sn'de bir denenir.
                if client.is_none() && valid_id(&active) && std::time::Instant::now() >= next_attempt {
                    let mut candidate = DiscordIpcClient::new(&active);
                    if connect_and_publish(&mut candidate, started, pclient) {
                        client = Some(candidate);
                        last_publish = std::time::Instant::now();
                    } else {
                        next_attempt = std::time::Instant::now() + Duration::from_secs(15);
                    }
                }
                // Arayüz değişimi (PatronLauncher ↔ PClient) en geç 1 sn içinde algılanır.
                match rx.recv_timeout(Duration::from_secs(1)) {
                    Ok(next) => configured = next,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        close(&mut client);
                        break;
                    }
                }
                let wanted = effective_id(&configured);
                if wanted != active {
                    close(&mut client);
                    active = wanted;
                    next_attempt = std::time::Instant::now();
                    continue;
                }
                let revision = REVISION.load(std::sync::atomic::Ordering::Relaxed);
                if client.is_some() && (revision != published_revision || last_publish.elapsed() >= Duration::from_secs(15)) {
                    published_revision = revision;
                    last_publish = std::time::Instant::now();
                    let text = current_text(started, pclient);
                    let ok = client.as_mut().is_some_and(|current| {
                        current.set_activity(text.activity()).is_ok() && response_ok(current)
                    });
                    if !ok {
                        client = None;
                        next_attempt = std::time::Instant::now() + Duration::from_secs(15);
                    }
                }
            }
        });
        Self(tx)
    }

    pub fn configure(&self, client_id: String) {
        let _ = self.0.send(client_id);
    }
}

fn connect_and_publish(client: &mut impl DiscordIpc, started: i64, pclient: bool) -> bool {
    let text = current_text(started, pclient);
    client.connect().is_ok() && client.set_activity(text.activity()).is_ok() && response_ok(client)
}

fn response_ok(client: &mut impl DiscordIpc) -> bool {
    client
        .recv()
        .is_ok_and(|(_, value)| value.get("evt").and_then(|v| v.as_str()) != Some("ERROR"))
}

pub fn valid_id(id: &str) -> bool {
    (17..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use discord_rich_presence::{DiscordIpc, activity, error::Error};

    #[derive(Default)]
    struct FakeIpc {
        reads: usize,
        activity_sent: bool,
    }

    impl DiscordIpc for FakeIpc {
        fn get_client_id(&self) -> &str {
            super::DEFAULT_CLIENT_ID
        }
        fn connect_ipc(&mut self) -> Result<(), Error> {
            Ok(())
        }
        fn write(&mut self, _: &[u8]) -> Result<(), Error> {
            Ok(())
        }
        fn read(&mut self, _: &mut [u8]) -> Result<(), Error> {
            unreachable!()
        }
        fn close(&mut self) -> Result<(), Error> {
            Ok(())
        }
        fn set_activity(&mut self, _: activity::Activity) -> Result<(), Error> {
            self.activity_sent = true;
            Ok(())
        }
        fn recv(&mut self) -> Result<(u32, serde_json::Value), Error> {
            self.reads += 1;
            if self.reads == 1 {
                Ok((1, serde_json::json!({"evt": "READY"})))
            } else if self.activity_sent {
                Ok((1, serde_json::json!({"cmd": "SET_ACTIVITY"})))
            } else {
                Err(Error::NotConnected)
            }
        }
    }

    #[test]
    fn publishes_immediately_after_handshake_response() {
        let mut client = FakeIpc::default();
        assert!(super::connect_and_publish(&mut client, 123, false));
        assert!(client.activity_sent);
        assert_eq!(client.reads, 2);
    }
    #[test]
    fn published_activity_uses_current_brand_and_portal_icon() {
        let text = super::presence_text(123, false, None, "en");
        let payload = serde_json::to_value(text.activity()).unwrap();
        assert_eq!(payload["name"], "PatronLauncher");
        assert_eq!(payload["details"], "PatronLauncher · Main menu");
        assert_eq!(payload["assets"]["large_image"], super::PRESENCE_ICON);
        assert_eq!(payload["assets"]["large_text"], "PatronLauncher");
        assert_eq!(payload["timestamps"]["start"], 123);
    }
    fn game(server: Option<super::ServerPresence>) -> super::Game {
        super::Game { pclient: true, started: 500, server }
    }
    #[test]
    fn in_game_presence_names_the_brand() {
        let text = super::presence_text(123, true, Some(&game(None)), "tr");
        assert_eq!(text.details, "PClient · Oyunda");
        assert_eq!(text.started, 500);
        assert!(text.buttons.is_empty());
    }
    #[test]
    fn server_presence_shows_logo_badge_and_buttons() {
        let server = super::ServerPresence {
            name: "ChickenNW".into(),
            address: "play.chickennw.com".into(),
            website: Some("https://chickennw.com".into()),
        };
        let text = super::presence_text(123, true, Some(&game(Some(server))), "tr");
        let payload = serde_json::to_value(text.activity()).unwrap();
        assert_eq!(payload["details"], "ChickenNW üzerinde oynuyor");
        assert_eq!(payload["state"], "play.chickennw.com");
        assert_eq!(payload["assets"]["large_image"], "https://api.mcstatus.io/v2/icon/play.chickennw.com");
        assert_eq!(payload["assets"]["small_image"], super::PCLIENT_ICON);
        assert_eq!(payload["buttons"][0]["label"], "Web Sitesi");
        assert_eq!(payload["buttons"][1]["label"], "play.chickennw.com");
        assert_eq!(payload["buttons"][1]["url"], "https://chickennw.com");
    }
    #[test]
    fn server_without_website_links_its_status_page_and_skips_long_labels() {
        let short = super::ServerPresence { name: "A".into(), address: "a.test".into(), website: None };
        let text = super::presence_text(1, false, Some(&game(Some(short))), "en");
        assert_eq!(text.buttons, vec![("a.test".to_string(), "https://mcstatus.io/status/java/a.test".to_string())]);
        let long = super::ServerPresence { name: "B".into(), address: "x".repeat(33), website: None };
        assert!(super::presence_text(1, false, Some(&game(Some(long))), "en").buttons.is_empty());
    }
    #[test]
    fn presence_text_follows_every_supported_language() {
        for code in crate::appearance::LANGUAGES {
            assert!(super::menu_text(code).starts_with("PatronLauncher · "));
        }
        assert_eq!(super::menu_text("tr"), "PatronLauncher · Ana menü");
        assert_eq!(super::menu_text("unknown"), "PatronLauncher · Main menu");
    }
    #[test]
    fn validates_discord_application_ids() {
        assert!(super::valid_id("123456789012345678"));
        assert!(!super::valid_id("123"));
        assert!(!super::valid_id("12345678901234567x"));
        assert!(!super::valid_id(""));
    }

    #[test]
    fn old_settings_get_default_but_explicit_opt_out_is_preserved() {
        let old: crate::model::State = serde_json::from_str("{}").unwrap();
        assert_eq!(old.discord_client_id, super::DEFAULT_CLIENT_ID);
        let disabled: crate::model::State =
            serde_json::from_str(r#"{"discord_client_id":""}"#).unwrap();
        assert!(disabled.discord_client_id.is_empty());
    }

    #[test]
    fn pclient_mode_switches_app_but_keeps_discord_disabled_when_off() {
        super::set_pclient_mode(true);
        assert_eq!(super::effective_id(super::DEFAULT_CLIENT_ID), super::PCLIENT_CLIENT_ID);
        assert_eq!(super::effective_id(""), "");
        super::set_pclient_mode(false);
        assert_eq!(super::effective_id(super::DEFAULT_CLIENT_ID), super::DEFAULT_CLIENT_ID);
        assert!(super::valid_id(super::PCLIENT_CLIENT_ID));
    }
}
