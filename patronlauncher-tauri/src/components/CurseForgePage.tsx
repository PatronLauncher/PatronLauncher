import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EventEnvelope, Reply, Snapshot } from "../types/core";
import { locale, msg, t } from "../i18n";
import { profileArtwork } from "../profileArtwork";
import { Select } from "./Controls";
import ContentInstall, { type ContentKind } from "./ContentInstall";
import Icon from "./Icon";
import Modal from "./Modal";
import ModImage from "./ModImage";
const ModContent = lazy(() => import("./ModContent"));

type Kind = "mod" | "resourcepack" | "shader" | "datapack" | "modpack";
type CfMod = {
  id: number;
  name: string;
  summary: string;
  downloadCount: number;
  dateModified: string;
  logo?: { thumbnailUrl?: string; url?: string } | null;
  authors?: { name: string }[];
  categories?: { id: number; name: string }[];
  links?: { websiteUrl?: string };
  screenshots?: { url: string; title?: string }[];
};
type Category = { id: number; name: string; parentCategoryId?: number; isClass?: boolean };
type Entry = { project_id: string; filename: string; user_selected: boolean };
type Plan = { id: string; entries: Entry[]; installed: Entry[]; warnings: string[]; total_bytes: number };
type CfFile = { id: number; display_name: string; release_type: number; file_date: string; file_length: number };

const kinds: [Kind, string][] = [
  ["mod", msg("Modlar")],
  ["resourcepack", msg("Kaynak paketleri")],
  ["shader", msg("Shaderlar")],
  ["datapack", msg("Veri paketleri")],
  ["modpack", msg("Mod paketleri")],
];
const sorts: [string, string][] = [
  ["popularity", msg("Popülerlik")],
  ["downloads", msg("Toplam indirme")],
  ["updated", msg("Son güncelleme")],
  ["newest", msg("Yeni çıkanlar")],
  ["name", msg("Ad")],
];
const compact = (n: number) =>
  new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const date = (iso: string) => new Date(iso).toLocaleDateString(locale());
const megabytes = (bytes: number) => (bytes / 1048576).toLocaleString(locale(), { maximumFractionDigits: 1 });

export default function CurseForgePage({
  s,
  onState,
  notice,
  goSettings,
}: {
  s: Snapshot;
  onState: (s: Snapshot) => void;
  notice: (m: string) => void;
  goSettings: () => void;
}) {
  const [keyStatus, setKeyStatus] = useState<string | null>(null),
    [kind, setKind] = useState<Kind>("mod"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("popularity"),
    [mc, setMc] = useState(""),
    [category, setCategory] = useState<number | null>(null),
    [categories, setCategories] = useState<Category[]>([]),
    [index, setIndex] = useState(0),
    [hits, setHits] = useState<CfMod[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<{ project: CfMod; description: string } | null>(null),
    [detailTab, setDetailTab] = useState("Açıklama"),
    [files, setFiles] = useState<CfFile[] | null>(null),
    [installing, setInstalling] = useState<CfMod | null>(null),
    [contentHit, setContentHit] = useState<CfMod | null>(null),
    [installed, setInstalled] = useState<string[]>([]),
    [link, setLink] = useState(""),
    [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const fabricProfiles = s.profiles.filter(
    (p) => p.kind !== "Quick" && ["Fabric", "Quilt", "NeoForge", "Forge"].includes(p.loader ?? ""),
  );
  const [target, setTarget] = useState(
    fabricProfiles.find((p) => p.id === s.selected_profile)?.id ?? fabricProfiles[0]?.id ?? "",
  );
  const pageSize = 15;
  useEffect(() => {
    void invoke<string>("curseforge_key_status")
      .then(setKeyStatus)
      .catch(() => setKeyStatus("missing"));
  }, []);
  const refreshInstalled = () => {
    if (!target) return setInstalled([]);
    void invoke<{ managed: Entry[] }>("mods_list", { id: target })
      .then((l) => setInstalled((l?.managed ?? []).map((e) => e.project_id)))
      .catch(() => setInstalled([]));
  };
  useEffect(refreshInstalled, [target, s.busy]);
  useEffect(() => {
    if (keyStatus !== "user" && keyStatus !== "bundled") return;
    void invoke<{ data: Category[] }>("curseforge_categories", { kind })
      .then((r) => setCategories((r?.data ?? []).filter((c) => !c.isClass).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setCategories([]));
  }, [kind, keyStatus]);
  useEffect(() => {
    if (keyStatus !== "user" && keyStatus !== "bundled") return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      invoke<{ data: CfMod[]; pagination: { totalCount: number } }>("curseforge_search", {
        search: {
          kind,
          query,
          sort,
          category,
          game_version: mc || null,
          fabric: kind === "mod",
          loader: kind === "mod" ? (fabricProfiles.find((p) => p.id === target)?.loader ?? null) : null,
          index,
          page_size: pageSize,
        },
      })
        .then((r) => {
          if (!active) return;
          setHits(Array.isArray(r?.data) ? r.data : []);
          setTotal(Math.min(Number(r?.pagination?.totalCount) || 0, 10_000));
        })
        .catch((e) => active && setError(String(e)))
        .finally(() => active && setLoading(false));
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [kind, query, sort, mc, category, index, keyStatus, target]);
  const open = (m: CfMod) => {
    setDetailTab("Açıklama");
    setFiles(null);
    setDetail({ project: m, description: "" });
    void invoke<{ project: CfMod; description: string }>("curseforge_project", { project: m.id })
      .then((d) => setDetail({ project: d.project ?? m, description: typeof d.description === "string" ? d.description : "" }))
      .catch((e) => notice(String(e)));
  };
  useEffect(() => {
    if (!detail || detailTab !== "Dosyalar" || files || !target) return;
    void invoke<CfFile[]>("curseforge_files", { profile: target, project: detail.project.id, kind })
      .then(setFiles)
      .catch((e) => notice(String(e)));
  }, [detail, detailTab, target]);
  const install = (m: CfMod) => {
    if (kind === "mod") setInstalling(m);
    else if (kind !== "modpack") setContentHit(m);
  };
  if (keyStatus === null) return <div className="glass">{t("CurseForge bağlanıyor…")}</div>;
  if (keyStatus === "missing")
    return (
      <section className="glass cf-key-missing">
        <span className="source-logo curseforge big" aria-hidden="true" />
        <h3>{t("CurseForge bu sürümde kullanılamıyor")}</h3>
        <p className="lbl">{t("Bu derlemede CurseForge bağlantısı yok. Modrinth sekmesini kullanabilirsin.")}</p>
      </section>
    );
  const actionFor = (m: CfMod) =>
    kind === "modpack" ? (
      <button className="btn" disabled title={t("Mod paketi kurulumu bir sonraki aşamada gelecek.")}>
        {t("Yakında")}
      </button>
    ) : kind === "mod" && installed.includes(`cf-${m.id}`) ? (
      <button className="btn" disabled>
        {t("Kurulu ✓")}
      </button>
    ) : (
      <button className="btn cf-install" disabled={s.busy || s.running} onClick={() => install(m)}>
        <Icon name="plus" /> {t("Kur")}
      </button>
    );
  return (
    <div className="cf-page">
      <div className="actions cf-classes" role="tablist">
        {kinds.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={kind === key}
            className={"btn " + (kind === key ? "on" : "")}
            onClick={() => {
              setKind(key);
              setCategory(null);
              setIndex(0);
              setDetail(null);
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {detail ? (
        <section className="cf-detail glass">
          <button className="btn" onClick={() => setDetail(null)}>
            ← {t("Listeye dön")}
          </button>
          <div className="cf-detail-head">
            {detail.project.logo?.thumbnailUrl && (
              <ModImage className="cf-logo big" src={detail.project.logo.thumbnailUrl} alt="" />
            )}
            <div>
              <h2>{detail.project.name}</h2>
              <p className="lbl">
                {t("yazar:")} <b>{detail.project.authors?.[0]?.name ?? "—"}</b> · ↓ {compact(detail.project.downloadCount)} ·{" "}
                {date(detail.project.dateModified)}
              </p>
            </div>
            <div className="sp" />
            {actionFor(detail.project)}
          </div>
          <div className="actions cf-tabs">
            {[msg("Açıklama"), msg("Galeri"), msg("Dosyalar")].map((tab) => (
              <button key={tab} className={"btn " + (detailTab === tab ? "on" : "")} onClick={() => setDetailTab(tab)}>
                {t(tab)}
              </button>
            ))}
          </div>
          {detailTab === "Açıklama" ? (
            <Suspense fallback={<div className="image-skeleton">{t("İçerik yükleniyor…")}</div>}>
              <ModContent text={detail.description || detail.project.summary} open={setLink} enlarge={(src, alt) => setLightbox({ src, alt })} />
            </Suspense>
          ) : detailTab === "Galeri" ? (
            <div className="mod-gallery">
              {detail.project.screenshots?.length ? (
                detail.project.screenshots.map((g) => (
                  <button key={g.url} className="mod-gallery-item" onClick={() => setLightbox({ src: g.url, alt: g.title ?? "" })}>
                    <ModImage src={g.url} alt={g.title ?? ""} />
                  </button>
                ))
              ) : (
                <p>{t("Galeri görseli yok.")}</p>
              )}
            </div>
          ) : (
            <div className="cf-files">
              {!target && <p className="lbl">{t("Önce bir sürüm veya profil oluştur.")}</p>}
              {target && files === null && <p className="lbl">{t("Uyumlu sürümler yükleniyor…")}</p>}
              {files?.length === 0 && <p className="lbl">{t("Bu profil için uyumlu sürüm bulunamadı.")}</p>}
              {files?.map((f) => (
                <div className="cf-file" key={f.id}>
                  <span className={"cf-release r" + f.release_type}>{f.release_type === 1 ? "R" : f.release_type === 2 ? "B" : "A"}</span>
                  <b>{f.display_name}</b>
                  <small className="lbl">
                    {date(f.file_date)} · {megabytes(f.file_length)} MB
                  </small>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="cf-layout">
          <aside className="cf-sidebar glass">
            <h4>{t("Kategoriler")}</h4>
            <button className={"cf-cat " + (category === null ? "on" : "")} onClick={() => { setCategory(null); setIndex(0); }}>
              {t("Tümü")}
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={"cf-cat " + (category === c.id ? "on" : "")}
                onClick={() => {
                  setCategory(c.id);
                  setIndex(0);
                }}
              >
                {c.name}
              </button>
            ))}
          </aside>
          <section className="cf-results">
            <div className="cf-toolbar">
              <label className="settings-search cf-search">
                <Icon name="search" />
                <input
                  placeholder={t("CurseForge'da ara…")}
                  aria-label={t("CurseForge'da ara…")}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setIndex(0);
                  }}
                />
              </label>
              <Select aria-label={t("Sırala")} value={sort} onChange={(e) => { setSort(e.target.value); setIndex(0); }}>
                {sorts.map(([key, label]) => (
                  <option key={key} value={key}>
                    {t(label)}
                  </option>
                ))}
              </Select>
              <Select aria-label={t("Oyun sürümü")} value={mc} onChange={(e) => { setMc(e.target.value); setIndex(0); }}>
                <option value="">{t("Tüm sürümler")}</option>
                {s.versions
                  .filter((v) => v.type === "release")
                  .slice(0, 40)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                    </option>
                  ))}
              </Select>
              {kind === "mod" && (
                <Select aria-label={t("Hedef profil")} value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="" disabled>
                    {t("Modlu profil seç")}
                  </option>
                  {fabricProfiles.map((p) => (
                    <option key={p.id} value={p.id} data-icon={profileArtwork(p.appearance?.icon, "icon")}>
                      {p.name} · {p.version} · {p.loader}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            {error && (
              <div className="glass setting-warning" role="alert">
                {error}
              </div>
            )}
            {loading && !hits.length && <div className="cf-row skeleton" />}
            {!loading && !error && !hits.length && <div className="glass">{t("Bu filtrelerle sonuç bulunamadı.")}</div>}
            <ul className="cf-list">
              {hits.map((m, i) => (
                <li key={m.id} className="cf-row" style={{ "--i": i } as React.CSSProperties}>
                  <button className="cf-row-main" onClick={() => open(m)}>
                    {m.logo?.thumbnailUrl ? (
                      <ModImage className="cf-logo" src={m.logo.thumbnailUrl} alt="" />
                    ) : (
                      <span className="cf-logo placeholder">{m.name.slice(0, 2)}</span>
                    )}
                    <span className="cf-text">
                      <b>
                        {m.name} <small>{t("yazar:")} {m.authors?.[0]?.name ?? "—"}</small>
                      </b>
                      <span className="cf-summary">{m.summary}</span>
                      <span className="cf-meta">
                        <span>↓ {compact(m.downloadCount)}</span>
                        <span>⟳ {date(m.dateModified)}</span>
                        {m.categories?.slice(0, 3).map((c) => (
                          <em key={c.id}>{c.name}</em>
                        ))}
                      </span>
                    </span>
                  </button>
                  {actionFor(m)}
                </li>
              ))}
            </ul>
            {total > pageSize && (
              <div className="actions cf-pages">
                <button className="btn" disabled={index === 0} onClick={() => setIndex(Math.max(0, index - pageSize))}>
                  {t("Önceki")}
                </button>
                <span className="lbl">
                  {Math.floor(index / pageSize) + 1} · {t("{count} sonuç", { count: total.toLocaleString(locale()) })}
                </span>
                <button className="btn" disabled={index + pageSize >= total} onClick={() => setIndex(index + pageSize)}>
                  {t("Sonraki")}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {installing && (
        <CfModInstall
          s={s}
          mod={installing}
          target={target}
          setTarget={setTarget}
          profiles={fabricProfiles}
          onState={onState}
          close={() => {
            setInstalling(null);
            refreshInstalled();
          }}
          notice={notice}
        />
      )}
      {contentHit && (kind === "resourcepack" || kind === "shader" || kind === "datapack") && (
        <ContentInstall
          s={s}
          kind={kind as ContentKind}
          source="curseforge"
          hit={{ project_id: String(contentHit.id), title: contentHit.name }}
          close={() => setContentHit(null)}
          notice={notice}
        />
      )}
      {lightbox && (
        <Modal title={lightbox.alt || t("Görsel")} close={() => setLightbox(null)}>
          <ModImage src={lightbox.src} alt={lightbox.alt} />
        </Modal>
      )}
      {link && (
        <Modal title={t("Dış bağlantıyı aç")} close={() => setLink("")}>
          <p>{t("Bu bağlantı sistem tarayıcında açılacak:")}</p>
          <code className="technical-details">{link}</code>
          <button
            className="btn"
            onClick={() => {
              void invoke("open_external", { url: link }).catch((e) => notice(String(e)));
              setLink("");
            }}
          >
            {t("Tarayıcıda aç")}
          </button>
        </Modal>
      )}
    </div>
  );
}

/** Mod + zorunlu bağımlılıklar: plan → onay → çekirdek işi olarak kurulum. */
function CfModInstall({
  s,
  mod,
  target,
  setTarget,
  profiles,
  onState,
  close,
  notice,
}: {
  s: Snapshot;
  mod: CfMod;
  target: string;
  setTarget: (id: string) => void;
  profiles: Snapshot["profiles"];
  onState: (s: Snapshot) => void;
  close: () => void;
  notice: (m: string) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [running, setRunning] = useState(false),
    [bytes, setBytes] = useState(0);
  const runningRef = useRef(false);
  useEffect(() => {
    if (!target) return;
    let active = true;
    setPlan(null);
    setError("");
    setLoading(true);
    invoke<Plan>("curseforge_plan", { id: target, project: mod.id, file: null })
      .then((p) => active && setPlan(p))
      .catch((e) => active && setError(String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [target]);
  useEffect(() => {
    const offs: Promise<() => void>[] = [
      listen<{ completed_bytes: number; profile_id: string }>("patronlauncher://mods-progress", (e) => {
        if (runningRef.current && e.payload.profile_id === target) setBytes(e.payload.completed_bytes);
      }),
      listen<EventEnvelope>("patronlauncher://core-event", (e) => {
        if (!runningRef.current || e.payload.event.kind !== "finished") return;
        runningRef.current = false;
        setRunning(false);
        if ("Ok" in e.payload.event.result) {
          notice(t("{name} kuruldu.", { name: mod.name }));
          close();
        } else setError(String((e.payload.event.result as { Err: string }).Err));
      }),
    ];
    return () => offs.forEach((p) => void p.then((off) => off()).catch(() => {}));
  }, [target]);
  const confirm = async () => {
    if (!plan) return;
    setError("");
    setRunning(true);
    runningRef.current = true;
    try {
      const reply = await invoke<Reply>("curseforge_install", { id: target, planId: plan.id, confirmed: true });
      onState(reply.state);
    } catch (e) {
      runningRef.current = false;
      setRunning(false);
      setError(String(e));
    }
  };
  return (
    <Modal title={t("{name} kur", { name: mod.name })} close={close} locked={running}>
      <div className="content-install">
        <label className="lbl">
          {t("Hedef profil")}
          <Select className="field" aria-label={t("Hedef profil")} value={target} disabled={running} onChange={(e) => setTarget(e.target.value)}>
            <option value="" disabled>
              {t("Modlu profil seç")}
            </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.version}
              </option>
            ))}
          </Select>
        </label>
        {!profiles.length && <p className="lbl setting-warning">{t("Mod kurmak için Fabric profili oluştur.")}</p>}
        {loading && <p className="lbl">{t("Bağımlılıklar kontrol ediliyor…")}</p>}
        {plan && (
          <>
            <ul className="cf-plan">
              {plan.entries.map((e) => (
                <li key={e.project_id}>
                  <b>{e.filename}</b>
                  <small>{e.user_selected ? t("Seçtiğin mod") : t("Zorunlu bağımlılık")}</small>
                </li>
              ))}
              {plan.installed.map((e) => (
                <li key={e.project_id} className="lbl">
                  {e.filename} {t("· Kurulu (yeniden indirilmez)")}
                </li>
              ))}
            </ul>
            {plan.warnings.map((w) => (
              <p key={w} className="lbl setting-warning">
                {w}
              </p>
            ))}
            <p className="lbl">
              {megabytes(plan.total_bytes)} {t("MB indirilecek")} · {t("SHA-1 özetleri doğrulanacak.")}
            </p>
          </>
        )}
        {running && (
          <progress aria-label={t("Kurulum ilerlemesi")} max={plan?.total_bytes || 1} value={bytes} />
        )}
        {error && (
          <p className="lbl setting-warning" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="btn" disabled={running} onClick={close}>
            {t("Vazgeç")}
          </button>
          <button
            className="btn primary cf-install"
            disabled={!plan || running || s.busy || !plan.entries.length}
            onClick={() => void confirm()}
          >
            {running ? t("Kuruluyor…") : plan && !plan.entries.length ? t("Kurulu ✓") : t("Onayla ve kur")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
