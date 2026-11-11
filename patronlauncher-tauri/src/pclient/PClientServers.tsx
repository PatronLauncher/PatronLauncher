import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { getLanguage, locale, msg, t, type Language } from "../i18n";
import { CountryFlag } from "../components/Flag";
import { Select } from "../components/Controls";
import type { Ping, Server } from "../components/ServerPanel";
import { PcIcon } from "./icons";
import { announceLaunch } from "./launch";
import { ensurePerformanceChoice } from "./PerformancePrompt";

/** Bu cihazdaki oy, puan ve favori kaydı (Rust: servers::Vote). */
type Vote = { votes: number; last_vote: number; rating: number | null; favorite: boolean };
type Sort = "featured" | "players" | "latency" | "votes" | "rating" | "name";
/** "home" = dile göre bölge, "all", "fav" ya da ülke kodu. */
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
/** Konum yerine launcher dili kullanılır: IP sorgusu yapılmaz. */
export const languageCountries: Record<Language, string[]> = {
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
const sorts: [Sort, string][] = [
  ["featured", msg("Önerilen")],
  ["players", msg("En kalabalık")],
  ["latency", msg("En düşük gecikme")],
  ["votes", msg("En çok oyladıklarım")],
  ["rating", msg("En yüksek puanım")],
  ["name", msg("A–Z")],
];
const SCOPE_KEY = "pclient-server-scope";
const readScope = (): Scope => {
  try {
    return localStorage.getItem(SCOPE_KEY) || "home";
  } catch {
    return "home";
  }
};
const address = (sv: Server) => (sv.port ? `${sv.address}:${sv.port}` : sv.address);
const describe = (sv: Server) =>
  sv.description[getLanguage()] ?? sv.description.en ?? sv.description.tr ?? Object.values(sv.description)[0] ?? "";
export const num = (n: number) => n.toLocaleString(locale());
export const latencyClass = (ms: number) => (ms < 70 ? "good" : ms < 160 ? "ok" : "bad");
/** Kalan oy bekleme süresi (saniye); 0 ise oy verilebilir. */
const voteWait = (v?: Vote) =>
  v?.last_vote ? Math.max(0, v.last_vote + 86_400 - Math.floor(Date.now() / 1000)) : 0;

export function Icon({ sv, ping, big }: { sv: Server; ping?: Ping; big?: boolean }) {
  return ping?.favicon ? (
    <img className={"pc-sv-icon " + (big ? "big" : "")} src={ping.favicon} alt="" />
  ) : (
    <span className={"pc-sv-icon placeholder " + (big ? "big" : "")} aria-hidden="true">
      {sv.name.slice(0, 2).toLocaleUpperCase()}
    </span>
  );
}

/**
 * PClient sunucu tarayıcısı: PatronLauncher'ın doğrulanmış listesi; bölge, etiket, sıralama ve arama
 * filtreleri, oy/puan/favori ve PClient ile doğrudan bağlanma. Aynı liste oyun içindeki PClient sunucu
 * ekranında da "Önerilen" sekmesinde görünür.
 */
export default function PClientServers({ s, run, notice }: { s: Snapshot; run: Run; notice: (m: string) => void }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pings, setPings] = useState<Record<string, Ping>>({});
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [query, setQuery] = useState("");
  const [scope, setScopeState] = useState<Scope>(readScope);
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("featured");
  const [selected, setSelected] = useState<string | null>(null);
  const [joining, setJoining] = useState("");
  const [allTags, setAllTagsOpen] = useState(false);
  const alive = useRef(true);
  const home = languageCountries[getLanguage()] ?? [];
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
        const clean: Record<string, Vote> = {};
        for (const [id, e] of Object.entries(v))
          if (e && typeof e === "object" && typeof (e as Vote).votes === "number") clean[id] = e as Vote;
        setVotes(clean);
      })
      .catch(() => {
        /* oy kaydı yoksa boş başlar */
      });
    return () => {
      alive.current = false;
    };
  }, []);

  // Canlı durum: aynı anda en fazla dört sunucu sorgulanır.
  useEffect(() => {
    if (!servers.length) return;
    const queue = servers.map((sv) => sv.id);
    const worker = async () => {
      for (let id = queue.shift(); id && alive.current; id = queue.shift()) {
        try {
          const ping = await invoke<Ping>("server_ping", { id });
          if (alive.current) setPings((p) => ({ ...p, [id]: ping }));
        } catch {
          if (alive.current)
            setPings((p) => ({
              ...p,
              [id]: { online: false, players: null, max_players: null, version: null, motd: null, favicon: null, latency_ms: null },
            }));
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
  }, [servers]);

  const inScope = (sv: Server, sc: Scope) =>
    sc === "all" ? true : sc === "fav" ? !!votes[sv.id]?.favorite : sc === "home" ? home.includes(sv.country) : sv.country === sc;
  // Dile göre bölgede sunucu yoksa "home" tümünü gösterir.
  const effectiveScope = scope === "home" && !servers.some((sv) => home.includes(sv.country)) ? "all" : scope;

  const countries = useMemo(
    () =>
      Object.entries(
        servers.reduce<Record<string, number>>((acc, sv) => ((acc[sv.country] = (acc[sv.country] ?? 0) + 1), acc), {}),
      ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [servers],
  );
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sv of servers) if (inScope(sv, effectiveScope)) for (const tg of sv.tags) counts.set(tg, (counts.get(tg) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, effectiveScope, votes]);

  const q = query.trim().toLocaleLowerCase(locale());
  const players = (sv: Server) => (pings[sv.id]?.online ? (pings[sv.id]!.players ?? 0) : -1);
  const latency = (sv: Server) => pings[sv.id]?.latency_ms ?? Number.MAX_SAFE_INTEGER;
  const rank = (sv: Server) => (sv.sponsored ? 2 : 0) + (sv.featured ? 1 : 0);
  const visible = servers
    .filter(
      (sv) =>
        inScope(sv, effectiveScope) &&
        tags.every((tg) => sv.tags.includes(tg)) &&
        (!q ||
          `${sv.name} ${sv.address} ${sv.tags.join(" ")} ${describe(sv)} ${sv.versions}`
            .toLocaleLowerCase(locale())
            .includes(q)),
    )
    .sort((a, b) =>
      sort === "featured"
        ? rank(b) - rank(a) || players(b) - players(a)
        : sort === "players"
          ? players(b) - players(a)
          : sort === "latency"
            ? latency(a) - latency(b)
            : sort === "votes"
              ? (votes[b.id]?.votes ?? 0) - (votes[a.id]?.votes ?? 0) || players(b) - players(a)
              : sort === "rating"
                ? (votes[b.id]?.rating ?? 0) - (votes[a.id]?.rating ?? 0) || players(b) - players(a)
                : a.name.localeCompare(b.name, locale()),
    );
  const sv = visible.find((x) => x.id === selected) ?? visible[0] ?? null;
  const online = Object.values(pings).reduce((n, p) => n + (p.online ? (p.players ?? 0) : 0), 0);
  const favorites = Object.values(votes).filter((v) => v.favorite).length;
  const hasAccount = s.accounts.some((a) => a.id === s.selected_account);
  const canJoin = !s.busy && !s.running && !s.load_failed && hasAccount;

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
  const join = async (x: Server) => {
    if (!(await ensurePerformanceChoice())) return;
    setJoining(x.id);
    announceLaunch("play");
    const reply = await run("join_server", { id: x.id, pclient: true });
    setJoining("");
    if (reply) notice(t("{name} sunucusuna bağlanılıyor…", { name: x.name }));
  };
  const copy = async (x: Server) => {
    try {
      await navigator.clipboard.writeText(address(x));
      notice(t("Adres kopyalandı: {address}", { address: address(x) }));
    } catch {
      notice(address(x));
    }
  };
  const link = (x: Server, discord: boolean) =>
    void invoke("server_open_link", { id: x.id, discord }).catch((e) => notice(String(e)));
  const toggleTag = (tg: string) => setTags(tags.includes(tg) ? tags.filter((x) => x !== tg) : [...tags, tg]);
  const shownTags = allTags ? tagCounts : tagCounts.filter(([tg], i) => i < 12 || tags.includes(tg));
  const scopeChip = (key: Scope, label: string, count: number, mark?: React.ReactNode) => (
    <button
      key={key}
      className={"pc-sv-region " + (effectiveScope === key || (key === "home" && scope === "home") ? "on" : "")}
      aria-pressed={effectiveScope === key}
      onClick={() => setScope(key)}
    >
      {mark}
      <span>{label}</span>
      <small>{count}</small>
    </button>
  );

  const ping = sv ? pings[sv.id] : undefined;
  const mine = sv ? votes[sv.id] : undefined;
  const wait = voteWait(mine);
  const fill = ping?.online && ping.max_players ? Math.min(100, ((ping.players ?? 0) / ping.max_players) * 100) : 0;

  return (
    <div className="pc-sv">
      <aside className="pc-sv-filters" aria-label={t("Filtreler")}>
        <label className="pc-search">
          <PcIcon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Sunucu ara…")}
            aria-label={t("Sunucu ara…")}
          />
        </label>
        <section>
          <h4>{t("Bölge")}</h4>
          <div className="pc-sv-regions">
            {home.length > 0 &&
              scopeChip(
                "home",
                t("Bölgem"),
                servers.filter((x) => inScope(x, "home")).length,
                <CountryFlag code={home[0]} />,
              )}
            {scopeChip("all", t("Tüm bölgeler"), servers.length, <PcIcon name="globe" />)}
            {favorites > 0 && scopeChip("fav", t("Favoriler"), favorites, <PcIcon name="heart" />)}
            {countries.map(([code, n]) =>
              scopeChip(code, t(countryNames[code] ?? code.toUpperCase()), n, <CountryFlag code={code} />),
            )}
          </div>
        </section>
        <section>
          <h4>
            {t("Etiketler")}
            {tags.length > 0 && (
              <button className="pc-link" onClick={() => setTags([])}>
                {t("Temizle")}
              </button>
            )}
          </h4>
          <div className="pc-chips">
            {shownTags.map(([tg, n]) => (
              <button key={tg} className={"pc-chip " + (tags.includes(tg) ? "on" : "")} onClick={() => toggleTag(tg)}>
                {tg} <small>{n}</small>
              </button>
            ))}
            {tagCounts.length > 12 && (
              <button className="pc-chip more" onClick={() => setAllTagsOpen(!allTags)}>
                {allTags ? t("Daha az") : t("+{count} etiket", { count: tagCounts.length - 12 })}
              </button>
            )}
          </div>
        </section>
        <section>
          <h4>{t("Sırala")}</h4>
          <Select className="pc-sv-sort" value={sort} aria-label={t("Sırala")} onChange={(e) => setSort(e.target.value as Sort)}>
            {sorts.map(([k, label]) => (
              <option key={k} value={k}>
                {t(label)}
              </option>
            ))}
          </Select>
        </section>
        {online > 0 && (
          <p className="pc-servers-online">
            <i className="online-dot" /> {t("{count} çevrimiçi", { count: num(online) })}
          </p>
        )}
      </aside>

      <section className="pc-sv-list" aria-label={t("Sunucular")}>
        <header>
          <b>{t("{shown} / {total} sunucu gösteriliyor", { shown: visible.length, total: servers.length })}</b>
        </header>
        {!hasAccount && <p className="pc-servers-note">{t("Sunuculara bağlanmak için önce bir hesap ekle.")}</p>}
        {loading && <p className="pc-news-empty">{t("Sunucular yükleniyor…")}</p>}
        {error && (
          <p className="pc-news-empty" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && !visible.length && <p className="pc-news-empty">{t("Bu filtrelerle sunucu bulunamadı.")}</p>}
        <ul role="listbox" aria-label={t("Sunucular")}>
          {visible.map((x, i) => {
            const p = pings[x.id];
            return (
              <li
                key={x.id}
                role="option"
                aria-selected={x.id === sv?.id}
                tabIndex={0}
                className={"pc-sv-row " + (x.id === sv?.id ? "sel " : "") + (x.featured || x.sponsored ? "featured" : "")}
                style={{ "--i": Math.min(i, 14) } as CSSProperties}
                onClick={() => setSelected(x.id)}
                onDoubleClick={() => canJoin && !joining && void join(x)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") canJoin && !joining && void join(x);
                  if (e.key === " ") {
                    e.preventDefault();
                    setSelected(x.id);
                  }
                }}
              >
                <Icon sv={x} ping={p} />
                <div className="pc-sv-row-main">
                  <b>
                    {x.name}
                    <CountryFlag code={x.country} />
                    {votes[x.id]?.favorite && <PcIcon name="heart" className="pc-i fav" />}
                  </b>
                  <small>{x.tags.slice(0, 3).join(" · ") || address(x)}</small>
                </div>
                {(x.sponsored || x.featured) && (
                  <span className="pc-tag red">{x.sponsored ? t("Sponsor") : t("Öne çıkan")}</span>
                )}
                <span className={"pc-sv-players " + (p ? (p.online ? "on" : "off") : "")}>
                  {!p ? "…" : p.online ? (
                    <>
                      <i className="online-dot" />
                      {num(p.players ?? 0)}
                    </>
                  ) : (
                    t("Çevrimdışı")
                  )}
                </span>
                {p?.online && p.latency_ms != null && (
                  <span className={"pc-sv-ms " + latencyClass(p.latency_ms)}>{p.latency_ms} ms</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <article className="pc-sv-detail" aria-live="polite">
        {!sv ? (
          <p className="pc-news-empty">{t("Bir sunucu seç.")}</p>
        ) : (
          <div key={sv.id} className="pc-sv-detail-in">
            <header>
              <Icon sv={sv} ping={ping} big />
              <div>
                <h3>
                  {sv.name}
                  {(sv.sponsored || sv.featured) && (
                    <span className="pc-tag red">{sv.sponsored ? t("Sponsor") : t("Öne çıkan")}</span>
                  )}
                </h3>
                <button className="pc-sv-address" onClick={() => void copy(sv)} title={t("Adresi kopyala")}>
                  {address(sv)} <PcIcon name="copy" />
                </button>
              </div>
            </header>
            <div className="pc-sv-stats">
              <div className="wide">
                <span>{t("Oyuncular")}</span>
                <b>
                  {!ping ? t("Kontrol ediliyor…") : ping.online ? (
                    <>
                      {num(ping.players ?? 0)}
                      {ping.max_players ? <small> / {num(ping.max_players)}</small> : null}
                    </>
                  ) : (
                    <em className="off">{t("Çevrimdışı")}</em>
                  )}
                </b>
                <i className="pc-sv-fill">
                  <i style={{ width: `${fill}%` }} />
                </i>
              </div>
              <div>
                <span>{t("Gecikme")}</span>
                <b className={ping?.latency_ms != null ? latencyClass(ping.latency_ms) : ""}>
                  {ping?.latency_ms != null ? `${ping.latency_ms} ms` : "—"}
                </b>
              </div>
              <div>
                <span>{t("Bölge")}</span>
                <b className="flag">
                  <CountryFlag code={sv.country} /> {t(countryNames[sv.country] ?? sv.country.toUpperCase())}
                </b>
              </div>
              <div>
                <span>{t("Sürümler")}</span>
                <b>{sv.versions || ping?.version || "—"}</b>
              </div>
              <div>
                <span>{t("Diller")}</span>
                <b>{sv.languages.map((l) => l.toUpperCase()).join(", ") || "—"}</b>
              </div>
            </div>
            <p className="pc-sv-desc">{describe(sv)}</p>
            <div className="pc-server-tags">
              {sv.tags.map((tg) => (
                <span key={tg}>{tg}</span>
              ))}
            </div>
            <div className="pc-sv-community">
              <button
                className="pc-ghost-btn"
                disabled={wait > 0}
                title={
                  wait > 0
                    ? t("Yeniden oy verebilmen için {h} sa {m} dk kaldı", {
                        h: Math.floor(wait / 3600),
                        m: Math.ceil((wait % 3600) / 60),
                      })
                    : t("Bu sunucuya oy ver (günde bir kez)")
                }
                onClick={async () => {
                  if (await record("server_vote", { id: sv.id }))
                    notice(t("{name} için oyun kaydedildi. Teşekkürler!", { name: sv.name }));
                }}
              >
                <PcIcon name="vote" /> {wait > 0 ? t("Oy verildi") : t("Oy ver")} <small>{mine?.votes ?? 0}</small>
              </button>
              <span className="pc-sv-stars" role="radiogroup" aria-label={t("Puanın")}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={mine?.rating === n}
                    aria-label={t("{count} yıldız", { count: n })}
                    className={n <= (mine?.rating ?? 0) ? "on" : ""}
                    onClick={() => void record("server_rate", { id: sv.id, stars: mine?.rating === n ? 0 : n })}
                  >
                    <PcIcon name="star" />
                  </button>
                ))}
              </span>
              <button
                className={"pc-icon-btn pc-sv-fav " + (mine?.favorite ? "on" : "")}
                aria-pressed={!!mine?.favorite}
                title={mine?.favorite ? t("Favorilerde") : t("Favorilere ekle")}
                aria-label={mine?.favorite ? t("Favorilerde") : t("Favorilere ekle")}
                onClick={() => void record("server_favorite", { id: sv.id, favorite: !mine?.favorite })}
              >
                <PcIcon name="heart" />
              </button>
            </div>
            <footer>
              {sv.website && (
                <button className="pc-ghost-btn" onClick={() => link(sv, false)}>
                  <PcIcon name="external" /> {t("Web sitesi")}
                </button>
              )}
              {sv.discord && (
                <button className="pc-ghost-btn" onClick={() => link(sv, true)}>
                  <PcIcon name="chat" /> Discord
                </button>
              )}
              <button className="pc-server-join" disabled={!canJoin || !!joining} onClick={() => void join(sv)}>
                {joining === sv.id ? t("Hazırlanıyor…") : t("PClient ile bağlan")}
              </button>
            </footer>
          </div>
        )}
      </article>
    </div>
  );
}
