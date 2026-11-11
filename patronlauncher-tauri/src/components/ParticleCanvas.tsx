import { useEffect, useRef, type RefObject } from "react";
import type { Parallax } from "./Hero";
import { useAppearance } from "../appearance";
export default function ParticleCanvas({
  page,
  running,
}: {
  parallax: RefObject<Parallax>;
  page: string;
  running: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    scene = useRef({ page, burst: 0 });
  const { prefs } = useAppearance();
  const custom = prefs.skin === "custom" ? prefs.custom_theme : null;
  // Özel temada renk ve hız her karede okunur; yoğunluk değişince parçacıklar yeniden kurulur.
  const look = useRef(custom);
  look.current = custom;
  const count = custom ? Math.round((custom.particle_density / 100) * 140) : 70;
  useEffect(() => {
    scene.current = { page, burst: performance.now() + 420 };
  }, [page]);
  useEffect(() => {
    const cv = ref.current!,
      ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = innerWidth,
      h = innerHeight,
      dpr = Math.min(devicePixelRatio || 1, 1.5),
      frame = 0,
      last = 0,
      drawn = 0,
      focused = document.hasFocus();
    const media = matchMedia("(prefers-reduced-motion:reduce)");
    const pts = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 1 + Math.random() * 1.5,
      v: 8 + Math.random() * 17,
      phase: Math.random() * 6.28,
      alpha: 0.15 + Math.random() * 0.3,
    }));
    const allowed = () =>
      prefs.particles &&
      prefs.animations &&
      !running &&
      !document.hidden &&
      focused &&
      !media.matches;
    function size() {
      w = innerWidth;
      h = innerHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw(t: number) {
      frame = 0;
      if (!allowed()) return;
      frame = requestAnimationFrame(draw);
      if (t - drawn < 32) return;
      drawn = t;
      const dt = Math.min((t - last) / 1000 || 0.033, 0.06);
      last = t;
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle =
        look.current?.particle_color ??
        getComputedStyle(document.documentElement).getPropertyValue("--c").trim();
      const mods = scene.current.page === "mods",
        speed =
          (mods ? 2.1 : 1) *
          (t < scene.current.burst ? 4 : 1) *
          ((look.current?.particle_speed ?? 100) / 100);
      for (const p of pts) {
        p.y -= p.v * speed * dt;
        p.x += Math.sin(t / 1800 + p.phase) * 5 * dt;
        if (p.y < -5) {
          p.y = h + 5;
          p.x = Math.random() * w;
        }
        ctx!.globalAlpha = p.alpha;
        ctx!.beginPath();
        if (mods) ctx!.rect(p.x, p.y, p.r, 3 * p.r);
        else ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }
    function sync() {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      if (allowed()) frame = requestAnimationFrame(draw);
      else ctx!.clearRect(0, 0, w, h);
    }
    const focus = () => {
        focused = true;
        sync();
      },
      blur = () => {
        focused = false;
        sync();
      };
    size();
    sync();
    addEventListener("resize", size);
    addEventListener("focus", focus);
    addEventListener("blur", blur);
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", size);
      removeEventListener("focus", focus);
      removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", sync);
      media.removeEventListener("change", sync);
    };
  }, [prefs.particles, prefs.animations, prefs.skin, running, count]);
  return <canvas id="fx" ref={ref} aria-hidden="true" />;
}
