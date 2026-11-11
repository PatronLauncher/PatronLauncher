import type { Language } from "../i18n";
// Windows bayrak emojilerini harf olarak gösterdiği için sade SVG bayraklar kullanılır.
const stripes = (colors: string[], vertical = false) =>
  colors.map((c, i) =>
    vertical ? (
      <rect key={i} x={(i * 30) / colors.length} y="0" width={30 / colors.length} height="20" fill={c} />
    ) : (
      <rect key={i} x="0" y={(i * 20) / colors.length} width="30" height={20 / colors.length} fill={c} />
    ),
  );
const shapes: Record<Language, React.ReactNode> = {
  en: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.6" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.4" />
    </>
  ),
  de: stripes(["#000", "#dd0000", "#ffce00"]),
  es: (
    <>
      {stripes(["#aa151b", "#f1bf00", "#f1bf00", "#aa151b"])}
    </>
  ),
  pt: (
    <>
      <rect width="12" height="20" fill="#046a38" />
      <rect x="12" width="18" height="20" fill="#da291c" />
      <circle cx="12" cy="10" r="4" fill="#ffe900" stroke="#046a38" strokeWidth=".8" />
    </>
  ),
  fr: stripes(["#0055a4", "#fff", "#ef4135"], true),
  it: stripes(["#009246", "#fff", "#ce2b37"], true),
  pl: stripes(["#fff", "#dc143c"]),
  hi: (
    <>
      {stripes(["#ff9933", "#fff", "#138808"])}
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth=".8" />
    </>
  ),
  ru: stripes(["#fff", "#0039a6", "#d52b1e"]),
  tr: (
    <>
      <rect width="30" height="20" fill="#e30a17" />
      <circle cx="11" cy="10" r="5" fill="#fff" />
      <circle cx="12.3" cy="10" r="4" fill="#e30a17" />
      <path d="m17.2 10 3.9-1.3-2.4 3.3V8l2.4 3.3z" fill="#fff" />
    </>
  ),
};
/** Sunucu listesindeki ülkeler (ISO kodu, küçük harf). */
const countries: Record<string, React.ReactNode> = {
  tr: shapes.tr,
  gb: shapes.en,
  de: shapes.de,
  es: shapes.es,
  fr: shapes.fr,
  it: shapes.it,
  pl: shapes.pl,
  in: shapes.hi,
  ru: shapes.ru,
  pt: shapes.pt,
  us: (
    <>
      {stripes(["#b22234", "#fff", "#b22234", "#fff", "#b22234", "#fff", "#b22234"])}
      <rect width="13" height="10.8" fill="#3c3b6e" />
      <path d="M2.5 2.5h.01M6.5 2.5h.01M10.5 2.5h.01M4.5 5.4h.01M8.5 5.4h.01M2.5 8.3h.01M6.5 8.3h.01M10.5 8.3h.01" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  nl: stripes(["#ae1c28", "#fff", "#21468b"]),
  id: stripes(["#ce1126", "#fff"]),
  br: (
    <>
      <rect width="30" height="20" fill="#009c3b" />
      <path d="M15 2.5 27 10 15 17.5 3 10z" fill="#ffdf00" />
      <circle cx="15" cy="10" r="4.2" fill="#002776" />
    </>
  ),
  cl: (
    <>
      {stripes(["#fff", "#d52b1e"])}
      <rect width="10" height="10" fill="#0039a6" />
      <path d="m5 2.6.9 2.6h2.7L6.4 6.8l.8 2.6L5 7.8 2.8 9.4l.8-2.6-2.2-1.6h2.7z" fill="#fff" />
    </>
  ),
};
export function CountryFlag({ code }: { code: string }) {
  const shape = countries[code];
  if (!shape) return <span className="flag flag-globe" aria-hidden="true">🌐</span>;
  return (
    <svg className="flag" viewBox="0 0 30 20" aria-hidden="true">
      {shape}
    </svg>
  );
}
export default function Flag({ code }: { code: Language }) {
  return (
    <svg className="flag" viewBox="0 0 30 20" aria-hidden="true">
      {shapes[code]}
    </svg>
  );
}
