import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppearance } from "../appearance";
import { t } from "../i18n";
import mark from "../assets/patronlauncher3transparent-mark.png";
import discordPixel from "../assets/loaders/discord-pixel.png";
import support from "../../src-tauri/resources/pclient/support.json";
import "../styles/community.css";

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

/** Patron logolu, animasyonlu Discord ve web sitesi düğmeleri. */
export default function CommunityLinks({ layout }: { layout: "row" | "stack" }) {
  return (
    <div className={`cm-links cm-${layout}`}>
      <Link kind="discord" url={support.discord} title="Discord" subtitle={t("Topluluğa katıl")} />
      <Link kind="web" url={support.website} title={t("Web sitesi")} subtitle={t("Web sitemiz")} />
    </div>
  );
}
