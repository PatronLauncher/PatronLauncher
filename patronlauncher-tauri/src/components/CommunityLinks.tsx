import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppearance } from "../appearance";
import { t } from "../i18n";
import mark from "../assets/patronlauncher3transparent-mark.png";
import discordPixel from "../assets/loaders/discord-pixel.png";
import support from "../../src-tauri/resources/pclient/support.json";
import "../styles/community.css";
import { openHelp } from "../patronAccount";

/** Karttan yükselen kıvılcımlar; konumları sabit olduğu için her çizimde aynı kalır. */
const sparks = Array.from({ length: 9 }, (_, i) => ({
  x: (i * 41 + 7) % 100,
  d: 2.4 + ((i * 7) % 5) * 0.45,
  delay: -((i * 1.3) % 4),
  s: 2 + (i % 2),
}));

function Link({ kind, url, title, subtitle }: { kind: "discord" | "web"; url: string; title: string; subtitle: string }) {
  const { prefs } = useAppearance();
  const ready = !!url;
  return (
    <button
      className={`cm-link ${kind} ${ready ? "" : "soon"}`}
      title={ready ? title : `${title} · ${t("Yakında")}`}
      aria-label={ready ? title : `${title} · ${t("Yakında")}`}
      onClick={() => {
        if (ready) void invoke("open_external", { url }).catch(() => {});
      }}
    >
      {prefs.particles && (
        <span className="cm-sparks" aria-hidden="true">
          {sparks.map((s, i) => (
            <i key={i} style={{ left: `${s.x}%`, "--d": `${s.d}s`, "--delay": `${s.delay}s`, "--s": `${s.s}px` } as CSSProperties} />
          ))}
        </span>
      )}
      <span className="cm-mark" aria-hidden="true">
        {kind === "discord" ? <img className="cm-discord" src={discordPixel} alt="" /> : <img src={mark} alt="" />}
      </span>
      <span className="cm-text">
        <b>{title}</b>
        <small>{ready ? subtitle : t("Yakında")}</small>
      </span>
    </button>
  );
}

/** PClient sol rayında, diğer menü öğeleriyle aynı biçimde duran simge düğmeleri. */
function RailLinks() {
  const links = [
    { kind: "discord", url: support.discord, label: "Discord", hint: t("Discord sunucumuza katıl"), icon: discordPixel },
    { kind: "web", url: support.website, label: t("Web sitesi"), hint: t("patronlauncher.net'i ziyaret et"), icon: mark },
  ].filter((l) => l.url);
  if (!links.length) return null;
  return (
    <nav className="pc-rail-nav pc-rail-community" aria-label={t("Topluluk")}>
      {links.map((l) => (
        <button
          key={l.kind}
          className={`pc-nav pc-community ${l.kind}`}
          title={l.hint}
          onClick={() => void invoke("open_external", { url: l.url }).catch(() => {})}
        >
          <img src={l.icon} alt="" />
          <span>{l.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Patron logolu, animasyonlu Discord ve web sitesi düğmeleri. */
export default function CommunityLinks({ layout }: { layout: "row" | "rail" }) {
  if (layout === "rail") return <RailLinks />;
  return (
    <div className={`cm-links cm-${layout}`}>
      <Link kind="discord" url={support.discord} title="Discord" subtitle={t("Sunucumuza katıl")} />
      <Link kind="web" url={support.website} title={t("Web sitesi")} subtitle={t("Ziyaret et")} />
      {support.website && (
        <button className="cm-help" title={t("Destek formunu sürüm bilgilerinle doldurulmuş açar")} onClick={() => void openHelp().catch(() => {})}>
          {t("Yardım al")}
        </button>
      )}
    </div>
  );
}
