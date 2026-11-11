// Ambiyans sesleri tamamen Web Audio API ile cihazda üretilir: hiçbir ses dosyası
// indirilmez veya paketlenmez, bu yüzden lisans gerektirmez.
export type AmbienceLayer = "rain" | "wind" | "birds" | "fire";
export type AmbienceSettings = {
  volume: number;
  looped: boolean;
} & Record<AmbienceLayer, number>;

export const ambienceLayers: AmbienceLayer[] = ["rain", "wind", "birds", "fire"];
/** Döngü kapalıyken sesin kendiliğinden kapanacağı süre. */
export const ONE_SHOT_MS = 3 * 60_000;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers = new Map<AmbienceLayer, GainNode>();
  private stops: (() => void)[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private oneShot: ReturnType<typeof setTimeout> | null = null;
  private settings: AmbienceSettings = {
    volume: 50,
    looped: true,
    rain: 60,
    wind: 25,
    birds: 40,
    fire: 0,
  };
  private listeners = new Set<() => void>();
  playing = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private noise(ctx: AudioContext, brown: boolean) {
    const length = ctx.sampleRate * 4,
      buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.5;
        } else data[i] = white;
      }
    }
    return buffer;
  }

  private later(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.playing) fn();
    }, ms);
    this.timers.add(id);
  }

  private build(ctx: AudioContext, out: GainNode) {
    const white = this.noise(ctx, false),
      brown = this.noise(ctx, true);
    const loop = (buffer: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.start(0, rnd(0, 3));
      this.stops.push(() => src.stop());
      return src;
    };
    const layer = (name: AmbienceLayer) => {
      const g = ctx.createGain();
      g.gain.value = this.settings[name] / 100;
      g.connect(out);
      this.layers.set(name, g);
      return g;
    };
    const lfo = (freq: number, depth: number, target: AudioParam) => {
      const o = ctx.createOscillator(),
        d = ctx.createGain();
      o.frequency.value = freq;
      d.gain.value = depth;
      o.connect(d).connect(target);
      o.start();
      this.stops.push(() => o.stop());
    };
    // Kısa, filtrelenmiş gürültü patlaması: yağmur damlası ve ateş çıtırtısı.
    const burst = (
      dest: AudioNode,
      type: BiquadFilterType,
      freq: number,
      q: number,
      peak: number,
      length: number,
    ) => {
      const src = ctx.createBufferSource(),
        f = ctx.createBiquadFilter(),
        g = ctx.createGain(),
        pan = ctx.createStereoPanner(),
        t = ctx.currentTime;
      src.buffer = white;
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      pan.pan.value = rnd(-0.8, 0.8);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + length);
      src.connect(f).connect(g).connect(pan).connect(dest);
      src.start(t, rnd(0, 3), length + 0.05);
    };

    // Yağmur: yumuşatılmış beyaz gürültü + rastgele damlalar.
    const rain = layer("rain");
    {
      const hp = ctx.createBiquadFilter(),
        lp = ctx.createBiquadFilter(),
        g = ctx.createGain();
      hp.type = "highpass";
      hp.frequency.value = 450;
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      g.gain.value = 0.22;
      loop(white).connect(hp).connect(lp).connect(g).connect(rain);
      lfo(0.13, 0.05, g.gain);
      const drop = () => {
        if (this.settings.rain > 0)
          burst(rain, "bandpass", rnd(1800, 6500), 4, rnd(0.08, 0.35), rnd(0.02, 0.05));
        this.later(drop, rnd(25, 140));
      };
      drop();
    }

    // Rüzgâr: kahverengi gürültü, süpürülen bant geçiren filtre.
    const wind = layer("wind");
    {
      const bp = ctx.createBiquadFilter(),
        g = ctx.createGain();
      bp.type = "bandpass";
      bp.frequency.value = 520;
      bp.Q.value = 0.9;
      g.gain.value = 0.9;
      loop(brown).connect(bp).connect(g).connect(wind);
      lfo(0.07, 300, bp.frequency);
      lfo(0.11, 0.45, g.gain);
    }

    // Ateş: alçak uğultu + çıtırtılar.
    const fire = layer("fire");
    {
      const lp = ctx.createBiquadFilter(),
        g = ctx.createGain();
      lp.type = "lowpass";
      lp.frequency.value = 380;
      g.gain.value = 0.9;
      loop(brown).connect(lp).connect(g).connect(fire);
      lfo(0.4, 0.2, g.gain);
      const crackle = () => {
        if (this.settings.fire > 0) {
          burst(fire, "highpass", rnd(1200, 3200), 1, rnd(0.15, 0.7), rnd(0.006, 0.02));
          if (Math.random() < 0.3)
            burst(fire, "bandpass", rnd(600, 1200), 2, rnd(0.2, 0.5), rnd(0.03, 0.08));
        }
        this.later(crackle, Math.random() < 0.2 ? rnd(15, 60) : rnd(80, 450));
      };
      crackle();
    }

    // Kuşlar: frekansı kayan sinüs notalarından oluşan cıvıltı öbekleri.
    const birds = layer("birds");
    {
      const phrase = () => {
        if (this.settings.birds > 0) {
          const pan = ctx.createStereoPanner(),
            base = rnd(2300, 4300),
            notes = Math.round(rnd(2, 7)),
            rise = Math.random() < 0.6;
          pan.pan.value = rnd(-0.75, 0.75);
          pan.connect(birds);
          let t = ctx.currentTime + 0.02;
          for (let i = 0; i < notes; i++) {
            const o = ctx.createOscillator(),
              g = ctx.createGain(),
              len = rnd(0.05, 0.13),
              f = base * rnd(0.9, 1.12);
            o.type = "sine";
            o.frequency.setValueAtTime(f, t);
            o.frequency.exponentialRampToValueAtTime(f * (rise ? rnd(1.25, 1.7) : rnd(0.6, 0.8)), t + len);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, t + len);
            o.connect(g).connect(pan);
            o.start(t);
            o.stop(t + len + 0.02);
            t += len + rnd(0.04, 0.12);
          }
        }
        this.later(phrase, rnd(1200, 5200));
      };
      this.later(phrase, 400);
    }
  }

  private target() {
    return (this.settings.volume / 100) * 0.7;
  }

  configure(next: AmbienceSettings) {
    const loopedChanged = next.looped !== this.settings.looped;
    this.settings = { ...next };
    if (!this.ctx || !this.playing) return;
    const now = this.ctx.currentTime;
    this.master!.gain.setTargetAtTime(this.target(), now, 0.15);
    for (const [name, g] of this.layers) g.gain.setTargetAtTime(next[name] / 100, now, 0.2);
    if (loopedChanged) this.armOneShot();
  }

  private armOneShot() {
    if (this.oneShot) clearTimeout(this.oneShot);
    this.oneShot = this.settings.looped ? null : setTimeout(() => this.stop(), ONE_SHOT_MS);
  }

  async play() {
    if (this.playing) return;
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) throw new Error("Web Audio unavailable");
    if (!this.ctx) this.ctx = new AC();
    const ctx = this.ctx!;
    await ctx.resume();
    this.playing = true;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(ctx.destination);
    this.build(ctx, this.master);
    this.master.gain.setTargetAtTime(this.target(), ctx.currentTime, 0.6);
    this.armOneShot();
    this.notify();
  }

  stop() {
    if (!this.playing || !this.ctx) return;
    this.playing = false;
    if (this.oneShot) clearTimeout(this.oneShot);
    this.oneShot = null;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    const ctx = this.ctx,
      master = this.master!,
      stops = this.stops;
    this.stops = [];
    this.layers.clear();
    master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
    setTimeout(() => {
      stops.forEach((s) => {
        try {
          s();
        } catch {
          /* zaten durmuş */
        }
      });
      master.disconnect();
    }, 2200);
    this.notify();
  }

  toggle() {
    return this.playing ? (this.stop(), Promise.resolve()) : this.play();
  }
}

export const ambience = new Engine();
