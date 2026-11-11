// Launcher içi müzik çalar. Parçalar uygulamaya gömülüdür; ilk çalışta blob adresine
// alınır (tam ileri/geri sarma için) ve Web Audio çözümleyicisiyle görselleştirilir.
import { msg } from "./i18n";

export interface Track {
  id: string;
  title: string;
  src: string;
  /** Kapak gradyanı için iki renk. */
  hue: [number, number];
}
// Lisanslı/telifsiz parçalar eklenene kadar liste boştur; çalar Spotify ile kullanılır.
export const tracks: Track[] = [];
/** Liste boşken arayüzün kapak ve başlık için kullandığı yer tutucu. */
export const noTrack: Track = { id: "none", title: "", src: "", hue: [262, 330] };

export interface MusicState {
  index: number;
  playing: boolean;
  /** Saniye */
  time: number;
  duration: number;
  loading: boolean;
  error: string;
}

const FADE_MS = 700;

class MusicEngine {
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private blobs = new Map<string, string>();
  private order: number[] = [];
  private history: number[] = [];
  private fade: ReturnType<typeof setInterval> | null = null;
  private gain = 1;
  private listeners = new Set<() => void>();
  private volume = 0.05;
  private muted = false;
  shuffle = true;
  repeat: "all" | "one" = "all";
  /** Oyun açılınca duraklatıldıysa, kapanınca kaldığı yerden devam eder. */
  suspendedByGame = false;
  /** Kullanıcı müziği kendi eliyle başlattığında çağrılır (Spotify koruması bunu dinler). */
  onUserStart: (() => void) | null = null;
  private pendingGesture: ((e: Event) => void) | null = null;
  state: MusicState = {
    index: Math.floor(Math.random() * tracks.length),
    playing: false,
    time: 0,
    duration: 0,
    loading: false,
    error: "",
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(p: Partial<MusicState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((fn) => fn());
  }

  private element() {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = "auto";
    a.addEventListener("timeupdate", () => this.set({ time: a.currentTime }));
    a.addEventListener("durationchange", () =>
      this.set({ duration: Number.isFinite(a.duration) ? a.duration : 0 }),
    );
    a.addEventListener("ended", () => {
      if (this.repeat === "one") {
        a.currentTime = 0;
        void a.play().catch(() => {});
      } else void this.next(true);
    });
    a.addEventListener("error", () => {
      if (a.src) this.set({ error: msg("Parça çalınamadı."), playing: false, loading: false });
    });
    this.audio = a;
    return a;
  }

  /** Çözümleyici ses grafiği; görselleştirme yalnızca bu bağlanınca çalışır. */
  private graph() {
    if (this.ctx || !this.audio) return;
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx: AudioContext = new AC();
      const src = ctx.createMediaElementSource(this.audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser).connect(ctx.destination);
      this.ctx = ctx;
      this.analyser = analyser;
    } catch {
      /* görselleştirme olmadan da çalar */
    }
  }

  private async source(track: Track) {
    const cached = this.blobs.get(track.id);
    if (cached) return cached;
    try {
      const blob = await (await fetch(track.src)).blob();
      const url = URL.createObjectURL(blob);
      this.blobs.set(track.id, url);
      return url;
    } catch {
      return track.src;
    }
  }

  private applyVolume() {
    if (this.audio) this.audio.volume = this.muted ? 0 : Math.min(1, this.volume * this.gain);
  }

  private ramp(to: number, ms = FADE_MS) {
    if (this.fade) clearInterval(this.fade);
    const from = this.gain,
      start = performance.now();
    return new Promise<void>((resolve) => {
      if (ms <= 0) {
        this.gain = to;
        this.applyVolume();
        return resolve();
      }
      this.fade = setInterval(() => {
        const k = Math.min(1, (performance.now() - start) / ms);
        this.gain = from + (to - from) * k;
        this.applyVolume();
        if (k >= 1) {
          clearInterval(this.fade!);
          this.fade = null;
          resolve();
        }
      }, 30);
    });
  }

  configure(o: { volume: number; muted: boolean; shuffle: boolean; repeat: "all" | "one" }) {
    this.volume = o.volume / 100;
    this.muted = o.muted;
    if (o.shuffle !== this.shuffle) this.order = [];
    this.shuffle = o.shuffle;
    this.repeat = o.repeat;
    this.applyVolume();
  }

  private upcoming() {
    if (!this.order.length) {
      const all = tracks.map((_, i) => i).filter((i) => i !== this.state.index);
      if (this.shuffle)
        for (let i = all.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [all[i], all[j]] = [all[j], all[i]];
        }
      else all.sort((a, b) => ((a - this.state.index + tracks.length) % tracks.length) - ((b - this.state.index + tracks.length) % tracks.length));
      this.order = all;
    }
    return this.order.shift()!;
  }

  private async load(index: number, autoplay: boolean) {
    const a = this.element();
    const track = tracks[index];
    if (!track) return;
    this.set({ index, loading: true, error: "", time: 0, duration: 0 });
    const src = await this.source(track);
    if (this.state.index !== index) return;
    a.src = src;
    this.set({ loading: false });
    if (autoplay) await this.resume();
  }

  /** Çalmaya başlar; tarayıcı otomatik çalmayı engellerse ilk tıklamada başlar. */
  async resume() {
    if (!tracks.length) return;
    const a = this.element();
    if (!a.src) return this.load(this.state.index, true);
    this.graph();
    void this.ctx?.resume().catch(() => {});
    this.gain = 0;
    this.applyVolume();
    try {
      await a.play();
    } catch (e) {
      if ((e as DOMException)?.name === "NotAllowedError") return this.waitForGesture();
      this.set({ error: msg("Parça çalınamadı."), playing: false });
      return;
    }
    this.suspendedByGame = false;
    this.set({ playing: true, error: "" });
    await this.ramp(1);
  }

  private waitForGesture() {
    if (this.pendingGesture) return;
    const go = (e: Event) => {
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
      this.pendingGesture = null;
      // Çaların kendi düğmeleri kendi işini yapar; otomatik başlatma iptal edilir.
      if ((e.target as Element | null)?.closest?.(".music-player,.window-music")) return;
      void this.resume();
    };
    this.pendingGesture = go;
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
  }

  async pause(fade = true) {
    if (this.pendingGesture) {
      window.removeEventListener("pointerdown", this.pendingGesture, true);
      window.removeEventListener("keydown", this.pendingGesture, true);
      this.pendingGesture = null;
    }
    if (!this.audio || this.audio.paused) return this.set({ playing: false });
    this.set({ playing: false });
    await this.ramp(0, fade ? FADE_MS : 0);
    if (!this.state.playing) this.audio.pause();
  }

  toggle() {
    if (this.state.playing) return this.pause();
    this.onUserStart?.();
    return this.resume();
  }

  clearError() {
    if (this.state.error) this.set({ error: "" });
  }

  async play(index: number) {
    this.onUserStart?.();
    if (index === this.state.index && this.audio?.src) return this.resume();
    if (this.state.playing) await this.ramp(0, 350);
    this.history.push(this.state.index);
    this.order = this.order.filter((i) => i !== index);
    await this.load(index, true);
  }

  async next(auto = false) {
    if (!tracks.length) return;
    const wasPlaying = this.state.playing || auto;
    if (this.state.playing && !auto) await this.ramp(0, 350);
    this.history.push(this.state.index);
    if (this.history.length > 50) this.history.shift();
    await this.load(this.upcoming(), wasPlaying);
  }

  async previous() {
    if (!tracks.length) return;
    const a = this.audio;
    // İlk saniyelerden sonra "önceki" parçanın başına döner.
    if (a && a.currentTime > 4) {
      a.currentTime = 0;
      return;
    }
    const prev = this.history.pop();
    const index = prev ?? (this.state.index - 1 + tracks.length) % tracks.length;
    const wasPlaying = this.state.playing;
    if (wasPlaying) await this.ramp(0, 350);
    this.order.unshift(this.state.index);
    await this.load(index, wasPlaying);
  }

  seek(seconds: number) {
    if (this.audio && Number.isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.state.duration || seconds));
      this.set({ time: this.audio.currentTime });
    }
  }

  /** Oyun açılınca duraklat, kapanınca devam et. */
  gameRunning(running: boolean) {
    if (running && this.state.playing) {
      this.suspendedByGame = true;
      void this.pause();
    } else if (!running && this.suspendedByGame) {
      this.suspendedByGame = false;
      void this.resume();
    }
  }

  stop() {
    void this.pause(false);
  }
}

export const music = new MusicEngine();
export const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
