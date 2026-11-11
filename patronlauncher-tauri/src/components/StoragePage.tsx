import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FolderTarget, Snapshot } from "../types/core";
import type { Run } from "../backend";
import { formatBytes, msg, t } from "../i18n";
import { paths } from "../icons";
import Icon from "./Icon";
import ProtectionCard from "./ProtectionCard";

type Entry = { key: string; bytes: number };
type Usage = {
  total: number;
  categories: Entry[];
  profiles: { id: string; name: string; bytes: number; folders: Entry[] }[];
};
const categoryInfo: Record<string, [string, string]> = {
  profiles: [msg("Profiller"), "#b388ff"],
  assets: [msg("Oyun varlıkları"), "#3ddc84"],
  libraries: [msg("Kütüphaneler"), "#4cc9f0"],
  versions: [msg("Sürümler"), "#2ee6c5"],
  java: [msg("Java"), "#ffb454"],
  backups: [msg("Yedekler"), "#fa5265"],
  other: [msg("Diğer"), "#8a93a6"],
};
const folders: [FolderTarget, string, keyof typeof paths, string?][] = [
  ["profile", msg("Oyun klasörü"), "folder"],
  ["saves", msg("Dünyalar"), "globe", "saves"],
  ["mods", msg("Modlar"), "mods", "mods"],
  ["resourcepacks", msg("Kaynak paketleri"), "palette", "resourcepacks"],
  ["shaderpacks", msg("Shader paketleri"), "sparkle", "shaderpacks"],
  ["screenshots", msg("Ekran görüntüleri"), "image", "screenshots"],
  ["logs", msg("Günlükler"), "log", "logs"],
  ["config", msg("Yapılandırma"), "settings", "config"],
  ["schematics", msg("Şemalar"), "versions", "schematics"],
  ["backups", msg("Yedekler"), "archive"],
];

export default function StoragePage({ s, run }: { s: Snapshot; run: Run }) {
  const [usage, setUsage] = useState<Usage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = useCallback(() => {
    setLoading(true);
    invoke<Usage>("storage_usage")
      .then((u) => {
        if (!Array.isArray(u?.categories) || !Array.isArray(u?.profiles))
          throw new Error(t("Disk kullanımı okunamadı"));
        setUsage(u);
        setError("");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);
  const profileKey = [...s.profiles.map((p) => p.id), s.quick_profile?.id].join("|");
  useEffect(load, [load, profileKey]);
  const selected =
    s.profiles.find((p) => p.id === s.selected_profile) ?? s.quick_profile ?? undefined;
  const selectedUsage = usage?.profiles.find((p) => p.id === selected?.id);
  const largest = Math.max(1, ...(usage?.profiles.map((p) => p.bytes) ?? [1]));
  const canOpen = !!s.selected_profile && !s.busy && !s.load_failed;
  return (
    <>
      <section className="glass storage-overview">
        <div className="storage-head">
          <div>
            <span className="lbl">
              <Icon name="database" /> {t("Dizin özeti")}
            </span>
            <h2>
              {usage
                ? t("PatronLauncher klasöründe {size} kullanılıyor", {
                    size: formatBytes(usage.total),
                  })
                : loading
                  ? t("Disk kullanımı hesaplanıyor…")
                  : t("Disk kullanımı okunamadı")}
            </h2>
            <p className="lbl">
              {t("Ortak oyun dosyaları tüm profiller arasında paylaşılır; tekrar indirilmez.")}
            </p>
          </div>
          <div className="actions">
            <button
              className={"btn " + (loading ? "spin" : "")}
              title={t("Yenile")}
              aria-label={t("Disk kullanımını yenile")}
              disabled={loading}
              onClick={load}
            >
              <Icon name="refresh" />
            </button>
            <button
              className="btn"
              disabled={s.load_failed}
              onClick={() => void run("open_folder", { target: "root" })}
            >
              <Icon name="folder" /> {t("Launcher klasörü")}
            </button>
            <button
              className="btn"
              disabled={s.load_failed}
              onClick={() => void run("open_folder", { target: "shared" })}
            >
              <Icon name="versions" /> {t("Ortak oyun dosyaları")}
            </button>
          </div>
        </div>
        {error && (
          <p className="lbl setting-warning" role="alert">
            {error}
          </p>
        )}
        <div className="storage-bar" aria-hidden="true">
          {usage?.categories
            .filter((c) => c.bytes > 0)
            .map((c, i) => (
              <i
                key={c.key}
                title={t(categoryInfo[c.key]?.[0] ?? c.key)}
                style={
                  {
                    "--w": `${(c.bytes / Math.max(1, usage.total)) * 100}%`,
                    "--color": categoryInfo[c.key]?.[1],
                    "--i": i,
                  } as React.CSSProperties
                }
              />
            ))}
        </div>
        <ul className="storage-legend">
          {(usage?.categories ?? []).map((c) => (
            <li key={c.key} style={{ "--color": categoryInfo[c.key]?.[1] } as React.CSSProperties}>
              <span className="legend-dot" />
              {t(categoryInfo[c.key]?.[0] ?? c.key)}
              <b>{formatBytes(c.bytes)}</b>
            </li>
          ))}
        </ul>
      </section>

      <div className="storage-columns">
        <section className="glass">
          <h4>
            <Icon name="profiles" /> {t("Profil kullanımı")}
          </h4>
          <p className="lbl">{t("Her profilin diskte kapladığı alan. Dünyalar profil klasöründedir.")}</p>
          <div className="storage-profiles">
            {usage?.profiles.length ? (
              usage.profiles.map((p, i) => (
                <button
                  key={p.id}
                  className={"storage-profile " + (p.id === selected?.id ? "on" : "")}
                  style={{ "--i": i, "--w": `${(p.bytes / largest) * 100}%` } as React.CSSProperties}
                  disabled={s.busy || s.load_failed || p.id === selected?.id}
                  title={t("Profili seç")}
                  onClick={() => void run("select_profile", { id: p.id })}
                >
                  <span className="storage-profile-name">
                    {p.name}
                    {p.id === selected?.id && <em className="bd">{t("SEÇİLİ")}</em>}
                  </span>
                  <b>{formatBytes(p.bytes)}</b>
                  <span className="storage-profile-bar" />
                </button>
              ))
            ) : (
              <p className="lbl">{loading ? t("Hesaplanıyor…") : t("Henüz profil yok.")}</p>
            )}
          </div>
        </section>
        <ProtectionCard s={s} run={run} />
      </div>

      <section className="glass">
        <h4>
          <Icon name="folder" /> {t("Seçili profilin klasörleri")}
        </h4>
        <p className="lbl">
          {selected
            ? t("{name} · paketleri ve dünyaları bu klasörlere koy.", { name: selected.name })
            : t("Önce bir oyun profili seç.")}
        </p>
        <div className="storage-folders">
          {folders.map(([target, title, icon, key], i) => {
            const bytes =
              target === "profile"
                ? selectedUsage?.bytes
                : selectedUsage?.folders.find((f) => f.key === key)?.bytes;
            return (
              <button
                key={target}
                className="storage-folder"
                style={{ "--i": i } as React.CSSProperties}
                disabled={!canOpen}
                onClick={() => void run("open_folder", { target })}
              >
                <span className="storage-folder-icon">
                  <Icon name={icon} />
                </span>
                <span>
                  <b>{t(title)}</b>
                  <small>{bytes !== undefined ? formatBytes(bytes) : t("Klasörü aç")}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
