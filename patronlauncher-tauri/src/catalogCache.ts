import { invoke } from "@tauri-apps/api/core";
import type { CatalogVersion } from "./versions";
let memory: CatalogVersion[] = [];
export function catalogCache() {
  if (memory.length) return memory;
  try {
    const v = JSON.parse(
      localStorage.getItem("patron-version-catalog") ?? "[]",
    );
    if (
      Array.isArray(v) &&
      v.every((x) => typeof x.id === "string" && typeof x.type === "string")
    )
      memory = v;
  } catch {}
  return memory;
}
export function saveCatalog(entries: CatalogVersion[]) {
  memory = entries;
  try {
    localStorage.setItem("patron-version-catalog", JSON.stringify(entries));
  } catch {}
  window.dispatchEvent(new Event("patron-catalog"));
}
export async function warmCatalog() {
  const entries = await invoke<CatalogVersion[]>("list_version_catalog");
  saveCatalog(entries);
  return entries;
}
