import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import type { Page } from "../navigation";
import {
  AmbienceControls,
  appearanceDefaults,
  CustomThemeEditor,
  SkinPicker,
  StartupUiChoice,
  useAppearance,
} from "../appearance";
import { languages, locale, msg, t, type Language } from "../i18n";
import { paths } from "../icons";
import { Select, Toggle } from "./Controls";
import Icon from "./Icon";
import LanguageGrid from "./LanguageGrid";
import { JavaCard } from "./Management";
import { MusicSettings } from "./MusicPlayer";
import wordmark from "../assets/patronlauncher3transparent-cropped.png";

type Category = "game" | "general" | "discord" | "advanced" | "about";
type Row = {
  id: string;
  category: Category;
  icon: keyof typeof paths;
  title: string;
  description: string;
  body: ReactNode;
};
export const version = "1.0.0";
const categories: [Category, keyof typeof paths, string][] = [
  ["game", "play", msg("Oyun")],
  ["general", "globe", msg("Genel")],
  ["discord", "discord", msg("Discord")],
  ["advanced", "code", msg("Gelişmiş")],
  ["about", "info", msg("Hakkında")],
];
const headings: Record<Category, string> = {
  game: msg("Oyun ayarları"),
  general: msg("Genel ayarlar"),
  discord: msg("Discord ayarları"),
  advanced: msg("Gelişmiş ayarlar"),
  about: msg("Hakkında"),
};
const discordDefault = "1566023032466571287";
const gb = (mb: number) =>
  (mb / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 });

function MemorySetting({ s, run }: { s: Snapshot; run: Run }) {
  const [system, setSystem] = useState<{
    total_mb: number;
    available_mb: number;
  } | null>(null);
  const [value, setValue] = useState(s.settings.memory_mb);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setValue(s.settings.memory_mb), [s.settings.memory_mb]);
  useEffect(() => {
    if (isTauri())
      void invoke<typeof system>("system_memory")
        .then(setSystem)
        .catch(() => {});
    return () => clearTimeout(timer.current);
  }, []);
  // Sistem belleğinin bir kısmı Windows ve launcher için ayrılır.
  const max = Math.max(
    2048,
    Math.min(32768, Math.floor(((system?.total_mb ?? 16384) - 1024) / 512) * 512),
  );
  const min = 1024;
  const disabled = s.busy || s.load_failed;
  const save = (mb: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (mb !== s.settings.memory_mb)
        void run("save_settings", { settings: { ...s.settings, memory_mb: mb } });
    }, 450);
  };
  const percent = ((Math.min(value, max) - min) / (max - min)) * 100;
  const warn = system && value > system.total_mb * 0.75;
  return (
    <div className="memory-setting">
      <div className="actions">
        <span className="setting-chip">
          <Icon name="memory" /> <b>{gb(value)} GB</b>
          {system && <small>~{gb(system.total_mb)} GB</small>}
        </span>
        {system && (
          <span className="lbl">
            {t("Sisteminde şu an {free} GB boş bellek var.", {
              free: gb(system.available_mb),
            })}
          </span>
        )}
      </div>
      <input
        type="range"
        className="setting-range"
        aria-label={t("Ayrılan bellek")}
        min={min}
        max={max}
        step={512}
        value={Math.min(value, max)}
        disabled={disabled}
        style={{ "--fill": `${percent}%` } as React.CSSProperties}
        onChange={(e) => {
          const mb = Number(e.target.value);
          setValue(mb);
          save(mb);
        }}
      />
      <div className="range-scale lbl">
        <span>1 GB</span>
        <span>{gb(max)} GB</span>
      </div>
      {warn && (
        <p className="lbl setting-warning">
          {t("Belleğin büyük kısmını oyuna ayırmak sistemi yavaşlatabilir.")}
        </p>
      )}
    </div>
  );
}

function JavaPathSetting({ s, run }: { s: Snapshot; run: Run }) {
  const [path, setPath] = useState(s.settings.java_path);
  useEffect(() => setPath(s.settings.java_path), [s.settings.java_path]);
  const disabled = s.busy || s.load_failed;
  return (
    <form
      className="setting-inline"
      onSubmit={(e) => {
        e.preventDefault();
        void run("save_settings", { settings: { ...s.settings, java_path: path } });
      }}
    >
      <input
        className="field"
        aria-label={t("Özel Java yolu")}
        placeholder={t("Boş bırakılırsa uygun Java otomatik seçilir")}
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <button className="btn" disabled={disabled || path === s.settings.java_path}>
        {t("Kaydet")}
      </button>
    </form>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  name: string;
  options: { value: T; title: string; description: string; recommended?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="setting-choices" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className={"setting-choice " + (value === o.value ? "on" : "")}>
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span className="radio-dot" aria-hidden="true" />
          <span>
            <b>
              {o.title}
              {o.recommended && <em className="setting-badge">✦ {t("Önerilen")}</em>}
            </b>
            <small>{o.description}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="setting-check">
      <Toggle
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export default function SettingsPage({
  s,
  run,
  go,
}: {
  s: Snapshot;
  run: Run;
  go: (p: Page) => void;
}) {
  const { prefs, update, preview, error, language, switchUi } = useAppearance();
  const [category, setCategory] = useState<Category>("game"),
    [query, setQuery] = useState(""),
    [confirmReset, setConfirmReset] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [category]);
  const disabled = s.busy || s.load_failed;
  // Anahtar kayıt yanıtını beklemeden tepki verir; çekirdek durumu gelince eşitlenir.
  const [discordOn, setDiscordOn] = useState(!!s.settings.discord_client_id);
  useEffect(
    () => setDiscordOn(!!s.settings.discord_client_id),
    [s.settings.discord_client_id],
  );
  const allRows: Row[] = [
    {
      id: "memory",
      category: "game",
      icon: "memory",
      title: t("Ayrılan bellek"),
      description: t("Minecraft'a ne kadar bellek (RAM) ayrılacağını seç."),
      body: <MemorySetting s={s} run={run} />,
    },
    {
      id: "java",
      category: "game",
      icon: "java",
      title: t("Java"),
      description: t("Oyunu çalıştıracak Java kurulumunu yönet veya kendi Java yolunu belirt."),
      body: (
        <>
          <JavaPathSetting s={s} run={run} />
          <JavaCard s={s} run={run} embedded />
        </>
      ),
    },
    {
      id: "launch",
      category: "game",
      icon: "rocket",
      title: t("Oyun açıldığında launcher"),
      description: t("Oyun başladıktan sonra launcher penceresinin ne yapacağını seç."),
      body: (
        <>
          <Choice
            name="launch-behavior"
            value={prefs.launch_behavior}
            onChange={(launch_behavior) => update({ launch_behavior })}
            options={[
              {
                value: "keep",
                title: t("Açık kalsın"),
                description: t("Launcher arka planda açık kalır."),
                recommended: true,
              },
              {
                value: "minimize",
                title: t("Simge durumuna küçült"),
                description: t("Oyun başladığında launcher görev çubuğuna küçülür."),
              },
            ]}
          />
          {prefs.launch_behavior === "minimize" && (
            <Switch
              label={t("Oyun kapanınca launcher'ı geri getir")}
              checked={prefs.restore_on_exit}
              onChange={(restore_on_exit) => update({ restore_on_exit })}
            />
          )}
        </>
      ),
    },
    {
      id: "home",
      category: "game",
      icon: "home",
      title: t("Oyun başlatılınca ana sayfaya dön"),
      description: t("Oyun başladığında launcher ana sayfayı gösterir."),
      body: (
        <Switch
          label={t("Ana sayfaya dön")}
          checked={prefs.home_on_launch}
          onChange={(home_on_launch) => update({ home_on_launch })}
        />
      ),
    },
    {
      id: "protection",
      category: "game",
      icon: "shield",
      title: t("Profil koruması ve yedekler"),
      description: t("Oyun ayarların her oyundan önce ve sonra otomatik yedeklenir."),
      body: (
        <button className="btn" onClick={() => go("folder")}>
          <Icon name="database" /> {t("Oyun dosyalarında yönet")}
        </button>
      ),
    },
    {
      id: "interface",
      category: "general",
      icon: "monitor",
      title: t("Arayüz"),
      description: t("PatronLauncher ile PClient arasında geçiş yap. Hesapların, ayarların ve işlem geçmişin iki arayüzde de aynıdır."),
      body: (
        <button
          className={"btn ui-switch " + (prefs.ui_mode === "pclient" ? "" : "primary")}
          onClick={(e) =>
            switchUi(prefs.ui_mode === "pclient" ? "launcher" : "pclient", {
              x: e.clientX,
              y: e.clientY,
            })
          }
        >
          {prefs.ui_mode === "pclient" ? t("PatronLauncher'a dön") : t("PClient'a geç")}
        </button>
      ),
    },
    {
      id: "startup-ui",
      category: "general",
      icon: "rocket",
      title: t("Açılış arayüzü"),
      description: t("Launcher her açıldığında hangi arayüzle başlayacağını seç."),
      body: <StartupUiChoice />,
    },
    {
      id: "language",
      category: "general",
      icon: "globe",
      title: t("Dil"),
      description: t("Launcher'ın görüntüleneceği dili seç."),
      body: (
        <LanguageGrid
          value={language}
          onChange={(code) => update({ language: code })}
        />
      ),
    },
    {
      id: "theme",
      category: "general",
      icon: "palette",
      title: t("Tema"),
      description: t("Launcher'ın renk temasını seç. Her sekme kendi vurgu rengini korur."),
      body: (
        <div className="setting-stack">
          <SkinPicker className="skin-grid settings-skins" />
          <CustomThemeEditor />
        </div>
      ),
    },
    {
      id: "music",
      category: "general",
      icon: "music",
      title: t("Müzik çalar"),
      description: t("Launcher müziklerini ve sağ üstteki çaları yönet."),
      body: <MusicSettings />,
    },
    {
      id: "ambience",
      category: "general",
      icon: "sparkle",
      title: t("Ses ve ambiyans"),
      description: t("Launcher açıkken yağmur, rüzgâr, kuş ve ateş sesleri çal."),
      body: <AmbienceControls />,
    },
    {
      id: "motion",
      category: "general",
      icon: "sparkle",
      title: t("Animasyonlar ve efektler"),
      description: t("Animasyonları kapatmak düşük donanımda performansı artırabilir."),
      body: (
        <div className="setting-stack">
          <Switch
            label={t("Animasyonlar")}
            checked={prefs.animations}
            onChange={(animations) => update({ animations })}
          />
          <Switch
            label={t("Arka plan parçacıkları")}
            checked={prefs.particles}
            onChange={(particles) => update({ particles })}
          />
          <Switch
            label={t("Açılış animasyonu")}
            checked={prefs.splash}
            onChange={(splash) => update({ splash })}
          />
          <button className="btn" onClick={preview}>
            {t("Açılışı önizle")}
          </button>
        </div>
      ),
    },
    {
      id: "sidebar",
      category: "general",
      icon: "monitor",
      title: t("Kompakt menü"),
      description: t("Sol menüyü yalnızca simgeler gösterecek şekilde daralt."),
      body: (
        <Switch
          label={t("Menüyü daralt")}
          checked={!!prefs.collapsed}
          onChange={(collapsed) => update({ collapsed })}
        />
      ),
    },
    {
      id: "reset",
      category: "general",
      icon: "reset",
      title: t("Launcher tercihlerini sıfırla"),
      description: t("Tema, animasyon ve pencere tercihlerini varsayılana döndürür. Dil, oyun ayarları ve profiller değişmez."),
      body: confirmReset ? (
        <div className="actions">
          <button
            className="btn primary"
            onClick={() => {
              update({
                ...appearanceDefaults,
                language: prefs.language,
                discord_language: prefs.discord_language,
                discord_override: prefs.discord_override,
                ui_mode: prefs.ui_mode,
                startup_ui: prefs.startup_ui,
              });
              setConfirmReset(false);
            }}
          >
            {t("Sıfırlamayı onayla")}
          </button>
          <button className="btn" onClick={() => setConfirmReset(false)}>
            {t("Vazgeç")}
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => setConfirmReset(true)}>
          <Icon name="reset" /> {t("Tümünü sıfırla")}
        </button>
      ),
    },
    {
      id: "rpc",
      category: "discord",
      icon: "discord",
      title: t("Discord Rich Presence"),
      description: t("Launcher etkinliğini Discord profilinde göster."),
      body: (
        <Switch
          label={t("Etkinliği Discord'da göster")}
          checked={discordOn}
          disabled={disabled}
          onChange={(on) => {
            const id = on ? prefs.discord_override || discordDefault : "";
            setDiscordOn(on);
            if (!on && s.settings.discord_client_id)
              update({ discord_override: s.settings.discord_client_id });
            void run("save_settings", {
              settings: { ...s.settings, discord_client_id: id },
            });
          }}
        />
      ),
    },
    {
      id: "rpc-language",
      category: "discord",
      icon: "globe",
      title: t("Rich Presence dili"),
      description: t("Discord'da görünen etkinlik metninin dili. Varsayılan İngilizcedir."),
      body: (
        <Select
          className="setting-select"
          aria-label={t("Rich Presence dili")}
          value={prefs.discord_language}
          disabled={!discordOn}
          onChange={(e) => update({ discord_language: e.target.value as Language })}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} · {l.english}
            </option>
          ))}
        </Select>
      ),
    },
    {
      id: "data",
      category: "advanced",
      icon: "folder",
      title: t("Launcher veri klasörü"),
      description: t("Ayarların, profillerin ve ortak oyun dosyalarının bulunduğu klasör."),
      body: (
        <div className="actions">
          <button
            className="btn"
            disabled={s.load_failed}
            onClick={() => void run("open_folder", { target: "root" })}
          >
            <Icon name="folder" /> {t("Klasörü aç")}
          </button>
          <button className="btn" onClick={() => go("folder")}>
            <Icon name="database" /> {t("Disk kullanımını gör")}
          </button>
        </div>
      ),
    },
    {
      id: "about",
      category: "about",
      icon: "info",
      title: "PatronLauncher",
      description: t("Sürüm {version}", { version }),
      body: (
        <div className="settings-about">
          <img src={wordmark} alt="PatronLauncher" />
          <p className="lbl">
            {t("Minecraft Java Edition için güvenilir, ücretsiz ve modern launcher.")}
          </p>
          <p className="lbl">
            {t("Resmi bir Minecraft ürünü değildir; Mojang veya Microsoft tarafından onaylanmamıştır ve onlarla bağlantılı değildir.")}
          </p>
          <p className="lbl">
            {t("Modrinth, CurseForge, Fabric, Quilt, NeoForge, Forge ve OptiFine ile resmi bir bağlantımız yoktur. Adlar ve logolar sahiplerine aittir.")}
          </p>
        </div>
      ),
    },
  ];
  // Tema ve kompakt menü yalnızca klasik PatronLauncher arayüzünü etkiler.
  const rows =
    prefs.ui_mode === "pclient"
      ? allRows.filter((r) => r.id !== "theme" && r.id !== "sidebar")
      : allRows;
  const needle = query.trim().toLocaleLowerCase(locale());
  const visible = useMemo(
    () =>
      needle
        ? rows.filter((r) =>
            (r.title + " " + r.description)
              .toLocaleLowerCase(locale())
              .includes(needle),
          )
        : rows.filter((r) => r.category === category),
    [needle, category, rows],
  );
  return (
    <div className="settings-shell">
      <aside className="settings-nav">
        <label className="settings-search">
          <Icon name="search" />
          <input
            placeholder={t("Ayarlarda ara…")}
            aria-label={t("Ayarlarda ara…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {categories.map(([key, icon, label]) => (
          <button
            key={key}
            className={"settings-tab " + (!needle && key === category ? "on" : "")}
            aria-current={!needle && key === category ? "page" : undefined}
            onClick={() => {
              setQuery("");
              setCategory(key);
            }}
          >
            <span className="settings-tab-icon">
              <Icon name={icon} />
            </span>
            {t(label)}
          </button>
        ))}
        <div className="sp" />
        <p className="settings-foot lbl">
          PatronLauncher {version}
          <br />
          {t("Mojang veya Microsoft ile bağlantılı değildir.")}
        </p>
      </aside>
      <div className="settings-content" ref={content}>
        <h2 key={needle ? "search" : category}>
          {needle ? t("Arama sonuçları") : t(headings[category])}
        </h2>
        {error && (
          <p className="lbl setting-warning" role="alert">
            {error}
          </p>
        )}
        {visible.map((r, i) => (
          <section
            className="setting-row"
            key={r.id}
            style={{ "--i": i } as React.CSSProperties}
          >
            <h4>
              <Icon name={r.icon} /> {r.title}
            </h4>
            <p className="lbl">{r.description}</p>
            <div className="setting-body">{r.body}</div>
          </section>
        ))}
        {!visible.length && (
          <p className="empty">{t("Aramanla eşleşen ayar bulunamadı.")}</p>
        )}
      </div>
    </div>
  );
}
