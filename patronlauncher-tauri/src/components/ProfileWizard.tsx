import { t } from "../i18n";
import { Select, Toggle } from "./Controls";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loaderIcons } from "../loaderIcons";
import type {
  InstalledVersion,
  Loader,
  LoaderVersions,
  ProfileAppearance,
  Snapshot,
} from "../types/core";
import type { Run } from "../backend";
import Modal from "./Modal";
import Icon from "./Icon";
import { profileArtwork } from "../profileArtwork";

async function prepareImage(file: File, icon: boolean): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error(t("PNG, JPEG veya WebP seçin."));
  if (file.size > 5 * 1024 * 1024)
    throw new Error(t("Görsel en fazla 5 MB olabilir."));
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error(t("Görsel çözünürlüğü çok büyük."));
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
    canvas.width = icon ? 128 : Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = icon ? 128 : Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    if (icon) {
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        128,
        128,
      );
    } else ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/png");
    if (result.length > 6_990_000)
      throw new Error(
        t("Hazırlanan görsel 5 MB sınırını aşıyor. Daha küçük bir görsel seçin."),
      );
    return result;
  } finally {
    bitmap.close();
  }
}
export default function ProfileWizard({
  s,
  run,
  close,
}: {
  s: Snapshot;
  run: Run;
  close: () => void;
}) {
  const [step, setStep] = useState(0),
    [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [version, setVersion] = useState(
    s.versions.find((v) => v.type === "release")?.id ?? "",
  );
  const [loader, setLoader] = useState<Loader>("Vanilla"),
    [loaderVersion, setLoaderVersion] = useState("");
  const [loaders, setLoaders] = useState<LoaderVersions | null>(null),
    [loading, setLoading] = useState(false);
  const [installed, setInstalled] = useState<InstalledVersion[]>([]),
    [error, setError] = useState("");
  const [appearance, setAppearance] = useState<ProfileAppearance>({
    description: "",
    icon: null,
    background: null,
  });
  const [pending, setPending] = useState(false),
    [imagePending, setImagePending] = useState(false);
  const imageRequest = useRef(0);
  useEffect(() => {
    let active = true;
    invoke<InstalledVersion[]>("list_installed_versions")
      .then((v) => {
        if (active) setInstalled(v);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoaders(null);
    setLoaderVersion("");
    setLoading(true);
    if (!version) {
      setLoading(false);
      return;
    }
    if (loader === "Vanilla") {
      setLoading(false);
      return;
    }
    invoke<LoaderVersions>("list_loader_versions", {
      minecraftVersion: version,
      loader,
    })
      .then((v) => {
        if (active) {
          setLoaders(v);
          setLoaderVersion(v.default_version ?? "");
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
  }, [version, loader]);
  const busy = pending || imagePending || s.busy || s.running || s.load_failed;
  const next = () => {
    setError("");
    if (
      step === 1 &&
      (!name.trim() ||
        Array.from(name).length > 32 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(name))
    ) {
      setError(t("Profil adı 1–32 karakter olmalı."));
      return;
    }
    if (step === 1 && Array.from(description).length > 300) {
      setError(t("Açıklama en fazla 300 karakter olabilir."));
      return;
    }
    if (
      step === 2 &&
      (!version || (loader !== "Vanilla" && (!loaderVersion || loading)))
    ) {
      setError(t("Desteklenen bir sürüm ve yükleyici seçin."));
      return;
    }
    setStep(step + 1);
  };
  const selectImage = async (
    file: File | undefined,
    key: "icon" | "background",
  ) => {
    if (!file) return;
    const request = ++imageRequest.current;
    setImagePending(true);
    setError("");
    try {
      const data = await prepareImage(file, key === "icon");
      if (request === imageRequest.current)
        setAppearance((old) => ({ ...old, [key]: data }));
    } catch (e) {
      setError(String(e));
    } finally {
      if (request === imageRequest.current) setImagePending(false);
    }
  };
  return (
    <Modal
      title={t("Profil oluştur")}
      close={close}
      locked={pending || imagePending}
    >
      {step === 0 ? (
        <>
          <p className="lbl">{t("Sana ait yeni bir oyun alanı oluştur.")}</p>
          <div className="wizard-options">
            <button className="btn wizard-option" onClick={() => setStep(1)}>
              <Icon name="profiles" />
              <span>
                <b>{t("Sıfırdan oluştur")}</b>
                <small>{t("Sürümünü ve yükleyicini kendin seç.")}</small>
              </span>
              <span>→</span>
            </button>
            {[
              [t("Dosyadan içe aktar"), t(".mrpack / .zip arşivi")],
              [t("Modrinth modpack’i yükle"), t("Hazır bir modpack ile başla.")],
              [
                t("Başka launcher’dan aktar"),
                t("Prism, ATLauncher, Modrinth uygulaması, CurseForge"),
              ],
            ].map(([title, desc]) => (
              <button className="btn wizard-option" disabled key={title}>
                <span>
                  <b>{title}</b>
                  <small>{desc}</small>
                </span>
                <span className="bd m">{t("Yakında")}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            if (step < 3) {
              next();
              return;
            }
            setPending(true);
            setError("");
            const result = await run("create_wizard_profile", {
              name: name.trim(),
              versionId: version,
              loader,
              loaderVersion: loader !== "Vanilla" ? loaderVersion : null,
              appearance: { ...appearance, description },
            });
            setPending(false);
            if (result) close();
            else
              setError(t("Profil oluşturulamadı. Durum mesajını kontrol edin."));
          }}
        >
          <ol className="wizard-steps">
            {[t("Bilgi"), t("Sürüm"), t("Görsel")].map((label, i) => (
              <li
                key={label}
                aria-current={step === i + 1 ? "step" : undefined}
                className={step === i + 1 ? "active" : ""}
              >
                {i + 1}. {label}
              </li>
            ))}
          </ol>
          {step === 1 && (
            <div className="wizard-fields">
              <label className="lbl">{t("Profil adı *")}<input
                  autoFocus
                  className="field"
                  value={name}
                  maxLength={32}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="lbl">{t("Açıklama")} <small>{Array.from(description).length}/300</small>
                <textarea
                  className="field"
                  value={description}
                  maxLength={300}
                  rows={3}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className="lbl">
                <Toggle type="checkbox" checked disabled readOnly /> {t("Ayrı klasör")}</label>
              <p className="lbl">{t("Her profilin dünyaları, modları ve ayarları kendi izole klasöründe tutulur.")}</p>
            </div>
          )}
          {step === 2 && (
            <div className="wizard-fields">
              <label className="lbl">{t("Minecraft sürümü")}<Select
                  className="field"
                  value={version}
                  onChange={(e) => {
                    setVersion(e.target.value);
                    setLoader("Vanilla");
                    setError("");
                  }}
                >
                  {s.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                      {installed.some((i) => i.mc === v.id) ? t(" · Kurulu") : ""}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="actions" role="group" aria-label={t("Mod yükleyici")}>
                {(["Vanilla", "Fabric", "Quilt", "NeoForge", "Forge", "OptiFine"] as const).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={"btn " + (loader === name ? "v-add" : "")}
                    aria-pressed={loader === name}
                    onClick={() => setLoader(name)}
                  >
                    <img src={loaderIcons[name]} alt="" width={16} height={16} style={{ objectFit: "contain" }} /> {name}{" "}
                    {installed.some((i) => i.mc === version && i.loader === name) ? t("· Kurulu") : ""}
                  </button>
                ))}
              </div>
              <p className="lbl">
                {loading
                  ? t("Yükleyiciler kontrol ediliyor…")
                  : loader !== "Vanilla" && !loaders?.versions.length
                    ? t("{name} bu Minecraft sürümünü desteklemiyor.", { name: loader })
                    : ""}
              </p>
              {loader !== "Vanilla" && !!loaders?.versions.length && (
                <label className="lbl">{t("{name} sürümü", { name: loader })}<Select
                    className="field"
                    value={loaderVersion}
                    onChange={(e) => setLoaderVersion(e.target.value)}
                  >
                    {loaders?.versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        {v.version.replace("+", " ")}
                        {v.stable ? t(" · Kararlı") : ""}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <p className="lbl">{t("Eksik oyun dosyaları ilk oynayışta veya profil menüsündeki İndir ile kurulur.")}</p>
            </div>
          )}
          {step === 3 && (
            <div className="wizard-fields">
              <p className="lbl">{t("Görseller tamamen isteğe bağlıdır. Seçmezsen varsayılan simge ve arka plan kullanılır. PNG / JPEG / WebP, dosya başına en fazla 5 MB. Simge 128×128 olarak hazırlanır.")}</p>
              {(["icon", "background"] as const).map((key) => (
                <label className="lbl" key={key}>
                  {key === "icon"
                    ? t("Profil simgesi (isteğe bağlı)")
                    : t("Arka plan (isteğe bağlı)")}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      void selectImage(e.target.files?.[0], key);
                      e.target.value = "";
                    }}
                  />
                  <img
                    className={"wizard-preview " + key}
                    src={profileArtwork(appearance[key], key)}
                    alt={
                      appearance[key]
                        ? key === "icon"
                          ? t("Simge önizlemesi")
                          : t("Arka plan önizlemesi")
                        : key === "icon"
                          ? t("Varsayılan profil simgesi")
                          : t("Varsayılan profil arka planı")
                    }
                  />
                  {!appearance[key] && <small>{t("Varsayılan görsel")}</small>}
                  {appearance[key] && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() =>
                          setAppearance((old) => ({ ...old, [key]: null }))
                        }
                      >{t("Görseli kaldır")}</button>
                    </>
                  )}
                </label>
              ))}
              <p className="lbl">
                {name} {t("· Minecraft")} {version} · {loader}
                {loader !== "Vanilla" ? " " + loaderVersion.replace("+", " ") : ""}
              </p>
            </div>
          )}
          {error && (
            <p className="lbl" role="alert">
              {error}
            </p>
          )}
          <div className="actions wizard-footer">
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                setStep(step - 1);
                setError("");
              }}
            >{t("Geri")}</button>
            <button
              className="btn v-add"
              disabled={busy || (step === 2 && !version)}
            >
              {pending
                ? t("Oluşturuluyor…")
                : imagePending
                  ? t("Görsel hazırlanıyor…")
                  : step === 3
                    ? t("Oluştur")
                    : t("Devam")}
            </button>
          </div>
        </form>
      )}
      {step === 0 && error && (
        <p role="alert" className="lbl">
          {error}
        </p>
      )}
    </Modal>
  );
}
