import { locale, msg, t } from "../i18n";
import ContentInstall, { type ContentKind } from "./ContentInstall";
import CurseForgePage from "./CurseForgePage";
import {profileArtwork} from "../profileArtwork";
import { Select, Toggle } from "./Controls";
import {lazy,Suspense} from "react";
const ModContent=lazy(()=>import("./ModContent"));
// Mod klasörü kullanan yükleyiciler; arama filtresi profilin yükleyicisine göre yapılır.
const modLoaders = ["Fabric", "Quilt", "NeoForge", "Forge"];
const usesMods = (loader?: string | null) => !!loader && modLoaders.includes(loader);
type Kind = "mod" | "resourcepack" | "shader" | "datapack" | "modpack";
const kinds: [Kind, string][] = [
  ["mod", msg("Modlar")],
  ["resourcepack", msg("Kaynak paketleri")],
  ["shader", msg("Shaderlar")],
  ["datapack", msg("Veri paketleri")],
  ["modpack", msg("Mod paketleri")],
];
// Modrinth'in tür başına kategori adları.
const kindCategories: Record<Kind, string[]> = {
  mod: ["optimization", "adventure", "technology", "utility", "worldgen", "decoration", "library", "storage"],
  resourcepack: ["realistic", "simplistic", "vanilla-like", "decoration", "combat", "themed", "tweaks", "utility"],
  shader: ["vanilla-like", "realistic", "semi-realistic", "fantasy", "cartoon", "cursed"],
  datapack: ["adventure", "game-mechanics", "utility", "worldgen", "magic", "technology", "equipment", "mobs"],
  modpack: ["adventure", "optimization", "kitchen-sink", "lightweight", "multiplayer", "quests", "technology", "magic"],
};
import ModImage from "./ModImage";
import Icon from "./Icon";
import ModLibrary, { FavButton, readFavorites, writeFavorites, type Favorite, type LibraryKind } from "./ModLibrary";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Snapshot, Reply, EventEnvelope } from "../types/core";
import {
  type ModHit,
  type ModPlan,
  type ModEntry,
  type ModVersion,
  type ModVersions,
  modLink,
} from "../mods";
import Modal from "./Modal";
import "../styles/mods.css";
export default function ModsPage({
  s,
  onState,
  notice,
  goSettings = () => {},
}: {
  s: Snapshot;
  onState: (s: Snapshot) => void;
  notice: (m: string) => void;
  goSettings?: () => void;
}) {
  const [source, setSource] = useState<"modrinth" | "curseforge">("modrinth");
  const [kind, setKind] = useState<Kind>("mod"),
    [contentHit, setContentHit] = useState<ModHit | null>(null);
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("downloads"),
    [categories, setCategories] = useState<string[]>([]),
    [environment, setEnvironment] = useState("client");
  const [loaderFilter, setLoaderFilter] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [target, setTarget] = useState(s.selected_profile ?? ""),
    [mc, setMc] = useState(
      s.profiles.find((p) => p.id === s.selected_profile)?.version ?? "",
    ),
    [offset, setOffset] = useState(0),
    [retry, setRetry] = useState(0);
  const [hits, setHits] = useState<ModHit[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [project, setProject] = useState<ModHit | null>(null),
    [detail, setDetail] = useState<any>(null),
    [tab, setTab] = useState("Açıklama"),
    [detailError, setDetailError] = useState("");
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null,
  );
  const [installedOnly, setInstalledOnly] = useState(false);
  const [favView, setFavView] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, Favorite>>(readFavorites);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const toggleFavorite = (f: Favorite) =>
    setFavorites((old) => {
      const next = { ...old };
      if (next[f.project_id]) delete next[f.project_id];
      else next[f.project_id] = f;
      writeFavorites(next);
      return next;
    });
  const [installed, setInstalled] = useState<ModEntry[]>([]),
    [flow, setFlow] = useState<number | null>(null),
    [profileSearch, setProfileSearch] = useState(""),
    [newProfile, setNewProfile] = useState(false),
    [newName, setNewName] = useState(""),
    [newMc, setNewMc] = useState(
      s.versions.find((v) => v.type === "release")?.id ?? "",
    );
  const [versions, setVersions] = useState<ModVersions | null>(null),
    [selectedVersion, setSelectedVersion] = useState(""),
    [incompatible, setIncompatible] = useState(false),
    [plan, setPlan] = useState<ModPlan | null>(null),
    [consent, setConsent] = useState(false),
    [pending, setPending] = useState(false),
    [flowError, setFlowError] = useState("");
  const [progress, setProgress] = useState({
      filename: "",
      completed_bytes: 0,
      total_bytes: 0,
    }),
    [running, setRunning] = useState(false),
    [link, setLink] = useState("");
  const [remove, setRemove] = useState<{
      id: string;
      entries: ModEntry[];
    } | null>(null),
    [removeDeps, setRemoveDeps] = useState(false);
  const operation = useRef<{
      profile: string;
      action: string;
      project?: string;
    } | null>(null),
    targetRef = useRef(target);
  targetRef.current = target;
  const profiles = s.profiles.filter((p) => p.kind !== "Quick"),
    current = profiles.find((p) => p.id === target);
  const disabled = pending || running || s.busy || s.running || s.load_failed;
  const refreshInstalled = async (id: string) => {
    try {
      const result = await invoke<{ managed: ModEntry[] }>("mods_list", { id });
      if (targetRef.current === id) setInstalled(result.managed);
    } catch {
      if (targetRef.current === id) setInstalled([]);
    }
  };
  useEffect(() => {
    if (usesMods(current?.loader) && !s.busy) void refreshInstalled(target);
    else if (!usesMods(current?.loader)) setInstalled([]);
  }, [target, s.busy]);
  useEffect(() => {
    if (!target || s.busy) return;
    let alive = true;
    invoke<unknown[]>("content_library", { profile: target })
      .then((l) => alive && setLibraryCount(Array.isArray(l) ? l.length : 0))
      .catch(() => alive && setLibraryCount(null));
    return () => {
      alive = false;
    };
  }, [target, s.busy]);
  useEffect(() => {
    let active = true;
    if (installedOnly || favView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      invoke<{ hits: ModHit[]; total_hits: number }>("mods_search", {
        search: {
          query,
          sort,
          category: null,
          categories,
          loader: kind === "mod" && loaderFilter ? (usesMods(current?.loader) ? current!.loader!.toLowerCase() : "fabric") : null,
          game_version: mc || null,
          environment: kind === "mod" ? environment || null : null,
          offset,
          limit: 12,
          project_type: kind,
        },
      })
        .then((v) => {
          if (active) {
            setHits(Array.isArray(v?.hits) ? v.hits : []);
            setTotal(Number(v?.total_hits) || 0);
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    query,
    sort,
    categories,
    environment,
    mc,
    offset,
    retry,
    installedOnly,
    favView,
    loaderFilter,
    kind,
  ]);
  useEffect(() => {
    if (!project) return;
    let active = true;
    setDetail(null);
    setDetailError("");
    invoke("mods_project", { project: project.project_id })
      .then((v) => {
        if (active) setDetail(v);
      })
      .catch((e) => {
        if (active) setDetailError(String(e));
      });
    return () => {
      active = false;
    };
  }, [project?.project_id, retry]);
  useEffect(() => {
    if (flow !== 1 || !project || !target) return;
    let active = true;
    setPending(true);
    setVersions(null);
    setFlowError("");
    invoke<ModVersions>("mods_versions", {
      id: target,
      project: project.project_id,
      includeIncompatible: incompatible,
    })
      .then((v) => {
        if (active) {
          setVersions(v);
          setSelectedVersion((old) =>
            v.compatible.some((x) => x.id === old)
              ? old
              : (v.recommended ?? ""),
          );
        }
      })
      .catch((e) => {
        if (active) setFlowError(String(e));
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [flow, target, project?.project_id, incompatible, retry]);
  useEffect(() => {
    let active = true;
    const offs: (() => void)[] = [];
    (async () => {
      const a = await listen<typeof progress & { profile_id: string }>(
        "patronlauncher://mods-progress",
        (e) => {
          if (operation.current?.profile === e.payload.profile_id)
            setProgress(e.payload);
        },
      );
      if (!active) {
        a();
        return;
      }
      offs.push(a);
      const b = await listen<EventEnvelope>(
        "patronlauncher://core-event",
        (e) => {
          if (e.payload.event.kind !== "finished" || !operation.current) return;
          const op = operation.current;
          operation.current = null;
          setRunning(false);
          setPending(false);
          if ("Ok" in e.payload.event.result) {
            setFlow(null);
            setRemove(null);
            notice(
              op.action === "remove"
                ? t("Mod kaldırıldı.")
                : t("Mod kurulumu tamamlandı."),
            );
            void refreshInstalled(op.profile);
          } else {
            const msg = e.payload.event.result.Err;
            setFlowError(msg);
            notice(msg);
            setFlow(4);
          }
        },
      );
      if (!active) b();
      else offs.push(b);
    })().catch((e) => {
      setError(t("İlerleme olayları dinlenemedi: ") + String(e));
    });
    return () => {
      active = false;
      offs.forEach((f) => f());
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const names = kindCategories[kind];
      names.forEach((category) => {
        invoke<{ total_hits: number }>("mods_search", {
          search: {
            query,
            sort: "downloads",
            category,
            loader: kind === "mod" && loaderFilter ? (usesMods(current?.loader) ? current!.loader!.toLowerCase() : "fabric") : null,
            game_version: mc || null,
            environment: kind === "mod" ? environment || null : null,
            offset: 0,
            limit: 1,
            project_type: kind,
          },
        })
          .then((v) => {
            if (active && Number.isFinite(v.total_hits))
              setCounts((old) => ({ ...old, [category]: v.total_hits }));
          })
          .catch(() => {});
      });
    }, 450);
    setCounts({});
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, mc, environment, loaderFilter, kind]);

  const favList = Object.values(favorites).sort((a, b) => b.added - a.added);
  const favKind = (id: string) => favorites[id]?.kind ?? kind;
  const visibleHits: ModHit[] = favView
    ? favList
        .filter(
          (f) =>
            !query ||
            `${f.title} ${f.description}`.toLocaleLowerCase(locale()).includes(query.toLocaleLowerCase(locale())),
        )
        .map((f) => ({
          project_id: f.project_id,
          title: f.title,
          description: f.description,
          icon_url: f.icon_url,
          downloads: 0,
          date_modified: "",
          author: f.author,
          categories: [],
        }))
    : hits;
  const favorite = (h: ModHit, k: Kind = kind) =>
    toggleFavorite({
      project_id: h.project_id,
      kind: k,
      title: h.title,
      description: h.description,
      icon_url: h.icon_url,
      author: h.author,
      added: Date.now(),
    });
  const reset = () => {
    setQuery("");
    setCategories([]);
    setMc("");
    setEnvironment("");
    setLoaderFilter(false);
    setOffset(0);
  };
  const start = (hit: ModHit) => {
    if (kind === "resourcepack" || kind === "shader" || kind === "datapack") {
      setContentHit(hit);
      return;
    }
    setProject(hit);
    setFlow(0);
    setFlowError("");
    setNewProfile(false);
    setProfileSearch("");
    setPlan(null);
    setConsent(false);
    setSelectedVersion("");
  };
  const choose = (id: string) => {
    setTarget(id);
    const p = profiles.find((p) => p.id === id);
    if (p) setMc(p.version);
  };
  const compatibleProfile = (p: (typeof profiles)[number]) =>
    usesMods(p.loader) &&
    (!project?.versions?.length || project.versions.includes(p.version));
  const act = async (fn: () => Promise<void>) => {
    setPending(true);
    setFlowError("");
    try {
      await fn();
    } catch (e) {
      setFlowError(String(e));
      notice(String(e));
    } finally {
      setPending(false);
    }
  };
  const buildPlan = () =>
    act(async () => {
      if (!project) return;
      const p = await invoke<ModPlan>("mods_plan", {
        id: target,
        projects: [project.project_id],
        versionId: selectedVersion,
      });
      setPlan(p);
      setFlow(2);
    });
  const install = () =>
    act(async () => {
      if (!plan || !consent) return;
      operation.current = {
        profile: plan.profile,
        action: "install",
        project: project?.project_id,
      };
      setRunning(true);
      setProgress({
        filename: t("Hazırlanıyor…"),
        completed_bytes: 0,
        total_bytes: plan.total_bytes,
      });
      setFlow(4);
      try {
        const reply = await invoke<Reply>("mods_install", {
          id: plan.profile,
          planId: plan.id,
          confirmed: true,
        });
        onState(reply.state);
      } catch (e) {
        operation.current = null;
        setRunning(false);
        throw e;
      }
    });
  const requestRemove = (id: string) =>
    act(async () => {
      const entries = await invoke<ModEntry[]>("mods_removal_plan", {
        id: target,
        project: id,
      });
      setRemove({ id, entries });
      setRemoveDeps(false);
    });
  const removeMod = () =>
    act(async () => {
      if (!remove) return;
      operation.current = { profile: target, action: "remove" };
      setRunning(true);
      try {
        const reply = await invoke<Reply>("mods_remove", {
          id: target,
          project: remove.id,
          removeDependencies: removeDeps,
          confirmed: true,
        });
        onState(reply.state);
        setRemove(null);
      } catch (e) {
        operation.current = null;
        setRunning(false);
        throw e;
      }
    });
  const installedMod = (id: string) =>
    installed.some((e) => e.project_id === id);
  const buttons = (hit: ModHit) => (
    <>
      {running && operation.current?.project === hit.project_id ? (
        <button className="btn mod-work" disabled>{t("Kuruluyor…")}</button>
      ) : kind === "modpack" ? (
        <button className="btn" disabled title={t("Mod paketi kurulumu bir sonraki aşamada gelecek.")}>
          {t("Yakında")}
        </button>
      ) : kind === "mod" && installedMod(hit.project_id) ? (
        <>
          <button className="btn" disabled>{t("Kurulu ✓")}</button>
          <details className="profile-menu">
            <summary className="btn" aria-label={t("Mod işlemleri")}>
              ⋯
            </summary>
            <div className="profile-menu-items">
              <button
                className="btn"
                disabled={disabled}
                onClick={() => void requestRemove(hit.project_id)}
              >{t("Kaldır")}</button>
            </div>
          </details>
        </>
      ) : (
        <button
          className="btn v-add mod-install"
          disabled={disabled}
          onClick={() => start(hit)}
        >{t("Kur")}</button>
      )}
    </>
  );
  const filters = (
    <aside className="glass mod-filters">
      <label>{t("Hedef profil")}<Select
          aria-label={t("Hedef profil")}
          className="field"
          value={target}
          disabled={running}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">{t("Profil seç")}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id} data-icon={profileArtwork(p.appearance?.icon,"icon")}>
              {p.name} · {p.version} · {p.loader ?? "Vanilla"}
            </option>
          ))}
        </Select>
      </label>
      <p className="lbl">
        {kind !== "mod"
          ? t("Kurarken hedef profili ayrıca seçebilirsin.")
          : !usesMods(current?.loader)
            ? t("Mod kurmak için Fabric profili oluştur.")
            : t("Modlar bu profilin mods klasörüne kurulacak.")}
      </p>
      <fieldset className="mod-category-checks">
        <legend>{t("Kategoriler")}{" "}
          <small title={t("Aynı sorgu, sürüm ve ortam için toplam sonuç sayıları")}>{t("(sonuç)")}</small>
        </legend>
        {kindCategories[kind].map((c) => (
          <label key={c}>
            <Toggle
              type="checkbox"
              checked={categories.includes(c)}
              onChange={() => {
                setCategories((old) =>
                  old.includes(c) ? old.filter((v) => v !== c) : [...old, c],
                );
                setOffset(0);
              }}
            />
            <span>{c}</span>
            <small>{counts[c]?.toLocaleString(locale()) ?? "…"}</small>
          </label>
        ))}
      </fieldset>
      {kind === "mod" && (<>
      <fieldset>
        <legend>{t("Mod yükleyici")}</legend>
        <label className="loader-check">
          <Toggle
            type="checkbox"
            checked={loaderFilter}
            onChange={(e) => {
              setLoaderFilter(e.target.checked);
              setOffset(0);
            }}
          />
          {usesMods(current?.loader) ? current!.loader : "Fabric"}
        </label>
      </fieldset>
      <label>{t("Ortam")}<Select
          className="field"
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("Tümü")}</option>
          <option value="client">{t("Client")}</option>
          <option value="server">{t("Server")}</option>
        </Select>
      </label>
      </>)}
      <label>{t("Oyun sürümü")}<Select
          className="field"
          value={mc}
          onChange={(e) => {
            setMc(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("Tümü")}</option>
          {s.versions.map((v) => (
            <option key={v.id}>{v.id}</option>
          ))}
        </Select>
      </label>
      <div className="version-chips">
        {Array.from(
          new Set([
            ...(mc ? [mc] : []),
            ...s.versions
              .filter((v) => v.type === "release")
              .slice(0, 10)
              .map((v) => v.id),
          ]),
        ).map((v) => (
          <button
            className={"btn " + (mc === v ? "selected" : "")}
            aria-pressed={mc === v}
            key={v}
            onClick={() => {
              setMc(mc === v ? "" : v);
              setOffset(0);
            }}
          >
            {v}
          </button>
        ))}
      </div>
    </aside>
  );
  return (
    <div className="mods-page">
      {contentHit && kind !== "mod" && kind !== "modpack" && (
        <ContentInstall
          s={s}
          kind={kind as ContentKind}
          hit={contentHit}
          close={() => setContentHit(null)}
          notice={notice}
        />
      )}
      {lightbox && (
        <Modal title={lightbox.alt || t("Görsel")} close={() => setLightbox(null)}>
          <ModImage src={lightbox.src} alt={lightbox.alt} />
        </Modal>
      )}
      <div className="actions mod-sources">
        <button
          className={"btn source-modrinth " + (source === "modrinth" ? "v-add" : "")}
          aria-pressed={source === "modrinth"}
          onClick={() => setSource("modrinth")}
        >
          <span className="source-logo modrinth" aria-hidden="true" /> Modrinth
        </button>
        <button
          className={"btn source-curseforge " + (source === "curseforge" ? "on" : "")}
          aria-pressed={source === "curseforge"}
          onClick={() => {
            setSource("curseforge");
            setProject(null);
          }}
        >
          <span className="source-logo curseforge" aria-hidden="true" /> CurseForge
        </button>
        <span className="mod-unofficial">
          {t("{name} ile resmi bir bağlantımız yoktur.", { name: source === "curseforge" ? "CurseForge" : "Modrinth" })}
        </span>
      </div>
      {source === "curseforge" ? (
        <CurseForgePage s={s} onState={onState} notice={notice} goSettings={goSettings} />
      ) : (<>
      <div className="actions mod-view-tabs" role="tablist">
        {kinds.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={!installedOnly && !favView && kind === key}
            className={"btn " + (!installedOnly && !favView && kind === key ? "v-add" : "")}
            onClick={() => {
              setKind(key);
              setInstalledOnly(false);
              setFavView(false);
              setProject(null);
              setCategories([]);
              setOffset(0);
            }}
          >
            {t(label)}
          </button>
        ))}
        <span className="mod-view-sep" aria-hidden="true" />
        <button
          role="tab"
          aria-selected={installedOnly}
          className={"btn mod-tab-library " + (installedOnly ? "v-add" : "")}
          title={t("Bu profile kurulu modlar, shaderlar ve paketler")}
          onClick={() => {
            setInstalledOnly(true);
            setFavView(false);
            setProject(null);
          }}
        >{t("Kurulu ({count})", { count: libraryCount ?? installed.length })}
        </button>
        <button
          role="tab"
          aria-selected={favView}
          className={"btn mod-tab-fav " + (favView ? "v-add" : "")}
          onClick={() => {
            setFavView(true);
            setInstalledOnly(false);
            setProject(null);
          }}
        ><Icon name="star" /> {t("Favoriler ({count})", { count: favList.length })}
        </button>
      </div>
      {project && flow === null ? (
        <>
          <button className="btn" onClick={() => setProject(null)}>{t("← Modlara dön")}</button>
          <div className="mods-layout mod-detail">
            <section className="glass">
              <h2>{project.title}</h2>
              <div className="actions">
                {[msg("Açıklama"), msg("Galeri"), msg("Değişiklik günlüğü"), msg("Sürümler")].map(
                  (name) => (
                    <button
                      className={"btn " + (tab === name ? "v-add" : "")}
                      key={name}
                      onClick={() => setTab(name)}
                    >
                      {t(name)}
                    </button>
                  ),
                )}
              </div>
              {detailError ? (
                <p role="alert">
                  {detailError}
                  <button
                    className="btn"
                    onClick={() => setRetry((v) => v + 1)}
                  >{t("Tekrar dene")}</button>
                </p>
              ) : !detail ? (
                <p role="status">{t("Mod ayrıntıları yükleniyor…")}</p>
              ) : tab === "Açıklama" ? (
                <Suspense fallback={<div className="image-skeleton" role="status">{t("İçerik yükleniyor…")}</div>}><ModContent
                  text={detail.project.body ?? detail.project.description ?? ""}
                  open={setLink}
                  enlarge={(src, alt) => setLightbox({ src, alt })}
                /></Suspense>
              ) : tab === "Galeri" ? (
                <div className="mod-gallery">
                  {(detail.project.gallery ?? []).map((g: any, i: number) => (
                    <figure key={i}>
                      <ModImage
                        src={g.raw_url ?? g.url}
                        alt={g.title ?? t("Mod galerisi")}
                        silent
                        enlarge={(src, alt) => setLightbox({ src, alt })}
                      />
                      <figcaption>{g.description}</figcaption>
                    </figure>
                  ))}
                  {!detail.project.gallery?.length && (
                    <p>{t("Galeri görseli yok.")}</p>
                  )}
                </div>
              ) : tab === "Değişiklik günlüğü" ? (
                <Suspense fallback={<div className="image-skeleton" role="status">{t("İçerik yükleniyor…")}</div>}><ModContent
                  text={
                    detail.versions?.[0]?.changelog ??
                    t("Değişiklik günlüğü bulunamadı.")
                  }
                  open={setLink}
                  enlarge={(src, alt) => setLightbox({ src, alt })}
                /></Suspense>
              ) : (
                <div>
                  {(detail.versions ?? []).map((v: ModVersion) => (
                    <div className="mod-version" key={v.id}>
                      <strong>{v.version_number}</strong>
                      <small>
                        {v.version_type} · {v.game_versions.join(", ")} ·{" "}
                        {v.loaders.join(", ")}
                      </small>
                      <button
                        className="btn"
                        disabled={disabled}
                        onClick={() => {
                          start(project);
                          setSelectedVersion(v.id);
                        }}
                      >{t("Kur")}</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <aside className="glass mod-filters">
              <ModImage
                className="mod-icon"
                src={project.icon_url}
                alt=""
                silent
              />
              <h3>{project.title}</h3>
              <p>{project.downloads.toLocaleString(locale())} {t("indirme")}</p>
              <p>{t("Modlar şuraya kurulacak:")}{" "}
                <b>{current?.name ?? t("Profil seçilmedi")}</b>
              </p>
              <div className="actions">
                <FavButton on={!!favorites[project.project_id]} onClick={() => favorite(project)} />
                {buttons(project)}
              </div>
              <h4>{t("Desteklenen sürümler / yükleyiciler")}</h4>
              <p className="lbl">
                {(detail?.project.game_versions ?? project.versions ?? []).join(
                  ", ",
                )}
              </p>
              <p className="lbl">
                {(detail?.project.loaders ?? ["fabric"]).join(", ")}
              </p>
              <h4>{t("Yaratıcılar")}</h4>
              {(detail?.creators ?? []).map((c: any, i: number) => (
                <p key={i}>{c.user?.username ?? c.role}</p>
              ))}
              <p className="lbl">{project.categories.join(" · ")}</p>
            </aside>
          </div>
        </>
      ) : installedOnly ? (
        <ModLibrary
          s={s}
          profile={target}
          favorites={favorites}
          toggleFavorite={toggleFavorite}
          open={(hit, k: LibraryKind) => {
            setKind(k);
            setProject(hit);
            setTab("Açıklama");
          }}
          removeMod={(id) => void requestRemove(id)}
          notice={notice}
          onState={onState}
          onCount={setLibraryCount}
        />
      ) : (
        <>
          <div className="v-toolbar">
            <input
              className="field"
              aria-label={t("Mod ara")}
              placeholder={kind === "mod" ? t("Mod ara…") : t("Ara…")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
            />
            <Select
              className="field"
              aria-label={t("Mod sıralama")}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setOffset(0);
              }}
            >
              <option value="downloads">{t("Popülerlik")}</option>
              <option value="follows">{t("Takipçi")}</option>
              <option value="updated">{t("Güncelleme")}</option>
              <option value="newest">{t("Yeni")}</option>
            </Select>
          </div>
          <div className="active-mod-filters" aria-label={t("Aktif filtreler")}>
            {query && (
              <button
                className="btn"
                onClick={() => {
                  setQuery("");
                  setOffset(0);
                }}
              >{t("Arama:")} {query} ×
              </button>
            )}
            {categories.map((c) => (
              <button
                className="btn"
                key={c}
                onClick={() => {
                  setCategories((v) => v.filter((x) => x !== c));
                  setOffset(0);
                }}
              >
                {c} ×
              </button>
            ))}
            {kind === "mod" && loaderFilter && (
              <button
                className="btn"
                onClick={() => {
                  setLoaderFilter(false);
                  setOffset(0);
                }}
              >{t("Fabric ×")}</button>
            )}
            {mc && (
              <button
                className="btn"
                onClick={() => {
                  setMc("");
                  setOffset(0);
                }}
              >
                {mc} ×
              </button>
            )}
            {kind === "mod" && environment && (
              <button
                className="btn"
                onClick={() => {
                  setEnvironment("");
                  setOffset(0);
                }}
              >
                {environment} ×
              </button>
            )}
            <button className="btn" onClick={reset}>{t("Temizle")}</button>
          </div>
          <div className="mods-layout mod-list-layout">
            <section>
              {error ? (
                <div className="glass" role="alert">
                  {error}
                  <button
                    className="btn"
                    onClick={() => setRetry((v) => v + 1)}
                  >{t("Tekrar dene")}</button>
                </div>
              ) : loading ? (
                <div className="mods-grid" aria-label={t("Modlar yükleniyor")}>
                  {Array.from({ length: 6 }, (_, i) => (
                    <div className="glass mod-skeleton" key={i} />
                  ))}
                </div>
              ) : !visibleHits.length ? (
                <div className="glass">
                  {favView
                    ? t("Henüz favorin yok. Beğendiğin mod ve shaderları yıldızla, burada toplansın.")
                    : t("Bu filtrelerle mod bulunamadı.")}
                </div>
              ) : (
                <div className="mods-grid">
                  {visibleHits.map((h, i) => (
                    <article
                      className="glass mod-card"
                      key={h.project_id}
                      style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                    >
                      <ModImage
                        className="mod-icon"
                        src={h.icon_url}
                        alt=""
                        silent
                      />
                      <div className="mod-row-body">
                        <h3>
                          {h.title}{" "}
                          <small>{t("yazar:")} <b>{h.author}</b>
                          </small>
                        </h3>
                        <p>{h.description}</p>
                        <div className="mod-tags">
                          {h.categories
                            .filter((c) =>
                              ["fabric", "forge", "neoforge", "quilt"].includes(
                                c,
                              ),
                            )
                            .map((c) => (
                              <span
                                className="loader-badge"
                                data-loader={c}
                                key={c}
                              >
                                {c}
                              </span>
                            ))}
                          {h.categories
                            .filter(
                              (c) =>
                                ![
                                  "fabric",
                                  "forge",
                                  "neoforge",
                                  "quilt",
                                ].includes(c),
                            )
                            .slice(0, 5)
                            .map((c) => (
                              <span className="bd m" key={c}>
                                {c}
                              </span>
                            ))}
                        </div>
                      </div>
                      <div className="mod-row-side">
                        <div className="mod-stats">
                          <span title={t("İndirme")}>
                            ↓ {h.downloads.toLocaleString(locale())}
                          </span>
                          {h.follows !== undefined && (
                            <span title={t("Takipçi")}>
                              ♡ {h.follows.toLocaleString(locale())}
                            </span>
                          )}
                          <span title={t("Son güncelleme")}>
                            ◷ {h.date_modified.slice(0, 10)}
                          </span>
                        </div>
                        <div className="actions">
                          <FavButton on={!!favorites[h.project_id]} onClick={() => favorite(h, favKind(h.project_id) as Kind)} />
                          <button
                            className="btn"
                            onClick={() => {
                              if (favView) setKind(favKind(h.project_id) as Kind);
                              setProject(h);
                              setTab("Açıklama");
                            }}
                          >{t("Görüntüle")}</button>
                          {!favView && buttons(h)}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div className="actions mod-pagination" hidden={installedOnly || favView}>
                <button
                  className="btn"
                  disabled={!offset || loading}
                  onClick={() => setOffset((v) => Math.max(0, v - 12))}
                >{t("Önceki")}</button>
                <span>
                  {Math.floor(offset / 12) + 1} · {total} {t("sonuç")}</span>
                <button
                  className="btn"
                  disabled={offset + 12 >= total || loading}
                  onClick={() => setOffset((v) => v + 12)}
                >{t("Sonraki")}</button>
              </div>
            </section>
            {filters}
          </div>
        </>
      )}
      {running && (
        <div className="glass" role="status">
          <p>{progress.filename || t("Mod işlemi sürüyor…")}</p>
          <progress
            max={Math.max(1, progress.total_bytes)}
            value={progress.completed_bytes}
          />
          <button
            className="btn"
            onClick={() =>
              void invoke<Reply>("cancel_operation")
                .then((r) => onState(r.state))
                .catch((e) => notice(String(e)))
            }
          >{t("İptal")}</button>
        </div>
      )}
      {flow !== null && (
        <Modal
          title={`Mod kurulumu · ${project?.title ?? ""}`}
          close={() => {
            if (!running) setFlow(null);
          }}
          locked={pending || running}
        >
          {flow === 0 ? (
            <>
              <h3>{t("1 · Hedef profil")}</h3>
              <input
                className="field"
                aria-label={t("Profil ara")}
                placeholder={t("Profil ara…")}
                value={profileSearch}
                onChange={(e) => setProfileSearch(e.target.value)}
              />
              <div className="mod-profile-list">
                {profiles
                  .filter((p) =>
                    p.name
                      .toLocaleLowerCase("tr")
                      .includes(profileSearch.toLocaleLowerCase("tr")),
                  )
                  .map((p) => (
                    <button
                      className={"btn " + (target === p.id ? "v-add" : "")}
                      key={p.id}
                      disabled={!compatibleProfile(p) || disabled}
                      onClick={() => choose(p.id)}
                    >
                      {p.name} · {p.version} ·{" "}
                      {compatibleProfile(p)
                        ? "Fabric"
                        : t("Mod desteklemiyor / sürüm uyumsuz")}
                    </button>
                  ))}
              </div>
              <p className="lbl">{t("Vanilla profiller otomatik dönüştürülmez. Fabric profili oluşturabilirsin.")}</p>
              <button
                className="btn"
                disabled={disabled}
                onClick={() => setNewProfile((v) => !v)}
              >{t("Yeni profil oluştur")}</button>
              {newProfile && (
                <div className="wizard-fields">
                  <label>{t("Profil adı")}<input
                      className="field"
                      maxLength={32}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </label>
                  <label>{t("Minecraft sürümü")}<Select
                      className="field"
                      value={newMc}
                      onChange={(e) => setNewMc(e.target.value)}
                    >
                      {s.versions.map((v) => (
                        <option key={v.id}>{v.id}</option>
                      ))}
                    </Select>
                  </label>
                  <p className="lbl">{t("Fabric · Ayrı klasör · Görsel isteğe bağlı; varsayılan görseller kullanılır.")}</p>
                  <button
                    className="btn"
                    disabled={disabled || !newName.trim()}
                    onClick={() =>
                      void act(async () => {
                        const p = await invoke<ModPlan>(
                          "mods_create_fabric_profile",
                          {
                            name: newName,
                            versionId: newMc,
                            projects: [project!.project_id],
                          },
                        );
                        const reply = await invoke<Reply>("get_state");
                        onState(reply.state);
                        setTarget(p.profile);
                        setMc(p.mc);
                        setNewProfile(false);
                        setFlow(1);
                      })
                    }
                  >{t("Fabric profili oluştur")}</button>
                </div>
              )}
              <button
                className="btn v-add"
                disabled={disabled || !current || !compatibleProfile(current)}
                onClick={() => setFlow(1)}
              >{t("Sürüm seç →")}</button>
            </>
          ) : flow === 1 ? (
            <>
              <h3>{t("2 · Sürüm seçimi")}</h3>
              <label>
                <Toggle
                  type="checkbox"
                  checked={incompatible}
                  onChange={(e) => setIncompatible(e.target.checked)}
                />{" "}{t("Uyumsuzları göster")}</label>
              {pending ? (
                <p role="status">{t("Uyumlu sürümler yükleniyor…")}</p>
              ) : (
                <>
                  <Select
                    className="field"
                    aria-label={t("Mod sürümü")}
                    value={selectedVersion}
                    onChange={(e) => setSelectedVersion(e.target.value)}
                  >
                    <option value="">{t("Sürüm seç")}</option>
                    {versions?.compatible.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.version_number}
                        {v.id === versions.recommended ? t(" · Önerilen") : ""}
                      </option>
                    ))}
                  </Select>
                  {!versions?.compatible.length && (
                    <p>{t("Bu profil için uyumlu sürüm bulunamadı.")}</p>
                  )}
                  {incompatible &&
                    versions?.incompatible.map((v) => (
                      <p className="lbl" key={v.id}>
                        {v.version_number} {t("· Uyumsuz ·")}{" "}
                        {v.game_versions.join(", ")}
                      </p>
                    ))}
                  <button
                    className="btn v-add"
                    disabled={
                      disabled ||
                      !versions?.compatible.some(
                        (v) => v.id === selectedVersion,
                      )
                    }
                    onClick={() => void buildPlan()}
                  >{t("Bağımlılıkları incele →")}</button>
                </>
              )}
            </>
          ) : flow === 2 ? (
            <>
              <h3>{t("3 · Kurulum planı")}</h3>
              <p>
                {current?.name} {t("· Minecraft")} {plan?.mc}
              </p>
              {plan?.entries.map((e) => (
                <p key={e.project_id}>
                  {e.filename} ·{" "}
                  {e.user_selected ? t("Seçtiğin mod") : t("Zorunlu bağımlılık")}
                </p>
              ))}
              {plan?.installed.map((e) => (
                <p className="lbl" key={e.project_id}>
                  {e.filename} {t("· Kurulu (yeniden indirilmez)")}</p>
              ))}
              {plan?.warnings.map((w, i) => (
                <p className="mod-warning" key={i}>
                  {w}
                </p>
              ))}
              <p>
                {((plan?.total_bytes ?? 0) / 1024 / 1024).toFixed(2)} {t("MB indirilecek")}</p>
              <button
                className="btn v-add"
                disabled={disabled}
                onClick={() => setFlow(3)}
              >{t("Onaya geç →")}</button>
            </>
          ) : flow === 3 ? (
            <>
              <h3>{t("4 · Üçüncü taraf içerik")}</h3>
              <p>{t("Modlar bilgisayarında kod çalıştırır. Yalnızca güvendiğin kaynaklardan mod kur. Kurulum planındaki modları ve bağımlılıkları incele.")}</p>
              <label>
                <Toggle
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />{" "}{t("Anladım, devam et")}</label>
              <button
                className="btn v-add"
                disabled={disabled || !consent}
                onClick={() => void install()}
              >{t("Onayla ve kur")}</button>
            </>
          ) : (
            <>
              <h3>{running ? t("Mod kuruluyor…") : t("Kurulum tamamlanamadı")}</h3>
              {running && (
                <progress
                  max={Math.max(1, progress.total_bytes)}
                  value={progress.completed_bytes}
                />
              )}
              <p>{progress.filename}</p>
            </>
          )}
          {flowError && (
            <p className="mod-warning" role="alert">
              {flowError}
              <button
                className="btn"
                disabled={disabled}
                onClick={() => setRetry((v) => v + 1)}
              >{t("Tekrar dene")}</button>
            </p>
          )}
          {flow > 0 && flow < 4 && (
            <button
              className="btn"
              disabled={disabled}
              onClick={() => setFlow(flow - 1)}
            >{t("Geri")}</button>
          )}
        </Modal>
      )}
      {remove && (
        <Modal
          title={t("Modu kaldır")}
          close={() => setRemove(null)}
          locked={pending}
        >
          <p>
            {remove.entries.find((e) => e.project_id === remove.id)?.filename}{" "}{t("kaldırılacak.")}</p>
          {remove.entries.length > 1 && (
            <>
              <p>{t("Başka modların kullanmadığı bağımlılıklar:")}</p>
              {remove.entries
                .filter((e) => e.project_id !== remove.id)
                .map((e) => (
                  <p key={e.project_id}>{e.filename}</p>
                ))}
              <label>
                <Toggle
                  type="checkbox"
                  checked={removeDeps}
                  onChange={(e) => setRemoveDeps(e.target.checked)}
                />{" "}{t("Bu bağımlılıkları da kaldır")}</label>
            </>
          )}
          <p className="lbl">{t("Manifestte olmayan harici modlar korunur.")}</p>
          <button
            className="btn v-add"
            disabled={disabled}
            onClick={() => void removeMod()}
          >{t("Kaldırmayı onayla")}</button>
          {flowError && <p role="alert">{flowError}</p>}
        </Modal>
      )}
      {link && (
        <Modal title={t("Dış bağlantıyı aç")} close={() => setLink("")}>
          <p>{t("Bu bağlantı sistem tarayıcında açılacak:")}</p>
          <p className="lbl">{link}</p>
          <button
            className="btn v-add"
            onClick={() => {
              const url = modLink(link);
              if (url)
                void invoke("open_external", { url }).catch((e) =>
                  notice(String(e)),
                );
              setLink("");
            }}
          >{t("Tarayıcıda aç")}</button>
        </Modal>
      )}
      </>)}
    </div>
  );
}
