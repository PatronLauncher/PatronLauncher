// @ts-expect-error -- projede Node türleri yok; bu dosya yalnızca Vite (Node) altında çalışır.
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Sürümler tek yerden okunur: launcher package.json'dan, PClient pclient-fabric/gradle.properties'ten.
const appVersion: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const pclientVersion =
  /^version=(.+)$/m.exec(readFileSync(new URL("../pclient-fabric/gradle.properties", import.meta.url), "utf8"))?.[1].trim() ?? "?";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", assetsInlineLimit: 0 },
  define: { __APP_VERSION__: JSON.stringify(appVersion), __PCLIENT_VERSION__: JSON.stringify(pclientVersion) },
});
