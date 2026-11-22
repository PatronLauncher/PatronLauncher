import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
export function allowedImage(src: string) {
  try {
    const u = new URL(src);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      ([
        "cdn.modrinth.com",
        "media.forgecdn.net",
        "raw.githubusercontent.com",
        "i.imgur.com",
        "user-images.githubusercontent.com",
      ].includes(u.hostname) ||
        (u.hostname === "github.com" &&
          u.pathname.split("/").includes("assets")) ||
        (u.hostname === "patronlauncher.net" &&
          u.pathname.startsWith("/api/servers/banner-")))
    );
  } catch {
    return false;
  }
}
let active = 0;
const queue: (() => void)[] = [];
async function fetchImage(url: string) {
  if (active >= 3) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await invoke<{ mime: string; data: string }>("mods_fetch_image", {
      url,
    });
  } finally {
    active--;
    queue.shift()?.();
  }
}
export default function ModImage({
  src = "",
  alt = "",
  className = "",
  silent = false,
  enlarge,
}: {
  src?: string;
  alt?: string;
  className?: string;
  silent?: boolean;
  enlarge?: (src: string, alt: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null),
    [visible, setVisible] = useState(false),
    [blob, setBlob] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const o = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          o.disconnect();
        }
      },
      { rootMargin: "180px" },
    );
    o.observe(node);
    return () => o.disconnect();
  }, [src]);
  useEffect(() => {
    let alive = true,
      url = "";
    setBlob("");
    setError(false);
    if (!visible || !allowedImage(src)) return;
    fetchImage(src)
      .then((result) => {
        if (!alive) return;
        if (
          !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
            result.mime,
          )
        )
          throw Error("Invalid image type");
        const data = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([data], { type: result.mime }));
        setBlob(url);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, visible]);
  if (!allowedImage(src))
    return silent ? null : (
      <span className="image-blocked">{t("Görsel güvenlik nedeniyle engellendi")}</span>
    );
  return (
    <span ref={ref} className={"mod-proxy-image " + className}>
      {error ? (
        silent ? null : (
          <span className="image-unavailable">{t("Görsel yüklenemedi")}</span>
        )
      ) : blob ? (
        <img
          src={blob}
          alt={alt}
          onError={() => setError(true)}
          onClick={() => enlarge?.(src, alt)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              enlarge?.(src, alt);
            }
          }}
          tabIndex={enlarge ? 0 : undefined}
          role={enlarge ? "button" : undefined}
        />
      ) : (
        <span className="image-skeleton" aria-label={t("Görsel yükleniyor")} />
      )}
    </span>
  );
}
