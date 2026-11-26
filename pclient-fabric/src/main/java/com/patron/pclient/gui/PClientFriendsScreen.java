package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.bridge.Patron;
import com.patron.pclient.bridge.Social;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

/**
 * Oyun içi arkadaşlar ve mesajlar (Essential tarzı): solda arkadaş ekleme, arkadaşlar (çevrimiçi / ne oynuyor),
 * istekler ve gizlilik; sağda canlı sohbet. Veriler site hesabından gelir; site ve launcher'la aynı kutudur.
 * Discord gibi: satıra sağ tık (ya da "⋯") mesaj, profil, sessize alma, sohbeti kapatma, kopyalama, çıkarma ve engelleme.
 */
public final class PClientFriendsScreen extends PcScreen {
	private enum Tab { FRIENDS, REQUESTS, PRIVACY }

	private Tab tab = Tab.FRIENDS;
	/** Sol listenin kaydırması (gizlilik kartları ve uzun arkadaş listesi panele sığmayabilir). */
	private int listScroll, listMax, listX1, listX2, listTop, listBottomY;
	private final PcTextField addField = new PcTextField(16, L.t("friends.addPlaceholder")).onSubmit(this::addFriend);
	private final PcTextField msgField = new PcTextField(500, L.t("friends.placeholder")).onSubmit(this::sendMessage);
	/** Gizlilik kartında "Kaydedildi" işaretinin gösterildiği ayar ve an. */
	private String savedKey;
	private long savedAt;

	public PClientFriendsScreen(Screen parent) {
		super("title.friends", parent);
		addField.allow(c -> Character.isLetterOrDigit(c) && c < 128 || c == '_');
	}

	/** Ana menüdeki profil panelinden doğrudan bir sohbete açılır. */
	public PClientFriendsScreen(Screen parent, String chatWith) {
		this(parent);
		if (chatWith != null) Social.open(chatWith);
	}

	@Override protected String dock() { return "friends"; }

	@Override protected void init() {
		super.init();
		Social.screenOpen = true;
		Social.start();
		Social.refreshAll();
		Patron.refresh();
		if (Social.active() != null) Social.open(Social.active());
	}

	@Override public void removed() {
		Social.screenOpen = false;
		super.removed();
	}

	@Override public boolean mouseScrolled(double x, double y, double h, double v) {
		if (!overlayOpen() && x >= listX1 && x < listX2 + 6 && y >= listTop && y < listBottomY) {
			listScroll = Math.max(0, Math.min(listMax, listScroll - (int) Math.round(v * 22)));
			return true;
		}
		return super.mouseScrolled(x, y, h, v);
	}

	private void addFriend() {
		String name = addField.value().strip();
		if (name.length() < 3) return;
		Social.friendAction("request", name);
		addField.set("");
	}

	private void sendMessage() {
		String text = msgField.value().strip();
		if (text.isEmpty()) return;
		Social.send(text);
		msgField.set("");
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		frame(g, 620, 360, L.up("friends.title"));
		int top = fy + FRAME_HEADER + 8, bottom = fy + fh - 10;
		// Canlı bağlantı göstergesi (başlıkta).
		g.fill(fx + fw - 44, fy + 12, fx + fw - 38, fy + 18, Social.live() ? 0xFF3DDC84 : 0xFFFFB454);
		if (hover(fx + fw - 48, fy + 8, fx + fw - 34, fy + 22)) tipNow(L.t(Social.live() ? "friends.live" : "friends.connecting"));

		if (!Social.signedIn() || Patron.state() != Patron.State.SIGNED_IN) {
			signInPrompt(g, top, bottom);
			return;
		}
		int lx1 = fx + 10, lx2 = fx + 10 + Math.min(220, fw / 2 - 20);
		left(g, lx1, top, lx2, bottom);
		right(g, lx2 + 10, top, fx + fw - 10, bottom);
	}

	private void signInPrompt(GuiGraphicsExtractor g, int top, int bottom) {
		int cx = fx + fw / 2, y = top + (bottom - top) / 2 - 40;
		PixelIcons.drawCentered(g, "chat", cx, y, 3, Theme.accent());
		y += 26;
		for (FormattedCharSequence l : font.split(FormattedText.of(L.t("friends.signin")), fw - 80)) {
			g.text(font, l, cx - font.width(l) / 2, y, Theme.TEXT, false);
			y += 11;
		}
		y += 8;
		int bw = Math.min(fw - 80, font.width(L.t("patron.login")) + 40);
		Patron.State st = Patron.state();
		if (st == Patron.State.PENDING) {
			String code = L.t("patron.code") + ": " + (Patron.code() == null ? "…" : Patron.code());
			g.text(font, code, cx - font.width(code) / 2, y + 5, 0xFFFFB454, false);
			y += 20;
			button(g, cx - bw / 2, y, cx + bw / 2, y + 20, L.up("patron.reopen"), Style.SECONDARY, Patron::reopen);
		} else if (st == Patron.State.SIGNED_IN) {
			String w = L.t("friends.connecting");
			g.text(font, w, cx - font.width(w) / 2, y + 5, Theme.MUTED, false);
		} else {
			button(g, cx - bw / 2, y, cx + bw / 2, y + 22, L.t(Patron.busy() ? "patron.opening" : "patron.login"), Style.PRIMARY, Patron::login);
		}
	}

	// --- Menü ve onay (Discord tarzı) ---

	private void confirmBlock(String username, String display) {
		askConfirm("lock", L.t("friends.blockTitle", display), L.t("friends.blockText"), L.t("friends.block"),
			() -> Social.friendAction("block", username));
	}

	private void confirmRemove(String username, String display) {
		askConfirm("trash", L.t("friends.removeTitle", display), L.t("friends.removeText"), L.t("friends.remove"),
			() -> Social.friendAction("remove", username));
	}

	// --- Arkadaşın sunucusuna katılma ---

	/** Arkadaş bir sunucudaysa adresi; değilse (ya da engelliyse) null. */
	private static String friendServer(Social.Person f) {
		if (f == null || f.blocked() || f.presence() == null) return null;
		String a = f.presence().server();
		return a != null && ServerAddress.isValidAddress(a) ? a : null;
	}

	private boolean alreadyOn(String address) {
		ServerData cur = minecraft.getCurrentServer();
		return cur != null && cur.ip.equalsIgnoreCase(address);
	}

	/** Bir dünyadaysa önce sorar (dünya kaydedilip çıkılır), sonra arkadaşın sunucusuna bağlanır. */
	private void joinFriend(Social.Person f) {
		String address = friendServer(f);
		if (address == null || alreadyOn(address)) return;
		Runnable go = () -> {
			if (minecraft.level != null) minecraft.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE);
			ConnectScreen.startConnecting(this, minecraft, ServerAddress.parseString(address), new ServerData(address, address, ServerData.Type.OTHER), false, null);
		};
		if (minecraft.level == null) go.run();
		else askConfirm("server", L.t("friends.joinTitle", address), L.t(minecraft.isLocalServer() ? "friends.joinTextWorld" : "friends.joinTextServer"), L.t("friends.join"), go);
	}

	/** Bir oyuncu için seçenekler (arkadaş satırı, sohbet satırı ve sohbet başlığı ortak). */
	private List<MenuItem> personMenu(String username, String display) {
		Social.Person f = Social.friend(username);
		boolean blocked = Social.isBlocked(username), muted = Social.isMuted(username);
		List<MenuItem> items = new ArrayList<>();
		if (!blocked) items.add(new MenuItem("chat", L.t("friends.message"), () -> Social.open(username), false));
		String server = friendServer(f);
		if (server != null && !alreadyOn(server)) items.add(new MenuItem("server", L.t("friends.joinServer"), () -> joinFriend(f), false));
		items.add(new MenuItem("user", L.t("friends.profile"), () -> Social.openProfile(username), false));
		items.add(new MenuItem("volume", L.t(muted ? "friends.unmute" : "friends.mute"), () -> Social.setPref(username, !muted, null), false));
		if (Social.chat(username) != null) items.add(new MenuItem("close", L.t("friends.closeChat"), () -> Social.setPref(username, null, true), false));
		items.add(new MenuItem("list", L.t("friends.copyName"), () -> Social.copyName(username), false));
		items.add(MenuItem.sep());
		if (f != null) items.add(new MenuItem("trash", L.t("friends.remove"), () -> confirmRemove(username, display), true));
		items.add(blocked
			? new MenuItem("lock", L.t("friends.unblock"), () -> Social.friendAction("unblock", username), false)
			: new MenuItem("lock", L.t("friends.block"), () -> confirmBlock(username, display), true));
		return items;
	}

	private Runnable menuAtMouse(String username, String display) {
		return () -> openMenu(mouseX, mouseY, personMenu(username, display));
	}

	/** Satırın sağındaki "⋯" düğmesi; menüyü düğmenin altında açar. */
	private void moreButton(GuiGraphicsExtractor g, int x, int y, String username, String display) {
		boolean hov = hit(x, y, x + 14, y + 14, () -> openMenu(x, y + 16, personMenu(username, display)));
		Theme.notched(g, x, y, x + 14, y + 14, 2, hov ? 0x2EFFFFFF : 0x00000000);
		int c = hov ? Theme.TEXT : Theme.MUTED;
		for (int i = 0; i < 3; i++) g.fill(x + 3 + i * 3, y + 6, x + 5 + i * 3, y + 8, c);
		if (hov) tipNow(L.t("friends.more"));
	}

	/** Küçük etiket (ör. ENGELLENDİ); döner: etiketin sol kenarı. */
	private int tag(GuiGraphicsExtractor g, int right, int y, String text, int color) {
		String t = L.upper(text);
		int w = (int) Math.ceil(font.width(t) * 0.7f) + 8, left = right - w;
		Theme.notched(g, left, y, right, y + 10, 2, Theme.withAlpha(color, 0x26));
		Theme.notchedOutline(g, left, y, right, y + 10, 2, Theme.withAlpha(color, 0x80));
		Theme.scaledText(g, t, left + 4, y + 2, 0.7f, color, false);
		return left;
	}

	// --- Sol: ekleme, sekmeler, liste ---

	private void left(GuiGraphicsExtractor g, int x1, int y, int x2, int bottom) {
		textField(g, x1, y, x2 - 24, y + 18, addField);
		if (button(g, x2 - 20, y, x2, y + 18, "+", Style.PRIMARY, this::addFriend)) tipNow(L.t("friends.add"));
		y += 24;
		int tw = (x2 - x1) / 3;
		Tab[] tabs = Tab.values();
		for (int i = 0; i < tabs.length; i++) {
			Tab t = tabs[i];
			int tx1 = x1 + i * tw, tx2 = i == tabs.length - 1 ? x2 : tx1 + tw - 2;
			String label = L.t("friends.tab." + t.name().toLowerCase(java.util.Locale.ROOT));
			if (t == Tab.REQUESTS && !Social.incoming().isEmpty()) label += " " + Social.incoming().size();
			boolean on = tab == t;
			boolean hov = hit(tx1, y, tx2, y + 16, () -> {
				tab = t;
				listScroll = 0;
			});
			Theme.notched(g, tx1, y, tx2, y + 16, 2, on ? Theme.withAlpha(Theme.accent(), 0x40) : hov ? 0x1EFFFFFF : 0x0CFFFFFF);
			String fit = Theme.ellipsize(label, tx2 - tx1 - 6);
			g.text(font, fit, (tx1 + tx2) / 2 - font.width(fit) / 2, y + 4, on ? Theme.TEXT : Theme.MUTED, false);
		}
		y += 22;
		int listBottom = bottom - (Social.note() != null ? 14 : 0);
		listX1 = x1;
		listX2 = x2;
		listTop = y;
		listBottomY = listBottom;
		g.enableScissor(x1, y, x2, listBottom);
		int start = y - listScroll;
		int end = switch (tab) {
			case FRIENDS -> friendList(g, x1, start, x2, listBottom);
			case REQUESTS -> requestList(g, x1, start, x2);
			case PRIVACY -> privacy(g, x1, start, x2);
		};
		g.disableScissor();
		// Kaydırma sınırı içeriğe göre; uzun listede sağda ince çubuk.
		int content = end - start, view = listBottom - y;
		listMax = Math.max(0, content - view);
		listScroll = Math.max(0, Math.min(listScroll, listMax));
		if (listMax > 0) {
			int barH = Math.max(14, view * view / Math.max(1, content)), barY = y + (view - barH) * listScroll / listMax;
			g.fill(x2 + 3, barY, x2 + 5, barY + barH, 0x50FFFFFF);
		}
		if (Social.note() != null) g.text(font, Theme.ellipsize(Social.note(), x2 - x1), x1, bottom - 10, 0xFFFFB454, false);
	}

	private static int presenceColor(Social.Presence p) {
		if (p == null) return 0xFF4B5160;
		return p.playing() ? 0xFF3DDC84 : p.online() ? 0xFF2FB86E : 0xFF4B5160;
	}

	private static String presenceText(Social.Presence p) {
		if (p == null || !p.online()) return L.t("friends.offline");
		if (p.server() != null) return L.t("friends.playingOn", p.server());
		if (p.version() != null) return L.t("friends.playing", p.version());
		return L.t("friends.online");
	}

	private void avatar(GuiGraphicsExtractor g, int x, int y, String name, Integer dotColor, boolean dim) {
		Theme.notched(g, x, y, x + 16, y + 16, 2, dim ? 0x18FFFFFF : Theme.withAlpha(Theme.accent(), 0x40));
		String c = name == null || name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase();
		g.text(font, c, x + 8 - font.width(c) / 2, y + 4, dim ? Theme.FAINT : Theme.TEXT, false);
		if (dotColor != null) g.fill(x + 12, y + 12, x + 17, y + 17, dotColor);
	}

	private static int rank(Social.Person p) {
		if (p.blocked()) return -1;
		return p.presence() == null ? 0 : p.presence().playing() ? 2 : p.presence().online() ? 1 : 0;
	}

	/** Döner: içeriğin alt kenarı (kaydırma için). Görünür alanın dışındaki satırlar tıklanmaz. */
	private int friendList(GuiGraphicsExtractor g, int x1, int y, int x2, int bottom) {
		List<Social.Person> list = new ArrayList<>(Social.friends());
		list.sort((a, b) -> rank(b) != rank(a) ? rank(b) - rank(a) : a.username().compareToIgnoreCase(b.username()));
		if (list.isEmpty()) {
			for (FormattedCharSequence l : font.split(FormattedText.of(L.t("friends.empty")), x2 - x1 - 4)) {
				g.text(font, l, x1 + 2, y + 4, Theme.MUTED, false);
				y += 10;
			}
			return y + 6;
		}
		for (Social.Person f : list) {
			// Sürüm uyumunu sunucu kendisi bildirir; burada engellenmez.
			String server = friendServer(f);
			int rh = 24;
			if (y + rh < listTop || y > bottom) {
				y += rh + 2;
				continue;
			}
			boolean on = f.username().equals(Social.active());
			// Sol tık sohbeti açar (engelliyse menü), sağ tık seçenekleri açar.
			boolean hov = hit(x1, y, x2, y + rh, f.blocked() ? menuAtMouse(f.username(), f.display()) : () -> Social.open(f.username()),
				menuAtMouse(f.username(), f.display()));
			Theme.notched(g, x1, y, x2, y + rh, 3, on ? Theme.withAlpha(Theme.accent(), 0x2E) : hov ? 0x14FFFFFF : 0x06FFFFFF);
			avatar(g, x1 + 4, y + 4, f.display(), f.blocked() ? null : presenceColor(f.presence()), f.blocked());
			int right = x2 - 4;
			if (hov || on) {
				moreButton(g, right - 14, y + 5, f.username(), f.display());
				right -= 18;
			}
			if (server != null) {
				if (alreadyOn(server)) right = tag(g, right, y + 7, L.t("friends.sameServer"), 0xFF3DDC84) - 4;
				else {
					String label = L.upper(L.t("friends.join"));
					int bw = (int) Math.ceil(font.width(label) * 0.75f) + 10;
					boolean jh = hit(right - bw, y + 5, right, y + 19, () -> joinFriend(f));
					Theme.notched(g, right - bw, y + 5, right, y + 19, 2, jh ? 0xFF3DDC84 : 0x403DDC84);
					Theme.notchedOutline(g, right - bw, y + 5, right, y + 19, 2, 0xC03DDC84);
					Theme.scaledText(g, label, right - bw + 5, y + 9, 0.75f, jh ? 0xFF06140C : 0xFF7EF0AE, false);
					if (jh) tipNow(L.t("friends.joinTip", server));
					right -= bw + 4;
				}
			}
			if (f.blocked()) right = tag(g, right, y + 7, L.t("friends.blockedTag"), 0xFFFF7A8A) - 4;
			else if (f.muted()) {
				PixelIcons.drawCentered(g, "volume", right - 5, y + 12, 1, Theme.FAINT);
				right -= 13;
			}
			int room = right - (x1 + 25);
			g.text(font, Theme.ellipsize(f.display(), room), x1 + 25, y + 3, f.blocked() ? Theme.MUTED : Theme.TEXT, false);
			String sub = f.blocked() ? L.t("friends.blockedTag") : presenceText(f.presence());
			Theme.scaledText(g, Theme.ellipsize(sub, (int) (room / 0.75f)), x1 + 25, y + 14, 0.75f,
				!f.blocked() && f.presence() != null && f.presence().playing() ? 0xFF3DDC84 : Theme.MUTED, false);
			y += rh + 2;
		}
		return y;
	}

	private int requestList(GuiGraphicsExtractor g, int x1, int y, int x2) {
		if (Social.incoming().isEmpty() && Social.outgoing().isEmpty()) {
			g.text(font, L.t("friends.noRequests"), x1 + 2, y + 4, Theme.MUTED, false);
			return y + 16;
		}
		for (Social.Person p : Social.incoming()) {
			Theme.notched(g, x1, y, x2, y + 24, 3, 0x0CFFFFFF);
			avatar(g, x1 + 4, y + 4, p.display(), null, false);
			g.text(font, Theme.ellipsize(p.display(), x2 - x1 - 90), x1 + 25, y + 3, Theme.TEXT, false);
			Theme.scaledText(g, L.t("friends.wantsYou"), x1 + 25, y + 14, 0.75f, Theme.MUTED, false);
			if (button(g, x2 - 63, y + 4, x2 - 45, y + 20, "✓", Style.PRIMARY, () -> Social.friendAction("accept", p.username()))) tipNow(L.t("friends.accept"));
			if (button(g, x2 - 42, y + 4, x2 - 24, y + 20, "✕", Style.GHOST, () -> Social.friendAction("decline", p.username()))) tipNow(L.t("friends.decline"));
			if (iconButton(g, x2 - 21, y + 4, 16, "lock", () -> confirmBlock(p.username(), p.display()))) tipNow(L.t("friends.block"));
			y += 26;
		}
		for (Social.Person p : Social.outgoing()) {
			Theme.notched(g, x1, y, x2, y + 24, 3, 0x06FFFFFF);
			avatar(g, x1 + 4, y + 4, p.display(), null, false);
			g.text(font, Theme.ellipsize(p.display(), x2 - x1 - 50), x1 + 25, y + 3, Theme.TEXT, false);
			Theme.scaledText(g, L.t("friends.sent"), x1 + 25, y + 14, 0.75f, Theme.MUTED, false);
			if (button(g, x2 - 21, y + 4, x2 - 3, y + 20, "✕", Style.GHOST, () -> Social.friendAction("cancel", p.username()))) tipNow(L.t("friends.cancel"));
			y += 26;
		}
		return y;
	}

	private static final String[] POLICIES = { "everyone", "friends", "nobody" };
	private static final String[] REQUEST_POLICIES = { "everyone", "nobody" };

	private static int indexOf(String value, String[] options) {
		for (int i = 0; i < options.length; i++) if (options[i].equals(value)) return i;
		return 0;
	}

	private int privacy(GuiGraphicsExtractor g, int x1, int y, int x2) {
		for (FormattedCharSequence l : font.split(FormattedText.of(L.t("friends.privacyHelp")), x2 - x1 - 4)) {
			g.text(font, l, x1 + 2, y, Theme.MUTED, false);
			y += 10;
		}
		y += 6;
		y = policyCard(g, x1, y, x2, "chat", "friends.privacy.dm", "friends.privacy.dmHelp", "dmPolicy", Social.dmPolicy(), POLICIES);
		y = policyCard(g, x1, y, x2, "eye", "friends.privacy.presence", "friends.privacy.presenceHelp", "presencePolicy", Social.presencePolicy(), POLICIES);
		y = policyCard(g, x1, y, x2, "user", "friends.privacy.requests", "friends.privacy.requestsHelp", "friendPolicy", Social.friendPolicy(), REQUEST_POLICIES);
		// Bu cihazdaki bildirim tercihleri (sitede değil, PClient ayarlarında saklanır).
		y += 2;
		g.fill(x1, y, x2, y + 1, Theme.LINE);
		y += 8;
		var cfg = com.patron.pclient.config.PClientConfig.get();
		g.text(font, Theme.ellipsize(L.t("friends.notify.toasts"), x2 - x1 - 34), x1 + 2, y + 2, Theme.TEXT, false);
		toggleSwitch(g, x2 - 26, y + 1, cfg.messageToasts, () -> {
			cfg.messageToasts = !cfg.messageToasts;
			com.patron.pclient.config.PClientConfig.save();
		});
		y += 18;
		g.text(font, Theme.ellipsize(L.t("friends.notify.sound"), x2 - x1 - 34), x1 + 2, y + 2, cfg.messageToasts ? Theme.TEXT : Theme.FAINT, false);
		toggleSwitch(g, x2 - 26, y + 1, cfg.messageSound, () -> {
			cfg.messageSound = !cfg.messageSound;
			com.patron.pclient.config.PClientConfig.save();
			if (cfg.messageSound) MessageToasts.show(L.t("friends.notify.testFrom"), L.t("friends.notify.testBody"));
		});
		y += 22;
		g.fill(x1, y, x2, y + 1, Theme.LINE);
		y += 8;
		g.text(font, L.t("friends.blocked"), x1 + 2, y, Theme.TEXT, false);
		y += 12;
		if (Social.blocked().isEmpty()) g.text(font, L.t("friends.noBlocked"), x1 + 2, y, Theme.MUTED, false);
		for (Social.Person p : Social.blocked()) {
			boolean hov = hit(x1, y - 1, x2, y + 17, () -> {}, menuAtMouse(p.username(), p.display()));
			if (hov) g.fill(x1, y - 1, x2, y + 17, 0x0CFFFFFF);
			String label = p.display() + (Social.friend(p.username()) != null ? "  · " + L.t("friends.isFriend") : "");
			g.text(font, Theme.ellipsize(label, x2 - x1 - 76), x1 + 2, y + 4, Theme.MUTED, false);
			button(g, x2 - 70, y, x2, y + 16, L.t("friends.unblock"), Style.GHOST, () -> Social.friendAction("unblock", p.username()));
			y += 20;
		}
		return y + (Social.blocked().isEmpty() ? 14 : 4);
	}

	/**
	 * Gizlilik kartı: kesik köşeli çerçeve, simge, başlık, kısa açıklama ve kayan vurgulu seçim.
	 * Kaydedilince kart kısa süre yeşil parlar ve "Kaydedildi" görünür.
	 */
	private int policyCard(GuiGraphicsExtractor g, int x1, int y, int x2, String icon, String titleKey, String helpKey, String key, String value, String[] options) {
		int h = 50;
		float glow = key.equals(savedKey) ? Math.max(0f, 1f - (System.nanoTime() - savedAt) / 1e9f / 1.6f) : 0f;
		boolean hov = hover(x1, y, x2, y + h);
		Theme.notched(g, x1, y, x2, y + h, 4, hov ? 0x14FFFFFF : 0x0AFFFFFF);
		int outline = glow > 0 ? Theme.mix(Theme.LINE, 0xFF3DDC84, glow) : hov ? Theme.withAlpha(Theme.accent(), 0x70) : Theme.LINE;
		Theme.notchedOutline(g, x1, y, x2, y + h, 4, outline);
		g.fill(x1 + 4, y, x1 + 22, y + 1, Theme.accent());
		Theme.notched(g, x1 + 6, y + 6, x1 + 20, y + 20, 2, Theme.withAlpha(Theme.accent(), 0x30));
		PixelIcons.drawCentered(g, icon, x1 + 13, y + 13, 1, Theme.accent());
		int tx = x1 + 25, room = x2 - tx - 6;
		if (glow > 0) {
			String ok = L.t("friends.saved");
			int ow = (int) Math.ceil(font.width(ok) * 0.75f);
			Theme.scaledText(g, ok, x2 - 6 - ow, y + 6, 0.75f, Theme.withAlpha(0xFF3DDC84, (int) (255 * Math.min(1f, glow * 2))), false);
			room -= ow + 6;
		}
		g.text(font, Theme.ellipsize(L.t(titleKey), room), tx, y + 5, Theme.TEXT, false);
		Theme.scaledText(g, Theme.ellipsize(L.t(helpKey), (int) ((x2 - tx - 6) / 0.7f)), tx, y + 15, 0.7f, Theme.MUTED, false);
		String[] labels = new String[options.length];
		for (int i = 0; i < options.length; i++) labels[i] = L.t("friends.policy." + (options[i].equals("friends") ? "friendsShort" : options[i]));
		segmented(g, x1 + 6, y + 27, x2 - 6, y + h - 6, key, labels, indexOf(value, options), i -> {
			Social.setPrivacy(key, options[i]);
			savedKey = key;
			savedAt = System.nanoTime();
		});
		return y + h + 6;
	}

	// --- Sağ: sohbet ---

	private void right(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		Theme.notched(g, x1, y1, x2, y2, 4, 0x40000000);
		Theme.notchedOutline(g, x1, y1, x2, y2, 4, Theme.LINE);
		String active = Social.active();
		if (active == null) {
			chatList(g, x1, y1, x2, y2);
			return;
		}
		if (iconButton(g, x1 + 6, y1 + 5, 14, "back", Social::close)) tipNow(L.t("common.back"));
		Social.Person f = Social.friend(active);
		String name = Social.activeDisplay() == null ? active : Social.activeDisplay();
		boolean blocked = f != null && f.blocked();
		// Başlığa sağ tık da menüyü açar.
		hit(x1 + 22, y1 + 2, x2 - 24, y1 + 22, () -> {}, menuAtMouse(active, name));
		avatar(g, x1 + 24, y1 + 4, name, f == null || blocked ? null : presenceColor(f.presence()), blocked);
		g.text(font, Theme.ellipsize(name, x2 - x1 - 80), x1 + 46, y1 + 5, Theme.TEXT, false);
		if (f != null) Theme.scaledText(g, blocked ? L.t("friends.blockedTag") : presenceText(f.presence()), x1 + 46, y1 + 15, 0.75f, blocked ? 0xFFFF7A8A : Theme.MUTED, false);
		moreButton(g, x2 - 20, y1 + 5, active, name);
		g.fill(x1 + 1, y1 + 24, x2 - 1, y1 + 25, Theme.LINE);
		int composerTop = y2 - 26;
		messages(g, x1 + 6, y1 + 28, x2 - 6, composerTop - 4);
		if (Social.canSend()) {
			textField(g, x1 + 6, composerTop + 4, x2 - 54, composerTop + 22, msgField);
			button(g, x2 - 50, composerTop + 4, x2 - 6, composerTop + 22, L.up("friends.send"), Style.PRIMARY, this::sendMessage);
		} else if (Social.iBlocked()) {
			String unblock = L.t("friends.unblock");
			int bw = font.width(unblock) + 14;
			Theme.scaledText(g, Theme.ellipsize(L.t("friends.youBlocked"), (int) ((x2 - x1 - 24 - bw) / 0.8f)), x1 + 6, composerTop + 10, 0.8f, Theme.MUTED, false);
			button(g, x2 - 6 - bw, composerTop + 4, x2 - 6, composerTop + 22, unblock, Style.GHOST, () -> Social.friendAction("unblock", active));
		} else {
			Theme.scaledText(g, Theme.ellipsize(L.t("friends.cannotSend"), (int) ((x2 - x1 - 12) / 0.8f)), x1 + 6, composerTop + 10, 0.8f, Theme.MUTED, false);
		}
	}

	private void chatList(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		Theme.scaledText(g, L.up("friends.chats"), x1 + 8, y1 + 8, 0.75f, Theme.FAINT, false);
		int y = y1 + 20;
		if (Social.chats().isEmpty()) {
			for (FormattedCharSequence l : font.split(FormattedText.of(L.t("friends.pick")), x2 - x1 - 16)) {
				g.text(font, l, x1 + 8, y + 4, Theme.MUTED, false);
				y += 10;
			}
			return;
		}
		for (Social.Chat c : Social.chats()) {
			if (y + 26 > y2) break;
			boolean hov = hit(x1 + 4, y, x2 - 4, y + 24, () -> Social.open(c.username()), menuAtMouse(c.username(), c.display()));
			Theme.notched(g, x1 + 4, y, x2 - 4, y + 24, 3, hov ? 0x14FFFFFF : 0x06FFFFFF);
			Social.Person f = Social.friend(c.username());
			boolean blocked = f != null && f.blocked();
			avatar(g, x1 + 8, y + 4, c.display(), f == null || blocked ? null : presenceColor(f.presence()), blocked);
			int badge = c.unread() > 0 ? font.width(String.valueOf(c.unread())) + 8 : 0;
			int right = x2 - 8 - badge;
			if (c.muted()) {
				PixelIcons.drawCentered(g, "volume", right - 6, y + 12, 1, Theme.FAINT);
				right -= 14;
			}
			int room = right - (x1 + 29) - 2;
			g.text(font, Theme.ellipsize(c.display(), room), x1 + 29, y + 3, Theme.TEXT, false);
			Theme.scaledText(g, Theme.ellipsize(c.preview(), (int) (room / 0.75f)), x1 + 29, y + 14, 0.75f, Theme.MUTED, false);
			if (badge > 0) {
				Theme.notched(g, x2 - 10 - badge, y + 7, x2 - 8, y + 17, 2, c.muted() ? 0x40FFFFFF : Theme.accent());
				g.text(font, String.valueOf(c.unread()), x2 - 6 - badge, y + 8, Theme.TEXT, false);
			}
			y += 26;
		}
	}

	/** Mesajlar alttan yukarı çizilir; en yeniler görünür. Kendi mesajların sağda, vurgu renginde. */
	private void messages(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		g.enableScissor(x1, y1, x2, y2);
		int maxW = (int) ((x2 - x1) * 0.75f);
		int y = y2;
		List<Social.Message> list = Social.messages();
		for (int i = list.size() - 1; i >= 0 && y > y1; i--) {
			Social.Message m = list.get(i);
			List<FormattedCharSequence> lines = font.split(FormattedText.of(m.body()), maxW - 10);
			int w = 0;
			for (FormattedCharSequence l : lines) w = Math.max(w, font.width(l));
			int h = lines.size() * 10 + 6;
			y -= h;
			int bx1 = m.mine() ? x2 - w - 10 : x1, bx2 = m.mine() ? x2 : x1 + w + 10;
			Theme.notched(g, bx1, y, bx2, y + h, 3, m.mine() ? Theme.withAlpha(Theme.accent(), 0xCC) : 0x26FFFFFF);
			int ly = y + 3;
			for (FormattedCharSequence l : lines) {
				g.text(font, l, bx1 + 5, ly, Theme.TEXT, false);
				ly += 10;
			}
			y -= 4;
		}
		g.disableScissor();
	}
}
