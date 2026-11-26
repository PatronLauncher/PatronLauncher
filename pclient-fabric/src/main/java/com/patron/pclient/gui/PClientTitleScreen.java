package com.patron.pclient.gui;

import com.mojang.blaze3d.Blaze3D;
import com.mojang.blaze3d.platform.NativeImage;
import com.patron.pclient.L;
import com.google.gson.JsonParser;
import com.patron.pclient.PClient;
import com.patron.pclient.bridge.Modrinth;
import com.patron.pclient.bridge.News;
import com.patron.pclient.bridge.Patron;
import com.patron.pclient.bridge.Social;
import com.patron.pclient.bridge.Support;
import com.patron.pclient.config.PClientConfig;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.modules.SoonModule;
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
import net.minecraft.client.gui.components.PlayerSkinWidget;
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

	// --- Ana sayfa panelleri: solda profil (Essential tarzı), sağda sunucular, haberler ve Modrinth ---

	private static final int SIDE_MIN = 140, SIDE_MAX = 210;
	/** Soldaki 3D oyuncu modeli (sürükleyerek döndürülür). */
	private PlayerSkinWidget skinWidget;
	/** Haber listesinin kaydırması ve son çizildiği alan (tekerlek için). */
	private int newsScroll, newsMax, newsX1, newsX2, newsY1, newsY2;

	@Override protected void init() {
		super.init();
		skinWidget = new PlayerSkinWidget(60, 100, minecraft.getEntityModels(), minecraft.getSkinManager().createLookup(minecraft.getGameProfile(), false));
		addWidget(skinWidget);
		if (Patron.state() == Patron.State.SIGNED_IN) Social.refreshFriends();
	}

	@Override public boolean mouseScrolled(double x, double y, double h, double v) {
		if (!overlayOpen() && x >= newsX1 && x < newsX2 && y >= newsY1 && y < newsY2) {
			newsScroll = Math.max(0, Math.min(newsMax, newsScroll - (int) Math.round(v * 24)));
			return true;
		}
		return super.mouseScrolled(x, y, h, v);
	}
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
		if (side < SIDE_MIN) {
			// Panellerin sığmadığı dar pencerede model gizlenir (sürükleme alanı da kapanır).
			skinWidget.setSize(0, 0);
			return;
		}
		int bottom = height - 46;
		leftPanel(g, 10, 36, 10 + side, bottom);
		rightPanel(g, width - 10 - side, showPerformanceNotice() ? 66 : 10, width - 10, bottom);
	}

	private void card(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		Theme.notched(g, x1, y1, x2, y2, 4, 0xC00A0B10);
		Theme.notchedOutline(g, x1, y1, x2, y2, 4, Theme.LINE);
	}

	private void leftPanel(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		int supportH = 56, profileBottom = y2 - supportH - 6;
		if (profileBottom - y1 >= 120) profilePanel(g, x1, y1, x2, profileBottom);
		else skinWidget.setSize(0, 0);
		supportCard(g, x1, y2 - supportH, x2, y2);
	}

	/**
	 * Essential tarzı profil paneli: 3D oyuncu modeli (sürükleyerek döndürülür), Gardırop (kozmetikler) ve
	 * Arkadaşlar düğmeleri, altında çevrimiçi arkadaşlar. Arkadaşa tıklayınca sohbeti açılır.
	 */
	private void profilePanel(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		card(g, x1, y1, x2, y2);
		g.fill(x1 + 4, y1, x1 + 30, y1 + 1, Theme.accent());
		Theme.spaced(g, L.up("home.profile"), x1 + 8, y1 + 7, Theme.MUTED, 1);
		// Sahne: model ve altında parlayan zemin halkası.
		int stageTop = y1 + 18, stageH = Math.max(70, Math.min(126, (y2 - y1) * 42 / 100)), cx = (x1 + x2) / 2;
		int stageBottom = stageTop + stageH;
		g.fillGradient(x1 + 1, stageTop, x2 - 1, stageBottom, 0x00000000, Theme.withAlpha(Theme.accent(), 0x2A));
		float pulse = (float) (Math.sin(System.nanoTime() / 1e9 * 2.2) * 0.5 + 0.5);
		int ringW = stageH * 5 / 10;
		for (int i = 0; i < 4; i++) {
			int w = ringW - i * 6, a = (int) ((40 + pulse * 40) * (4 - i) / 4f);
			g.fill(cx - w / 2, stageBottom - 6 + i, cx + w / 2, stageBottom - 5 + i, Theme.withAlpha(Theme.accent(), a));
		}
		int modelH = stageH - 6, modelW = modelH * 6 / 10;
		skinWidget.setX(cx - modelW / 2);
		skinWidget.setY(stageTop);
		skinWidget.setSize(modelW, modelH);
		skinWidget.extractRenderState(g, mouseX, mouseY, dt);
		if (!overlayOpen() && hover(cx - modelW / 2, stageTop, cx + modelW / 2, stageTop + modelH)) tip("rotate", L.t("home.rotate"));
		// Ad: Minecraft adı, altında PatronLauncher hesabı (girişliyse).
		int y = stageBottom + 3;
		String mcName = minecraft.getUser().getName();
		g.centeredText(font, Theme.ellipsize(mcName, x2 - x1 - 12), cx, y, Theme.TEXT);
		y += 11;
		boolean signedIn = Patron.state() == Patron.State.SIGNED_IN && Patron.name() != null;
		if (signedIn) {
			String pl = Theme.ellipsize(Patron.name(), (int) ((x2 - x1 - 30) / 0.75f));
			int tw = (int) Math.ceil(font.width(pl) * 0.75f), lx = cx - (tw + 11) / 2;
			Theme.logo(g, lx, y, 8);
			Theme.scaledText(g, pl, lx + 11, y + 1, 0.75f, Theme.MUTED, false);
			y += 11;
		}
		y += 3;
		// Gardırop ve Arkadaşlar (alt çubuktan buraya taşındı).
		int mid = (x1 + x2) / 2, unread = Social.unread();
		button(g, x1 + 6, y, mid - 2, y + 18, L.up("home.wardrobe"), Style.SECONDARY,
			() -> open(new ComingSoonScreen((SoonModule) ModuleManager.byId("cosmetics"), this)));
		button(g, mid + 2, y, x2 - 6, y + 18, L.up("home.friends"), Style.SECONDARY, () -> open(new PClientFriendsScreen(this)));
		if (unread > 0) {
			String n = unread > 99 ? "99+" : String.valueOf(unread);
			int bw = font.width(n) + 6;
			Theme.notched(g, x2 - 6 - bw + 3, y - 4, x2 - 3, y + 6, 2, Theme.accent());
			g.text(font, n, x2 - 6 - bw + 6, y - 3, Theme.TEXT, false);
		}
		y += 24;
		friendsMini(g, x1, y, x2, y2 - 4, signedIn);
	}

	/** Çevrimiçi arkadaşlar (oynayanlar önce); sığdığı kadar satır. */
	private void friendsMini(GuiGraphicsExtractor g, int x1, int y, int x2, int bottom, boolean signedIn) {
		if (bottom - y < 24) return;
		g.fill(x1 + 6, y, x2 - 6, y + 1, Theme.LINE);
		y += 5;
		List<Social.Person> online = new ArrayList<>();
		for (Social.Person p : Social.friends()) if (!p.blocked() && p.presence() != null && p.presence().online()) online.add(p);
		online.sort(Comparator.comparing((Social.Person p) -> !p.presence().playing()).thenComparing(Social.Person::username, String.CASE_INSENSITIVE_ORDER));
		String head = L.up("home.friends");
		Theme.scaledText(g, head, x1 + 8, y + 1, 0.75f, Theme.FAINT, false);
		if (signedIn) {
			String count = L.t("home.friendsOnline", online.size());
			Theme.scaledText(g, count, x1 + 8 + font.width(head) * 0.75f + 5, y + 1, 0.75f, online.isEmpty() ? Theme.FAINT : 0xFF3DDC84, false);
			if (iconButton(g, x2 - 20, y - 3, 13, "plus", () -> open(new PClientFriendsScreen(this)))) tipNow(L.t("home.addFriend"));
		}
		y += 12;
		if (!signedIn) {
			for (FormattedCharSequence l : font.split(FormattedText.of(L.t("home.friendsSignin")), x2 - x1 - 16)) {
				if (y + 10 > bottom - 22) break;
				g.text(font, l, x1 + 8, y, Theme.MUTED, false);
				y += 10;
			}
			if (y + 20 <= bottom) button(g, x1 + 6, y + 2, x2 - 6, y + 18, L.t(Patron.busy() ? "patron.opening" : "patron.login"), Style.PRIMARY, Patron::login);
			return;
		}
		if (online.isEmpty()) {
			for (FormattedCharSequence l : font.split(FormattedText.of(L.t("home.friendsNone")), x2 - x1 - 16)) {
				if (y + 10 > bottom) break;
				g.text(font, l, x1 + 8, y, Theme.FAINT, false);
				y += 10;
			}
			return;
		}
		for (Social.Person p : online) {
			if (y + 20 > bottom) break;
			boolean hov = hit(x1 + 4, y, x2 - 4, y + 19, () -> open(new PClientFriendsScreen(this, p.username())));
			if (hov) Theme.notched(g, x1 + 4, y, x2 - 4, y + 19, 2, 0x14FFFFFF);
			Theme.notched(g, x1 + 7, y + 2, x1 + 22, y + 17, 2, Theme.withAlpha(Theme.accent(), 0x40));
			String c = p.display() == null || p.display().isEmpty() ? "?" : p.display().substring(0, 1).toUpperCase(Locale.ROOT);
			g.text(font, c, x1 + 15 - font.width(c) / 2, y + 6, Theme.TEXT, false);
			g.fill(x1 + 19, y + 14, x1 + 23, y + 18, p.presence().playing() ? 0xFF3DDC84 : 0xFF2FB86E);
			int tx = x1 + 27, room = x2 - tx - 6;
			g.text(font, Theme.ellipsize(p.display(), room), tx, y + 1, Theme.TEXT, false);
			Social.Presence pr = p.presence();
			String sub = pr.server() != null ? L.t("friends.playingOn", pr.server()) : pr.version() != null ? L.t("friends.playing", pr.version()) : L.t("friends.online");
			Theme.scaledText(g, Theme.ellipsize(sub, (int) (room / 0.7f)), tx, y + 11, 0.7f, pr.playing() ? 0xFF3DDC84 : Theme.MUTED, false);
			y += 21;
		}
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

	/** Sağ sütun: üstte sunucular, ortada haberler (kaydırılır), en altta küçük Modrinth kartı. */
	private void rightPanel(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		if (servers == null) {
			servers = new ArrayList<>(PClientServersScreen.readFeatured(minecraft));
			servers.sort(Comparator.comparingInt(l -> -(l.sponsored() ? 2 : 0) - (l.featured() ? 1 : 0)));
		}
		int avail = y2 - y1, rowH = 26, mrRowH = 28;
		int serverRows = Math.min(3, servers.size()), mrRows = 3;
		// Haberlere en az 90 piksel kalsın: gerekirse önce Modrinth, sonra sunucular kısalır.
		while (serverRows > 0 && mrRows > 0 && avail - serverBlock(serverRows, rowH) - modrinthBlock(mrRows, mrRowH) < 90) {
			if (mrRows >= serverRows && mrRows > 1) mrRows--;
			else if (serverRows > 1) serverRows--;
			else break;
		}
		int top = y1;
		if (serverRows > 0) {
			int sb = y1 + 22 + serverRows * rowH + 4;
			card(g, x1, y1, x2, sb);
			sectionHeader(g, L.up("home.servers"), x1, y1, x2, () -> open(new PClientServersScreen(this)), false);
			for (int i = 0; i < serverRows; i++) serverRow(g, servers.get(i), x1 + 6, y1 + 22 + i * rowH, x2 - 6);
			top = sb + 6;
		}
		int mrTop = y2 - (22 + mrRows * mrRowH + 12);
		if (mrTop - top >= 60) newsPanel(g, x1, top, x2, mrTop - 6);
		else mrTop = top;
		modrinthCard(g, x1, mrTop, x2, y2);
	}

	private static int serverBlock(int rows, int rowH) { return rows == 0 ? 0 : 22 + rows * rowH + 4 + 6; }
	private static int modrinthBlock(int rows, int rowH) { return 22 + rows * rowH + 12 + 6; }

	/** Haberler: kartlar kaydırılabilir liste; sığmayanlara fare tekerleğiyle ulaşılır. */
	private void newsPanel(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		card(g, x1, y1, x2, y2);
		Theme.spaced(g, L.up("home.news"), x1 + 8, y1 + 7, Theme.MUTED, 1);
		List<News.Article> articles = News.articles();
		int listTop = y1 + 20, listBottom = y2 - 6, cardH = 52;
		newsX1 = x1;
		newsX2 = x2;
		newsY1 = listTop;
		newsY2 = listBottom;
		if (articles.isEmpty()) {
			List<FormattedCharSequence> empty = font.split(FormattedText.of(L.t("home.newsEmpty")), x2 - x1 - 16);
			for (int i = 0; i < empty.size(); i++) g.text(font, empty.get(i), x1 + 8, listTop + 2 + i * 10, Theme.FAINT, false);
			newsMax = 0;
			return;
		}
		int content = articles.size() * (cardH + 4) - 4, view = listBottom - listTop;
		newsMax = Math.max(0, content - view);
		newsScroll = Math.max(0, Math.min(newsScroll, newsMax));
		g.enableScissor(x1 + 1, listTop, x2 - 1, listBottom);
		int y = listTop - newsScroll;
		for (News.Article article : articles) {
			// Görünmeyen kartlar çizilmez ve tıklanmaz.
			if (y + cardH > listTop && y < listBottom) newsCard(g, article, x1 + 6, y, x2 - (newsMax > 0 ? 9 : 6), y + cardH);
			y += cardH + 4;
		}
		g.disableScissor();
		if (newsMax > 0) {
			int barH = Math.max(14, view * view / content), barY = listTop + (view - barH) * newsScroll / newsMax;
			g.fill(x2 - 5, barY, x2 - 3, barY + barH, 0x50FFFFFF);
		}
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
