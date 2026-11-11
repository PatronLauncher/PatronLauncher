import { statusText } from "../statusText";
import { t } from "../i18n";
import { Select, Toggle } from "./Controls";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  EventEnvelope,
  Loader,
  LoaderVersions,
  PerformancePlan,
  Snapshot,
} from "../types/core";
import type { Run } from "../backend";
import type { Page } from "../navigation";
import { loaderIcons } from "../loaderIcons";
import { msg } from "../i18n";

const {
  Vanilla: vanillaIcon,
  Fabric: fabricIcon,
  Quilt: quiltIcon,
  Forge: forgeIcon,
  NeoForge: neoforgeIcon,
  OptiFine: optifineIcon,
} = loaderIcons;

// Sürümle birlikte kurulabilen Fabric modları; anahtarlar çekirdekteki listeyle aynıdır.
const addons: [string, string, string][] = [
  ["sodium", "Sodium", msg("FPS artışı")],
  ["lithium", "Lithium", msg("Oyun mantığı optimizasyonu")],
  ["ferritecore", "FerriteCore", msg("Daha az RAM")],
  ["iris", "Iris Shaders", msg("Shader desteği")],
  ["immediatelyfast", "ImmediatelyFast", msg("Hızlı çizim")],
  ["entityculling", "Entity Culling", msg("Görünmeyenleri gizler")],
  ["modmenu", "Mod Menu", msg("Mod listesi menüsü")],
  ["zoomify", "Zoomify", msg("Yakınlaştırma")],
  ["continuity", "Continuity", msg("Bağlantılı dokular")],
];
// Fabric dışındaki yükleyiciler; hepsi tek tıkla kurulur.
const others: [Loader, string][] = [
  ["Quilt", quiltIcon],
  ["NeoForge", neoforgeIcon],
  ["Forge", forgeIcon],
  ["OptiFine", optifineIcon],
];
import type { InstalledVersion } from "../types/core";

const cached = new Map<string, { at: number; value: LoaderVersions }>();
function LoaderIcon({ fabric = false }: { fabric?: boolean }) {
  return (
    <img
      className="i"
      src={fabric ? fabricIcon : vanillaIcon}
      alt=""
      width={22}
      height={22}
    />
  );
}
export default function VersionSetup({
  mc,
  supported,
  s,
  run,
  go,
  installed,
  onInstalled,
  onJob,
  onWorking,
}: {
  mc: string;
  supported: boolean;
  s: Snapshot;
  run: Run;
  go: (p: Page) => void;
  installed: InstalledVersion[];
  onInstalled: () => Promise<void>;
  onJob: (job: { mc: string; progress: number | null } | null) => void;
  onWorking: (value: boolean) => void;
}) {
  const [loader, setLoader] = useState<Loader>("Vanilla"),
    [loaderVersion, setLoaderVersion] = useState(""),
    [options, setOptions] = useState<LoaderVersions | null>(null),
    [loading, setLoading] = useState(true),
    [loaderError, setLoaderError] = useState(""),
    [retry, setRetry] = useState(0),
    [picked, setPicked] = useState<string[]>([]),
    [plan, setPlan] = useState<PerformancePlan | null>(null),
    [previewing, setPreviewing] = useState(false),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<number | null>(null),
    [status, setStatus] = useState("");
  const chooseAfter = useRef(false);
  const mounted = useRef(true),
    installing = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => onWorking(creating || previewing),
    [creating, previewing, onWorking],
  );
  // Fabric uyumluluğu önceden, diğer yükleyiciler seçilince sorgulanır.
  const query = loader === "Vanilla" ? "Fabric" : loader;
  useEffect(() => {
    if (!supported) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setLoaderError("");
    setOptions(null);
    const key = `${query}:${mc}`;
    const entry = cached.get(key);
    const request =
      retry === 0 && entry && Date.now() - entry.at < 120000
        ? Promise.resolve(entry.value)
        : invoke<LoaderVersions>("list_loader_versions", {
            minecraftVersion: mc,
            loader: query,
          });
    request
      .then((value) => {
        if (cached.size >= 32) cached.delete(cached.keys().next().value!);
        cached.set(key, { at: Date.now(), value });
        if (active) {
          setOptions(value);
          setLoaderVersion(value.default_version ?? "");
        }
      })
      .catch((e) => {
        if (active) setLoaderError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mc, supported, retry, query]);
  useEffect(() => {
    let active = true;
    let off: (() => void) | undefined;
    listen<EventEnvelope>("patronlauncher://core-event", ({ payload }) => {
      if (!active || !installing.current) return;
      if (payload.event.kind === "finished") {
        installing.current = false;
        setCreating(false);
        onJob(null);
        if ("Ok" in payload.event.result) setPicked([]);
        if ("Err" in payload.event.result) setError(payload.event.result.Err);
        void onInstalled();
        if (chooseAfter.current && "Ok" in payload.event.result) {
          chooseAfter.current = false;
          void invoke<InstalledVersion[]>("list_installed_versions")
            .then(async (list) => {
              const v = list.find(
                (v) =>
                  v.mc === mc &&
                  v.loader === loader &&
                  (loader === "Vanilla" || v.loader_version === loaderVersion),
              );
              if (
                v?.quick_id &&
                (await run("select_quick", { id: v.quick_id }))
              )
                go("home");
            })
            .catch((e) => setError(String(e)));
        }
      }
      if (payload.event.kind === "status") setStatus(payload.event.result);
      if (payload.progress) {
        onJob({
          mc,
          progress: payload.progress.current / payload.progress.total,
        });
        setProgress(
          Math.max(
            0,
            Math.min(1, payload.progress.current / payload.progress.total),
          ),
        );
      }
    })
      .then((cleanup) => {
        if (active) off = cleanup;
        else cleanup();
      })
      .catch(() => {});
    return () => {
      active = false;
      off?.();
    };
  }, [mc, onJob, onInstalled, loader, loaderVersion, run, go]);
  useEffect(() => {
    if (plan && !dialog.current?.open) dialog.current?.showModal();
    else if (!plan && dialog.current?.open) dialog.current?.close();
  }, [plan]);
  const performance = loader === "Fabric" && picked.length > 0;
  const working = creating || previewing,
    unavailable =
      !supported || loading || !!loaderError || !options?.versions.length;
  const reason = !supported
    ? t("Bu Minecraft sürümü mevcut çekirdekte desteklenmiyor.")
    : loading
      ? t("{name} uyumluluğu kontrol ediliyor…", { name: query })
      : loaderError
        ? t("{name} bilgisi alınamadı: {error}", { name: query, error: loaderError })
        : !options?.versions.length
          ? t("{name} bu Minecraft sürümünü desteklemiyor.", { name: query })
          : "";
  const current = installed.find(
    (v) =>
      v.mc === mc &&
      v.loader === loader &&
      (loader === "Vanilla" || v.loader_version === loaderVersion),
  );
  const create = async (approved: PerformancePlan | null) => {
    if (working || s.busy || s.load_failed || !supported) return;
    setPlan(null);

    onWorking(true);
    setCreating(true);
    installing.current = true;
    setError("");
    setProgress(null);
    setStatus(t("Sürüm kuruluyor…"));
    onJob({ mc, progress: null });
    try {
      const result = await run("install_version", {
        mc,
        loader,
        loaderVersion: loader === "Vanilla" ? null : loaderVersion,
        planId: approved?.plan_id ?? null,
        confirmed: !!approved,
      });
      if (!result) {
        setCreating(false);
        installing.current = false;
        onJob(null);
      }
    } finally {
      // The command starts a worker; completion is reported by core events.
    }
  };
  const submit = async (play = false) => {
    if (working || s.busy || s.load_failed || !supported) return;

    setError("");
    if (performance) {
      onWorking(true);
      setPreviewing(true);
      try {
        const result = await invoke<PerformancePlan>(
          "preview_performance_pack",
          { minecraftVersion: mc, mods: picked },
        );
        if (mounted.current) {
          setPlan(result);
        }
      } catch (e) {
        if (mounted.current) setError(String(e));
      } finally {
        if (mounted.current) setPreviewing(false);
      }
    } else await create(null);
  };
  return (
    <>
      <div className="lbl">{t("MOD YÜKLEYİCİ")}</div>
      <div className="v-loaders loader-tiles" role="group" aria-label={t("Mod yükleyici")}>
        <button
          className={`loader-tile ${loader === "Vanilla" ? "v-loader-selected" : ""}`}
          aria-pressed={loader === "Vanilla"}
          disabled={working}
          title="Vanilla"
          onClick={() => {
            setLoader("Vanilla");
            setPicked([]);
            setError("");
          }}
        >
          <LoaderIcon />
          <span>Vanilla</span>
        </button>
        <button
          className={`loader-tile ${loader === "Fabric" ? "v-loader-selected" : ""}`}
          aria-pressed={loader === "Fabric"}
          disabled={working || !supported}
          title="Fabric"
          aria-describedby={reason ? "fabric-unavailable" : undefined}
          onClick={() => {
            setLoader("Fabric");
            setError("");
          }}
        >
          <LoaderIcon fabric />
          <span>Fabric</span>
        </button>
        {others.map(([name, icon]) => (
          <button
            key={name}
            className={`loader-tile ${loader === name ? "v-loader-selected" : ""}`}
            aria-pressed={loader === name}
            disabled={working || !supported}
            title={name}
            onClick={() => {
              setLoader(name);
              setPicked([]);
              setError("");
            }}
          >
            <img className="i" src={icon} alt="" width={22} height={22} />
            <span>{name}</span>
          </button>
        ))}
      </div>
      {reason && (loader !== "Vanilla" || !supported) && (
        <p className="lbl" id="fabric-unavailable">
          {reason}
        </p>
      )}
      {loaderError && (
        <button
          className="btn"
          disabled={working}
          onClick={() => setRetry((n) => n + 1)}
        >{t("Yükleyici bilgisini yeniden al")}</button>
      )}
      {loader !== "Vanilla" && !!options?.versions.length && (
        <>
          <label className="lbl" htmlFor="fabric-loader-version">
            {t("{name} SÜRÜMÜ", { name: loader.toLocaleUpperCase("en") })}
          </label>
          <Select
            id="fabric-loader-version"
            aria-label={t("{name} sürümü", { name: loader })}
            disabled={working}
            value={loaderVersion}
            onChange={(e) => setLoaderVersion(e.target.value)}
          >
            <option value="" disabled>{t("Loader sürümü seç")}</option>
            {options?.versions.map((v) => (
              <option value={v.version} key={v.version}>
                {v.version.replace("+", " ")}
                {v.stable ? t(" · Kararlı") : t(" · Deneysel")}
              </option>
            ))}
          </Select>
          {loader === "Fabric" && (<>
          <div className="lbl addon-head">
            {t("SÜRÜMLE BİRLİKTE KUR")}
            <small>{t("İstediklerini işaretle")}</small>
          </div>
          <div className="addon-grid" role="group" aria-label={t("Sürümle birlikte kur")}>
            {addons.map(([key, name, hint]) => {
              const on = picked.includes(key);
              return (
                <label key={key} className={"addon-chip " + (on ? "on" : "")} title={t(hint)}>
                  <Toggle
                    type="checkbox"
                    aria-label={name}
                    checked={on}
                    disabled={working}
                    onChange={() => {
                      setPicked((old) => (on ? old.filter((k) => k !== key) : [...old, key]));
                      setPlan(null);
                      setError("");
                    }}
                  />
                  <span>
                    <b>{name}</b>
                    <small>{t(hint)}</small>
                  </span>
                </label>
              );
            })}
          </div>
          {performance && (
            <p className="lbl">{t("Seçtiğin modlar ve gerekli bağımlılıkları Modrinth'ten bulunur. İndirmeden önce listeyi onayına sunacağız.")}</p>
          )}
          </>)}
          {(loader === "NeoForge" || loader === "Forge" || loader === "OptiFine") && (
            <p className="lbl">{t("Kurulum sırasında resmî kurulum adımları Java ile çalıştırılır; ilk kurulum birkaç dakika sürebilir.")}</p>
          )}
        </>
      )}
      <div className="actions">
        <button
          id="version-install"
          className="btn v-add"
          disabled={
            working ||
            s.busy ||
            !supported ||
            (!!current && !performance) ||
            (loader !== "Vanilla" && unavailable)
          }
          onClick={() => void submit()}
        >
          {current && !performance ? t("Kuruldu ✓") : t("Kur")}
        </button>
        {current && (
          <button
            className="btn"
            disabled={working || s.busy}
            onClick={async () => {
              if (current.quick_id) {
                if (await run("select_quick", { id: current.quick_id }))
                  go("home");
              } else {
                chooseAfter.current = true;
                await create(null);
              }
            }}
          >{t("Oyna")}</button>
        )}
      </div>
      {error && (
        <p role="alert" className="lbl">
          {error}
        </p>
      )}
      {(creating || previewing) && (
        <div className="v-install-status" role="status">
          {previewing
            ? t("Modrinth uyumluluğu ve bağımlılıklar kontrol ediliyor; henüz mod indirilmiyor.")
            : status || statusText(s.status)}
          {creating && (
            <progress
              aria-label={t("Sürüm indirme ilerlemesi")}
              max={1}
              value={progress ?? undefined}
            />
          )}{" "}
          {creating && progress !== null && (
            <span>{Math.round(progress * 100)}%</span>
          )}
          {creating && (
            <button
              className="btn"
              onClick={() => void run("cancel_operation", {})}
            >{t("Kurulumu iptal et")}</button>
          )}
        </div>
      )}
      <dialog
        ref={dialog}
        className="v-mod-consent"
        aria-labelledby="mod-consent-title"
        onCancel={() => {
          setPlan(null);
        }}
        onClose={() => setPlan(null)}
      >
        {plan && (
          <>
            <h2 id="mod-consent-title">{t("Mod indirmesini onayla")}</h2>
            <p className="lbl">
              Minecraft {plan.minecraft_version} {t("· Fabric · Modrinth")}<br />
              {plan.mods.length} {t("dosya ·")}{" "}
              {(plan.total_size / 1048576).toFixed(1)} {t("MB")}</p>
            <ul>
              {plan.mods.map((mod) => (
                <li key={mod.project_id}>
                  <strong>{mod.title}</strong>
                  <span>
                    {mod.version}
                    {mod.dependency ? t(" · Gerekli bağımlılık") : ""}
                  </span>
                  <small>
                    {mod.filename} · {(mod.size / 1048576).toFixed(2)} {t("MB")}</small>
                </li>
              ))}
            </ul>
            {plan.warnings.map((warning, i) => (
              <p key={i} className="lbl">
                {warning}
              </p>
            ))}
            <p className="lbl">{t("Bu dosyalar bu sürümün izole mods klasörüne indirilecek. SHA-1 / SHA-512 sağlama toplamları doğrulanacak.")}</p>
            <div className="actions">
              <button
                type="button"
                className="btn"
                autoFocus
                onClick={() => {
                  setPlan(null);
                }}
              >{t("İndirmeden vazgeç")}</button>
              <button
                type="button"
                className="btn v-add"
                onClick={() => void create(plan)}
              >{t("Onayla ve kur")}</button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
