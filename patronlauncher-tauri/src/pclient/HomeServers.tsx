import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot } from "../types/core";
import type { Page } from "../navigation";
import type { Run } from "../backend";
import { getLanguage, t } from "../i18n";
import { CountryFlag } from "../components/Flag";
import type { Ping, Server } from "../components/ServerPanel";
import { Icon as ServerIcon, languageCountries, latencyClass, num } from "./PClientServers";
import { announceLaunch } from "./launch";
import { ensurePerformanceChoice } from "./PerformancePrompt";

/** Ana ekranda gösterilen sunucu sayısı; yalnızca bunlar yoklanır. */
const SHOWN = 8;
const PING_WORKERS = 3;
const rank = (sv: Server) => (sv.sponsored ? 2 : 0) + (sv.featured ? 1 : 0);

/** Oyna sekmesindeki kısa sunucu listesi: bölgedeki öne çıkan sunucular ve tek tıkla bağlanma. */
export default function HomeServers({
  s,
  run,
  go,
  notice,
}: {
  s: Snapshot;
  run: Run;
  go: (p: Page) => void;
  notice: (m: string) => void;
}) {
  const [servers, setServers] = useState<Server[]>([]);
  const [pings, setPings] = useState<Record<string, Ping>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [joining, setJoining] = useState("");

  useEffect(() => {
    let alive = true;
    const offline: Ping = { online: false, players: null, max_players: null, version: null, motd: null, favicon: null, latency_ms: null };
    const pingAll = async (list: Server[]) => {
      const queue = list.map((sv) => sv.id);
      const worker = async () => {
        for (let id = queue.shift(); id && alive; id = queue.shift()) {
          const ping = await invoke<Ping>("server_ping", { id }).catch(() => offline);
          if (alive) setPings((p) => ({ ...p, [id]: ping }));
        }
      };
      await Promise.all(Array.from({ length: PING_WORKERS }, worker));
    };
    invoke<{ servers: Server[] }>("servers_list")
      .then((l) => {
        if (!alive) return;
        if (!Array.isArray(l?.servers)) throw new Error("servers_list");
        const home = languageCountries[getLanguage()] ?? [];
        const regional = l.servers.filter((sv) => home.includes(sv.country));
        const chosen = (regional.length ? regional : l.servers).sort((a, b) => rank(b) - rank(a)).slice(0, SHOWN);
        setServers(chosen);
        void pingAll(chosen);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const canJoin = !s.busy && !s.running && !s.load_failed && s.accounts.some((a) => a.id === s.selected_account);
  const join = async (sv: Server) => {
    if (!(await ensurePerformanceChoice())) return;
    setJoining(sv.id);
    announceLaunch("play");
    const reply = await run("join_server", { id: sv.id, pclient: true });
    setJoining("");
    if (reply) notice(t("{name} sunucusuna bağlanılıyor…", { name: sv.name }));
  };

  return (
    <section className="pc-recent">
      <header className="pc-section-head">
        <h3>{t("Sunucular")}</h3>
        <button className="pc-link" onClick={() => go("servers")}>
          {t("Tümünü gör")} →
        </button>
      </header>
      {loading && <p className="pc-news-empty">{t("Sunucular yükleniyor…")}</p>}
      {failed && <p className="pc-news-empty">{t("Sunucu listesi alınamadı.")}</p>}
      <div className="pc-recent-list pc-home-servers">
        {servers.map((sv, i) => {
          const p = pings[sv.id];
          return (
            <article key={sv.id} className="pc-profile pc-home-server" style={{ "--i": i } as CSSProperties}>
              <button className="pc-home-server-open" onClick={() => go("servers")}>
                <ServerIcon sv={sv} ping={p} />
                <div>
                  <b>
                    {sv.name} <CountryFlag code={sv.country} />
                  </b>
                  <small className={p ? (p.online ? "" : "off") : ""}>
                    {!p ? t("Kontrol ediliyor…") : p.online ? t("{count} çevrimiçi", { count: num(p.players ?? 0) }) : t("Çevrimdışı")}
                    {p?.online && p.latency_ms != null && (
                      <em className={"pc-sv-ms " + latencyClass(p.latency_ms)}> · {p.latency_ms} ms</em>
                    )}
                  </small>
                </div>
              </button>
              <button className="pc-home-server-join" disabled={!canJoin || !!joining} onClick={() => void join(sv)}>
                {joining === sv.id ? t("Hazırlanıyor…") : t("Bağlan")}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
