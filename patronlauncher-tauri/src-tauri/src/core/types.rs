use crate::{
    game::Version,
    model::{Account, Profile},
    news::Article,
    runtime::JavaStatus,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub microsoft_client_id: String,
    pub discord_client_id: String,
    pub java_path: String,
    pub memory_mb: u32,
}
#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub quick_profile: Option<Profile>,
    pub accounts: Vec<Account>,
    pub profiles: Vec<Profile>,
    pub selected_account: Option<Uuid>,
    pub selected_profile: Option<Uuid>,
    pub settings: Settings,
    pub versions: Vec<Version>,
    pub selected_version: Option<String>,
    pub status: String,
    pub busy: bool,
    pub running: bool,
    /// Oyun penceresi açılıp ilk menüye ulaştı.
    pub game_ready: bool,
    pub load_failed: bool,
    pub java_status: Option<JavaStatus>,
    pub news_loading: bool,
    pub news_error: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct Reply {
    pub state: Snapshot,
    pub news: Option<Vec<Article>>,
}
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderTarget {
    Root,
    Shared,
    Profile,
    Mods,
    Shaderpacks,
    Schematics,
    Saves,
    Resourcepacks,
    Screenshots,
    Logs,
    Config,
    Backups,
    /// PClient'ın gizli oyun klasörü; seçili profile bağlı değildir.
    Pclient,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileOperation {
    Play,
    Backup,
    Folder,
}
#[derive(Debug)]
pub enum Action {
    ModJob {
        id: Uuid,
        job: crate::mods::Job,
    },
    Inventory,
    InstallVersion {
        combination: crate::store::Combination,
        plan: Option<crate::performance::ApprovedPlan>,
    },
    SelectQuick {
        id: Uuid,
    },
    LaunchQuick {
        id: Uuid,
    },
    RemoveVersion {
        combination: crate::store::Combination,
        confirmed: bool,
    },
    WithProfile {
        id: Uuid,
        operation: ProfileOperation,
    },
    CreateConfiguredProfile {
        name: String,
        version_id: String,
        loader: crate::model::Loader,
        loader_version: Option<String>,
        plan: Option<crate::performance::ApprovedPlan>,
        completion: tokio::sync::oneshot::Sender<Result<(), String>>,
    },
    Read,
    Versions {
        refresh: bool,
    },
    CreateProfile {
        name: String,
        version_id: String,
    },
    CreateWizardProfile {
        name: String,
        version_id: String,
        loader: crate::model::Loader,
        loader_version: Option<String>,
        appearance: crate::profile_appearance::Appearance,
    },
    RemoveProfile {
        id: Uuid,
    },
    RenameProfile {
        id: Uuid,
        name: String,
    },
    CopyProfile {
        id: Uuid,
        name: String,
    },
    InstallProfile {
        id: Uuid,
    },
    SelectProfile {
        id: Uuid,
    },
    SelectVersion {
        version_id: String,
    },
    SetLoader {
        id: Uuid,
        expected_version: String,
        loader: crate::model::Loader,
        loader_version: Option<String>,
    },
    AddLocal {
        name: String,
    },
    MicrosoftLogin,
    RemoveAccount {
        id: Uuid,
    },
    SelectAccount {
        id: Uuid,
    },
    SaveSettings(Settings),
    News {
        refresh: bool,
    },
    CheckJava,
    InstallJava,
    Launch,
    /// Oyun içinden tamamlanan Microsoft girişinin sonucunu hesap listesine ekler.
    AccountLoggedIn {
        account: Account,
    },
    /// PClient'ı gizli, launcher profillerinden ayrı profiliyle başlatır.
    LaunchPClient,
    /// PClient'ın seçili sürümünü oyunu açmadan indirir ve kurar.
    InstallPClient,
    /// Seçili oyunu (pclient ise PClient'ı) açıp sunucu listesindeki bir sunucuya doğrudan bağlanır.
    JoinServer {
        host: String,
        port: Option<u16>,
        pclient: bool,
    },
    Cancel,
    Backup,
    Restore {
        confirmed: bool,
    },
    RecoverProfiles,
    OpenFolder {
        target: FolderTarget,
    },
    OpenExternal {
        url: String,
    },
}
#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub current: u64,
    pub total: u64,
}
#[derive(Debug, Clone, Serialize)]
pub struct EventEnvelope {
    pub sequence: u64,
    pub event: super::app::Event,
    pub progress: Option<Progress>,
}
impl EventEnvelope {
    pub fn new(sequence: u64, event: super::app::Event) -> Self {
        let progress = if let super::app::Event::Status(text) = &event {
            text.rsplit_once(':')
                .and_then(|(_, v)| v.trim().split_once('/'))
                .and_then(|(a, b)| {
                    Some(Progress {
                        current: a.trim().parse().ok()?,
                        total: b.trim().parse().ok()?,
                    })
                })
                .filter(|p| p.total > 0 && p.current <= p.total)
        } else {
            None
        };
        Self {
            sequence,
            event,
            progress,
        }
    }
}

pub enum Notification {
    Event(EventEnvelope),
    State(Snapshot),
}
