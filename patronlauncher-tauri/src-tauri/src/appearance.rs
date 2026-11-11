use serde::{Deserialize, Serialize};
pub const LANGUAGES: [&str; 10] = ["en", "de", "es", "pt", "fr", "it", "pl", "hi", "ru", "tr"];
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub skin: String,
    pub particles: bool,
    pub animations: bool,
    pub splash: bool,
    pub collapsed: bool,
    pub discord_override: Option<String>,
    /// None: dil henüz seçilmedi; ilk açılışta seçim ekranı gösterilir.
    pub language: Option<String>,
    pub discord_language: String,
    /// Oyun başladığında launcher penceresi: "keep" veya "minimize".
    pub launch_behavior: String,
    pub restore_on_exit: bool,
    pub home_on_launch: bool,
    /// Ana sayfadaki sunucu paneli daraltıldı mı.
    pub server_panel_collapsed: bool,
    /// skin == "custom" iken uygulanan kullanıcı teması.
    pub custom_theme: CustomTheme,
    /// Prosedürel ambiyans sesleri.
    pub ambience: Ambience,
    /// Launcher içi müzik çalar.
    pub music: Music,
    /// Son kullanılan arayüz: "launcher" (PatronLauncher) veya "pclient".
    pub ui_mode: String,
    /// Açılışta gösterilecek arayüz: "launcher", "pclient" veya "last".
    /// None: oyuncuya henüz sorulmadı; son kullanılan arayüz açılır.
    pub startup_ui: Option<String>,
}
pub const UI_MODES: [&str; 2] = ["launcher", "pclient"];
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Music {
    /// 0-100
    pub volume: u8,
    pub muted: bool,
    /// Launcher açılınca çalmaya başla.
    pub autoplay: bool,
    pub shuffle: bool,
    /// "all": listeyi döndür, "one": aynı parçayı tekrarla.
    pub repeat: String,
    /// Oyun açıkken müziği duraklat.
    pub pause_in_game: bool,
    /// Sağ üstteki çalar penceresi görünür mü.
    pub widget: bool,
    /// Çalar küçük (yalnızca şerit) mi.
    pub compact: bool,
    /// "launcher" veya "spotify".
    pub source: String,
}
impl Default for Music {
    fn default() -> Self {
        Self {
            volume: 5,
            muted: false,
            autoplay: true,
            shuffle: true,
            repeat: "all".into(),
            pause_in_game: true,
            widget: true,
            compact: false,
            source: "launcher".into(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct CustomTheme {
    pub accent: String,
    pub accent2: String,
    pub background: String,
    pub particle_color: String,
    /// 0-100
    pub particle_density: u8,
    /// 25-300 (yüzde)
    pub particle_speed: u16,
    /// 0-100
    pub glow: u8,
}
impl Default for CustomTheme {
    fn default() -> Self {
        Self {
            accent: "#ff5a36".into(),
            accent2: "#c2185b".into(),
            background: "#0c0a12".into(),
            particle_color: "#ffb454".into(),
            particle_density: 50,
            particle_speed: 100,
            glow: 30,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Ambience {
    /// Ana ses düzeyi, 0-100.
    pub volume: u8,
    /// Kapalıyken ses birkaç dakika sonra yavaşça kapanır.
    pub looped: bool,
    /// Katman düzeyleri, 0-100 (0: kapalı).
    pub rain: u8,
    pub wind: u8,
    pub birds: u8,
    pub fire: u8,
}
impl Default for Ambience {
    fn default() -> Self {
        Self { volume: 50, looped: true, rain: 60, wind: 25, birds: 40, fire: 0 }
    }
}
fn hex_color(v: &str) -> bool {
    v.len() == 7 && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit())
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            skin: "patron".into(),
            particles: true,
            animations: true,
            splash: true,
            collapsed: false,
            discord_override: None,
            language: None,
            discord_language: "en".into(),
            launch_behavior: "keep".into(),
            restore_on_exit: true,
            home_on_launch: true,
            server_panel_collapsed: false,
            custom_theme: CustomTheme::default(),
            ambience: Ambience::default(),
            music: Music::default(),
            ui_mode: "launcher".into(),
            startup_ui: None,
        }
    }
}
impl Preferences {
    pub fn validate(&self) -> Result<(), String> {
        if !["patron", "mavi", "orman", "mor", "amoled", "custom"].contains(&self.skin.as_str()) {
            return Err("Görünüm teması geçersiz.".into());
        }
        if let Some(id) = &self.discord_override {
            if !id.is_empty() && !crate::discord::valid_id(id) {
                return Err("Discord uygulama kimliği geçersiz.".into());
            }
        }
        if self.language.as_deref().is_some_and(|l| !LANGUAGES.contains(&l))
            || !LANGUAGES.contains(&self.discord_language.as_str())
        {
            return Err("Dil seçimi geçersiz.".into());
        }
        if !["keep", "minimize"].contains(&self.launch_behavior.as_str()) {
            return Err("Oyun başlatma davranışı geçersiz.".into());
        }
        let c = &self.custom_theme;
        if ![&c.accent, &c.accent2, &c.background, &c.particle_color]
            .iter()
            .all(|v| hex_color(v))
            || c.particle_density > 100
            || !(25..=300).contains(&c.particle_speed)
            || c.glow > 100
        {
            return Err("Özel tema değerleri geçersiz.".into());
        }
        let a = &self.ambience;
        if [a.volume, a.rain, a.wind, a.birds, a.fire].iter().any(|v| *v > 100) {
            return Err("Ambiyans ses düzeyleri geçersiz.".into());
        }
        let m = &self.music;
        if m.volume > 100
            || !["all", "one"].contains(&m.repeat.as_str())
            || !["launcher", "spotify"].contains(&m.source.as_str())
        {
            return Err("Müzik çalar ayarları geçersiz.".into());
        }
        if !UI_MODES.contains(&self.ui_mode.as_str())
            || self
                .startup_ui
                .as_deref()
                .is_some_and(|s| !UI_MODES.contains(&s) && s != "last")
        {
            return Err("Arayüz seçimi geçersiz.".into());
        }
        Ok(())
    }
    /// Kayıtlı tercihleri okur; eksik veya bozuk dosyada varsayılanları döndürür.
    /// Launcher açılırken hangi arayüzle başlayacak: sabit açılış tercihi varsa o, yoksa son kullanılan.
    pub fn launch_ui(&self) -> &str {
        match self.startup_ui.as_deref() {
            Some(mode) if mode != "last" => mode,
            _ => &self.ui_mode,
        }
    }
    pub fn load(root: &std::path::Path) -> Self {
        std::fs::read(root.join("appearance.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Self>(&b).ok())
            .filter(|p| p.validate().is_ok())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::Preferences;
    #[test]
    fn old_files_get_new_defaults_and_invalid_languages_are_rejected() {
        let old: Preferences =
            serde_json::from_str(r#"{"skin":"mor","particles":false,"animations":true,"splash":true}"#)
                .unwrap();
        assert_eq!(old.skin, "mor");
        assert!(old.language.is_none());
        assert_eq!(old.discord_language, "en");
        assert!(old.validate().is_ok());
        let bad = Preferences { language: Some("xx".into()), ..Default::default() };
        assert!(bad.validate().is_err());
        let bad = Preferences { launch_behavior: "hide".into(), ..Default::default() };
        assert!(bad.validate().is_err());
        assert!(!old.server_panel_collapsed);
        assert_eq!(old.custom_theme, super::CustomTheme::default());
    }
    #[test]
    fn custom_theme_and_ambience_are_validated() {
        let ok: Preferences = serde_json::from_str(
            r##"{"skin":"custom","custom_theme":{"accent":"#112233","particle_speed":250},"ambience":{"rain":0,"fire":80}}"##,
        )
        .unwrap();
        assert!(ok.validate().is_ok());
        assert_eq!(ok.custom_theme.background, "#0c0a12");
        let mut bad = ok.clone();
        bad.custom_theme.accent = "red".into();
        assert!(bad.validate().is_err());
        let mut bad = ok.clone();
        bad.custom_theme.particle_speed = 10;
        assert!(bad.validate().is_err());
        let mut bad = ok.clone();
        bad.ambience.volume = 101;
        assert!(bad.validate().is_err());
        assert!(serde_json::from_str::<Preferences>(r#"{"custom_theme":{"evil":1}}"#).is_err());
        let mut bad = ok.clone();
        bad.music.repeat = "never".into();
        assert!(bad.validate().is_err());
        let mut bad = ok.clone();
        bad.music.source = "radio".into();
        assert!(bad.validate().is_err());
        assert_eq!(ok.music, super::Music::default());
    }
    #[test]
    fn ui_mode_and_startup_choice_are_validated() {
        let old: Preferences = serde_json::from_str(r#"{"skin":"patron"}"#).unwrap();
        assert_eq!(old.ui_mode, "launcher");
        assert!(old.startup_ui.is_none());
        assert!(old.validate().is_ok());
        let ok: Preferences =
            serde_json::from_str(r#"{"skin":"patron","ui_mode":"pclient","startup_ui":"last"}"#)
                .unwrap();
        assert!(ok.validate().is_ok());
        for startup in ["launcher", "pclient", "last"] {
            let p = Preferences { startup_ui: Some(startup.into()), ..Default::default() };
            assert!(p.validate().is_ok());
        }
        let bad = Preferences { ui_mode: "lunar".into(), ..Default::default() };
        assert!(bad.validate().is_err());
        let bad = Preferences { startup_ui: Some("always".into()), ..Default::default() };
        assert!(bad.validate().is_err());
    }
}
