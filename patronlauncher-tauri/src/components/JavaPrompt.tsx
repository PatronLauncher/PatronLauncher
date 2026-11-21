import { useEffect, useRef } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { statusText } from "../statusText";
import { t } from "../i18n";
import Icon from "./Icon";

export const ORACLE_JAVA_URL = "https://www.oracle.com/java/technologies/downloads/";

/** "Java 25 indiriliyor: 120 / 206 dosya" → yüzde. */
function percent(status: string): number | null {
  const m = status.match(/(\d+) \/ (\d+) dosya/);
  return m && Number(m[2]) > 0 ? Math.round((Number(m[1]) / Number(m[2])) * 100) : null;
}

/**
 * Oyunu başlatırken gereken Java bulunamazsa açılan dikkat çekici pencere. Tek tıkla
 * Minecraft'ın resmî Java paketini kurar; kurulum bitince oyun kendiliğinden başlar.
 */
export default function JavaPrompt({ s, run, close }: { s: Snapshot; run: Run; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const missing = s.java_status?.kind === "missing" ? s.java_status : null;
  const installing = s.busy && /^Java|Mojang|Eclipse/.test(s.status);
  const progress = installing ? percent(s.status) : null;
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  // Java hazır olunca (kurulum bitti, oyun başlıyor) pencere kendiliğinden kapanır.
  useEffect(() => {
    if (s.java_status?.kind === "ready") close();
  }, [s.java_status?.kind]);
  if (!missing) return null;
  const major = missing.major;
  return (
    <dialog
      ref={ref}
      className="java-prompt"
      aria-labelledby="java-prompt-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!installing) close();
      }}
    >
      <div className="java-prompt-glow" aria-hidden="true" />
      <div className={"java-prompt-icon" + (installing ? " busy" : "")} aria-hidden="true">
        <span className="java-prompt-ring" />
        <Icon name="java" />
      </div>
      <p className="java-prompt-kicker">{t("Oyunu başlatmak için bir adım kaldı")}</p>
      <h2 id="java-prompt-title">{t("Java {major} gerekli", { major })}</h2>
      <p className="java-prompt-text">
        {t("Bu Minecraft sürümü Java {major} ile çalışır ve bilgisayarında bulunamadı. PatronLauncher, Minecraft'ın resmî Java paketini indirip kurabilir; kurulum bitince oyun kendiliğinden başlar.", { major })}
      </p>
      {installing ? (
        <div className="java-prompt-progress" role="status">
          <div className="java-prompt-bar">
            <i style={{ width: `${progress ?? 8}%` }} className={progress === null ? "indeterminate" : ""} />
          </div>
          <small>{statusText(s.status)}</small>
        </div>
      ) : (
        <div className="java-prompt-actions">
          <button className="btn primary java-prompt-main" disabled={s.busy} onClick={() => void run("install_java", {})}>
            <Icon name="rocket" /> {t("Java {major}'i kur ve oyunu başlat", { major })}
          </button>
          <button className="btn" onClick={() => void run("open_external", { url: ORACLE_JAVA_URL })}>
            {t("Oracle'dan kendim indireyim")}
          </button>
          <button className="btn ghost" onClick={close}>
            {t("Daha sonra")}
          </button>
        </div>
      )}
      <small className="java-prompt-foot">
        {t("Kurulum yalnızca PatronLauncher klasörüne yapılır; bilgisayarındaki diğer Java'lara dokunulmaz.")}
      </small>
    </dialog>
  );
}
