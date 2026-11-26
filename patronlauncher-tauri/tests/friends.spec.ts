import { test, expect, type Page } from "@playwright/test";

/**
 * Arkadaşlar sayfası (klasik ve PClient): Discord tarzı sağ tık menüsü, launcher'a uygun onay penceresi,
 * engellenen/sessizdeki arkadaş etiketleri ve kayan vurgulu gizlilik seçimi. Tauri ve site yanıtları taklittir.
 */
async function setup(page: Page, ui: "launcher" | "pclient", offline = false) {
  await page.addInitScript(([ui, offline]) => {
    localStorage.setItem(
      "patron-appearance",
      JSON.stringify({ skin: ui === "launcher" ? "mavi" : "orman", particles: false, animations: true, splash: false, language: "tr", startup_ui: ui, music: { widget: false, autoplay: false } }),
    );
    const w = window as any,
      callbacks = new Map<number, Function>(),
      handlers = new Map<string, number>();
    let id = 0;
    const now = Math.floor(Date.now() / 1000);
    const state: any = {
      accounts: [{ id: "a", name: "Justt_", uuid: "a", kind: "Local" }],
      profiles: [{ id: "p", name: "OldWorld", version: "1.21.11" }],
      selected_account: "a",
      selected_profile: "p",
      settings: { memory_mb: 4096, java_path: "", microsoft_client_id: "", discord_client_id: "" },
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
    const friends = [
      { id: "1", username: "justt2", displayUsername: "justt2", since: now, presence: { online: true, playing: { version: "26.3", server: "play.chickennw.com", since: now } }, blocked: false, muted: false },
      { id: "2", username: "cekuuuu", displayUsername: "Cekuuuu", since: now, presence: { online: true, playing: null }, blocked: false, muted: true },
      { id: "3", username: "astro", displayUsername: "astropipicik", since: now, presence: null, blocked: false, muted: false },
      { id: "5", username: "eskici", displayUsername: "Eskici", since: now, presence: { online: true, playing: { version: "1.20.1", server: "mc.hypixel.net", since: now } }, blocked: false, muted: false },
      { id: "4", username: "s2kci", displayUsername: "s2kcipromaX", since: now, presence: null, blocked: true, muted: false },
    ];
    const privacy = { dmPolicy: "friends", presencePolicy: "everyone", friendPolicy: "everyone" };
    const social: Record<string, unknown> = {
      "/api/social/friends": { friends, incoming: [], outgoing: [], blocked: [{ id: "4", username: "s2kci", displayUsername: "s2kcipromaX" }] },
      "/api/social/conversations": {
        conversations: [
          { id: "1", username: "justt2", displayUsername: "justt2", last: { id: 5, from: "me", body: "tm gel", at: now }, unread: 0, muted: false },
          { id: "2", username: "cekuuuu", displayUsername: "Cekuuuu", last: { id: 7, from: "cekuuuu", body: "akşam oynuyor muyuz?", at: now }, unread: 2, muted: true },
        ],
        unread: 2,
      },
      "/api/social/privacy": privacy,
    };
    w.commands = [];
    w.isTauri = true;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: (fn: Function) => {
        callbacks.set(++id, fn);
        return id;
      },
      unregisterCallback: (cb: number) => callbacks.delete(cb),
      invoke: async (command: string, args: any = {}) => {
        w.commands.push({ command, args });
        if (command === "plugin:event|listen") {
          handlers.set(args.event, args.handler);
          return id;
        }
        if (command.startsWith("plugin:")) return;
        if (command === "patron_account_status")
          return { state: "signed_in", username: "justt_", display: "Justt_", profile_url: "https://patronlauncher.net/u/justt_", code: null, error: null };
        if (command === "social_status") return { connected: true };
        if (command === "patron_open_player") return null;
        if (command === "pclient_versions") return [{ minecraft: "26.3", ready: true, installed: true, selected: true, performance: null }];
        if (command === "join_friend") return { state: structuredClone(state), news: null };
        if (command === "social_api") {
          if (offline) throw "error sending request";
          const path = String(args.path).split("?")[0];
          if (path === "/api/social/messages" && args.method === "GET")
            return { with: { username: "justt2", displayUsername: "justt2" }, messages: [{ id: 5, from: "me", body: "tm gel", at: now }], canSend: true, iBlocked: false, muted: false };
          if (args.method === "POST" && path === "/api/social/privacy") return Object.assign(privacy, args.body);
          if (args.method === "POST") return { ok: true, result: "ok" };
          return social[path] ?? {};
        }
        if (command === "list_installed_versions") return [];
        if (command === "servers_list") return { source: "bundled", servers: [] };
        if (command === "servers_votes") return {};
        if (command === "profile_statuses") return {};
        return { state: structuredClone(state), news: command === "get_news" ? [] : null };
      },
    };
  }, [ui, offline] as const);
  await page.goto("/");
}

async function openFriends(page: Page) {
  await page.getByRole("button", { name: /Arkadaşlar/i }).first().click();
  await expect(page.locator(".so-page")).toBeVisible();
  await expect(page.locator(".so-row").filter({ hasText: "Cekuuuu" }).first()).toBeVisible();
}

for (const ui of ["launcher", "pclient"] as const) {
  test(`friends (${ui}): right-click menu, styled block confirm, tags and animated privacy picker`, async ({ page }) => {
    await setup(page, ui);
    await openFriends(page);
    const dir = "test-results/friends";

    // Engellenen arkadaş listede kalır, etiketlenir ve mesaj düğmesi gösterilmez; sessizdeki işaretlenir.
    const blockedRow = page.locator(".so-side .so-row").filter({ hasText: "s2kcipromaX" });
    await expect(blockedRow.locator(".so-tag.blocked")).toBeVisible();
    await expect(blockedRow.getByRole("button", { name: "Mesaj gönder" })).toHaveCount(0);
    await expect(page.locator(".so-side .so-row").filter({ hasText: "Cekuuuu" }).locator(".so-tag.muted")).toBeVisible();
    await page.screenshot({ path: `${dir}/${ui}-list.png` });

    // Sağ tık: Discord tarzı seçenekler; sessizdeki kişide "Bildirimleri aç".
    const cek = page.locator(".so-side .so-row").filter({ hasText: "Cekuuuu" });
    const rowBox = (await cek.boundingBox())!;
    await cek.click({ button: "right", position: { x: 60, y: 12 } });
    const menu = page.locator(".so-menu");
    await expect(menu).toBeVisible();
    // Menü imlecin hemen yanında açılır (animasyonlu sayfa kabının içinde kaymaz) ve tema rengini kullanır.
    await page.waitForTimeout(300);
    const mBox = (await menu.boundingBox())!;
    expect(Math.abs(mBox.x - (rowBox.x + 60))).toBeLessThan(8);
    expect(Math.abs(mBox.y - (rowBox.y + 12))).toBeLessThan(8);
    expect(await menu.evaluate((m) => m.parentElement?.parentElement === document.body)).toBe(true);
    for (const label of ["Mesaj gönder", "Profili görüntüle", "Bildirimleri aç", "Sohbeti kapat", "Kullanıcı adını kopyala", "Arkadaşlıktan çıkar", "Engelle"])
      await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
    await page.screenshot({ path: `${dir}/${ui}-menu.png` });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // Engelle: tarayıcı confirm kutusu yerine launcher'a uygun pencere; Vazgeç hiçbir şey göndermez.
    page.on("dialog", () => {
      throw new Error("native dialog must not be used");
    });
    await page.locator(".so-side .so-row").filter({ hasText: "justt2" }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Engelle" }).click();
    const dialog = page.locator("dialog.so-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveText("justt2 engellensin mi?");
    await expect(dialog).toContainText("Arkadaşlığınız sürer");
    await page.screenshot({ path: `${dir}/${ui}-confirm.png` });
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await expect(dialog).toHaveCount(0);
    const blockCalls = () => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "social_api" && c.args.body?.action === "block").length);
    expect(await blockCalls()).toBe(0);
    await page.locator(".so-side .so-row").filter({ hasText: "justt2" }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Engelle" }).click();
    await page.locator("dialog.so-dialog").getByRole("button", { name: "Engelle" }).click();
    expect(await blockCalls()).toBe(1);

    // Sessize alma ve sohbeti kapatma /api/social/prefs'e gider.
    await page.locator(".so-chats .so-row").filter({ hasText: "Cekuuuu" }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Sohbeti kapat" }).click();
    const prefs = await page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "social_api" && c.args.path === "/api/social/prefs").map((c: any) => c.args.body));
    expect(prefs).toContainEqual({ username: "cekuuuu", closed: true });

    // Gizlilik: kayan vurgulu seçim; seçim kaydedilir ve kart "Kaydedildi" gösterir.
    await page.getByRole("tab", { name: "Gizlilik" }).click();
    const dm = page.getByRole("radiogroup", { name: "Kim mesaj atabilir" });
    await expect(dm.getByRole("radio", { name: "Arkadaşlar" })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: `${dir}/${ui}-privacy.png` });
    await dm.getByRole("radio", { name: "Kimse" }).click();
    await expect(dm.getByRole("radio", { name: "Kimse" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".so-pcard.saved")).toHaveCount(1);
    await page.screenshot({ path: `${dir}/${ui}-privacy-saved.png` });
  });
}

test("pclient home does not scroll the page (it used to wobble up and down)", async ({ page }) => {
  await setup(page, "pclient");
  const main = page.locator("main.pc-main.is-home");
  await expect(main).toBeVisible();
  await page.waitForTimeout(600);
  const box = await main.evaluate((m) => ({ overflow: getComputedStyle(m).overflowY, scrollable: m.scrollHeight - m.clientHeight }));
  expect(box.overflow).toBe("hidden");
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  expect(await main.evaluate((m) => m.scrollTop)).toBe(0);
  await page.screenshot({ path: "test-results/friends/pclient-home.png" });
});

test("friends: unreachable site shows a warning with retry instead of empty tabs", async ({ page }) => {
  await setup(page, "pclient", true);
  await page.getByRole("button", { name: /Arkadaşlar/i }).first().click();
  const warn = page.locator(".so-offline");
  await expect(warn).toContainText("ulaşılamadı");
  await page.getByRole("tab", { name: "Gizlilik" }).click();
  await expect(page.locator(".so-side .so-list .so-empty")).toContainText("ulaşılamadı");
  const before = await page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "social_api").length);
  await warn.getByRole("button", { name: "Yeniden dene" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "social_api").length)).toBeGreaterThan(before);
  await page.screenshot({ path: "test-results/friends/pclient-offline.png" });
});

test("friends: join a friend's server on any version (the server reports a mismatch itself)", async ({ page }) => {
  await setup(page, "launcher");
  await openFriends(page);
  // justt2 PClient sürümünde (26.3) play.chickennw.com'da: Katıl düğmesi.
  const row = page.locator(".so-side .so-row").filter({ hasText: "justt2" });
  await expect(row.getByRole("button", { name: "Katıl" })).toBeVisible();
  // Eskici başka sürümde (1.20.1): yine Katıl; sürüm uyarısı gösterilmez.
  const old = page.locator(".so-side .so-row").filter({ hasText: "Eskici" });
  await expect(old.getByRole("button", { name: "Katıl" })).toBeVisible();
  await expect(page.getByText(/gerekli/)).toHaveCount(0);
  // Çevrimiçi ama sunucuda olmayan arkadaşta ikisi de yok.
  const idle = page.locator(".so-side .so-row").filter({ hasText: "Cekuuuu" });
  await expect(idle.locator(".so-join")).toHaveCount(0);
  await page.screenshot({ path: "test-results/friends/launcher-join.png" });

  await row.getByRole("button", { name: "Katıl" }).click();
  await expect(page.locator(".so-note")).toContainText("play.chickennw.com sunucusuna bağlanılıyor");
  const calls = await page.evaluate(() => (window as any).commands.filter((c: any) => c.command === "join_friend").map((c: any) => c.args));
  expect(calls).toEqual([{ username: "justt2" }]);

  // Sağ tık menüsünde de "Sunucuya katıl" var; sunucuda olmayanda yok.
  await row.click({ button: "right" });
  await expect(page.locator(".so-menu").getByRole("menuitem", { name: "Sunucuya katıl" })).toBeVisible();
  await page.keyboard.press("Escape");
  await idle.click({ button: "right" });
  await expect(page.locator(".so-menu").getByRole("menuitem", { name: "Sunucuya katıl" })).toHaveCount(0);
});
