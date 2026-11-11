import { t } from "./i18n";
import type { Profile } from "./types/core";
export const loaderLabel = (p?: Pick<Profile, "loader" | "loader_version">) =>
  p?.loader && p.loader !== "Vanilla"
    ? `${p.loader}${p.loader_version ? ` ${p.loader_version.replace("+", " ")}` : ""}`
    : "Vanilla";
export function nameError(name: string): string {
  if (!name.trim() || Array.from(name).length > 40)
    return t("Profil adı 1–40 karakter olmalı.");
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return t("Metin alanı geçersiz.");
  return "";
}
