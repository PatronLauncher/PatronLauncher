//! Bilgisayarda çalan müziği Windows medya oturumu (SMTC) üzerinden okur ve yönetir.
//! Spotify, Deezer, YouTube Music (tarayıcıda ya da masaüstünde) gibi Windows medya
//! tuşlarıyla çalışan her oynatıcıda geçerlidir; hesap bağlamak veya Premium gerekmez.
//! Ses düzeyi, Windows ses karıştırıcısındaki o uygulamanın kaydırıcısıdır.
use anyhow::{Context, Result, bail, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    io::Cursor,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    },
    Storage::Streams::{Buffer, DataReader, InputStreamOptions},
};

/// Windows zamanları 100 nanosaniyelik birimlerle verir.
const TICKS_PER_MS: i64 = 10_000;
/// 1601-01-01 ile 1970-01-01 arası, 100 ns cinsinden.
const EPOCH_1601: i64 = 116_444_736_000_000_000;
/// Kapak resmi bundan büyükse okunmaz.
const MAX_COVER: u32 = 4 * 1024 * 1024;

#[derive(Serialize, Debug, PartialEq)]
pub struct NowPlaying {
    pub title: String,
    pub artists: String,
    pub album: String,
    /// Kapak varsa `cover` ile istenecek anahtar.
    pub image: Option<String>,
    pub duration_ms: u64,
    pub progress_ms: u64,
    pub is_playing: bool,
    pub shuffle: bool,
    /// Müziği çalan uygulamanın adı (ör. "Spotify", "Google Chrome").
    pub device: Option<String>,
    /// Uygulamanın Windows ses karıştırıcısındaki düzeyi; bulunamazsa yok.
    pub volume: Option<u8>,
}

/// Launcher'ın kendi müziği de bir medya oturumu açabilir; o hiçbir zaman "dış oynatıcı" sayılmaz.
fn own(app: &str) -> bool {
    app.to_lowercase().contains("patronlauncher")
}

/// Uygulama kimliğinden (AUMID) okunur bir ad üretir.
pub fn app_name(app: &str) -> String {
    let lower = app.to_lowercase();
    const KNOWN: &[(&str, &str)] = &[
        ("spotify", "Spotify"),
        ("youtube", "YouTube Music"),
        ("deezer", "Deezer"),
        ("tidal", "TIDAL"),
        ("applemusic", "Apple Music"),
        ("amazon", "Amazon Music"),
        ("soundcloud", "SoundCloud"),
        ("msedge", "Microsoft Edge"),
        ("chrome", "Google Chrome"),
        ("firefox", "Firefox"),
        ("opera", "Opera"),
        ("brave", "Brave"),
        ("vivaldi", "Vivaldi"),
        ("vlc", "VLC"),
        ("zunemusic", "Windows Media Player"),
        ("foobar", "foobar2000"),
        ("aimp", "AIMP"),
    ];
    if let Some((_, name)) = KNOWN.iter().find(|(key, _)| lower.contains(key)) {
        return (*name).to_string();
    }
    // "Yayıncı.Uygulama_hash!Giriş" ya da "C:\...\uygulama.exe" biçimlerinden son anlamlı parça.
    let base = app.rsplit(['\\', '/']).next().unwrap_or(app);
    let base = base.split('!').next().unwrap_or(base);
    let base = base.split('_').next().unwrap_or(base);
    let base = base.rsplit('.').find(|p| !p.eq_ignore_ascii_case("exe") && !p.is_empty()).unwrap_or(base);
    if base.is_empty() { "Medya".into() } else { base.to_string() }
}

/// Ses karıştırıcısındaki işlem adı bu oynatıcıya mı ait (ör. "spotify" ↔ "Spotify.exe").
pub fn same_app(app: &str, exe_stem: &str) -> bool {
    let norm = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
    let (app, exe) = (norm(app), norm(exe_stem));
    exe.len() >= 3 && app.contains(&exe)
}

/// Oynatıcının son bildirdiği konumu, bildirimden bu yana geçen süre kadar ilerletir.
pub fn position_ms(position: i64, updated: i64, now: i64, playing: bool, duration_ms: u64) -> u64 {
    let mut ticks = position.max(0);
    if playing && updated > 0 && now > updated {
        ticks += now - updated;
    }
    let ms = (ticks / TICKS_PER_MS) as u64;
    if duration_ms > 0 { ms.min(duration_ms) } else { ms }
}

fn now_ticks() -> i64 {
    let since = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    EPOCH_1601 + (since.as_nanos() / 100) as i64
}

/// Çalan oturum öncelikli; yoksa Windows'un seçtiği güncel oturum, o da yoksa ilk oturum.
fn session() -> Result<Option<Session>> {
    let manager = Manager::RequestAsync()?.join()?;
    let sessions = manager.GetSessions()?;
    let mut candidates = Vec::new();
    for i in 0..sessions.Size()? {
        let s = sessions.GetAt(i)?;
        if !own(&s.SourceAppUserModelId()?.to_string()) {
            candidates.push(s);
        }
    }
    let playing = |s: &Session| {
        s.GetPlaybackInfo()
            .and_then(|p| p.PlaybackStatus())
            .is_ok_and(|st| st == PlaybackStatus::Playing)
    };
    if let Some(s) = candidates.iter().find(|s| playing(s)) {
        return Ok(Some(s.clone()));
    }
    if let Ok(current) = manager.GetCurrentSession() {
        let id = current.SourceAppUserModelId()?.to_string();
        if candidates.iter().any(|s| s.SourceAppUserModelId().is_ok_and(|x| x.to_string() == id)) {
            return Ok(Some(current));
        }
    }
    Ok(candidates.into_iter().next())
}

fn cover_key(app: &str, p: &Properties) -> Option<String> {
    p.Thumbnail().ok()?;
    let mut h = DefaultHasher::new();
    (app, p.Title().ok()?.to_string(), p.Artist().ok()?.to_string(), p.AlbumTitle().ok()?.to_string()).hash(&mut h);
    Some(format!("cover-{:016x}", h.finish()))
}

pub fn now_playing() -> Result<Option<NowPlaying>> {
    let Some(s) = session()? else { return Ok(None) };
    let app = s.SourceAppUserModelId()?.to_string();
    let props = s.TryGetMediaPropertiesAsync()?.join()?;
    let title = props.Title()?.to_string();
    if title.trim().is_empty() {
        return Ok(None);
    }
    let info = s.GetPlaybackInfo()?;
    let is_playing = info.PlaybackStatus()? == PlaybackStatus::Playing;
    let shuffle = info.IsShuffleActive().and_then(|r| r.Value()).unwrap_or(false);
    let timeline = s.GetTimelineProperties()?;
    let (start, end) = (timeline.StartTime()?.Duration, timeline.EndTime()?.Duration);
    let duration_ms = (end - start).max(0) as u64 / TICKS_PER_MS as u64;
    let progress_ms = position_ms(
        timeline.Position()?.Duration - start,
        timeline.LastUpdatedTime()?.UniversalTime,
        now_ticks(),
        is_playing,
        duration_ms,
    );
    Ok(Some(NowPlaying {
        artists: props.Artist()?.to_string(),
        album: props.AlbumTitle()?.to_string(),
        image: cover_key(&app, &props),
        title,
        duration_ms,
        progress_ms,
        is_playing,
        shuffle,
        device: Some(app_name(&app)),
        volume: audio::get(&app).ok().flatten(),
    }))
}

static COVER: Mutex<Option<(String, String)>> = Mutex::new(None);

/// Kapak resmini 300 piksellik PNG olarak (base64) verir. Şarkı değiştiyse yok döner.
pub fn cover(key: &str) -> Result<Option<String>> {
    if let Some((k, png)) = COVER.lock().ok().and_then(|c| c.clone()) {
        if k == key {
            return Ok(Some(png));
        }
    }
    let Some(s) = session()? else { return Ok(None) };
    let app = s.SourceAppUserModelId()?.to_string();
    let props = s.TryGetMediaPropertiesAsync()?.join()?;
    if cover_key(&app, &props).as_deref() != Some(key) {
        return Ok(None);
    }
    let stream = props.Thumbnail()?.OpenReadAsync()?.join()?;
    let size = u32::try_from(stream.Size()?).unwrap_or(u32::MAX);
    ensure!(size > 0 && size <= MAX_COVER, "Kapak resmi okunamadı.");
    let buffer = Buffer::Create(size)?;
    let read = stream.ReadAsync(&buffer, size, InputStreamOptions::None)?.join()?;
    let mut bytes = vec![0u8; read.Length()? as usize];
    DataReader::FromBuffer(&read)?.ReadBytes(&mut bytes)?;
    let mut png = Cursor::new(Vec::new());
    image::load_from_memory(&bytes)
        .context("Kapak resmi çözülemedi.")?
        .thumbnail(300, 300)
        .write_to(&mut png, image::ImageFormat::Png)?;
    let png = STANDARD.encode(png.into_inner());
    if let Ok(mut c) = COVER.lock() {
        *c = Some((key.to_string(), png.clone()));
    }
    Ok(Some(png))
}

pub fn control(action: &str, value: Option<i64>) -> Result<()> {
    // Değer denetimi oturum aranmadan yapılır; geçersiz istek oynatıcıya hiç ulaşmaz.
    match action {
        "play" | "pause" | "next" | "previous" | "shuffle" => {}
        "seek" => ensure!(value.is_some_and(|v| (0..=86_400_000).contains(&v)), "Konum geçersiz."),
        "volume" => ensure!(value.is_some_and(|v| (0..=100).contains(&v)), "Ses düzeyi geçersiz."),
        _ => bail!("Medya işlemi geçersiz."),
    }
    let s = session()?.context("Bilgisayarda müzik çalan bir uygulama bulunamadı.")?;
    let value = value.unwrap_or(0);
    let accepted = match action {
        "play" => s.TryPlayAsync()?.join()?,
        "pause" => s.TryPauseAsync()?.join()?,
        "next" => s.TrySkipNextAsync()?.join()?,
        "previous" => s.TrySkipPreviousAsync()?.join()?,
        "seek" => {
            let start = s.GetTimelineProperties()?.StartTime()?.Duration;
            s.TryChangePlaybackPositionAsync(start + value * TICKS_PER_MS)?.join()?
        }
        "shuffle" => s.TryChangeShuffleActiveAsync(value == 1)?.join()?,
        _ => {
            audio::set(&s.SourceAppUserModelId()?.to_string(), value as f32 / 100.0)?;
            true
        }
    };
    ensure!(accepted, "Oynatıcı bu işlemi desteklemiyor ya da şu anda kabul etmedi.");
    Ok(())
}

/// Windows ses karıştırıcısı (Core Audio): uygulamaya ait ses oturumlarının düzeyi.
mod audio {
    use anyhow::{Result, ensure};
    use windows::{
        Win32::{
            Foundation::CloseHandle,
            Media::Audio::{
                IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
                MMDeviceEnumerator, eMultimedia, eRender,
            },
            System::{
                Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize},
                Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW},
            },
        },
        core::{Interface, PWSTR},
    };

    /// COM bu iş parçacığında açıldıysa iş bitince kapatılır.
    struct Com(bool);
    impl Com {
        fn init() -> Self {
            Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
        }
    }
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn exe_stem(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let read = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(handle);
            read.ok()?;
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let file = path.rsplit(['\\', '/']).next()?.to_string();
            Some(file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(&file).to_string())
        }
    }

    fn with_volumes<R>(app: &str, f: impl FnOnce(&[ISimpleAudioVolume]) -> Result<R>) -> Result<R> {
        let _com = Com::init();
        let volumes = unsafe {
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let manager: IAudioSessionManager2 =
                devices.GetDefaultAudioEndpoint(eRender, eMultimedia)?.Activate(CLSCTX_ALL, None)?;
            let list = manager.GetSessionEnumerator()?;
            let mut out = Vec::new();
            for i in 0..list.GetCount()? {
                let Ok(control) = list.GetSession(i) else { continue };
                let Ok(pid) = control.cast::<IAudioSessionControl2>().and_then(|c| c.GetProcessId()) else { continue };
                if pid == 0 || !exe_stem(pid).is_some_and(|stem| super::same_app(app, &stem)) {
                    continue;
                }
                if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                    out.push(volume);
                }
            }
            out
        };
        f(&volumes)
    }

    pub fn get(app: &str) -> Result<Option<u8>> {
        with_volumes(app, |v| {
            Ok(match v.first() {
                Some(v) => Some((unsafe { v.GetMasterVolume()? } * 100.0).round().clamp(0.0, 100.0) as u8),
                None => None,
            })
        })
    }

    pub fn set(app: &str, level: f32) -> Result<()> {
        with_volumes(app, |v| {
            ensure!(!v.is_empty(), "Bu oynatıcının ses düzeyi buradan değiştirilemiyor.");
            for volume in v {
                unsafe { volume.SetMasterVolume(level.clamp(0.0, 1.0), std::ptr::null())? };
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn app_names_are_readable() {
        assert_eq!(app_name("Spotify.exe"), "Spotify");
        assert_eq!(app_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Spotify");
        assert_eq!(app_name("Chrome"), "Google Chrome");
        assert_eq!(app_name("MSEdge"), "Microsoft Edge");
        assert_eq!(app_name("com.github.th-ch.youtube-music"), "YouTube Music");
        assert_eq!(app_name(r"C:\Apps\Winamp\winamp.exe"), "winamp");
        assert_eq!(app_name("Contoso.Player_8wekyb3d8bbwe!App"), "Player");
    }
    #[test]
    fn own_sessions_are_ignored() {
        assert!(own("com.patronlauncher.launcher"));
        assert!(own(r"C:\Users\x\AppData\Local\PatronLauncher\PatronLauncher.exe"));
        assert!(!own("Spotify.exe"));
    }
    #[test]
    fn mixer_entries_match_player() {
        assert!(same_app("Spotify.exe", "Spotify"));
        assert!(same_app("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Spotify"));
        assert!(same_app("Chrome", "chrome"));
        assert!(same_app("com.github.th-ch.youtube-music", "YouTube Music"));
        assert!(!same_app("Spotify.exe", "chrome"));
        assert!(!same_app("Chrome", "ch"));
    }
    #[test]
    fn position_advances_only_while_playing() {
        let s = TICKS_PER_MS * 1000;
        assert_eq!(position_ms(10 * s, 100 * s, 103 * s, true, 0), 13_000);
        assert_eq!(position_ms(10 * s, 100 * s, 103 * s, false, 0), 10_000);
        assert_eq!(position_ms(10 * s, 100 * s, 200 * s, true, 12_000), 12_000);
        assert_eq!(position_ms(-5, 0, 0, true, 0), 0);
    }
    #[test]
    fn invalid_actions_are_rejected_before_touching_player() {
        assert!(control("explode", None).is_err());
        assert!(control("volume", Some(101)).is_err());
        assert!(control("seek", Some(-1)).is_err());
        assert!(control("seek", None).is_err());
    }
}
