import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot } from "../types/core";
import type { Run } from "../backend";
import { t } from "../i18n";
import { PcIcon } from "./icons";
import { announceLaunch } from "./launch";
import { versionArt } from "../versionArt";
import VersionFx from "../components/VersionFx";
import { ensurePerformanceChoice, type PClientRelease as Release } from "./PerformancePrompt";

/**
 * PClient sürümleri: PClient'ın hangi Minecraft sürümleriyle oynanabileceği. Her sürüm ayrı bir
 * PClient yapısı gerektirir; hazır olanlar seçilip oyunu açmadan kurulabilir.
 */
export default function PClientVersions({ s, run }: { s: Snapshot; run: Run }) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState("");
  const load = () =>
    invoke<Release[]>("pclient_versions")
      .then(setReleases)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);
  // Kurulum bitince "Kurulu" durumu yenilenir.
  useEffect(() => {
    if (!s.busy) void load();
  }, [s.busy]);

  const select = (minecraft: string) =>
    invoke<Release[]>("pclient_select_version", { version: minecraft })
      .then((list) => {
        setReleases(list);
        setError("");
      })
      .catch((e) => setError(String(e)));
  const [working, setWorking] = useState("");
  const setPerformance = async (r: Release, install: boolean) => {
    setWorking(r.minecraft);
    setError("");
    try {
      setReleases(await invoke<Release[]>("pclient_performance", { version: r.minecraft, install }));
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking("");
    }
  };
  const install = async (r: Release) => {
    if (!r.selected) await select(r.minecraft);
    if (!(await ensurePerformanceChoice())) return;
    announceLaunch("install");
    await run("pclient_install", {});
  };
  const free = !s.busy && !s.running && !s.load_failed;
  const ready = releases.filter((r) => r.ready);
  const planned = releases.filter((r) => !r.ready);

  return (
    <div className="pc-editions">
      <section className="pc-editions-intro">
        <h3>{t("PClient hangi sürümlerde çalışır?")}</h3>
        <p>
          {t(
            "PClient, Fabric üzerinde çalışan kendi istemcimizdir. Her Minecraft sürümü için ayrı derlenir; hazır olan sürümü seçip kurabilir, Oyna sayfasından başlatabilirsin. Yeni sürümler hazırlandıkça burada açılır.",
          )}
        </p>
      </section>
      {error && (
        <p className="pc-servers-note" role="alert">
          {error}
        </p>
      )}
      <div className="pc-edition-grid">
        {ready.map((r, i) => (
          <article key={r.minecraft} className={"pc-edition " + (r.selected ? "on" : "")} style={{ "--i": i } as CSSProperties}>
            <div className="pc-edition-cover">
              <img className="pc-edition-art" src={versionArt(r.minecraft)} alt="" loading="lazy" />
              <VersionFx version={r.minecraft} />
            </div>
            <header>
              <span className="pc-edition-mark">
                <PcIcon name="layers" />
              </span>
              <div>
                <b>Minecraft {r.minecraft}</b>
                <small>{t("Fabric · PClient")}</small>
              </div>
              {r.selected && <span className="pc-tag red">{t("Seçili")}</span>}
            </header>
            <ul>
              <li>
                <PcIcon name="check" /> {t("Tüm hazır modüller")}
              </li>
              <li>
                <PcIcon name="check" /> {t("PClient menüleri ve sunucu listesi")}
              </li>
              <li className={r.installed ? "" : "muted"}>
                <PcIcon name={r.installed ? "check" : "download"} /> {r.installed ? t("Kurulu") : t("Henüz indirilmedi")}
              </li>
              <li className={r.performance === "installed" ? "" : "muted"}>
                <PcIcon name={r.performance === "installed" ? "check" : "bolt"} />{" "}
                {r.performance === "installed" ? t("Performans modları kurulu") : t("Performans modları kurulu değil")}
              </li>
            </ul>
            <footer>
              <button
                className="pc-ghost-btn"
                disabled={!free || working === r.minecraft}
                onClick={() => void setPerformance(r, r.performance !== "installed")}
              >
                {working === r.minecraft
                  ? t("Kuruluyor…")
                  : r.performance === "installed"
                    ? t("Performans modlarını kaldır")
                    : t("Performans modlarını kur")}
              </button>
              {!r.selected && (
                <button className="pc-ghost-btn" disabled={!free} onClick={() => void select(r.minecraft)}>
                  {t("Bu sürümü seç")}
                </button>
              )}
              <button className="pc-server-join" disabled={!free} onClick={() => void install(r)}>
                {r.installed ? t("Onar / güncelle") : t("Kur")}
              </button>
            </footer>
          </article>
        ))}
        {planned.map((r, i) => (
          <article key={r.minecraft} className="pc-edition soon" style={{ "--i": ready.length + i } as CSSProperties}>
            <div className="pc-edition-cover">
              <img className="pc-edition-art" src={versionArt(r.minecraft)} alt="" loading="lazy" />
              <VersionFx version={r.minecraft} />
            </div>
            <header>
              <span className="pc-edition-mark">
                <PcIcon name="layers" />
              </span>
              <div>
                <b>Minecraft {r.minecraft}</b>
                <small>{t("Fabric · PClient")}</small>
              </div>
              <span className="pc-tag">{t("Yakında")}</span>
            </header>
            <p>{t("Bu sürüm için PClient hazırlanıyor.")}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
