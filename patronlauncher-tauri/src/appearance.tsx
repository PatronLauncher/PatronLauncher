import { Toggle } from "./components/Controls";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import Modal from "./components/Modal";
import logo from "./assets/patronlauncher3transparent-mark.png";
import {
  detectLanguage,
  isLanguage,
  msg,
  setLanguage,
  t,
  type Language,
} from "./i18n";
import LanguageGrid from "./components/LanguageGrid";
import Portal from "./pclient/Portal";
import { ambience, ambienceLayers, type AmbienceLayer } from "./ambience";
import { useSyncExternalStore } from "react";
export interface CustomTheme {
  accent: string;
  accent2: string;
  background: string;
  particle_color: string;
  /** 0-100 */
  particle_density: number;
  /** 25-300 (yüzde) */
  particle_speed: number;
  /** 0-100 */
  glow: number;
}
export interface Ambience {
  volume: number;
  looped: boolean;
  rain: number;
  wind: number;
  birds: number;
  fire: number;
}
export interface MusicPrefs {
  volume: number;
  muted: boolean;
  autoplay: boolean;
  shuffle: boolean;
  repeat: "all" | "one";
  pause_in_game: boolean;
  widget: boolean;
  compact: boolean;
  source: "launcher" | "spotify";
}
export const musicDefaults: MusicPrefs = {
  volume: 5,
  muted: false,
  autoplay: true,
  shuffle: true,
  repeat: "all",
  pause_in_game: true,
  widget: true,
  compact: false,
  source: "launcher",
};
/** "launcher": klasik PatronLauncher arayüzü, "pclient": PClient arayüzü. */
export type UiMode = "launcher" | "pclient";
/** Açılışta hangi arayüz gelsin; "last": en son kullanılan. */
export type StartupUi = UiMode | "last";
export interface Appearance {
  skin: string;
  particles: boolean;
  animations: boolean;
  splash: boolean;
  collapsed?: boolean;
  discord_override?: string;
  /** null: dil henüz seçilmedi; ilk açılış seçim ekranı gösterilir. */
  language: Language | null;
  discord_language: Language;
  launch_behavior: "keep" | "minimize";
  restore_on_exit: boolean;
  home_on_launch: boolean;
  server_panel_collapsed: boolean;
  custom_theme: CustomTheme;
  ambience: Ambience;
  music: MusicPrefs;
  /** Son kullanılan arayüz. */
  ui_mode: UiMode;
  /** null: oyuncuya henüz sorulmadı (PClient'a ilk girişte sorulur). */
  startup_ui: StartupUi | null;
}
export const skins = [
  ["patron", msg("Patron Kırmızı")],
  ["mavi", msg("Gece Mavisi")],
  ["orman", msg("Orman")],
  ["mor", msg("Neon Mor")],
  ["amoled", msg("AMOLED")],
  ["custom", msg("Özel tema")],
] as const;
export const customThemeDefaults: CustomTheme = {
  accent: "#ff5a36",
  accent2: "#c2185b",
  background: "#0c0a12",
  particle_color: "#ffb454",
  particle_density: 50,
  particle_speed: 100,
  glow: 30,
};
const ambienceDefaults: Ambience = {
  volume: 50,
  looped: true,
  rain: 60,
  wind: 25,
  birds: 40,
  fire: 0,
};
/** Özel tema için hazır başlangıç paletleri. */
const themePresets: [string, Partial<CustomTheme>][] = [
  [msg("Gün batımı"), { accent: "#ff5a36", accent2: "#c2185b", background: "#0c0a12", particle_color: "#ffb454" }],
  [msg("Okyanus"), { accent: "#22d3ee", accent2: "#2563eb", background: "#06101a", particle_color: "#7dd3fc" }],
  [msg("Zehir"), { accent: "#a3e635", accent2: "#15803d", background: "#080d06", particle_color: "#d9f99d" }],
  [msg("Altın"), { accent: "#fbbf24", accent2: "#b45309", background: "#0f0c06", particle_color: "#fde68a" }],
  [msg("Şeker"), { accent: "#f472b6", accent2: "#8b5cf6", background: "#110a14", particle_color: "#f9a8d4" }],
];
const defaults: Appearance = {
  skin: "patron",
  particles: true,
  animations: true,
  splash: true,
  collapsed: false,
  language: null,
  discord_language: "en",
  launch_behavior: "keep",
  restore_on_exit: true,
  home_on_launch: true,
  server_panel_collapsed: false,
  custom_theme: customThemeDefaults,
  ambience: ambienceDefaults,
  music: musicDefaults,
  ui_mode: "launcher",
  startup_ui: null,
};
const isUiMode = (v: unknown): v is UiMode => v === "launcher" || v === "pclient";
/** Açılış tercihi sabit bir arayüz ise o arayüzle başlanır; aksi halde son kullanılan kalır. */
const withStartup = (p: Appearance): Appearance =>
  isUiMode(p.startup_ui) ? { ...p, ui_mode: p.startup_ui } : p;
const luminance = (color: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const within = (v: unknown, lo: number, hi: number) =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
/** Eski kayıtlarda olmayan alanlar varsayılanla tamamlanır; geçersiz kayıt reddedilir. */
function normalize(raw: any): Appearance | null {
  if (!raw || typeof raw !== "object" || typeof raw.skin !== "string") return null;
  const v = {
    ...defaults,
    ...raw,
    custom_theme: { ...customThemeDefaults, ...(raw.custom_theme ?? {}) },
    ambience: { ...ambienceDefaults, ...(raw.ambience ?? {}) },
    music: { ...musicDefaults, ...(raw.music ?? {}) },
  };
  const c = v.custom_theme,
    a = v.ambience,
    m = v.music;
  const ok =
    skins.some(([key]) => key === v.skin) &&
    [c.accent, c.accent2, c.background, c.particle_color].every(hex) &&
    within(c.particle_density, 0, 100) &&
    within(c.particle_speed, 25, 300) &&
    within(c.glow, 0, 100) &&
    [a.volume, a.rain, a.wind, a.birds, a.fire].every((x) => within(x, 0, 100)) &&
    typeof a.looped === "boolean" &&
    within(m.volume, 0, 100) &&
    (m.repeat === "all" || m.repeat === "one") &&
    (m.source === "launcher" || m.source === "spotify") &&
    ["muted", "autoplay", "shuffle", "pause_in_game", "widget", "compact"].every(
      (k) => typeof (m as any)[k] === "boolean",
    ) &&
    [
      "particles",
      "animations",
      "splash",
      "restore_on_exit",
      "home_on_launch",
      "server_panel_collapsed",
    ].every(
      (k) => typeof v[k] === "boolean",
    ) &&
    (v.language === null || isLanguage(v.language)) &&
    isLanguage(v.discord_language) &&
    (v.launch_behavior === "keep" || v.launch_behavior === "minimize") &&
    isUiMode(v.ui_mode) &&
    (v.startup_ui === null || isUiMode(v.startup_ui) || v.startup_ui === "last");
  return ok ? v : null;
}
export const appearanceDefaults = defaults;
const Context = createContext<{
  prefs: Appearance;
  update: (p: Partial<Appearance>) => void;
  open: () => void;
  preview: () => void;
  error: string;
  language: Language;
  /** Arayüzü geçiş animasyonuyla değiştirir; origin, animasyonun çıkış noktasıdır. */
  switchUi: (mode: UiMode, origin?: { x: number; y: number }) => void;
}>({
  prefs: defaults,
  update: () => {},
  open: () => {},
  preview: () => {},
  error: "",
  language: "tr",
  switchUi: () => {},
});
export const useAppearance = () => useContext(Context);
/** Tema kartları: her biri küçük, hareketli bir launcher önizlemesi gösterir. */
export function SkinPicker({ className = "skin-grid" }: { className?: string }) {
  const { prefs, update } = useAppearance();
  const c = prefs.custom_theme;
  return (
    <div className={className}>
      {skins.map(([skin, label]) => (
        <button
          className={"skin-choice " + (prefs.skin === skin ? "selected" : "")}
          data-swatch={skin}
          aria-pressed={prefs.skin === skin}
          key={skin}
          onClick={() => update({ skin })}
          style={
            skin === "custom"
              ? ({
                  "--sw-base": c.background,
                  "--sw-color": c.accent,
                  "--sw-color2": c.accent2,
                  "--sw-dot": c.particle_color,
                } as React.CSSProperties)
              : undefined
          }
        >
          <span className="skin-swatch" aria-hidden="true">
            <i className="sw-side" />
            <i className="sw-hero">
              <i className="sw-moon" />
            </i>
            <i className="sw-play" />
            <i className="sw-dots" />
          </span>
          <b>{t(label)}</b>
        </button>
      ))}
    </div>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "%",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="ui-range">
      <span>
        {label}
        <output>
          {value}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
/** Özel tema düzenleyicisi; yalnızca "Özel tema" seçiliyken gösterilir. */
export function CustomThemeEditor() {
  const { prefs, update } = useAppearance();
  if (prefs.skin !== "custom") return null;
  const c = prefs.custom_theme,
    set = (p: Partial<CustomTheme>) => update({ custom_theme: { ...c, ...p } });
  const colors: [keyof CustomTheme, string][] = [
    ["accent", msg("Vurgu rengi")],
    ["accent2", msg("İkinci renk (gradyan)")],
    ["background", msg("Arka plan tonu")],
    ["particle_color", msg("Parçacık rengi")],
  ];
  return (
    <section className="custom-theme" aria-label={t("Özel tema")}>
      <div className="custom-theme-preview" aria-hidden="true">
        <i />
      </div>
      <div className="custom-theme-presets" role="group" aria-label={t("Hazır paletler")}>
        {themePresets.map(([name, preset]) => (
          <button
            key={name}
            className="chip-btn"
            style={{ "--a": preset.accent, "--b": preset.accent2 } as React.CSSProperties}
            onClick={() => set(preset)}
          >
            <i className="preset-dot" />
            {t(name)}
          </button>
        ))}
      </div>
      <div className="custom-theme-colors">
        {colors.map(([key, label]) => (
          <label key={key} className="color-field">
            <input
              type="color"
              value={c[key] as string}
              aria-label={t(label)}
              onChange={(e) => set({ [key]: e.target.value.toLowerCase() })}
            />
            <span>
              {t(label)}
              <code>{(c[key] as string).toUpperCase()}</code>
            </span>
          </label>
        ))}
      </div>
      <Range
        label={t("Parçacık yoğunluğu")}
        value={c.particle_density}
        min={0}
        max={100}
        onChange={(particle_density) => set({ particle_density })}
      />
      <Range
        label={t("Parçacık hızı")}
        value={c.particle_speed}
        min={25}
        max={300}
        step={5}
        onChange={(particle_speed) => set({ particle_speed })}
      />
      <Range
        label={t("Ambiyans parlaklığı")}
        value={c.glow}
        min={0}
        max={100}
        onChange={(glow) => set({ glow })}
      />
      <button className="btn" onClick={() => update({ custom_theme: customThemeDefaults })}>
        {t("Özel temayı sıfırla")}
      </button>
    </section>
  );
}
const layerInfo: Record<AmbienceLayer, [string, string]> = {
  rain: ["🌧", msg("Yağmur")],
  wind: ["🌬", msg("Rüzgâr")],
  birds: ["🐦", msg("Kuş cıvıltısı")],
  fire: ["🔥", msg("Şömine ateşi")],
};
export const useAmbiencePlaying = () =>
  useSyncExternalStore(ambience.subscribe, () => ambience.playing);
/** Prosedürel ambiyans sesleri ve Spotify (yakında) kartı. */
export function AmbienceControls() {
  const { prefs, update } = useAppearance();
  const playing = useAmbiencePlaying();
  const [error, setError] = useState("");
  const a = prefs.ambience,
    set = (p: Partial<Ambience>) => update({ ambience: { ...a, ...p } });
  return (
    <section className={"ambience-controls " + (playing ? "playing" : "")}>
      <div className="ambience-head">
        <button
          className="btn primary ambience-play"
          aria-pressed={playing}
          onClick={() =>
            void ambience.toggle().then(
              () => setError(""),
              (e) => setError(String(e)),
            )
          }
        >
          {playing ? "❚❚ " + t("Durdur") : "▶ " + t("Oynat")}
        </button>
        <span className="ambience-eq" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      <Range
        label={t("Ses düzeyi")}
        value={a.volume}
        min={0}
        max={100}
        onChange={(volume) => set({ volume })}
      />
      <div className="ambience-layers">
        {ambienceLayers.map((key) => (
          <div className={"ambience-layer " + (a[key] > 0 ? "on" : "")} key={key}>
            <span className="ambience-emoji" aria-hidden="true">
              {layerInfo[key][0]}
            </span>
            <Range
              label={t(layerInfo[key][1])}
              value={a[key]}
              min={0}
              max={100}
              onChange={(v) => set({ [key]: v })}
            />
          </div>
        ))}
      </div>
      <label className="appearance-switch">
        <span>{t("Döngü")}</span>
        <Toggle
          type="checkbox"
          role="switch"
          checked={a.looped}
          onChange={(e) => set({ looped: e.target.checked })}
        />
      </label>
      <p className="lbl">
        {a.looped
          ? t("Sesler sen durdurana kadar kesintisiz çalar.")
          : t("Döngü kapalıyken ses 3 dakika sonra yavaşça kapanır.")}{" "}
        {t("Tüm sesler cihazında anlık üretilir; indirme veya lisans gerekmez.")}
      </p>
      {error && (
        <p role="alert" className="lbl">
          {error}
        </p>
      )}
    </section>
  );
}
export function AppearanceControls() {
  const { prefs, update, preview, error } = useAppearance();
  return (
    <section className="appearance-controls">
      <h3>{t("Görünüm")}</h3>
      <p className="lbl">{t("Oyun alanını sana göre düzenle.")}</p>
      <SkinPicker />
      <CustomThemeEditor />
      {(
        [
          ["particles", msg("Arka plan parçacıkları")],
          ["animations", msg("Animasyonlar")],
          ["splash", msg("Açılış animasyonu")],
        ] as const
      ).map(([key, label]) => (
        <label className="appearance-switch" key={key}>
          <span>{t(label)}</span>
          <Toggle
            type="checkbox"
            role="switch"
            checked={prefs[key]}
            onChange={(e) => update({ [key]: e.target.checked })}
          />
        </label>
      ))}
      <button className="btn" onClick={preview}>
        {t("Açılışı önizle")}
      </button>
      <h4 className="appearance-sub">{t("Ses ve ambiyans")}</h4>
      <AmbienceControls />
      {error && (
        <p role="alert" className="lbl">
          {error}
        </p>
      )}
    </section>
  );
}
const startupOptions: [StartupUi, string, string][] = [
  ["pclient", msg("Her zaman PClient"), msg("Launcher doğrudan PClient arayüzüyle açılır.")],
  [
    "launcher",
    msg("Her zaman PatronLauncher"),
    msg("Launcher klasik PatronLauncher arayüzüyle açılır."),
  ],
  [
    "last",
    msg("Son kullandığım arayüz"),
    msg("Launcher'ı hangi arayüzde kapattıysan onunla açılır."),
  ],
];
/** Açılış arayüzü seçimi: ilk PClient girişinde ve Ayarlar › Genel'de kullanılır. */
export function StartupUiChoice({ onPick }: { onPick?: () => void }) {
  const { prefs, update } = useAppearance();
  const current = prefs.startup_ui;
  return (
    <div className="ui-startup-options" role="radiogroup" aria-label={t("Açılış arayüzü")}>
      {startupOptions.map(([value, title, description], i) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          autoFocus={!!onPick && i === 0}
          data-option={value}
          className={"ui-startup-option " + (current === value ? "on" : "")}
          onClick={() => {
            update({ startup_ui: value });
            onPick?.();
          }}
        >
          <span className="ui-startup-art" aria-hidden="true">
            <i />
            <i />
          </span>
          <b>
            {t(title)}
            {value === "last" && <em className="setting-badge">✦ {t("Önerilen")}</em>}
          </b>
          <small>{t(description)}</small>
        </button>
      ))}
    </div>
  );
}
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Appearance>(() => {
    try {
      const saved = normalize(
        JSON.parse(localStorage.getItem("patron-appearance") ?? "null"),
      );
      return saved ? withStartup(saved) : defaults;
    } catch {
      return defaults;
    }
  });
  // Tauri'de dosyadaki tercih okunana kadar ilk açılış ekranı gösterilmez.
  const [loaded, setLoaded] = useState(!isTauri());
  const [draft, setDraft] = useState<Language>(detectLanguage);
  const language = prefs.language ?? draft;
  setLanguage(language);
  const [drawer, setDrawer] = useState(false),
    [error, setError] = useState(""),
    [splash, setSplash] = useState(0);
  const latest = useRef(prefs),
    revision = useRef(0),
    queue = useRef(Promise.resolve());
  latest.current = prefs;
  useEffect(() => {
    let active = true;
    const initial = revision.current;
    if (isTauri())
      void invoke<Appearance>("read_appearance")
        .then((raw) => {
          const v = normalize(raw);
          if (active && v && revision.current === initial) {
            // Dosyada dil yoksa bu tarayıcı önbelleğindeki seçim korunur.
            setPrefs(
              withStartup(v.language ? v : { ...v, language: latest.current.language }),
            );
            if (!v.language && latest.current.language)
              void invoke("save_appearance", {
                preferences: { ...v, language: latest.current.language },
              });
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        })
        .finally(() => {
          if (active) setLoaded(true);
        });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    for (const node of [
      document.documentElement,
      document.getElementById("root")!,
    ]) {
      node.dataset.skin = prefs.skin;
      node.dataset.motion = prefs.animations ? "on" : "off";
      node.dataset.ui = prefs.ui_mode;
    }
    // Özel tema CSS değişkenleriyle uygulanır; hazır temalarda temizlenir.
    const root = document.documentElement.style,
      c = prefs.custom_theme,
      vars: Record<string, string> = {
        "--brand": c.accent,
        "--brand2": c.accent2,
        "--bg": c.background,
        "--side": `color-mix(in srgb,${c.background} 94%,${c.accent})`,
        "--panel": `color-mix(in srgb,${c.background} 91%,#fff)`,
        "--panel2": `color-mix(in srgb,${c.background} 86%,#fff)`,
        "--particle": c.particle_color,
        "--glow-opacity": String(c.glow / 100),
        // Koyu vurgu renginde düğme yazıları okunur kalsın.
        "--ink": luminance(c.accent) < 0.35 ? "#ffffff" : "#08100c",
      };
    // PClient ana rengini --pc-red ile alır; PatronLauncher'daki PClient kapısı kırmızı kalır.
    if (prefs.ui_mode === "pclient") {
      vars["--pc-red"] = c.accent;
      vars["--pc-red-d"] = c.accent2;
    } else {
      root.removeProperty("--pc-red");
      root.removeProperty("--pc-red-d");
    }
    for (const [k, v] of Object.entries(vars))
      if (prefs.skin === "custom") root.setProperty(k, v);
      else root.removeProperty(k);
    localStorage.setItem("patron-appearance", JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => {
    if (
      latest.current.splash &&
      latest.current.animations &&
      !matchMedia("(prefers-reduced-motion:reduce)").matches
    )
      setSplash((v) => v + 1);
  }, []);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!splash) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1300);
    return () => clearTimeout(t);
  }, [splash]);
  useEffect(() => ambience.configure(prefs.ambience), [prefs.ambience]);
  useEffect(() => () => ambience.stop(), []);
  const update = (p: Partial<Appearance>) => {
    revision.current++;
    const next = { ...latest.current, ...p };
    latest.current = next;
    setPrefs(next);
    setError("");
    if (isTauri())
      queue.current = queue.current
        .catch(() => {})
        .then(() => invoke("save_appearance", { preferences: next }))
        .then(
          () => {},
          (e) => setError(String(e)),
        );
  };
  // Arayüz geçişi: perde kapanınca arayüz değişir, sonra yeni dünya açılır.
  const [portal, setPortal] = useState<{
    to: UiMode;
    x: number;
    y: number;
    id: number;
  } | null>(null);
  const [ask, setAsk] = useState(false);
  const switching = useRef(false);
  const switchUi = (to: UiMode, origin?: { x: number; y: number }) => {
    if (switching.current || latest.current.ui_mode === to) return;
    const firstVisit = to === "pclient" && !latest.current.startup_ui;
    const motion =
      latest.current.animations &&
      !matchMedia("(prefers-reduced-motion:reduce)").matches;
    if (!motion) {
      update({ ui_mode: to });
      if (firstVisit) setAsk(true);
      return;
    }
    switching.current = true;
    setPortal({
      to,
      x: origin?.x ?? innerWidth / 2,
      y: origin?.y ?? innerHeight / 2,
      id: Date.now(),
    });
    setTimeout(() => update({ ui_mode: to }), 760);
    setTimeout(() => {
      setPortal(null);
      switching.current = false;
      if (firstVisit) setAsk(true);
    }, 1750);
  };
  useEffect(() => {
    const focus = () => (document.documentElement.dataset.focused = "true"),
      blur = () => (document.documentElement.dataset.focused = "false");
    document.documentElement.dataset.focused = String(document.hasFocus());
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return (
    <Context.Provider
      value={{
        prefs,
        update,
        open: () => setDrawer(true),
        preview: () => setSplash((v) => v + 1),
        error,
        language,
        switchUi,
      }}
    >
      {children}
      {loaded && !prefs.language && (
        <div className="language-onboarding" role="dialog" aria-modal="true" aria-label={t("Dilini seç")}>
          <div className="language-onboarding-card">
            <img src={logo} alt="" />
            <h2>{t("PatronLauncher’a hoş geldin")}</h2>
            <p className="lbl">
              {t("Başlamak için launcher dilini seç. Daha sonra Ayarlar › Genel bölümünden değiştirebilirsin.")}
            </p>
            <LanguageGrid value={language} onChange={setDraft} />
            <button
              className="btn primary language-continue"
              onClick={() => update({ language: draft })}
            >
              {t("Devam et")} →
            </button>
          </div>
        </div>
      )}
      {drawer && (
        <div className="appearance-drawer-host">
          <Modal title={t("Görünüm")} close={() => setDrawer(false)}>
            <AppearanceControls />
          </Modal>
        </div>
      )}
      {visible && (
        <div
          className="startup-overlay"
          aria-hidden="true"
          key={splash}
          data-ui={prefs.ui_mode}
        >
          <div className="startup-inner">
            <img src={logo} alt="" />
            <strong>
              {prefs.ui_mode === "pclient" ? (
                <>
                  P<span>CLIENT</span>
                </>
              ) : (
                <>
                  Patron<span>Launcher</span>
                </>
              )}
            </strong>
            <div className="startup-track">
              <i />
            </div>
          </div>
        </div>
      )}
      {portal && <Portal key={portal.id} to={portal.to} x={portal.x} y={portal.y} />}
      {ask && !portal && (
        <div
          className="ui-startup-ask"
          role="dialog"
          aria-modal="true"
          aria-label={t("Launcher hangi arayüzle açılsın?")}
        >
          <div className="ui-startup-card">
            <img src={logo} alt="" />
            <h2>{t("Launcher hangi arayüzle açılsın?")}</h2>
            <p className="lbl">
              {t("Bunu yalnızca bir kez soruyoruz. Daha sonra Ayarlar › Genel bölümünden değiştirebilirsin.")}
            </p>
            <StartupUiChoice onPick={() => setAsk(false)} />
          </div>
        </div>
      )}
    </Context.Provider>
  );
}
