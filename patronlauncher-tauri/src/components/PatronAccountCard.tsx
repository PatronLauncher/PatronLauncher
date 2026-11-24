import { useState } from "react";
import { t } from "../i18n";
import { usePatronAccount } from "../patronAccount";
import mark from "../assets/patronlauncher3transparent-mark.png";
import "../styles/patron-account.css";

/** Çekirdeğin Türkçe hata metnini oyuncunun diline çevirir. */
function errorText(raw: string): string {
  if (raw.includes("reddedildi")) return t("Giriş tarayıcıda reddedildi.");
  if (raw.includes("süresi doldu")) return t("Kodun süresi doldu. Yeniden giriş yap.");
  if (raw.includes("ulaşılamadı") || raw.includes("başlatamadı")) return t("PatronLauncher sitesine ulaşılamadı. İnternet bağlantını kontrol et.");
  return t("Giriş tamamlanamadı. Yeniden dene.");
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="pa-check">
      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Kodu panoya kopyalar; kısa süre "kopyalandı" gösterir. */
function CopyCode({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pa-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(code).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        });
      }}
    >
      {done ? t("Kopyalandı") : t("Kopyala")}
    </button>
  );
}

/**
 * PatronLauncher hesabı (Minecraft hesaplarından ayrı) — Hesaplar sayfasının en üstündeki büyük kart.
 * Giriş tarayıcıda onaylanan bir kodla yapılır; launcher şifre görmez. Durumlar: çıkışta / onay bekleniyor / girişli.
 */
export default function PatronAccountCard({ variant }: { variant: "classic" | "pclient" }) {
  const { account, error, justSignedIn, login, reopen, cancel, logout, openProfile } = usePatronAccount();
  const name = account.display ?? account.username ?? "";
  const shownError = error || account.error;

  return (
    <section className={`pa-hero pa-${variant} pa-${account.state}`} aria-label={t("PatronLauncher hesabı")} data-state={account.state}>
      <div className="pa-glow" aria-hidden="true" />
      <header className="pa-head">
        <span className="pa-logo">
          {account.state === "signed_in" ? <b>{name.slice(0, 1).toUpperCase()}</b> : <img src={mark} alt="" />}
        </span>
        <div className="pa-title">
          <small>{t("PatronLauncher hesabı")}</small>
          <h3>{account.state === "signed_in" ? name : t("Hesabınla giriş yap")}</h3>
        </div>
        <span className={`pa-status ${account.state}`}>
          <i aria-hidden="true" />
          {account.state === "signed_in"
            ? account.offline
              ? t("Çevrimdışı")
              : t("Giriş yapıldı")
            : account.state === "pending"
              ? t("Onay bekleniyor")
              : t("Giriş yapılmadı")}
        </span>
      </header>

      {justSignedIn && account.state === "signed_in" && (
        <p className="pa-success" role="status">
          <Check /> {t("Hoş geldin, {name}! Launcher artık PatronLauncher hesabına bağlı.", { name })}
        </p>
      )}

      {account.state === "signed_in" && (
        <>
          <ul className="pa-perks">
            <li><Check /> {t("Oynama süren ve sunucuların profil sayfanda görünüyor")}</li>
            <li><Check /> {t("Destek taleplerin ve profilin aynı hesapta")}</li>
          </ul>
          {account.offline && <p className="pa-note">{t("PatronLauncher sitesine şu an ulaşılamıyor.")}</p>}
          <div className="pa-actions">
            <button className="pa-btn primary" disabled={!account.profile_url} onClick={() => void openProfile()}>
              {t("Profilimi aç")}
            </button>
            <button className="pa-btn ghost" onClick={() => void logout()}>
              {t("Çıkış yap")}
            </button>
          </div>
        </>
      )}

      {account.state === "pending" && (
        <div className="pa-pending" role="region" aria-label={t("PatronLauncher hesabı girişi")}>
          <ol className="pa-steps">
            <li className="done">{t("Tarayıcıda onay sayfası açıldı")}</li>
            <li className="now">{t("Sayfadaki kodun bununla aynı olduğunu kontrol et ve Giriş yap'a bas")}</li>
            <li>{t("Launcher kendiliğinden giriş yapacak")}</li>
          </ol>
          <div className="pa-code-row">
            <output aria-label={t("Giriş kodu")} className="pa-code">{account.code}</output>
            {account.code && <CopyCode code={account.code} />}
          </div>
          <p className="pa-wait" role="status"><span className="pa-spinner" aria-hidden="true" /> {t("Tarayıcıdaki onayın bekleniyor…")}</p>
          <div className="pa-actions">
            <button className="pa-btn primary" onClick={() => void reopen()}>
              {t("Sayfayı yeniden aç")}
            </button>
            <button className="pa-btn ghost" onClick={() => void cancel()}>
              {t("İptal")}
            </button>
          </div>
        </div>
      )}

      {account.state === "signed_out" && (
        <>
          <p className="pa-lead">{t("Oynamak için gerekmez; ama giriş yaparsan:")}</p>
          <ul className="pa-perks">
            <li><Check /> {t("Oynama süren ve oynadığın sunucular patronlauncher.net profilinde görünür")}</li>
            <li><Check /> {t("Destek taleplerini tek yerden takip edersin")}</li>
            <li><Check /> {t("Yakında: arkadaşlar, mesajlar ve ayarlarını eşitleme")}</li>
          </ul>
          <div className="pa-actions">
            <button className="pa-btn primary big" onClick={() => void login()}>
              <img src={mark} alt="" />
              {t("PatronLauncher hesabıyla giriş yap")}
            </button>
          </div>
          <p className="pa-fine">
            {t("Giriş tarayıcıda onaylanır; şifren launcher'a girilmez.")} {t("Hesabın yoksa açılan sayfadan birkaç saniyede oluşturabilirsin.")}
          </p>
        </>
      )}

      {shownError && (
        <p className="pa-error" role="alert">
          {errorText(shownError)}
        </p>
      )}
    </section>
  );
}

/** Hesap menülerinin (klasik üst çubuk, PClient) en üstündeki kısa PatronLauncher hesabı satırı. */
export function PatronAccountMini({ manage }: { manage: () => void }) {
  const { account, login, openProfile } = usePatronAccount();
  const name = account.display ?? account.username ?? "";
  return (
    <div className={`pa-mini ${account.state}`}>
      <span className="pa-logo small">
        {account.state === "signed_in" ? <b>{name.slice(0, 1).toUpperCase()}</b> : <img src={mark} alt="" />}
      </span>
      <span className="pa-mini-text">
        <b>{account.state === "signed_in" ? name : t("PatronLauncher hesabı")}</b>
        <small>
          {account.state === "signed_in"
            ? t("Giriş yapıldı")
            : account.state === "pending"
              ? t("Onay bekleniyor · kod: {code}", { code: account.code ?? "" })
              : t("Giriş yapılmadı")}
        </small>
      </span>
      {account.state === "signed_in" ? (
        <button className="pa-mini-btn" onClick={() => void openProfile()}>
          {t("Profil")}
        </button>
      ) : account.state === "pending" ? (
        <button className="pa-mini-btn" onClick={manage}>
          {t("Göster")}
        </button>
      ) : (
        <button
          className="pa-mini-btn primary"
          onClick={() => {
            void login();
            manage();
          }}
        >
          {t("Giriş yap")}
        </button>
      )}
    </div>
  );
}
