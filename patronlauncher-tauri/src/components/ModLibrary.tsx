import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes, locale, msg, t } from "../i18n";
import type { Reply, Snapshot } from "../types/core";
import type { ModHit } from "../mods";
import { Select } from "./Controls";
import Icon from "./Icon";
import ModImage from "./ModImage";

/** Rust: content::LibraryItem. */
export type LibraryItem = {
  kind: LibraryKind;
  filename: string;
  world: string | null;
  project_id: string | null;
  version_id: string | null;
  enabled: boolean;
  managed: boolean;
  size: number;
  added: number;
};
export type LibraryKind = "mod" | "shader" | "resourcepack" | "datapack";
type Meta = { title: string; description: string; icon_url?: string; downloads: number; categories: string[]; updated: string; followers?: number };
type Sort = "added" | "name" | "size";
type Status = "all" | "enabled" | "disabled" | "unknown";

export const libraryKinds: [LibraryKind, string][] = [
  ["mod", msg("Modlar")],
  ["shader", msg("Shaderlar")],
  ["resourcepack", msg("Kaynak paketleri")],
  ["datapack", msg("Veri paketleri")],
];
const glyph: Record<LibraryKind, string> = { mod: "M", shader: "S", resourcepack: "R", datapack: "D" };

/* ---------- Favoriler: bu cihazda, profilden bağımsız (Modrinth projeleri) ---------- */
export type Favorite = { project_id: string; kind: LibraryKind | "modpack"; title: string; description: string; icon_url?: string; author: string; added: number };
const FAV_KEY = "patron-mod-favorites";
export function readFavorites(): Record<string, Favorite> {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, Favorite> = {};
    for (const [id, f] of Object.entries(raw as Record<string, Favorite>))
      if (/^[A-Za-z0-9]{8}$/.test(id) && f && typeof f.title === "string") out[id] = { ...f, project_id: id };
    return out;
  } catch {
    return {};
  }
}
export function writeFavorites(favs: Record<string, Favorite>) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  } catch {
    /* tercih yalnızca bu oturumda kalır */
  }
}
export function FavButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      className={"btn mod-fav " + (on ? "on" : "")}
      aria-pressed={on}
      title={on ? t("Favorilerden çıkar") : t("Favorilere ekle")}
      aria-label={on ? t("Favorilerden çıkar") : t("Favorilere ekle")}
      onClick={onClick}
    >
      <Icon name="star" />
    </button>
  );
}

const STATE_KEY = "patron-library-view";
const readView = () => {
  try {
    const v = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
    return {
      kind: (["all", "mod", "shader", "resourcepack", "datapack"].includes(v.kind) ? v.kind : "all") as LibraryKind | "all",
      sort: (["added", "name", "size"].includes(v.sort) ? v.sort : "added") as Sort,
    };
  } catch {
    return { kind: "all" as const, sort: "added" as Sort };
  }
};

/**
 * Profildeki kurulu içerik: modlar, shaderlar, kaynak ve veri paketleri tek yerde; türe göre ayrılır,
 * aranır, sıralanır ve favorilere göre süzülür. Modrinth bilgisi olmayan dosyalar dosya adıyla görünür.
 */
export default function ModLibrary({
  s,
  profile,
  favorites,
  toggleFavorite,
  open,
  removeMod,
  notice,
  onState,
  onCount,
}: {
  s: Snapshot;
  profile: string;
  favorites: Record<string, Favorite>;
  toggleFavorite: (f: Favorite) => void;
  open: (hit: ModHit, kind: LibraryKind) => void;
  removeMod: (projectId: string) => void;
  notice: (m: string) => void;
  onState: (s: Snapshot) => void;
  onCount?: (n: number) => void;
}) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [initial] = useState(readView);
  const [kind, setKind] = useState<LibraryKind | "all">(initial.kind);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [status, setStatus] = useState<Status>("all");
  const [favOnly, setFavOnly] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ kind, sort }));
    } catch {
      /* yok say */
    }
  }, [kind, sort]);

  useEffect(() => {
    if (!profile || s.busy) return;
    let alive = true;
    setError("");
    invoke<LibraryItem[]>("content_library", { profile })
      .then((list) => {
        if (!alive) return;
        const clean = Array.isArray(list) ? list : [];
        setItems(clean);
        onCount?.(clean.length);
        const ids = [...new Set(clean.map((i) => i.project_id).filter((id): id is string => !!id))].filter((id) => !meta[id]);
        if (!ids.length) return;
        invoke<any[]>("mods_projects", { ids })
          .then((projects) => {
            if (!alive || !Array.isArray(projects)) return;
            setMeta((old) => {
              const next = { ...old };
              for (const p of projects)
                if (p && typeof p.id === "string")
                  next[p.id] = {
                    title: String(p.title ?? ""),
                    description: String(p.description ?? ""),
                    icon_url: p.icon_url ?? undefined,
                    downloads: Number(p.downloads) || 0,
                    followers: Number(p.followers) || 0,
                    categories: Array.isArray(p.categories) ? p.categories : [],
                    updated: String(p.updated ?? ""),
                  };
              return next;
            });
          })
          .catch(() => {
            /* bilgiler gelmezse dosya adları gösterilir */
          });
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, s.busy, reload]);

  const title = (i: LibraryItem) => (i.project_id && meta[i.project_id]?.title) || i.filename.replace(/\.(jar|zip)$/i, "");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items?.length ?? 0 };
    for (const i of items ?? []) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [items]);
  const q = query.trim().toLocaleLowerCase(locale());
  const shown = (items ?? [])
    .filter((i) => kind === "all" || i.kind === kind)
    .filter((i) => !favOnly || (i.project_id && favorites[i.project_id]))
    .filter((i) =>
      status === "all"
        ? true
        : status === "enabled"
          ? i.enabled
          : status === "disabled"
            ? !i.enabled
            : !i.project_id,
    )
    .filter((i) => {
      if (!q) return true;
      const m = i.project_id ? meta[i.project_id] : undefined;
      return `${title(i)} ${i.filename} ${m?.description ?? ""} ${m?.categories.join(" ") ?? ""} ${i.world ?? ""}`
        .toLocaleLowerCase(locale())
        .includes(q);
    })
    .sort((a, b) =>
      sort === "name"
        ? title(a).localeCompare(title(b), locale())
        : sort === "size"
          ? b.size - a.size
          : b.added - a.added,
    );
  const groups: [LibraryKind, LibraryItem[]][] =
    kind === "all"
      ? libraryKinds.map(([k]) => [k, shown.filter((i) => i.kind === k)] as [LibraryKind, LibraryItem[]]).filter(([, l]) => l.length)
      : [[kind, shown]];

  const keyOf = (i: LibraryItem) => `${i.kind}/${i.world ?? ""}/${i.filename}`;
  const hitOf = (i: LibraryItem): ModHit => {
    const m = meta[i.project_id!];
    return {
      project_id: i.project_id!,
      title: m?.title ?? title(i),
      description: m?.description ?? "",
      icon_url: m?.icon_url,
      downloads: m?.downloads ?? 0,
      follows: m?.followers,
      date_modified: m?.updated ?? "",
      author: "",
      categories: m?.categories ?? [],
    };
  };
  const toggleEnabled = async (i: LibraryItem) => {
    try {
      const reply = await invoke<Reply>("mods_set_enabled", { id: profile, project: i.project_id, enabled: !i.enabled });
      onState(reply.state);
      setReload((n) => n + 1);
    } catch (e) {
      notice(String(e));
    }
  };
  const remove = async (i: LibraryItem) => {
    if (i.kind === "mod") {
      if (i.project_id) removeMod(i.project_id);
      return;
    }
    if (confirm !== keyOf(i)) {
      setConfirm(keyOf(i));
      return;
    }
    setConfirm("");
    try {
      await invoke("content_remove", { profile, kind: i.kind, filename: i.filename, world: i.world, confirmed: true });
      notice(t("{name} silindi.", { name: title(i) }));
      setReload((n) => n + 1);
    } catch (e) {
      notice(String(e));
    }
  };
  const date = (secs: number) => (secs ? new Date(secs * 1000).toLocaleDateString(locale()) : "—");
  const locked = s.busy || s.running;

  if (!profile) return <div className="glass">{t("Kurulu içeriği görmek için bir profil seç.")}</div>;
  return (
    <section className="mod-library">
      <div className="glass mod-library-bar">
        <label className="mod-library-search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Kurulu içerikte ara…")}
            aria-label={t("Kurulu içerikte ara…")}
          />
          {query && (
            <button className="btn" onClick={() => setQuery("")} aria-label={t("Temizle")}>
              ×
            </button>
          )}
        </label>
        <div className="mod-library-tools">
          <button
            className={"btn mod-fav-filter " + (favOnly ? "on" : "")}
            aria-pressed={favOnly}
            onClick={() => setFavOnly(!favOnly)}
          >
            <Icon name="star" /> {t("Favoriler")}
          </button>
          <Select className="field" aria-label={t("Durum")} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="all">{t("Tüm durumlar")}</option>
            <option value="enabled">{t("Etkin")}</option>
            <option value="disabled">{t("Devre dışı")}</option>
            <option value="unknown">{t("Elle eklenenler")}</option>
          </Select>
          <Select className="field" aria-label={t("Sırala")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="added">{t("Son eklenen")}</option>
            <option value="name">{t("Ad (A–Z)")}</option>
            <option value="size">{t("Boyut")}</option>
          </Select>
        </div>
        <div className="mod-library-kinds" role="tablist" aria-label={t("İçerik türü")}>
          {([["all", msg("Tümü")], ...libraryKinds] as [LibraryKind | "all", string][]).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              className={"btn " + (kind === k ? "v-add" : "")}
              onClick={() => setKind(k)}
              disabled={k !== "all" && !counts[k]}
            >
              {t(label)} <small>{counts[k] ?? 0}</small>
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="glass" role="alert">
          {error}
          <button className="btn" onClick={() => setReload((n) => n + 1)}>
            {t("Tekrar dene")}
          </button>
        </div>
      ) : items === null ? (
        <div className="mods-grid" aria-label={t("Kurulu içerik yükleniyor")}>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="glass mod-skeleton" key={i} />
          ))}
        </div>
      ) : !items.length ? (
        <div className="glass mod-library-empty">{t("Bu profilde henüz kurulu mod, shader ya da paket yok.")}</div>
      ) : !shown.length ? (
        <div className="glass mod-library-empty">{t("Bu filtrelerle kurulu içerik bulunamadı.")}</div>
      ) : (
        groups.map(([k, list]) => (
          <div className="mod-library-group" key={k}>
            {kind === "all" && (
              <h3>
                {t(libraryKinds.find(([x]) => x === k)![1])} <small>{list.length}</small>
              </h3>
            )}
            <ul className="mod-library-list">
              {list.map((i) => {
                const m = i.project_id ? meta[i.project_id] : undefined;
                const fav = !!(i.project_id && favorites[i.project_id]);
                return (
                  <li key={keyOf(i)} className={"glass mod-library-item " + (i.enabled ? "" : "off")}>
                    {m?.icon_url ? (
                      <ModImage className="mod-library-icon" src={m.icon_url} alt="" silent />
                    ) : (
                      <span className={"mod-library-icon glyph k-" + i.kind} aria-hidden="true">
                        {glyph[i.kind]}
                      </span>
                    )}
                    <div className="mod-library-main">
                      <b>
                        {title(i)}
                        <span className={"mod-kind k-" + i.kind}>{t(libraryKinds.find(([x]) => x === i.kind)![1])}</span>
                        {!i.enabled && <span className="mod-kind off">{t("Devre dışı")}</span>}
                        {!i.project_id && <span className="mod-kind ext">{t("Elle eklendi")}</span>}
                      </b>
                      {m?.description && <p>{m.description}</p>}
                      <small>
                        <code>{i.filename}</code>
                        {i.world && <> · {t("Dünya: {name}", { name: i.world })}</>}
                        {i.size > 0 && <> · {formatBytes(i.size)}</>} · {date(i.added)}
                      </small>
                    </div>
                    <div className="mod-library-actions">
                      {i.project_id && (
                        <FavButton
                          on={fav}
                          onClick={() =>
                            toggleFavorite({
                              project_id: i.project_id!,
                              kind: i.kind,
                              title: title(i),
                              description: m?.description ?? "",
                              icon_url: m?.icon_url,
                              author: "",
                              added: Date.now(),
                            })
                          }
                        />
                      )}
                      {i.project_id && (
                        <button className="btn" onClick={() => open(hitOf(i), i.kind)}>
                          {t("Görüntüle")}
                        </button>
                      )}
                      {i.kind === "mod" && i.managed && i.project_id && (
                        <button className="btn" disabled={locked} onClick={() => void toggleEnabled(i)}>
                          {i.enabled ? t("Devre dışı bırak") : t("Etkinleştir")}
                        </button>
                      )}
                      {(i.kind !== "mod" || (i.managed && i.project_id)) && (
                        <button
                          className={"btn mod-remove " + (confirm === keyOf(i) ? "danger" : "")}
                          disabled={locked}
                          onClick={() => void remove(i)}
                          onBlur={() => confirm === keyOf(i) && setConfirm("")}
                        >
                          {confirm === keyOf(i) ? t("Silmeyi onayla") : t("Kaldır")}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
