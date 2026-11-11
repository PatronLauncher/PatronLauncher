import { statusText } from "../statusText";
import { useState, type CSSProperties } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { t } from "../i18n";
import logo from "../assets/patronlauncher3transparent-mark.png";
import { PcIcon } from "./icons";
import SkinHead from "./SkinHead";

/**
 * PClient hesap ekranı. Klasik Hesaplar sayfasıyla aynı çekirdek komutlarını
 * (add_local_account, microsoft_login, select_account, remove_account) kullanır.
 */
export default function PClientAccounts({ s, run }: { s: Snapshot; run: Run }) {
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  const disabled = s.busy || s.load_failed;
  const selected = s.accounts.find((a) => a.id === s.selected_account);
  const signingIn = s.busy && s.status.startsWith("Microsoft giriş");
  const device = s.busy
    ? s.status.match(
        /^Microsoft girişi: https:\/\/microsoft\.com\/devicelogin adresini açın\. Kod: ([A-Za-z0-9-]{1,64})$/,
      )
    : null;
  return (
    <div className="pc-accounts">
      <section className="pc-accounts-list">
        <header className="pc-section-head">
          <h3>{t("Hesapların")}</h3>
          <span className="pc-count">{s.accounts.length}</span>
        </header>
        <p className="pc-muted">{t("Oyuncunu seç, macerana devam et.")}</p>
        {s.accounts.length === 0 ? (
          <div className="pc-empty">{t("Nasıl oynamak istersin?")}</div>
        ) : (
          <div className="pc-account-grid">
            {s.accounts.map((a, i) => {
              const on = a.id === s.selected_account;
              return (
                <button
                  key={a.id}
                  className={"pc-account " + (on ? "sel" : "")}
                  style={{ "--i": i } as CSSProperties}
                  disabled={disabled || on}
                  aria-pressed={on}
                  onClick={() => void run("select_account", { id: a.id })}
                >
                  <SkinHead account={a} size={40} className="pc-account-face" />
                  <span>
                    <b>{a.name}</b>
                    <small>
                      {a.kind === "Local" ? t("Yerel oyuncu hesabı") : t("Microsoft hesabı")}
                    </small>
                  </span>
                  <em>{on ? t("SEÇİLİ") : t("Seç")}</em>
                </button>
              );
            })}
          </div>
        )}
        {selected && (
          <button
            className="pc-btn ghost danger"
            disabled={disabled}
            onClick={() => void run("remove_account", { id: selected.id })}
          >
            {t("Seçili hesabı kaldır")}
          </button>
        )}
      </section>
      <section className="pc-welcome">
        <img className="pc-welcome-logo" src={logo} alt="" />
        <h2>{t("Nasıl oynamak istersin?")}</h2>
        <p className="pc-muted">{t("Microsoft hesabını bağla veya yerel bir oyuncu oluştur.")}</p>
        <button
          className="pc-ms"
          disabled={disabled}
          onClick={() => void run("microsoft_login", {})}
        >
          <PcIcon name="windows" />
          {t("Microsoft ile giriş yap")}
        </button>
        <p className="pc-fine">{t("Parolan PatronLauncher'a girilmez.")}</p>
        {signingIn && (
          <div className="pc-device" role="region" aria-label={t("Microsoft cihaz girişi")}>
            <p role="status">{device ? t("Microsoft sayfasında bu kodu girin.") : statusText(s.status)}</p>
            {device && (
              <>
                <output aria-label={t("Microsoft giriş kodu")}>{device[1]}</output>
                <button
                  className="pc-link"
                  onClick={() =>
                    void run("open_external", { url: "https://microsoft.com/devicelogin" })
                  }
                >
                  https://microsoft.com/devicelogin
                </button>
              </>
            )}
            <button className="pc-btn ghost" onClick={() => void run("cancel_operation", {})}>
              {t("Microsoft girişini iptal et")}
            </button>
          </div>
        )}
        <div className="pc-divider" aria-hidden="true" />
        <form
          className="pc-local"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (disabled) return;
            if (!/^[A-Za-z0-9_]{3,16}$/.test(name.trim())) {
              setError(
                t("Oyuncu adı 3–16 karakter olmalı; yalnızca harf, rakam ve alt çizgi kullanılabilir."),
              );
              return;
            }
            setError("");
            if (await run("add_local_account", { name })) setName("");
          }}
        >
          <label htmlFor="pc-local-name">{t("Yerel oyuncu")}</label>
          <div className="pc-local-row">
            <input
              id="pc-local-name"
              className="pc-field"
              placeholder={t("Oyuncu adı")}
              aria-describedby={error ? "pc-account-error" : undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
            <button className="pc-btn" disabled={disabled}>
              {t("Yerel hesap oluştur")}
            </button>
          </div>
          {error && (
            <p className="pc-error" role="alert" id="pc-account-error">
              {error}
            </p>
          )}
        </form>
        <p className="pc-fine">
          {t("Yerel hesaplar Microsoft doğrulaması isteyen sunuculara giriş sağlamaz.")}
        </p>
      </section>
    </div>
  );
}
