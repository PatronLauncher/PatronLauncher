import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { useAppearance, type MusicPrefs } from "../appearance";
import { formatTime, music, noTrack, tracks } from "../music";
import { spotifyGuard } from "../spotify";
import Icon from "./Icon";
import { Toggle } from "./Controls";

export const useMusic = () => useSyncExternalStore(music.subscribe, music.getState);
const useSpotify = () => useSyncExternalStore(spotifyGuard.subscribe, spotifyGuard.getSnapshot);

/** Çalardaki hata satırı; çarpıyla kapatılır. */
function MusicError({ text, close }: { text: string; close: () => void }) {
  return (
    <p role="alert" className="mp-error">
      <span>{text}</span>
      <button className="alert-close" aria-label={t("Kapat")} title={t("Kapat")} onClick={close}>
        <Icon name="close" />
      </button>
    </p>
  );
}

/** Launcher müziği Spotify yüzünden durunca nedenini anlatan küçük bildirim. */
function MusicNotice() {
  const { notice } = useSpotify();
  const id = notice?.id;
  useEffect(() => {
    if (id === undefined) return;
    const timer = setTimeout(() => spotifyGuard.dismissNotice(), 8000);
    return () => clearTimeout(timer);
  }, [id]);
  if (!notice) return null;
  return (
    <div className="music-notice" role="status" key={notice.id}>
      <span className="spotify-logo" aria-hidden="true" />
      <p>
        {notice.reason === "changed"
          ? t("Spotify'da başka bir şarkıya geçtiğin için launcher müziği durduruldu.")
          : t("Spotify'da müzik çaldığı için launcher müziği durduruldu.")}
      </p>
      <button className="alert-close" aria-label={t("Kapat")} title={t("Kapat")} onClick={() => spotifyGuard.dismissNotice()}>
        <Icon name="close" />
      </button>
    </div>
  );
}

interface SpotifyStatus {
  connected: boolean;
  name: string | null;
  redirect_uri: string;
}
/** Müzik tercihlerini güncelleyen kısa yol. */
export function useMusicPrefs() {
  const { prefs, update } = useAppearance();
  const m = prefs.music;
  return [m, (p: Partial<MusicPrefs>) => update({ music: { ...m, ...p } })] as const;
}

/** Çalan parçanın frekanslarını çubuk olarak çizer. */
function Visualizer({ active, hue }: { active: boolean; hue: [number, number] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { prefs } = useAppearance();
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    let frame = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const bins = new Uint8Array(64);
    const draw = () => {
      const w = (c.width = c.clientWidth * devicePixelRatio),
        h = (c.height = c.clientHeight * devicePixelRatio);
      g.clearRect(0, 0, w, h);
      const analyser = music.analyser;
      if (analyser && active) analyser.getByteFrequencyData(bins);
      else bins.fill(0);
      const count = 28,
        gap = w / count;
      for (let i = 0; i < count; i++) {
        const v = Math.max(0.04, (bins[Math.floor((i / count) * 48)] / 255) * 0.95);
        const bh = v * h,
          x = i * gap + gap * 0.18;
        const grad = g.createLinearGradient(0, h, 0, h - bh);
        grad.addColorStop(0, `hsla(${hue[0]},90%,60%,.85)`);
        grad.addColorStop(1, `hsla(${hue[1]},95%,70%,.95)`);
        g.fillStyle = grad;
        g.beginPath();
        g.roundRect(x, h - bh, gap * 0.64, bh, 3 * devicePixelRatio);
        g.fill();
      }
    };
    // Yalnızca çalarken ve pencere öndeyken canlandırılır; oyun açıkken çizim yapılmaz.
    const loop = () => {
      const root = document.documentElement.dataset;
      if (root.focused === "false" || root.running === "true") {
        timer = setTimeout(loop, 300);
        return;
      }
      draw();
      frame = requestAnimationFrame(loop);
    };
    draw();
    if (active && prefs.animations) frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [active, hue, prefs.animations]);
  return <canvas ref={canvas} className="mp-visualizer" aria-hidden="true" />;
}

function Seek({
  value,
  max,
  onSeek,
  disabled,
  label,
}: {
  value: number;
  max: number;
  onSeek: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  return (
    <div className="mp-seek">
      <input
        type="range"
        min={0}
        max={Math.max(1, max)}
        step={0.5}
        value={Math.min(shown, max || 1)}
        disabled={disabled || !max}
        aria-label={label}
        style={{ "--fill": `${max ? (Math.min(shown, max) / max) * 100 : 0}%` } as CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) onSeek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null) onSeek(drag);
          setDrag(null);
        }}
      />
      <span>
        <time>{formatTime(shown)}</time>
        <time>{formatTime(max)}</time>
      </span>
    </div>
  );
}

function Volume({
  value,
  muted,
  onChange,
  onMute,
}: {
  value: number;
  muted: boolean;
  onChange: (v: number) => void;
  onMute?: () => void;
}) {
  const shown = muted ? 0 : value;
  return (
    <div className="mp-volume">
      <button
        className="mp-icon"
        aria-label={muted ? t("Sesi aç") : t("Sesi kapat")}
        title={muted ? t("Sesi aç") : t("Sesi kapat")}
        onClick={onMute}
        disabled={!onMute}
      >
        <Icon name={muted || value === 0 ? "mute" : "volume"} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={shown}
        aria-label={t("Ses düzeyi")}
        style={{ "--fill": `${shown}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{shown}%</output>
    </div>
  );
}

function LauncherTab() {
  const s = useMusic();
  const [m, set] = useMusicPrefs();
  const [list, setList] = useState(false);
  const track = tracks[s.index] ?? noTrack;
  if (!tracks.length)
    return (
      <div className="mp-body">
        <div className="mp-meta">
          <strong className="mp-title">{t("Launcher müzikleri yakında")}</strong>
          <small>{t("Şimdilik müziğini Spotify sekmesinden bağlayıp çalabilirsin.")}</small>
        </div>
      </div>
    );
  return (
    <div className="mp-body">
      <div
        className={"mp-cover " + (s.playing ? "spinning" : "")}
        style={{ "--h1": track.hue[0], "--h2": track.hue[1] } as CSSProperties}
      >
        <Visualizer active={s.playing} hue={track.hue} />
        <div className="mp-disc" aria-hidden="true">
          <i />
        </div>
      </div>
      <div className="mp-meta">
        <strong className="mp-title" key={track.id}>
          {track.title}
        </strong>
        <small>
          PatronLauncher Radio · {s.index + 1}/{tracks.length}
          {s.loading ? " · " + t("Yükleniyor…") : ""}
        </small>
      </div>
      <Seek
        value={s.time}
        max={s.duration}
        onSeek={(v) => music.seek(v)}
        label={t("Parça konumu")}
      />
      <div className="mp-controls">
        <button
          className={"mp-icon " + (m.shuffle ? "on" : "")}
          aria-pressed={m.shuffle}
          aria-label={t("Karışık çal")}
          title={t("Karışık çal")}
          onClick={() => set({ shuffle: !m.shuffle })}
        >
          <Icon name="shuffle" />
        </button>
        <button className="mp-icon" aria-label={t("Önceki parça")} title={t("Önceki parça")} onClick={() => void music.previous()}>
          <Icon name="prev" />
        </button>
        <button
          className="mp-play"
          aria-label={s.playing ? t("Duraklat") : t("Oynat")}
          title={s.playing ? t("Duraklat") : t("Oynat")}
          onClick={() => void music.toggle()}
        >
          <Icon name={s.playing ? "pause" : "play"} />
        </button>
        <button className="mp-icon" aria-label={t("Sonraki parça")} title={t("Sonraki parça")} onClick={() => void music.next()}>
          <Icon name="next" />
        </button>
        <button
          className={"mp-icon " + (m.repeat === "one" ? "on" : "")}
          aria-pressed={m.repeat === "one"}
          aria-label={t("Parçayı tekrarla")}
          title={t("Parçayı tekrarla")}
          onClick={() => set({ repeat: m.repeat === "one" ? "all" : "one" })}
        >
          <Icon name="repeat" />
          {m.repeat === "one" && <b className="mp-one">1</b>}
        </button>
      </div>
      <Volume
        value={m.volume}
        muted={m.muted}
        onChange={(volume) => set({ volume, muted: false })}
        onMute={() => set({ muted: !m.muted })}
      />
      <button className="mp-list-toggle" aria-expanded={list} onClick={() => setList(!list)}>
        <Icon name="list" />
        {t("Çalma listesi")}
        <span className="mp-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {list && (
        <ol className="mp-list">
          {tracks.map((tr, i) => (
            <li key={tr.id}>
              <button
                className={i === s.index ? "current" : ""}
                aria-current={i === s.index}
                onClick={() => void music.play(i)}
                style={{ "--h1": tr.hue[0], "--h2": tr.hue[1] } as CSSProperties}
              >
                <i className="mp-swatch" aria-hidden="true" />
                <span>{tr.title}</span>
                {i === s.index && s.playing ? (
                  <span className="mp-eq" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <small>{i + 1}</small>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
      {s.error && <MusicError text={t(s.error)} close={() => music.clearError()} />}
    </div>
  );
}

function SpotifyArt({ src }: { src: string | null }) {
  const [data, setData] = useState("");
  useEffect(() => {
    setData("");
    if (!src) return;
    let alive = true;
    void invoke<{ mime: string; data: string }>("mods_fetch_image", { url: src })
      .then((img) => alive && img && setData(`data:${img.mime};base64,${img.data}`))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src]);
  return (
    <div className="mp-art">
      {data ? <img src={data} alt="" /> : <span className="spotify-logo" aria-hidden="true" />}
    </div>
  );
}

function SpotifyTab({ visible }: { visible: boolean }) {
  const [status, setStatus] = useState<SpotifyStatus | null | undefined>(undefined);
  const { now, syncedAt, error: pollError } = useSpotify();
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  const error = actionError || pollError;
  const clearError = () => {
    setError("");
    spotifyGuard.clearError();
  };
  const [tick, setTick] = useState(0);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [volume, setVolume] = useState<number | null>(null);
  const refreshStatus = () =>
    invoke<SpotifyStatus | undefined>("spotify_status")
      .then((s) => setStatus(s ?? { connected: false, name: null, redirect_uri: "" }))
      .catch((e) => {
        setStatus({ connected: false, name: null, redirect_uri: "" });
        setError(String(e));
      });
  useEffect(() => {
    void refreshStatus();
  }, []);
  // Yoklama spotifyGuard'dadır; burada yalnızca ilerleme çubuğu akıtılır.
  useEffect(() => {
    if (!visible || !status?.connected) return;
    const tickId = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(tickId);
  }, [visible, status?.connected]);
  const act = async (action: string, value?: number) => {
    setError("");
    try {
      if (action === "play") spotifyGuard.yieldToSpotify();
      await invoke("spotify_control", { action, value: value ?? null });
      setTimeout(() => void spotifyGuard.poll(), 350);
    } catch (e) {
      setError(String(e));
    }
  };
  if (status === undefined) return <p className="mp-note">{t("Spotify kontrol ediliyor…")}</p>;
  if (!status?.connected)
    return (
      <div className="mp-body mp-spotify-connect">
        <span className="spotify-logo big" aria-hidden="true" />
        <strong>{t("Spotify hesabını bağla")}</strong>
        <p className="mp-note">
          {t("Çalan şarkıyı launcher içinde gör ve yönet.")}
        </p>
        <button
          className="btn primary mp-spotify-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await invoke("spotify_login");
              await refreshStatus();
              await spotifyGuard.refresh();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t("Tarayıcıda izin ver…") : t("Spotify ile bağlan")}
        </button>
        {error && <MusicError text={error} close={clearError} />}
      </div>
    );
  const progress = now
    ? Math.min(now.duration_ms, now.progress_ms + (now.is_playing ? performance.now() - syncedAt : 0)) / 1000
    : 0;
  void tick;
  return (
    <div className="mp-body">
      {now ? (
        <>
          <div className="mp-spotify-now">
            <SpotifyArt src={now.image} />
            <div className="mp-meta">
              <strong className="mp-title">{now.title}</strong>
              <small>{now.artists}</small>
              {now.device && (
                <small className="mp-device">
                  <Icon name="monitor" /> {now.device}
                </small>
              )}
            </div>
          </div>
          <Seek
            value={progress}
            max={now.duration_ms / 1000}
            onSeek={(v) => void act("seek", Math.round(v * 1000))}
            label={t("Parça konumu")}
          />
          <div className="mp-controls">
            <button
              className={"mp-icon " + (now.shuffle ? "on" : "")}
              aria-pressed={now.shuffle}
              aria-label={t("Karışık çal")}
              title={t("Karışık çal")}
              onClick={() => void act("shuffle", now.shuffle ? 0 : 1)}
            >
              <Icon name="shuffle" />
            </button>
            <button className="mp-icon" aria-label={t("Önceki parça")} onClick={() => void act("previous")}>
              <Icon name="prev" />
            </button>
            <button
              className="mp-play spotify"
              aria-label={now.is_playing ? t("Duraklat") : t("Oynat")}
              onClick={() => void act(now.is_playing ? "pause" : "play")}
            >
              <Icon name={now.is_playing ? "pause" : "play"} />
            </button>
            <button className="mp-icon" aria-label={t("Sonraki parça")} onClick={() => void act("next")}>
              <Icon name="next" />
            </button>
            <button
              className="mp-icon"
              aria-label={t("Spotify'da aç")}
              title={t("Spotify'da aç")}
              disabled={!now.url}
              onClick={() => now.url && void invoke("open_external", { url: now.url }).catch((e) => setError(String(e)))}
            >
              <Icon name="globe" />
            </button>
          </div>
          {now.volume !== null && (
            <Volume
              value={volume ?? now.volume}
              muted={false}
              onChange={(v) => {
                setVolume(v);
                clearTimeout(volumeTimer.current);
                volumeTimer.current = setTimeout(() => {
                  void act("volume", v).finally(() => setVolume(null));
                }, 350);
              }}
            />
          )}
        </>
      ) : (
        <p className="mp-note">{t("Şu an Spotify'da bir şey çalmıyor. Spotify uygulamasını açıp bir şarkı başlat.")}</p>
      )}
      <div className="mp-spotify-foot">
        <small>
          <span className="spotify-logo" aria-hidden="true" /> {status.name ?? "Spotify"}
        </small>
        <button
          className="mp-link"
          onClick={async () => {
            await invoke("spotify_logout").catch(() => {});
            await refreshStatus();
            await spotifyGuard.refresh();
          }}
        >
          {t("Bağlantıyı kes")}
        </button>
      </div>
      {error && <MusicError text={error} close={clearError} />}
    </div>
  );
}

type Offset = { x: number; y: number };
const POS_KEY = "patron-music-offset";
function readOffset(): Offset {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v;
  } catch {
    /* tarayıcı depolaması kapalı */
  }
  return { x: 0, y: 0 };
}
/** Pencereyi başlığından sürükleyerek taşıma; konum bu cihazda hatırlanır. */
function useDrag() {
  const [offset, setOffset] = useState<Offset>(readOffset);
  const ref = useRef<HTMLElement>(null);
  const clamp = (o: Offset) => {
    const el = ref.current,
      host = el?.offsetParent as HTMLElement | null;
    if (!el || !host) return o;
    // Varsayılan konum sağ üst; ofset sola (negatif x) ve aşağı (pozitif y) taşır.
    const baseRight = host.clientWidth - (el.offsetLeft + el.offsetWidth),
      baseTop = el.offsetTop;
    return {
      x: Math.min(baseRight - 6, Math.max(o.x, -(el.offsetLeft - 6))),
      y: Math.max(-(baseTop - 6), Math.min(o.y, host.clientHeight - el.offsetHeight - baseTop - 6)),
    };
  };
  useEffect(() => {
    const fit = () => setOffset((o) => clamp(o));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button,input")) return;
    const start = { x: e.clientX, y: e.clientY },
      from = offset;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    ref.current?.classList.add("dragging");
    let last = from;
    const move = (ev: PointerEvent) => {
      last = clamp({ x: from.x + ev.clientX - start.x, y: from.y + ev.clientY - start.y });
      setOffset(last);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      ref.current?.classList.remove("dragging");
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(last));
      } catch {
        /* yok say */
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  const reset = () => {
    setOffset({ x: 0, y: 0 });
    try {
      localStorage.removeItem(POS_KEY);
    } catch {
      /* yok say */
    }
  };
  return { ref, offset, onPointerDown, reset };
}

/** Sağ üstte duran, kapatılabilir ve küçültülebilir müzik çalar penceresi. */
export default function MusicPlayer({ running }: { running: boolean }) {
  const [m, set] = useMusicPrefs();
  const drag = useDrag();
  const place = { translate: `${drag.offset.x}px ${drag.offset.y}px` } as CSSProperties;
  const s = useMusic();
  const track = tracks[s.index] ?? noTrack;
  const started = useRef(false);
  useEffect(() => {
    music.configure(m);
  }, [m.volume, m.muted, m.shuffle, m.repeat]);
  // Otomatik başlatma: tercih dosyası okunduktan sonra kısa bir gecikmeyle.
  useEffect(() => {
    const id = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      if (m.autoplay && m.source === "launcher" && !running) void spotifyGuard.startUnlessPlaying(() => void music.resume());
    }, 900);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    spotifyGuard.start();
    return () => spotifyGuard.stop();
  }, []);
  useEffect(() => {
    spotifyGuard.setBlocked(running && m.pause_in_game);
    if (!m.pause_in_game) return;
    if (running) music.gameRunning(true);
    else if (music.suspendedByGame) void spotifyGuard.startUnlessPlaying(() => music.gameRunning(false));
  }, [running, m.pause_in_game]);
  useEffect(() => () => music.stop(), []);
  if (!m.widget) return <MusicNotice />;
  const close = (
    <button
      className="mp-icon mp-close"
      aria-label={t("Müzik çaları kapat")}
      title={t("Müzik çaları kapat")}
      onClick={() => set({ widget: false })}
    >
      <Icon name="close" />
    </button>
  );
  if (m.compact)
    return (
      <>
      <MusicNotice />
      <aside
        ref={drag.ref}
        className={"music-player compact " + (s.playing ? "playing" : "")}
        aria-label={t("Müzik çalar")}
        style={{ ...place, "--h1": track.hue[0], "--h2": track.hue[1] } as CSSProperties}
        onPointerDown={drag.onPointerDown}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && drag.reset()}
      >
        <button className="mp-mini-disc" aria-label={t("Müzik çaları genişlet")} onClick={() => set({ compact: false })}>
          <i />
        </button>
        <span className="mp-mini-title">
          <b>{m.source === "spotify" ? "Spotify" : track.title || "PatronLauncher"}</b>
          <small>{m.source === "spotify" ? t("Spotify") : "PatronLauncher Radio"}</small>
        </span>
        {m.source === "launcher" && (
          <>
            <button
              className="mp-icon"
              aria-label={s.playing ? t("Duraklat") : t("Oynat")}
              onClick={() => void music.toggle()}
            >
              <Icon name={s.playing ? "pause" : "play"} />
            </button>
            <button className="mp-icon" aria-label={t("Sonraki parça")} onClick={() => void music.next()}>
              <Icon name="next" />
            </button>
          </>
        )}
        <button
          className="mp-icon"
          aria-label={t("Müzik çaları genişlet")}
          title={t("Müzik çaları genişlet")}
          onClick={() => set({ compact: false })}
        >
          <Icon name="expand" />
        </button>
        {close}
      </aside>
      </>
    );
  return (
    <>
    <MusicNotice />
    <aside
      ref={drag.ref}
      className={"music-player " + (s.playing ? "playing" : "") + (m.source === "spotify" ? " spotify" : "")}
      aria-label={t("Müzik çalar")}
      style={{ ...place, "--h1": track.hue[0], "--h2": track.hue[1] } as CSSProperties}
    >
      <header
        className="mp-head"
        title={t("Taşımak için sürükle, sıfırlamak için çift tıkla")}
        onPointerDown={drag.onPointerDown}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && drag.reset()}
      >
        <div className="mp-tabs" role="tablist" aria-label={t("Müzik kaynağı")}>
          <button
            role="tab"
            aria-selected={m.source === "launcher"}
            className={m.source === "launcher" ? "active" : ""}
            onClick={() => set({ source: "launcher" })}
          >
            <Icon name="music" /> {t("Launcher")}
          </button>
          <button
            role="tab"
            aria-selected={m.source === "spotify"}
            className={m.source === "spotify" ? "active" : ""}
            onClick={() => set({ source: "spotify" })}
          >
            <span className="spotify-logo" aria-hidden="true" /> Spotify
          </button>
        </div>
        <button
          className="mp-icon"
          aria-label={t("Müzik çaları küçült")}
          title={t("Müzik çaları küçült")}
          onClick={() => set({ compact: true })}
        >
          <Icon name="collapse" />
        </button>
        {close}
      </header>
      {m.source === "launcher" ? <LauncherTab /> : <SpotifyTab visible />}
    </aside>
    </>
  );
}

/** Başlık çubuğundaki müzik düğmesi: çaları açar/kapatır, çalarken dalgalanır. */
export function MusicToggle() {
  const [m, set] = useMusicPrefs();
  const s = useMusic();
  return (
    <button
      className={"window-music " + (s.playing ? "playing" : "") + (m.widget ? " open" : "")}
      aria-label={m.widget ? t("Müzik çaları kapat") : t("Müzik çaları aç")}
      title={m.widget ? t("Müzik çaları kapat") : t("Müzik çaları aç")}
      aria-pressed={m.widget}
      onClick={() => set({ widget: !m.widget, compact: false })}
    >
      <Icon name="music" />
      <span className="mp-eq" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </button>
  );
}

/** Ayarlar › Genel içindeki müzik çalar seçenekleri. */
export function MusicSettings() {
  const [m, set] = useMusicPrefs();
  const rows: [keyof MusicPrefs, string, string][] = [
    ["widget", t("Müzik çaları göster"), t("Sağ üstteki çalar penceresi. Başlık çubuğundaki nota simgesiyle de açılıp kapanır.")],
    ["autoplay", t("Açılışta müziği başlat"), t("Launcher açıldığında parçalar rastgele sırayla çalmaya başlar.")],
    ["pause_in_game", t("Oyun açıkken duraklat"), t("Minecraft başlayınca müzik yavaşça susar, oyun kapanınca kaldığı yerden devam eder.")],
    ["shuffle", t("Karışık çal"), t("Kapalıyken parçalar liste sırasıyla çalar.")],
  ];
  return (
    <section className="music-settings">
      {rows.map(([key, label, hint]) => (
        <label className="appearance-switch" key={key}>
          <span>
            {label}
            <small className="lbl">{hint}</small>
          </span>
          <Toggle
            role="switch"
            checked={m[key] as boolean}
            onChange={(e) => set({ [key]: e.target.checked })}
          />
        </label>
      ))}
      <Volume
        value={m.volume}
        muted={m.muted}
        onChange={(volume) => set({ volume, muted: false })}
        onMute={() => set({ muted: !m.muted })}
      />
    </section>
  );
}
