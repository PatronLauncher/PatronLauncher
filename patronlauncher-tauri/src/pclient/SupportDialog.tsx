import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { t } from "../i18n";
import support from "../../src-tauri/resources/pclient/support.json";

/** Çekirdeğin oyun hata koduyla kapandığında yazdığı durum metni (game.rs). */
const CRASH = "hata koduyla kapandı";

/** Üst çubuktaki Destek düğmesinden açılır; oyun açılamadan kapanırsa kendiliğinden gelir. */
export default function SupportDialog({
  s,
  run,
  open,
  onOpen,
  onClose,
}: {
  s: Snapshot | null;
  run: Run;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [crashed, setCrashed] = useState(false);
  const wasCrashed = useRef(false);
  const status = s?.status ?? "";

  useEffect(() => {
    const now = status.includes(CRASH);
    if (now && !wasCrashed.current) {
      setCrashed(true);
      onOpen();
    }
    wasCrashed.current = now;
  }, [status, onOpen]);

  if (!open) return null;
  const close = () => {
    setCrashed(false);
    onClose();
  };
  return (
    <div className="pc-launch-overlay" role="dialog" aria-modal="true" aria-label={t("Destek")} onClick={close}>
      <div className="pc-launch-card" onClick={(e) => e.stopPropagation()}>
        <h3>{crashed ? t("Oyun açılamadı") : t("Destek")}</h3>
        <p>
          {crashed
            ? t("Uyumsuz bir mod ya da eksik bir dosya oyunu durdurmuş olabilir. Oyun klasöründeki patronlauncher-game.log dosyasını Discord sunucumuza veya web sitemize göndererek bizden yardım alabilirsin.")
            : t("Bir sorunla karşılaşırsan Discord sunucumuzdan veya web sitemizden bize ulaşabilirsin.")}
        </p>
        <div className="pc-launch-actions">
          <button
            className="pc-ghost-btn"
            disabled={!support.discord}
            title={support.discord ? undefined : t("Yakında")}
            onClick={() => void run("open_external", { url: support.discord })}
          >
            Discord
          </button>
          <button
            className="pc-ghost-btn"
            disabled={!support.website}
            title={support.website ? undefined : t("Yakında")}
            onClick={() => void run("open_external", { url: support.website })}
          >
            {t("Web sitesi")}
          </button>
          <button className="pc-ghost-btn" onClick={() => void run("open_folder", { target: "pclient" })}>
            {t("Oyun klasörü")}
          </button>
          <button className="pc-ghost-btn" onClick={close}>
            {t("Kapat")}
          </button>
        </div>
      </div>
    </div>
  );
}
