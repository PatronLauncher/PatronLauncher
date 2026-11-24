import { useCallback, useState, type ReactNode, type RefObject } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { titles, type Page } from "../navigation";
import { useAppearance } from "../appearance";
import { msg, t } from "../i18n";
import Icon from "../components/Icon";
import type { paths } from "../icons";
import { version } from "../components/SettingsPage";
import logo from "../assets/patronlauncher3transparent-mark.png";
import { PcIcon } from "./icons";
import LaunchOverlay from "./LaunchOverlay";
import AccountMenu from "./AccountMenu";
import PerformancePrompt from "./PerformancePrompt";
import SupportDialog from "./SupportDialog";
import CommunityLinks from "../components/CommunityLinks";

const rail: [Page, string][] = [
  // PClient bir hizmettir: profil, sürüm, mod ve dosya sayfaları PatronLauncher arayüzünde kalır.
  ["home", msg("Oyna")],
  ["servers", msg("Sunucular")],
  ["editions", msg("Sürümler")],
  ["modules", msg("Modüller")],
  ["account", msg("Hesaplar")],
  ["friends", msg("Arkadaşlar")],
];
const rail2: [Page, string][] = [
  ["activity", msg("İşlem geçmişi")],
  ["settings", msg("Ayarlar")],
];
function RailIcon({ page }: { page: Page }) {
  if (page === "modules") return <PcIcon name="modules" />;
  if (page === "servers") return <PcIcon name="server" />;
  if (page === "editions") return <PcIcon name="layers" />;
  if (page === "friends") return <PcIcon name="users" />;
  return <Icon name={(page === "home" ? "play" : page) as keyof typeof paths} />;
}
/** PClient arayüzünün çerçevesi: sol ray, üst bar ve kendi arka planı. */
export default function PClientShell({
  s,
  run,
  page,
  go,
  mainRef,
  status,
  children,
}: {
  s: Snapshot | null;
  run: Run;
  page: Page;
  go: (p: Page) => void;
  mainRef: RefObject<HTMLElement | null>;
  status: ReactNode;
  children: ReactNode;
}) {
  const { switchUi, open: openAppearance } = useAppearance();
  const [support, setSupport] = useState(false);
  const showSupport = useCallback(() => setSupport(true), []);
  const hideSupport = useCallback(() => setSupport(false), []);
  const enabled = !!s && !s.busy && !s.load_failed;
  const nav = (list: [Page, string][]) =>
    list.map(([key, title]) => (
      <button
        key={key}
        className={"pc-nav " + (key === page ? "on" : "")}
        aria-current={key === page ? "page" : undefined}
        title={t(title)}
        onClick={() => go(key)}
      >
        <RailIcon page={key} />
        <span>{t(title)}</span>
      </button>
    ));
  return (
    <div className="pc-shell">
      <div className="pc-bg" aria-hidden="true">
        <i className="pc-bg-glow" />
        <i className="pc-bg-scan" />
      </div>
      <aside className="pc-rail">
        <button
          className="pc-rail-logo"
          aria-label={t("Ana sayfa")}
          onClick={() => go("home")}
        >
          <img src={logo} alt="" />
        </button>
        <nav className="pc-rail-nav">{nav(rail)}</nav>
        <div className="pc-rail-sp" />
        <CommunityLinks layout="rail" />
        <nav className="pc-rail-nav">{nav(rail2)}</nav>
        <button
          className="pc-exit"
          title={t("PatronLauncher'a dön")}
          aria-label={t("PatronLauncher'a dön")}
          onClick={(e) => switchUi("launcher", { x: e.clientX, y: e.clientY })}
        >
          <span className="pc-exit-mark" aria-hidden="true">
            <img src={logo} alt="" />
          </span>
          <span className="pc-exit-text">
            PATRON
            <br />
            LAUNCHER
          </span>
          <i className="pc-exit-arrow" aria-hidden="true">
            ←
          </i>
        </button>
      </aside>
      <div className="pc-column">
        <header className="pc-top">
          <div className="pc-brand">
            <b>
              P<span>CLIENT</span>
            </b>
            <small>v{version}</small>
          </div>
          <div className="pc-crumb" key={page}>
            <span>{t(titles[page][0])}</span>
            <small>{t(titles[page][1])}</small>
          </div>
          <div className="pc-top-actions">
            <button
              className={"pc-icon-btn " + (s?.busy && !s.running ? "spin" : "")}
              title={t("Yenile")}
              aria-label={t("Yenile")}
              disabled={!enabled}
              onClick={() => void run("list_versions", { refresh: true })}
            >
              <Icon name="refresh" />
            </button>
            <button
              className="pc-icon-btn"
              title={t("PClient oyun klasörünü aç")}
              aria-label={t("PClient oyun klasörünü aç")}
              onClick={() => void run("open_folder", { target: "pclient" })}
            >
              <Icon name="folder" />
            </button>
            <button
              className="pc-icon-btn"
              title={t("Destek")}
              aria-label={t("Destek")}
              onClick={showSupport}
            >
              <Icon name="info" />
            </button>
            <button
              className="pc-icon-btn"
              title={t("Görünüm")}
              aria-label={t("Görünüm")}
              onClick={openAppearance}
            >
              <Icon name="palette" />
            </button>
            {s && <AccountMenu s={s} run={run} manage={() => go("account")} />}
          </div>
        </header>
        <main
          id="main"
          ref={mainRef}
          className={"pc-main " + (page === "home" ? "is-home" : "")}
        >
          {children}
          {status}
        </main>
      </div>
      <LaunchOverlay s={s} run={run} />
      <PerformancePrompt />
      <SupportDialog s={s} run={run} open={support} onOpen={showSupport} onClose={hideSupport} />
    </div>
  );
}
