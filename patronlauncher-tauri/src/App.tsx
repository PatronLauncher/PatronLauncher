import { statusText } from "./statusText";
import Modal from "./components/Modal";
import { warmCatalog, saveCatalog } from "./catalogCache";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Page } from "./navigation";
import type {
  Snapshot,
  Article,
  EventEnvelope,
  CommandName,
  CommandArgs,
} from "./types/core";
import { call, type Run } from "./backend";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import Hero from "./components/Hero";
import LaunchCard from "./components/LaunchCard";
import NewsGrid from "./components/NewsGrid";
import ProfilesPage from "./components/ProfilesPage";
import AccountsPage from "./components/AccountsPage";
import ModsPage from "./components/ModsPage";
import VersionsPage from "./components/VersionsPage";
import ParticleCanvas from "./components/ParticleCanvas";
import Toast from "./components/Toast";
import Icon from "./components/Icon";
import TitleBar from "./components/TitleBar";
import ProfileWizard from "./components/ProfileWizard";
import ServerPanel from "./components/ServerPanel";
import MusicPlayer from "./components/MusicPlayer";
import UpdateNotice from "./components/UpdateNotice";
import JavaPrompt from "./components/JavaPrompt";
import { loaderLabel } from "./profile";
import SettingsPage from "./components/SettingsPage";
import StoragePage from "./components/StoragePage";
import { useAppearance } from "./appearance";
import { t } from "./i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import PClientShell from "./pclient/PClientShell";
import PClientHome from "./pclient/PClientHome";
import PClientAccounts from "./pclient/PClientAccounts";
import PClientModules from "./pclient/PClientModules";
import PClientServers from "./pclient/PClientServers";
import PClientVersions from "./pclient/PClientVersions";
export default function App() {
  // Dil veya tercih değişince tüm ağaç yeniden çizilir.
  const { prefs } = useAppearance();
  const [showDetails, setShowDetails] = useState(false);
  const [page, setPage] = useState<Page>("home"),
    [state, setState] = useState<Snapshot | null>(null),
    [wizard, setWizard] = useState(false),
    [gameMode, setGameMode] = useState<"quick" | "profile">("quick"),
    [profileWorking, setProfileWorking] = useState(false),
    [articles, setArticles] = useState<Article[]>([]),
    [error, setError] = useState(""),
    [javaAsk, setJavaAsk] = useState(false),
    [message, setMessage] = useState(""),
    [visible, setVisible] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [log, setLog] = useState<string[]>([]);
  const main = useRef<HTMLElement>(null),
    parallax = useRef({ tx: 0, ty: 0, mx: 0, my: 0 }),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    mounted = useRef(true),
    checked = useRef("");
  const toast = useCallback((m: string) => {
    setMessage(
      m.length > 110 || /[A-Za-z]:[\\/]/.test(m)
        ? t("İşlem bilgisi güncellendi. Ayrıntılar işlem geçmişinde.")
        : m,
    );
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2600);
  }, []);
  const run: Run = useCallback(
    async <K extends CommandName>(command: K, args: CommandArgs[K]) => {
      try {
        setError("");
        const reply = await call(command, args);
        if (mounted.current) {
          setState(reply.state);
          if (reply.news !== null) setArticles(reply.news);
        }
        return reply;
      } catch (e) {
        if (mounted.current) {
          const m = String(e);
          setError(m);
          setLog((old) => [...old.slice(-59), m]);
          toast(t("İşlem tamamlanamadı. Ayrıntıları görüntüleyebilirsin."));
        }
        return undefined;
      }
    },
    [toast],
  );
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const cleanups: (() => void)[] = [];
    (async () => {
      try {
        const stateOff = await listen<Snapshot>(
          "patronlauncher://state",
          (e) => {
            if (active) setState(e.payload);
          },
        );
        if (!active) {
          stateOff();
          return;
        }
        cleanups.push(stateOff);
        const catalogOff = await listen<{
          versions: import("./versions").CatalogVersion[];
          warning?: string;
        }>("patronlauncher://catalog", (e) => {
          if (active) {
            saveCatalog(e.payload.versions);
            if (e.payload.warning) toast(e.payload.warning);
          }
        });
        if (!active) {
          catalogOff();
          return;
        }
        cleanups.push(catalogOff);
        const eventOff = await listen<EventEnvelope>(
          "patronlauncher://core-event",
          ({ payload }) => {
            if (!active) return;
            const e = payload.event;
            if (e.kind === "status")
              setLog((old) => [...old.slice(-59), e.result]);
            if (payload.progress)
              setProgress(
                (payload.progress.current / payload.progress.total) * 100,
              );
            if (
              e.kind === "finished" ||
              e.kind === "java_checked" ||
              e.kind === "java_installed" ||
              e.kind === "account"
            )
              setProgress(null);
            // Giriş arka planda biter; sonucu görünür kıl (aksi halde hata sessizce kaybolur).
            // Başlatmada Java eksik çıkarsa dikkat çekici Java penceresi açılır.
            if (e.kind === "java_checked" && "Ok" in e.result && e.result.Ok.kind === "missing") setJavaAsk(true);
            if (e.kind === "java_installed" && "Err" in e.result) setError(e.result.Err);
            if (e.kind === "account") {
              if ("Err" in e.result) setError(e.result.Err);
              else toast(t("Hesap eklendi: ") + e.result.Ok.name);
            }
            if (e.kind === "news" && "Ok" in e.result) setArticles(e.result.Ok);
          },
        );
        if (!active) {
          eventOff();
          return;
        }
        cleanups.push(eventOff);
        const initial = await run("get_state", {});
        if (active && initial && !initial.state.load_failed) {
          void warmCatalog().catch(() => {});
          await run("list_versions", { refresh: false });
          if (active) await run("get_news", { refresh: false });
        }
      } catch (e) {
        if (active) setError(String(e));
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
      cleanups.forEach((off) => off());
      clearTimeout(timer.current);
    };
  }, [run]);
  useEffect(() => {
    main.current?.scrollTo(0, 0);
    parallax.current.tx = parallax.current.ty = parallax.current.mx = parallax.current.my = 0;
  }, [page]);
  useEffect(() => {
    if (
      !state ||
      state.busy ||
      profileWorking ||
      state.load_failed ||
      !state.selected_version
    )
      return;
    const key = [
      state.selected_profile,
      state.selected_version,
      state.settings.java_path,
    ].join("|");
    if (key !== checked.current) {
      checked.current = key;
      void run("check_java", {});
    }
  }, [state, run, profileWorking]);
  useEffect(() => {
    document.documentElement.dataset.page = page;
    document.getElementById("root")!.dataset.page = page;
  }, [page]);
  const selected =
    state?.profiles.find((p) => p.id === state.selected_profile) ??
    state?.quick_profile ??
    undefined;
  useEffect(() => {
    if (state?.quick_profile) setGameMode("quick");
    else if (state?.profiles.some((p) => p.id === state.selected_profile))
      setGameMode("profile");
  }, [state?.selected_profile]);
  const activeGame =
    gameMode === "quick"
      ? (state?.quick_profile ?? undefined)
      : state?.profiles.find((p) => p.id === state.selected_profile);
  useEffect(() => {
    document.documentElement.dataset.running = state?.running
      ? "true"
      : "false";
  }, [state?.running]);
  // Oyun başladığında/kapandığında launcher penceresi tercihe göre davranır.
  const wasRunning = useRef(false),
    minimizedByLaunch = useRef(false);
  useEffect(() => {
    const running = !!state?.running;
    if (running === wasRunning.current) return;
    wasRunning.current = running;
    if (!isTauri()) {
      if (running && prefs.home_on_launch) setPage("home");
      return;
    }
    const win = getCurrentWindow();
    if (running) {
      if (prefs.home_on_launch) setPage("home");
      if (prefs.launch_behavior === "minimize") {
        minimizedByLaunch.current = true;
        void win.minimize().catch(() => {});
      }
    } else if (minimizedByLaunch.current) {
      minimizedByLaunch.current = false;
      if (prefs.restore_on_exit)
        void win
          .unminimize()
          .then(() => win.setFocus())
          .catch(() => {});
    }
  }, [state?.running]);
  const pclient = prefs.ui_mode === "pclient";
  // Modüller sayfası yalnızca PClient'ta var; profil, sürüm, mod ve dosya sayfaları yalnızca
  // PatronLauncher arayüzünde. Arayüz değişince geçersiz sayfadan ana sayfaya geçilir.
  useEffect(() => {
    const launcherOnly: Page[] = ["profiles", "versions", "mods", "folder"];
    const pclientOnly: Page[] = ["modules", "servers", "editions"];
    if ((!pclient && pclientOnly.includes(page)) || (pclient && launcherOnly.includes(page))) setPage("home");
  }, [pclient, page]);
  const notice = (m: string) => {
    toast(m);
    setLog((old) => [...old.slice(-59), m]);
  };
  /** Ana sayfa dışındaki sayfalar iki arayüzde de aynı bileşenlerle çalışır. */
  const sharedPage = (s: Snapshot) =>
    page === "versions" ? (
      <VersionsPage s={s} run={run} go={setPage} onWorking={setProfileWorking} />
    ) : page === "mods" ? (
      <ModsPage
        s={s}
        onState={setState}
        goSettings={() => setPage("settings")}
        notice={notice}
      />
    ) : page === "profiles" ? (
      <ProfilesPage s={s} run={run} go={setPage} create={() => setWizard(true)} />
    ) : page === "account" ? (
      <AccountsPage s={s} run={run} />
    ) : page === "folder" ? (
      <StoragePage s={s} run={run} />
    ) : page === "settings" ? (
      <SettingsPage s={s} run={run} go={setPage} />
    ) : (
      <div className="glass activity-log">
        {log.length ? (
          log.map((line, i) => (
            <p key={i} style={{ "--i": Math.min(i, 20) } as React.CSSProperties}>
              {statusText(line)}
            </p>
          ))
        ) : (
          <p className="lbl">{t("Bu oturumda henüz bir işlem yapılmadı.")}</p>
        )}
      </div>
    );
  const pageKey =
    page === "versions" || page === "home" || page === "mods"
      ? page
      : `${page}-${state?.selected_profile ?? ""}`;
  const statusBar = (
    <div className="compact-status">
      <span id="st" className="sr-only" aria-hidden="true">
        {error || statusText(state?.status) || t("Çekirdeğe bağlanılıyor…")}
      </span>
      {state?.busy && !state.running && (
        <div className="install-status" role="status">
          <span>
            {(
              state.quick_profile ??
              state.profiles.find((p) => p.id === state.selected_profile)
            )?.loader ?? "Minecraft"}{" "}
            {(
              state.quick_profile ??
              state.profiles.find((p) => p.id === state.selected_profile)
            )?.version ?? ""}{" "}
            ·{" "}
            {state.status.startsWith("Microsoft")
              ? t("Giriş bekleniyor")
              : t("Hazırlanıyor / kuruluyor")}
            {progress !== null ? ` %${Math.round(progress)}` : ""}
          </span>
          <button className="btn" onClick={() => void run("cancel_operation", {})}>
            {t("İptal")}
          </button>
        </div>
      )}
      {error && (
        <div className="status-error" role="alert">
          <span>{t("İşlem tamamlanamadı.")}</span>
          <span className="status-error-actions">
            <button className="btn" onClick={() => setShowDetails(true)}>
              {t("Ayrıntılar")}
            </button>
            <button className="alert-close" aria-label={t("Kapat")} title={t("Kapat")} onClick={() => setError("")}>
              <Icon name="close" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
  const pclientContent = (
    <PClientShell
      s={state}
      run={run}
      page={page}
      go={setPage}
      mainRef={main}
      status={statusBar}
    >
      {state ? (
        <div className="page pc-page" id="pg" key={pageKey}>
          {page === "home" ? (
            <PClientHome
              s={state}
              run={run}
              go={setPage}
              articles={articles}
              progress={progress}
              mode={gameMode}
              setMode={setGameMode}
              game={activeGame}
              notice={notice}
              createProfile={() => {
                setPage("profiles");
                setWizard(true);
              }}
            />
          ) : page === "account" ? (
            <PClientAccounts s={state} run={run} />
          ) : page === "modules" ? (
            <PClientModules />
          ) : page === "servers" ? (
            <PClientServers s={state} run={run} notice={notice} />
          ) : page === "editions" ? (
            <PClientVersions s={state} run={run} />
          ) : (
            sharedPage(state)
          )}
        </div>
      ) : (
        <div className="empty startup-skeleton" role="status">
          {error || t("Launcher kayıtları yükleniyor…")}
        </div>
      )}
    </PClientShell>
  );
  const content = pclient ? (
    pclientContent
  ) : (
    <>
      <div className="glow g1" />
      <div className="glow g2" />
      <ParticleCanvas
        parallax={parallax}
        page={page}
        running={state?.running ?? false}
      />
      <div className="app">
        <Sidebar
          page={page}
          selected={activeGame}
          mode={gameMode}
          go={setPage}
          createProfile={() => {
            setPage("profiles");
            setWizard(true);
          }}
        />
        <main id="main" ref={main}>
          {state ? (
            <>
              <Header page={page} s={state} run={run} go={setPage} />
              <div className="page" id="pg" key={pageKey}>
                {page === "home" ? (
                  <div className="home-layout">
                    <div className="home-main">
                      <Hero
                        name={
                          activeGame?.name ?? t("Yeni bir dünya seni bekliyor.")
                        }
                        welcome={
                          state.accounts.find(
                            (a) => a.id === state.selected_account,
                          )
                            ? t("Tekrar hoş geldin, {name}.", {
                                name: state.accounts.find(
                                  (a) => a.id === state.selected_account,
                                )!.name,
                              })
                            : t("PatronLauncher’a hoş geldin.")
                        }
                        parallax={parallax}
                        loader={loaderLabel(activeGame)}
                      >
                        <LaunchCard
                          s={state}
                          run={run}
                          go={setPage}
                          progress={progress}
                          mode={gameMode}
                          setMode={setGameMode}
                        />
                      </Hero>
                      <NewsGrid articles={articles} s={state} run={run} />
                    </div>
                    <ServerPanel s={state} run={run} notice={notice} />
                  </div>
                ) : (
                  sharedPage(state)
                )}
              </div>
            </>
          ) : (
            <div className="empty startup-skeleton" role="status">
              {error || t("Launcher kayıtları yükleniyor…")}
            </div>
          )}
          {statusBar}
        </main>
      </div>
    </>
  );
  const overlays = (
    <>
      {showDetails && (
        <Modal
          title={t("İşlem ayrıntıları")}
          close={() => setShowDetails(false)}
        >
          <pre className="technical-details">{error || statusText(state?.status)}</pre>
          <button
            className="btn"
            onClick={() => {
              setShowDetails(false);
              setPage("activity");
            }}
          >
            {t("İşlem geçmişine git")}
          </button>
        </Modal>
      )}
      <MusicPlayer running={state?.running ?? false} />
      <UpdateNotice blocked={!!state?.running} />
      {javaAsk && state && <JavaPrompt s={state} run={run} close={() => setJavaAsk(false)} />}
      <Toast message={message} visible={visible} close={() => setVisible(false)} />
      {wizard && state && (
        <ProfileWizard s={state} run={run} close={() => setWizard(false)} />
      )}
    </>
  );
  return isTauri() ? (
    <div className="desktop-shell">
      <TitleBar onError={toast} />
      <div className="prototype-viewport">
        {content}
        {overlays}
      </div>
    </div>
  ) : (
    <>
      {content}
      {overlays}
    </>
  );
}
