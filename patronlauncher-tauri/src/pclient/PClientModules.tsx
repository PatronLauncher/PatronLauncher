import { useMemo, useState, type CSSProperties } from "react";
import { locale, msg, t } from "../i18n";
import { PcIcon, type Glyph } from "./icons";

type Category = "hud" | "performance" | "pvp" | "tools" | "cosmetic";
/** Kategori adı; "HUD" ve "PvP" her dilde aynıdır. */
const categories: [Category | "all", string, boolean][] = [
  ["all", msg("Tümü"), true],
  ["hud", "HUD", false],
  ["performance", msg("Performans"), true],
  ["pvp", "PvP", false],
  ["tools", msg("Araçlar"), true],
  ["cosmetic", msg("Kozmetik"), true],
];
/**
 * PClient oyun içi modülleri. ready: oyunda çalışıyor (Sağ Shift menüsünden açılır);
 * değilse geliştiriliyor. Modül adları özel ad olarak çevrilmez.
 */
const modules: [string, Category, Glyph, boolean][] = [
  ["FPS", "hud", "gauge", true],
  ["CPS", "hud", "mouse", true],
  ["Keystrokes", "hud", "keyboard", true],
  ["Armor Status", "hud", "shield", true],
  ["Potion Effects", "hud", "flask", true],
  ["Coordinates", "hud", "pin", true],
  ["Clock", "hud", "clock", true],
  ["Ping", "hud", "wifi", true],
  ["Speed", "hud", "chart", true],
  ["Minimap", "hud", "globe", true],
  ["Compass", "hud", "pin", true],
  ["Target Info", "hud", "eye", true],
  ["Item Counter", "hud", "list", true],
  ["Combo Counter", "hud", "sword", true],
  ["Reach Display", "hud", "target", true],
  ["Saturation", "hud", "drop", true],
  ["Day Counter", "hud", "sun", true],
  ["Playtime", "hud", "clock", true],
  ["Stopwatch", "hud", "clock", true],
  ["Memory Usage", "hud", "gauge", true],
  ["Pack Display", "hud", "list", true],
  ["Light Level", "hud", "sun", true],
  ["Rotation", "hud", "target", true],
  ["Game Time", "hud", "clock", true],
  ["Held Item", "hud", "list", true],
  ["Session Stats", "hud", "chart", true],
  ["Mount Info", "hud", "run", true],
  ["TNT Timer", "hud", "clock", true],
  ["Durability Warning", "hud", "shield", true],
  ["Low Health Warning", "hud", "drop", true],
  ["Server Address", "hud", "server", true],
  ["Online Players", "hud", "server", true],
  ["Scoreboard", "hud", "list", true],
  ["Boss Bar", "hud", "chart", true],
  ["Tab Ping", "hud", "wifi", true],
  ["FPS Boost", "performance", "bolt", true],
  ["Particle Limit", "performance", "bolt", true],
  ["Fullbright", "performance", "sun", true],
  ["Toggle Sprint", "pvp", "run", true],
  ["Crosshair", "pvp", "target", true],
  ["No Hurt Cam", "pvp", "eyeOff", true],
  ["Low Fire", "pvp", "eyeOff", true],
  ["Hit Color", "pvp", "drop", true],
  ["Hitboxes", "pvp", "target", true],
  ["Hand View", "pvp", "sword", true],
  ["Block Outline", "pvp", "target", true],
  ["1.7 Animations", "pvp", "sword", false],
  ["Zoom", "tools", "zoom", true],
  ["Freelook", "tools", "eye", true],
  ["Snaplook", "tools", "eye", true],
  ["Waypoints", "tools", "flag", true],
  ["AutoText", "tools", "keyboard", true],
  ["Chat Timestamps", "tools", "clock", true],
  ["Chat+", "tools", "list", true],
  ["Chunk Borders", "tools", "target", true],
  ["Clear Weather", "tools", "sun", true],
  ["Screen Effects", "tools", "eyeOff", true],
  ["Hide Notifications", "tools", "eyeOff", true],
  ["Own Nametag", "tools", "eye", true],
  ["Replay", "tools", "rewind", false],
  ["Capes", "cosmetic", "shirt", false],
  ["Emotes", "cosmetic", "smile", false],
];
export default function PClientModules() {
  const [category, setCategory] = useState<Category | "all">("all"),
    [query, setQuery] = useState("");
  const label = (c: Category) => {
    const found = categories.find(([key]) => key === c)!;
    return found[2] ? t(found[1]) : found[1];
  };
  const needle = query.trim().toLocaleLowerCase(locale());
  const visible = useMemo(
    () =>
      modules.filter(
        ([name, c]) =>
          (category === "all" || c === category) &&
          (!needle || name.toLocaleLowerCase(locale()).includes(needle)),
      ),
    [category, needle],
  );
  return (
    <div className="pc-modules">
      <section className="pc-banner">
        <span className="pc-banner-icon">
          <PcIcon name="modules" />
        </span>
        <div>
          <b>{t("PClient oyunun içinde")}</b>
          <p>
            {t("Oyundayken Sağ Shift ile PClient menüsünü aç; modülleri oradan açıp kapatabilir, HUD'u düzenleyebilirsin.")}
          </p>
        </div>
      </section>
      <div className="pc-module-bar">
        <div className="pc-chips" role="tablist" aria-label={t("Modüller")}>
          {categories.map(([key, name, translated]) => (
            <button
              key={key}
              role="tab"
              aria-selected={category === key}
              className={"pc-chip " + (category === key ? "on" : "")}
              onClick={() => setCategory(key)}
            >
              {translated ? t(name) : name}
            </button>
          ))}
        </div>
        <label className="pc-search">
          <PcIcon name="zoom" />
          <input
            placeholder={t("Modül ara…")}
            aria-label={t("Modül ara…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {visible.length ? (
        <div className="pc-module-grid">
          {visible.map(([name, c, icon, ready], i) => (
            <article
              key={name}
              className={"pc-module" + (ready ? " ready" : "")}
              data-cat={c}
              style={{ "--i": Math.min(i, 18) } as CSSProperties}
            >
              <span className="pc-module-cat">{label(c)}</span>
              <span className="pc-module-icon">
                <PcIcon name={icon} />
              </span>
              <b>{name}</b>
              <span className="pc-module-state">{ready ? t("Hazır") : t("Yakında")}</span>
            </article>
          ))}
        </div>
      ) : (
        <p className="pc-empty">{t("Aramanla eşleşen modül bulunamadı.")}</p>
      )}
    </div>
  );
}
