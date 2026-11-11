/** Shared Rust IPC contract used by the live React frontend. */
export type Uuid = string;
export type AccountKind = "Local" | "Microsoft";
export interface Account {
  id: Uuid;
  name: string;
  uuid: string;
  kind: AccountKind;
}
export type Loader = "Vanilla" | "Fabric" | "Quilt" | "NeoForge" | "Forge" | "OptiFine";
export interface ProfileAppearance {
  description: string;
  icon: string | null;
  background: string | null;
}
export interface Profile {
  appearance?: ProfileAppearance;
  kind?: "Quick" | "Custom";
  id: Uuid;
  name: string;
  version: string;
  loader?: Loader;
  loader_version?: string | null;
}
export interface Version {
  id: string;
  url: string;
  sha1: string;
  type: string;
}
export interface Settings {
  microsoft_client_id: string;
  discord_client_id: string;
  java_path: string;
  memory_mb: number;
}
export type JavaStatus =
  | { kind: "ready"; major: number; path: string }
  | { kind: "missing"; major: number; reason: string };
export interface Article {
  title: string;
  date: string;
  url: string;
  /** Bounded, decoded PNG; no arbitrary filesystem URL. */ image:
    string | null;
}
export interface Snapshot {
  quick_profile?: Profile | null;
  accounts: Account[];
  profiles: Profile[];
  selected_account: Uuid | null;
  selected_profile: Uuid | null;
  settings: Settings;
  versions: Version[];
  selected_version: string | null;
  status: string;
  busy: boolean;
  running: boolean;
  /** Oyun penceresi açılıp ilk menüye ulaştı (PClient). */
  game_ready: boolean;
  load_failed: boolean;
  java_status: JavaStatus | null;
  news_loading: boolean;
  news_error: boolean;
}
export interface Reply {
  state: Snapshot;
  /** Present on get_news replies. Completion arrives as a news event. */ news:
    Article[] | null;
}
export type RustResult<T> = { Ok: T } | { Err: string };
export type CoreEvent =
  | { kind: "status"; result: string }
  | { kind: "versions"; result: RustResult<Version[]> }
  | { kind: "account"; result: RustResult<Account> }
  | { kind: "finished"; result: RustResult<null> }
  | { kind: "java_checked" | "java_installed"; result: RustResult<JavaStatus> }
  | { kind: "news"; result: RustResult<Article[]> };
export interface EventEnvelope {
  sequence: number;
  event: CoreEvent;
  progress: { current: number; total: number } | null;
}
export interface EventPayloads {
  "patronlauncher://core-event": EventEnvelope;
  "patronlauncher://state": Snapshot;
}
export type FolderTarget =
  | "pclient"
  | "root"
  | "shared"
  | "profile"
  | "mods"
  | "shaderpacks"
  | "schematics"
  | "saves"
  | "resourcepacks"
  | "screenshots"
  | "logs"
  | "config"
  | "backups";
/** Top-level invoke argument keys use Tauri's camelCase; persisted settings stay snake_case. */
export interface CommandArgs {
  create_wizard_profile: {
    name: string;
    versionId: string;
    loader: Loader;
    loaderVersion: string | null;
    appearance: ProfileAppearance;
  };
  install_version: {
    mc: string;
    loader: Loader;
    loaderVersion: string | null;
    planId?: string | null;
    confirmed?: boolean;
  };
  select_quick: { id: string };
  create_configured_profile: {
    name: string;
    versionId: string;
    loader: Loader;
    loaderVersion: string | null;
    planId: string | null;
    confirmed: boolean;
  };
  get_state: Record<string, never>;
  list_versions: { refresh: boolean };
  list_profiles: Record<string, never>;
  create_profile: { name: string; versionId: string };
  rename_profile: { id: Uuid; name: string };
  copy_profile: { id: Uuid; name: string };
  install_profile: { id: Uuid };
  profile_action: { id: Uuid; operation: "play" | "backup" | "folder" };
  remove_profile: { id: Uuid };
  select_profile: { id: Uuid };
  select_version: { versionId: string };
  list_accounts: Record<string, never>;
  add_local_account: { name: string };
  microsoft_login: Record<string, never>;
  remove_account: { id: Uuid };
  select_account: { id: Uuid };
  read_settings: Record<string, never>;
  save_settings: { settings: Settings };
  get_news: { refresh: boolean };
  check_java: Record<string, never>;
  install_java: Record<string, never>;
  launch_game: Record<string, never>;
  pclient_play: Record<string, never>;
  pclient_install: Record<string, never>;
  join_server: { id: string; pclient?: boolean };
  cancel_operation: Record<string, never>;
  backup_profile: Record<string, never>;
  restore_profile: { confirmed: boolean };
  recover_profiles: Record<string, never>;
  open_folder: { target: FolderTarget };
  open_external: { url: string };
}
export type CommandName = keyof CommandArgs;
export type CommandResults = { [K in CommandName]: Reply };

/** Fabric metadata and existing-profile assignment commands. */
export interface LoaderVersions {
  versions: { version: string; stable: boolean }[];
  default_version: string | null;
}
export interface LoaderCommandArgs {
  list_loader_versions: { minecraftVersion: string; loader?: Loader };
  set_profile_loader: {
    id: Uuid;
    loader: Loader;
    loaderVersion: string | null;
  };
}
export interface LoaderCommandResults {
  list_loader_versions: LoaderVersions;
  set_profile_loader: Reply;
}

export interface PerformancePlan {
  plan_id: string;
  minecraft_version: string;
  mods: {
    project_id: string;
    title: string;
    version_id: string;
    version: string;
    filename: string;
    size: number;
    dependency: boolean;
  }[];
  total_size: number;
  warnings: string[];
}

export interface InstalledVersion {
  mc: string;
  loader: Loader;
  loader_version: string | null;
  quick_id: string | null;
}
