import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Account } from "../types/core";

/** Rust: skins::Skin */
type Skin = { data_url: string; slim: boolean };
type Face = "f" | "b" | "r" | "l" | "t" | "u";
type PartName = "head" | "body" | "arm-r" | "arm-l" | "leg-r" | "leg-l";

/** Skin dokusundaki kutu yerleşimi: [u, v] taban, [u, v] dış katman (64×64 biçim). */
const UV: Record<PartName, { base: [number, number]; over: [number, number] | null; legacy?: PartName }> = {
  head: { base: [0, 0], over: [32, 0] },
  body: { base: [16, 16], over: [16, 32] },
  "arm-r": { base: [40, 16], over: [40, 32] },
  "arm-l": { base: [32, 48], over: [48, 48], legacy: "arm-r" },
  "leg-r": { base: [0, 16], over: [0, 32] },
  "leg-l": { base: [16, 48], over: [0, 48], legacy: "leg-r" },
};
const SIZE: Record<PartName, [number, number, number]> = {
  head: [8, 8, 8],
  body: [8, 12, 4],
  "arm-r": [4, 12, 4],
  "arm-l": [4, 12, 4],
  "leg-r": [4, 12, 4],
  "leg-l": [4, 12, 4],
};

/**
 * Standart Minecraft kutu açılımında bir yüzün sol üst köşesi. Sahnede .r yüzü izleyicinin sağına,
 * yani oyuncunun soluna bakar; .l ise oyuncunun sağına.
 */
function faceOrigin([u, v]: [number, number], [w, , d]: [number, number, number], face: Face): [number, number] {
  switch (face) {
    case "t":
      return [u + d, v];
    case "u":
      return [u + d + w, v];
    case "l":
      return [u, v + d];
    case "f":
      return [u + d, v + d];
    case "r":
      return [u + d + w, v + d];
    case "b":
      return [u + 2 * d + w, v + d];
  }
}

function faceStyle(skin: Skin, legacy: boolean, part: PartName, face: Face, slim: boolean): CSSProperties {
  const uv = legacy && UV[part].legacy ? UV[UV[part].legacy!] : UV[part];
  const size: [number, number, number] = slim && part.startsWith("arm") ? [3, 12, 4] : SIZE[part];
  const layers: [number, number][] = [];
  // Eski 64×32 skinlerde yalnızca şapka katmanı vardır.
  if (uv.over && (!legacy || part === "head")) layers.push(faceOrigin(uv.over, size, face));
  layers.push(faceOrigin(uv.base, size, face));
  const at = (x: number) => `calc(var(--u) * ${-x})`;
  return {
    backgroundColor: "transparent",
    backgroundImage: layers.map(() => `url("${skin.data_url}")`).join(", "),
    backgroundSize: layers.map(() => `calc(var(--u) * 64) calc(var(--u) * ${legacy ? 32 : 64})`).join(", "),
    backgroundPosition: layers.map(([x, y]) => `${at(x)} ${at(y)}`).join(", "),
    backgroundRepeat: "no-repeat",
  };
}

function Part({ name, skin, legacy }: { name: PartName; skin: Skin | null; legacy: boolean }) {
  const slim = !!skin?.slim && name.startsWith("arm");
  return (
    <div className={"pc-part " + name + (slim ? " slim" : "")}>
      {(["f", "b", "r", "l", "t", "u"] as Face[]).map((face) => (
        <i key={face} className={face} style={skin ? faceStyle(skin, legacy, name, face, slim) : undefined} />
      ))}
    </div>
  );
}

/** Seçili hesabın skini: Microsoft hesabında kendi profili, yerel hesapta ada kayıtlı lisanslı hesap. */
function useSkin(account?: Account) {
  const [skin, setSkin] = useState<{ key: string; skin: Skin | null; legacy: boolean } | null>(null);
  const key = account ? `${account.kind}:${account.name}:${account.uuid}` : "";
  useEffect(() => {
    if (!account) return;
    let alive = true;
    invoke<Skin | null>("player_skin", {
      name: account.name,
      uuid: account.kind === "Microsoft" ? account.uuid : null,
    })
      .then((found) => {
        if (!found) {
          if (alive) setSkin({ key, skin: null, legacy: false });
          return;
        }
        // 64×32 eski biçim mi? Görsel yüklenince yüksekliğine bakılır.
        const img = new Image();
        img.onload = () => alive && setSkin({ key, skin: found, legacy: img.naturalHeight === 32 });
        img.onerror = () => alive && setSkin({ key, skin: null, legacy: false });
        img.src = found.data_url;
      })
      .catch(() => alive && setSkin({ key, skin: null, legacy: false }));
    return () => {
      alive = false;
    };
  }, [key]);
  return skin?.key === key ? skin : null;
}

/**
 * PClient avatarı: CSS ile çizilen 3B Minecraft karakteri. Hesabın skini bulunursa yüzlere uygulanır;
 * bulunamazsa (ör. lisanslı karşılığı olmayan yerel ad) PClient'ın kendi kıyafeti görünür.
 */
export default function Avatar({ account }: { account?: Account }) {
  const found = useSkin(account);
  const skin = found?.skin ?? null;
  const legacy = found?.legacy ?? false;
  return (
    <div className="pc-avatar-wrap" aria-hidden="true">
      <div className="pc-avatar-sway">
        <div className={"pc-avatar " + (skin ? "skinned" : "")}>
          {(["head", "body", "arm-r", "arm-l", "leg-r", "leg-l"] as PartName[]).map((p) => (
            <Part key={p} name={p} skin={skin} legacy={legacy} />
          ))}
        </div>
      </div>
      <div className="pc-pedestal">
        <i />
        <i />
      </div>
    </div>
  );
}
