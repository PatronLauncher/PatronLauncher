import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { getLanguage, locale, msg, t, type Language } from "../i18n";
import { useAppearance } from "../appearance";
import { Select } from "./Controls";
import { CountryFlag } from "./Flag";
import Icon from "./Icon";
import Mascot from "./Mascot";
import ModImage from "./ModImage";

export type Server = {
  id: string;
  name: string;
  address: string;
  port: number | null;
  country: string;
  languages: string[];
  tags: string[];
  description: Record<string, string>;
  versions: string;
  website: string | null;
  discord: string | null;
  sponsored: boolean;
  featured: boolean;
  /** Sitedeki bu ayın oyları ve sırası (eski önbellekte yoktur). */
  votes?: number;
  rank?: number | null;
  banner?: string | null;
};
export type Ping = {
  online: boolean;
  players: number | null;
  max_players: number | null;
  version: string | null;
  motd: string | null;
  favicon: string | null;
  latency_ms: number | null;
};
/** Bu cihazdaki oy, puan ve favori kaydı (Rust: servers::Vote). */
type Vote = { votes: number; last_vote: number; rating: number | null; favorite: boolean };
type Sort = "featured" | "players" | "votes" | "rating" | "latency" | "name";
/** "home" = dile göre önerilen bölge, "all", "fav" ya da ülke kodu. */
type Scope = string;
const countryNames: Record<string, string> = {
  tr: msg("Türkiye"),
  us: msg("ABD"),
  gb: msg("Birleşik Krallık"),
  de: msg("Almanya"),
  es: msg("İspanya"),
  cl: msg("Şili"),
  fr: msg("Fransa"),
  in: msg("Hindistan"),
  it: msg("İtalya"),
  pl: msg("Polonya"),
  br: msg("Brezilya"),
  ru: msg("Rusya"),
  nl: msg("Hollanda"),
  id: msg("Endonezya"),
  pt: msg("Portekiz"),
};
/**
 * Konum yerine launcher dili kullanılır: IP sorgusu yapılmaz, hiçbir veri dışarı gitmez.
 * Oyuncu ülkeyi istediği an değiştirebilir.
 */
const languageCountries: Record<Language, string[]> = {
  tr: ["tr"],
  en: ["us", "gb"],
  de: ["de"],
  es: ["es", "cl"],
  fr: ["fr"],
  hi: ["in"],
  it: ["it"],
  pl: ["pl"],
  pt: ["br", "pt"],
  ru: ["ru"],
};
const SCOPE_KEY = "patron-server-scope";
const readScope = (): Scope => {
  try {
    return localStorage.getItem(SCOPE_KEY) || "home";
  } catch {
    return "home";
  }
};
const sorts: [Sort, string][] = [
  ["featured", msg("Önerilen")],
  ["players", msg("En kalabalık")],
  ["votes", msg("Bu ay en çok oy alan")],
  ["rating", msg("En yüksek puanım")],
  ["latency", msg("En düşük gecikme")],
  ["name", msg("A–Z")],
];
/** Panelde ilk bakışta gösterilen etiket sayısı. */
const TAG_PREVIEW = 6;
const describe = (s: Server) =>
  s.description[getLanguage()] ?? s.description.en ?? s.description.tr ?? "";
const number = (n: number) => n.toLocaleString(locale());
const address = (sv: Server) => (sv.port ? `${sv.address}:${sv.port}` : sv.address);
const latencyClass = (ms: number) => (ms < 70 ? "good" : ms < 160 ? "ok" : "bad");

function ServerIcon({ server, ping }: { server: Server; ping?: Ping }) {
  return ping?.favicon ? (
    <img className="server-icon" src={ping.favicon} alt="" />
  ) : (
    <span className="server-icon placeholder" aria-hidden="true">
      {server.name.slice(0, 2).toLocaleUpperCase()}
    </span>
  );
}
function Players({ ping }: { ping?: Ping }) {
  if (!ping) return <span className="server-players lbl">{t("Kontrol ediliyor…")}</span>;
  if (!ping.online)
    return <span className="server-players offline">{t("Çevrimdışı")}</span>;
  return (
    <span className="server-players">
      <i className="online-dot" />
      <b>{number(ping.players ?? 0)}</b>
      {ping.max_players ? <small>/{number(ping.max_players)}</small> : null}
    </span>
  );
}
function CountryMark({ country }: { country: string }) {
  return (
    <span className="server-region" title={t(countryNames[country] ?? country)}>
      <CountryFlag code={country} />
    </span>
  );
}
function Stars({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <span className="server-stars" role="radiogroup" aria-label={t("Puanın")} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={t("{count} yıldız", { count: n })}
          className={n <= shown ? "on" : ""}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
        >
          <Icon name="star" />
        </button>
      ))}
    </span>
  );
}

type Filters = {
  scope: Scope;
  setScope: (r: Scope) => void;
  home: string[];
  tags: string[];
  setTags: (t: string[]) => void;
  query: string;
  setQuery: (q: string) => void;
  sort: Sort;
  setSort: (s: Sort) => void;
};
/** Bölge kapsamı, ülke seçimi, etiket bulutu, sıralama ve arama; panel ve tarayıcıda ortak. */
function FilterBar({
  servers,
  f,
  allTags,
  inScope,
  favorites,
  wide,
}: {
  servers: Server[];
  f: Filters;
  allTags: [string, number][];
  inScope: (sv: Server, scope: Scope) => boolean;
  favorites: number;
  wide?: boolean;
}) {
  const [more, setMore] = useState(false);
  const shown =
    wide || more
      ? allTags
      : allTags.filter(([tg], i) => i < TAG_PREVIEW || f.tags.includes(tg));
  const active = f.scope !== "home" || f.tags.length > 0 || !!f.query;
  const toggleTag = (tg: string) =>
    f.setTags(f.tags.includes(tg) ? f.tags.filter((x) => x !== tg) : [...f.tags, tg]);
  const count = (scope: Scope) => servers.filter((sv) => inScope(sv, scope)).length;
  const countries = Object.keys(countryNames)
    .map((c) => [c, servers.filter((sv) => sv.country === c).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => t(countryNames[a[0]]).localeCompare(t(countryNames[b[0]]), locale()));
  const chip = (scope: Scope, mark: React.ReactNode, label: string) => (
    <button
      key={scope}
      className={"region-chip " + (f.scope === scope ? "on" : "")}
      aria-pressed={f.scope === scope}
      aria-label={label}
      title={label}
      onClick={() => f.setScope(scope)}
    >
      {mark}
      <span className="region-label">{label}</span>
      <small>{count(scope)}</small>
    </button>
  );
  const homeLabel = f.home.length
    ? f.home.map((c) => t(countryNames[c] ?? c)).join(" · ")
    : t("Öne çıkanlar");
  return (
    <div className={"server-filters " + (wide ? "wide" : "")}>
      <label className="settings-search server-search">
        <Icon name="search" />
        <input
          placeholder={t("Sunucu, adres veya tür ara…")}
          aria-label={t("Sunucu, adres veya tür ara…")}
          value={f.query}
          onChange={(e) => f.setQuery(e.target.value)}
        />
      </label>
      <div className="server-regions" role="group" aria-label={t("Bölge")}>
        {chip("home", f.home[0] ? <CountryFlag code={f.home[0]} /> : <span className="region-code">✦</span>, homeLabel)}
        {chip("all", <span className="region-code">🌐</span>, t("Tüm dünya"))}
        {favorites > 0 && chip("fav", <Icon name="heart" />, t("Favoriler"))}
        <Select
          className={"server-country " + (countryNames[f.scope] ? "on" : "")}
          aria-label={t("Ülke")}
          value={countryNames[f.scope] ? f.scope : ""}
          onChange={(e) => f.setScope(e.target.value || "home")}
        >
          <option value="">{t("Ülke seç…")}</option>
          {countries.map(([c, n]) => (
            <option key={c} value={c}>
              {t(countryNames[c])} ({n})
            </option>
          ))}
        </Select>
      </div>
      <div className="server-tag-cloud" role="group" aria-label={t("Sunucu türü")}>
        {shown.map(([tg, n]) => (
          <button
            key={tg}
            className={"tag-chip " + (f.tags.includes(tg) ? "on" : "")}
            aria-pressed={f.tags.includes(tg)}
            onClick={() => toggleTag(tg)}
          >
            {tg}
            <small>{n}</small>
          </button>
        ))}
        {!wide && allTags.length > TAG_PREVIEW && (
          <button className="tag-chip more" onClick={() => setMore((m) => !m)}>
            {more ? t("Daha az") : t("+{count} tür", { count: allTags.length - TAG_PREVIEW })}
          </button>
        )}
      </div>
      <div className="server-filter-foot">
        <Select
          className="server-sort"
          aria-label={t("Sıralama")}
          value={f.sort}
          onChange={(e) => f.setSort(e.target.value as Sort)}
        >
          {sorts.map(([key, label]) => (
            <option key={key} value={key}>
              {t(label)}
            </option>
          ))}
        </Select>
        {active && (
          <button
            className="btn server-clear"
            onClick={() => {
              f.setScope("home");
              f.setTags([]);
              f.setQuery("");
            }}
          >
            {t("Filtreleri temizle")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ServerPanel({
  s,
  run,
  notice,
}: {
  s: Snapshot;
  run: Run;
  notice: (m: string) => void;
}) {
  const { prefs, update } = useAppearance();
  const collapsed = prefs.server_panel_collapsed;
  const [servers, setServers] = useState<Server[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [pings, setPings] = useState<Record<string, Ping>>({}),
    [scope, setScopeState] = useState<Scope>(readScope),
    [tags, setTags] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState<Sort>("featured"),
    [votes, setVotes] = useState<Record<string, Vote>>({}),
    [browser, setBrowser] = useState<string | null>(null),
    [joining, setJoining] = useState("");
  const alive = useRef(true);
  const setScope = (next: Scope) => {
    setScopeState(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      /* tercih yalnızca bu oturumda kalır */
    }
  };
  useEffect(() => {
    alive.current = true;
    invoke<{ servers: Server[] }>("servers_list")
      .then((l) => {
        if (!Array.isArray(l?.servers)) throw new Error(t("Sunucu listesi alınamadı."));
        if (alive.current) setServers(l.servers);
      })
      .catch((e) => alive.current && setError(String(e)))
      .finally(() => alive.current && setLoading(false));
    invoke<Record<string, Vote>>("servers_votes")
      .then((v) => {
        if (!alive.current || !v || typeof v !== "object") return;
        // Yalnızca beklenen biçimdeki kayıtlar alınır.
        const clean: Record<string, Vote> = {};
        for (const [id, e] of Object.entries(v))
          if (e && typeof e === "object" && typeof (e as Vote).votes === "number") clean[id] = e as Vote;
        setVotes(clean);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, []);
  const language = getLanguage();
  const home = useMemo(
    () => (languageCountries[language] ?? []).filter((c) => servers.some((sv) => sv.country === c)),
    [language, servers],
  );
  const inScope = (sv: Server, sc: Scope) =>
    sc === "all"
      ? true
      : sc === "fav"
        ? !!votes[sv.id]?.favorite
        : sc === "home"
          ? home.length
            ? home.includes(sv.country)
            : sv.featured
          : sv.country === sc;
  const needle = query.trim().toLocaleLowerCase(locale());
  // Arama yazılınca bölgeden bağımsız bütün dünyada aranır.
  const visible = servers.filter(
    (sv) =>
      (needle ? true : inScope(sv, scope)) &&
      (!tags.length || sv.tags.some((tg) => tags.includes(tg))) &&
      (!needle ||
        (sv.name + " " + sv.address + " " + sv.tags.join(" ") + " " + t(countryNames[sv.country] ?? ""))
          .toLocaleLowerCase(locale())
          .includes(needle)),
  );
  // Durumlar yalnızca görünen sunucular için altışar altışar sorgulanır; oyun açıkken durur.
  const visibleKey = visible.map((sv) => sv.id).sort().join(",");
  useEffect(() => {
    if (!visibleKey || s.running) return;
    let stop = false;
    const refresh = async () => {
      const queue = visibleKey.split(",");
      const worker = async () => {
        for (let id = queue.shift(); id && !stop; id = queue.shift()) {
          try {
            const ping = await invoke<Ping>("server_ping", { id });
            if (!stop && ping && typeof ping.online === "boolean")
              setPings((old) => ({ ...old, [id]: ping }));
          } catch {
            /* tek sunucunun hatası listeyi durdurmaz */
          }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.hasFocus()) void refresh();
    }, 90_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [visibleKey, s.running]);
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sv of servers) for (const tg of sv.tags) counts.set(tg, (counts.get(tg) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [servers]);
  {
    const players = (sv: Server) => (pings[sv.id]?.online ? pings[sv.id]!.players ?? 0 : -1);
    const latency = (sv: Server) => pings[sv.id]?.latency_ms ?? Number.MAX_SAFE_INTEGER;
    const rank = (sv: Server) => (sv.sponsored ? 2 : 0) + (sv.featured ? 1 : 0);
    visible.sort((a, b) =>
      sort === "featured"
        ? rank(b) - rank(a) || players(b) - players(a)
        : sort === "players"
          ? players(b) - players(a)
          : sort === "votes"
            ? (b.votes ?? 0) - (a.votes ?? 0) || players(b) - players(a)
            : sort === "rating"
              ? (votes[b.id]?.rating ?? 0) - (votes[a.id]?.rating ?? 0) || players(b) - players(a)
              : sort === "latency"
                ? latency(a) - latency(b)
                : a.name.localeCompare(b.name, locale()),
    );
  }
  const favorites = Object.values(votes).filter((v) => v.favorite).length;
  const record = async (command: string, args: Record<string, unknown>) => {
    try {
      const v = await invoke<Vote>(command, args);
      setVotes((old) => ({ ...old, [args.id as string]: v }));
      return v;
    } catch (e) {
      notice(String(e));
      return null;
    }
  };
  const community = {
    votes,
    vote: (sv: Server) =>
      void invoke("server_vote", { id: sv.id, lang: getLanguage() }).catch((e) => notice(String(e))),
    rate: (sv: Server, stars: number) => void record("server_rate", { id: sv.id, stars }),
    favorite: (sv: Server, on: boolean) => void record("server_favorite", { id: sv.id, favorite: on }),
  };
  const filters: Filters = { scope, setScope, home, tags, setTags, query, setQuery, sort, setSort };
  const totalOnline = Object.values(pings).reduce((sum, p) => sum + (p.players ?? 0), 0);
  const game =
    s.quick_profile ?? s.profiles.find((p) => p.id === s.selected_profile) ?? null;
  const canJoin =
    !s.busy && !s.running && !s.load_failed && !!game &&
    s.accounts.some((a) => a.id === s.selected_account);
  const join = async (sv: Server) => {
    setJoining(sv.id);
    const reply = await run("join_server", { id: sv.id });
    setJoining("");
    if (reply) {
      notice(t("{name} sunucusuna bağlanılıyor…", { name: sv.name }));
      setBrowser(null);
    }
  };
  const copy = async (sv: Server) => {
    const text = address(sv);
    try {
      await navigator.clipboard.writeText(text);
      notice(t("Adres kopyalandı: {address}", { address: text }));
    } catch {
      notice(text);
    }
  };
  const joinTitle = !game
    ? t("Önce bir sürüm veya profil seç.")
    : !s.accounts.some((a) => a.id === s.selected_account)
      ? t("Önce bir hesap ekle.")
      : t("Seçili oyunla ({version}) katıl", { version: game.version });
  const row = (sv: Server, i: number) => {
    const ping = pings[sv.id];
    return (
      <li
        key={sv.id}
        className={"server-row " + (sv.sponsored ? "sponsored" : "")}
        style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
      >
        <button className="server-main" onClick={() => setBrowser(sv.id)} title={t("Sunucu ayrıntıları")}>
          <ServerIcon server={sv} ping={ping} />
          <span className="server-text">
            <b>
              {sv.name}
              {votes[sv.id]?.favorite && (
                <span className="server-fav-mark" title={t("Favorilerde")}>
                  <Icon name="heart" />
                </span>
              )}
              {sv.sponsored && <em className="server-badge sponsor">{t("SPONSOR")}</em>}
            </b>
            <small>
              <CountryMark country={sv.country} />
              {sv.tags.slice(0, 2).join(" · ")}
            </small>
          </span>
          <span className="server-stats">
            <Players ping={ping} />
            {ping?.latency_ms != null && (
              <small className={"lbl latency " + latencyClass(ping.latency_ms)}>
                {ping.latency_ms} ms
              </small>
            )}
          </span>
        </button>
        <button
          className="btn server-join"
          disabled={!canJoin || joining === sv.id || ping?.online === false}
          title={joinTitle}
          aria-label={t("{name} sunucusuna katıl", { name: sv.name })}
          onClick={() => void join(sv)}
        >
          <Icon name="play" />
        </button>
      </li>
    );
  };
  return (
    <aside
      className={"server-panel " + (collapsed ? "collapsed" : "")}
      aria-label={t("Sunucular")}
    >
      <Mascot />
      <div className="server-head">
        <h3>
          <button
            className="server-head-toggle"
            aria-expanded={!collapsed}
            title={collapsed ? t("Sunucu panelini genişlet") : t("Sunucu panelini daralt")}
            onClick={() => update({ server_panel_collapsed: !collapsed })}
          >
            {t("Sunucular")}
            <span className="server-chevron" aria-hidden="true">
              ▾
            </span>
          </button>
        </h3>
        {totalOnline > 0 && (
          <span className="server-total">
            <i className="online-dot" /> {t("{count} çevrimiçi", { count: number(totalOnline) })}
          </span>
        )}
      </div>
      {!collapsed && (
        <>
          <FilterBar servers={servers} f={filters} allTags={allTags} inScope={inScope} favorites={favorites} />
          <ul className="server-list">
            {loading && <li className="lbl">{t("Sunucular yükleniyor…")}</li>}
            {error && (
              <li className="lbl setting-warning" role="alert">
                {error}
              </li>
            )}
            {!loading && !error && !visible.length && (
              <li className="lbl">{t("Bu filtrelerle sunucu bulunamadı.")}</li>
            )}
            {visible.map(row)}
          </ul>
          <button
            className="btn server-browse"
            disabled={!servers.length}
            onClick={() => setBrowser(visible[0]?.id ?? servers[0]?.id ?? null)}
          >
            <Icon name="maximize" /> {t("Tümünü gör")}
            <small>{servers.length}</small>
          </button>
        </>
      )}
      {browser !== null &&
        createPortal(
          <ServerBrowser
            servers={servers}
            visible={visible}
            pings={pings}
            selected={browser}
            select={setBrowser}
            close={() => setBrowser(null)}
            filters={filters}
            allTags={allTags}
            inScope={inScope}
            favorites={favorites}
            community={community}
            canJoin={canJoin}
            joining={joining}
            joinTitle={joinTitle}
            join={join}
            copy={copy}
            notice={notice}
          />,
          document.body,
        )}
    </aside>
  );
}

/** Arka planı bulanıklaştıran tam ekran sunucu tarayıcısı. */
function ServerBrowser({
  servers,
  visible,
  pings,
  selected,
  select,
  close,
  filters,
  allTags,
  inScope,
  favorites,
  community,
  canJoin,
  joining,
  joinTitle,
  join,
  copy,
  notice,
}: {
  servers: Server[];
  visible: Server[];
  pings: Record<string, Ping>;
  selected: string;
  select: (id: string) => void;
  close: () => void;
  filters: Filters;
  allTags: [string, number][];
  inScope: (sv: Server, scope: Scope) => boolean;
  favorites: number;
  community: {
    votes: Record<string, Vote>;
    vote: (sv: Server) => void;
    rate: (sv: Server, stars: number) => void;
    favorite: (sv: Server, on: boolean) => void;
  };
  canJoin: boolean;
  joining: string;
  joinTitle: string;
  join: (sv: Server) => Promise<void>;
  copy: (sv: Server) => Promise<void>;
  notice: (m: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".ui-select-portal")) close();
    };
    addEventListener("keydown", key);
    return () => {
      removeEventListener("keydown", key);
      previous?.focus?.();
    };
  }, []);
  const sv = servers.find((x) => x.id === selected) ?? visible[0] ?? null;
  const ping = sv ? pings[sv.id] : undefined;
  const mine = sv ? community.votes[sv.id] : undefined;
  const fill =
    ping?.online && ping.max_players
      ? Math.min(100, ((ping.players ?? 0) / ping.max_players) * 100)
      : 0;
  const link = (discord: boolean) =>
    void invoke("server_open_link", { id: sv!.id, discord }).catch((e) => notice(String(e)));
  return (
    <div
      className="server-browser-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="server-browser"
        role="dialog"
        aria-modal="true"
        aria-label={t("Sunucu tarayıcısı")}
      >
        <header className="server-browser-head">
          <div>
            <h2>{t("Sunucu tarayıcısı")}</h2>
            <p className="lbl">
              {t("{shown} / {total} sunucu gösteriliyor", {
                shown: visible.length,
                total: servers.length,
              })}
            </p>
          </div>
          <button
            ref={closeRef}
            className="btn server-browser-close"
            aria-label={t("Sunucu tarayıcısını kapat")}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="server-browser-body">
          <div className="server-browser-left">
            <FilterBar servers={servers} f={filters} allTags={allTags} inScope={inScope} favorites={favorites} wide />
            <ul className="server-browser-list" role="listbox" aria-label={t("Sunucular")}>
              {!visible.length && <li className="lbl">{t("Bu filtrelerle sunucu bulunamadı.")}</li>}
              {visible.map((x, i) => {
                const p = pings[x.id];
                return (
                  <li
                    key={x.id}
                    role="option"
                    aria-selected={x.id === sv?.id}
                    tabIndex={0}
                    className={
                      "browser-row " +
                      (x.id === sv?.id ? "selected " : "") +
                      (x.sponsored ? "sponsored" : "")
                    }
                    style={{ "--i": Math.min(i, 14) } as React.CSSProperties}
                    onClick={() => select(x.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select(x.id);
                      }
                    }}
                  >
                    <ServerIcon server={x} ping={p} />
                    <span className="server-text">
                      <b>
                        {x.name}
                        {community.votes[x.id]?.favorite && (
                          <span className="server-fav-mark">
                            <Icon name="heart" />
                          </span>
                        )}
                        {x.sponsored && <em className="server-badge sponsor">{t("SPONSOR")}</em>}
                      </b>
                      <small>
                        <CountryMark country={x.country} />
                        {x.tags.join(" · ")}
                      </small>
                    </span>
                    <span className="server-stats">
                      <Players ping={p} />
                      {p?.latency_ms != null && (
                        <small className={"lbl latency " + latencyClass(p.latency_ms)}>
                          {p.latency_ms} ms
                        </small>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          {sv && (
            <article className="server-browser-detail" key={sv.id}>
              {sv.banner && <ModImage className="server-banner" src={sv.banner} alt={sv.name} silent />}
              <div className="sbd-hero">
                <ServerIcon server={sv} ping={ping} />
                <div>
                  <h3>
                    {sv.name}
                    {sv.sponsored && <em className="server-badge sponsor">{t("SPONSOR")}</em>}
                  </h3>
                  <div className="sbd-address">
                    <code>{address(sv)}</code>
                    <button className="btn" onClick={() => void copy(sv)}>
                      {t("Kopyala")}
                    </button>
                  </div>
                </div>
              </div>
              <pre className="server-motd sbd-motd">
                {ping?.motd || (ping ? (ping.online ? "—" : t("Çevrimdışı")) : t("Kontrol ediliyor…"))}
              </pre>
              <div className="sbd-stats">
                <div className="sbd-stat">
                  <span className="lbl">{t("Oyuncular")}</span>
                  <Players ping={ping} />
                  <i className="sbd-meter">
                    <i style={{ width: `${fill}%` }} />
                  </i>
                </div>
                <div className="sbd-stat">
                  <span className="lbl">{t("Gecikme")}</span>
                  <b className={ping?.latency_ms != null ? "latency " + latencyClass(ping.latency_ms) : ""}>
                    {ping?.latency_ms != null ? `${ping.latency_ms} ms` : "—"}
                  </b>
                </div>
                <div className="sbd-stat">
                  <span className="lbl">{t("Ülke")}</span>
                  <b>
                    <CountryMark country={sv.country} /> {t(countryNames[sv.country] ?? sv.country)}
                  </b>
                </div>
                <div className="sbd-stat">
                  <span className="lbl">{t("Sürümler")}</span>
                  <b>{ping?.version ?? sv.versions ?? "—"}</b>
                </div>
              </div>
              <p className="sbd-description">{describe(sv) || t("Bu sunucu için açıklama yok.")}</p>
              <div className="server-tags">
                {sv.tags.map((tg) => (
                  <button
                    key={tg}
                    className={"tag-chip " + (filters.tags.includes(tg) ? "on" : "")}
                    aria-pressed={filters.tags.includes(tg)}
                    onClick={() =>
                      filters.setTags(
                        filters.tags.includes(tg)
                          ? filters.tags.filter((x) => x !== tg)
                          : [...filters.tags, tg],
                      )
                    }
                  >
                    {tg}
                  </button>
                ))}
                {sv.languages.map((l) => (
                  <span key={l} className="tag-chip lang">
                    {l.toUpperCase()}
                  </span>
                ))}
              </div>
              <div className="sbd-community">
                <button
                  className="btn sbd-vote"
                  title={t("Oy sayfası tarayıcıda açılır; oyunu kullanıcı adınla verirsin.")}
                  onClick={() => community.vote(sv)}
                >
                  <Icon name="vote" /> {t("Oy ver")} ↗
                  <small title={t("Bu ayki oylar")}>{(sv.votes ?? 0).toLocaleString(locale())}</small>
                </button>
                <Stars value={mine?.rating ?? null} onChange={(n) => community.rate(sv, n)} />
                <button
                  className={"btn sbd-fav " + (mine?.favorite ? "on" : "")}
                  aria-pressed={!!mine?.favorite}
                  onClick={() => community.favorite(sv, !mine?.favorite)}
                >
                  <Icon name="heart" /> {mine?.favorite ? t("Favorilerde") : t("Favorilere ekle")}
                </button>
              </div>
              <p className="lbl sbd-note">
                {sv.rank
                  ? t("Bu ay #{rank} sırada. Oylar patronlauncher.net üzerinde verilir; puan ve favorilerin bu bilgisayarda kalır.", { rank: sv.rank })
                  : t("Oylar patronlauncher.net üzerinde verilir; puan ve favorilerin bu bilgisayarda kalır.")}
              </p>
              <div className="sbd-actions">
                <button
                  className="btn primary sbd-join"
                  disabled={!canJoin || joining === sv.id || ping?.online === false}
                  title={joinTitle}
                  onClick={() => void join(sv)}
                >
                  <Icon name="play" /> {t("Sunucuya katıl")}
                </button>
                {sv.website && (
                  <button className="btn" onClick={() => link(false)}>
                    <Icon name="globe" /> {t("Web sitesi")} ↗
                  </button>
                )}
                {sv.discord && (
                  <button className="btn" onClick={() => link(true)}>
                    <Icon name="discord" /> Discord ↗
                  </button>
                )}
              </div>
              <p className="lbl">{joinTitle}</p>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
