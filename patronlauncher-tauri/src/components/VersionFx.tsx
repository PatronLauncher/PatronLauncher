import { memo, useEffect, useRef, type CSSProperties } from "react";
import { useAppearance } from "../appearance";
import { versionEffect, type Emitter, type VersionEffect } from "../versionEffects";
import "../styles/version-fx.css";

/** Bir partikül noktası CSS'te 2 piksele denk gelir; böylece iri ve keskin görünür. */
const PIXEL = 2;
const MAX_PARTICLES = 70;

interface Particle {
  emitter: Emitter;
  sprite: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  phase: number;
}

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

function spawn(emitter: Emitter, w: number, h: number): Particle {
  const speed = between(emitter.speed);
  let x = Math.random() * w,
    y = Math.random() * h,
    vx = 0,
    vy = 0;
  switch (emitter.motion) {
    case "rise":
      y = h + 4;
      vy = -speed;
      break;
    case "fall":
      y = -8;
      vy = speed;
      break;
    case "drift":
      x = -12;
      vx = speed;
      break;
    case "float":
      vy = -speed;
      break;
    case "burst": {
      const angle = Math.random() * Math.PI * 2;
      x = w / 2;
      y = h * 0.55;
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
      break;
    }
    case "ring":
      x = w * (0.3 + Math.random() * 0.4);
      y = h * (0.45 + Math.random() * 0.35);
      vx = speed;
      break;
  }
  return { emitter, sprite: Math.floor(Math.random() * emitter.sprites.length), x, y, vx, vy, age: 0, life: between(emitter.life), phase: Math.random() * 6.28 };
}

function drawRing(ctx: CanvasRenderingContext2D, p: Particle, fade: number) {
  const radius = Math.round(p.age * p.vx);
  ctx.globalAlpha = fade;
  ctx.fillStyle = "#39e6da";
  const steps = Math.max(12, radius * 5);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ctx.fillRect(Math.round(p.x + Math.cos(a) * radius), Math.round(p.y + Math.sin(a) * radius), 1, 1);
  }
}

/** İmleç kartın üstündeyken çalışır; bırakılınca kalan partiküller sönene kadar sürer. */
function run(canvas: HTMLCanvasElement, effect: VersionEffect) {
  const ctx = canvas.getContext("2d")!;
  const particles: Particle[] = [];
  const debt = effect.emitters.map(() => 0);
  let last = performance.now(),
    frame = 0,
    spawning = true;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = canvas.width,
      h = canvas.height;
    if (spawning) {
      effect.emitters.forEach((emitter, i) => {
        debt[i] += emitter.rate * dt;
        for (; debt[i] >= 1; debt[i]--) if (particles.length < MAX_PARTICLES) particles.push(spawn(emitter, w, h));
      });
    }
    ctx.clearRect(0, 0, w, h);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, p.age / 0.15, (p.life - p.age) / 0.35);
      if (p.emitter.motion === "ring") {
        drawRing(ctx, p, fade);
        continue;
      }
      p.vy += (p.emitter.gravity ?? 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const sprite = p.emitter.sprites[p.sprite];
      const ox = Math.round(p.x + Math.sin(p.age * 3 + p.phase) * (p.emitter.sway ?? 0));
      const oy = Math.round(p.y);
      ctx.globalAlpha = fade;
      for (const [x, y, color] of sprite.cells) {
        ctx.fillStyle = color;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    if (spawning || particles.length) frame = requestAnimationFrame(tick);
    else canvas.remove();
  };
  frame = requestAnimationFrame(tick);
  return {
    stop: () => {
      spawning = false;
    },
    kill: () => {
      cancelAnimationFrame(frame);
      canvas.remove();
    },
  };
}

/** Kapağın üstüne sis, hareketli renk ve imleçle tetiklenen sürüme özel partiküller ekler. */
function VersionFx({ version }: { version: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const { prefs } = useAppearance();
  const effect = versionEffect(version);
  useEffect(() => {
    const el = host.current;
    const target = el?.closest<HTMLElement>("button, article") ?? el?.parentElement;
    if (!el || !target || !prefs.particles) return;
    let active: ReturnType<typeof run> | null = null;
    const all: ReturnType<typeof run>[] = [];
    const enter = () => {
      if (active || document.documentElement.dataset.motion === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const canvas = document.createElement("canvas");
      canvas.className = "vfx-canvas";
      canvas.width = Math.ceil(el.offsetWidth / PIXEL);
      canvas.height = Math.ceil(el.offsetHeight / PIXEL);
      el.appendChild(canvas);
      active = run(canvas, effect);
      all.push(active);
    };
    const leave = () => {
      active?.stop();
      active = null;
    };
    const events: [string, () => void][] = [
      ["pointerenter", enter],
      ["pointerleave", leave],
      ["focusin", enter],
      ["focusout", leave],
    ];
    events.forEach(([name, fn]) => target.addEventListener(name, fn));
    return () => {
      events.forEach(([name, fn]) => target.removeEventListener(name, fn));
      all.forEach((fx) => fx.kill());
    };
  }, [effect, prefs.particles]);
  return (
    <span
      ref={host}
      className="vfx"
      aria-hidden="true"
      style={{ "--vfx-a": effect.a, "--vfx-b": effect.b, "--vfx-fog": effect.fog } as CSSProperties}
    >
      <i className="vfx-tint" />
      <i className="vfx-fog" />
      <i className="vfx-fog late" />
    </span>
  );
}

export default memo(VersionFx);
