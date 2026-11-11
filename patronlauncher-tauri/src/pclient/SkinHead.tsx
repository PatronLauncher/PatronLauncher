import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Account } from "../types/core";

/** Rust: skins::Skin */
type Skin = { data_url: string; slim: boolean };
/** Aynı oturumda aynı hesap için tekrar sorgu yapılmaz (Rust tarafı da 30 dk önbellekler). */
const cache = new Map<string, Promise<Skin | null>>();

export function useSkinUrl(account?: Account | null) {
  const key = account ? `${account.kind}:${account.name}:${account.uuid}` : "";
  const [url, setUrl] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    let job = cache.get(key);
    if (!job) {
      job = invoke<Skin | null>("player_skin", {
        name: account.name,
        uuid: account.kind === "Microsoft" ? account.uuid : null,
      }).catch(() => null);
      cache.set(key, job);
    }
    void job.then((skin) => alive && setUrl({ key, url: skin?.data_url ?? null }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url?.key === key ? url.url : null;
}

/**
 * Hesabın skininden kafa (yüz + şapka katmanı). Skin bulunamazsa adın ilk iki harfi gösterilir.
 * Kesim CSS ile yapılır: yüz 8×8 (8,8), şapka katmanı (40,8); genişlik %800 ile 64 piksellik doku ölçeklenir.
 */
export default function SkinHead({ account, size = 26, className = "" }: { account?: Account | null; size?: number; className?: string }) {
  const url = useSkinUrl(account);
  const k = size / 8;
  const style: CSSProperties = url
    ? {
        width: size,
        height: size,
        backgroundImage: `url("${url}"), url("${url}")`,
        backgroundSize: "800% auto, 800% auto",
        backgroundPosition: `${-40 * k}px ${-8 * k}px, ${-8 * k}px ${-8 * k}px`,
        backgroundColor: "transparent",
        color: "transparent",
      }
    : { width: size, height: size };
  return (
    <span className={"pc-acct-head " + className} style={style} data-kind={account?.kind} aria-hidden="true">
      {url ? "" : (account?.name.slice(0, 2).toLocaleUpperCase() ?? "◇")}
    </span>
  );
}
