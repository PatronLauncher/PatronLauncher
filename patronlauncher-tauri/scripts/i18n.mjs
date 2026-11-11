// t("…"), tr("…") ve msg("…") çağrılarındaki Türkçe kaynak metinleri toplar.
// Varsayılan: keys.json ve her dil dosyası güncel değilse hata verir (derleme öncesi).
// --write: keys.json'u yeniden üretir; mevcut çevirileri anahtarına göre korur.
import ts from "typescript";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = join(root, "i18n");
const languages = ["en", "de", "es", "pt", "fr", "it", "pl", "hi", "ru"];
const files = [];
(function walk(d) {
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) files.push(p);
  }
})(root);
const keys = [],
  seen = new Set(),
  problems = [];
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["t", "tr", "msg"].includes(node.expression.text) &&
      node.arguments.length
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        if (!seen.has(arg.text)) {
          seen.add(arg.text);
          keys.push(arg.text);
        }
      } else if (node.expression.text === "msg") {
        problems.push(`${relative(root, file)}: msg() yalnızca sabit metin alır`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const read = (name, fallback) => {
  try {
    return JSON.parse(readFileSync(join(dir, name), "utf8"));
  } catch {
    return fallback;
  }
};
const oldKeys = read("keys.json", []);
if (process.argv.includes("--write")) {
  writeFileSync(join(dir, "keys.json"), JSON.stringify(keys, null, 1) + "\n");
  for (const lang of languages) {
    const old = read(`locales/${lang}.json`, []);
    const byKey = new Map(oldKeys.map((k, i) => [k, old[i]]));
    const next = keys.map((k) => byKey.get(k) ?? null);
    writeFileSync(join(dir, `locales/${lang}.json`), JSON.stringify(next, null, 1) + "\n");
    const missing = next.filter((v) => v === null).length;
    if (missing) console.log(`${lang}: ${missing} çeviri eksik`);
  }
  console.log(`${keys.length} anahtar yazıldı.`);
} else {
  if (JSON.stringify(oldKeys) !== JSON.stringify(keys))
    problems.push("keys.json güncel değil: `node scripts/i18n.mjs --write` çalıştırın.");
  for (const lang of languages) {
    const list = read(`locales/${lang}.json`, []);
    if (list.length !== keys.length) problems.push(`${lang}: ${list.length}/${keys.length} satır`);
    list.forEach((v, i) => {
      if (typeof v !== "string" || !v.trim()) problems.push(`${lang}: çeviri eksik → ${keys[i]}`);
      const need = keys[i]?.match(/\{\w+\}/g) ?? [];
      for (const p of need)
        if (typeof v === "string" && !v.includes(p))
          problems.push(`${lang}: ${p} yer tutucusu eksik → ${keys[i]}`);
    });
  }
  if (problems.length) {
    console.error(problems.slice(0, 40).join("\n"));
    process.exit(1);
  }
  console.log(`Çeviriler tamam: ${keys.length} anahtar × ${languages.length + 1} dil.`);
}
