import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { t } from "../i18n";
import { ORACLE_JAVA_URL } from "./JavaPrompt";
export function JavaCard({
  s,
  run,
  embedded = false,
}: {
  s: Snapshot;
  run: Run;
  embedded?: boolean;
}) {
  const body = (
    <>
      {!embedded && <h4>{t("Java yönetimi")}</h4>}
      <p className="lbl">
        {s.java_status?.kind === "missing"
          ? s.java_status.reason
          : s.java_status?.kind === "ready"
            ? t("Java {major} hazır", { major: s.java_status.major })
            : t("Seçilen sürümün Java uyumluluğunu kontrol edin.")}
      </p>
      <div className="actions">
        <button
          className="btn"
          disabled={s.busy || s.load_failed || !s.selected_version}
          onClick={() => void run("check_java", {})}
        >
          {t("Java kontrol et")}
        </button>
        <button
          className="btn"
          disabled={s.busy || s.load_failed || (!s.selected_version && s.java_status?.kind !== "missing")}
          onClick={() => void run("install_java", {})}
        >
          {t("PatronLauncher ile Java indir")}
        </button>
        <button
          className="btn"
          onClick={() => void run("open_external", { url: ORACLE_JAVA_URL })}
        >
          {t("Resmî Java indirme sayfası (Oracle)")}
        </button>
      </div>
    </>
  );
  return embedded ? (
    <div className="java-embedded">{body}</div>
  ) : (
    <section className="glass">{body}</section>
  );
}
