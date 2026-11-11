import { statusText } from "../statusText";
import { t } from "../i18n";
import { useState } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import Icon from "./Icon";
export default function AccountsPage({ s, run }: { s: Snapshot; run: Run }) {
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  const disabled = s.busy || s.load_failed;
  const selected = s.accounts.find((a) => a.id === s.selected_account);
  const device = s.busy
    ? s.status.match(
        /^Microsoft girişi: https:\/\/microsoft\.com\/devicelogin adresini açın\. Kod: ([A-Za-z0-9-]{1,64})$/,
      )
    : null;
  return (
    <>
      {!s.accounts.length && (
        <section className="glass">
          <h4>{t("Nasıl oynamak istersin?")}</h4>
          <p className="lbl">{t("Microsoft hesabını bağla veya yerel bir oyuncu oluştur.")}</p>
        </section>
      )}
      <div className="pg">
        {s.accounts.map((a) => (
          <div
            className={`pf ${a.id === s.selected_account ? "sel" : ""}`}
            key={a.id}
          >
            <div className="ic">
              <Icon name="account" />
            </div>
            <h4>{a.name}</h4>
            <p>
              {a.kind === "Local" ? t("Yerel oyuncu hesabı") : t("Microsoft hesabı")}
            </p>
            <button
              className="btn"
              disabled={disabled || a.id === s.selected_account}
              onClick={() => void run("select_account", { id: a.id })}
            >
              {a.id === s.selected_account ? t("SEÇİLİ") : t("Hesabı seç")}
            </button>
          </div>
        ))}
      </div>
      <div className="pg">
        <section className="glass">
          <Icon name="shield" />
          <h4>{t("Microsoft hesabı")}</h4>
          <p className="lbl">{t("Minecraft Java hesabınla giriş yap. Giriş işlemi Microsoft'un sayfasında tamamlanır.")}</p>
          <button
            className="btn"
            disabled={disabled}
            onClick={() => void run("microsoft_login", {})}
          >{t("Microsoft ile giriş yap")}</button>
          <p className="lbl">{t("Parolan PatronLauncher'a girilmez.")}</p>
          {s.busy && s.status.startsWith("Microsoft giriş") && (
            <div role="region" aria-label={t("Microsoft cihaz girişi")}>
              <p role="status" className="lbl">
                {device ? t("Microsoft sayfasında bu kodu girin.") : statusText(s.status)}
              </p>
              {device && (
                <>
                  <output
                    aria-label={t("Microsoft giriş kodu")}
                    className="field"
                    style={{ display: "block", userSelect: "text" }}
                  >
                    {device[1]}
                  </output>
                  <button
                    className="btn"
                    onClick={() =>
                      void run("open_external", {
                        url: "https://microsoft.com/devicelogin",
                      })
                    }
                  >
                    https://microsoft.com/devicelogin
                  </button>
                </>
              )}
              <button
                className="btn"
                onClick={() => void run("cancel_operation", {})}
              >{t("Microsoft girişini iptal et")}</button>
            </div>
          )}
        </section>
        <form
          className="glass"
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
        </form>
      </div>
      <p className="lbl">{t("Yerel hesaplar Microsoft doğrulaması isteyen sunuculara giriş sağlamaz.")}</p>
      {selected && (
        <button
          className="btn"
          disabled={disabled}
          onClick={() => void run("remove_account", { id: selected.id })}
        >{t("Seçili hesabı kaldır")}</button>
      )}
    </>
  );
}
