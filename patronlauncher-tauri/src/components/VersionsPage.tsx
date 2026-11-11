import { t } from "../i18n";
import {catalogCache, warmCatalog} from "../catalogCache";
import { Select, Toggle } from "./Controls";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InstalledVersion, Snapshot } from "../types/core";
import type { Run } from "../backend";
import type { Page } from "../navigation";
import {
  families,
  orderFamilies,
  familyGradient,
  type CatalogVersion,
  type SortOrder,
} from "../versions";
import artManifest from "../assets/versions/versions-art.json";
import { versionArt } from "../versionArt";
import Icon from "./Icon";
import VersionSetup from "./VersionSetup";
import VersionFx from "./VersionFx";
import "../styles/versions.css";
type Art = { title: string; image: string; desc: string };
const art = artManifest as Record<string, Art>;
const Artwork = memo(function Artwork({ family, version }: { family: string; version?: string }) {
  const entry = art[family],
    src = (version && versionArt(version)) || versionArt(family);
  const [broken, setBroken] = useState(false);
  return (
    <div className="v-artwork" style={{ background: familyGradient(family) }}>
      <b>{family}</b>
      <small>{entry?.title ?? t("Minecraft Java Edition")}</small>
      {src && !broken && (
        <img
          key={src}
          src={src}
          alt={entry?.title ?? `Minecraft ${family}`}
          loading="lazy"
          decoding="async"
          width={480}
          height={640}
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
});
export default function VersionsPage({
  s,
  run,
  go,
  onWorking,
}: {
  s: Snapshot;
  run: Run;
  go: (page: Page) => void;
  onWorking: (working: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogVersion[]>(catalogCache),
    [loading, setLoading] = useState(!catalogCache().length),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(""),
    [snapshots, setSnapshots] = useState(false),
    [legacy, setLegacy] = useState(false),
    [sort, setSort] = useState<SortOrder>("popular"),
    [chosen, setChosen] = useState(""),
    [patch, setPatch] = useState(""),
    [creating, setCreating] = useState(false);
  const [installed, setInstalled] = useState<InstalledVersion[]>([]),
    [onlyInstalled, setOnlyInstalled] = useState(false),
    [all, setAll] = useState(false),
    [job, setJob] = useState<{ mc: string; progress: number | null } | null>(
      null,
    );
  const refreshInstalled = useCallback(async () => {
    try {
      setInstalled(await invoke<InstalledVersion[]>("list_installed_versions"));
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    if (!s.busy) void refreshInstalled();
  }, [s.busy, refreshInstalled]);
  const defaults = [
    "26",
    "1.21",
    "1.20",
    "1.19",
    "1.18",
    "1.17",
    "1.16",
    "1.15",
    "1.14",
    "1.13",
    "1.12",
    "1.8",
    "1.7",
  ];

  const workingChanged = useCallback(
    (working: boolean) => {
      setCreating(working);
      onWorking(working);
    },
    [onWorking],
  );
  useEffect(() => () => onWorking(false), [onWorking]);
  const ready = !s.load_failed;
  useEffect(()=>{const update=()=>{setCatalog(catalogCache());setLoading(false);};window.addEventListener("patron-catalog",update);return()=>window.removeEventListener("patron-catalog",update);},[]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    setLoading(!catalogCache().length);
    setError("");
    warmCatalog()
      .then((entries) => {
        if (active) setCatalog(entries);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ready, retry]);
  const grouped = useMemo(
    () => families(catalog, snapshots, legacy),
    [catalog, snapshots, legacy],
  );
  const visible = useMemo(
    () =>
      orderFamilies(
        grouped.filter((f) => {
          if (
            !all &&
            !defaults.includes(f.id) &&
            f.versions.every((v) => v.type === "release")
          )
            return false;
          if (
            onlyInstalled &&
            !f.versions.some((v) => installed.some((i) => i.mc === v.id))
          )
            return false;
          const q = query.trim().toLocaleLowerCase("tr");
          return (
            !q ||
            f.id.toLocaleLowerCase("tr").includes(q) ||
            (art[f.id]?.title ?? "").toLocaleLowerCase("tr").includes(q) ||
            f.versions.some((v) => v.id.toLocaleLowerCase("tr").includes(q))
          );
        }),
        sort,
      ),
    [grouped, query, sort, all, onlyInstalled, installed],
  );
  const family = visible.find((f) => f.id === chosen) ?? visible[0];
  const version =
    family?.versions.find((v) => v.id === patch) ?? family?.versions[0];
  const supported = !!version && s.versions.some((v) => v.id === version.id);

  return (
    <section className="versions-page">
      <div className="v-toolbar">
        <input
          className="field"
          aria-label={t("Sürüm ara")}
          disabled={creating}
          placeholder={t("Sürüm ara… (örn. 1.18)")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          aria-label={t("Sürümleri sırala")}
          disabled={creating}
          title={t("Popüler: önerilen aile sırası; kullanım istatistiği değildir.")}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOrder)}
        >
          <option value="popular">{t("Popüler")}</option>
          <option value="newest">{t("Yeni → eski")}</option>
          <option value="oldest">{t("Eski → yeni")}</option>
        </Select>
        <div className="v-filters">
          <label className="v-toggle">
            <Toggle
              type="checkbox"
              checked={onlyInstalled}
              disabled={creating}
              onChange={(e) => setOnlyInstalled(e.target.checked)}
            />
            <span />{t("Kurulu sürümler")}</label>
          <label className="v-toggle">
            <Toggle
              type="checkbox"
              checked={all}
              disabled={creating}
              onChange={(e) => setAll(e.target.checked)}
            />
            <span />{t("Tüm sürümleri göster")}</label>
          <label className="v-toggle">
            <Toggle
              type="checkbox"
              disabled={creating}
              checked={snapshots}
              onChange={(e) => setSnapshots(e.target.checked)}
            />
            <span />{t("Snapshot'ları göster")}</label>
          <label className="v-toggle">
            <Toggle
              type="checkbox"
              disabled={creating}
              checked={legacy}
              onChange={(e) => setLegacy(e.target.checked)}
            />
            <span />{t("Eski sürümler (alpha/beta)")}</label>
        </div>
      </div>
      {loading && <div className="catalog-skeletons" role="status" aria-label={t("Sürüm kataloğu hazırlanıyor")}>{Array.from({length:12},(_,i)=><div key={i} className="catalog-skeleton"/>)}</div>}
      {error && (
        <div className="glass" role="alert">{t("Sürüm kataloğu alınamadı:")} {error}
          <button className="btn" onClick={() => setRetry((n) => n + 1)}>{t("Yeniden dene")}</button>
        </div>
      )}
      <div className="v-layout">
        <div className="v-grid" aria-label={t("Sürüm aileleri")}>
          {visible.map((f, i) => (
            <button
              type="button"
              className={`v-card ${family?.id === f.id ? "v-selected" : ""}`}
              key={f.id}
              aria-label={t("Minecraft {family} ailesini seç", { family: f.id })}
              aria-pressed={family?.id === f.id}
              disabled={creating}
              style={
                { "--v-delay": `${Math.min(i, 14) * 35}ms` } as CSSProperties
              }
              onClick={() => {
                setChosen(f.id);
                setPatch("");
              }}
            >
              <div className="v-poster">
                <Artwork family={f.id} />
                <VersionFx version={f.id} />
                {f.versions.some((v) =>
                  installed.some((i) => i.mc === v.id),
                ) && <span className="v-installed">{t("KURULU")}</span>}
              </div>
              <small className="v-loader-badges">
                {["Vanilla", "Fabric"]
                  .filter((l) =>
                    f.versions.some((v) =>
                      installed.some((i) => i.mc === v.id && i.loader === l),
                    ),
                  )
                  .map((l) => (
                    <span key={l}>{l} ✓ </span>
                  ))}
              </small>
              {job && f.versions.some((v) => v.id === job.mc) && (
                <progress
                  aria-label={t("Kart kurulum ilerlemesi")}
                  max={1}
                  value={job.progress ?? undefined}
                />
              )}
              <span className="v-name">
                <span>{f.id}</span>
                <Icon name="play" />
              </span>
            </button>
          ))}
          {!loading && !error && !visible.length && (
            <p className="lbl">{t("Bu filtrelerle eşleşen sürüm bulunamadı.")}</p>
          )}
        </div>
        {family && version && (
          <aside className="v-panel glass" aria-label={t("Seçili sürüm ailesi")}>
            <div className="v-preview">
              <Artwork key={version.id} family={family.id} version={version.id} />
              <VersionFx version={family.id} />
            </div>
            <div className="v-panel-content" key={version.id}>
              <h2>Minecraft {family.id}</h2>
              <h4>
                {art[family.id]?.title ??
                  (family.id === "Snapshot"
                    ? t("Geliştirme sürümleri")
                    : t("Minecraft Java Edition"))}
              </h4>
              {art[family.id]?.desc && <p className="lbl">{art[family.id]!.desc}</p>}
              <label className="lbl" htmlFor="version-patch">{t("SÜRÜM")}</label>
              <Select
                id="version-patch"
                aria-label={t("Ailedeki sürüm")}
                disabled={creating}
                value={version.id}
                onChange={(e) => setPatch(e.target.value)}
              >
                {family.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                    {v.type === "snapshot" ? t(" · Snapshot") : ""}
                  </option>
                ))}
              </Select>
              <div className="v-loader-badges">
                {["Vanilla", "Fabric"]
                  .filter((l) =>
                    installed.some(
                      (i) => i.mc === version.id && i.loader === l,
                    ),
                  )
                  .map((l) => (
                    <span className="v-badge v-ready" key={l}>
                      {l} {t("✓ · Kurulu")}</span>
                  ))}
              </div>
              {!supported && (
                <p className="lbl" role="note">{t("Bu sürüm mevcut başlatma çekirdeğinde desteklenmiyor. Kurulum için desteklenen kararlı bir sürüm seç.")}</p>
              )}
              {version.type !== "release" && (
                <p className="lbl">{t("Deneme ve eski sürümlerde dünya uyumluluğu değişebilir; ayrı profil kullan.")}</p>
              )}
              <VersionSetup
                mc={version.id}
                supported={supported}
                s={s}
                run={run}
                go={go}
                installed={installed}
                onInstalled={refreshInstalled}
                onJob={setJob}
                onWorking={workingChanged}
              />
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
