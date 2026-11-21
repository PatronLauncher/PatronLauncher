import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function setup(page: Page, empty = false, language: string | null = "tr", music = false) {
  await page.addInitScript(
    ({ empty, language, music }) => {
      // Mevcut testler Türkçe kaynak metinleri kullanır; ilk açılış dil ekranı atlanır.
      const saved = JSON.parse(localStorage.getItem("patron-appearance") ?? "null");
      if (language && !saved?.language)
        localStorage.setItem(
          "patron-appearance",
          JSON.stringify({
            ...(saved ?? { skin: "patron", particles: true, animations: true, splash: true }),
            language,
            // Müzik çalar diğer testlerde sağ üstteki öğelerin üstünü örtmesin.
            ...(saved?.music ? {} : { music: { widget: music, autoplay: false } }),
          }),
        );
      const w = window as any,
        callbacks = new Map<number, Function>(),
        handlers = new Map<string, number>();
      let id = 0;
      const state: any = {
        accounts: empty
          ? []
          : [
              { id: "a", name: "OldPlayer", uuid: "a", kind: "Local" },
              { id: "b", name: "OtherPlayer", uuid: "b", kind: "Microsoft" },
            ],
        profiles: empty
          ? []
          : [{ id: "p", name: "OldWorld", version: "1.21.11" }],
        selected_account: empty ? null : "a",
        selected_profile: empty ? null : "p",
        settings: {
          memory_mb: 8192,
          java_path: "",
          microsoft_client_id: "",
          discord_client_id: "",
        },
        versions: [{ id: "1.21.11", url: "", sha1: "", type: "release" }],
        selected_version: "1.21.11",
        status: "Hazır.",
        busy: false,
        running: false,
        load_failed: false,
        java_status: { kind: "ready", major: 21, path: "java" },
        news_loading: false,
        news_error: false,
      };
      w.commands = [];
      w.isTauri = true;
      w.emit = (event: string, payload: any) =>
        callbacks.get(handlers.get(event)!)?.({ event, id: 1, payload });
      w.setState = (patch: any) => {
        Object.assign(state, patch);
        w.emit("patronlauncher://state", structuredClone(state));
      };
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: (fn: Function) => {
          callbacks.set(++id, fn);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args: any = {}) => {
          w.commands.push({ command, args });
          if (command === "plugin:event|listen") {
            handlers.set(args.event, args.handler);
            return id;
          }
          if (command.startsWith("plugin:")) return;
          if (command === "list_installed_versions")
            return w.installedVersions ?? [];
          if (command === "select_quick") {
            const v = (w.installedVersions ?? []).find(
              (v: any) => v.quick_id === args.id,
            );
            state.quick_profile = {
              id: args.id,
              name: "Minecraft " + (v?.mc ?? "1.21.11"),
              version: v?.mc ?? "1.21.11",
              loader: v?.loader ?? "Vanilla",
              loader_version: v?.loader_version,
              kind: "Quick",
            };
            state.selected_profile = args.id;
          }
          if (command === "install_version") {
            state.busy = true;
            w.finishVersion = () => {
              w.installedVersions = [
                ...(w.installedVersions ?? []),
                {
                  mc: args.mc,
                  loader: args.loader,
                  loader_version: args.loaderVersion,
                  quick_id: "quick",
                },
              ];
              w.setState({ busy: false });
              w.emit("patronlauncher://core-event", {
                sequence: 20,
                event: { kind: "finished", result: { Ok: null } },
                progress: null,
              });
            };
            if (!w.holdVersion) setTimeout(() => w.finishVersion(), 100);
          }
          if (command === "pclient_versions" && w.pclientReleases) return w.pclientReleases;
          if (command === "pclient_performance_notice") return false;
          if (command === "pclient_performance_hide") { w.commands.push({ command, args }); return null; }
          if (command === "pclient_performance") {
            w.commands.push({ command, args });
            w.pclientReleases = w.pclientReleases.map((r: any) => (r.minecraft === args.version ? { ...r, performance: args.install ? "installed" : "declined" } : r));
            return w.pclientReleases;
          }
          if (command === "servers_list")
            return {
              source: "bundled",
              servers: [
                { id: "alpha", name: "Alpha SMP", address: "play.alpha.test", port: null, country: "tr", languages: ["tr"], tags: ["SMP", "Survival"], description: { tr: "Test sunucusu" }, versions: "26.3", website: null, discord: null, sponsored: true, featured: false },
                { id: "beta", name: "Beta PvP", address: "mc.beta.test", port: 25570, country: "de", languages: ["en"], tags: ["PvP"], description: { en: "Test server" }, versions: "1.8–26.x", website: null, discord: null, sponsored: false, featured: false },
              ],
            };
          if (command === "servers_votes") return w.votes ?? {};
          if (command === "server_vote" || command === "server_rate" || command === "server_favorite") {
            w.commands.push({ command, args });
            const old = (w.votes ??= {})[args.id] ?? { votes: 0, last_vote: 0, rating: null, favorite: false };
            const next = { ...old };
            if (command === "server_vote") Object.assign(next, { votes: old.votes + 1, last_vote: Math.floor(Date.now() / 1000) });
            if (command === "server_rate") next.rating = args.stars || null;
            if (command === "server_favorite") next.favorite = args.favorite;
            return (w.votes[args.id] = next);
          }
          if (command === "server_ping")
            return args.id === "alpha"
              ? { online: true, players: 1234, max_players: 5000, version: "26.3", motd: "Hoş geldin", favicon: null, latency_ms: 31 }
              : { online: false, players: null, max_players: null, version: null, motd: null, favicon: null, latency_ms: null };
          if (command === "system_memory")
            return { total_mb: 16384, available_mb: 9000 };
          if (command === "storage_usage")
            return {
              total: 3 * 1024 ** 3,
              categories: [
                { key: "profiles", bytes: 1024 ** 3 },
                { key: "assets", bytes: 1024 ** 3 },
                { key: "other", bytes: 1024 ** 3 },
              ],
              profiles: state.profiles.map((p: any) => ({
                id: p.id,
                name: p.name,
                bytes: 1024 ** 3,
                folders: [{ key: "saves", bytes: 512 * 1024 ** 2 }],
              })),
            };
          if (command === "profile_statuses")
            return (
              w.profileStatuses ??
              Object.fromEntries(
                state.profiles.map((p: any) => [p.id, "not_installed"]),
              )
            );
          if (command === "rename_profile")
            state.profiles.find((p: any) => p.id === args.id).name =
              args.name.trim();
          if (command === "copy_profile") {
            const source = state.profiles.find((p: any) => p.id === args.id);
            const id = "copy-" + state.profiles.length;
            state.profiles.push({ ...source, id, name: args.name });
            state.selected_profile = id;
          }
          if (command === "profile_action") {
            state.selected_profile = args.id;
            if (args.operation === "play") {
              state.busy = true;
              state.status = "Hazırlanıyor";
            }
          }
          if (command === "list_loader_versions")
            return (
              w.loaderOptions ?? {
                versions: [
                  { version: "0.20.1", stable: true },
                  { version: "0.19.0", stable: false },
                ],
                default_version: "0.20.1",
              }
            );
          if (command === "preview_performance_pack")
            return {
              plan_id: "plan-1",
              minecraft_version: args.minecraftVersion,
              total_size: 100,
              mods: [
                {
                  project_id: "sodium",
                  title: "Sodium",
                  version_id: "s1",
                  version: "1.0",
                  filename: "sodium.jar",
                  size: 60,
                  dependency: false,
                },
                {
                  project_id: "api",
                  title: "Fabric API",
                  version_id: "a1",
                  version: "1.0",
                  filename: "api.jar",
                  size: 40,
                  dependency: true,
                },
              ],
              warnings: [],
            };
          if (command === "create_configured_profile") {
            if (w.holdInstall) {
              w.setState({ busy: true, status: "Modlar hazırlanıyor…" });
              await new Promise<void>((resolve) => {
                w.completeInstall = resolve;
              });
              state.busy = false;
            }
            state.profiles.push({
              id: "configured-" + state.profiles.length,
              name: args.name,
              version: args.versionId,
              loader: args.loader,
              loader_version: args.loaderVersion,
            });
            state.selected_profile = state.profiles.at(-1).id;
          }
          if (command === "list_version_catalog")
            return (
              w.catalog ??
              state.versions.map((v: any) => ({
                ...v,
                releaseTime: "2025-01-01",
                installed: false,
              }))
            );
          if (command === "select_account") state.selected_account = args.id;
          if (command === "select_profile") {
            state.selected_profile = args.id;
            state.quick_profile = null;
          }
          if (
            command === "create_profile" ||
            command === "create_wizard_profile"
          ) {
            state.profiles.push({
              id: "new-profile-" + state.profiles.length,
              name: args.name.trim(),
              version: args.versionId,
              kind: "Custom",
              loader: args.loader ?? "Vanilla",
              loader_version: args.loaderVersion,
              appearance: args.appearance,
            });
            state.selected_profile = state.profiles.at(-1).id;
          }
          if (command === "remove_profile") {
            state.profiles = state.profiles.filter(
              (p: any) => p.id !== args.id,
            );
            state.selected_profile = state.profiles[0]?.id ?? null;
          }
          if (command === "remove_account") {
            state.accounts = state.accounts.filter(
              (a: any) => a.id !== args.id,
            );
            state.selected_account = state.accounts[0]?.id ?? null;
          }
          if (command === "launch_game") {
            state.busy = true;
            state.status = "Hazırlanıyor";
          }
          if (command === "cancel_operation") {
            state.busy = false;
            state.status = "İptal edildi.";
          }
          if (command === "add_local_account") {
            state.accounts.push({
              id: "c",
              name: args.name,
              uuid: "c",
              kind: "Local",
            });
            state.selected_account = "c";
          }
          return {
            state: structuredClone(state),
            news:
              command === "get_news"
                ? [
                    {
                      title: "News contract",
                      date: "2026-11-01",
                      url: "https://www.minecraft.net/en-us/article/test",
                      image: null,
                    },
                  ]
                : null,
          };
        },
      };
    },
    { empty, language, music },
  );
  await page.goto("/");
  await expect(page.locator("#st")).toHaveText("Hazır.");
}
test("reference-inspired themes centralize colors and respect reduced motion", () => {
 const css=readFileSync("src/styles/variables.css","utf8");
 for(const key of ["bg","side","panel","panel2","line","text","muted","brand","brand2"])expect(css).toContain(`--${key}:`);
 const themes=readFileSync("src/styles/themes.css","utf8");
 for(const skin of ["mavi","orman","mor","amoled"])expect(themes).toContain(`data-skin="${skin}"`);
 expect(themes).toContain("prefers-reduced-motion");
});
test("saved records, header and news use core commands", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".hero h2")).toHaveText("OldWorld");
  await page.getByLabel("Hesap seç").click();
  await page.getByRole("option",{name:"OtherPlayer · Microsoft",exact:true}).click();
  await expect(page.locator(".hero")).toContainText("OtherPlayer");
  await page.getByTitle("Oyun klasörünü aç").click();
  await page.getByTitle("Yenile", { exact: true }).click();
  await page.getByRole("link").filter({ hasText: "News contract" }).click();
  const commands = await page.evaluate(() => (window as any).commands);
  expect(commands).toContainEqual({
    command: "select_account",
    args: { id: "b" },
  });
  expect(commands).toContainEqual({
    command: "open_folder",
    args: { target: "profile" },
  });
  expect(commands).toContainEqual({
    command: "list_versions",
    args: { refresh: true },
  });
  expect(commands).toContainEqual({
    command: "open_external",
    args: { url: "https://www.minecraft.net/en-us/article/test" },
  });
});
test("launch stages, progress, cancel and running follow core events", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#play").click();
  await expect(page.locator("#play")).toContainText("HAZIRLANIYOR");
  for (const [status, label] of [
    ["Oyun kaynakları: 5/10", "İNDİRİLİYOR"],
    ["Minecraft başlatılıyor…", "BAŞLATILIYOR"],
  ]) {
    await page.evaluate(
      (status) => (window as any).setState({ status }),
      status,
    );
    await expect(page.locator("#play")).toContainText(label);
    await expect(page.locator("#st")).toHaveText(status);
  }
  await page.evaluate(() =>
    (window as any).emit("patronlauncher://core-event", {
      sequence: 1,
      event: { kind: "status", result: "5/10" },
      progress: { current: 5, total: 10 },
    }),
  );
  await expect(page.locator("#pb")).toHaveAttribute("style", /50%/);
  await page.getByRole("button", { name: "İptal", exact: true }).click();
  await expect(page.locator("#play")).toContainText("OYUNA GİR");
  await page.evaluate(() =>
    (window as any).setState({ busy: true, running: true }),
  );
  await expect(page.locator("#play")).toContainText("OYUN ÇALIŞIYOR");
  await expect(
    page.getByRole("button", { name: "İptal", exact: true }),
  ).toHaveCount(0);
});
test("missing account and profile route to management", async ({ page }) => {
  await setup(page, true);
  await expect(
    page.locator(".top").getByRole("button", { name: "Hesap ekle" }),
  ).toBeVisible();
  await expect(page.locator("#play")).toContainText("HESAP EKLE");
  await page.locator("#play").click();
  await page.getByLabel("Oyuncu adı").fill("NewPlayer");
  await page.getByRole("button", { name: "Yerel hesap oluştur" }).click();
  await page.locator('[data-p="home"]').click();
  await expect(page.locator("#play")).toContainText("SÜRÜM SEÇ");
});
test("missing Java and news errors reflect backend state", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    w.emit("patronlauncher://core-event", {
      sequence: 1,
      event: { kind: "news", result: { Ok: [] } },
      progress: null,
    });
    w.setState({
      java_status: {
        kind: "missing",
        major: 21,
        reason: "Java 21 bulunamadı.",
      },
      news_error: true,
    });
  });
  await expect(
    page.getByRole("heading", { name: "Java yönetimi" }),
  ).toBeVisible();
  await expect(
    page.getByText("Haberlere şu anda ulaşılamıyor.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "PatronLauncher ile Java indir" })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).commands.some((c: any) => c.command === "install_java"),
    ),
  ).toBe(true);
});
test("files sidebar and cards stay within viewport", async ({ page }) => {
  await setup(page);
  await page.locator('[data-p="folder"]').click();
  for (const width of [1280, 900, 700]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator(".side")).toBeVisible();
    const bounds = await page.locator(".storage-folder").evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    );
    for (const b of bounds) {
      expect(b.left).toBeGreaterThan(0);
      expect(b.right).toBeLessThanOrEqual(width);
    }
  }
  await page.locator(".storage-folder").filter({ hasText: "Modlar" }).click();
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "open_folder",
    args: { target: "mods" },
  });
});
test("native window controls keep command routing", async ({ page }) => {
  await setup(page);
  await page.getByLabel("Küçült", { exact: true }).click();
  await page.getByLabel("Büyüt veya geri yükle").click();
  await page.getByLabel("Kapat", { exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).commands
        .filter((c: any) => c.command.startsWith("plugin:window"))
        .map((c: any) => c.command),
    ),
  ).toEqual([
    "plugin:window|minimize",
    "plugin:window|toggle_maximize",
    "plugin:window|close",
  ]);
});

test("profiles are management-only; creation modal validates and removal preserves warning", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-p="profiles"]').click();
  await expect(page.getByLabel("Profil adı", { exact: true })).toHaveCount(0);
  await page.locator(".profile-menu summary").click();
  await page.getByRole("button", { name: "Listeden kaldır", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Dünyalar silinmez");
  await page
    .getByRole("button", { name: "Listeden kaldır", exact: true })
    .click();
  await expect(page.locator(".profile-card")).toHaveCount(0);
});

test("profile protection routes to backups with explicit restore confirmation", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-p="profiles"]').click();
  await page.getByRole("button", { name: "Yedekler ve koruma" }).click();
  await expect(
    page.getByRole("heading", { name: "Profil koruması" }),
  ).toBeVisible();
  await expect(
    page.getByText("OldWorld profilinin ayarları ve yedekleri"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ayarları yedekle", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Yedek klasörü", exact: true })
    .click();
  await page.getByRole("button", { name: "Son yedeği geri yükle" }).click();
  await expect(
    page.getByText(
      "Mevcut ayarlar önce ayrıca yedeklenecek. Dünyalar değişmeyecek.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).commands.some(
        (c: any) => c.command === "restore_profile",
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Vazgeç" }).click();
  await page.getByRole("button", { name: "Son yedeği geri yükle" }).click();
  await page.getByRole("button", { name: "Geri yükle", exact: true }).click();
  expect(await page.evaluate(() => (window as any).commands)).toEqual(
    expect.arrayContaining([
      { command: "backup_profile", args: {} },
      { command: "open_folder", args: { target: "backups" } },
      { command: "restore_profile", args: { confirmed: true } },
    ]),
  );
});
test("accounts preserve warnings and reject invalid names before invoking", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-p="account"]').click();
  await expect(
    page.getByText("Parolan PatronLauncher'a girilmez."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Yerel hesaplar Microsoft doğrulaması isteyen sunuculara giriş sağlamaz.",
    ),
  ).toBeVisible();
  for (const name of ["ab", "a".repeat(17), "Oyuncu adı", "çagan"]) {
    await page.getByLabel("Oyuncu adı").fill(name);
    await page.getByRole("button", { name: "Yerel hesap oluştur" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Oyuncu adı 3–16 karakter olmalı; yalnızca harf, rakam ve alt çizgi kullanılabilir.",
    );
  }
  expect(
    await page.evaluate(() =>
      (window as any).commands.filter(
        (c: any) => c.command === "add_local_account",
      ),
    ),
  ).toEqual([]);
  await page.getByLabel("Oyuncu adı").fill("Valid_Player");
  await page.getByRole("button", { name: "Yerel hesap oluştur" }).click();
  await expect(page.locator(".pf.sel")).toContainText("Valid_Player");
  await page
    .locator(".pf")
    .filter({ hasText: "OtherPlayer" })
    .getByRole("button", { name: "Hesabı seç" })
    .click();
  await page.getByRole("button", { name: "Seçili hesabı kaldır" }).click();
  await expect(
    page.locator(".pf").filter({ hasText: "OtherPlayer" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "remove_account",
    args: { id: "b" },
  });
});
test("Microsoft device code is visible, uses fixed verified URL and can be cancelled", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-p="account"]').click();
  await page.getByRole("button", { name: "Microsoft ile giriş yap" }).click();
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "microsoft_login",
    args: {},
  });
  await page.evaluate(() =>
    (window as any).setState({
      busy: true,
      status: "Microsoft giriş kodu hazırlanıyor…",
    }),
  );
  await expect(
    page.getByRole("region", { name: "Microsoft cihaz girişi" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).setState({
      status:
        "Microsoft girişi: https://microsoft.com/devicelogin adresini açın. Kod: ABCD-1234",
    }),
  );
  await expect(page.getByLabel("Microsoft giriş kodu")).toHaveText("ABCD-1234");
  await expect(
    page.getByRole("button", { name: "Yerel hesap oluştur" }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "https://microsoft.com/devicelogin",
      exact: true,
    })
    .click();
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "open_external",
    args: { url: "https://microsoft.com/devicelogin" },
  });
  await page
    .getByRole("button", { name: "Microsoft girişini iptal et" })
    .click();
  await expect(page.getByLabel("Microsoft giriş kodu")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Microsoft ile giriş yap" }),
  ).toBeEnabled();
  await page.evaluate(() =>
    (window as any).setState({
      busy: true,
      status: "Microsoft girişi: https://evil.invalid/ adresini açın. Kod: BAD",
    }),
  );
  await expect(page.getByLabel("Microsoft giriş kodu")).toHaveCount(0);
});

test("versions families, filters, patch selection and real profile command", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).catalog = ["1.21.11", "1.6.4"].map((id) => ({
      id,
      type: "release",
      url: "",
      sha1: "",
      releaseTime: "2025-01-01",
      installed: false,
    }));
  });
  await page.locator('[data-p="versions"]').click();
  await expect(page.locator(".v-card")).toHaveCount(1);
  await page.getByLabel("Tüm sürümleri göster", { exact: true }).check();
  await expect(page.locator(".v-card")).toHaveCount(2);
  await page.getByLabel("Kurulu sürümler", { exact: true }).check();
  await expect(page.locator(".v-card")).toHaveCount(0);
});

test("version cards stay 3:4, 10+ fit and motion respects reduced-motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 830 });
  await setup(page);
  await page.evaluate(() => {
    (window as any).catalog = Array.from({ length: 22 }, (_, i) => ({
      id: `1.${i}`,
      type: "release",
      url: "",
      sha1: "",
      releaseTime: `20${String(i).padStart(2, "0")}-01-01`,
      installed: false,
    }));
  });
  await page.locator('[data-p="versions"]').click();
  await page.getByLabel("Tüm sürümleri göster", { exact: true }).check();
  await expect(page.locator(".v-card")).toHaveCount(22);
  const sizes = await page.locator(".v-poster").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { ratio: r.width / r.height, bottom: r.bottom, right: r.right };
    }),
  );
  for (const size of sizes) expect(size.ratio).toBeCloseTo(0.75, 2);
  expect(sizes.filter((s) => s.bottom <= 830).length).toBeGreaterThanOrEqual(
    10,
  );
  expect(
    await page
      .locator(".v-card")
      .first()
      .evaluate((n) => getComputedStyle(n).animationName),
  ).toBe("none");
  await page.screenshot({ path: "test-results/versions-desktop.png" });
  for (const width of [1000, 700]) {
    await page.setViewportSize({ width, height: 830 });
    await expect(page.locator(".side")).toBeVisible();
    expect(
      await page
        .locator(".v-grid")
        .evaluate(
          (n) => getComputedStyle(n).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(4);
    expect(
      await page
        .locator(".versions-page")
        .evaluate((n) => n.getBoundingClientRect().right),
    ).toBeLessThanOrEqual(width);
  }
});
test("catalog failure can retry and unsupported versions cannot create launch profiles", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).catalog = [
      {
        id: "1.12.2",
        type: "release",
        url: "",
        sha1: "",
        releaseTime: "2017-01-01",
      },
    ];
  });
  await page.locator('[data-p="versions"]').click();
  await expect(page.locator("#version-install")).toBeDisabled();
});

test("Fabric selection uses latest stable and creates a configured profile", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-p="versions"]').click();
  await page.getByRole("button", { name: "Fabric", exact: true }).click();
  await page.getByRole("button", { name: "Kur", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Kuruldu ✓", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "install_version",
    args: {
      mc: "1.21.11",
      loader: "Fabric",
      loaderVersion: "0.20.1",
      planId: null,
      confirmed: false,
    },
  });
});

test("performance pack requires visible approval and displays real event progress", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).holdVersion = true;
  });
  await page.locator('[data-p="versions"]').click();
  await page.getByRole("button", { name: "Fabric", exact: true }).click();
  await page.getByLabel("Sodium", { exact: true }).check();
  await page.getByRole("button", { name: "Kur", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Mod indirmesini onayla" });
  await expect(dialog).toContainText("Sodium");
  expect(
    await page.evaluate(() =>
      (window as any).commands.some(
        (c: any) => c.command === "install_version",
      ),
    ),
  ).toBe(false);
  await dialog
    .getByRole("button", { name: "Onayla ve kur", exact: true })
    .click();
  await page.evaluate(() =>
    (window as any).emit("patronlauncher://core-event", {
      sequence: 8,
      event: { kind: "status", result: "Modlar: 50 / 100" },
      progress: { current: 50, total: 100 },
    }),
  );
  await expect(page.getByLabel("Sürüm indirme ilerlemesi")).toHaveAttribute(
    "value",
    "0.5",
  );
  await expect(page.getByLabel("Kart kurulum ilerlemesi")).toHaveAttribute(
    "value",
    "0.5",
  );
  await expect(
    page.getByRole("button", { name: "Kurulumu iptal et", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => (window as any).finishVersion());
});

test("sidebar wizard, duplicate Fabric profiles and create-and-play share one flow", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-p="versions"]').click();
  await expect(page.getByLabel("Sürüm profil adı")).toHaveCount(0);
  await page.getByRole("button", { name: "Kur", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Kuruldu ✓", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Oyna", exact: true }).click();
  await expect(page.locator(".hero h2")).toContainText("Minecraft 1.21.11");
  expect(
    await page.evaluate(() =>
      (window as any).commands.some(
        (c: any) =>
          c.command === "launch_game" || c.command === "create_profile",
      ),
    ),
  ).toBe(false);
});

test("profile management routes rename copy install and keeps narrow layout in bounds", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    w.profileStatuses = { p: "update_available" };
    w.setState({
      profiles: [
        {
          id: "p",
          name: "Fabric World",
          version: "1.21.11",
          loader: "Fabric",
          loader_version: "0.20.1",
        },
      ],
    });
  });
  await page.locator('[data-p="profiles"]').click();
  await expect(page.locator(".profile-card")).toContainText("Fabric 0.20.1");
  await expect(page.locator(".profile-card")).toContainText("Güncelleme var");
  await page.locator(".profile-menu summary").click();
  await page.getByRole("button", { name: "Güncelle", exact: true }).click();
  await page.locator(".profile-menu summary").click();
  await page
    .getByRole("button", { name: "Yeniden adlandır", exact: true })
    .click();
  await page.getByLabel("Profil adı", { exact: true }).fill("Renamed");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.locator(".profile-card h4")).toHaveText("Renamed");
  await page.locator(".profile-menu summary").click();
  await page.getByRole("button", { name: "Kopyala", exact: true }).click();
  await page.getByLabel("Profil adı", { exact: true }).fill("Copy");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Kopyala", exact: true })
    .click();
  await expect(page.locator(".profile-card")).toHaveCount(2);
  await expect(page.locator(".profile-card.sel")).toContainText("Copy");
  for (const width of [1280, 800, 600]) {
    await page.setViewportSize({ width, height: 830 });
    const bounds = await page
      .locator(".profile-card")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().right),
      );
    expect(bounds.every((right) => right <= width)).toBe(true);
    await expect(page.locator(".side")).toBeVisible();
  }
  await page.screenshot({ path: "test-results/profiles-narrow.png" });
  expect(await page.evaluate(() => (window as any).commands)).toEqual(
    expect.arrayContaining([
      { command: "install_profile", args: { id: "p" } },
      { command: "rename_profile", args: { id: "p", name: "Renamed" } },
      { command: "copy_profile", args: { id: "p", name: "Copy" } },
    ]),
  );
});
test("unsupported loader is explained and every loader can be chosen in one click", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(
    () =>
      ((window as any).loaderOptions = { versions: [], default_version: null }),
  );
  await page.locator('[data-p="versions"]').click();
  await page.getByRole("button", { name: "Fabric", exact: true }).click();
  await expect(
    page.getByText("Fabric bu Minecraft sürümünü desteklemiyor.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("#version-install")).toBeDisabled();
  await expect(page.getByLabel("Sodium", { exact: true })).toHaveCount(0);
  for (const name of ["Quilt", "NeoForge", "Forge", "OptiFine"]) {
    await page.locator(".loader-tile").filter({ hasText: name }).first().click();
    await expect(page.locator(".loader-tile").filter({ hasText: name }).first()).toHaveAttribute("aria-pressed", "true");
  }
  expect(
    await page.evaluate(() =>
      (window as any).commands.some((c: any) => c.command === "list_loader_versions" && c.args.loader === "NeoForge"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      (window as any).commands.some(
        (c: any) =>
          c.command === "preview_performance_pack" ||
          c.command === "create_configured_profile",
      ),
    ),
  ).toBe(false);
});

test("home separates Quick and Custom modes and preserves account and arrow routing", async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByRole("button", { name: "Profil", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Oyun profili", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("Minecraft sürümü", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as any;
    w.installedVersions = [
      {
        mc: "1.21.11",
        loader: "Fabric",
        loader_version: "0.20.1",
        quick_id: "quick",
      },
    ];
  });
  await page.locator('[data-p="profiles"]').click();
  await page.locator('[data-p="home"]').click();
  await page.getByRole("button", { name: "Hızlı oyun", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Hızlı oyun", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".home-play-detail")).toContainText(
    "Fabric 0.20.1",
  );
  await expect(page.locator(".cur")).toContainText("SEÇİLİ OYUN");
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  await expect(page.locator(".home-profile")).toContainText("OldWorld");
  await expect(page.locator(".home-play-detail")).toContainText("Vanilla");
  await expect(page.locator(".home-pclient")).toBeEnabled();
  await page.getByLabel("Oyun hesabı", { exact: true }).click();
  await page.getByRole("option",{name:"OtherPlayer · Microsoft",exact:true}).click();
  await page.getByRole("button", { name: "Sürümleri aç", exact: true }).click();
  await expect(page.locator(".versions-page")).toBeVisible();
});
test("empty quick mode offers latest stable install without creating a Custom profile", async ({
  page,
}) => {
  await setup(page, true);
  await page
    .getByRole("button", { name: "Minecraft 1.21.11 kur", exact: true })
    .click();
  await expect(page.locator(".home-play-detail")).toContainText(
    "Minecraft 1.21.11",
  );
  expect(
    await page.evaluate(() =>
      (window as any).commands.some((c: any) => c.command === "create_profile"),
    ),
  ).toBe(false);
  await page.screenshot({ path: "test-results/home-quick.png" });
});

test("profile wizard is the single creation flow and persists optional artwork", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    (window as any).setState({
      profiles: [
        { id: "p", name: "OldWorld", version: "1.21.11" },
        { id: "q", name: "Hidden quick", version: "1.21.11", kind: "Quick" },
      ],
    }),
  );
  await page.locator(".sidebar-create").click();
  await expect(page.locator('[data-p="profiles"]')).toHaveClass(
    /active|sel|on/,
  );
  await expect(page.locator(".profile-card")).toHaveCount(1);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Yakında", { exact: true })).toHaveCount(3);
  await dialog.getByRole("button", { name: /Sıfırdan oluştur/ }).click();
  await expect(dialog.getByLabel("Ayrı klasör")).toBeChecked();
  await dialog.getByRole("button", { name: "Devam", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Profil adı *").fill("Özel dünyam");
  await dialog.getByLabel(/Açıklama/).fill("Kalıcı açıklamam");
  await dialog.getByRole("button", { name: "Devam", exact: true }).click();
  await dialog.getByRole("button", { name: /^Fabric/ }).click();
  await dialog.getByRole("button", { name: "Devam", exact: true }).click();
  const png = readFileSync(new URL("../src-tauri/icons/icon.png", import.meta.url));
  await dialog
    .getByLabel("Profil simgesi")
    .setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: png });
  await expect(dialog.getByAltText("Simge önizlemesi")).toBeVisible();
  await dialog.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".profile-card").filter({ hasText: "Özel dünyam" }),
  ).toContainText("Kalıcı açıklamam");
  const args = await page.evaluate(
    () =>
      (window as any).commands.find(
        (c: any) => c.command === "create_wizard_profile",
      ).args,
  );
  expect(args.loader).toBe("Fabric");
  expect(args.appearance.icon).toMatch(/^data:image\/png;base64,/);
  expect(args.appearance.description).toBe("Kalıcı açıklamam");
  await page
    .locator(".profile-card")
    .filter({ hasText: "Özel dünyam" })
    .locator("summary")
    .click();
  await expect(
    page.getByRole("button", { name: "İndir", exact: true }),
  ).toBeVisible();
  for (const width of [1280, 800, 600]) {
    await page.setViewportSize({ width, height: 830 });
    expect(
      await page
        .locator(".profile-card")
        .evaluateAll((nodes) =>
          nodes.every((n) => n.getBoundingClientRect().right <= innerWidth),
        ),
    ).toBe(true);
  }
  await page.screenshot({ path: "test-results/profile-wizard-cards.png" });
});

test('mods discovery sanitizes remote content and installs only after explicit consent',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{
 const w=window as any;
 w.setState({profiles:[{id:'p',name:'Fabric alanı',version:'1.21.11',loader:'Fabric'},{id:'v',name:'Vanilla alanı',version:'1.21.11',loader:'Vanilla'}]});
 const original=w.__TAURI_INTERNALS__.invoke;let installed=false;
 const hit={project_id:'mod1',title:'Örnek mod',description:'Küçük test modu',downloads:1200,date_modified:'2026-11-03',author:'Creator',categories:['utility'],versions:['1.21.11']};
 w.__TAURI_INTERNALS__.invoke=async(command:string,args:any={})=>{
 if(!command.startsWith('mods_'))return original(command,args);
 w.commands.push({command,args});
 if(command==='mods_search')return {hits:[hit],total_hits:1};
 if(command==='mods_list')return {managed:installed?[{project_id:'mod1',version_id:'v1',filename:'mod.jar',user_selected:true}]:[],external:[]};
 if(command==='mods_project')return {project:{body:'<script>window.pwned=true</script><iframe src="https://evil.test"></iframe><img src=x onerror="window.pwned=true"><a href="javascript:alert(1)">zararlı</a><p>Güvenli açıklama</p>\n\n[Kaynak](https://github.com/example/project)',gallery:[],loaders:['fabric'],game_versions:['1.21.11']},creators:[{user:{username:'Creator'}}],versions:[{id:'v1',version_number:'1.0',game_versions:['1.21.11'],loaders:['fabric'],changelog:'test'}]};
 if(command==='mods_versions')return {recommended:'v1',compatible:[{id:'v1',version_number:'1.0'}],incompatible:[]};
 if(command==='mods_plan')return {id:'plan1',profile:'p',mc:'1.21.11',entries:[{project_id:'mod1',filename:'mod.jar',user_selected:true},{project_id:'api',filename:'fabric-api.jar',user_selected:false}],installed:[],warnings:['Harici modlar korunur.'],total_bytes:100};
 if(command==='mods_install'){
 installed=true;setTimeout(()=>w.emit('patronlauncher://core-event',{sequence:30,event:{kind:'finished',result:{Ok:null}},progress:null}),80);
 return original('get_state');
 }
 if(command==='mods_removal_plan')return [{project_id:'mod1',filename:'mod.jar'},{project_id:'api',filename:'fabric-api.jar'}];
 if(command==='mods_remove'){installed=false;setTimeout(()=>w.emit('patronlauncher://core-event',{sequence:31,event:{kind:'finished',result:{Ok:null}},progress:null}),80);return original('get_state');}
 return {};
 };
 });
 await page.locator('[data-p="mods"]').click();
 await expect(page.locator('.mod-sources .source-modrinth')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.mod-card')).toContainText('Örnek mod');
 await page.getByRole('button',{name:'Görüntüle',exact:true}).click();
 await expect(page.locator('.mod-content')).toContainText('Güvenli açıklama');
 await expect(page.locator('.mod-content iframe,.mod-content script,.mod-content img')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).pwned)).toBeUndefined();
 await page.getByRole('button',{name:'Kaynak ↗',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('sistem tarayıcında');
 expect(await page.evaluate(()=>(window as any).commands.filter((c:any)=>c.command==='open_external').length)).toBe(0);
 await page.getByRole('button',{name:'Pencereyi kapat'}).click();
 await page.getByRole('button',{name:'Kur',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('button',{name:/Vanilla alanı/})).toBeDisabled();
 await page.getByRole('button',{name:'Sürüm seç →'}).click();
 await expect(page.getByLabel('Mod sürümü')).toContainText('Önerilen');
 await page.getByRole('button',{name:'Bağımlılıkları incele →'}).click();
 await expect(page.getByRole('dialog')).toContainText('fabric-api.jar');
 await page.getByRole('button',{name:'Onaya geç →'}).click();
 await expect(page.getByRole('button',{name:'Onayla ve kur'})).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).commands.filter((c:any)=>c.command==='mods_install').length)).toBe(0);
 await page.getByLabel('Anladım, devam et').check();
 await page.getByRole('button',{name:'Onayla ve kur'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Kurulu ✓'})).toBeVisible();
 await page.screenshot({path:'test-results/mods-detail-safe.png'});
 expect(await page.evaluate(()=>(window as any).commands.find((c:any)=>c.command==='mods_plan').args.versionId)).toBe('v1');
 await page.getByLabel('Mod işlemleri').click();
 await page.getByRole('button',{name:'Kaldır',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('fabric-api.jar');
 expect(await page.evaluate(()=>(window as any).commands.filter((c:any)=>c.command==='mods_remove').length)).toBe(0);
 await page.getByLabel('Bu bağımlılıkları da kaldır').check();
 await page.getByRole('button',{name:'Kaldırmayı onayla'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Kur',exact:true})).toBeVisible();

});

test('mods search debounces typing and displays recoverable network and empty states',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{
 const w=window as any,original=w.__TAURI_INTERNALS__.invoke;w.searchCalls=[];
 w.__TAURI_INTERNALS__.invoke=async(command:string,args:any={})=>{if(command==='mods_search'){if(args.search.limit===1)return {hits:[],total_hits:0};w.searchCalls.push(args.search);if(!args.search.query)throw 'Modrinth bağlantısı kurulamadı';return {hits:[],total_hits:0};}return original(command,args);};
 });
 await page.locator('[data-p="mods"]').click();
 await expect(page.getByRole('alert')).toContainText('Modrinth bağlantısı');
 await page.getByRole('button',{name:'Tekrar dene'}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).searchCalls.length)).toBe(2);
 await page.getByLabel('Mod ara',{exact:true}).fill('sodium');
 await expect(page.getByText('Bu filtrelerle mod bulunamadı.')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).searchCalls.at(-1).query)).toBe('sodium');
 for(const width of [1280,800,600]){await page.setViewportSize({width,height:830});expect(await page.locator('.mod-filters').evaluate(n=>n.getBoundingClientRect().right<=innerWidth)).toBe(true);}
});

test('appearance drawer persists five skins and captures each theme',async({page})=>{
 await setup(page);
 for(const [skin,label] of [['patron','Patron Kırmızı'],['mavi','Gece Mavisi'],['orman','Orman'],['mor','Neon Mor'],['amoled','AMOLED']]){
  await page.getByRole('button',{name:'Görünüm',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:label,exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin',skin);
  await page.getByRole('button',{name:'Pencereyi kapat'}).click();
  await page.screenshot({path:`test-results/skin-${skin}.png`});
 }
 await page.getByRole('button',{name:'Görünüm',exact:true}).click();
 await page.getByRole('switch',{name:'Animasyonlar',exact:true}).uncheck();
 await page.getByRole('switch',{name:'Arka plan parçacıkları',exact:true}).uncheck();
 await page.getByRole('switch',{name:'Açılış animasyonu',exact:true}).uncheck();
 await page.getByRole('button',{name:'Açılışı önizle'}).click();
 await expect(page.locator('.startup-overlay')).toBeVisible();
 await expect(page.locator('.startup-overlay')).toHaveCount(0,{timeout:1800});
 await page.getByRole('button',{name:'Pencereyi kapat'}).click();
 await page.reload();await expect(page.locator('#st')).toHaveText('Hazır.');
 await expect(page.locator('html')).toHaveAttribute('data-skin','amoled');
 await expect(page.locator('html')).toHaveAttribute('data-motion','off');
 await page.locator('[data-p="mods"]').hover();
 expect(await page.locator('[data-p="mods"] .nav-tile').evaluate(n=>getComputedStyle(n).transitionDuration)).toBe('0s');
 expect(await page.evaluate(()=>(window as any).commands.some((c:any)=>c.command==='save_appearance'))).toBe(false); // Reload has no writes until the user changes a preference.
});

test('particle drawing stops on blur and while the game is running',async({page})=>{
 await setup(page);await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{const w=window as any;w.particleFills=0;const original=CanvasRenderingContext2D.prototype.fill;CanvasRenderingContext2D.prototype.fill=function(...args:any[]){w.particleFills++;return original.apply(this,args as any);};window.dispatchEvent(new Event('focus'));});
 await expect.poll(()=>page.evaluate(()=>(window as any).particleFills)).toBeGreaterThan(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 const paused=await page.evaluate(async()=>{const w=window as any,start=w.particleFills;await new Promise(r=>setTimeout(r,180));return w.particleFills===start;});expect(paused).toBe(true);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const count=await page.evaluate(()=>(window as any).particleFills);
 await expect.poll(()=>page.evaluate(()=>(window as any).particleFills)).toBeGreaterThan(count);
 await page.evaluate(()=>(window as any).setState({running:true}));
 await expect(page.locator('#play')).toContainText('OYUN ÇALIŞIYOR');
 const stopped=await page.evaluate(async()=>{const w=window as any,start=w.particleFills;await new Promise(r=>setTimeout(r,180));return w.particleFills===start;});expect(stopped).toBe(true);
});

test('rich mod content renders GFM and HTML while blocking XSS and proxying artwork',async({page})=>{
 await setup(page);await page.evaluate(()=>{
 const w=window as any,original=w.__TAURI_INTERNALS__.invoke;
 w.setState({profiles:[{id:'p',name:'Fabric',version:'1.21.11',loader:'Fabric'}]});w.imageCalls=[];
 const image='https://cdn.modrinth.com/data/example/test.gif';
 w.__TAURI_INTERNALS__.invoke=async(command:string,args:any={})=>{
 if(command==='mods_search')return {hits:[{project_id:'test',title:'Rich mod',description:'Test',downloads:2,follows:1,date_modified:'2026-11-03',author:'Creator',categories:['fabric','utility'],versions:['1.21.11']}],total_hits:1};
 if(command==='mods_fetch_image'){w.imageCalls.push(args.url);return {mime:'image/gif',data:'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'};}
 if(command==='mods_list')return {managed:[],external:[]};
 if(command==='mods_project')return {project:{body:'# Başlık\n\n**Kalın** ve *italik*\n\n- Öğe\n\n```js\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<div><strong>HTML kalın</strong></div>\n\n<script>window.pwned=1</script><style>body{display:none}</style><svg onload="window.pwned=2"><script>window.pwned=3</script></svg><img src="https://evil.test/a.png" onerror="window.pwned=4"><a href="javascript:alert(1)">bad</a><img src="data:image/png;base64,x"><iframe src="https://www.youtube.com/embed/test"></iframe>',gallery:[{url:image,title:'Animasyon'}],categories:[]},creators:[],versions:[]};
 return original(command,args);
 };
 });
 await page.locator('[data-p="mods"]').click();await page.getByRole('button',{name:'Görüntüle',exact:true}).click();
 await expect(page.locator('.rich-content h1')).toHaveText('Başlık');await expect(page.locator('.rich-content table')).toContainText('A');await expect(page.locator('.rich-content strong')).toHaveCount(2);await expect(page.locator('.rich-content em')).toHaveText('italik');await expect(page.locator('.rich-content pre')).toContainText('const a');
 await expect(page.locator('.rich-content script,.rich-content svg,.rich-content iframe,.rich-content style,[onerror]')).toHaveCount(0);
 await expect(page.getByText('Görsel güvenlik nedeniyle engellendi',{exact:true})).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Videoyu aç ↗'})).toBeVisible();expect(await page.evaluate(()=>(window as any).pwned)).toBeUndefined();
 await page.getByRole('button',{name:'Galeri',exact:true}).click();const img=page.locator('.mod-gallery img');await expect(img).toHaveAttribute('src',/^blob:/);await img.click();await expect(page.getByRole('dialog')).toContainText('Animasyon');await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src',/^blob:/);
 expect(await page.evaluate(()=>(window as any).imageCalls.every((u:string)=>u.startsWith('https://cdn.modrinth.com/')))).toBe(true);
 await page.screenshot({path:'test-results/mod-rich-lightbox.png'});
});

test('shared selectors support keyboard, bounded portals and persistent sidebar collapse',async({page})=>{
 await setup(page);await page.getByLabel('Hesap seç',{exact:true}).focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('End');await page.keyboard.press('Enter');
 expect(await page.evaluate(()=>(window as any).commands.some((c:any)=>c.command==='select_account'&&c.args.id==='b'))).toBe(true);
 await page.getByLabel('Hesap seç',{exact:true}).click();const box=await page.locator('.ui-select-portal').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(1280);await page.keyboard.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);
 await page.getByRole('button',{name:'Menüyü daralt',exact:true}).click();await expect(page.locator('.side')).toHaveClass(/collapsed/);await page.reload();await expect(page.locator('.side')).toHaveClass(/collapsed/);await page.getByRole('button',{name:'Menüyü genişlet',exact:true}).click();
 await page.locator('[data-p="settings"]').click();await page.locator('.settings-tab').filter({hasText:'Discord'}).click();await page.getByRole('switch',{name:"Etkinliği Discord'da göster",exact:true}).check();expect(await page.evaluate(()=>(window as any).commands.some((c:any)=>c.command==='save_settings'&&c.args.settings.discord_client_id==='1566023032466571287'))).toBe(true);
 await page.getByRole('switch',{name:"Etkinliği Discord'da göster",exact:true}).uncheck();expect(await page.evaluate(()=>(window as any).commands.some((c:any)=>c.command==='save_settings'&&c.args.settings.discord_client_id===''))).toBe(true);
 await page.screenshot({path:'test-results/shared-controls-settings.png'});
});

test("first launch asks for a language, previews it and settings can change it", async ({ page }) => {
  await setup(page, false, null);
  const onboarding = page.locator(".language-onboarding");
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("radio", { name: /Deutsch/ }).click();
  await expect(onboarding.getByRole("button", { name: /Weiter/ })).toBeVisible();
  await onboarding.getByRole("button", { name: /Weiter/ }).click();
  await expect(onboarding).toHaveCount(0);
  await expect(page.locator(".top h1")).toHaveText("Startseite");
  await page.locator('.side .nav[data-p="settings"]').click();
  await page.locator(".settings-tab").filter({ hasText: "Allgemein" }).click();
  await page.getByRole("radio", { name: /Türkçe/ }).click();
  await expect(page.locator(".top h1")).toHaveText("Launcher ayarları");
  const prefs = JSON.parse(await page.evaluate(() => localStorage.getItem("patron-appearance") ?? "{}"));
  expect(prefs.language).toBe("tr");
  expect(prefs.discord_language).toBe("en");
});
test("settings search, memory slider and storage overview render", async ({ page }) => {
  await setup(page);
  await page.locator('.side .nav[data-p="settings"]').click();
  await page.getByPlaceholder("Ayarlarda ara…").fill("bellek");
  await expect(page.locator(".setting-row h4").first()).toContainText("Ayrılan bellek");
  await page.locator('.side .nav[data-p="folder"]').click();
  await expect(page.locator(".storage-overview")).toBeVisible();
  await expect(page.locator(".storage-folder")).toHaveCount(10);
  const side = await page.locator(".side").evaluate((e) => [e.scrollHeight, e.clientHeight]);
  expect(side[0]).toBeLessThanOrEqual(side[1]);
});

test("home server list recommends by language, searches the world and joins through the core", async ({ page }) => {
  await setup(page);
  const panel = page.locator(".server-panel");
  // Türkçe launcher → yalnızca Türkiye sunucuları önerilir.
  await expect(panel.locator(".server-row")).toHaveCount(1);
  await expect(panel.locator(".server-row.sponsored")).toContainText("Alpha SMP");
  await expect(panel).toContainText("1.234");
  await panel.getByRole("button", { name: "Tüm dünya", exact: true }).click();
  await expect(panel.locator(".server-row")).toHaveCount(2);
  await panel.getByRole("button", { name: "Türkiye", exact: true }).click();
  await panel.getByPlaceholder("Sunucu, adres veya tür ara…").fill("beta");
  // Arama bölgeden bağımsız bütün dünyada yapılır.
  await expect(panel.locator(".server-row")).toHaveCount(1);
  await expect(panel.locator(".server-row")).toContainText("Beta PvP");
  await expect(panel.getByRole("button", { name: "Beta PvP sunucusuna katıl" })).toBeDisabled();
  await panel.getByRole("button", { name: "Filtreleri temizle" }).click();
  await panel.getByRole("button", { name: "Alpha SMP sunucusuna katıl" }).click();
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "join_server",
    args: { id: "alpha" },
  });
});

test("server browser votes once a day, rates and keeps favorites", async ({ page }) => {
  await setup(page);
  const panel = page.locator(".server-panel");
  await panel.getByRole("button", { name: /Tümünü gör/ }).click();
  const browser = page.getByRole("dialog", { name: "Sunucu tarayıcısı" });
  await browser.getByRole("button", { name: /Oy ver/ }).click();
  await expect(browser.getByRole("button", { name: /Oy verildi/ })).toBeDisabled();
  await expect(browser.locator(".sbd-vote small")).toHaveText("1");
  await browser.getByRole("radio", { name: "4 yıldız" }).click();
  await expect(browser.getByRole("radio", { name: "4 yıldız" })).toHaveAttribute("aria-checked", "true");
  await browser.getByRole("button", { name: "Favorilere ekle" }).click();
  await expect(browser.getByRole("button", { name: "Favorilerde" })).toHaveAttribute("aria-pressed", "true");
  const sent = await page.evaluate(() => (window as any).commands);
  expect(sent).toContainEqual({ command: "server_vote", args: { id: "alpha" } });
  expect(sent).toContainEqual({ command: "server_rate", args: { id: "alpha", stars: 4 } });
  expect(sent).toContainEqual({ command: "server_favorite", args: { id: "alpha", favorite: true } });
  await browser.getByRole("button", { name: "Favoriler", exact: true }).click();
  await expect(browser.locator(".browser-row")).toHaveCount(1);
  await page.screenshot({ path: "test-results/server-votes.png" });
});

test("discover tabs search other content types and install packs into a profile", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any, original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === "mods_search") {
        w.commands.push({ command, args });
        return { total_hits: 1, hits: [{ project_id: "pack1", title: "Fresh Pack", description: "d", downloads: 5, follows: 1, date_modified: "2026-11-01", author: "me", categories: ["realistic"] }] };
      }
      if (command === "content_versions") return [{ id: "v1", version_number: "1.0", version_type: "release", loaders: ["minecraft"] }];
      if (command === "content_install") { w.commands.push({ command, args }); return "fresh.zip"; }
      return original(command, args);
    };
  });
  await page.locator('[data-p="mods"]').click();
  await expect(page.locator(".top h1")).toHaveText("Keşfet");
  await page.getByRole("tab", { name: "Kaynak paketleri" }).click();
  await expect(page.getByText("Fresh Pack").first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).commands.some((c: any) => c.command === "mods_search" && c.args.search.project_type === "resourcepack"))).toBe(true);
  await page.getByRole("button", { name: "Kur", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Fresh Pack kur" });
  await dialog.getByRole("button", { name: "Kur", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "content_install",
    args: { profile: "p", kind: "resourcepack", project: "pack1", version: "v1", world: null },
  });
});

test("CurseForge source searches with the key and installs a mod plan after approval", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any, original = w.__TAURI_INTERNALS__.invoke;
    w.setState({ profiles: [{ id: "p", name: "OldWorld", version: "1.21.11", loader: "Fabric", loader_version: "0.18.4" }] });
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command.startsWith("curseforge_")) w.commands.push({ command, args });
      if (command === "curseforge_key_status") return "bundled";
      if (command === "curseforge_categories") return { data: [{ id: 420, name: "Performance" }] };
      if (command === "curseforge_search")
        return { pagination: { totalCount: 1 }, data: [{ id: 394468, name: "Sodium CF", summary: "Fast", downloadCount: 1200000, dateModified: "2026-11-01T00:00:00Z", authors: [{ name: "jelly" }], categories: [{ id: 420, name: "Performance" }] }] };
      if (command === "curseforge_plan")
        return { id: "plan-1", entries: [{ project_id: "cf-394468", filename: "sodium.jar", user_selected: true }], installed: [], warnings: [], total_bytes: 1048576 };
      if (command === "curseforge_install") return { state: w.state ?? {}, news: null };
      if (command === "mods_list") return { managed: [] };
      return original(command, args);
    };
  });
  await page.locator('[data-p="mods"]').click();
  await page.getByRole("button", { name: "CurseForge" }).click();
  await expect(page.locator(".cf-row")).toContainText("Sodium CF");
  expect(await page.evaluate(() => (window as any).commands.some((c: any) => c.command === "curseforge_search" && c.args.search.kind === "mod" && c.args.search.fabric === true))).toBe(true);
  await page.locator(".cf-row .cf-install").click();
  const dialog = page.getByRole("dialog", { name: "Sodium CF kur" });
  await expect(dialog).toContainText("sodium.jar");
  await dialog.getByRole("button", { name: "Onayla ve kur", exact: true }).click();
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "curseforge_install",
    args: { id: "p", planId: "plan-1", confirmed: true },
  });
});

test("server panel wraps filters, collapses and opens the blurred server browser", async ({ page }) => {
  await setup(page);
  const panel = page.locator(".server-panel");
  await panel.getByRole("button", { name: "Tüm dünya", exact: true }).click();
  await expect(panel.locator(".server-row")).toHaveCount(2);
  await expect(panel.locator(".mascot")).toBeVisible();
  for (const sel of [".server-regions", ".server-tag-cloud"])
    expect(await panel.locator(sel).evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  await panel.locator(".tag-chip", { hasText: "PvP" }).click();
  await expect(panel.locator(".server-row")).toHaveCount(1);
  await expect(panel.locator(".server-row")).toContainText("Beta PvP");
  await panel.getByRole("button", { name: "Filtreleri temizle" }).click();
  await expect(panel.locator(".server-row")).toHaveCount(1);
  await panel.getByRole("button", { name: "Tüm dünya", exact: true }).click();
  await expect(panel.locator(".server-row")).toHaveCount(2);
  await page.screenshot({ path: "test-results/home-polish.png" });

  await panel.getByRole("button", { name: /Tümünü gör/ }).click();
  const browser = page.getByRole("dialog", { name: "Sunucu tarayıcısı" });
  await expect(browser).toBeVisible();
  expect(
    await page.locator(".server-browser-backdrop").evaluate((n) => getComputedStyle(n).backdropFilter),
  ).toContain("blur");
  await expect(browser.locator(".sbd-motd")).toContainText("Hoş geldin");
  await expect(browser.locator(".sbd-stats")).toContainText("31 ms");
  await page.screenshot({ path: "test-results/server-browser.png" });
  await browser.getByRole("option", { name: /Beta PvP/ }).click();
  await expect(browser.locator(".server-browser-detail")).toContainText("Test server");
  await browser.getByRole("option", { name: /Alpha SMP/ }).click();
  await browser.getByRole("button", { name: "Sunucuya katıl" }).click();
  expect(await page.evaluate(() => (window as any).commands)).toContainEqual({
    command: "join_server",
    args: { id: "alpha" },
  });
  await expect(browser).toHaveCount(0);
  await panel.getByRole("button", { name: /Tümünü gör/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Sunucu tarayıcısı" })).toHaveCount(0);

  const toggle = panel.getByRole("button", { name: /Sunucular/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel.locator(".server-list")).toHaveCount(0);
  const saved = await page.evaluate(() =>
    (window as any).commands.filter((c: any) => c.command === "save_appearance").pop(),
  );
  expect(saved.args.preferences.server_panel_collapsed).toBe(true);
  await page.reload();
  await expect(page.locator(".server-panel")).toHaveClass(/collapsed/);
  await page.locator(".server-panel").getByRole("button", { name: /Sunucular/ }).click();
  await expect(page.locator(".server-panel .server-row")).toHaveCount(2);
});

test("hero badges never overlap the mode buttons and parallax eases back", async ({ page }) => {
  await setup(page);
  await page.evaluate(() =>
    (window as any).setState({
      profiles: [{ id: "p", name: "OldWorld", version: "1.21.11", loader: "Forge", loader_version: "1.21.11-55.0.123-extremely-long-build" }],
    }),
  );
  await page.locator('[data-p="profiles"]').click();
  await page.locator('[data-p="home"]').click();
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  for (const width of [1280, 1100, 1600]) {
    await page.setViewportSize({ width, height: 860 });
    const badges = (await page.locator(".hero-badges").boundingBox())!,
      modes = (await page.locator(".home-modes").boundingBox())!;
    const overlap =
      badges.x < modes.x + modes.width &&
      modes.x < badges.x + badges.width &&
      badges.y < modes.y + modes.height &&
      modes.y < badges.y + badges.height;
    expect(overlap, `width ${width}`).toBe(false);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator(".hero").screenshot({ path: "test-results/hero-badges.png" });
  await expect(page.locator("#play .play-retro .play-pixels")).toHaveCount(1);
  const hero = page.locator(".hero"),
    box = (await hero.boundingBox())!;
  const mx = () => hero.evaluate((n) => parseFloat(n.style.getPropertyValue("--mx") || "0"));
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.move(box.x + box.width - 5, box.y + 20);
  await page.waitForTimeout(60);
  const early = await mx();
  expect(early).toBeGreaterThan(0);
  expect(early).toBeLessThan(0.95); // değer hedefe bir anda atlamaz
  await expect.poll(mx).toBeGreaterThan(0.9);
  await page.mouse.move(box.x + box.width + 200, box.y + 20);
  await page.waitForTimeout(40);
  expect(await mx()).toBeGreaterThan(0.2); // çıkışta sıfıra sıçramaz
  await expect.poll(mx).toBe(0);
});

test("discover nav uses the filled creeper icon", async ({ page }) => {
  await setup(page);
  const icon = page.locator('[data-p="mods"] .nav-tile svg.i-fill');
  await expect(icon).toHaveCount(1);
  await expect(icon.locator(".face")).toHaveCount(1);
  expect(await icon.locator(".face").evaluate((n) => getComputedStyle(n).fill)).toBe("rgb(5, 8, 6)");
  await page.locator('[data-p="mods"] .nav-tile').screenshot({ path: "test-results/creeper-tile.png" });
});

test("custom theme applies CSS variables, persists and ambience plays procedurally", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Görünüm", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await page.screenshot({ path: "test-results/theme-cards.png" });
  await dialog.getByRole("button", { name: "Özel tema", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "custom");
  const brand = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue("--brand"));
  expect(await brand()).toBe("#ff5a36");
  await dialog.getByRole("button", { name: "Okyanus" }).click();
  expect(await brand()).toBe("#22d3ee");
  await dialog.getByLabel("Vurgu rengi").fill("#123456");
  expect(await brand()).toBe("#123456");
  await dialog.getByRole("slider", { name: "Parçacık hızı" }).fill("200");
  const saved = await page.evaluate(() =>
    (window as any).commands.filter((c: any) => c.command === "save_appearance").pop(),
  );
  expect(saved.args.preferences.skin).toBe("custom");
  expect(saved.args.preferences.custom_theme).toMatchObject({ accent: "#123456", particle_speed: 200 });
  await page.screenshot({ path: "test-results/custom-theme.png" });
  const play = dialog.locator(".ambience-play");
  await play.scrollIntoViewIfNeeded();
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("slider", { name: "Şömine ateşi" }).fill("70");
  await page.screenshot({ path: "test-results/ambience.png" });
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  const last = await page.evaluate(() =>
    (window as any).commands.filter((c: any) => c.command === "save_appearance").pop(),
  );
  expect(last.args.preferences.ambience.fire).toBe(70);
  await dialog.getByRole("button", { name: "Patron Kırmızı", exact: true }).click();
  expect(await brand()).toBe("");
});

test("music player popup shows the empty launcher list, collapses, closes and controls the media player", async ({ page }) => {
  await setup(page, false, "tr", true);
  await page.evaluate(() => {
    const w = window as any, original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === "media_now_playing")
        return { title: "Sweden", artists: "C418", album: "Volume Alpha", image: null, duration_ms: 215000, progress_ms: 30000, is_playing: true, shuffle: false, device: "Spotify", volume: 60 };
      if (command === "media_control") { w.commands.push({ command, args }); return null; }
      return original(command, args);
    };
  });
  const player = page.getByRole("complementary", { name: "Müzik çalar" });
  await expect(player).toBeVisible();
  await page.screenshot({ path: "test-results/music-player.png" });
  // Lisanslı parçalar eklenene kadar launcher listesi boştur ve Medya sekmesine yönlendirir.
  await expect(player.locator(".mp-title")).toHaveText("Launcher müzikleri yakında");
  await expect(player.getByRole("button", { name: "Sonraki parça" })).toHaveCount(0);
  await player.getByRole("button", { name: "Müzik çaları küçült" }).click();
  await expect(player).toHaveClass(/compact/);
  await page.screenshot({ path: "test-results/music-compact.png" });
  await player.getByRole("button", { name: "Müzik çaları genişlet" }).first().click();
  await player.getByRole("tab", { name: "Medya" }).click();
  await expect(player.getByText("Sweden")).toBeVisible();
  await expect(player.getByText("C418")).toBeVisible();
  await page.screenshot({ path: "test-results/music-media.png" });
  await player.getByRole("button", { name: "Duraklat" }).click();
  const control = await page.evaluate(() =>
    (window as any).commands.filter((c: any) => c.command === "media_control").pop(),
  );
  expect(control.args.action).toBe("pause");
  await player.getByRole("button", { name: "Müzik çaları kapat" }).click();
  await expect(player).toHaveCount(0);
  await page.getByRole("button", { name: "Müzik çaları aç" }).click();
  await expect(page.getByRole("complementary", { name: "Müzik çalar" })).toBeVisible();
});

// Launcher parçaları kaldırıldı (telif); lisanslı parçalar geri gelince yeniden açılacak.
test.skip("launcher music yields to Spotify, honours a manual restart and returns when Spotify closes", async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page, false, "tr", true);
  await page.evaluate(() => {
    const w = window as any, original = w.__TAURI_INTERNALS__.invoke;
    w.spotifyNow = null;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === "media_now_playing") return w.spotifyNow;
      return original(command, args);
    };
  });
  const track = (id: string) =>
    page.evaluate((id) => {
      (window as any).spotifyNow = {
        title: id, artists: "A", album: "B", image: null, url: `https://open.spotify.com/track/${id}`,
        duration_ms: 200000, progress_ms: 30000, is_playing: true, shuffle: false, device: "PC", volume: 60,
      };
    }, id);
  const player = page.getByRole("complementary", { name: "Müzik çalar" });
  const notice = page.locator(".music-notice");
  const poll = { timeout: 9000 };
  await player.getByRole("tab", { name: "Spotify" }).click();
  await player.getByRole("button", { name: "Spotify ile bağlan" }).click();
  await player.getByRole("tab", { name: "Launcher" }).click();
  await player.locator(".mp-play").click();
  await expect(player.getByRole("button", { name: "Duraklat" })).toBeVisible();

  await track("first");
  await expect(notice).toContainText("Spotify'da müzik çaldığı için", poll);
  await expect(player.getByRole("button", { name: "Oynat" })).toBeVisible();
  await page.screenshot({ path: "test-results/music-notice.png" });
  await notice.getByRole("button", { name: "Kapat" }).click();
  await expect(notice).toHaveCount(0);

  await player.locator(".mp-play").click();
  await expect(player.getByRole("button", { name: "Duraklat" })).toBeVisible();
  await page.waitForTimeout(6500);
  await expect(player.getByRole("button", { name: "Duraklat" })).toBeVisible();
  await expect(notice).toHaveCount(0);

  await track("second");
  await expect(notice).toContainText("başka bir şarkıya geçtiğin", poll);
  await expect(player.getByRole("button", { name: "Oynat" })).toBeVisible();

  await page.evaluate(() => ((window as any).spotifyNow = null));
  await expect(player.getByRole("button", { name: "Duraklat" })).toBeVisible(poll);
});

test("PClient home lists servers instead of modules and errors can be dismissed", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "patron-appearance",
      JSON.stringify({ skin: "patron", particles: true, animations: true, splash: true, language: "tr", ui_mode: "pclient", music: { widget: false, autoplay: false } }),
    ),
  );
  await setup(page, false, "tr");
  await expect(page.getByText("Oyun içi modüller")).toHaveCount(0);
  const list = page.locator(".pc-home-servers");
  await expect(list.getByText("Alpha SMP")).toBeVisible();
  await expect(list.getByText("31 ms")).toBeVisible();
  await expect(list.getByText("Beta PvP")).toHaveCount(0);
  await page.screenshot({ path: "test-results/pclient-home-servers.png" });
  await list.getByRole("button", { name: "Bağlan" }).first().click();
  const join = await page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "join_server").pop());
  expect(join.args).toMatchObject({ id: "alpha", pclient: true });

  await page.evaluate(() => {
    const w = window as any, original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === "list_versions") throw "ağ hatası";
      return original(command, args);
    };
  });
  await page.getByRole("button", { name: "Yenile" }).first().click();
  const error = page.locator(".status-error");
  await expect(error).toContainText("İşlem tamamlanamadı");
  const toast = page.locator("#toast");
  // Bildirim 2,6 sn sonra kendiliğinden kapandığından önce o denetlenir.
  await expect
    .poll(async () => {
      const [t, e] = [await toast.boundingBox(), await error.boundingBox()];
      return t && e ? t.y + t.height <= e.y : false;
    })
    .toBe(true);
  await toast.getByRole("button", { name: "Kapat" }).click();
  await expect(toast).not.toHaveClass(/show/);
  await page.screenshot({ path: "test-results/pclient-error.png" });
  await error.getByRole("button", { name: "Kapat" }).click();
  await expect(error).toHaveCount(0);
});

test("PClient appearance panel recolors the interface and both return buttons reach PatronLauncher", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "patron-appearance",
      JSON.stringify({ skin: "patron", particles: true, animations: false, splash: false, language: "tr", ui_mode: "pclient", startup_ui: "last", music: { widget: false, autoplay: false } }),
    ),
  );
  await setup(page, false, "tr");
  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pc-red").trim());
  await expect.poll(accent).toBe("#ff2a3d");
  await expect(page.locator(".pc-exit")).toBeVisible();
  await page.getByRole("button", { name: "Görünüm", exact: true }).click();
  await page.locator('[data-swatch="mavi"]').click();
  await expect.poll(accent).toBe("#4f8cff");
  await page.screenshot({ path: "test-results/pclient-appearance.png" });
  await page.locator(".appearance-drawer-host").getByRole("button", { name: "Kapat" }).click();
  await page.screenshot({ path: "test-results/pclient-return-buttons.png" });
  await page.locator(".pc-stage-switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-ui", "launcher");
  await page.locator(".pc-portal-btn").click();
  await expect(page.locator("html")).toHaveAttribute("data-ui", "pclient");
  await page.locator(".pc-exit").click();
  await expect(page.locator("html")).toHaveAttribute("data-ui", "launcher");
});

const pclientUi = (page: Page, performance: string | null) =>
  page.addInitScript((performance) => {
    localStorage.setItem(
      "patron-appearance",
      JSON.stringify({ skin: "patron", particles: true, animations: true, splash: true, language: "tr", ui_mode: "pclient", music: { widget: false, autoplay: false } }),
    );
    (window as any).pclientReleases = [{ minecraft: "26.3", ready: true, installed: true, selected: true, performance }];
  }, performance);

test("PClient opens its game folder and offers support when the game fails to start", async ({ page }) => {
  await pclientUi(page, "installed");
  await setup(page, false, "tr");
  await page.getByRole("button", { name: "PClient oyun klasörünü aç" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).commands.some((c: any) => c.command === "open_folder" && c.args.target === "pclient")))
    .toBe(true);
  const dialog = page.getByRole("dialog", { name: "Destek" });
  await page.getByRole("button", { name: "Destek", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Destek" })).toBeVisible();
  await page.screenshot({ path: "test-results/pclient-support.png" });
  await dialog.getByRole("button", { name: "Kapat" }).click();
  await expect(dialog).toHaveCount(0);
  // Oyun açılamadan kapanınca pencere kendiliğinden gelir.
  await page.evaluate(() => (window as any).setState({ status: "Minecraft hata koduyla kapandı: exit code: 1. Profil klasöründeki patronlauncher-game.log dosyasını kontrol edin." }));
  await expect(dialog.getByRole("heading", { name: "Oyun açılamadı" })).toBeVisible();
});

test("community links stay visible with real logos in both interfaces", async ({ page }) => {
  await setup(page, false, "tr");
  await expect(page.locator(".side .cm-link")).toHaveCount(2);
  await page.screenshot({ path: "test-results/launcher-community.png" });
  await page.evaluate(() => (document.querySelector('.nav[data-p="versions"]') as HTMLElement | null)?.click());
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/launcher-versions.png" });
  await page.evaluate(() => (document.querySelector('.nav[data-p="mods"]') as HTMLElement | null)?.click());
  await expect(page.locator(".source-logo.modrinth").first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/launcher-discover.png" });
});

test("version covers have rising fog and hover particles", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setup(page, false, "tr");
  await page.evaluate(() => (document.querySelector('.nav[data-p="versions"]') as HTMLElement | null)?.click());
  const card = page.locator(".v-card").first();
  await expect(card.locator(".vfx-fog")).toHaveCount(2);
  await card.hover();
  await page.waitForTimeout(1500);
  const canvas = card.locator("canvas.vfx-canvas");
  await expect(canvas).toHaveCount(1);
  const painted = await canvas.evaluate((c: HTMLCanvasElement) =>
    c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data.some((v) => v > 0),
  );
  expect(painted).toBe(true);
  await page.screenshot({ path: "test-results/launcher-version-fx.png" });
  await page.mouse.move(2, 2);
  await expect(canvas).toHaveCount(0, { timeout: 8000 });
});

test("PClient home shows the animated community links", async ({ page }) => {
  await pclientUi(page, "installed");
  await setup(page, false, "tr");
  await expect(page.locator(".pc-stage .cm-link")).toHaveCount(2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/pclient-community.png" });
});

test("first PClient launch asks about Sodium and Lithium and honours a decline", async ({ page }) => {
  await pclientUi(page, null);
  await setup(page, false, "tr");
  await page.getByRole("button", { name: /OYUNA GİR/ }).click();
  const dialog = page.getByRole("dialog", { name: "Performans modları kurulsun mu?" });
  await expect(dialog).toContainText("yalnızca PClient 26.3 için kurulur");
  await page.screenshot({ path: "test-results/pclient-performance-prompt.png" });
  await dialog.getByRole("button", { name: "Kurmadan devam et" }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).commands.map((c: any) => c.command)))
    .toEqual(expect.arrayContaining(["pclient_performance", "pclient_play"]));
  const choice = await page.evaluate(() => (window as any).commands.find((c: any) => c.command === "pclient_performance"));
  expect(choice.args).toEqual({ version: "26.3", install: false });
});

test("declined PClient versions are listed, can be silenced and installed later", async ({ page }) => {
  await pclientUi(page, "declined");
  await setup(page, false, "tr");
  const dialog = page.getByRole("dialog", { name: "Performans modları içermeyen sürümler" });
  await expect(dialog).toContainText("Minecraft 26.3");
  await page.screenshot({ path: "test-results/pclient-performance-reminder.png" });
  await dialog.getByRole("switch").check({ force: true });
  await dialog.getByRole("button", { name: "Daha sonra" }).click();
  await expect(dialog).toHaveCount(0);
  const hide = await page.evaluate(() => (window as any).commands.find((c: any) => c.command === "pclient_performance_hide"));
  expect(hide.args).toEqual({ hidden: true });
  await page.locator(".pc-nav", { hasText: "Sürümler" }).click();
  await expect(page.getByText("Performans modları kurulu değil")).toBeVisible();
  await page.getByRole("button", { name: "Performans modlarını kur" }).click();
  await expect(page.getByRole("button", { name: "Performans modlarını kaldır" })).toBeVisible();
  await expect(page.getByText("Performans modları kurulu", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/pclient-performance-versions.png" });
});
