export interface ModHit {
  project_id: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
  follows?: number;
  date_modified: string;
  author: string;
  categories: string[];
  versions?: string[];
}
export interface ModVersion {
  id: string;
  version_number: string;
  changelog: string;
  game_versions: string[];
  loaders: string[];
  version_type: string;
  date_published: string;
}
export interface ModEntry {
  project_id: string;
  version_id: string;
  filename: string;
  user_selected: boolean;
  requires: string[];
}
export interface ModPlan {
  id: string;
  profile: string;
  mc: string;
  entries: ModEntry[];
  installed: ModEntry[];
  warnings: string[];
  total_bytes: number;
}
export interface ModVersions {
  recommended: string | null;
  compatible: ModVersion[];
  incompatible: ModVersion[];
}
export function modImage(url?: string) {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" &&
      u.hostname === "cdn.modrinth.com" &&
      !u.username &&
      !u.password &&
      !u.port
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function modLink(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" &&
      ["modrinth.com", "www.curseforge.com", "github.com", "www.youtube.com", "youtube.com", "youtu.be", "vimeo.com"].includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port
      ? u.href
      : null;
  } catch {
    return null;
  }
}
// HTML is parsed only to extract text and safe link targets. No remote markup
// or attributes ever enter the rendered DOM, including SVG/event handlers.
export function modText(raw: string) {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  doc
    .querySelectorAll(
      "script,style,iframe,object,embed,svg,math,template,form,link,meta",
    )
    .forEach((n) => n.remove());
  doc
    .querySelectorAll("a")
    .forEach((a) =>
      a.replaceWith(
        document.createTextNode(
          modLink(a.getAttribute("href") ?? "")
            ? `[${a.textContent}](${a.getAttribute("href")})`
            : (a.textContent ?? ""),
        ),
      ),
    );
  doc.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  doc
    .querySelectorAll("p,div,li,h1,h2,h3,h4,pre")
    .forEach((n) => n.append("\n"));
  return doc.body.textContent ?? "";
}
