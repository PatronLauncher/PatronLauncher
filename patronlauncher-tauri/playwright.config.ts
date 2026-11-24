import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  // İlk sayfa Vite soğuk derlemesini bekler (arayüz büyüdükçe 30 sn sınırına yaklaştı).
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
});
