import { t } from "../i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot, Profile } from "../types/core";
import type { Run } from "../backend";
import type { Page } from "../navigation";
import { loaderLabel, nameError } from "../profile";
import { profileArtwork } from "../profileArtwork";
import Modal from "./Modal";
type Status = "installed" | "not_installed" | "update_available";
export default function ProfilesPage({
  s,
  run,
  go,
  create,
}: {
  s: Snapshot;
  run: Run;
  go: (page: Page) => void;
  create: () => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, Status>>({}),
    [statusError, setStatusError] = useState("");
  const [editing, setEditing] = useState<{
    profile: Profile;
    action: "rename" | "copy" | "remove";
  } | null>(null);
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const profiles = s.profiles.filter((p) => p.kind !== "Quick");
  const disabled = s.busy || s.running || s.load_failed || pending;
  const key = profiles
    .map((p) => [p.id, p.version, p.loader, p.loader_version].join(":"))
    .join("|");
  const versionKey = s.versions.map((v) => v.id + v.sha1).join("|");
  useEffect(() => {
    let active = true;
    invoke<Record<string, Status>>("profile_statuses")
      .then((v) => {
        if (active) {
          setStatuses(v);
          setStatusError("");
        }
      })
      .catch((e) => {
        if (active) setStatusError(String(e));
      });
    return () => {
      active = false;
    };
  }, [key, versionKey, s.busy]);
  const edit = (profile: Profile, action: "rename" | "copy" | "remove") => {
    setEditing({ profile, action });
    setName(
      action === "copy"
        ? Array.from(profile.name).slice(0, 32).join("") + t(" kopyası")
        : profile.name,
    );
    setError("");
  };
  const selected = profiles.find((p) => p.id === s.selected_profile);
  return (
    <>
      <div className="actions profiles-toolbar">
        <p className="lbl">{t("Sana ait oyun alanları · {count} profil", { count: profiles.length })}</p>
        <button className="btn v-add" disabled={disabled} onClick={create}>{t("+ Profil oluştur")}</button>
      </div>
      {!profiles.length && (
        <section className="glass">
          <h4>{t("Henüz oyun profili yok")}</h4>
          <p className="lbl">{t("Yeni bir oyun alanı için profil oluşturma sihirbazını kullan.")}</p>
        </section>
      )}
      {statusError && (
        <p className="lbl" role="alert">{t("Kurulum durumu okunamadı:")} {statusError}
        </p>
      )}
      <div className="pg profiles-grid">
        {profiles.map((p) => {
          const isSelected = p.id === s.selected_profile,
            status = statuses[p.id];
          return (
            <article
              className={"pf profile-card " + (isSelected ? "sel" : "")}
              key={p.id}
            >
              <img
                className="profile-background"
                src={profileArtwork(p.appearance?.background, "background")}
                alt=""
                loading="lazy"
              />
              <div className="ic">
                <img
                  className="profile-icon"
                  src={profileArtwork(p.appearance?.icon, "icon")}
                  alt=""
                  loading="lazy"
                />
              </div>
              <h4>{p.name}</h4>
              <p>Minecraft {p.version}</p>
              {p.appearance?.description && (
                <p className="profile-description">
                  {p.appearance.description}
                </p>
              )}
              <div className="profile-badges">
                <span className="bd m">{loaderLabel(p)}</span>
                <span
                  className={
                    "bd " + (status === "installed" ? "profile-ready" : "m")
                  }
                >
                  {status === "installed"
                    ? t("Kurulu")
                    : status === "update_available"
                      ? t("Güncelleme var")
                      : status === "not_installed"
                        ? t("İndirilmedi")
                        : t("Kontrol ediliyor…")}
                </span>
              </div>
              <div className="actions">
                <button
                  className="btn v-add profile-play"
                  disabled={disabled}
                  onClick={async () => {
                    if (!s.selected_account) {
                      await run("select_profile", { id: p.id });
                      go("account");
                    } else if (
                      await run("profile_action", {
                        id: p.id,
                        operation: "play",
                      })
                    )
                      go("home");
                  }}
                >{t("Oyna")}</button>
                <button
                  className="btn"
                  disabled={disabled || isSelected}
                  onClick={() => void run("select_profile", { id: p.id })}
                >
                  {isSelected ? t("SEÇİLİ") : t("Seç")}
                </button>
                <details className="profile-menu">
                  <summary
                    className="btn"
                    aria-label={p.name + t(" profil işlemleri")}
                  >
                    ⋯
                  </summary>
                  <div
                    className="profile-menu-items"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button"))
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                    }}
                  >
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() => void run("install_profile", { id: p.id })}
                    >
                      {status === "installed"
                        ? t("Dosyaları doğrula")
                        : status === "update_available"
                          ? t("Güncelle")
                          : t("İndir")}
                    </button>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() => edit(p, "copy")}
                    >{t("Kopyala")}</button>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() => edit(p, "rename")}
                    >{t("Yeniden adlandır")}</button>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() =>
                        void run("profile_action", {
                          id: p.id,
                          operation: "folder",
                        })
                      }
                    >{t("Klasörü aç")}</button>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() =>
                        void run("profile_action", {
                          id: p.id,
                          operation: "backup",
                        })
                      }
                    >{t("Yedekle")}</button>
                    <button
                      className="btn"
                      disabled={disabled}
                      onClick={() => edit(p, "remove")}
                    >{t("Listeden kaldır")}</button>
                  </div>
                </details>
              </div>
            </article>
          );
        })}
      </div>
      {selected && (
        <section className="glass">
          <h4>{selected.name} {t("· yönetim")}</h4>
          <p className="lbl">{t("Listeden kaldırılan profilin dünyaları ve dosyaları diskte kalır.")}</p>
          <div className="actions">
            <button className="btn" onClick={() => go("folder")}>{t("Yedekler ve koruma")}</button>
          </div>
        </section>
      )}
      {editing && (
        <Modal
          title={
            editing.action === "rename"
              ? t("Profili yeniden adlandır")
              : editing.action === "copy"
                ? t("Profili kopyala")
                : t("Profili listeden kaldır")
          }
          close={() => setEditing(null)}
          locked={pending}
        >
          <form
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (disabled) return;
              const validation =
                editing.action === "remove" ? "" : nameError(name);
              if (validation) {
                setError(validation);
                return;
              }
              setPending(true);
              const result =
                editing.action === "remove"
                  ? await run("remove_profile", { id: editing.profile.id })
                  : await run(
                      editing.action === "copy"
                        ? "copy_profile"
                        : "rename_profile",
                      { id: editing.profile.id, name },
                    );
              setPending(false);
              if (result) setEditing(null);
              else
                setError(t("İşlem tamamlanamadı. Durum çubuğunu kontrol edin."));
            }}
          >
            {editing.action === "remove" ? (
              <p className="lbl">
                {t("{name} yalnızca listeden kaldırılacak. Dünyalar silinmez; profil dosyaları diskte kalır.", { name: editing.profile.name })}</p>
            ) : (
              <>
                <label className="lbl">{t("Profil adı")}<input
                    autoFocus
                    className="field"
                    value={name}
                    disabled={pending}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError("");
                    }}
                  />
                </label>
                {editing.action === "copy" && (
                  <p className="lbl">{t("Ayarlar, modlar ve dünyalar ayrı bir klasöre kopyalanır. Kaynak profil değiştirilmez.")}</p>
                )}
              </>
            )}
            {error && (
              <p className="lbl" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => setEditing(null)}
              >{t("Vazgeç")}</button>
              <button className="btn v-add" disabled={disabled}>
                {editing.action === "remove"
                  ? t("Listeden kaldır")
                  : editing.action === "copy"
                    ? t("Kopyala")
                    : t("Kaydet")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
