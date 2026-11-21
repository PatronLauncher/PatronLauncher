// Bilgisayarda çalan müziği (Spotify, YouTube Music, Deezer…) Windows medya oturumundan izler
// ve launcher müziğiyle karışmasını engeller. Çalar sekmesi de aynı veriyi kullanır; böylece
// medya oturumu ikinci kez sorgulanmaz.
import { invoke } from "@tauri-apps/api/core";
import { music } from "./music";

export interface NowPlaying {
  title: string;
  artists: string;
  album: string;
  /** Kapak resmi anahtarı; `media_cover` ile istenir. */
  image: string | null;
  duration_ms: number;
  progress_ms: number;
  is_playing: boolean;
  shuffle: boolean;
  /** Müziği çalan uygulama (ör. "Spotify", "Google Chrome"). */
  device: string | null;
  /** Uygulamanın Windows ses karıştırıcısındaki düzeyi. */
  volume: number | null;
}

const POLL_MS = 3000;
/** Bu kadar üst üste hata alınca medya oturumu okunamıyor sayılır. */
const FAILURE_LIMIT = 3;
/** Açılışta müziği medya yanıtı için en fazla bu kadar bekletir. */
const START_WAIT_MS = 2500;
/** Önceki parçanın bitmesine bu kadar kala gelen değişim, kullanıcı atlaması sayılmaz. */
const NATURAL_END_MS = POLL_MS + 3000;

export interface Reading {
  /** Bilgisayarda bir oynatıcı var mı. */
  online: boolean;
  playing: boolean;
  track: string | null;
  remainingMs: number;
}
export interface GuardState {
  /** Launcher müziğini dış oynatıcı yüzünden biz durdurduk; o susunca devam eder. */
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

/** Tek bir medya yanıtının launcher müziğine etkisini hesaplar. */
export function guardStep(prev: GuardState, r: Reading, launcherPlaying: boolean): [GuardState, GuardAction] {
  if (!r.online) return [initialGuard, prev.held && !launcherPlaying ? "resume" : null];
  const next: GuardState = { ...prev, active: r.playing, track: r.track, remainingMs: r.remainingMs };
  // Oynatıcı duraklatıldıysa izin de biter: yeniden çalması yeni bir başlangıçtır.
  if (!r.playing) return [{ ...next, override: null, awaitingOverride: false }, null];
  if (prev.awaitingOverride) return [{ ...next, override: r.track, awaitingOverride: false }, null];
  if (!launcherPlaying) return [next, null];
  if (prev.override === null) return [{ ...next, held: true }, "playing"];
  if (prev.override === r.track) return [next, null];
  if (prev.remainingMs < NATURAL_END_MS) return [{ ...next, override: r.track }, null];
  return [{ ...next, held: true, override: null }, "changed"];
}

const trackKey = (n: NowPlaying) => `${n.device ?? ""}|${n.title}|${n.artists}`;

export interface MediaSnapshot {
  now: NowPlaying | null;
  /** performance.now() cinsinden son yanıtın zamanı. */
  syncedAt: number;
  /** İlk yanıt geldi mi. */
  ready: boolean;
  error: string;
  notice: { id: number; reason: StopReason; app: string } | null;
}

class MediaGuard {
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
  snapshot: MediaSnapshot = { now: null, syncedAt: 0, ready: false, error: "", notice: null };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;
  private publish(p: Partial<MediaSnapshot>) {
    this.snapshot = { ...this.snapshot, ...p };
    this.listeners.forEach((fn) => fn());
  }

  start() {
    if (this.running) return;
    this.running = true;
    music.onUserStart = () => this.userStarted();
    this.first = this.poll();
  }

  stop() {
    this.running = false;
    this.generation++;
    clearTimeout(this.timer);
    music.onUserStart = null;
  }

  /** Oyun açıkken müzik zaten duraklatılmışsa boşuna sorgu yapılmaz. */
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
    if (this.running && !this.blocked) this.timer = setTimeout(() => void this.poll(), ms);
  }

  /** Medya oturumunu hemen sorar. */
  async poll() {
    if (!this.running || this.blocked) return;
    const generation = ++this.generation;
    try {
      const now = (await invoke<NowPlaying | null>("media_now_playing")) ?? null;
      if (generation !== this.generation) return;
      this.failures = 0;
      this.publish({ now, syncedAt: performance.now(), ready: true, error: "" });
      this.apply({
        online: now !== null,
        playing: !!now?.is_playing,
        track: now ? trackKey(now) : null,
        remainingMs: now ? Math.max(0, now.duration_ms - now.progress_ms) : 0,
      });
    } catch (e) {
      if (generation !== this.generation) return;
      this.publish({ error: String(e), ready: true });
      if (++this.failures >= FAILURE_LIMIT) {
        this.publish({ now: null });
        this.apply({ online: false, playing: false, track: null, remainingMs: 0 });
      }
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
    this.publish({ notice: { id: ++this.noticeId, reason, app: this.snapshot.now?.device ?? "" } });
  }

  private userStarted() {
    const active = this.state.active;
    this.state = { ...this.state, held: false, override: null, awaitingOverride: active };
    if (this.snapshot.notice) this.publish({ notice: null });
    if (active) void this.poll();
  }

  /** Kullanıcı dış oynatıcıyı launcher içinden başlatınca müzik uyarı göstermeden susar. */
  yieldToPlayer() {
    const wasPlaying = music.state.playing;
    if (wasPlaying) void music.pause();
    this.state = { ...this.state, held: this.state.held || wasPlaying, override: null, awaitingOverride: false };
  }

  /** Otomatik başlatmalar için: dışarıda müzik çalıyorsa launcher müziğini hiç başlatmadan uyarır. */
  async startUnlessPlaying(start: () => void) {
    const check = this.first ?? this.poll();
    await Promise.race([check, new Promise((done) => setTimeout(done, START_WAIT_MS))]);
    this.first = null;
    if (!this.state.active) return start();
    this.state = { ...this.state, held: true };
    this.publish({ notice: { id: ++this.noticeId, reason: "playing", app: this.snapshot.now?.device ?? "" } });
  }

  clearError() {
    if (this.snapshot.error) this.publish({ error: "" });
  }

  dismissNotice() {
    if (this.snapshot.notice) this.publish({ notice: null });
  }
}

export const mediaGuard = new MediaGuard();
