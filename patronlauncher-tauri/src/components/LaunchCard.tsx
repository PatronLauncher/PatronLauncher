import { statusText } from "../statusText";
import { msg, t } from "../i18n";
import { Select } from "./Controls";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot, InstalledVersion, Loader } from "../types/core";
import type { Page } from "../navigation";
import { playLabel, type Run } from "../backend";
import { loaderLabel } from "../profile";
import Icon from "./Icon";
import { useAppearance } from "../appearance";
export default function LaunchCard({
  s,
  run,
  go,
  progress,
  mode,
  setMode,
}: {
  s: Snapshot;
  run: Run;
  go: (p: Page) => void;
  progress: number | null;
  mode: "quick" | "profile";
  setMode: (m: "quick" | "profile") => void;
}) {
  const { switchUi } = useAppearance();
  const [installed, setInstalled] = useState<InstalledVersion[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const pending = useRef<{
    mc: string;
    loader: Loader;
    loader_version: string | null;
  } | null>(null);
  const previous = useRef({ quick: "", profile: "" });
  const choosing = useRef(false);
  const p =
    mode === "quick"
      ? s.quick_profile
      : s.profiles.find((p) => p.id === s.selected_profile);
  if (s.quick_profile) previous.current.quick = s.quick_profile.id;
  const custom = s.profiles.find((p) => p.id === s.selected_profile);
  if (custom) previous.current.profile = custom.id;
  const enabled = !s.busy && !s.running && !s.load_failed;
  useEffect(() => {
    if (s.busy) return;
    let active = true;
    setLoading(true);
    invoke<InstalledVersion[]>("list_installed_versions")
      .then(async (list) => {
        if (!active) return;
        setInstalled(list);
        setError("");
        if (pending.current) {
          const c = pending.current;
          const found = list.find(
            (v) =>
              v.mc === c.mc &&
              v.loader === c.loader &&
              v.loader_version === c.loader_version,
          );
          if (found?.quick_id)
            await run("select_quick", { id: found.quick_id });
          pending.current = null;
        }
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
  }, [s.busy, run]);
  const select = async (v: InstalledVersion) => {
    if (v.quick_id) await run("select_quick", { id: v.quick_id });
    else {
      pending.current = v;
      if (
        !(await run("install_version", {
          mc: v.mc,
          loader: v.loader,
          loaderVersion: v.loader_version,
        }))
      ) {
        pending.current = null;
      }
    }
  };
  const switchMode = async (next: "quick" | "profile") => {
    setMode(next);
    if (next === "profile") {
      const target =
        s.profiles.find((p) => p.id === previous.current.profile) ??
        s.profiles[0];
      if (target) await run("select_profile", { id: target.id });
    } else {
      const target =
        installed.find((v) => v.quick_id === previous.current.quick) ??
        installed[0];
      // The effect below also handles an installed list that is still loading.
    }
  };
  useEffect(() => {
    if (
      mode !== "quick" ||
      p ||
      !enabled ||
      loading ||
      pending.current ||
      choosing.current
    )
      return;
    const target =
      installed.find((v) => v.quick_id === previous.current.quick) ??
      installed[0];
    if (!target) return;
    choosing.current = true;
    void select(target).finally(() => {
      choosing.current = false;
    });
  }, [mode, p?.id, enabled, loading, installed]);
  const launchState = {
    ...s,
    profiles: mode === "profile" ? s.profiles : [],
    quick_profile: mode === "quick" ? s.quick_profile : null,
  };
  let label = playLabel(launchState);
  if (!s.busy && !s.running && s.selected_account && !p)
    label = mode === "quick" ? msg("SÜRÜM SEÇ") : msg("PROFİL SEÇ");
  const play = () => {
    if (label === "HESAP EKLE") go("account");
    else if (!p) go(mode === "quick" ? "versions" : "profiles");
    else void run("launch_game", {});
  };
  const latest = s.versions.find((v) => v.type === "release") ?? s.versions[0];
  return (
    <section className="home-launch">
      <div className="home-modes" role="group" aria-label={t("Oyun modu")}>
        <button
          className={`btn ${mode === "quick" ? "v-loader-selected" : ""}`}
          aria-pressed={mode === "quick"}
          disabled={!enabled}
          onClick={() => void switchMode("quick")}
        >{t("Hızlı oyun")}</button>
        <button
          className={`btn ${mode === "profile" ? "v-loader-selected" : ""}`}
          aria-pressed={mode === "profile"}
          disabled={!enabled}
          onClick={() => void switchMode("profile")}
        >{t("Profil")}</button>
        <button
          className="btn home-pclient"
          title={t("PClient'a geç")}
          onClick={(e) => switchUi("pclient", { x: e.clientX, y: e.clientY })}
        >
          PClient
        </button>
      </div>
      <div className="home-launch-grid">
        <div className="home-game-choice">
          {mode === "quick" ? (
            <>
              <label className="lbl" htmlFor="installed-game">{t("KURULU SÜRÜM VE YÜKLEYİCİ")}</label>
              <div className="actions">
                <Select
                  id="installed-game"
                  aria-label={t("Kurulu sürüm ve yükleyici")}
                  disabled={!enabled || loading}
                  value={installed.findIndex(
                    (v) =>
                      v.mc === p?.version &&
                      v.loader === (p?.loader ?? "Vanilla") &&
                      (v.loader_version ?? null) ===
                        (p?.loader_version ?? null),
                  )}
                  onChange={(e) => {
                    const v = installed[Number(e.target.value)];
                    if (v) void select(v);
                  }}
                >
                  <option value={-1} disabled>
                    {loading
                      ? t("Kurulumlar kontrol ediliyor…")
                      : t("Kurulu sürüm seç")}
                  </option>
                  {installed.map((v, i) => (
                    <option
                      value={i}
                      key={`${v.mc}-${v.loader}-${v.loader_version}`}
                    >
                      Minecraft {v.mc} · {v.loader}
                      {v.loader_version ? ` ${v.loader_version}` : ""}
                    </option>
                  ))}
                </Select>
                <button
                  className="btn"
                  disabled={!enabled}
                  onClick={() => go("versions")}
                >{t("+ Yeni sürüm kur")}</button>
              </div>
              {!loading && !installed.length && !error && (
                <div className="home-ready">
                  <p className="lbl">{t("İlk oyununa hazır mısın? En son kararlı sürümü kur.")}</p>
                  <button
                    className="btn"
                    disabled={!enabled || !latest}
                    onClick={async () => {
                      if (!latest) return;
                      pending.current = {
                        mc: latest.id,
                        loader: "Vanilla",
                        loader_version: null,
                      };
                      if (
                        !(await run("install_version", {
                          mc: latest.id,
                          loader: "Vanilla",
                          loaderVersion: null,
                        }))
                      )
                        pending.current = null;
                    }}
                  >
                    {t("Minecraft {version} kur", { version: latest?.id ?? "" })}</button>
                </div>
              )}
            </>
          ) : (
            <>
              <span className="lbl">{t("SEÇİLİ PROFİL")}</span>
              <div className="pcard home-profile">
                <Icon name="profiles" />
                <div>
                  <b>{p?.name ?? t("Henüz profil seçilmedi")}</b>
                  <small className="lbl">
                    {p
                      ? `Minecraft ${p.version} · ${loaderLabel(p)}`
                      : t("Profiller sayfasından bir profil seç.")}
                  </small>
                  {p && <small className="lbl home-profile-facts">{s.settings.memory_mb} MB RAM · {s.java_status?.kind === "ready" ? `Java ${s.java_status.major}` : s.settings.java_path ? t("Özel Java") : t("Otomatik Java")}</small>}
                </div>
                <button
                  className="btn"
                  disabled={!enabled}
                  onClick={() => go("profiles")}
                >{t("Profili değiştir")}</button>
              </div>
            </>
          )}
          {error && (
            <p className="lbl" role="alert">{t("Kurulumlar okunamadı:")} {error}
            </p>
          )}
          <label className="lbl" htmlFor="home-account">{t("OYUN HESABI")}</label>
          {s.accounts.length ? (
            <Select
              id="home-account"
              aria-label={t("Oyun hesabı")}
              disabled={!enabled}
              value={s.selected_account ?? ""}
              onChange={(e) =>
                void run("select_account", { id: e.target.value })
              }
            >
              <option value="" disabled>{t("Hesap seç")}</option>
              {s.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ·{" "}
                  {a.kind === "Microsoft" ? "Microsoft" : t("Yerel hesap")}
                </option>
              ))}
            </Select>
          ) : (
            <button className="btn" onClick={() => go("account")}>{t("Hesap ekle")}</button>
          )}
        </div>
        <div className="home-play">
          <div className="home-play-buttons">
            <button
              className={`play ${s.running ? "run" : s.busy ? "busy" : ""}`}
              id="play"
              disabled={!enabled}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty("--play-x", `${((e.clientX - r.left) / r.width) * 100}%`);
                e.currentTarget.style.setProperty("--play-y", `${((e.clientY - r.top) / r.height) * 100}%`);
              }}
              onClick={play}
            >
              <span className="play-retro" aria-hidden="true">
                <i className="play-pixels" />
                <i className="play-scan" />
                <i className="play-sparks" />
              </span>
              <span className="play-round" aria-hidden="true">▶</span>
              <span id="pl">
                
                {t(label)}
              </span>
              <span
                className="bar"
                id="pb"
                style={{
                  width: s.busy && progress !== null ? `${progress}%` : 0,
                }}
              />
            </button>
            <button
              className="btn"
              aria-label={t("Sürümleri aç")}
              title={t("Sürümler")}
              onClick={() => go("versions")}
            >
              ▾
            </button>
          </div>
          {s.busy && <p className="lbl launch-status" role="status">{statusText(s.status)}</p>}
          <p className="lbl home-play-detail">
            {p
              ? `Minecraft ${p.version} · ${loaderLabel(p)}`
              : t("Oynamak için bir oyun seç.")}
          </p>
        </div>
      </div>
    </section>
  );
}
