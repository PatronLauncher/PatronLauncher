// Spotify çalma durumunu tek yerden izler ve launcher müziğiyle karışmasını engeller.
// Spotify sekmesi de aynı veriyi kullanır; böylece API'ye ikinci bir yoklama gitmez.
import { invoke } from "@tauri-apps/api/core";
import { music } from "./music";

export interface NowPlaying {
  title: string;
  artists: string;
  album: string;
  image: string | null;
  url: string | null;
  duration_ms: number;
  progress_ms: number;
  is_playing: boolean;
  shuffle: boolean;
  device: string | null;
  volume: number | null;
}

const POLL_MS = 5000;
const STATUS_RETRY_MS = 30_000;
/** Bu kadar üst üste hata alınca Spotify'a ulaşılamıyor sayılır. */
const FAILURE_LIMIT = 3;
/** Açılışta müziği Spotify yanıtı için en fazla bu kadar bekletir. */
const START_WAIT_MS = 2500;
/** Önceki parçanın bitmesine bu kadar kala gelen değişim, kullanıcı atlaması sayılmaz. */
const NATURAL_END_MS = POLL_MS + 3000;

export interface Reading {
  /** Spotify bağlı ve etkin bir cihaz var mı. */
  online: boolean;
  playing: boolean;
  track: string | null;
  remainingMs: number;
}
export interface GuardState {
  /** Launcher müziğini Spotify yüzünden biz durdurduk; Spotify kapanınca devam eder. */
  held: boolean;
  /** Kullanıcı bu parça çalarken launcher müziğini bilerek yeniden başlattı. */
  override: string | null;
  /** Kullanıcı az önce başlattı; izin verilen parça bir sonraki yanıttan alınır. */
  awaitingOverride: boolean;
  active: boolean;
  track: string | null;
  remainingMs: number;
}
export type StopReason = "playing" | "changed";
export type GuardAction = "resume" | StopReason | null;

export const initialGuard: GuardState = {
  held: false,
  override: null,
  awaitingOverride: false,
  active: false,
  track: null,
  remainingMs: 0,
};

/** Tek bir Spotify yanıtının launcher müziğine etkisini hesaplar. */
export function guardStep(prev: GuardState, r: Reading, launcherPlaying: boolean): [GuardState, GuardAction] {
  if (!r.online) return [initialGuard, prev.held && !launcherPlaying ? "resume" : null];
  const next: GuardState = { ...prev, active: r.playing, track: r.track, remainingMs: r.remainingMs };
  // Spotify duraklatıldıysa izin de biter: yeniden çalması yeni bir başlangıçtır.
  if (!r.playing) return [{ ...next, override: null, awaitingOverride: false }, null];
  if (prev.awaitingOverride) return [{ ...next, override: r.track, awaitingOverride: false }, null];
  if (!launcherPlaying) return [next, null];
  if (prev.override === null) return [{ ...next, held: true }, "playing"];
  if (prev.override === r.track) return [next, null];
  if (prev.remainingMs < NATURAL_END_MS) return [{ ...next, override: r.track }, null];
  return [{ ...next, held: true, override: null }, "changed"];
}

const trackKey = (n: NowPlaying) => n.url ?? `${n.title}|${n.artists}`;

export interface SpotifySnapshot {
  connected: boolean;
  now: NowPlaying | null;
  /** performance.now() cinsinden son yanıtın zamanı. */
  syncedAt: number;
  error: string;
  notice: { id: number; reason: StopReason } | null;
}

class SpotifyGuard {
  private state = initialGuard;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Yalnızca en son başlatılan sorgunun yanıtı işlenir. */
  private generation = 0;
  private failures = 0;
  private running = false;
  private blocked = false;
  private noticeId = 0;
  private first: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  snapshot: SpotifySnapshot = { connected: false, now: null, syncedAt: 0, error: "", notice: null };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;
  private publish(p: Partial<SpotifySnapshot>) {
    this.snapshot = { ...this.snapshot, ...p };
    this.listeners.forEach((fn) => fn());
  }

  start() {
    if (this.running) return;
    this.running = true;
    music.onUserStart = () => this.userStarted();
    this.first = this.refresh();
  }

  stop() {
    this.running = false;
    this.generation++;
    clearTimeout(this.timer);
    music.onUserStart = null;
  }

  /** Oyun açıkken müzik zaten duraklatılmışsa Spotify'a boşuna istek gitmez. */
  setBlocked(blocked: boolean) {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    if (blocked) {
      this.generation++;
      clearTimeout(this.timer);
    } else void this.poll();
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    if (this.running && !this.blocked) this.timer = setTimeout(() => void this.tick(), ms);
  }
  private tick() {
    return this.snapshot.connected ? this.poll() : this.refresh();
  }

  /** Bağlantı durumunu yeniden okur; giriş ve çıkıştan sonra da çağrılır. */
  async refresh() {
    const generation = ++this.generation;
    try {
      const status = await invoke<{ connected: boolean } | undefined>("spotify_status");
      if (generation !== this.generation) return;
      this.failures = 0;
      if (status?.connected) {
        this.publish({ connected: true, error: "" });
        await this.poll();
      } else {
        this.publish({ connected: false, now: null, error: "" });
        this.apply({ online: false, playing: false, track: null, remainingMs: 0 });
      }
    } catch {
      if (generation !== this.generation) return;
      this.schedule(STATUS_RETRY_MS);
    }
  }

  /** Spotify'ı hemen sorar. */
  async poll() {
    if (!this.running || this.blocked || !this.snapshot.connected) return;
    const generation = ++this.generation;
    try {
      const now = (await invoke<NowPlaying | null>("spotify_now_playing")) ?? null;
      if (generation !== this.generation) return;
      this.failures = 0;
      this.publish({ now, syncedAt: performance.now(), error: "" });
      this.apply({
        online: now !== null,
        playing: !!now?.is_playing,
        track: now ? trackKey(now) : null,
        remainingMs: now ? Math.max(0, now.duration_ms - now.progress_ms) : 0,
      });
      this.schedule(POLL_MS);
    } catch (e) {
      if (generation !== this.generation) return;
      this.pollFailed(String(e));
    }
  }

  private pollFailed(message: string) {
    if (message.includes("bağlı değil") || message.includes("oturumu sona erdi")) {
      void this.refresh();
      return;
    }
    this.publish({ error: message });
    // Hız sınırı bağlantı kopması değildir; yalnızca biraz daha seyrek sorulur.
    if (message.includes("çok fazla")) return this.schedule(POLL_MS * 4);
    if (++this.failures >= FAILURE_LIMIT) {
      this.publish({ now: null });
      this.apply({ online: false, playing: false, track: null, remainingMs: 0 });
    }
    this.schedule(POLL_MS);
  }

  private apply(reading: Reading) {
    const [state, action] = guardStep(this.state, reading, music.state.playing);
    this.state = state;
    if (action === "resume") void music.resume();
    else if (action) this.stopLauncher(action);
  }

  private stopLauncher(reason: StopReason) {
    void music.pause();
    this.publish({ notice: { id: ++this.noticeId, reason } });
  }

  private userStarted() {
    const active = this.state.active;
    this.state = { ...this.state, held: false, override: null, awaitingOverride: active };
    if (this.snapshot.notice) this.publish({ notice: null });
    if (active) void this.poll();
  }

  /** Kullanıcı Spotify'ı launcher içinden başlatınca müzik uyarı göstermeden susar. */
  yieldToSpotify() {
    const wasPlaying = music.state.playing;
    if (wasPlaying) void music.pause();
    this.state = { ...this.state, held: this.state.held || wasPlaying, override: null, awaitingOverride: false };
  }

  /** Otomatik başlatmalar için: Spotify çalıyorsa müziği hiç başlatmadan uyarır. */
  async startUnlessPlaying(start: () => void) {
    const check = this.first ?? this.poll();
    await Promise.race([check, new Promise((done) => setTimeout(done, START_WAIT_MS))]);
    this.first = null;
    if (!this.state.active) return start();
    this.state = { ...this.state, held: true };
    this.publish({ notice: { id: ++this.noticeId, reason: "playing" } });
  }

  clearError() {
    if (this.snapshot.error) this.publish({ error: "" });
  }

  dismissNotice() {
    if (this.snapshot.notice) this.publish({ notice: null });
  }
}

export const spotifyGuard = new SpotifyGuard();
