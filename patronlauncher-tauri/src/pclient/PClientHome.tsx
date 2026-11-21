import { statusText } from "../statusText";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Article, Snapshot } from "../types/core";
import type { Page } from "../navigation";
import { playLabel, type Run } from "../backend";
import { useAppearance } from "../appearance";
import { msg, t } from "../i18n";
import logo from "../assets/patronlauncher3transparent-mark.png";
import Avatar from "./Avatar";
import { PcIcon } from "./icons";
import HomeServers from "./HomeServers";
import { announceLaunch } from "./launch";
import { ensurePerformanceChoice } from "./PerformancePrompt";

/** PClient'ın oyun içinde çalıştığı sürüm (launcher'daki pclient.rs ile aynı). */
const pclientInfo = (version: string) => `PClient · Minecraft ${version}`;

/** Arka planda yükselen kıvılcımlar; konumları sabit, böylece her çizimde aynı kalır. */
const embers = Array.from({ length: 14 }, (_, i) => ({
  x: (i * 37 + 11) % 100,
  d: 7 + ((i * 13) % 9),
  delay: -((i * 1.7) % 9),
  s: 2 + (i % 3),
}));

/**
 * PClient başlatma düğmesi. PClient launcher profillerinden ayrıdır: profil ya da sürüm seçilmez,
 * launcher kendi gizli PClient profilini hazırlayıp oyunu başlatır.
 */
function LaunchControl({
  s,
  run,
  go,
  progress,
  edition,
}: {
  s: Snapshot;
  run: Run;
  go: (p: Page) => void;
  progress: number | null;
  edition: string;
}) {
  const enabled = !s.busy && !s.running && !s.load_failed;
  const hasAccount = s.accounts.some((a) => a.id === s.selected_account);
  const label = s.busy || s.running ? playLabel(s) : hasAccount ? msg("OYUNA GİR") : msg("HESAP EKLE");
  const play = async () => {
    if (label === "HESAP EKLE") return go("account");
    if (!(await ensurePerformanceChoice())) return;
    announceLaunch("play");
    void run("pclient_play", {});
  };
  return (
    <div className="pc-launch pc-launch-solo">
      <button
        className={"pc-launch-main " + (s.running ? "run" : s.busy ? "busy" : "")}
        disabled={!enabled}
        onClick={() => void play()}
      >
        <span className="pc-launch-shine" aria-hidden="true" />
        <b>{t(label)}</b>
        <small lang="en">{pclientInfo(edition)}</small>
        <i className="pc-launch-bar" style={{ width: s.busy && progress !== null ? `${progress}%` : 0 }} />
      </button>
    </div>
  );
}

/** Seçili PClient sürümü (Sürümler sayfasında değişir). */
function useEdition(busy: boolean) {
  const [edition, setEdition] = useState("26.3");
  useEffect(() => {
    invoke<{ minecraft: string; selected: boolean }[]>("pclient_versions")
      .then((list) => setEdition(list.find((r) => r.selected)?.minecraft ?? "26.3"))
      .catch(() => {});
  }, [busy]);
  return edition;
}

export default function PClientHome({
  s,
  run,
  go,
  articles,
  progress,
  notice,
}: {
  s: Snapshot;
  run: Run;
  go: (p: Page) => void;
  articles: Article[];
  progress: number | null;
  notice: (m: string) => void;
  // App diğer arayüzle aynı özellikleri geçirir; PClient bunları kullanmaz.
  [rest: string]: unknown;
}) {
  const { prefs, switchUi } = useAppearance();
  const stage = useRef<HTMLElement>(null);
  const account = s.accounts.find((a) => a.id === s.selected_account);
  const edition = useEdition(s.busy);
  return (
    <div className="pc-home">
      <div className="pc-home-left">
        <section
          className={"pc-stage " + (s.running ? "running" : "")}
          ref={stage}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.setProperty("--lx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
            e.currentTarget.style.setProperty("--ly", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
          }}
          onPointerLeave={(e) => {
            e.currentTarget.style.setProperty("--lx", "0");
            e.currentTarget.style.setProperty("--ly", "0");
          }}
        >
          <div className="pc-room" aria-hidden="true">
            <div className="pc-ceil" />
            <div className="pc-floor" />
            <div className="pc-horizon" />
          </div>
          {prefs.particles && (
            <div className="pc-embers" aria-hidden="true">
              {embers.map((e, i) => (
                <i
                  key={i}
                  style={
                    {
                      left: `${e.x}%`,
                      "--d": `${e.d}s`,
                      "--delay": `${e.delay}s`,
                      "--s": `${e.s}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          )}
          <div className="pc-stage-tags">
            <button className="pc-tag pc-tag-btn" onClick={() => go("editions")} title={t("PClient sürümleri")}>
              MINECRAFT {edition}
            </button>
            <span className="pc-tag red">PCLIENT</span>
          </div>
          <button
            className="pc-portal-btn pc-stage-switch"
            title={t("PatronLauncher'a dön")}
            onClick={(e) => switchUi("launcher", { x: e.clientX, y: e.clientY })}
          >
            <span className="pc-portal-mark" aria-hidden="true">
              <img src={logo} alt="" />
            </span>
            <span className="t">
              <b>
                PATRON<em>LAUNCHER</em>
              </b>
              <small>{t("PatronLauncher'a dön")}</small>
            </span>
            <i className="pc-portal-arrow" aria-hidden="true">
              ←
            </i>
          </button>
          <div className="pc-character">
            <button
              className="pc-nametag"
              onClick={() => go("account")}
              title={account ? t("Hesap seç") : t("Hesap ekle")}
            >
              {account ? account.name : t("Hesap ekle")}
            </button>
            <Avatar account={account} />
          </div>
          <LaunchControl s={s} run={run} go={go} progress={progress} edition={edition} />
          {s.busy && !s.running && (
            <p className="pc-stage-status" role="status">
              {statusText(s.status)}
            </p>
          )}
        </section>
        <HomeServers s={s} run={run} go={go} notice={notice} />
      </div>
      <aside className="pc-news" aria-label={t("Son haberler")}>
        <header className="pc-section-head">
          <h3>
            <PcIcon name="news" /> {t("Son haberler")}
          </h3>
          <button
            className="pc-icon-btn"
            aria-label={t("Yenile")}
            title={t("Yenile")}
            disabled={s.news_loading}
            onClick={() => void run("get_news", { refresh: true })}
          >
            ↻
          </button>
        </header>
        {articles.length === 0 ? (
          <p className="pc-news-empty">
            {s.news_loading
              ? t("Haberler getiriliyor…")
              : s.news_error
                ? t("Haberlere şu anda ulaşılamıyor. İnternet bağlantını kontrol edip yeniden dene.")
                : t("Henüz gösterilecek haber yok.")}
          </p>
        ) : (
          articles.slice(0, 5).map((n, i) => (
            <article
              key={n.url}
              className="pc-news-card"
              role="link"
              tabIndex={0}
              style={{ "--i": i } as CSSProperties}
              onClick={() => void run("open_external", { url: n.url })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void run("open_external", { url: n.url });
              }}
            >
              {/* Haberler kaynak dilinde (İngilizce) gelir; büyük harf dönüşümü İngilizce kurallarla yapılır. */}
              <b lang="en">{n.title}</b>
              <span
                className="pc-news-art"
                style={n.image ? { backgroundImage: `url("${n.image}")` } : undefined}
              >
                <small>{n.date}</small>
              </span>
            </article>
          ))
        )}
      </aside>
    </div>
  );
}
