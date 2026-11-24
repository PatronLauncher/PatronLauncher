import { statusText } from "../statusText";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { t } from "../i18n";
import { PcIcon } from "./icons";
import SkinHead from "./SkinHead";
import { PatronAccountMini } from "../components/PatronAccountCard";

/**
 * Üst bardaki hesap menüsü: hesaplar arasında geçiş, Microsoft ile giriş ve yerel hesap oluşturma.
 * Hesaplar sayfasıyla aynı çekirdek komutlarını (select_account, microsoft_login, add_local_account) kullanır.
 */
export default function AccountMenu({ s, run, manage }: { s: Snapshot; run: Run; manage: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const account = s.accounts.find((a) => a.id === s.selected_account);
  const disabled = s.busy || s.load_failed;
  const signingIn = s.busy && s.status.startsWith("Microsoft giriş");
  const device = s.busy
    ? s.status.match(/^Microsoft girişi: https:\/\/microsoft\.com\/devicelogin adresini açın\. Kod: ([A-Za-z0-9-]{1,64})$/)
    : null;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", down);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("mousedown", down);
      removeEventListener("keydown", key);
    };
  }, [open]);
  // Giriş başlayınca menü açık kalır ki cihaz kodu görünsün.
  useEffect(() => {
    if (signingIn) setOpen(true);
  }, [signingIn]);

  const createLocal = async () => {
    if (disabled) return;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name.trim())) {
      setError(t("Oyuncu adı 3–16 karakter olmalı; yalnızca harf, rakam ve alt çizgi kullanılabilir."));
      return;
    }
    setError("");
    if (await run("add_local_account", { name: name.trim() })) setName("");
  };

  return (
    <div className="pc-acct" ref={root}>
      <button
        className="pc-acct-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("Hesap seç")}
        onClick={() => setOpen(!open)}
      >
        <SkinHead account={account} />
        <span>{account?.name ?? t("Hesap ekle")}</span>
        <PcIcon name="chevron" />
      </button>
      {open && (
        <div className="pc-acct-menu" role="dialog" aria-label={t("Hesaplar")}>
          <h4>{t("PatronLauncher hesabı")}</h4>
          <PatronAccountMini
            manage={() => {
              setOpen(false);
              manage();
            }}
          />
          <div className="pc-acct-sep" />
          {s.accounts.length > 0 && (
            <>
              <h4>{t("Hesapların")}</h4>
              <div className="pc-acct-list">
                {s.accounts.map((a) => {
                  const on = a.id === s.selected_account;
                  return (
                    <button
                      key={a.id}
                      className={"pc-acct-item " + (on ? "sel" : "")}
                      disabled={disabled || on}
                      aria-pressed={on}
                      onClick={() => void run("select_account", { id: a.id })}
                    >
                      <SkinHead account={a} size={28} />
                      <span>
                        {a.name}
                        <small>{a.kind === "Local" ? t("Yerel oyuncu hesabı") : t("Microsoft hesabı")}</small>
                      </span>
                      {on && <em>{t("SEÇİLİ")}</em>}
                    </button>
                  );
                })}
              </div>
              <div className="pc-acct-sep" />
            </>
          )}
          <h4>{t("Hesap ekle")}</h4>
          <button className="pc-ms" disabled={disabled} onClick={() => void run("microsoft_login", {})}>
            <PcIcon name="windows" />
            {t("Microsoft ile giriş yap")}
          </button>
          {signingIn && (
            <div className="pc-device" role="region" aria-label={t("Microsoft cihaz girişi")}>
              <p role="status">{device ? t("Microsoft sayfasında bu kodu girin.") : statusText(s.status)}</p>
              {device && (
                <>
                  <output aria-label={t("Microsoft giriş kodu")}>{device[1]}</output>
                  <button className="pc-link" onClick={() => void run("open_external", { url: "https://microsoft.com/devicelogin" })}>
                    https://microsoft.com/devicelogin
                  </button>
                </>
              )}
              <button className="pc-btn ghost" onClick={() => void run("cancel_operation", {})}>
                {t("Microsoft girişini iptal et")}
              </button>
            </div>
          )}
          <form
            className="pc-acct-local"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void createLocal();
            }}
          >
            <input
              className="pc-field"
              placeholder={t("Oyuncu adı")}
              aria-label={t("Yerel oyuncu")}
              maxLength={16}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
            <button className="pc-btn" disabled={disabled}>
              {t("Yerel hesap oluştur")}
            </button>
          </form>
          {error && (
            <p className="pc-error" role="alert">
              <span>{error}</span>
              <button className="alert-close" aria-label={t("Kapat")} title={t("Kapat")} onClick={() => setError("")}>
                ×
              </button>
            </p>
          )}
          <button
            className="pc-link"
            onClick={() => {
              setOpen(false);
              manage();
            }}
          >
            {t("Hesapları yönet")}
          </button>
        </div>
      )}
    </div>
  );
}
