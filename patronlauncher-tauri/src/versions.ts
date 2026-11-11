import type { Version } from "./types/core";
export interface CatalogVersion extends Version {
  releaseTime: string;
  installed: boolean;
}
export type SortOrder = "popular" | "newest" | "oldest";
export interface Family {
  id: string;
  versions: CatalogVersion[];
  newest: string;
}
// A single rule for release IDs, prereleases and both historical numbering schemes.
// Weekly snapshots have no reliable target version in Mojang's manifest: do not guess it.
export function versionFamily(v: Pick<Version, "id" | "type">): string {
  if (v.type === "old_alpha") return "Alpha";
  if (v.type === "old_beta") return "Beta";
  const match = v.id.match(/^(\d+)(?:\.(\d+))?(?=[.-]|$)/);
  if (match && (match[1] !== "1" || match[2]))
    return match[1] === "1" ? `1.${match[2] ?? "0"}` : String(Number(match[1]));
  return v.type === "snapshot" ? "Snapshot" : v.id;
}
export function families(
  versions: CatalogVersion[],
  snapshots: boolean,
  legacy: boolean,
): Family[] {
  const map = new Map<string, Family>();
  for (const v of versions) {
    if (
      v.type !== "release" &&
      !(snapshots && v.type === "snapshot") &&
      !(legacy && (v.type === "old_alpha" || v.type === "old_beta"))
    )
      continue;
    const id = versionFamily(v);
    let family = map.get(id);
    if (!family) {
      family = { id, versions: [], newest: "" };
      map.set(id, family);
    }
    family.versions.push(v);
    if (v.releaseTime > family.newest) family.newest = v.releaseTime;
  }
  return [...map.values()].map((f) => ({
    ...f,
    versions: f.versions.sort(
      (a, b) =>
        b.releaseTime.localeCompare(a.releaseTime) ||
        b.id.localeCompare(a.id, undefined, { numeric: true }),
    ),
  }));
}
const priority = [
  "26",
  "1.21",
  "1.20",
  "1.19",
  "1.18",
  "1.17",
  "1.16",
  "1.15",
  "1.14",
  "1.13",
  "1.12",
  "1.8",
  "1.7",
];
export function orderFamilies(items: Family[], order: SortOrder): Family[] {
  return [...items].sort((a, b) => {
    if (order === "popular") {
      const rank = (id: string) => {
        const i = priority.indexOf(id);
        return i < 0 ? 999 : i;
      };
      const delta = rank(a.id) - rank(b.id);
      if (delta) return delta;
    }
    const delta =
      a.newest.localeCompare(b.newest) ||
      a.id.localeCompare(b.id, undefined, { numeric: true });
    return order === "oldest" ? delta : -delta;
  });
}
export function familyGradient(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(155deg,hsl(${hue} 55% 31%),hsl(${(hue + 45) % 360} 48% 13%))`;
}
