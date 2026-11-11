import { t } from "../i18n";
import { useState } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
export default function ProtectionCard({ s, run }: { s: Snapshot; run: Run }) {
  const [confirmFor, setConfirmFor] = useState<string | null>(null),
    profile = s.profiles.find((p) => p.id === s.selected_profile);
  const disabled = s.busy || s.load_failed || !profile;
  return (
    <section className="glass">
      <h4>{t("Profil koruması")}</h4>
      <p className="lbl">
        {profile
          ? t("{name} profilinin ayarları ve yedekleri", { name: profile.name })
          : t("Önce bir oyun profili seç.")}
      </p>
      <div className="actions">
        <button
          className="btn"
          disabled={disabled}
          onClick={() => void run("backup_profile", {})}
        >{t("Ayarları yedekle")}</button>
        <button
          className="btn"
          disabled={disabled}
          onClick={() => setConfirmFor(profile!.id)}
        >{t("Son yedeği geri yükle")}</button>
        <button
          className="btn"
          disabled={disabled}
          onClick={() => void run("open_folder", { target: "backups" })}
        >{t("Yedek klasörü")}</button>
      </div>
      <p className="lbl">{t("Oyun öncesi ve sonrası otomatik yedeklenir. Son 10 farklı ayar yedeği saklanır; dünyalar bu yedeklere dahil değildir.")}</p>
      <button
        className="btn"
        disabled={s.busy || s.load_failed}
        onClick={() => void run("recover_profiles", {})}
      >{t("Diskteki profilleri geri getir")}</button>
      {profile && confirmFor === profile.id && (
        <div>
          <h4>{t("Son yedek geri yüklensin mi?")}</h4>
          <p className="lbl">{t("Mevcut ayarlar önce ayrıca yedeklenecek. Dünyalar değişmeyecek.")}</p>
          <div className="actions">
            <button
              className="btn"
              disabled={disabled}
              onClick={() => {
                setConfirmFor(null);
                void run("restore_profile", { confirmed: true });
              }}
            >{t("Geri yükle")}</button>
            <button className="btn" onClick={() => setConfirmFor(null)}>{t("Vazgeç")}</button>
          </div>
        </div>
      )}
    </section>
  );
}
