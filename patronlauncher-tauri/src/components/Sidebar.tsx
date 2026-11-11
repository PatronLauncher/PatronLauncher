import { useState } from "react";
import { useAppearance } from "../appearance";
import type { Profile } from "../types/core";
import { items, items2, type Page } from "../navigation";
import Icon from "./Icon";
import CommunityLinks from "./CommunityLinks";
import wordmark from "../assets/patronlauncher3transparent-cropped.png";
import brandIcon from "../assets/patronlauncher3transparent-mark.png";
import { loaderLabel } from "../profile";
import { t } from "../i18n";
export default function Sidebar({
  page,
  selected,
  mode,
  go,
  createProfile,
}: {
  page: Page;
  selected: Profile | undefined;
  mode: "quick" | "profile";
  go: (p: Page) => void;
  createProfile: () => void;
}) {
  const { prefs, update, switchUi } = useAppearance();
  const [ripple, setRipple] = useState<{
    key: string;
    x: number;
    y: number;
    id: number;
  } | null>(null);
  const nav = (list: typeof items) =>
    list.map(([key, title]) => (
      <button
        key={key}
        className={`nav ${key === page ? "on" : ""}`}
        data-p={key}
        title={t(title)}
        onPointerDown={(e) => {
          if(!prefs.animations||matchMedia('(prefers-reduced-motion:reduce)').matches)return;
          const r = e.currentTarget.getBoundingClientRect();
          setRipple({
            key,
            x: e.clientX - r.left,
            y: e.clientY - r.top,
            id: Date.now(),
          });
        }}
        onClick={() => go(key)}
      >
        {ripple?.key === key && (
          <span
            key={ripple.id}
            className="nav-ripple"
            style={{ left: ripple.x, top: ripple.y }}
            onAnimationEnd={() => setRipple(null)}
          />
        )}
        <span className="nav-tile">
          <Icon name={key as Exclude<Page, "modules" | "servers" | "editions">} />
        </span>
        <span className="t">{t(title)}</span>
        {key === "mods" && (
          <span className="nav-new nav-sources" title="Modrinth · CurseForge">
            <i className="source-logo modrinth" />
            <i className="source-logo curseforge" />
          </span>
        )}
      </button>
    ));
  const index = items.findIndex(([key]) => key === page),
    p = selected;
  return (
    <aside className={"side " + (prefs.collapsed ? "collapsed" : "")}>
      <button
        className="sidebar-collapse btn"
        aria-label={prefs.collapsed ? t("Menüyü genişlet") : t("Menüyü daralt")}
        onClick={() => update({ collapsed: !prefs.collapsed })}
      >
        {prefs.collapsed ? "›" : "‹"}
      </button>
      <div className="logo">
        <img className="brand-wordmark" src={wordmark} alt="PatronLauncher" />
        <img className="brand-icon" src={brandIcon} alt="PatronLauncher" />
      </div>
      <div className="cap">{t("OYUN ALANIN")}</div>
      <nav id="nav">
        <div
          className="ind"
          id="ind"
          style={
            {
              opacity: index < 0 ? 0 : 1,
              "--idx": Math.max(0, index),
            } as React.CSSProperties
          }
        />
        {nav(items)}
      </nav>
      <div className="cur" id="cur">
        <span className="lbl">{t("SEÇİLİ OYUN")}</span>
        <b>
          {p
            ? mode === "quick"
              ? `Minecraft ${p.version}`
              : p.name
            : t("Henüz oyun seçilmedi")}
        </b>
        <small>
          {loaderLabel(p)} · {p?.version ?? t("İlk profilini oluştur")}
        </small>
      </div>
      <button
        className="pc-portal-btn"
        title={t("PClient'a geç")}
        aria-label={t("PClient'a geç")}
        onClick={(e) => switchUi("pclient", { x: e.clientX, y: e.clientY })}
      >
        <span className="pc-portal-mark" aria-hidden="true">
          <img src={brandIcon} alt="" />
        </span>
        <span className="t">
          <b>
            P<em>CLIENT</em>
          </b>
          <small>{t("Farklı bir dünyaya geç")}</small>
        </span>
        <i className="pc-portal-arrow" aria-hidden="true">
          →
        </i>
      </button>
      <CommunityLinks layout="row" />
      <div className="sp" />
      <button
        className="btn sidebar-create"
        title={t("Profil oluştur")}
        aria-label={t("Profil oluştur")}
        onClick={createProfile}
      >
        <Icon name="plus" />
        <span className="t">{t("Profil oluştur")}</span>
      </button>
      <nav id="nav2">{nav(items2)}</nav>
    </aside>
  );
}
