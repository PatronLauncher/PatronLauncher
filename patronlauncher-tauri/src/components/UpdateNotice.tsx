import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { t } from "../i18n";
import Icon from "./Icon";

interface UpdateInfo {
  version: string;
  notes: string | null;
}

/**
 * Açılışta GitHub'daki son sürümü sorar; yeni sürüm varsa küçük bir bildirim gösterir.
 * Güncelleme imzası doğrulanarak indirilir; kurulum launcher'ı kapatıp yeniden açar.
 */
export default function UpdateNotice({ blocked }: { blocked: boolean }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    // Açılıştaki işleri yavaşlatmamak için kısa bir gecikmeyle; hata (çevrimdışı vb.) sessizce geçilir.
    const timer = setTimeout(() => {
      void invoke<UpdateInfo | null>("update_check")
        .then((u) => setUpdate(u ?? null))
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, []);
  if (!update || hidden) return null;
  return (
    <div className="update-notice" role="status">
      <Icon name="refresh" />
      <p>
        <b>{t("Yeni sürüm hazır: {version}").replace("{version}", update.version)}</b>
        <small>
          {error ||
            (installing
              ? t("İndiriliyor… Kurulum bitince launcher kendiliğinden yeniden açılır.")
              : blocked
                ? t("Güncellemek için önce oyunu kapat.")
                : t("Ayarların, hesapların ve profillerin korunur."))}
        </small>
      </p>
      <button
        className="btn primary"
        disabled={installing || blocked}
        onClick={async () => {
          setInstalling(true);
          setError("");
          try {
            await invoke("update_install");
          } catch (e) {
            setError(String(e));
            setInstalling(false);
          }
        }}
      >
        {t("Güncelle")}
      </button>
      <button
        className="alert-close"
        aria-label={t("Sonra")}
        title={t("Sonra")}
        disabled={installing}
        onClick={() => setHidden(true)}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
