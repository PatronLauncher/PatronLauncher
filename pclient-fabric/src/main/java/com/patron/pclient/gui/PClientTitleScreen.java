package com.patron.pclient.gui;

import com.mojang.blaze3d.Blaze3D;
import com.mojang.blaze3d.platform.NativeImage;
import com.patron.pclient.L;
import com.google.gson.JsonParser;
import com.patron.pclient.PClient;
import com.patron.pclient.bridge.Modrinth;
import com.patron.pclient.bridge.News;
import com.patron.pclient.bridge.Support;
import com.patron.pclient.config.PClientConfig;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.FaviconTexture;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerStatusPinger;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

/** PClient ana menüsü: tek/çok oyunculu (PClient ekranları), modüller, Minecraft ayarları ve çıkış. */
public final class PClientTitleScreen extends PcScreen {
	/** Bu oturumda çarpıyla kapatıldı. */
	private static boolean noticeClosed;
	private static Boolean launcherHidNotice;

	public PClientTitleScreen() { super("title.main", null); }

	/** Launcher'da "bir daha gösterme" seçildiyse oyun içinde de gösterilmez. */
	private boolean launcherHidNotice() {
		if (launcherHidNotice != null) return launcherHidNotice;
		boolean hidden = false;
		Path file = minecraft.gameDirectory.toPath().resolve("pclient").resolve("performance.json");
		if (Files.isRegularFile(file)) {
			try {
				var value = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject().get("hide_notice");
				hidden = value != null && value.getAsBoolean();
			} catch (IOException | RuntimeException e) {
				PClient.LOG.warn("performance.json okunamadı", e);
			}
		}
		launcherHidNotice = hidden;
		return hidden;
	}

	private boolean showPerformanceNotice() {
		FabricLoader loader = FabricLoader.getInstance();
		return !noticeClosed && !PClientConfig.get().hidePerformanceNotice && !launcherHidNotice()
			&& !(loader.isModLoaded("sodium") && loader.isModLoaded("lithium"));
	}

	/** Sağ üstte Sodium ve Lithium önerisi. */
	private void drawPerformanceNotice(GuiGraphicsExtractor g) {
		if (!showPerformanceNotice()) return;
		String title = L.t("notice.performance.title"), body = L.t("notice.performance.body"), hide = L.up("notice.performance.hide");
		int boxW = Math.max(font.width(title) + 26, Math.max(font.width(body), font.width(hide) + 12) + 16);
		int x = width - boxW - 8, y = 8;
		Theme.notched(g, x, y, x + boxW, y + 50, 3, 0xD80A0B10);
		Theme.notchedOutline(g, x, y, x + boxW, y + 50, 3, Theme.withAlpha(Theme.accent(), 0x90));
		g.text(font, title, x + 8, y + 7, Theme.accent(), false);
		g.text(font, body, x + 8, y + 19, Theme.TEXT, false);
		button(g, x + 8, y + 31, x + 8 + font.width(hide) + 12, y + 45, hide, Style.GHOST, () -> {
			PClientConfig.get().hidePerformanceNotice = true;
			PClientConfig.save();
		});
		button(g, x + boxW - 18, y + 4, x + boxW - 4, y + 18, "×", Style.GHOST, () -> noticeClosed = true);
	}

	// --- Ana sayfa panelleri: haberler, sunucular, Modrinth ön gösterimi ve destek ---

	private static final int SIDE_MIN = 140, SIDE_MAX = 200;
	private static List<Modrinth.Hit> trending = List.of();
	private static boolean trendingRequested;
	private final ServerStatusPinger pinger = new ServerStatusPinger();
	private final Map<String, ServerData> pings = new HashMap<>();
	private final Map<String, FaviconTexture> icons = new HashMap<>();
	private final Map<String, byte[]> iconBytes = new HashMap<>();
	private List<PClientServersScreen.Listed> servers;

	@Override public void tick() { pinger.tick(); }

	@Override public void removed() {
		super.removed();
		pinger.removeAll();
		icons.values().forEach(FaviconTexture::close);
		icons.clear();
		iconBytes.clear();
	}

	private void drawSidePanels(GuiGraphicsExtractor g) {
		int side = Math.min(SIDE_MAX, (width - 168) / 2 - 24);
		if (side < SIDE_MIN) return;
		int bottom = height - 46;
		leftPanel(g, 10, 36, 10 + side, bottom);
		rightPanel(g, width - 10 - side, showPerformanceNotice() ? 66 : 10, width - 10, bottom);
	}

	private void card(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		Theme.notched(g, x1, y1, x2, y2, 4, 0xC00A0B10);
		Theme.notchedOutline(g, x1, y1, x2, y2, 4, Theme.LINE);
	}

	private void leftPanel(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		int supportH = 56, newsBottom = y2 - supportH - 6;
		if (newsBottom - y1 >= 80) {
			card(g, x1, y1, x2, newsBottom);
			Theme.spaced(g, L.up("home.news"), x1 + 8, y1 + 7, Theme.MUTED, 1);
			List<News.Article> articles = News.articles();
			int y = y1 + 20, cardH = 52;
			if (articles.isEmpty()) {
				List<FormattedCharSequence> empty = font.split(FormattedText.of(L.t("home.newsEmpty")), x2 - x1 - 16);
				for (int i = 0; i < empty.size(); i++) g.text(font, empty.get(i), x1 + 8, y + 2 + i * 10, Theme.FAINT, false);
			}
			for (News.Article article : articles) {
				if (y + cardH > newsBottom - 6) break;
				newsCard(g, article, x1 + 6, y, x2 - 6, y + cardH);
				y += cardH + 4;
			}
		}
		supportCard(g, x1, y2 - supportH, x2, y2);
	}

	private void newsCard(GuiGraphicsExtractor g, News.Article article, int x1, int y1, int x2, int y2) {
		boolean hov = hit(x1, y1, x2, y2, () -> Blaze3D.openUri(URI.create(article.url())));
		g.fill(x1, y1, x2, y2, 0xFF12141A);
		if (!article.image().isEmpty()) {
			PcTextures.Image image = PcTextures.get("news:" + article.url(), article::pixels);
			if (image != null) image.cover(g, x1, y1, x2 - x1, y2 - y1);
		}
		g.fillGradient(x1, y1 + 14, x2, y2, 0x00000000, 0xE8000000);
		g.text(font, Theme.ellipsize(article.title(), x2 - x1 - 10), x1 + 5, y2 - 22, Theme.TEXT, true);
		g.text(font, article.date(), x1 + 5, y2 - 11, Theme.MUTED, true);
		if (hov) g.outline(x1, y1, x2 - x1, y2 - y1, Theme.accent());
	}

	private void supportCard(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		card(g, x1, y1, x2, y2);
		g.text(font, Theme.ellipsize(L.t("support.home"), x2 - x1 - 34), x1 + 8, y1 + 7, Theme.MUTED, false);
		if (iconButton(g, x2 - 22, y1 + 4, 15, "folder", Support::openGameFolder)) tipNow(L.t("support.folderHint"));
		int gap = 4, mid = (x1 + x2 - gap) / 2, by = y1 + 22;
		communityTile(g, x1 + 6, by, mid, y2 - 6, "DISCORD", L.t("support.discordSub"), 0xFF5865F2, Support.discord(), 0);
		communityTile(g, mid + gap, by, x2 - 6, y2 - 6, L.up("support.web"), L.t("support.webSub"), Theme.accent(), Support.website(), 3);
	}

	/** Patron logolu, parıltılı ve kıvılcımlı bağlantı kutucuğu; adres boşken "Yakında" görünür. */
	private void communityTile(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, String title, String subtitle, int color, String url, int phase) {
		Runnable open = Support.opener(url);
		boolean hov = hit(x1, y1, x2, y2, open != null ? open : () -> {});
		if (hov && open == null) tipNow(L.t("support.soon"));
		float now = System.nanoTime() / 1e9f + phase, pulse = (float) (Math.sin(now * 2.6f) * 0.5f + 0.5f);
		int w = x2 - x1, h = y2 - y1;
		Theme.notched(g, x1, y1, x2, y2, 3, Theme.mix(0xF00A0B10, Theme.withAlpha(color, 0xF0), hov ? 0.55f : 0.22f + pulse * 0.14f));
		g.enableScissor(x1, y1, x2, y2);
		// Üstünden geçen parıltı.
		int band = (int) ((now * 0.45f % 1f) * (w * 2.4f)) - w / 2;
		for (int i = 0; i < 8; i++) g.fill(x1 + band + i, y1, x1 + band + i + 1, y2, 0x2AFFFFFF);
		// Yükselen kıvılcımlar.
		for (int i = 0; i < 8; i++) {
			float life = (now * (0.28f + i * 0.035f) + i * 0.37f) % 1f;
			int px = x1 + (i * 37 + 9) % w, py = y2 - (int) (life * (h + 3));
			int size = i % 3 == 0 ? 2 : 1, alpha = (int) (220 * (1 - life));
			g.fill(px, py, px + size, py + size, Theme.withAlpha(Theme.mix(color, 0xFFFFFFFF, 0.5f), alpha));
		}
		g.disableScissor();
		Theme.notchedOutline(g, x1, y1, x2, y2, 3, Theme.withAlpha(color, hov ? 0xFF : (int) (120 + pulse * 110)));
		int logo = h - 8, ly = y1 + 4;
		if (phase == 0) Theme.discordLogo(g, x1 + 4, ly, logo);
		else Theme.logo(g, x1 + 4, ly, logo);
		int tx = x1 + 4 + logo + 4, room = x2 - tx - 3;
		Theme.scaledText(g, Theme.ellipsize(title, room), tx, y1 + 5, 1f, Theme.TEXT, false);
		Theme.scaledText(g, Theme.ellipsize(open == null ? L.t("support.soon") : subtitle, (int) (room / 0.75f)), tx, y1 + 16, 0.75f, Theme.MUTED, false);
	}

	private void rightPanel(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		if (servers == null) {
			servers = new ArrayList<>(PClientServersScreen.readFeatured(minecraft));
			servers.sort(Comparator.comparingInt(l -> -(l.sponsored() ? 2 : 0) - (l.featured() ? 1 : 0)));
		}
		int height = y2 - y1, rowH = 26, serverRows = Math.min(3, Math.min(servers.size(), Math.max(1, (height - 110) / rowH)));
		int split = y1;
		if (!servers.isEmpty() && height >= 120) {
			split = y1 + 22 + serverRows * rowH + 4;
			card(g, x1, y1, x2, split);
			sectionHeader(g, L.up("home.servers"), x1, y1, x2, () -> open(new PClientServersScreen(this)), false);
			for (int i = 0; i < serverRows; i++) serverRow(g, servers.get(i), x1 + 6, y1 + 22 + i * rowH, x2 - 6);
			split += 6;
		}
		if (y2 - split >= 60) modrinthCard(g, x1, split, x2, y2);
	}

	private void sectionHeader(GuiGraphicsExtractor g, String title, int x1, int y1, int x2, Runnable all, boolean modrinth) {
		int tx = x1 + 8;
		if (modrinth) {
			Theme.modrinthLogo(g, tx, y1 + 5, 11);
			tx += 15;
		}
		Theme.spaced(g, title, tx, y1 + 7, modrinth ? Theme.MODRINTH_GREEN : Theme.MUTED, 1);
		String label = L.t("home.seeAll");
		int lx = x2 - 8 - font.width(label);
		boolean hov = hit(lx - 2, y1 + 4, x2 - 6, y1 + 17, all);
		g.text(font, label, lx, y1 + 7, hov ? Theme.TEXT : Theme.FAINT, false);
	}

	private void serverRow(GuiGraphicsExtractor g, PClientServersScreen.Listed listed, int x1, int y, int x2) {
		ServerData data = pings.computeIfAbsent(listed.address(), a -> new ServerData(listed.name(), a, ServerData.Type.OTHER));
		PClientServersScreen.ping(minecraft, pinger, data);
		g.fill(x1, y, x1 + 20, y + 20, 0xFF16181F);
		FaviconTexture favicon = favicon(data);
		if (favicon != null) g.blit(RenderPipelines.GUI_TEXTURED, favicon.textureLocation(), x1, y, 0f, 0f, 20, 20, 20, 20);
		else g.centeredText(font, listed.name().isEmpty() ? "?" : listed.name().substring(0, 1).toUpperCase(Locale.ROOT), x1 + 10, y + 6, Theme.accent());
		int joinW = 40, joinX = x2 - joinW, tx = x1 + 25;
		g.text(font, Theme.ellipsize(listed.name(), joinX - tx - 4), tx, y + 2, Theme.TEXT, false);
		boolean reachable = data.players != null;
		String status = reachable ? L.t("home.playersPing", data.players.online(), data.ping)
			: data.state() == ServerData.State.UNREACHABLE ? L.t("servers.offline") : L.t("servers.checking");
		g.text(font, Theme.ellipsize(status, joinX - tx - 4), tx, y + 12, reachable ? 0xFF4ADE80 : Theme.FAINT, false);
		button(g, joinX, y + 2, x2, y + 18, L.up("servers.join"), Style.SECONDARY, () -> {
			if (ServerAddress.isValidAddress(data.ip)) ConnectScreen.startConnecting(this, minecraft, ServerAddress.parseString(data.ip), data, false, null);
		});
	}

	private FaviconTexture favicon(ServerData d) {
		byte[] bytes = d.getIconBytes();
		if (bytes == null || Arrays.equals(bytes, iconBytes.get(d.ip))) return icons.get(d.ip);
		iconBytes.put(d.ip, bytes);
		FaviconTexture texture = icons.computeIfAbsent(d.ip, ip -> FaviconTexture.forServer(minecraft.getTextureManager(), ip));
		try {
			texture.upload(NativeImage.read(bytes));
		} catch (Exception e) {
			texture.clear();
			icons.remove(d.ip).close();
			return null;
		}
		return texture;
	}

	private static void requestTrending() {
		if (trendingRequested) return;
		trendingRequested = true;
		var resources = Modrinth.search(Modrinth.Kind.RESOURCE, "", 0, "follows", List.of());
		var shaders = Modrinth.search(Modrinth.Kind.SHADER, "", 0, "follows", List.of());
		resources.thenCombine(shaders, (r, s) -> {
			List<Modrinth.Hit> mixed = new ArrayList<>();
			for (int i = 0; i < 4; i++) {
				if (i < s.hits().size()) mixed.add(s.hits().get(i));
				if (i < r.hits().size()) mixed.add(r.hits().get(i));
			}
			return mixed;
		}).whenComplete((list, error) -> {
			if (error == null) trending = list;
			else trendingRequested = false;
		});
	}

	private void modrinthCard(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		requestTrending();
		card(g, x1, y1, x2, y2);
		Theme.notchedOutline(g, x1, y1, x2, y2, 4, Theme.withAlpha(Theme.MODRINTH_GREEN, 0x50));
		sectionHeader(g, "MODRINTH", x1, y1, x2, () -> open(new PClientModrinthScreen(this)), true);
		int y = y1 + 22, rowH = 30, listEnd = y2 - 12;
		Theme.scaledText(g, Theme.ellipsize(L.t("modrinth.unofficial"), (int) ((x2 - x1 - 12) / 0.75f)), x1 + 6, y2 - 10, 0.75f, Theme.FAINT, false);
		if (trending.isEmpty()) g.text(font, L.t("modrinth.loading"), x1 + 8, y + 2, Theme.FAINT, false);
		for (Modrinth.Hit hit : trending) {
			if (y + rowH > listEnd) break;
			boolean hov = hit(x1 + 4, y, x2 - 4, y + rowH - 2, () -> open(new PClientModrinthScreen(this, hit)));
			if (hov) g.fill(x1 + 4, y, x2 - 4, y + rowH - 2, 0x18FFFFFF);
			PcTextures.Image image = hit.icon().isEmpty() ? null : PcTextures.get("mr:" + hit.icon(), () -> Modrinth.icon(hit.icon()));
			if (image != null) image.blit(g, x1 + 6, y + 2, 24, 24);
			else {
				g.fill(x1 + 6, y + 2, x1 + 30, y + 26, 0x20FFFFFF);
				PixelIcons.drawCentered(g, hit.kind() == Modrinth.Kind.SHADER ? "sun" : "image", x1 + 18, y + 14, 1, Theme.FAINT);
			}
			int tx = x1 + 35, room = x2 - tx - 6;
			g.text(font, Theme.ellipsize(hit.title(), room), tx, y + 4, hov ? Theme.MODRINTH_GREEN : Theme.TEXT, false);
			String kind = L.t(hit.kind() == Modrinth.Kind.SHADER ? "home.kindShader" : "home.kindResource");
			g.text(font, Theme.ellipsize(kind, room), tx, y + 15, Theme.FAINT, false);
			y += rowH;
		}
	}

	@Override public boolean shouldCloseOnEsc() { return false; }

	@Override protected String dock() { return "home"; }

	@Override public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float delta) {
		if (!MenuThemes.draw(g, width, height)) extractPanorama(g, delta);
		g.fillGradient(0, 0, width, height, 0x6604050A, 0xB804050A);
	}

	private static String mc(String key) { return L.upper(I18n.get(key)); }

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		int cx = width / 2, w = 168, half = (w - 4) / 2, bh = 18;
		int y = Math.max(8, height / 2 - 118);
		float pulse = (float) (Math.sin(System.nanoTime() / 1e9 * 2.0) * 0.5 + 0.5);
		Theme.notched(g, cx - 30, y, cx + 30, y + 60, 9, Theme.withAlpha(Theme.accent(), (int) (16 + pulse * 20)));
		Theme.notchedOutline(g, cx - 30, y, cx + 30, y + 60, 9, Theme.withAlpha(Theme.accent(), (int) (70 + pulse * 70)));
		Theme.logo(g, cx - 20, y + 9, 42);
		y += 68;
		String p = "P", client = "CLIENT";
		int tw = font.width(p) + Theme.spacedWidth(client, 2) + 2;
		g.pose().pushMatrix();
		g.pose().translate(cx - tw, y);
		g.pose().scale(2, 2);
		g.text(font, p, 0, 0, Theme.accent(), true);
		Theme.spaced(g, client, font.width(p) + 1, 0, Theme.TEXT, 2);
		g.pose().popMatrix();
		y += 22;
		Theme.spacedCentered(g, L.up("home.tagline"), cx, y, Theme.FAINT, 1);
		y += 18;

		int x1 = cx - w / 2, x2 = cx + w / 2;
		button(g, x1, y, x2, y + 20, mc("menu.singleplayer"), Style.PRIMARY, () -> open(new PClientWorldsScreen(this)));
		y += 24;
		button(g, x1, y, x2, y + bh, mc("menu.multiplayer"), Style.SECONDARY, () -> open(new PClientServersScreen(this)));
		y += bh + 4;
		button(g, x1, y, x1 + half, y + bh, L.up("home.modules"), Style.SECONDARY,
			() -> open(new ModulesScreen(ModulesScreen.Tab.MODULES)));
		button(g, x2 - half, y, x2, y + bh, L.up("home.options"), Style.SECONDARY,
			() -> open(new OptionsScreen(this, minecraft.options)));
		y += bh + 4;
		button(g, x1, y, x2, y + bh, mc("menu.quit"), Style.GHOST, minecraft::stop);

		drawSidePanels(g);
		drawPerformanceNotice(g);

		// Alt satır: sürüm ve yasal not (Minecraft lisansı gereği).
		String version = "Minecraft " + SharedConstants.getCurrentVersion().name() + " · PClient " + PClient.version;
		g.text(font, version, 8, height - 14, Theme.FAINT, false);
		// Minecraft lisansı gereği telif notu.
		String legal = "Copyright Mojang AB. Do not distribute!";
		// Alt menünün arkasına taşmaması için küçük yazılır.
		Theme.scaledText(g, legal, width - font.width(legal) * 0.75f - 8, height - 13, 0.75f, Theme.FAINT, false);
		String unofficial = L.t("home.unofficial");
		// Yan panellerin altı ile alt menünün üstü arasındaki boşluğa sığar.
		Theme.scaledText(g, unofficial, (width - font.width(unofficial) * 0.75f) / 2, height - 45, 0.75f, Theme.FAINT, false);
		accountWidget(g);
	}
}
