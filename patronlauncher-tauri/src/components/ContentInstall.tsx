import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot } from "../types/core";
import type { ModHit } from "../mods";
import { t } from "../i18n";
import { profileArtwork } from "../profileArtwork";
import { Select } from "./Controls";
import Modal from "./Modal";

export type ContentKind = "resourcepack" | "shader" | "datapack";
type Version = {
  id: string;
  version_number: string;
  version_type: string;
  loaders: string[];
};

/** Kaynak paketi, shader ve veri paketlerini seçilen profile tek adımda kurar. */
export default function ContentInstall({
  s,
  kind,
  hit,
  close,
  notice,
  source = "modrinth",
}: {
  s: Snapshot;
  kind: ContentKind;
  source?: "modrinth" | "curseforge";
  hit: Pick<ModHit, "project_id" | "title">;
  close: () => void;
  notice: (m: string) => void;
}) {
  const profiles = [
    ...(s.quick_profile ? [s.quick_profile] : []),
    ...s.profiles.filter((p) => p.kind !== "Quick"),
  ];
  const [target, setTarget] = useState(
    profiles.find((p) => p.id === s.selected_profile)?.id ?? profiles[0]?.id ?? "",
  );
  const profile = profiles.find((p) => p.id === target);
  const [versions, setVersions] = useState<Version[] | null>(null),
    [version, setVersion] = useState(""),
    [worlds, setWorlds] = useState<string[]>([]),
    [world, setWorld] = useState(""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  useEffect(() => {
    if (!target) return;
    let active = true;
    setVersions(null);
    setError("");
    (source === "curseforge"
      ? invoke<
          { id: number; display_name: string; release_type: number }[]
        >("curseforge_files", { profile: target, project: Number(hit.project_id), kind }).then((files) =>
          files.map((f) => ({
            id: String(f.id),
            version_number: f.display_name,
            version_type: f.release_type === 1 ? "release" : f.release_type === 2 ? "beta" : "alpha",
            loaders: [],
          })),
        )
      : invoke<Version[]>("content_versions", { profile: target, kind, project: hit.project_id }))
      .then((list) => {
        if (!active) return;
        setVersions(list);
        setVersion(list[0]?.id ?? "");
      })
      .catch((e) => active && setError(String(e)));
    if (kind === "datapack")
      invoke<string[]>("content_worlds", { profile: target })
        .then((list) => {
          if (!active) return;
          setWorlds(list);
          setWorld(list[0] ?? "");
        })
        .catch(() => active && setWorlds([]));
    return () => {
      active = false;
    };
  }, [target]);
  const install = async () => {
    setWorking(true);
    setError("");
    try {
      const world_ = kind === "datapack" ? world : null;
      const file =
        source === "curseforge"
          ? await invoke<string>("curseforge_content_install", {
              profile: target,
              kind,
              project: Number(hit.project_id),
              file: Number(version),
              world: world_,
            })
          : await invoke<string>("content_install", {
              profile: target,
              kind,
              project: hit.project_id,
              version,
              world: world_,
            });
      notice(t("{name} kuruldu: {file}", { name: hit.title, file }));
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };
  const folder =
    kind === "resourcepack"
      ? t("Kaynak paketleri")
      : kind === "shader"
        ? t("Shader paketleri")
        : t("Dünyanın datapacks klasörü");
  return (
    <Modal title={t("{name} kur", { name: hit.title })} close={close} locked={working}>
      <div className="content-install">
        <label className="lbl">
          {t("Hedef profil")}
          <Select
            className="field"
            aria-label={t("Hedef profil")}
            value={target}
            disabled={working}
            onChange={(e) => setTarget(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id} data-icon={profileArtwork(p.appearance?.icon, "icon")}>
                {p.name} · {p.version} · {p.loader ?? "Vanilla"}
              </option>
            ))}
          </Select>
        </label>
        {!profiles.length && <p className="lbl">{t("Önce bir sürüm veya profil oluştur.")}</p>}
        {kind === "datapack" && (
          <label className="lbl">
            {t("Dünya")}
            {worlds.length ? (
              <Select
                className="field"
                aria-label={t("Dünya")}
                value={world}
                disabled={working}
                onChange={(e) => setWorld(e.target.value)}
              >
                {worlds.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="setting-warning">
                {t("Bu profilde henüz dünya yok. Veri paketleri bir dünyaya kurulur; önce oyunda bir dünya oluştur.")}
              </span>
            )}
          </label>
        )}
        <label className="lbl">
          {t("Sürüm")}
          {versions === null && !error ? (
            <span>{t("Uyumlu sürümler yükleniyor…")}</span>
          ) : versions?.length ? (
            <Select
              className="field"
              aria-label={t("Sürüm")}
              value={version}
              disabled={working}
              onChange={(e) => setVersion(e.target.value)}
            >
              {versions.map((v, i) => (
                <option key={v.id} value={v.id}>
                  {v.version_number}
                  {i === 0 ? t(" · Önerilen") : ""}
                  {v.version_type !== "release" ? ` · ${v.version_type}` : ""}
                </option>
              ))}
            </Select>
          ) : (
            versions && (
              <span className="setting-warning">
                {t("Minecraft {version} için uyumlu sürüm yok.", { version: profile?.version ?? "" })}
              </span>
            )
          )}
        </label>
        {kind === "shader" && profile?.loader !== "Fabric" && (
          <p className="lbl setting-warning">
            {t("Shader kullanmak için profilde Iris (Fabric) veya OptiFine gerekir.")}
          </p>
        )}
        <p className="lbl">{t("Dosya şuraya kurulacak: {folder}", { folder })}</p>
        {error && (
          <p className="lbl setting-warning" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="btn" disabled={working} onClick={close}>
            {t("Vazgeç")}
          </button>
          <button
            className="btn primary"
            disabled={working || !version || !target || (kind === "datapack" && !world)}
            onClick={() => void install()}
          >
            {working ? t("Kuruluyor…") : t("Kur")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
