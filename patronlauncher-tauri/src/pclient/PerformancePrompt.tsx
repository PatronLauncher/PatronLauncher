import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import Modal from "../components/Modal";
import { Toggle } from "../components/Controls";

/** Rust: pclient::ReleaseInfo */
export type PClientRelease = {
  minecraft: string;
  ready: boolean;
  installed: boolean;
  selected: boolean;
  /** Bu sürüm için performans modları kararı; null: henüz sorulmadı. */
  performance: "installed" | "declined" | null;
};
type Request = { minecraft: string; done: (proceed: boolean) => void };

let ask: ((request: Request) => void) | null = null;
/** Hatırlatma launcher oturumu başına bir kez gösterilir. */
let reminded = false;

/**
 * Seçili PClient sürümü için karar verilmemişse oyuncuya sorar.
 * false dönerse oyuncu pencereyi kapatmıştır; başlatma iptal edilir.
 */
export async function ensurePerformanceChoice(): Promise<boolean> {
  const list = await invoke<PClientRelease[]>("pclient_versions").catch(() => null);
  const selected = Array.isArray(list) ? list.find((r) => r.selected) : undefined;
  if (!selected?.ready || selected.performance !== null || !ask) return true;
  const open = ask;
  return new Promise((done) => open({ minecraft: selected.minecraft, done }));
}

const SOURCES: [string, string][] = [
  ["Sodium", "https://modrinth.com/mod/sodium"],
  ["Lithium", "https://modrinth.com/mod/lithium"],
  ["FerriteCore", "https://modrinth.com/mod/ferrite-core"],
  ["ImmediatelyFast", "https://modrinth.com/mod/immediatelyfast"],
  ["Krypton", "https://modrinth.com/mod/krypton"],
  ["BadOptimizations", "https://modrinth.com/mod/badoptimizations"],
];

/** PClient arayüzündeki performans modları onayı ile kurulmamış sürümlerin hatırlatması. */
export default function PerformancePrompt() {
  const [request, setRequest] = useState<Request | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    ask = setRequest;
    return () => {
      ask = null;
    };
  }, []);

  useEffect(() => {
    if (reminded) return;
    let alive = true;
    void Promise.all([
      invoke<PClientRelease[]>("pclient_versions"),
      invoke<boolean>("pclient_performance_notice"),
    ])
      .then(([list, hidden]) => {
        if (!alive || reminded || hidden || !Array.isArray(list)) return;
        const declined = list.filter((r) => r.ready && r.performance === "declined").map((r) => r.minecraft);
        if (declined.length) {
          reminded = true;
          setMissing(declined);
        }
      })
      .catch(() => {
        /* hatırlatma gösterilmez; oyun etkilenmez */
      });
    return () => {
      alive = false;
    };
  }, []);

  const finish = (proceed: boolean) => {
    request?.done(proceed);
    setRequest(null);
    setError("");
  };
  const choose = async (install: boolean) => {
    if (!request) return;
    setBusy(true);
    setError("");
    try {
      await invoke("pclient_performance", { version: request.minecraft, install });
      // Az önce karar verdi; aynı oturumda ayrıca hatırlatılmaz.
      reminded = true;
      finish(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const closeReminder = () => {
    if (hide) void invoke("pclient_performance_hide", { hidden: true }).catch(() => {});
    setMissing([]);
  };
  const installMissing = async () => {
    setBusy(true);
    setError("");
    try {
      for (const version of missing) await invoke("pclient_performance", { version, install: true });
      setMissing([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const sources = (
    <p className="pc-perf-sources">
      {SOURCES.map(([name, url]) => (
        <button key={name} className="pc-link" onClick={() => void invoke("open_external", { url }).catch(() => {})}>
          {name}
        </button>
      ))}
    </p>
  );
  const failure = error && (
    <p className="pc-error" role="alert">
      {error}
    </p>
  );

  if (request)
    return (
      <Modal title={t("Performans modları kurulsun mu?")} close={() => finish(false)} locked={busy}>
        <p>
          {t(
            "Bu açık kaynak modlar FPS'i artırır, bellek kullanımını azaltır ve oyunu hafifletir. Doğrudan Modrinth'ten indirilir ve yalnızca PClient {version} için kurulur.",
            { version: request.minecraft },
          )}
        </p>
        {sources}
        {failure}
        <div className="actions pc-perf-actions">
          <button className="btn" disabled={busy} onClick={() => void choose(false)}>
            {t("Kurmadan devam et")}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void choose(true)}>
            {busy ? t("Kuruluyor…") : t("Kur ve devam et")}
          </button>
        </div>
      </Modal>
    );
  if (missing.length)
    return (
      <Modal title={t("Performans modları içermeyen sürümler")} close={closeReminder} locked={busy}>
        <p>{t("Bu PClient sürümlerini performans modları olmadan kurdun. Şimdi kurmak ister misin?")}</p>
        <ul className="pc-perf-list">
          {missing.map((v) => (
            <li key={v}>Minecraft {v}</li>
          ))}
        </ul>
        {sources}
        {failure}
        <label className="appearance-switch">
          <span>{t("Bir daha gösterme")}</span>
          <Toggle role="switch" checked={hide} onChange={(e) => setHide(e.target.checked)} />
        </label>
        <div className="actions pc-perf-actions">
          <button className="btn" disabled={busy} onClick={closeReminder}>
            {t("Daha sonra")}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void installMissing()}>
            {busy ? t("Kuruluyor…") : t("Şimdi kur")}
          </button>
        </div>
      </Modal>
    );
  return null;
}
