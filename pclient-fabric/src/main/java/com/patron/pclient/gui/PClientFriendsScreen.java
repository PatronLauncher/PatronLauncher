package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.bridge.Patron;
import com.patron.pclient.bridge.Social;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

/**
 * Oyun içi arkadaşlar ve mesajlar (Essential tarzı): solda arkadaş ekleme, arkadaşlar (çevrimiçi / ne oynuyor),
 * istekler ve gizlilik; sağda canlı sohbet. Veriler site hesabından gelir; site ve launcher'la aynı kutudur.
 */
public final class PClientFriendsScreen extends PcScreen {
	private enum Tab { FRIENDS, REQUESTS, PRIVACY }

	private Tab tab = Tab.FRIENDS;
	private final PcTextField addField = new PcTextField(16, L.t("friends.addPlaceholder")).onSubmit(this::addFriend);
	private final PcTextField msgField = new PcTextField(500, L.t("friends.placeholder")).onSubmit(this::sendMessage);

	public PClientFriendsScreen(Screen parent) {
		super("title.friends", parent);
		addField.allow(c -> Character.isLetterOrDigit(c) && c < 128 || c == '_');
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
		int lx1 = fx + 10, lx2 = fx + 10 + Math.min(210, fw / 2 - 20);
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
			boolean hov = hit(tx1, y, tx2, y + 16, () -> tab = t);
			Theme.notched(g, tx1, y, tx2, y + 16, 2, on ? Theme.withAlpha(Theme.accent(), 0x40) : hov ? 0x1EFFFFFF : 0x0CFFFFFF);
			String fit = Theme.ellipsize(label, tx2 - tx1 - 6);
			g.text(font, fit, (tx1 + tx2) / 2 - font.width(fit) / 2, y + 4, on ? Theme.TEXT : Theme.MUTED, false);
		}
		y += 22;
		int listBottom = bottom - (Social.note() != null ? 14 : 0);
		g.enableScissor(x1, y, x2, listBottom);
		switch (tab) {
			case FRIENDS -> friendList(g, x1, y, x2, listBottom);
			case REQUESTS -> requestList(g, x1, y, x2);
			case PRIVACY -> privacy(g, x1, y, x2);
		}
		g.disableScissor();
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

	private void avatar(GuiGraphicsExtractor g, int x, int y, String name, Integer dotColor) {
		Theme.notched(g, x, y, x + 16, y + 16, 2, Theme.withAlpha(Theme.accent(), 0x40));
		String c = name == null || name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase();
		g.text(font, c, x + 8 - font.width(c) / 2, y + 4, Theme.TEXT, false);
		if (dotColor != null) g.fill(x + 12, y + 12, x + 17, y + 17, dotColor);
	}

	private static int rank(Social.Person p) {
		return p.presence() == null ? 0 : p.presence().playing() ? 2 : p.presence().online() ? 1 : 0;
	}

	private void friendList(GuiGraphicsExtractor g, int x1, int y, int x2, int bottom) {
		List<Social.Person> list = new ArrayList<>(Social.friends());
		list.sort((a, b) -> rank(b) != rank(a) ? rank(b) - rank(a) : a.username().compareToIgnoreCase(b.username()));
		if (list.isEmpty()) {
			for (FormattedCharSequence l : font.split(FormattedText.of(L.t("friends.empty")), x2 - x1 - 4)) {
				g.text(font, l, x1 + 2, y + 4, Theme.MUTED, false);
				y += 10;
			}
			return;
		}
		for (Social.Person f : list) {
			if (y > bottom) break;
			boolean on = f.username().equals(Social.active());
			boolean hov = hit(x1, y, x2, y + 24, () -> Social.open(f.username()));
			Theme.notched(g, x1, y, x2, y + 24, 3, on ? Theme.withAlpha(Theme.accent(), 0x2E) : hov ? 0x14FFFFFF : 0x06FFFFFF);
			avatar(g, x1 + 4, y + 4, f.display(), presenceColor(f.presence()));
			g.text(font, Theme.ellipsize(f.display(), x2 - x1 - 30), x1 + 25, y + 3, Theme.TEXT, false);
			Theme.scaledText(g, Theme.ellipsize(presenceText(f.presence()), (int) ((x2 - x1 - 30) / 0.75f)), x1 + 25, y + 14, 0.75f,
				f.presence() != null && f.presence().playing() ? 0xFF3DDC84 : Theme.MUTED, false);
			y += 26;
		}
	}

	private void requestList(GuiGraphicsExtractor g, int x1, int y, int x2) {
		if (Social.incoming().isEmpty() && Social.outgoing().isEmpty()) {
			g.text(font, L.t("friends.noRequests"), x1 + 2, y + 4, Theme.MUTED, false);
			return;
		}
		for (Social.Person p : Social.incoming()) {
			Theme.notched(g, x1, y, x2, y + 24, 3, 0x0CFFFFFF);
			avatar(g, x1 + 4, y + 4, p.display(), null);
			g.text(font, Theme.ellipsize(p.display(), x2 - x1 - 70), x1 + 25, y + 3, Theme.TEXT, false);
			Theme.scaledText(g, L.t("friends.wantsYou"), x1 + 25, y + 14, 0.75f, Theme.MUTED, false);
			if (button(g, x2 - 42, y + 4, x2 - 24, y + 20, "✓", Style.PRIMARY, () -> Social.friendAction("accept", p.username()))) tipNow(L.t("friends.accept"));
			if (button(g, x2 - 21, y + 4, x2 - 3, y + 20, "✕", Style.GHOST, () -> Social.friendAction("decline", p.username()))) tipNow(L.t("friends.decline"));
			y += 26;
		}
		for (Social.Person p : Social.outgoing()) {
			Theme.notched(g, x1, y, x2, y + 24, 3, 0x06FFFFFF);
			avatar(g, x1 + 4, y + 4, p.display(), null);
			g.text(font, Theme.ellipsize(p.display(), x2 - x1 - 50), x1 + 25, y + 3, Theme.TEXT, false);
			Theme.scaledText(g, L.t("friends.sent"), x1 + 25, y + 14, 0.75f, Theme.MUTED, false);
			if (button(g, x2 - 21, y + 4, x2 - 3, y + 20, "✕", Style.GHOST, () -> Social.friendAction("cancel", p.username()))) tipNow(L.t("friends.cancel"));
			y += 26;
		}
	}

	private static final String[] POLICIES = { "everyone", "friends", "nobody" };

	private static String nextOf(String cur, String[] options) {
		for (int i = 0; i < options.length; i++) if (options[i].equals(cur)) return options[(i + 1) % options.length];
		return options[0];
	}

	private void privacy(GuiGraphicsExtractor g, int x1, int y, int x2) {
		for (FormattedCharSequence l : font.split(FormattedText.of(L.t("friends.privacyHelp")), x2 - x1 - 4)) {
			g.text(font, l, x1 + 2, y, Theme.MUTED, false);
			y += 10;
		}
		y += 6;
		y = policyRow(g, x1, y, x2, "friends.privacy.dm", Social.dmPolicy(), POLICIES, "dmPolicy");
		y = policyRow(g, x1, y, x2, "friends.privacy.presence", Social.presencePolicy(), POLICIES, "presencePolicy");
		policyRow(g, x1, y, x2, "friends.privacy.requests", Social.friendPolicy(), new String[] { "everyone", "nobody" }, "friendPolicy");
	}

	/** Bir gizlilik ayarı: tıkladıkça sıradaki seçeneğe geçer ve hemen kaydedilir. */
	private int policyRow(GuiGraphicsExtractor g, int x1, int y, int x2, String labelKey, String value, String[] options, String key) {
		g.text(font, Theme.ellipsize(L.t(labelKey), x2 - x1), x1 + 2, y, Theme.TEXT, false);
		y += 11;
		String label = L.t("friends.policy." + (value == null ? options[0] : value)) + "  ›";
		button(g, x1, y, x2, y + 18, label, Style.SECONDARY, () -> Social.setPrivacy(key, nextOf(value, options)));
		return y + 24;
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
		Social.Person f = Social.friends().stream().filter(p -> p.username().equals(active)).findFirst().orElse(null);
		String name = Social.activeDisplay() == null ? active : Social.activeDisplay();
		avatar(g, x1 + 24, y1 + 4, name, f == null ? null : presenceColor(f.presence()));
		g.text(font, Theme.ellipsize(name, x2 - x1 - 60), x1 + 46, y1 + 5, Theme.TEXT, false);
		if (f != null) Theme.scaledText(g, presenceText(f.presence()), x1 + 46, y1 + 15, 0.75f, Theme.MUTED, false);
		g.fill(x1 + 1, y1 + 24, x2 - 1, y1 + 25, Theme.LINE);
		int composerTop = y2 - 26;
		messages(g, x1 + 6, y1 + 28, x2 - 6, composerTop - 4);
		if (Social.canSend()) {
			textField(g, x1 + 6, composerTop + 4, x2 - 54, composerTop + 22, msgField);
			button(g, x2 - 50, composerTop + 4, x2 - 6, composerTop + 22, L.up("friends.send"), Style.PRIMARY, this::sendMessage);
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
			boolean hov = hit(x1 + 4, y, x2 - 4, y + 24, () -> Social.open(c.username()));
			Theme.notched(g, x1 + 4, y, x2 - 4, y + 24, 3, hov ? 0x14FFFFFF : 0x06FFFFFF);
			Social.Person f = Social.friends().stream().filter(p -> p.username().equals(c.username())).findFirst().orElse(null);
			avatar(g, x1 + 8, y + 4, c.display(), f == null ? null : presenceColor(f.presence()));
			int badge = c.unread() > 0 ? font.width(String.valueOf(c.unread())) + 8 : 0;
			g.text(font, Theme.ellipsize(c.display(), x2 - x1 - 40 - badge), x1 + 29, y + 3, Theme.TEXT, false);
			Theme.scaledText(g, Theme.ellipsize(c.preview(), (int) ((x2 - x1 - 40 - badge) / 0.75f)), x1 + 29, y + 14, 0.75f, Theme.MUTED, false);
			if (badge > 0) {
				Theme.notched(g, x2 - 10 - badge, y + 7, x2 - 8, y + 17, 2, Theme.accent());
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
