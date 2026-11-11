const images = import.meta.glob<string>("./assets/versions/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});
const file = (name: string): string | undefined => images[`./assets/versions/${name}.webp`];

/** Sürümün kendi kapağı, yoksa ailesinin kapağı (1.21.8 → 1.21, 26.0 → 26). */
export function versionArt(id: string): string | undefined {
  return file(id) ?? file(id.split(".").slice(0, id.startsWith("1.") ? 2 : 1).join("."));
}
