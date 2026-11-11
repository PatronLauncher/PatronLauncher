/** Sürüm kartlarının ortam renkleri ve imleç üstündeyken çıkan piksel partikülleri. */
export type Motion = "rise" | "fall" | "drift" | "float" | "burst" | "ring";

export interface Sprite {
  w: number;
  h: number;
  cells: [number, number, string][];
}

export interface Emitter {
  sprites: Sprite[];
  motion: Motion;
  /** Saniyedeki partikül sayısı. */
  rate: number;
  life: [number, number];
  speed: [number, number];
  sway?: number;
  gravity?: number;
}

export interface VersionEffect {
  a: string;
  b: string;
  fog: string;
  emitters: Emitter[];
}

function art(rows: string, palette: Record<string, string>): Sprite {
  const lines = rows.trim().split(/\s+/);
  const cells: [number, number, string][] = [];
  lines.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (palette[c]) cells.push([x, y, palette[c]]);
    }),
  );
  return { w: lines[0].length, h: lines.length, cells };
}

const dot = (color: string, size = 2) => art(Array(size).fill("x".repeat(size)).join(" "), { x: color });
const plus = (color: string) => art(".x. xxx .x.", { x: color });
const CRYSTAL = "..p.. .pLp. .pLP. pPLpP .pLP. ..p..";
const LEAF = "gG. Ggg .gG";
const NOTE = "...xx ...x. ...x. .xxx. xxxx. .xx..";
const RUNES = ["x.x xxx x.x x.x", "xxx .x. xxx ..x", "x.. xxx ..x xxx", "xxx x.x xxx x.."];

const bubble = art(".www. w...w w.w.w w...w .www.", { w: "#9fe3ff" });
const drop = art(".b. .b. bBb bBb .b.", { b: "#4aa8ff", B: "#b9e6ff" });
const honey = art(".h. hHh hHh hHh .h.", { h: "#f0a020", H: "#ffd257" });
const bee = art(".ww.. ykyky ykyky", { w: "#e9f5ff", y: "#ffc928", k: "#2b2015" });
const flame = art("..o.. .oo.. .oYo. oYYo. oYWYo oYWYo .oYo.", { o: "#ff5a1f", Y: "#ffb020", W: "#fff0a8" });
const ember = art("oo oY", { o: "#ff7a22", Y: "#ffd257" });
const shardA = art(CRYSTAL, { p: "#8f5bd6", L: "#e6c9ff", P: "#6a3db0" });
const shardB = art(CRYSTAL, { p: "#b98cf0", L: "#ffffff", P: "#8f5bd6" });
const flake = art("w...w .w.w. ..w.. .w.w. w...w", { w: "#f2fbff" });
const soul = art(".ccc. c.c.c ccccc .c.c.", { c: "#39e6da" });
const petalA = art("rp.. ppr. .prr", { r: "#ffb7d5", p: "#ff8fbe" });
const petalB = art(".pr rpp pr.", { r: "#ffd3e6", p: "#ffa1c8" });
const gustA = art("...www... ..w...w.. ......w.. wwwwww...", { w: "#d8f1ff" });
const gustB = art("wwwww... .....w.. ..www...", { w: "#a9dcff" });
const feather = art("..yy .yYy yYy. y...", { y: "#ffd84a", Y: "#fff3a6" });
const flower = art(".p.p. ppYpp .ppp.", { p: "#ff8ed1", Y: "#ffe05a" });
const heart = art(".r.r. rrrrr rrrrr .rrr. ..r..", { r: "#ff4d6d" });
const leaf = art(LEAF, { g: "#4fae3c", G: "#8fdc5c" });
const emerald = art(".GG. GgGG GGgG .GG.", { G: "#2fd673", g: "#b8ffd2" });
const notes = ["#ff5c5c", "#ffd23f", "#4be08a", "#4bb5ff", "#d77bff"].map((x) => art(NOTE, { x }));
const runes = RUNES.map((r) => art(r, { x: "#7fd8ff" }));

const e = (sprites: Sprite[], motion: Motion, rate: number, life: [number, number], speed: [number, number], extra: Partial<Emitter> = {}): Emitter => ({
  sprites,
  motion,
  rate,
  life,
  speed,
  ...extra,
});

const EFFECTS: Record<string, VersionEffect> = {
  "26": { a: "#ffd84a", b: "#ff8ed1", fog: "rgba(255,226,150,.34)", emitters: [e([feather], "fall", 7, [2, 3.4], [14, 24], { sway: 9 }), e([flower], "float", 3, [1.6, 2.4], [4, 8])] },
  "1.21": { a: "#d9863f", b: "#7fd2ff", fog: "rgba(170,220,255,.3)", emitters: [e([gustA, gustB], "drift", 8, [1, 1.7], [46, 76], { sway: 6 })] },
  "1.20": { a: "#ff9cc7", b: "#ffd9ea", fog: "rgba(255,190,220,.32)", emitters: [e([petalA, petalB], "fall", 12, [2.4, 3.8], [14, 24], { sway: 13 })] },
  "1.19": { a: "#148f8c", b: "#39e6da", fog: "rgba(30,160,165,.34)", emitters: [e([soul], "rise", 5, [1.5, 2.4], [14, 22], { sway: 4 }), e([], "ring", 1.4, [1.2, 1.5], [24, 34])] },
  "1.18": { a: "#79c7ff", b: "#e8f7ff", fog: "rgba(214,238,255,.36)", emitters: [e([flake, plus("#dff3ff"), dot("#ffffff")], "fall", 15, [2.2, 3.6], [16, 28], { sway: 7 })] },
  "1.17": { a: "#8f5bd6", b: "#ffb36b", fog: "rgba(165,120,235,.32)", emitters: [e([shardA, shardB], "float", 7, [1.2, 2], [6, 13]), e([plus("#f0ddff")], "float", 7, [0.5, 0.9], [1, 3])] },
  "1.16": { a: "#ff4b1f", b: "#21d6c4", fog: "rgba(255,92,38,.34)", emitters: [e([flame], "rise", 13, [0.8, 1.4], [24, 42], { sway: 5 }), e([ember], "rise", 9, [1, 1.8], [30, 52], { sway: 10 })] },
  "1.15": { a: "#ffb020", b: "#ffe08a", fog: "rgba(255,196,84,.34)", emitters: [e([honey], "fall", 9, [1.2, 2], [18, 26], { gravity: 62 }), e([bee], "drift", 1.6, [2.2, 3], [20, 32], { sway: 11 })] },
  "1.14": { a: "#c9863f", b: "#7ee05a", fog: "rgba(214,178,118,.32)", emitters: [e([plus("#77ee66"), emerald], "float", 11, [0.8, 1.5], [10, 18])] },
  "1.13": { a: "#1b86e6", b: "#41e0d0", fog: "rgba(96,190,255,.34)", emitters: [e([bubble], "rise", 11, [1.5, 2.6], [16, 30], { sway: 7 }), e([drop], "fall", 4, [0.9, 1.4], [28, 40], { gravity: 80 })] },
  "1.12": { a: "#ff5c9a", b: "#4bb5ff", fog: "rgba(255,170,215,.3)", emitters: [e(notes, "rise", 9, [1.4, 2.2], [16, 26], { sway: 9 })] },
  "1.11": { a: "#e7c94a", b: "#42d67a", fog: "rgba(214,214,110,.3)", emitters: [e([dot("#ffe35a", 3), dot("#55e07f", 3), dot("#b8f25c")], "burst", 24, [0.7, 1.3], [26, 58], { gravity: 26 })] },
  "1.10": { a: "#d9482b", b: "#a5e2ff", fog: "rgba(240,160,130,.3)", emitters: [e([ember], "rise", 8, [1, 1.7], [24, 42], { sway: 7 }), e([flake], "fall", 6, [2, 3], [14, 22], { sway: 6 })] },
  "1.9": { a: "#a35bd6", b: "#f3ecff", fog: "rgba(190,150,235,.3)", emitters: [e([plus("#ffffff"), plus("#d6b8ff"), dot("#b98cf0")], "float", 15, [0.7, 1.4], [8, 16])] },
  "1.8": { a: "#2fa6a0", b: "#d2fff5", fog: "rgba(120,220,210,.32)", emitters: [e([dot("#7ff0e0", 3), dot("#39b8ad", 3), bubble], "rise", 9, [1.4, 2.4], [14, 26], { sway: 6 })] },
  "1.7": { a: "#3f9c3a", b: "#ffd166", fog: "rgba(150,210,120,.3)", emitters: [e([leaf], "fall", 11, [2.2, 3.4], [14, 24], { sway: 11 })] },
  "1.6": { a: "#c9783f", b: "#ff6b81", fog: "rgba(230,170,140,.3)", emitters: [e([heart], "rise", 7, [1.2, 2], [14, 24], { sway: 6 })] },
  "1.5": { a: "#d11f2d", b: "#ff7a7a", fog: "rgba(220,70,80,.3)", emitters: [e([dot("#ff2b3a"), dot("#a80d1c"), plus("#ff5a64")], "float", 18, [0.5, 1.1], [8, 18])] },
  "1.4": { a: "#6d3fa8", b: "#7ed957", fog: "rgba(140,105,190,.32)", emitters: [e([plus("#b67cff"), dot("#7ed957")], "rise", 13, [0.9, 1.7], [14, 28], { sway: 8 })] },
  "1.3": { a: "#2fd673", b: "#c8ffe0", fog: "rgba(110,225,160,.3)", emitters: [e([emerald], "burst", 14, [0.8, 1.4], [22, 46], { gravity: 40 })] },
  "1.2": { a: "#2c8f3a", b: "#b6e36a", fog: "rgba(120,190,110,.3)", emitters: [e([leaf], "fall", 12, [2, 3.2], [15, 26], { sway: 10 })] },
  "1.1": { a: "#d9b76a", b: "#fff0c2", fog: "rgba(232,208,150,.3)", emitters: [e([dot("#e5c77c"), dot("#c9a557")], "drift", 20, [1, 1.8], [30, 58], { sway: 5 })] },
  "1.0": { a: "#3f7fd9", b: "#b0e4ff", fog: "rgba(120,180,240,.3)", emitters: [e(runes, "rise", 9, [1.2, 2.1], [12, 22], { sway: 5 })] },
  Alpha: { a: "#7a5230", b: "#9c9c9c", fog: "rgba(170,150,125,.32)", emitters: [e([dot("#7a5230", 3), dot("#5e3e22"), dot("#8f8f8f", 3)], "burst", 18, [0.7, 1.2], [20, 42], { gravity: 90 })] },
  Beta: { a: "#4f9e49", b: "#c7b98a", fog: "rgba(160,190,130,.3)", emitters: [e([dot("#79c561"), dot("#c7b98a")], "float", 18, [0.8, 1.5], [6, 14])] },
  Snapshot: { a: "#39d15b", b: "#ffe45a", fog: "rgba(120,235,130,.3)", emitters: [e([plus("#ffe45a"), plus("#ffffff")], "burst", 20, [0.6, 1.1], [26, 56], { gravity: 18 })] },
};

const FALLBACK: VersionEffect = {
  a: "#ff2a3d",
  b: "#ffb0b8",
  fog: "rgba(255,120,130,.28)",
  emitters: [e([plus("#ff8a93"), dot("#ffffff")], "float", 12, [0.7, 1.4], [8, 16])],
};

export const versionFamily = (id: string): string => (/^\d/.test(id) ? id.split(".").slice(0, id.startsWith("1.") ? 2 : 1).join(".") : id);

export const versionEffect = (id: string): VersionEffect => EFFECTS[versionFamily(id)] ?? FALLBACK;
