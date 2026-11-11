// Kaynak metinler Türkçedir ve anahtar olarak kullanılır. Çeviriler keys.json ile aynı
// sırada tutulan dizilerdir; `npm run i18n` eksik ya da fazla çeviriyi derlemeden önce yakalar.
import keys from "./keys.json";
import en from "./locales/en.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";
import fr from "./locales/fr.json";
import it from "./locales/it.json";
import pl from "./locales/pl.json";
import hi from "./locales/hi.json";
import ru from "./locales/ru.json";

export type Language =
  | "en"
  | "de"
  | "es"
  | "pt"
  | "fr"
  | "it"
  | "pl"
  | "hi"
  | "ru"
  | "tr";

/** Ekranda her dil kendi adıyla gösterilir. */
export const languages: { code: Language; name: string; english: string }[] = [
  { code: "en", name: "English", english: "English" },
  { code: "de", name: "Deutsch", english: "German" },
  { code: "es", name: "Español", english: "Spanish" },
  { code: "pt", name: "Português", english: "Portuguese" },
  { code: "fr", name: "Français", english: "French" },
  { code: "it", name: "Italiano", english: "Italian" },
  { code: "pl", name: "Polski", english: "Polish" },
  { code: "hi", name: "हिन्दी", english: "Hindi" },
  { code: "ru", name: "Русский", english: "Russian" },
  { code: "tr", name: "Türkçe", english: "Turkish" },
];

const tables: Partial<Record<Language, Map<string, string>>> = {};
const sources: Record<Exclude<Language, "tr">, string[]> = {
  en,
  de,
  es,
  pt,
  fr,
  it,
  pl,
  hi,
  ru,
};
function table(language: Language) {
  if (language === "tr") return undefined;
  return (tables[language] ??= new Map(
    keys.map((key, i) => [key, sources[language][i] ?? key]),
  ));
}

export const isLanguage = (v: unknown): v is Language =>
  languages.some((l) => l.code === v);

/** İlk açılışta önerilen dil: sistem dili destekleniyorsa o, değilse İngilizce. */
export function detectLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag?.slice(0, 2).toLowerCase();
    if (isLanguage(code)) return code;
  }
  return "en";
}

let current: Language = "tr";
export const getLanguage = () => current;
export function setLanguage(language: Language) {
  current = language;
  document.documentElement.lang = language;
}

/** Sonradan t() ile çevrilecek sabit metinleri işaretler (anahtar çıkarımı için). */
export const msg = <T extends string>(source: T) => source;

/** Metni geçerli dile çevirir; {ad} yer tutucularını verilen değerlerle doldurur. */
export function t(
  source: string,
  values?: Record<string, string | number>,
): string {
  const text = table(current)?.get(source) ?? source;
  return values
    ? text.replace(/\{(\w+)\}/g, (all, name: string) =>
        name in values ? String(values[name]) : all,
      )
    : text;
}

/** Sayılar ve boyutlar için yerel biçim. */
export const locale = () => (current === "hi" ? "hi-IN" : current);
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(locale(), { maximumFractionDigits: unit > 1 ? 1 : 0 })} ${units[unit]}`;
}
