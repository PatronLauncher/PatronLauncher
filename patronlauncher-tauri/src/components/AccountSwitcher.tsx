import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { t } from "../i18n";
import { statusText } from "../statusText";
import SkinHead from "../pclient/SkinHead";
import { PatronAccountMini } from "./PatronAccountCard";
import { usePatronAccount } from "../patronAccount";
import "../styles/patron-account.css";

/**
 * Klasik üst çubuktaki hesap menüsü: en üstte PatronLauncher hesabı, altında Minecraft hesapları (skin kafalarıyla),
 * en altta Microsoft ile giriş ve yerel hesap. Oyun açıkken de açılır; hesap değiştirme bir sonraki oyunda geçerli olur.
 */
export default function AccountSwitcher({ s, run, manage }: { s: Snapshot; run: Run; manage: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { account: patron } = usePatronAccount();
  const selected = s.accounts.find((a) => a.id === s.selected_account);
  // Oyun açıkken çekirdek meşguldür; yine de hesap seçimine izin verir (bir sonraki başlatmada geçerli).
  const blocked = s.load_failed || (s.busy && !s.running);
  const signingIn = s.busy && s.status.startsWith("Microsoft giriş");

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

  const go = () => {
    setOpen(false);
    manage();
  };

  return (
    <div className="as-wrap" ref={root}>
      <button className="as-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={t("Hesap menüsü")} onClick={() => setOpen(!open)}>
        <SkinHead account={selected} size={30} />
        <span className="as-btn-text">
          <b>{selected?.name ?? t("Hesap ekle")}</b>
          <small>{selected ? (selected.kind === "Local" ? t("Yerel") : "Microsoft") : t("Minecraft hesabı yok")}</small>
        </span>
        <span className={`as-dot ${patron.state}`} title={patron.state === "signed_in" ? t("PatronLauncher hesabına giriş yapıldı") : t("PatronLauncher hesabına giriş yapılmadı")} />
      </button>
      {open && (
        <div className="as-menu" role="dialog" aria-label={t("Hesaplar")}>
          <h4>{t("PatronLauncher hesabı")}</h4>
          <PatronAccountMini manage={go} />

          <h4>{t("Minecraft hesapları")}</h4>
          {s.running && <p className="as-note">{t("Oyun açık: seçtiğin hesap bir sonraki oyunda kullanılır.")}</p>}
          {s.accounts.length === 0 ? (
            <p className="lbl">{t("Henüz hesap yok. Microsoft ile giriş yap ya da yerel bir oyuncu oluştur.")}</p>
          ) : (
            <div className="as-list">
              {s.accounts.map((a) => {
                const on = a.id === s.selected_account;
                return (
                  <button
                    key={a.id}
                    className={"as-item " + (on ? "sel" : "")}
                    disabled={blocked || on}
                    aria-pressed={on}
                    onClick={() => void run("select_account", { id: a.id })}
                  >
                    <SkinHead account={a} size={32} />
                    <span className="meta">
                      {a.name}
                      <small>{a.kind === "Local" ? t("Yerel oyuncu hesabı") : t("Microsoft hesabı")}</small>
                    </span>
                    {on && <em>{t("SEÇİLİ")}</em>}
                  </button>
                );
              })}
            </div>
          )}

          <h4>{t("Hesap ekle")}</h4>
          <button
            className="as-ms"
            disabled={blocked || s.running}
            onClick={() => {
              void run("microsoft_login", {});
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" />
            </svg>
            {t("Microsoft ile giriş yap")}
          </button>
          {signingIn && <p className="lbl" role="status">{statusText(s.status)}</p>}
          <div className="as-row">
            <button className="btn" onClick={go}>
              {t("Yerel hesap oluştur")}
            </button>
          </div>
          <button className="as-link" onClick={go}>
            {t("Hesapları yönet")}
          </button>
        </div>
      )}
    </div>
  );
}
