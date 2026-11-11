use crate::{
    auth,
    game::{self, Version},
    model::{self, Account, Profile, State},
    profiles::{self, GameFolder},
    runtime::{self, JavaStatus},
};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
    },
};
use uuid::Uuid;

/// start_game'in neyi başlatacağı.
#[derive(Debug, Clone, Copy)]
enum Launch {
    /// Seçili launcher profili.
    Game,
    /// Gizli PClient profili; install_only ise yalnızca dosyalar indirilir.
    PClient { install_only: bool },
}

#[derive(Debug, Clone)]
pub enum Message {
    Tick,
    PlayerName(String),
    ProfileName(String),
    ClientId(String),
    DiscordClientId(String),
    JavaPath(String),
    Memory(String),
    AddLocal,
    AddMicrosoft,
    RemoveAccount,
    AccountSelected(Account),
    ProfileSelected(Profile),
    VersionSelected(Version),
    CreateProfile,
    RemoveProfile,
    SaveSettings,
    Refresh,
    Play,
    /// PClient'ı başlatır; true ise yalnızca kurar (oyun açılmaz).
    PlayPClient(bool),
    Cancel,
    OpenFolder,
    CheckJava,
    InstallJava,
    JavaSite,
    OracleSite,
    BackupProfile,
    RestoreProfile,
    ConfirmRestore,
    CancelRestore,
    RecoverProfiles,
    OpenBackups,
    OpenGameFolder(GameFolder),
    OpenLauncherFolder,
    OpenSharedFolder,
    DraftVersionSelected(Version),
    RefreshNews,
    OpenNews(usize),
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", content = "result", rename_all = "snake_case")]
pub enum Event {
    #[serde(skip)]
    SuggestStart(String),
    #[serde(skip)]
    QuickInstalled(Result<Profile, String>),
    #[serde(skip)]
    ProfileInstalled(Result<Profile, String>),
    Status(String),
    Versions(Result<Vec<Version>, String>),
    /// Açılışta önbellekten gelen listeden sonra ağdan gelen yeni liste. Meşgul/durum bilgisine dokunmaz.
    VersionsRefreshed(Vec<Version>),
    Account(Result<Account, String>),
    Finished(Result<(), String>),
    JavaChecked(Result<JavaStatus, String>),
    JavaInstalled(Result<JavaStatus, String>),
    News(Result<Vec<crate::news::Article>, String>),
}
pub struct App {
    pub(super) root: PathBuf,
    pub(super) notifications: Vec<Event>,
    revision: u64,
    news: Vec<crate::news::Article>,
    news_loading: bool,
    news_error: bool,
    state: State,
    versions: Vec<Version>,
    player_name: String,
    profile_name: String,
    selected_version: Option<Version>,
    draft_version: Option<Version>,
    client_id: String,
    discord_client_id: String,
    discord_presence: Option<crate::discord::Presence>,
    java_path: String,
    memory: String,
    status: String,
    log: Vec<String>,
    busy: bool,
    running: bool,
    /// Oyun penceresi menüye ulaştı (PClient çıktısındaki işaretle).
    game_ready: bool,
    load_failed: bool,
    java_status: Option<JavaStatus>,
    restore_confirm: bool,
    install_completion: Option<tokio::sync::oneshot::Sender<Result<(), String>>>,
    join: Option<game::ServerTarget>,
    /// Çalışan oyun PClient ile mi açıldı.
    launch_pclient: bool,
    /// Oyun doğrudan bir sunucuya bağlanmak üzere açıldıysa o adres.
    launch_target: Option<String>,
    /// Başlatma hedefinin ilk bağlantı satırı henüz görülmedi.
    launch_target_pending: bool,
    _instance_lock: Option<Arc<std::fs::File>>,
    cancel: Arc<AtomicBool>,
    tx: Sender<Event>,
    rx: Receiver<Event>,
}
/// Adres doğrulanmış sunucu listesindeyse Discord'da gösterilecek bilgisini döner.
fn listed_server(root: &std::path::Path, address: &str) -> Option<crate::discord::ServerPresence> {
    let (host, port) = match address.rsplit_once(':') {
        Some((host, port)) => (host, port.parse::<u16>().ok()),
        None => (address, None),
    };
    const DEFAULT_PORT: u16 = 25565;
    crate::servers::load(root)
        .servers
        .into_iter()
        .find(|sv| sv.address.eq_ignore_ascii_case(host) && port.is_none_or(|p| sv.port.unwrap_or(DEFAULT_PORT) == p))
        .map(|sv| crate::discord::ServerPresence {
            address: sv.port.map_or_else(|| sv.address.clone(), |p| format!("{}:{p}", sv.address)),
            name: sv.name,
            website: sv.website,
        })
}
impl App {
    pub fn open(root: PathBuf) -> Self {
        let lock =
            crate::migration::ensure_for_root(&root).and_then(|_| super::lock::acquire(&root));
        let lock_error = lock.as_ref().err().map(|e| format!("{e:#}"));
        let loaded = State::load_with_notice(&root);
        let recovered = loaded.as_ref().is_ok_and(|(_, recovered)| *recovered);
        let load_failed = loaded.is_err() || lock_error.is_some();
        let status = lock_error
            .or_else(|| loaded.as_ref().err().map(|e| format!("{e:#}")))
            .unwrap_or_else(|| "Sürüm listesi alınıyor…".into());
        let state = loaded.map(|(state, _)| state).unwrap_or_default();
        let (tx, rx) = mpsc::channel();
        let mut app = Self {
            root,
            notifications: Vec::new(),
            revision: 0,
            news: Vec::new(),
            news_loading: false,
            news_error: false,
            client_id: state.microsoft_client_id.clone(),
            discord_client_id: state.discord_client_id.clone(),
            discord_presence: (!load_failed)
                .then(|| crate::discord::Presence::start(state.discord_client_id.clone())),
            java_path: state.java_path.clone(),
            memory: state.memory_mb.to_string(),
            state,
            versions: vec![],
            player_name: String::new(),
            profile_name: String::new(),
            selected_version: None,
            draft_version: None,
            status,
            log: vec![],
            busy: false,
            running: false,
            game_ready: false,
            load_failed,
            java_status: None,
            restore_confirm: false,
            install_completion: None,
            join: None,
            launch_pclient: false,
            launch_target: None,
            launch_target_pending: false,
            _instance_lock: lock.ok().map(Arc::new),
            cancel: Arc::new(AtomicBool::new(false)),
            tx,
            rx,
        };
        if recovered {
            app.status("Profil ve hesap kayıtları kurtarma kopyasından okundu. Bozuk asıl dosya korunuyor.".into());
        }
        app
    }
    fn refresh_news(&mut self) {
        if self.news_loading {
            return;
        }
        self.news_loading = true;
        self.news_error = false;
        let tx = self.tx.clone();
        let lease = self._instance_lock.clone();
        std::thread::spawn(move || {
            let _lease = lease;
            let _ = tx.send(Event::News(
                crate::news::fetch().map_err(|e| format!("{e:#}")),
            ));
        });
    }
    fn status(&mut self, message: String) {
        self.notifications.push(Event::Status(message.clone()));
        self.status = message.clone();
        self.log.push(message);
        if self.log.len() > 60 {
            self.log.remove(0);
        }
    }
    fn commit(&mut self, next: State) -> bool {
        if self.load_failed {
            self.status("Ayar dosyası bozuk olduğu için değişiklik kaydedilmedi. Mevcut dosyayı kontrol edin.".into());
            return false;
        }
        match next.save(&self.root) {
            Ok(()) => {
                self.state = next;
                self.revision += 1;
                true
            }
            Err(e) => {
                self.status(format!("Kaydedilemedi: {e:#}"));
                false
            }
        }
    }
    fn refresh(&mut self) {
        let tx = self.tx.clone();
        let root = self.root.clone();
        let profiles = self.state.profiles.clone();
        self.busy = true;
        let lease = self._instance_lock.clone();
        std::thread::spawn(move || {
            let _lease = lease;
            let layout = profiles
                .iter()
                .try_for_each(|profile| profiles::ensure_layout(&root, profile).map(|_| ()))
                .map_err(|e| format!("{e:#}"));
            // Hızlı açılış: önbellekteki liste hemen kullanılır; launcher ağı beklemez.
            let cached = match &layout {
                Ok(()) => game::cached_versions(&root).and_then(|r| r.ok()),
                Err(_) => None,
            };
            if let Some(list) = &cached {
                let _ = tx.send(Event::Versions(Ok(list.clone())));
            }
            let result: Result<Vec<Version>, String> =
                layout.and_then(|()| game::versions(&root).map_err(|e| format!("{e:#}")));
            // Ağdan gelen liste aynıysa ya da çevrimdışıysak önbellekteki liste geçerli kalır.
            let unchanged = cached.is_some() && result.as_ref().map_or(true, |v| Some(v) == cached.as_ref());
            let final_list = result.as_ref().ok().cloned().or_else(|| cached.clone());
            let suggestion = final_list.as_ref().and_then(|v| v.first().cloned());
            let installed_versions = final_list;
            if !unchanged {
                match (cached.is_some(), result) {
                    (true, Ok(list)) => {
                        let _ = tx.send(Event::VersionsRefreshed(list));
                    }
                    (_, result) => {
                        let _ = tx.send(Event::Versions(result));
                    }
                }
            }
            if let (Some(latest), Some(versions)) = (suggestion, installed_versions) {
                if crate::store::list(&root, &profiles, &versions).is_empty() {
                    let _ = tx.send(Event::SuggestStart(format!(
                        "Hazır başlangıç: en son kararlı Minecraft {} sürümünü kurabilirsiniz.",
                        latest.id
                    )));
                }
            }
        });
    }
    pub fn update(&mut self, message: Message) {
        match message {
            Message::PlayerName(s) => {
                self.player_name = s;
                return;
            }
            Message::ProfileName(s) => {
                self.profile_name = s;
                return;
            }
            Message::ClientId(s) => {
                self.client_id = s;
                return;
            }
            Message::DiscordClientId(s) => {
                self.discord_client_id = s;
                return;
            }
            Message::JavaPath(s) => {
                self.java_path = s;
                self.java_status = None;
                return;
            }
            Message::Memory(s) => {
                self.memory = s;
                return;
            }

            _ => {}
        }

        if matches!(message, Message::Tick) {
            while let Ok(event) = self.rx.try_recv() {
                if !matches!(
                    &event,
                    Event::Status(_)
                        | Event::ProfileInstalled(_)
                        | Event::QuickInstalled(_)
                        | Event::SuggestStart(_)
                ) {
                    self.notifications.push(event.clone());
                }
                match event {
                    Event::SuggestStart(text) => {
                        if !self.busy && !self.running {
                            self.status(text);
                        }
                    }
                    Event::QuickInstalled(result) => {
                        self.busy = false;
                        let result = result.and_then(|profile| {
                            if self.cancel.load(Ordering::Relaxed) {
                                return Err("İşlem iptal edildi.".into());
                            }
                            let mut next = self.state.clone();
                            if !next.profiles.iter().any(|p| p.id == profile.id) {
                                next.profiles.push(profile);
                            }
                            if !self.commit(next) {
                                return Err(self.status.clone());
                            }
                            Ok(())
                        });
                        self.status(match &result {
                            Ok(()) => "Sürüm ortak depoya kuruldu.".into(),
                            Err(e) => e.clone(),
                        });
                        self.notifications.push(Event::Finished(result));
                    }
                    Event::ProfileInstalled(result) => {
                        self.busy = false;
                        let finished = match result {
                            Ok(profile) => {
                                let id = profile.id;
                                if self.cancel.load(Ordering::Relaxed) {
                                    crate::performance::cleanup_profile(&self.root, id);
                                    Err("İşlem iptal edildi.".into())
                                } else {
                                    let version = self
                                        .versions
                                        .iter()
                                        .find(|v| v.id == profile.version)
                                        .cloned();
                                    let mut next = self.state.clone();
                                    next.selected_profile = Some(id);
                                    next.profiles.push(profile);
                                    if self.commit(next) {
                                        self.selected_version = version;
                                        self.java_status = None;
                                        Ok(())
                                    } else {
                                        crate::performance::cleanup_profile(&self.root, id);
                                        Err(self.status.clone())
                                    }
                                }
                            }
                            Err(error) => Err(error),
                        };
                        self.status(match &finished {
                            Ok(()) => {
                                "Oyun profili oluşturuldu. Seçilen yükleyici ve modlar hazır."
                                    .into()
                            }
                            Err(e) => e.clone(),
                        });
                        self.notifications.push(Event::Finished(finished.clone()));
                        if let Some(completion) = self.install_completion.take() {
                            let _ = completion.send(finished);
                        }
                    }
                    Event::News(result) => {
                        self.news_loading = false;
                        match result {
                            Ok(news) => {
                                self.news = news;
                                self.news_error = false;
                            }
                            Err(_) => self.news_error = true,
                        }
                    }
                    Event::Status(s) => {
                        if self.game_server_event(&s) {
                            continue;
                        }
                        if s.starts_with("Minecraft çalışıyor") {
                            self.running = true;
                            crate::discord::game_started(self.launch_pclient);
                            if let Some(address) = self.launch_target.clone() {
                                self.publish_server(address);
                            }
                        }
                        if s.starts_with(game::READY_STATUS) {
                            self.game_ready = true;
                        }
                        self.status(s);
                    }
                    Event::VersionsRefreshed(list) => {
                        // Seçili sürüm yeni listede de varsa güncel tanımıyla korunur.
                        if let Some(selected) = &self.selected_version {
                            if let Some(fresh) = list.iter().find(|v| v.id == selected.id) {
                                self.selected_version = Some(fresh.clone());
                            }
                        }
                        self.versions = list;
                    }
                    Event::Versions(result) => {
                        self.busy = false;
                        match result {
                            Ok(versions) => {
                                let wanted =
                                    self.state.profile().map(|p| p.version).or_else(|| {
                                        self.selected_version.as_ref().map(|v| v.id.clone())
                                    });
                                self.selected_version = wanted
                                    .as_ref()
                                    .and_then(|id| versions.iter().find(|v| &v.id == id).cloned())
                                    .or_else(|| {
                                        if wanted.is_none() {
                                            versions.first().cloned()
                                        } else {
                                            None
                                        }
                                    });
                                self.versions = versions;
                                if wanted.is_some() && self.selected_version.is_none() {
                                    self.status("Seçili sürüm listede bulunamadı. Profiliniz korunuyor; başka bir sürüm seçebilir veya yeniden yenileyebilirsiniz.".into());
                                } else {
                                    self.status("Sürüm listesi ve profil klasörleri hazır. Seçimleriniz korundu.".into());
                                }
                            }
                            Err(e) => self.status(e),
                        }
                    }
                    Event::Account(result) => {
                        // Oyun açıkken eklenen hesap, oyunun meşgul durumunu bozmaz.
                        if !self.running {
                            self.busy = false;
                        }
                        match result {
                            Ok(account) => {
                                let mut next = self.state.clone();
                                if let Some(existing) = next
                                    .accounts
                                    .iter()
                                    .find(|a| a.kind == account.kind && a.uuid == account.uuid)
                                {
                                    let old = existing.clone();
                                    match auth::forget(&old) {
                                        Ok(()) => {
                                            next.accounts.retain(|a| a.id != old.id);
                                        }
                                        Err(e) => {
                                            let _ = auth::forget(&account);
                                            self.status(format!(
                                                "Eski oturum kaldırılamadı: {e:#}"
                                            ));
                                            continue;
                                        }
                                    }
                                }
                                next.selected_account = Some(account.id);
                                next.accounts.push(account.clone());
                                if self.commit(next) {
                                    self.status("Microsoft hesabı eklendi.".into());
                                } else {
                                    let _ = auth::forget(&account);
                                }
                            }
                            Err(e) => self.status(e),
                        }
                    }
                    Event::Finished(result) => {
                        self.busy = false;
                        self.running = false;
                        self.game_ready = false;
                        crate::discord::game_stopped();
                        match result {
                            Ok(()) => {}
                            Err(e) => self.status(e),
                        }
                    }
                    Event::JavaChecked(result) => {
                        self.busy = false;
                        self.handle_java(result, false);
                    }
                    Event::JavaInstalled(result) => {
                        self.busy = false;
                        self.handle_java(result, true);
                    }
                }
            }
            return;
        }
        if matches!(message, Message::RefreshNews) {
            self.refresh_news();
            return;
        }
        if let Message::OpenNews(index) = message {
            if let Some(article) = self.news.get(index)
                && let Err(error) = super::security::open_external(&article.url)
            {
                self.status(format!("Haber açılamadı: {error}"));
            }
            return;
        }
        if !self.load_failed {
            let target = match message {
                Message::OpenFolder => Some(Some(GameFolder::Root)),
                Message::OpenGameFolder(folder) => Some(Some(folder)),
                Message::OpenLauncherFolder | Message::OpenSharedFolder => Some(None),
                _ => None,
            };
            if let Some(folder) = target {
                let path = if let Some(folder) = folder {
                    self.state
                        .profile()
                        .ok_or_else(|| anyhow::anyhow!("Önce bir oyun profili seçin."))
                        .and_then(|p| profiles::folder(&self.root, &p, folder))
                } else {
                    Ok(if matches!(message, Message::OpenSharedFolder) {
                        self.root.join("minecraft")
                    } else {
                        self.root.clone()
                    })
                };
                match path.and_then(|path| {
                    std::fs::create_dir_all(&path)?;
                    std::process::Command::new("explorer.exe")
                        .arg(&path)
                        .spawn()?;
                    Ok(path)
                }) {
                    Ok(path) => self.status(format!("Klasör açıldı: {}", path.display())),
                    Err(error) => self.status(format!("Klasör açılamadı: {error:#}")),
                }
                return;
            }
        }
        if matches!(message, Message::Cancel) {
            self.cancel.store(true, Ordering::Relaxed);
            self.status("İptal isteniyor; devam eden indirme tamamlanınca duracak.".into());
            return;
        }
        if matches!(message, Message::RecoverProfiles)
            && !self.busy
            && self._instance_lock.is_some()
        {
            self.recover_profiles();
            return;
        }
        // Oyun açıkken "meşgul" kalır; oyun içi hesap menüsünün iki işlemi buna takılmaz.
        let game_account =
            self.running && matches!(message, Message::AddLocal | Message::AccountSelected(_));
        if (self.busy && !game_account) || self.load_failed {
            return;
        }
        match message {
            Message::DraftVersionSelected(version) => self.draft_version = Some(version),
            Message::AddLocal => match model::local_account(&self.player_name) {
                Ok(account) => {
                    if self.state.accounts.iter().any(|a| {
                        a.kind == account.kind && a.name.eq_ignore_ascii_case(&account.name)
                    }) {
                        self.status("Bu yerel hesap zaten var.".into());
                        return;
                    }
                    let mut next = self.state.clone();
                    next.selected_account = Some(account.id);
                    next.accounts.push(account);
                    if self.commit(next) {
                        self.player_name.clear();
                        self.status("Yerel hesap eklendi.".into());
                    }
                }
                Err(e) => self.status(e.to_string()),
            },
            Message::AddMicrosoft => {
                if !self.save_settings() {
                    return;
                }
                if auth::client_id(&self.client_id).is_none() {
                    self.status("Microsoft girişi bu derlemede henüz etkin değil: PatronLauncher uygulama kimliği eksik.".into());
                    return;
                }
                self.busy = true;
                self.cancel = Arc::new(AtomicBool::new(false));
                let cancel = self.cancel.clone();
                let tx = self.tx.clone();
                let id = self.client_id.clone();
                self.status("Microsoft giriş sayfası açılıyor…".into());
                let lease = self._instance_lock.clone();
                std::thread::spawn(move || {
                    let _lease = lease;
                    let result = auth::login(&id, cancel, |s| {
                        let _ = tx.send(Event::Status(s));
                    })
                    .map_err(|e| format!("{e:#}"));
                    let _ = tx.send(Event::Account(result));
                });
            }
            Message::RemoveAccount => {
                if let Some(account) = self.state.account() {
                    if let Err(e) = auth::forget(&account) {
                        self.status(format!("Oturum kaldırılamadı: {e:#}"));
                        return;
                    }
                    let mut next = self.state.clone();
                    next.accounts.retain(|a| a.id != account.id);
                    next.selected_account = next.accounts.first().map(|a| a.id);
                    self.commit(next);
                }
            }
            Message::AccountSelected(account) => {
                let mut next = self.state.clone();
                next.selected_account = Some(account.id);
                self.commit(next);
            }
            Message::ProfileSelected(profile) => {
                self.java_status = None;
                self.restore_confirm = false;
                self.selected_version = self
                    .versions
                    .iter()
                    .find(|v| v.id == profile.version)
                    .cloned();
                let mut next = self.state.clone();
                next.selected_profile = Some(profile.id);
                self.commit(next);
            }
            Message::VersionSelected(version) => {
                self.java_status = None;
                if let Some(profile) = self.state.profile()
                    && profile.version != version.id
                    && let Err(error) = profiles::snapshot(&self.root, &profile)
                {
                    self.status(format!(
                        "Sürüm değiştirilmedi; önce ayar yedeği sorunu çözülmeli: {error:#}"
                    ));
                    return;
                }
                let mut next = self.state.clone();
                if let Some(profile) = next
                    .profiles
                    .iter_mut()
                    .find(|p| Some(p.id) == next.selected_profile)
                {
                    profile.version = version.id.clone();
                }
                if self.commit(next) {
                    self.selected_version = Some(version);
                }
            }
            Message::CreateProfile => {
                self.restore_confirm = false;
                let name = self.profile_name.trim();
                if name.is_empty() || name.chars().count() > 40 {
                    self.status("Profil adı 1–40 karakter olmalı.".into());
                    return;
                }
                let Some(version) = self
                    .draft_version
                    .as_ref()
                    .or(self.selected_version.as_ref())
                    .cloned()
                else {
                    self.status("Önce bir sürüm seçin.".into());
                    return;
                };
                let profile = Profile {
                    appearance: Default::default(),
                    kind: crate::model::ProfileKind::Custom,
                    id: Uuid::new_v4(),
                    name: name.into(),
                    version: version.id.clone(),
                    loader: Default::default(),
                    loader_version: None,
                };
                let mut next = self.state.clone();
                next.selected_profile = Some(profile.id);
                next.profiles.push(profile);
                if self.commit(next) {
                    self.selected_version = Some(version);
                    self.draft_version = None;
                    self.profile_name.clear();
                    self.status(
                        "Oyun profili oluşturuldu. Dünyalar bu profile özel klasörde tutulacak."
                            .into(),
                    );
                }
            }
            Message::RemoveProfile => {
                self.restore_confirm = false;
                if let Some(profile) = self.state.profile() {
                    let mut next = self.state.clone();
                    next.profiles.retain(|p| p.id != profile.id);
                    next.selected_profile = next.profiles.first().map(|p| p.id);
                    if self.commit(next) {
                        self.selected_version = self
                            .state
                            .profile()
                            .and_then(|p| self.versions.iter().find(|v| v.id == p.version).cloned())
                            .or_else(|| self.versions.first().cloned());
                        self.status(
                            "Profil listeden kaldırıldı. Dünyalar ve oyun dosyaları silinmedi."
                                .into(),
                        );
                    }
                }
            }
            Message::SaveSettings => {
                if self.save_settings() {
                    self.status("Ayarlar kaydedildi.".into());
                }
            }
            Message::Refresh => {
                self.status("Sürüm listesi yenileniyor…".into());
                self.refresh();
            }
            Message::CheckJava => self.begin_java(false),
            Message::InstallJava => self.begin_java(true),
            Message::JavaSite | Message::OracleSite => {
                let url = if matches!(message, Message::JavaSite) {
                    runtime::official_url()
                } else {
                    runtime::ORACLE_URL
                };
                if let Err(error) = super::security::open_external(url) {
                    self.status(format!("Resmî indirme sayfası açılamadı: {error}"));
                }
            }
            Message::BackupProfile | Message::ConfirmRestore => {
                let Some(profile) = self.state.profile() else {
                    self.status("Bir oyun profili seçin.".into());
                    return;
                };
                let restore = matches!(message, Message::ConfirmRestore);
                if restore && !self.restore_confirm {
                    return;
                }
                self.restore_confirm = false;
                self.busy = true;
                let root = self.root.clone();
                let tx = self.tx.clone();
                let lease = self._instance_lock.clone();
                std::thread::spawn(move || {
                    let _lease = lease;
                    let result = (|| -> anyhow::Result<()> {
                        let message = if restore {
                            profiles::restore_latest(&root, &profile)?;
                            "Profilin son ayar yedeği geri yüklendi. Geri yükleme öncesindeki ayarlar da yedeklendi."
                        } else if profiles::snapshot(&root, &profile)?.is_some() {
                            "Profil ayarları yedeklendi. Son 10 farklı ayar yedeği saklanır."
                        } else { "Bu profil henüz oyun ayarı oluşturmamış. Kayıtları korunuyor." };
                        let _ = tx.send(Event::Status(message.into()));
                        Ok(())
                    })().map_err(|e| format!("{e:#}"));
                    let _ = tx.send(Event::Finished(result));
                });
            }
            Message::RestoreProfile => self.restore_confirm = true,
            Message::CancelRestore => self.restore_confirm = false,
            Message::OpenBackups => {
                if let Some(profile) = self.state.profile() {
                    let path = self.root.join("backups").join(profile.id.to_string());
                    if let Err(error) = std::fs::create_dir_all(&path).and_then(|_| {
                        std::process::Command::new("explorer.exe")
                            .arg(path)
                            .spawn()
                            .map(|_| ())
                    }) {
                        self.status(format!("Yedek klasörü açılamadı: {error}"));
                    }
                }
            }
            Message::Play => {
                // Sunucu hedefi yalnızca bu başlatmaya aittir; erken çıkışta da temizlenir.
                let server = self.join.take();
                if !self.save_settings() {
                    return;
                }
                let Some(version) = self.selected_version.clone() else {
                    self.status("Bir sürüm seçin.".into());
                    return;
                };
                if self.state.account().is_none() || self.state.profile().is_none() {
                    self.status("Önce bir hesap ve oyun profili oluşturup seçin.".into());
                    return;
                }
                self.start_game(self.state.clone(), version, server, Launch::Game);
            }
            Message::PlayPClient(install_only) => {
                let server = if install_only { None } else { self.join.take() };
                if !self.save_settings() {
                    return;
                }
                if !install_only && self.state.account().is_none() {
                    self.status("Önce bir hesap ekleyip seçin.".into());
                    return;
                }
                let minecraft = crate::pclient::selected(&self.root).minecraft;
                let Some(version) = self.versions.iter().find(|v| v.id == minecraft).cloned() else {
                    self.status(format!("Minecraft {minecraft} sürüm listesinde bulunamadı; listeyi yenileyip tekrar deneyin."));
                    return;
                };
                // Eski sürümün profil listesine eklediği görünür PClient profili kaldırılır;
                // klasörü (dünyalar dahil) başlatma sırasında PClient klasörüne taşınır.
                if let Some(old) = crate::pclient::legacy_profile(&self.root) {
                    let mut next = self.state.clone();
                    next.profiles.retain(|p| p.id != old);
                    if next.selected_profile == Some(old) {
                        next.selected_profile = next.profiles.first().map(|p| p.id);
                    }
                    if next.profiles.len() != self.state.profiles.len() && !self.commit(next) {
                        return;
                    }
                }
                self.start_game(self.state.clone(), version, server, Launch::PClient { install_only });
            }
            Message::PlayerName(_)
            | Message::ProfileName(_)
            | Message::ClientId(_)
            | Message::DiscordClientId(_)
            | Message::JavaPath(_)
            | Message::Memory(_)
            | Message::Tick
            | Message::Cancel
            | Message::RecoverProfiles
            | Message::OpenFolder
            | Message::OpenGameFolder(_)
            | Message::OpenLauncherFolder
            | Message::OpenSharedFolder => {}
            Message::RefreshNews | Message::OpenNews(_) => {}
        }
    }
    /// Sunucu listesi okunurken çekirdek bekletilmez; sonuç Discord etkinliğine yazılır.
    fn publish_server(&self, address: String) {
        let root = self.root.clone();
        std::thread::spawn(move || crate::discord::game_server(listed_server(&root, &address)));
    }
    /// Oyun çıktısından gelen sunucu olayını işler; true ise durum iletisi kullanıcıya gösterilmez.
    fn game_server_event(&mut self, status: &str) -> bool {
        if status == game::SERVER_LEFT_STATUS {
            crate::discord::game_server(None);
            return true;
        }
        if let Some(address) = status.strip_prefix(game::SERVER_JOIN_STATUS) {
            self.publish_server(address.to_string());
            return true;
        }
        let Some(address) = status.strip_prefix(game::SERVER_CONNECT_STATUS) else {
            return false;
        };
        // PClient kesin adresi kendi işaretiyle bildirir. Diğer oyunlarda günlükteki adres SRV
        // sonrası adres olabilir; başlatma hedefinin ilk bağlantısında hedef korunur.
        let first = std::mem::take(&mut self.launch_target_pending);
        if !self.launch_pclient && !first {
            self.publish_server(address.to_string());
        }
        true
    }
    /// Oyunu arka planda başlatır. PClient: gizli PClient profiliyle (seçili profil değişmez).
    fn start_game(&mut self, mut state: State, version: Version, server: Option<game::ServerTarget>, launch: Launch) {
        let pclient = matches!(launch, Launch::PClient { .. });
        self.launch_pclient = pclient;
        self.launch_target = server.as_ref().map(|target| match target.port {
            Some(port) => format!("{}:{port}", target.host),
            None => target.host.clone(),
        });
        self.launch_target_pending = self.launch_target.is_some();
        let install_only = matches!(launch, Launch::PClient { install_only: true });
        self.busy = true;
        self.game_ready = false;
        self.cancel = Arc::new(AtomicBool::new(false));
        let cancel = self.cancel.clone();
        let tx = self.tx.clone();
        let root = self.root.clone();
        self.status("Oyun hazırlanıyor… İlk indirme biraz zaman alabilir.".into());
        let lease = self._instance_lock.clone();
        std::thread::spawn(move || {
            let _lease = lease;
            let progress = tx.clone();
            if pclient {
                match crate::pclient::prepare(&root) {
                    Ok(profile) => {
                        state.selected_profile = Some(profile.id);
                        state.profiles = vec![profile];
                    }
                    Err(error) => {
                        let _ = tx.send(Event::Finished(Err(format!("PClient hazırlanamadı: {error:#}"))));
                        return;
                    }
                }
            }
            match game::java_status(&root, &state.java_path, &version) {
                Ok(status @ JavaStatus::Missing { .. }) => {
                    let _ = tx.send(Event::JavaChecked(Ok(status)));
                    return;
                }
                Err(error) => {
                    let _ = tx.send(Event::Finished(Err(format!("{error:#}"))));
                    return;
                }
                _ => {}
            }
            let notify: game::Notify = Arc::new(move |s| {
                let _ = progress.send(Event::Status(s));
            });
            let result = if install_only {
                game::install(&root, &state, &version, cancel, notify.clone())
                    .map(|()| notify(format!("PClient {} kuruldu. Oyuna Gir ile hemen başlayabilirsin.", version.id)))
            } else {
                game::launch_to(&root, &state, &version, cancel, notify, server.as_ref())
            }
            .map_err(|e| format!("{e:#}"));
            let _ = tx.send(Event::Finished(result));
        });
    }
    fn handle_java(&mut self, result: Result<JavaStatus, String>, installed: bool) {
        match result {
            Ok(status) => {
                match &status {
                    JavaStatus::Ready { major, path } => {
                        if installed {
                            let mut next = self.state.clone();
                            next.java_path.clear();
                            if !self.commit(next) {
                                return;
                            }
                            self.java_path.clear();
                        }
                        self.status(format!(
                            "Java {major} hazır: {}. Oyuna Gir ile devam edebilirsiniz.",
                            path.display()
                        ));
                    }
                    JavaStatus::Missing { reason, .. } => self.status(format!(
                        "{reason} Aşağıdaki Java yönetimi bölümünden seçim yapabilirsiniz."
                    )),
                }
                self.java_status = Some(status);
            }
            Err(error) => self.status(error),
        }
    }
    fn begin_java(&mut self, install: bool) {
        if !self.save_settings() {
            return;
        }
        let Some(version) = self.selected_version.clone() else {
            self.status("Önce bir Minecraft sürümü seçin.".into());
            return;
        };
        self.busy = true;
        self.cancel = Arc::new(AtomicBool::new(false));
        let root = self.root.clone();
        let custom = self.java_path.clone();
        let tx = self.tx.clone();
        let cancel = self.cancel.clone();
        self.status(
            if install {
                "Seçilen sürüm için Java kurulumu hazırlanıyor…"
            } else {
                "Java uyumluluğu kontrol ediliyor…"
            }
            .into(),
        );
        let lease = self._instance_lock.clone();
        std::thread::spawn(move || {
            let _lease = lease;
            let result = (|| -> anyhow::Result<JavaStatus> {
                let status = game::java_status(&root, &custom, &version)?;
                if !install {
                    return Ok(status);
                }
                let major = status.major();
                let path = runtime::install(&root, major, &cancel, |s| {
                    let _ = tx.send(Event::Status(s));
                })?;
                Ok(JavaStatus::Ready { major, path })
            })()
            .map_err(|e| format!("{e:#}"));
            let _ = tx.send(if install {
                Event::JavaInstalled(result)
            } else {
                Event::JavaChecked(result)
            });
        });
    }
    fn recover_profiles(&mut self) {
        match profiles::recover(&self.root) {
            Ok(profiles) => {
                let mut next = self.state.clone();
                let mut count = 0;
                for profile in profiles {
                    if !next.profiles.iter().any(|p| p.id == profile.id) {
                        next.profiles.push(profile);
                        count += 1;
                    }
                }
                if count == 0 {
                    self.status("Diskte listede olmayan bir profil bulunamadı.".into());
                    return;
                }
                if next.selected_profile.is_none() {
                    next.selected_profile = next.profiles.first().map(|p| p.id);
                }
                match next.save(&self.root) {
                    Ok(()) => {
                        self.state = next;
                        self.load_failed = false;
                        self.selected_version = self.state.profile().and_then(|p| {
                            self.versions.iter().find(|v| v.id == p.version).cloned()
                        });
                        self.status(format!("{count} profil disk kayıtlarından geri getirildi. Oyun ayarları ve dünyalar korundu."));
                        if self.versions.is_empty() {
                            self.refresh();
                        }
                    }
                    Err(error) => self.status(format!("Profiller kaydedilemedi: {error:#}")),
                }
            }
            Err(error) => self.status(format!("Profil kurtarma başarısız: {error:#}")),
        }
    }
    fn save_settings(&mut self) -> bool {
        let Ok(memory) = self.memory.parse::<u32>() else {
            self.status("Bellek miktarını MB cinsinden sayı olarak girin.".into());
            return false;
        };
        if !(1024..=32768).contains(&memory) {
            self.status("Bellek 1024–32768 MB arasında olmalı.".into());
            return false;
        }
        let mut next = self.state.clone();
        let discord_id = self.discord_client_id.trim();
        if !discord_id.is_empty() && !crate::discord::valid_id(discord_id) {
            self.status("Discord uygulama kimliği 17–20 rakamdan oluşmalıdır.".into());
            return false;
        }
        next.memory_mb = memory;
        next.java_path = self.java_path.trim().into();
        next.microsoft_client_id = self.client_id.trim().into();
        next.discord_client_id = discord_id.into();
        let changed = next.discord_client_id != self.state.discord_client_id;
        if self.commit(next) {
            if changed && let Some(presence) = &self.discord_presence {
                presence.configure(self.state.discord_client_id.clone());
            }
            true
        } else {
            false
        }
    }
}

impl App {
    pub(super) fn snapshot(&self) -> super::types::Snapshot {
        use super::types::{Settings, Snapshot};
        Snapshot {
            quick_profile: self
                .state
                .profile()
                .filter(|p| p.kind == model::ProfileKind::Quick),
            accounts: self.state.accounts.clone(),
            profiles: self
                .state
                .profiles
                .iter()
                .filter(|p| p.kind == model::ProfileKind::Custom)
                .cloned()
                .collect(),
            selected_account: self.state.selected_account,
            selected_profile: self.state.selected_profile,
            settings: Settings {
                microsoft_client_id: self.state.microsoft_client_id.clone(),
                discord_client_id: self.state.discord_client_id.clone(),
                java_path: self.state.java_path.clone(),
                memory_mb: self.state.memory_mb,
            },
            versions: self.versions.clone(),
            selected_version: self.selected_version.as_ref().map(|v| v.id.clone()),
            status: self.status.clone(),
            busy: self.busy,
            running: self.running,
            game_ready: self.game_ready,
            load_failed: self.load_failed,
            java_status: self.java_status.clone(),
            news_loading: self.news_loading,
            news_error: self.news_error,
        }
    }
    fn reply(&self, include_news: bool) -> super::types::Reply {
        super::types::Reply {
            state: self.snapshot(),
            news: include_news.then(|| self.news.clone()),
        }
    }
    fn ready(&self) -> Result<(), String> {
        if self.load_failed || self._instance_lock.is_none() {
            return Err(self.status.clone());
        }
        if self.busy || self.running {
            return Err("Başka bir işlem veya oyun çalışıyor.".into());
        }
        Ok(())
    }
    fn version(&self, id: &str) -> Result<Version, String> {
        if id.len() > 64
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
            || crate::net::safe_join(std::path::Path::new("."), id).is_err()
        {
            return Err("Sürüm kimliği geçersiz.".into());
        }
        self.versions
            .iter()
            .find(|v| v.id == id)
            .cloned()
            .ok_or_else(|| "Sürüm resmi listede bulunamadı. Önce listeyi yenileyin.".into())
    }
    fn profile(&self, id: Uuid) -> Result<Profile, String> {
        self.state
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "Profil bulunamadı.".into())
    }
    fn account(&self, id: Uuid) -> Result<Account, String> {
        self.state
            .accounts
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| "Hesap bulunamadı.".into())
    }
    pub(super) fn dispatch(
        &mut self,
        action: super::types::Action,
    ) -> Result<super::types::Reply, String> {
        use super::types::{Action, FolderTarget};
        if matches!(action, Action::Inventory) {
            let mut reply = self.reply(false);
            reply.state.profiles = self.state.profiles.clone();
            return Ok(reply);
        }
        if matches!(action, Action::Read) {
            return Ok(self.reply(false));
        }
        if matches!(action, Action::Cancel) {
            self.update(Message::Cancel);
            return Ok(self.reply(false));
        }
        if let Action::Versions { refresh: false } = action {
            if !self.versions.is_empty() || self.busy {
                return Ok(self.reply(false));
            }
        }
        if let Action::News { refresh } = action {
            if self.news_loading || (!refresh && !self.news.is_empty()) {
                return Ok(self.reply(true));
            }
            if self.load_failed || self._instance_lock.is_none() {
                return Err(self.status.clone());
            }
            self.update(Message::RefreshNews);
            return Ok(self.reply(true));
        }
        // Device-code login keeps the worker busy while the user visits Microsoft.
        // Only this fixed, allowlisted URL may be reopened during that operation.
        // PClient klasörü ve destek bağlantıları da oyun açıkken kullanılabilir.
        if matches!(&action, Action::OpenExternal { url } if url == "https://microsoft.com/devicelogin" || crate::pclient::is_support_url(url))
            || matches!(&action, Action::OpenFolder { target: FolderTarget::Pclient })
        {
            if self.load_failed || self._instance_lock.is_none() {
                return Err(self.status.clone());
            }
        } else if self.running
            && matches!(
                &action,
                Action::AddLocal { .. } | Action::SelectAccount { .. } | Action::AccountLoggedIn { .. }
            )
        {
            // PClient'ın oyun içi hesap menüsü: oyun açıkken yalnızca bu işlemlere izin verilir.
            if self.load_failed || self._instance_lock.is_none() {
                return Err(self.status.clone());
            }
        } else {
            self.ready()?;
        }
        let mut commit_expected = false;
        let mut job_expected = false;
        let message = match action {
            Action::ModJob { id, job } => {
                let profile = self.profile(id)?;
                crate::mods::supports(&profile).map_err(|e| e.to_string())?;
                self.busy = true;
                self.cancel = Arc::new(AtomicBool::new(false));
                let cancel = self.cancel.clone();
                let root = self.root.clone();
                let tx = self.tx.clone();
                let lease = self._instance_lock.clone();
                self.status("Mod işlemi başlatıldı…".into());
                std::thread::spawn(move || {
                    let _lease = lease;
                    let status_tx = tx.clone();
                    let result = (job.0)(
                        root,
                        profile,
                        cancel,
                        Box::new(move |s| {
                            let _ = status_tx.send(Event::Status(s));
                        }),
                    )
                    .map_err(|e| format!("{e:#}"));
                    let _ = tx.send(Event::Finished(result));
                });
                return Ok(self.reply(false));
            }
            Action::Inventory => unreachable!(),
            Action::InstallVersion { combination, plan } => {
                combination.validate().map_err(|e| e.to_string())?;
                let version = self.version(&combination.mc)?;
                let profile = self
                    .state
                    .profiles
                    .iter()
                    .find(|p| {
                        p.kind == model::ProfileKind::Quick
                            && crate::store::Combination::of(p) == combination
                    })
                    .cloned()
                    .unwrap_or_else(|| combination.profile());
                let mut state = self.state.clone();
                state.selected_profile = Some(profile.id);
                if !state.profiles.iter().any(|p| p.id == profile.id) {
                    state.profiles.push(profile.clone());
                }
                self.busy = true;
                self.cancel = Arc::new(AtomicBool::new(false));
                self.status("Sürüm ortak depoya indiriliyor…".into());
                let (root, cancel, tx, lease) = (
                    self.root.clone(),
                    self.cancel.clone(),
                    self.tx.clone(),
                    self._instance_lock.clone(),
                );
                std::thread::spawn(move || {
                    let _lease = lease;
                    let progress = tx.clone();
                    let result = (|| -> anyhow::Result<()> {
                        if let Some(plan) = plan {
                            crate::performance::install_quick(
                                &root,
                                &profile,
                                &plan,
                                &cancel,
                                |s| {
                                    let _ = tx.send(Event::Status(s));
                                },
                            )?;
                        }
                        game::install(
                            &root,
                            &state,
                            &version,
                            cancel,
                            Arc::new(move |s| {
                                let _ = progress.send(Event::Status(s));
                            }),
                        )
                    })()
                    .map(|_| profile)
                    .map_err(|e| format!("{e:#}"));
                    let _ = tx.send(Event::QuickInstalled(result));
                });
                return Ok(self.reply(false));
            }
            Action::LaunchQuick { id } => {
                let p = self.profile(id)?;
                if p.kind != model::ProfileKind::Quick {
                    return Err("Quick girişi seçin.".into());
                }
                return self.dispatch(Action::WithProfile {
                    id,
                    operation: super::types::ProfileOperation::Play,
                });
            }
            Action::SelectQuick { id } => {
                let p = self.profile(id)?;
                if p.kind != model::ProfileKind::Quick {
                    return Err("Quick girişi seçin.".into());
                }
                self.update(Message::ProfileSelected(p));
                return Ok(self.reply(false));
            }
            Action::RemoveVersion {
                combination,
                confirmed,
            } => {
                combination.validate().map_err(|e| e.to_string())?;
                let users: Vec<_> = self
                    .state
                    .profiles
                    .iter()
                    .filter(|p| {
                        p.version == combination.mc
                            && (combination.loader == model::Loader::Vanilla
                                || crate::store::Combination::of(p) == combination)
                    })
                    .map(|p| p.name.clone())
                    .collect();
                if !confirmed && !users.is_empty() {
                    return Err(format!(
                        "Sürüm şu girişler tarafından kullanılıyor: {}. Kaldırmak için açık onay gerekli; dünyalar korunur.",
                        users.join(", ")
                    ));
                }
                crate::store::remove(&self.root, &combination).map_err(|e| e.to_string())?;
                self.status(
                    "Sürüm kaldırıldı. Profil dünyaları ve ortak kaynaklar korundu.".into(),
                );
                return Ok(self.reply(false));
            }
            Action::WithProfile { id, operation } => {
                let profile = self.profile(id)?;
                if self.state.selected_profile != Some(id) {
                    self.update(Message::ProfileSelected(profile));
                    if self.state.selected_profile != Some(id) {
                        return Err(self.status.clone());
                    }
                }
                return self.dispatch(match operation {
                    super::types::ProfileOperation::Play => Action::Launch,
                    super::types::ProfileOperation::Backup => Action::Backup,
                    super::types::ProfileOperation::Folder => Action::OpenFolder {
                        target: super::types::FolderTarget::Profile,
                    },
                });
            }
            Action::CreateConfiguredProfile {
                name,
                version_id,
                loader,
                loader_version,
                plan,
                completion,
            } => {
                super::security::text(&name, 40).map_err(|e| e.to_string())?;
                self.version(&version_id)?;
                if (loader == model::Loader::Vanilla && loader_version.is_some())
                    || (plan.is_some() && loader != model::Loader::Fabric)
                {
                    return Err("Performans paketi ve loader sürümü Fabric gerektirir.".into());
                }
                if let Some(v) = &loader_version {
                    crate::loaders::validate(loader, Some(v)).map_err(|e| e.to_string())?;
                }
                if plan
                    .as_ref()
                    .is_some_and(|p| p.minecraft_version != version_id)
                {
                    return Err("Mod planı farklı bir sürüme ait.".into());
                }
                let mut profile = Profile {
                    appearance: Default::default(),
                    kind: crate::model::ProfileKind::Custom,
                    id: Uuid::new_v4(),
                    name: name.trim().into(),
                    version: version_id,
                    loader,
                    loader_version,
                };
                self.busy = true;
                self.cancel = Arc::new(AtomicBool::new(false));
                self.install_completion = Some(completion);
                self.status("Profil ve yükleyici hazırlanıyor…".into());
                let root = self.root.clone();
                let cancel = self.cancel.clone();
                let tx = self.tx.clone();
                let lease = self._instance_lock.clone();
                std::thread::spawn(move || {
                    let _lease = lease;
                    let notify = |s| {
                        let _ = tx.send(Event::Status(s));
                    };
                    let result = (|| -> anyhow::Result<Profile> {
                        profile.loader_version = crate::loaders::resolve(
                            loader,
                            &profile.version,
                            profile.loader_version.as_deref(),
                        )?;
                        crate::performance::install(
                            &root,
                            &profile,
                            plan.as_ref(),
                            &cancel,
                            notify,
                        )?;
                        Ok(profile)
                    })()
                    .map_err(|e| format!("{e:#}"));
                    if tx.send(Event::ProfileInstalled(result.clone())).is_err() {
                        if let Ok(p) = result {
                            crate::performance::cleanup_profile(&root, p.id);
                        }
                    }
                });
                return Ok(self.reply(false));
            }
            Action::SetLoader {
                id,
                expected_version,
                loader,
                loader_version,
            } => {
                let profile = self.profile(id)?;
                if profile.version != expected_version {
                    return Err("Profil sürümü işlem sırasında değişti; yeniden deneyin.".into());
                }
                crate::loaders::validate(loader, loader_version.as_deref())
                    .map_err(|_| "Yükleyici sürümü geçersiz.".to_string())?;
                let mut next = self.state.clone();
                let profile = next.profiles.iter_mut().find(|p| p.id == id).unwrap();
                profile.loader = loader;
                profile.loader_version = loader_version;
                if !self.commit(next) {
                    return Err(self.status.clone());
                }
                self.status("Profil yükleyicisi güncellendi.".into());
                return Ok(self.reply(false));
            }
            Action::Read | Action::Cancel | Action::News { .. } => unreachable!(),
            Action::Versions { .. } => {
                job_expected = true;
                Message::Refresh
            }
            Action::CreateWizardProfile {
                name,
                version_id,
                loader,
                loader_version,
                appearance,
            } => {
                super::security::text(&name, 32).map_err(|e| e.to_string())?;
                let version = self.version(&version_id)?;
                crate::loaders::validate(loader, loader_version.as_deref())
                    .map_err(|_| "Yükleyici sürümü geçersiz.".to_string())?;
                let profile = Profile {
                    appearance: appearance.with_defaults(),
                    kind: model::ProfileKind::Custom,
                    id: Uuid::new_v4(),
                    name: name.trim().into(),
                    version: version_id,
                    loader,
                    loader_version,
                };
                let next = crate::profile_creation::persist(&self.root, &self.state, profile)
                    .map_err(|e| format!("{e:#}"))?;
                self.state = next;
                self.revision += 1;
                self.selected_version = Some(version);
                self.status(
                    "Oyun profili oluşturuldu. Dosyalar ilk oynayışta doğrulanıp indirilir.".into(),
                );
                return Ok(self.reply(false));
            }
            Action::CreateProfile { name, version_id } => {
                super::security::text(&name, 40).map_err(|e| e.to_string())?;
                let version = self.version(&version_id)?;
                self.update(Message::ProfileName(name));
                self.update(Message::DraftVersionSelected(version));
                commit_expected = true;
                Message::CreateProfile
            }
            Action::SelectProfile { id } => {
                let p = self.profile(id)?;
                commit_expected = true;
                Message::ProfileSelected(p)
            }
            Action::RenameProfile { id, name } => {
                super::security::text(&name, 40).map_err(|e| e.to_string())?;
                self.profile(id)?;
                let mut next = self.state.clone();
                next.profiles.iter_mut().find(|p| p.id == id).unwrap().name = name.trim().into();
                if !self.commit(next) {
                    return Err(self.status.clone());
                }
                self.status("Profil yeniden adlandırıldı.".into());
                return Ok(self.reply(false));
            }
            Action::CopyProfile { id, name } => {
                super::security::text(&name, 40).map_err(|e| e.to_string())?;
                let source = self.profile(id)?;
                self.busy = true;
                self.cancel = Arc::new(AtomicBool::new(false));
                self.status("Profil dosyaları kopyalanıyor…".into());
                let (root, cancel, tx, lease) = (
                    self.root.clone(),
                    self.cancel.clone(),
                    self.tx.clone(),
                    self._instance_lock.clone(),
                );
                std::thread::spawn(move || {
                    let _lease = lease;
                    let result = crate::profile_management::duplicate(
                        &root,
                        &source,
                        name.trim().into(),
                        &cancel,
                    )
                    .map_err(|e| format!("{e:#}"));
                    if tx.send(Event::ProfileInstalled(result.clone())).is_err() {
                        if let Ok(p) = result {
                            crate::performance::cleanup_profile(&root, p.id);
                        }
                    }
                });
                return Ok(self.reply(false));
            }
            Action::InstallProfile { id } => {
                let profile = self.profile(id)?;
                let version = self.version(&profile.version)?;
                let mut state = self.state.clone();
                state.selected_profile = Some(id);
                self.busy = true;
                self.cancel = Arc::new(AtomicBool::new(false));
                self.status("Profil indiriliyor ve doğrulanıyor…".into());
                let (root, cancel, tx, lease) = (
                    self.root.clone(),
                    self.cancel.clone(),
                    self.tx.clone(),
                    self._instance_lock.clone(),
                );
                std::thread::spawn(move || {
                    let _lease = lease;
                    let progress = tx.clone();
                    let result = game::install(
                        &root,
                        &state,
                        &version,
                        cancel,
                        Arc::new(move |s| {
                            let _ = progress.send(Event::Status(s));
                        }),
                    )
                    .map_err(|e| format!("{e:#}"));
                    let _ = tx.send(Event::Finished(result));
                });
                return Ok(self.reply(false));
            }
            Action::RemoveProfile { id } => {
                let p = self.profile(id)?;
                if Some(id) != self.state.selected_profile {
                    self.update(Message::ProfileSelected(p));
                    if self.state.selected_profile != Some(id) {
                        return Err(self.status.clone());
                    }
                }
                commit_expected = true;
                Message::RemoveProfile
            }
            Action::SelectVersion { version_id } => {
                let v = self.version(&version_id)?;
                commit_expected = true;
                Message::VersionSelected(v)
            }
            Action::AddLocal { name } => {
                crate::model::local_account(&name).map_err(|e| e.to_string())?;
                self.update(Message::PlayerName(name));
                commit_expected = true;
                Message::AddLocal
            }
            Action::MicrosoftLogin => {
                crate::auth::client_id(&self.state.microsoft_client_id)
                    .ok_or("Microsoft girişi bu derlemede henüz etkin değil.".to_string())?;
                job_expected = true;
                Message::AddMicrosoft
            }
            Action::SelectAccount { id } => {
                let a = self.account(id)?;
                commit_expected = true;
                Message::AccountSelected(a)
            }
            Action::AccountLoggedIn { account } => {
                self.tx.send(Event::Account(Ok(account))).map_err(|e| e.to_string())?;
                return Ok(self.reply(false));
            }
            Action::RemoveAccount { id } => {
                let a = self.account(id)?;
                if Some(id) != self.state.selected_account {
                    self.update(Message::AccountSelected(a));
                    if self.state.selected_account != Some(id) {
                        return Err(self.status.clone());
                    }
                }
                commit_expected = true;
                Message::RemoveAccount
            }
            Action::SaveSettings(settings) => {
                super::security::settings(&settings).map_err(|e| e.to_string())?;
                self.update(Message::ClientId(settings.microsoft_client_id));
                self.update(Message::DiscordClientId(settings.discord_client_id));
                self.update(Message::JavaPath(settings.java_path));
                self.update(Message::Memory(settings.memory_mb.to_string()));
                commit_expected = true;
                Message::SaveSettings
            }
            Action::JoinServer { host, port, pclient } => {
                if self.busy || self.running {
                    return Err("Önce devam eden işlemin bitmesini bekleyin.".into());
                }
                self.join = Some(game::ServerTarget { host, port });
                let launch = if pclient { Action::LaunchPClient } else { Action::Launch };
                return self.dispatch(launch).inspect_err(|_| self.join = None);
            }
            Action::LaunchPClient => {
                job_expected = true;
                Message::PlayPClient(false)
            }
            Action::InstallPClient => {
                job_expected = true;
                Message::PlayPClient(true)
            }
            Action::CheckJava | Action::InstallJava | Action::Launch => {
                let selected = self.selected_version.as_ref().ok_or("Bir sürüm seçin.")?;
                self.version(&selected.id)?;
                job_expected = true;
                match action {
                    Action::CheckJava => Message::CheckJava,
                    Action::InstallJava => Message::InstallJava,
                    _ => Message::Play,
                }
            }
            Action::Backup | Action::Restore { .. } => {
                if self.state.profile().is_none() {
                    return Err("Bir profil seçin.".into());
                }
                job_expected = true;
                if let Action::Restore { confirmed } = action {
                    if !confirmed {
                        return Err("Geri yükleme için açık onay gerekli.".into());
                    }
                    self.update(Message::RestoreProfile);
                    Message::ConfirmRestore
                } else {
                    Message::BackupProfile
                }
            }
            Action::RecoverProfiles => Message::RecoverProfiles,
            Action::OpenExternal { url } => {
                super::security::open_external(&url).map_err(|e| e.to_string())?;
                return Ok(self.reply(false));
            }
            Action::OpenFolder { target } => {
                let path = match target {
                    FolderTarget::Root => self.root.clone(),
                    FolderTarget::Shared => self.root.join("minecraft"),
                    FolderTarget::Pclient => crate::pclient::game_dir(&self.root),
                    _ => {
                        let p = self.state.profile().ok_or("Bir profil seçin.")?;
                        if matches!(target, FolderTarget::Backups) {
                            self.root.join("backups").join(p.id.to_string())
                        } else {
                            let name = match target {
                                FolderTarget::Profile => "",
                                FolderTarget::Mods => "mods",
                                FolderTarget::Shaderpacks => "shaderpacks",
                                FolderTarget::Schematics => "schematics",
                                FolderTarget::Saves => "saves",
                                FolderTarget::Resourcepacks => "resourcepacks",
                                FolderTarget::Screenshots => "screenshots",
                                FolderTarget::Logs => "logs",
                                FolderTarget::Config => "config",
                                _ => unreachable!(),
                            };
                            profiles::dir(&self.root, &p).join(name)
                        }
                    }
                };
                super::security::open_folder(&self.root, &path).map_err(|e| e.to_string())?;
                return Ok(self.reply(false));
            }
        };
        let before = self.revision;
        self.update(message);
        if commit_expected && self.revision == before {
            return Err(self.status.clone());
        }
        if job_expected && !self.busy {
            return Err(self.status.clone());
        }
        Ok(self.reply(false))
    }
    pub(super) fn cancel_on_shutdown(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wizard_profiles_are_custom_isolated_persistent_and_do_not_download() {
        use super::super::types::Action;
        let mut app = command_fixture();
        for _ in 0..2 {
            app.dispatch(Action::CreateWizardProfile {
                name: "Yeni dünya".into(),
                version_id: "1.21.11".into(),
                loader: model::Loader::Fabric,
                loader_version: Some("0.16.10".into()),
                appearance: crate::profile_appearance::Appearance {
                    description: "Kendi dünyam".into(),
                    ..Default::default()
                },
            })
            .unwrap();
        }
        assert!(!app.busy);
        let profiles = &app.state.profiles;
        assert_eq!(profiles.len(), 2);
        assert_ne!(profiles[0].id, profiles[1].id);
        for p in profiles {
            assert_eq!(p.kind, model::ProfileKind::Custom);
            assert_eq!(p.loader, model::Loader::Fabric);
            assert_eq!(p.appearance.description, "Kendi dünyam");
            assert!(crate::profiles::dir(&app.root, p).join("mods").is_dir());
        }
        assert!(!app.root.join("minecraft/versions/1.21.11").exists());
        assert!(
            app.dispatch(Action::CreateWizardProfile {
                name: "a".repeat(33),
                version_id: "1.21.11".into(),
                loader: model::Loader::Vanilla,
                loader_version: None,
                appearance: Default::default(),
            })
            .is_err()
        );
        let loaded = model::State::load(&app.root).unwrap();
        assert_eq!(loaded.profiles[1].appearance.description, "Kendi dünyam");
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn quick_install_events_are_hidden_reusable_and_protected_by_reference_confirmation() {
        use super::super::types::Action;
        let mut app = command_fixture();
        let c = crate::store::Combination {
            mc: "1.21.11".into(),
            loader: model::Loader::Vanilla,
            loader_version: None,
        };
        let p = c.profile();
        profiles::ensure_layout(&app.root, &p).unwrap();
        app.busy = true;
        app.tx.send(Event::QuickInstalled(Ok(p.clone()))).unwrap();
        app.update(Message::Tick);
        assert!(!app.busy);
        assert!(app.snapshot().profiles.is_empty());
        assert_eq!(
            app.dispatch(Action::Inventory)
                .unwrap()
                .state
                .profiles
                .len(),
            1
        );
        assert_eq!(
            State::load(&app.root).unwrap().profiles[0].kind,
            model::ProfileKind::Quick
        );
        assert!(
            app.dispatch(Action::RemoveVersion {
                combination: c.clone(),
                confirmed: false
            })
            .unwrap_err()
            .contains("kullanılıyor")
        );
        assert!(
            app.dispatch(Action::LaunchQuick { id: Uuid::new_v4() })
                .is_err()
        );
        app.cancel.store(true, Ordering::Relaxed);
        let other = c.profile();
        app.tx.send(Event::QuickInstalled(Ok(other))).unwrap();
        app.update(Message::Tick);
        assert_eq!(app.state.profiles.len(), 1);
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn management_rename_copy_and_duplicate_versions_preserve_identity_and_worlds() {
        use super::super::types::Action;
        let mut app = command_fixture();
        app.dispatch(Action::CreateProfile {
            name: "First".into(),
            version_id: "1.21.11".into(),
        })
        .unwrap();
        let original = app.state.profile().unwrap();
        let dir = profiles::ensure_layout(&app.root, &original).unwrap();
        std::fs::write(dir.join("saves/marker"), b"world").unwrap();
        app.dispatch(Action::RenameProfile {
            id: original.id,
            name: "Renamed".into(),
        })
        .unwrap();
        assert_eq!(app.state.profile().unwrap().id, original.id);
        assert_eq!(
            State::load(&app.root).unwrap().profile().unwrap().name,
            "Renamed"
        );
        assert!(
            app.dispatch(Action::RenameProfile {
                id: original.id,
                name: "\ninvalid".into()
            })
            .is_err()
        );
        assert!(
            app.dispatch(Action::CopyProfile {
                id: Uuid::new_v4(),
                name: "Copy".into()
            })
            .is_err()
        );
        app.busy = true;
        assert!(
            app.dispatch(Action::RenameProfile {
                id: original.id,
                name: "Blocked".into()
            })
            .is_err()
        );
        app.busy = false;
        app.dispatch(Action::CopyProfile {
            id: original.id,
            name: "Copy".into(),
        })
        .unwrap();
        for _ in 0..500 {
            app.update(Message::Tick);
            if !app.busy {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(!app.busy);
        assert_eq!(app.state.profiles.len(), 2);
        assert_ne!(app.state.selected_profile, Some(original.id));
        let copied = app.state.profile().unwrap();
        assert_eq!(
            std::fs::read(profiles::dir(&app.root, &copied).join("saves/marker")).unwrap(),
            b"world"
        );
        app.dispatch(Action::RemoveProfile { id: copied.id })
            .unwrap();
        assert!(
            profiles::dir(&app.root, &copied)
                .join("saves/marker")
                .exists()
        );
        app.dispatch(Action::CreateProfile {
            name: "Renamed".into(),
            version_id: "1.21.11".into(),
        })
        .unwrap();
        assert_eq!(app.state.profiles.len(), 2);
        assert_eq!(std::fs::read(dir.join("saves/marker")).unwrap(), b"world");
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn text_input_is_preserved_while_busy_or_load_failed() {
        let mut app = fixture();
        for (busy, load_failed) in [(true, false), (false, true), (true, true)] {
            app.busy = busy;
            app.load_failed = load_failed;
            app.update(Message::PlayerName("Player".into()));
            app.update(Message::ProfileName("Profile".into()));
            app.update(Message::ClientId("Microsoft".into()));
            app.update(Message::DiscordClientId("Discord".into()));
            app.update(Message::JavaPath("custom-java".into()));
            app.update(Message::Memory("2048".into()));
            assert_eq!(app.player_name, "Player");
            assert_eq!(app.profile_name, "Profile");
            assert_eq!(app.client_id, "Microsoft");
            assert_eq!(app.discord_client_id, "Discord");
            assert_eq!(app.java_path, "custom-java");
            assert_eq!(app.memory, "2048");
            assert!(app.java_status.is_none());
            assert!(app.state.accounts.is_empty());
            assert!(!app.root.join("settings.json").exists());
        }
        let _ = std::fs::remove_dir_all(&app.root);
    }

    fn command_fixture() -> App {
        let mut app = fixture();
        app._instance_lock = Some(Arc::new(super::super::lock::acquire(&app.root).unwrap()));
        app
    }
    #[test]
    fn configured_profile_is_published_only_after_worker_completion() {
        use super::super::types::Action;
        let mut app = command_fixture();
        app.dispatch(Action::CreateProfile {
            name: "Existing".into(),
            version_id: "1.21.11".into(),
        })
        .unwrap();
        let old = app.state.selected_profile;
        let (completion, mut result) = tokio::sync::oneshot::channel();
        app.dispatch(Action::CreateConfiguredProfile {
            name: "Configured".into(),
            version_id: "1.21.11".into(),
            loader: model::Loader::Vanilla,
            loader_version: None,
            plan: None,
            completion,
        })
        .unwrap();
        assert!(app.busy);
        assert_eq!(app.state.selected_profile, old);
        assert_eq!(app.state.profiles.len(), 1);
        for _ in 0..500 {
            app.update(Message::Tick);
            if !app.busy {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(result.try_recv().unwrap().is_ok());
        assert!(!app.busy);
        assert_eq!(app.state.profile().unwrap().name, "Configured");
        assert!(
            profiles::dir(&app.root, &app.state.profile().unwrap())
                .join("mods")
                .is_dir()
        );
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn canceled_install_completion_preserves_existing_profile_and_worlds() {
        use super::super::types::Action;
        let mut app = command_fixture();
        app.dispatch(Action::CreateProfile {
            name: "Existing".into(),
            version_id: "1.21.11".into(),
        })
        .unwrap();
        let old = app.state.profile().unwrap();
        let old_dir = profiles::ensure_layout(&app.root, &old).unwrap();
        std::fs::write(old_dir.join("saves/marker"), b"world").unwrap();
        let candidate = Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Custom,
            id: Uuid::new_v4(),
            name: "Unpublished".into(),
            ..old.clone()
        };
        let new_dir = profiles::ensure_layout(&app.root, &candidate).unwrap();
        let (completion, mut result) = tokio::sync::oneshot::channel();
        app.install_completion = Some(completion);
        app.busy = true;
        app.cancel.store(true, Ordering::Relaxed);
        app.tx.send(Event::ProfileInstalled(Ok(candidate))).unwrap();
        app.update(Message::Tick);
        assert!(result.try_recv().unwrap().is_err());
        assert_eq!(app.state.selected_profile, Some(old.id));
        assert_eq!(
            std::fs::read(old_dir.join("saves/marker")).unwrap(),
            b"world"
        );
        assert!(!new_dir.exists());
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn loader_assignment_persists_without_changing_worlds_and_rejects_races() {
        use super::super::types::Action;
        use crate::model::Loader;
        let mut app = command_fixture();
        app.dispatch(Action::CreateProfile {
            name: "Loader test".into(),
            version_id: "1.21.11".into(),
        })
        .unwrap();
        let profile = app.state.profile().unwrap();
        let dir = profiles::ensure_layout(&app.root, &profile).unwrap();
        std::fs::write(dir.join("saves/world-marker"), b"world").unwrap();
        let set = || Action::SetLoader {
            id: profile.id,
            expected_version: "1.21.11".into(),
            loader: Loader::Fabric,
            loader_version: Some("0.18.4".into()),
        };
        app.busy = true;
        assert!(app.dispatch(set()).is_err());
        app.busy = false;
        assert!(
            app.dispatch(Action::SetLoader {
                id: profile.id,
                expected_version: "1.18.2".into(),
                loader: Loader::Fabric,
                loader_version: Some("0.18.4".into())
            })
            .is_err()
        );
        app.dispatch(set()).unwrap();
        let loaded = State::load(&app.root).unwrap().profile().unwrap();
        assert_eq!(loaded.loader, Loader::Fabric);
        assert_eq!(loaded.loader_version.as_deref(), Some("0.18.4"));
        assert_eq!(
            std::fs::read(dir.join("saves/world-marker")).unwrap(),
            b"world"
        );
        app.dispatch(Action::SetLoader {
            id: profile.id,
            expected_version: "1.21.11".into(),
            loader: Loader::Vanilla,
            loader_version: None,
        })
        .unwrap();
        assert_eq!(app.state.profile().unwrap().loader, Loader::Vanilla);
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn device_link_reopen_keeps_lock_and_url_boundaries() {
        use super::super::types::Action;
        let mut app = command_fixture();
        app.busy = true;
        for url in [
            "https://microsoft.com.evil.invalid/devicelogin",
            "javascript:alert(1)",
        ] {
            assert!(
                app.dispatch(Action::OpenExternal { url: url.into() })
                    .is_err()
            );
        }
        app.load_failed = true;
        assert!(
            app.dispatch(Action::OpenExternal {
                url: "https://microsoft.com/devicelogin".into()
            })
            .is_err()
        );
        app.load_failed = false;
        app._instance_lock = None;
        assert!(
            app.dispatch(Action::OpenExternal {
                url: "https://microsoft.com/devicelogin".into()
            })
            .is_err()
        );
        drop(app);
    }
    #[test]
    fn command_boundary_rejects_forged_inputs_without_saving() {
        use super::super::types::{Action, Settings};
        let mut app = command_fixture();
        assert!(
            app.dispatch(Action::SelectAccount { id: Uuid::new_v4() })
                .is_err()
        );
        assert!(
            app.dispatch(Action::SelectProfile { id: Uuid::new_v4() })
                .is_err()
        );
        assert!(
            app.dispatch(Action::CreateProfile {
                name: "Test".into(),
                version_id: "../escape".into()
            })
            .is_err()
        );
        assert!(
            app.dispatch(Action::CreateProfile {
                name: "Test".into(),
                version_id: "9.99".into()
            })
            .is_err()
        );
        assert!(
            app.dispatch(Action::AddLocal {
                name: "../escape".into()
            })
            .is_err()
        );
        assert!(
            app.dispatch(Action::SaveSettings(Settings {
                microsoft_client_id: "not-an-id".into(),
                discord_client_id: String::new(),
                java_path: String::new(),
                memory_mb: 4096
            }))
            .is_err()
        );
        assert!(!app.root.join("settings.json").exists());
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_account_actions_are_allowed_while_the_game_runs() {
        use super::super::types::Action;
        let mut app = command_fixture();
        app.running = true;
        app.busy = true;
        app.dispatch(Action::AddLocal { name: "InGame".into() }).unwrap();
        let id = app.state.accounts[0].id;
        app.dispatch(Action::SelectAccount { id }).unwrap();
        assert!(app.dispatch(Action::RemoveAccount { id }).is_err());
        assert!(app.dispatch(Action::MicrosoftLogin).is_err());
        assert!(
            app.dispatch(Action::CreateProfile {
                name: "Test".into(),
                version_id: "1.21.11".into()
            })
            .is_err()
        );
        // Oyun içinden eklenen hesap, oyunun meşgul durumunu bozmaz.
        let mut account = crate::model::local_account("FromGame").unwrap();
        account.kind = crate::model::AccountKind::Local;
        app.dispatch(Action::AccountLoggedIn { account }).unwrap();
        app.update(Message::Tick);
        assert!(app.busy && app.state.accounts.iter().any(|a| a.name == "FromGame"));
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn commands_create_select_remove_and_preserve_worlds() {
        use super::super::types::Action;
        let mut app = command_fixture();
        app.dispatch(Action::AddLocal {
            name: "TestPlayer".into(),
        })
        .unwrap();
        app.dispatch(Action::CreateProfile {
            name: "Vanilla".into(),
            version_id: "1.21.11".into(),
        })
        .unwrap();
        let profile = app.state.profile().unwrap();
        let base = profiles::dir(&app.root, &profile);
        std::fs::write(base.join("saves/world-marker"), b"world").unwrap();
        app.dispatch(Action::RemoveProfile { id: profile.id })
            .unwrap();
        assert!(base.join("saves/world-marker").exists());
        assert!(State::load(&app.root).unwrap().profiles.is_empty());
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn restore_needs_confirmation_and_is_blocked_while_busy() {
        use super::super::types::Action;
        let mut app = command_fixture();
        app.dispatch(Action::CreateProfile {
            name: "Test".into(),
            version_id: "1.21.11".into(),
        })
        .unwrap();
        assert!(app.dispatch(Action::Restore { confirmed: false }).is_err());
        app.busy = true;
        assert!(app.dispatch(Action::Restore { confirmed: true }).is_err());
        assert!(app.dispatch(Action::Read).is_ok());
        app.dispatch(Action::Cancel).unwrap();
        assert!(app.cancel.load(Ordering::Relaxed));
        let root = app.root.clone();
        drop(app);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_settings_and_profile_paths_are_preserved() {
        let root = std::env::temp_dir().join(format!("patronlauncher-compat-{}", Uuid::new_v4()));
        let account_id = Uuid::new_v4();
        let profile_id = Uuid::new_v4();
        let bytes = serde_json::to_vec_pretty(&serde_json::json!({"accounts":[{"id":account_id,"name":"OldPlayer","uuid":"old-java-uuid","kind":"Local"}],"profiles":[{"id":profile_id,"name":"Old world","version":"1.21.11"}],"selected_account":account_id,"selected_profile":profile_id,"microsoft_client_id":"","discord_client_id":"","java_path":"","memory_mb":8192})).unwrap();
        std::fs::create_dir_all(root.join("instances").join(profile_id.to_string())).unwrap();
        std::fs::write(root.join("settings.json"), &bytes).unwrap();
        let mut app = App::open(root.clone());
        assert!(!app.load_failed);
        assert_eq!(app.state.account().unwrap().id, account_id);
        assert_eq!(app.state.profile().unwrap().id, profile_id);
        assert_eq!(app.memory, "8192");
        assert_eq!(
            profiles::dir(&root, &app.state.profile().unwrap()),
            root.join("instances").join(profile_id.to_string())
        );
        assert_eq!(std::fs::read(root.join("settings.json")).unwrap(), bytes);
        app.dispatch(super::super::types::Action::SaveSettings(
            super::super::types::Settings {
                microsoft_client_id: String::new(),
                discord_client_id: String::new(),
                java_path: String::new(),
                memory_mb: 4096,
            },
        ))
        .unwrap();
        assert_eq!(
            State::load(&root).unwrap().profile().unwrap().id,
            profile_id
        );
        let mut second = App::open(root.clone());
        assert!(second.load_failed);
        assert!(
            second
                .dispatch(super::super::types::Action::AddLocal {
                    name: "Blocked".into()
                })
                .is_err()
        );
        drop(second);
        let lease = app._instance_lock.clone();
        drop(app);
        assert!(super::super::lock::acquire(&root).is_err());
        drop(lease);
        assert!(super::super::lock::acquire(&root).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn background_events_keep_types_and_numeric_progress() {
        let mut app = fixture();
        app.busy = true;
        app.tx
            .send(Event::Status("Kütüphaneler: 2/10".into()))
            .unwrap();
        app.tx
            .send(Event::Finished(Err("Test error".into())))
            .unwrap();
        app.update(Message::Tick);
        assert!(!app.busy);
        assert!(
            app.notifications
                .iter()
                .any(|e| matches!(e, Event::Finished(Err(_))))
        );
        let envelope =
            super::super::types::EventEnvelope::new(1, Event::Status("Kütüphaneler: 2/10".into()));
        assert_eq!(envelope.progress.unwrap().current, 2);
        let json = serde_json::to_value(app.snapshot()).unwrap();
        assert!(json.get("access_token").is_none());
        assert!(json.get("refresh_token").is_none());
    }

    fn fixture() -> App {
        let root = std::env::temp_dir().join(format!("patronlauncher-ui-{}", Uuid::new_v4()));
        let (tx, rx) = mpsc::channel();
        let version = Version {
            id: "1.21.11".into(),
            kind: "release".into(),
            url: "https://example.invalid/".into(),
            sha1: "test-only".into(),
        };
        App {
            root,
            notifications: Vec::new(),
            revision: 0,
            news: Vec::new(),
            news_loading: false,
            news_error: false,
            state: State::default(),
            versions: vec![version.clone()],
            player_name: String::new(),
            profile_name: String::new(),
            selected_version: Some(version),
            draft_version: None,
            client_id: String::new(),
            discord_client_id: String::new(),
            discord_presence: None,
            java_path: String::new(),
            memory: "4096".into(),
            status: String::new(),
            log: vec![],
            busy: false,
            running: false,
            game_ready: false,
            load_failed: false,
            java_status: None,
            restore_confirm: false,
            install_completion: None,
            join: None,
            launch_pclient: false,
            launch_target: None,
            launch_target_pending: false,
            _instance_lock: None,
            cancel: Arc::new(AtomicBool::new(false)),
            tx,
            rx,
        }
    }

    #[test]
    fn account_profile_selection_survives_restart() {
        let mut app = fixture();
        app.update(Message::PlayerName("TestPlayer".into()));
        app.update(Message::AddLocal);
        app.update(Message::ProfileName("Vanilla".into()));
        app.update(Message::CreateProfile);
        assert_eq!(app.state.account().unwrap().name, "TestPlayer");
        assert_eq!(app.state.profile().unwrap().name, "Vanilla");
        let version = Version {
            id: "26.3".into(),
            ..app.versions[0].clone()
        };
        app.update(Message::VersionSelected(version));
        let saved = State::load(&app.root).unwrap();
        assert_eq!(saved.account().unwrap().name, "TestPlayer");
        assert_eq!(saved.profile().unwrap().version, "26.3");
        app.update(Message::PlayerName("testplayer".into()));
        app.update(Message::AddLocal);
        assert_eq!(app.state.accounts.len(), 1);
        // Removal changes the list only; a world's files must be preserved.
        let instance = game::instance_dir(&app.root, &app.state.profile().unwrap());
        std::fs::create_dir_all(&instance).unwrap();
        std::fs::write(instance.join("world-marker"), b"world").unwrap();
        app.update(Message::RemoveProfile);
        assert!(instance.join("world-marker").is_file());
        std::fs::remove_dir_all(&app.root).unwrap();
    }

    #[test]
    fn invalid_settings_and_busy_state_do_not_start_game() {
        let mut app = fixture();
        app.update(Message::Memory("not a number".into()));
        app.update(Message::Play);
        assert!(!app.busy);
        assert!(app.status.contains("Bellek"));
        app.busy = true;
        app.player_name = "TestPlayer".into();
        app.update(Message::AddLocal);
        assert!(app.state.accounts.is_empty());
        app.update(Message::Cancel);
        assert!(app.cancel.load(Ordering::Relaxed));
        assert!(!app.root.exists());
    }

    #[test]
    fn refreshing_preserves_profile_and_does_not_replace_missing_version() {
        let mut app = fixture();
        app.update(Message::PlayerName("TestPlayer".into()));
        app.update(Message::AddLocal);
        app.update(Message::ProfileName("My profile".into()));
        app.update(Message::CreateProfile);
        let profile = app.state.profile().unwrap();
        let selected = app.selected_version.clone().unwrap();
        let latest = Version {
            id: "26.3".into(),
            ..selected.clone()
        };
        let base = game::instance_dir(&app.root, &profile);
        std::fs::write(base.join("options.txt"), b"my settings").unwrap();
        app.memory = "8192".into(); // Unsaved input must survive navigation/refresh.
        app.busy = true;
        app.tx
            .send(Event::Versions(Ok(vec![latest.clone(), selected.clone()])))
            .unwrap();
        app.update(Message::Tick);
        assert_eq!(app.memory, "8192");
        assert_eq!(app.selected_version.as_ref().unwrap().id, selected.id);
        app.tx.send(Event::Versions(Ok(vec![latest]))).unwrap();
        app.update(Message::Tick);
        assert!(app.selected_version.is_none());
        assert_eq!(app.state.profile().unwrap().version, profile.version);
        assert_eq!(
            std::fs::read(base.join("options.txt")).unwrap(),
            b"my settings"
        );
        assert_eq!(
            State::load(&app.root).unwrap().profile().unwrap().id,
            profile.id
        );
        std::fs::remove_dir_all(app.root).unwrap();
    }

    #[test]
    fn new_profile_version_does_not_change_existing_profile() {
        let mut app = fixture();
        app.update(Message::PlayerName("TestPlayer".into()));
        app.update(Message::AddLocal);
        app.update(Message::ProfileName("Existing".into()));
        app.update(Message::CreateProfile);
        let first = app.state.profile().unwrap();
        let version = Version {
            id: "26.3".into(),
            ..app.versions[0].clone()
        };
        app.update(Message::DraftVersionSelected(version));
        assert_eq!(app.state.profile().unwrap().version, first.version);
        app.update(Message::ProfileName("New profile".into()));
        app.update(Message::CreateProfile);
        assert_eq!(app.state.profile().unwrap().version, "26.3");
        assert_eq!(
            app.state
                .profiles
                .iter()
                .find(|p| p.id == first.id)
                .unwrap()
                .version,
            first.version
        );
        assert_eq!(app.selected_version.as_ref().unwrap().id, "26.3");
        std::fs::remove_dir_all(app.root).unwrap();
    }
}
