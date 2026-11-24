// PatronLauncher hesabı (Minecraft hesaplarından ayrı): durum, giriş, çıkış ve "Yardım al".
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getLanguage } from "./i18n";

export interface PatronAccount {
  state: "signed_out" | "pending" | "signed_in";
  code: string | null;
  username: string | null;
  display: string | null;
  profile_url: string | null;
  error: string | null;
  offline: boolean;
}

const EMPTY: PatronAccount = { state: "signed_out", code: null, username: null, display: null, profile_url: null, error: null, offline: false };
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Hesap durumunu çekirdekten okur ve değişiklikleri dinler. */
export function usePatronAccount() {
  const [account, setAccount] = useState<PatronAccount>(EMPTY);
  const [error, setError] = useState("");
  // Bekleyen giriş tamamlanınca birkaç saniye "giriş yapıldı" kutlaması gösterilir.
  const [justSignedIn, setJustSignedIn] = useState(false);
  const previous = useRef<PatronAccount["state"]>("signed_out");
  const language = getLanguage();
  useEffect(() => {
    const was = previous.current;
    previous.current = account.state;
    if (was === "pending" && account.state === "signed_in") {
      setJustSignedIn(true);
      const timer = setTimeout(() => setJustSignedIn(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [account.state]);
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let alive = true;
    void invoke<PatronAccount>("patron_account_status").then((s) => alive && setAccount(s)).catch(() => {});
    void listen<PatronAccount>("patronlauncher://patron-account", (e) => {
      setAccount(e.payload);
      if (e.payload.error) setError(e.payload.error);
    }).then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (isTauri()) void invoke("patron_account_language", { lang: language }).catch(() => {});
  }, [language]);
  const act = (command: string, args?: Record<string, unknown>) => async () => {
    setError("");
    try {
      const next = await invoke<PatronAccount | null>(command, args);
      if (next && typeof next === "object" && "state" in next) setAccount(next);
    } catch (e) {
      setError(String(e));
    }
  };
  return {
    account,
    error,
    justSignedIn,
    login: act("patron_account_login", { lang: language }),
    reopen: act("patron_account_reopen"),
    cancel: act("patron_account_cancel"),
    logout: act("patron_account_logout"),
    openProfile: act("patron_account_profile"),
  };
}

/** Sitenin destek formunu launcher/PClient sürümü ve işletim sistemiyle doldurup açar. */
export function openHelp(minecraft?: string | null) {
  return invoke("patron_open_help", { lang: getLanguage(), minecraft: minecraft ?? null });
}
