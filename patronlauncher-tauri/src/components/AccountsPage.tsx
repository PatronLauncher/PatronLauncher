import { statusText } from "../statusText";
import { t } from "../i18n";
import { useState } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import Icon from "./Icon";
import PatronAccountCard from "./PatronAccountCard";
import SkinHead from "../pclient/SkinHead";
import "../styles/patron-account.css";

/**
 * Hesaplar sayfası: üstte PatronLauncher hesabı (site hesabı), altında Minecraft hesapları ve hesap ekleme.
 * Minecraft hesap komutları değişmedi (select_account, microsoft_login, add_local_account, remove_account).
 */
export default function AccountsPage({ s, run }: { s: Snapshot; run: Run }) {
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  // Oyun açıkken hesap seçimine ve yerel hesap eklemeye çekirdek izin verir; Microsoft girişine vermez.
  const disabled = s.load_failed || (s.busy && !s.running);
  const selected = s.accounts.find((a) => a.id === s.selected_account);
  const device = s.busy
    ? s.status.match(
        /^Microsoft girişi: https:\/\/microsoft\.com\/devicelogin adresini açın\. Kod: ([A-Za-z0-9-]{1,64})$/,
      )
    : null;
  return (
    <div className="acc-page">
      <PatronAccountCard variant="classic" />

      <section className="acc-section">
        <header className="acc-section-head">
          <h3>{t("Minecraft hesapları")}</h3>
          <p className="lbl">{t("Oyuna hangi oyuncuyla gireceğini seç.")}</p>
        </header>
        {s.running && <p className="as-note">{t("Oyun açık: seçtiğin hesap bir sonraki oyunda kullanılır.")}</p>}
        {!s.accounts.length ? (
          <div className="acc-empty">
            <h4>{t("Nasıl oynamak istersin?")}</h4>
            <p className="lbl">{t("Microsoft hesabını bağla veya yerel bir oyuncu oluştur.")}</p>
          </div>
        ) : (
          <div className="acc-grid">
            {s.accounts.map((a) => {
              const on = a.id === s.selected_account;
              return (
                <button
                  key={a.id}
                  className={`acc-card ${on ? "sel" : ""}`}
                  disabled={disabled || on}
                  aria-pressed={on}
                  onClick={() => void run("select_account", { id: a.id })}
                >
                  <SkinHead account={a} size={48} />
                  <span className="meta">
                    <b>{a.name}</b>
                    <small>{a.kind === "Local" ? t("Yerel oyuncu hesabı") : t("Microsoft hesabı")}</small>
                  </span>
                  <em>{on ? t("SEÇİLİ") : t("Seç")}</em>
                </button>
              );
            })}
          </div>
        )}
        {selected && (
          <button
            className="btn acc-remove"
            disabled={disabled}
            onClick={() => void run("remove_account", { id: selected.id })}
          >{t("Seçili hesabı kaldır")}</button>
        )}
      </section>

      <section className="acc-section">
        <header className="acc-section-head">
          <h3>{t("Hesap ekle")}</h3>
        </header>
        <div className="acc-add">
          <div className="acc-add-card ms">
            <Icon name="shield" />
            <h4>{t("Microsoft hesabı")}</h4>
            <p className="lbl">{t("Minecraft Java hesabınla giriş yap. Giriş işlemi Microsoft'un sayfasında tamamlanır.")}</p>
            <button className="as-ms" disabled={disabled || s.running} onClick={() => void run("microsoft_login", {})}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" />
              </svg>
              {t("Microsoft ile giriş yap")}
            </button>
            <p className="lbl">{t("Parolan PatronLauncher'a girilmez.")}</p>
            {s.busy && s.status.startsWith("Microsoft giriş") && (
              <div role="region" aria-label={t("Microsoft cihaz girişi")}>
                <p role="status" className="lbl">
                  {device ? t("Microsoft sayfasında bu kodu girin.") : statusText(s.status)}
                </p>
                {device && (
                  <>
                    <output aria-label={t("Microsoft giriş kodu")} className="field" style={{ display: "block", userSelect: "text" }}>
                      {device[1]}
                    </output>
                    <button className="btn" onClick={() => void run("open_external", { url: "https://microsoft.com/devicelogin" })}>
                      https://microsoft.com/devicelogin
                    </button>
                  </>
                )}
                <button className="btn" onClick={() => void run("cancel_operation", {})}>{t("Microsoft girişini iptal et")}</button>
              </div>
            )}
          </div>
          <form
            className="acc-add-card"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (disabled) return;
              if (!/^[A-Za-z0-9_]{3,16}$/.test(name.trim())) {
                setError(t("Oyuncu adı 3–16 karakter olmalı; yalnızca harf, rakam ve alt çizgi kullanılabilir."));
                return;
              }
              setError("");
              if (await run("add_local_account", { name })) setName("");
            }}
          >
            <Icon name="account" />
            <h4>{t("Yerel oyuncu")}</h4>
            <p className="lbl">{t("Çevrimdışı oyun ve yerel kullanım için bir oyuncu adı oluştur.")}</p>
            <input
              className="field"
              aria-label={t("Oyuncu adı")}
              aria-describedby={error ? "account-error" : undefined}
              placeholder={t("Oyuncu adı")}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
            {error && (
              <p className="lbl" role="alert" id="account-error">
                {error}
              </p>
            )}
            <button className="btn" disabled={disabled}>{t("Yerel hesap oluştur")}</button>
            <p className="lbl">{t("Yerel hesaplar Microsoft doğrulaması isteyen sunuculara giriş sağlamaz.")}</p>
          </form>
        </div>
      </section>
    </div>
  );
}
