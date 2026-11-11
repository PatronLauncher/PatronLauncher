import { statusText } from "../statusText";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { t } from "../i18n";
import { onLaunch, type LaunchKind } from "./launch";
import logo from "../assets/patronlauncher3transparent-mark.png";

/** Arka planda bekleme penceresi kapanmadan önce oyunun açıldığı bu süre kadar gösterilir (ms). */
const DONE_FOR = 1600;
/** Başlatma duyurusundan sonra çekirdeğin meşgul olmasını bekleme payı (ms). */
const GRACE = 2500;

/**
 * "Oyun başlatılıyor" penceresi. Oyuncu Oyna/Bağlan/Kur'a bastığında açılır, oyun penceresi PClient
 * menüsüne ulaşınca (game_ready) ya da kurulum bitince kendiliğinden kapanır.
 */
export default function LaunchOverlay({ s, run }: { s: Snapshot | null; run: Run }) {
  const [kind, setKind] = useState<LaunchKind | null>(null);
  const [hidden, setHidden] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(0);
  const [now, setNow] = useState(Date.now());

  useEffect(
    () =>
      onLaunch((k) => {
        started.current = Date.now();
        setKind(k);
        setHidden(false);
        setDone(false);
      }),
    [],
  );
  useEffect(() => {
    if (!kind) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [kind]);

  // Kapanış koşulları.
  useEffect(() => {
    if (!kind || !s || done) return;
    const idle = !s.busy && !s.running;
    const fresh = Date.now() - started.current < GRACE;
    if (kind === "play" && s.running && s.game_ready) {
      setDone(true);
      window.setTimeout(() => setKind(null), DONE_FOR);
    } else if (kind === "play" && s.running && Date.now() - started.current > 90_000) {
      // İşaret gelmese bile (ör. eski PClient) oyun çoktan açılmıştır.
      setKind(null);
    } else if (idle && !fresh) {
      // Kurulum bitti, oyun kapandı ya da hata oldu: hata metni durum çubuğunda kalır.
      setKind(null);
    }
  }, [kind, s, done, now]);

  if (!kind || hidden || !s) return null;
  const seconds = Math.max(0, Math.round((now - started.current) / 1000));
  const title = done
    ? t("Oyun açıldı. İyi oyunlar!")
    : kind === "install"
      ? t("PClient kuruluyor")
      : s.running
        ? t("Oyun açılıyor")
        : t("Oyun başlatılıyor");
  const hint =
    kind === "install"
      ? t("Oyun dosyaları indiriliyor. İlk kurulum internet hızına göre birkaç dakika sürebilir.")
      : t("Bu biraz zaman alabilir, lütfen bekle. Oyun penceresi açılınca bu bildirim kendiliğinden kapanır.");
  return (
    <div className="pc-launch-overlay" role="dialog" aria-modal="false" aria-live="polite" aria-label={title}>
      <div className={"pc-launch-card " + (done ? "done" : "")}>
        <div className="pc-launch-orb" aria-hidden="true">
          <i />
          <img src={logo} alt="" />
        </div>
        <h3>{title}</h3>
        {!done && <p>{hint}</p>}
        {!done && (
          <div className="pc-launch-progress" aria-hidden="true">
            <i />
          </div>
        )}
        {!done && (
          <small className="pc-launch-status">
            {statusText(s.status)} · {seconds} sn
          </small>
        )}
        {!done && (
          <div className="pc-launch-actions">
            <button className="pc-ghost-btn" onClick={() => setHidden(true)}>
              {t("Arka planda devam et")}
            </button>
            {s.busy && !s.running && (
              <button className="pc-ghost-btn danger" onClick={() => void run("cancel_operation", {})}>
                {t("İptal")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
