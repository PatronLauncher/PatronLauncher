import { filledIcons, paths } from "../icons";
import type { CSSProperties } from "react";
export default function Icon({
  name,
  style,
}: {
  name: keyof typeof paths;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={filledIcons.has(name) ? "i i-fill" : "i"}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths[name] }}
    />
  );
}
