import icon from "./assets/default-profile-icon.svg";
import background from "./assets/default-profile-background.svg";

// Persist stable built-in identifiers, never Vite's hashed output filenames.
export const DEFAULT_PROFILE_ICON = "builtin:profile-icon";
export const DEFAULT_PROFILE_BACKGROUND = "builtin:profile-background";
export function profileArtwork(
  src: string | null | undefined,
  kind: "icon" | "background",
) {
  if (
    !src ||
    src === DEFAULT_PROFILE_ICON ||
    src === DEFAULT_PROFILE_BACKGROUND
  )
    return kind === "icon" ? icon : background;
  return src;
}
