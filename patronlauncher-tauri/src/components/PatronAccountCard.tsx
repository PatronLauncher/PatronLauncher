import { t } from "../i18n";
import { usePatronAccount } from "../patronAccount";
import Icon from "./Icon";

/** Çekirdeğin Türkçe hata metnini oyuncunun diline çevirir. */
function errorText(raw: string): string {
  if (raw.includes("reddedildi")) return t("Giriş tarayıcıda reddedildi.");
  if (raw.includes("süresi doldu")) return t("Kodun süresi doldu. Yeniden giriş yap.");
  if (raw.includes("ulaşılamadı") || raw.includes("başlatamadı")) return t("PatronLauncher sitesine ulaşılamadı. İnternet bağlantını kontrol et.");
  return t("Giriş tamamlanamadı. Yeniden dene.");
}

/**
 * PatronLauncher hesabı kartı (Minecraft hesaplarından ayrı). Giriş tarayıcıda onaylanan bir kodla yapılır;
 * launcher şifre görmez. Girişliyken oynama süresi ve sunucular profil sayfasında görünür.
 */
export default function PatronAccountCard({ variant }: { variant: "classic" | "pclient" }) {
  const { account, error, login, reopen, cancel, logout, openProfile } = usePatronAccount();
  const pc = variant === "pclient";
  const btn = pc ? "pc-btn" : "btn";
  const ghost = pc ? "pc-btn ghost" : "btn";
  const muted = pc ? "pc-muted" : "lbl";
  const name = account.display ?? account.username ?? "";

  const body =
    account.state === "signed_in" ? (
      <>
        <p className={muted}>
          {t("{name} olarak giriş yapıldı.", { name })}
          {account.offline ? ` ${t("PatronLauncher sitesine şu an ulaşılamıyor.")}` : ""}
        </p>
        <p className={muted}>{t("Oynama süren ve oynadığın sunucular profil sayfanda görünür.")}</p>
        <div className="patron-account-actions">
          <button className={btn} disabled={!account.profile_url} onClick={() => void openProfile()}>
            {t("Profilimi aç")}
          </button>
          <button className={ghost} onClick={() => void logout()}>
            {t("Çıkış yap")}
          </button>
        </div>
      </>
    ) : account.state === "pending" ? (
      <div className={pc ? "pc-device" : undefined} role="region" aria-label={t("PatronLauncher hesabı girişi")}>
        <p role="status" className={pc ? undefined : "lbl"}>
          {t("Tarayıcıda açılan sayfada bu kodu onayla.")}
        </p>
        <output
          aria-label={t("Giriş kodu")}
          className={pc ? undefined : "field"}
          style={pc ? undefined : { display: "block", userSelect: "text", fontFamily: "monospace", fontSize: "1.25em", letterSpacing: "0.2em" }}
        >
          {account.code}
        </output>
        <div className="patron-account-actions">
          <button className={pc ? "pc-link" : "btn"} onClick={() => void reopen()}>
            {t("Sayfayı yeniden aç")}
          </button>
          <button className={ghost} onClick={() => void cancel()}>
            {t("İptal")}
          </button>
        </div>
      </div>
    ) : (
      <>
        <p className={muted}>
          {t("Hesabınla giriş yap; oynama süren ve sunucuların patronlauncher.net profilinde görünsün. Oynamak için gerekmez.")}
        </p>
        <button className={btn} onClick={() => void login()}>
          {t("PatronLauncher hesabıyla giriş yap")}
        </button>
        <p className={pc ? "pc-fine" : "lbl"}>{t("Giriş tarayıcıda onaylanır; şifren launcher'a girilmez.")}</p>
      </>
    );

  return (
    <section className={pc ? "pc-patron-account" : "glass patron-account"} aria-label={t("PatronLauncher hesabı")}>
      {pc ? (
        <header className="pc-section-head">
          <h3>{t("PatronLauncher hesabı")}</h3>
        </header>
      ) : (
        <>
          <Icon name="account" />
          <h4>{t("PatronLauncher hesabı")}</h4>
        </>
      )}
      {body}
      {(error || account.error) && (
        <p className={pc ? "pc-error" : "lbl"} role="alert">
          {errorText(error || account.error || "")}
        </p>
      )}
    </section>
  );
}
