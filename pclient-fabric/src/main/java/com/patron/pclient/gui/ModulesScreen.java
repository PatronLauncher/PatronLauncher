package com.patron.pclient.gui;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.L;
import com.patron.pclient.PClient;
import com.patron.pclient.config.PClientConfig;
import com.patron.pclient.config.ProfileCodes;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.setting.KeySetting;
import com.patron.pclient.module.setting.Setting;
import com.patron.pclient.modules.MusicModule;
import com.patron.pclient.modules.SoonModule;
import com.patron.pclient.modules.Waypoints;
import com.patron.pclient.modules.WaypointsModule;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

/**
 * PClient menüsü. Solda profiller; üstte Modüller, Ayarlar ve Yol Noktaları sekmeleri.
 * Modüller sekmesinde kategori çipleri, arama ve kompakt modül kartları bulunur.
 */
public final class ModulesScreen extends PcScreen {
	public enum Tab { MODULES, SETTINGS, WAYPOINTS }

	private enum Sub { GENERAL, PERFORMANCE, CONTROLS }

	/** Kategori filtresi: null tümü, NEW yeni modüller. */
	private enum Filter {
		ALL("cat.all", null), NEW("cat.new", null), HUD("cat.hud", Category.HUD), SERVER("cat.server", Category.SERVER),
		MECHANIC("cat.mechanic", Category.MECHANIC), VISUAL("cat.visual", Category.VISUAL), PERFORMANCE("cat.performance", Category.PERFORMANCE), SOON("cat.soon", Category.SOON);

		final String key;
		final Category category;

		Filter(String key, Category category) {
			this.key = key;
			this.category = category;
		}

		boolean accepts(Module m) {
			return this == ALL || (this == NEW ? m.isNew() && m.isAvailable() : m.category == category);
		}
	}

	private static final int HEADER = 28, SIDE = 112, CARD_H = 26, GRID_W = 112, GRID_H = 100, GAP = 5, ROW = 30;
	private static Filter filter = Filter.ALL;
	private static Sub sub = Sub.GENERAL;
	private Tab tab;
	private final PcTextField search = new PcTextField(32, L.t("search.placeholder")).clearOnEscape();
	private final PcTextField profileName = new PcTextField(24, L.t("profile.namePlaceholder"));
	private final PcTextField waypointName = new PcTextField(32, L.t("waypoints.namePlaceholder"));
	private final PcTextField profileCode = new PcTextField(16384, L.t("profile.codePlaceholder"));
	private boolean creatingProfile, importingProfile;
	private int profileOffset;
	private String profileNoticeText = "";
	private long profileNoticeUntil;
	private String profileError, deleteArmed;
	private long deleteArmedUntil, resetArmedUntil;
	private double scroll, scrollTarget, maxScroll;
	/** Dinlenen tuş: KeySetting ya da menü tuşu için MENU_KEY. */
	private Object listening;
	private static final Object MENU_KEY = new Object();
	private Waypoints.Waypoint selectedWaypoint;
	private int px, py, pw, ph, cx1, cx2, top, bottom, listY1, listY2;

	public ModulesScreen(Tab tab) {
		super("title.modules", null);
		this.tab = tab;
		search.onChange(v -> scrollTarget = 0);
		profileName.onSubmit(this::createProfile);
		profileCode.onSubmit(this::importProfile);
		profileName.allow(c -> Character.isLetterOrDigit(c) || c == ' ' || c == '-' || c == '_');
		waypointName.onSubmit(this::addOrRenameWaypoint);
	}

	@Override protected void init() {
		// Modüller açılınca doğrudan yazmaya başlanabilir.
		if (tab == Tab.MODULES) focus(search);
	}

	@Override protected String dock() { return tab == Tab.SETTINGS ? "settings" : "modules"; }

	private void layout() {
		pw = Math.min(width - 24, 620);
		int avail = height - 46 - 8;
		ph = Math.min(avail - 8, 340);
		px = (width - pw) / 2;
		py = 8 + Math.max(0, (avail - ph) / 2);
		cx1 = px + SIDE + 10;
		cx2 = px + pw - 10;
		top = py + HEADER + 1;
		bottom = py + ph - 1;
	}

	private void switchTab(Tab t) {
		tab = t;
		listening = null;
		scroll = scrollTarget = 0;
		focus(t == Tab.MODULES ? search : null);
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		layout();
		panel(g, px, py, px + pw, py + ph);
		drawHeader(g);
		drawProfiles(g);
		switch (tab) {
			case MODULES -> drawModules(g);
			case SETTINGS -> drawSettings(g);
			case WAYPOINTS -> drawWaypoints(g);
		}
	}

	private void drawHeader(GuiGraphicsExtractor g) {
		g.fill(px + 1, py + HEADER, px + pw - 1, py + HEADER + 1, Theme.LINE);
		Theme.logo(g, px + 14, py + 7, 14);
		g.text(font, "P", px + 31, py + 10, Theme.accent(), false);
		Theme.spaced(g, "CLIENT", px + 31 + font.width("P") + 1, py + 10, Theme.TEXT, 1);
		int tx = px + SIDE + 10;
		for (Tab t : Tab.values()) {
			String label = L.up(switch (t) {
				case MODULES -> "tab.modules";
				case SETTINGS -> "tab.settings";
				case WAYPOINTS -> "tab.waypoints";
			});
			int w = Theme.spacedWidth(label, 2) + 18;
			boolean active = t == tab, hov = hit(tx, py + 6, tx + w, py + 22, () -> switchTab(t));
			Theme.notched(g, tx, py + 6, tx + w, py + 22, 3, active ? Theme.withAlpha(Theme.accent(), 0x38) : hov ? 0x1AFFFFFF : 0x0AFFFFFF);
			Theme.notchedOutline(g, tx, py + 6, tx + w, py + 22, 3, active ? Theme.accent() : Theme.LINE);
			Theme.spaced(g, label, tx + 9, py + 10, active || hov ? Theme.TEXT : Theme.MUTED, 2);
			tx += w + 6;
		}
		if (iconButton(g, px + pw - 26, py + 6, 16, "close", () -> minecraft.gui.setScreen(null))) tipNow(L.t("common.close"));
	}

	// ---------------- Profiller (sol kenar) ----------------

	private void drawProfiles(GuiGraphicsExtractor g) {
		g.fill(px + 1, top, px + SIDE, bottom - 8, 0x30000000);
		g.fill(px + SIDE, top, px + SIDE + 1, bottom, Theme.LINE);
		int x1 = px + 6, x2 = px + SIDE - 6, y = top + 8;
		Theme.spaced(g, L.up("profile.title"), x1 + 2, y, Theme.FAINT, 1);
		y += 13;
		PClientConfig c = PClientConfig.get();
		List<String> profiles = PClientConfig.profiles();
		int actionsH = creatingProfile || importingProfile ? 20 + (profileError != null ? 10 : 0) : 38;
		int listEnd = bottom - 72 - actionsH, maxRows = Math.max(2, (listEnd - y) / 19);
		profileOffset = Math.max(0, Math.min(profiles.size() - maxRows, profileOffset));
		if (profiles.size() > maxRows) {
			int trackH = maxRows * 19 - 2, barH = Math.max(10, trackH * maxRows / profiles.size());
			int barY = y + (trackH - barH) * profileOffset / (profiles.size() - maxRows);
			g.fill(x2 + 2, y, x2 + 4, y + trackH, 0x14FFFFFF);
			g.fill(x2 + 2, barY, x2 + 4, barY + barH, Theme.withAlpha(Theme.accent(), 0xB0));
		}
		for (int i = profileOffset; i < Math.min(profiles.size(), profileOffset + maxRows); i++) {
			String p = profiles.get(i);
			boolean active = p.equals(c.profile()), def = p.equals(PClientConfig.DEFAULT_PROFILE);
			boolean hov = hit(x1, y, x2, y + 17, () -> {
				PClientConfig.switchProfile(p);
				deleteArmed = null;
			});
			Theme.notched(g, x1, y, x2, y + 17, 2, active ? Theme.withAlpha(Theme.accent(), 0x2E) : hov ? 0x14FFFFFF : 0x08FFFFFF);
			Theme.notchedOutline(g, x1, y, x2, y + 17, 2, active ? Theme.withAlpha(Theme.accent(), 0xC0) : Theme.LINE);
			PixelIcons.draw(g, def ? "home" : ProfileCodes.iconOf(p), x1 + 5, y + 4, 1, active ? Theme.accent() : Theme.FAINT);
			String name = def ? L.t("profile.default") : p;
			boolean tools = hov || p.equals(deleteArmed);
			int toolsW = !tools ? 4 : (def ? 0 : 14) + 14 + (active ? 14 : 0) + 2;
			g.text(font, Theme.ellipsize(name, x2 - x1 - 17 - toolsW), x1 + 17, y + 5, active ? Theme.TEXT : Theme.MUTED, false);
			if (tools) {
				int ix = x2 - (def ? 2 : 16) - 13;
				boolean hs = hit(ix, y + 2, ix + 13, y + 15, () -> {
					String code = PClientConfig.exportCode(p);
					if (code != null) {
						minecraft.keyboardHandler.setClipboard(code);
						profileNotice("profile.copied");
					}
				});
				PixelIcons.drawCentered(g, "share", ix + 7, y + 9, 1, hs ? Theme.TEXT : Theme.FAINT);
				if (hs) tipNow(L.t("profile.share"));
				if (active) {
					int sx = ix - 14;
					boolean hsv = hit(sx, y + 2, sx + 13, y + 15, () -> {
						PClientConfig.save();
						profileNotice("profile.saved");
					});
					PixelIcons.drawCentered(g, "save", sx + 7, y + 9, 1, hsv ? Theme.TEXT : Theme.FAINT);
					if (hsv) tipNow(L.t("profile.save"));
				}
			}
			if (!def && (hov || p.equals(deleteArmed))) {
				boolean armed = p.equals(deleteArmed) && System.currentTimeMillis() < deleteArmedUntil;
				boolean ht = hit(x2 - 15, y + 2, x2 - 2, y + 15, () -> {
					if (p.equals(deleteArmed) && System.currentTimeMillis() < deleteArmedUntil) {
						PClientConfig.deleteProfile(p);
						deleteArmed = null;
					} else {
						deleteArmed = p;
						deleteArmedUntil = System.currentTimeMillis() + 3000;
					}
				});
				PixelIcons.drawCentered(g, "trash", x2 - 8, y + 9, 1, armed ? 0xFFE5484D : ht ? Theme.TEXT : Theme.FAINT);
				if (ht) tipNow(L.t(armed ? "profile.deleteConfirm" : "profile.delete"));
			}
			y += 19;
		}
		y = listEnd + 2;
		if (creatingProfile || importingProfile) {
			if (creatingProfile) textField(g, x1, y, x2, y + 17, profileName);
			else {
				textField(g, x1, y, x2 - 20, y + 17, profileCode);
				button(g, x2 - 17, y, x2, y + 17, "+", Style.PRIMARY, this::importProfile);
			}
			y += 20;
			if (profileError != null) g.text(font, Theme.ellipsize(profileError, x2 - x1), x1, y, 0xFFE5484D, false);
		} else {
			button(g, x1, y, x2, y + 16, "+ " + L.up("profile.new"), Style.GHOST, () -> {
				creatingProfile = true;
				profileError = null;
				profileName.set("");
				focus(profileName);
			});
			button(g, x1, y + 19, x2, y + 35, L.up("profile.import"), Style.GHOST, () -> {
				importingProfile = true;
				profileError = null;
				String clip = minecraft.keyboardHandler.getClipboard();
				profileCode.set(clip != null && clip.strip().startsWith(ProfileCodes.PREFIX) ? clip.strip() : "");
				focus(profileCode);
			});
		}

		int on = 0, total = 0;
		for (Module m : ModuleManager.all()) if (m.isAvailable()) {
			total++;
			if (m.isEnabled()) on++;
		}
		boolean notice = System.currentTimeMillis() < profileNoticeUntil;
		String count = notice ? profileNoticeText : L.t("modules.count", on, total);
		g.text(font, Theme.ellipsize(count, x2 - x1), x1 + 2, bottom - 64, notice ? 0xFF4ADE80 : Theme.FAINT, false);
		button(g, x1, bottom - 52, x2, bottom - 34, L.up("side.hudEditor"), Style.PRIMARY, () -> open(new HudEditorScreen(this)));
		button(g, x1, bottom - 28, x2, bottom - 10, L.up("side.allOff"), Style.GHOST, () -> {
			for (Module m : ModuleManager.all()) m.setEnabled(false);
		});
	}

	private void profileNotice(String key, Object... args) {
		profileNoticeText = L.t(key, args);
		profileNoticeUntil = System.currentTimeMillis() + 3000;
	}

	private void importProfile() {
		String name = PClientConfig.importCode(profileCode.value());
		if (name == null) {
			profileError = L.t("profile.codeInvalid");
			return;
		}
		importingProfile = false;
		profileError = null;
		profileNotice("profile.imported", name);
		focus(tab == Tab.MODULES ? search : null);
	}

	private void createProfile() {
		String name = profileName.value().strip();
		if (name.isEmpty()) {
			creatingProfile = false;
			focus(tab == Tab.MODULES ? search : null);
			return;
		}
		if (!PClientConfig.createProfile(name)) {
			profileError = L.t("profile.invalid");
			return;
		}
		creatingProfile = false;
		profileError = null;
		focus(tab == Tab.MODULES ? search : null);
	}

	// ---------------- Modüller ----------------

	private List<Module> visibleModules() {
		String q = search.value().toLowerCase(Locale.ROOT).trim();
		List<Module> out = new ArrayList<>();
		for (Module m : ModuleManager.all()) {
			if (!filter.accepts(m)) continue;
			if (!q.isEmpty() && !(L.t(m.nameKey()) + " " + L.t(m.descKey()) + " " + m.id).toLowerCase(Locale.ROOT).contains(q)) continue;
			out.add(m);
		}
		sort(out);
		return out;
	}

	private void sort(List<Module> list) {
		PClientConfig c = PClientConfig.get();
		switch (c.modulesSort) {
			case "az", "za" -> {
				Collator collator = Collator.getInstance(Locale.forLanguageTag(minecraft.options.languageCode.replace('_', '-')));
				collator.setStrength(Collator.PRIMARY);
				Comparator<Module> byName = Comparator.comparing(m -> L.t(m.nameKey()), collator);
				list.sort(c.modulesSort.equals("az") ? byName : byName.reversed());
			}
			// Hiç değiştirilmemiş modüller varsayılan sırasıyla sonda kalır (sıralama kararlıdır).
			case "recent" -> list.sort(Comparator.comparingLong((Module m) -> c.touchedAt(m.id)).reversed());
			default -> {}
		}
	}

	private void toggle(Module m) {
		m.setEnabled(!m.isEnabled());
		PClientConfig.touch(m.id);
	}

	/** Görünüm ve sıralama düğmeleri (kare/satır ve döngülü sıralama). */
	private void viewTools(GuiGraphicsExtractor g, int x, int y) {
		PClientConfig c = PClientConfig.get();
		int s = 16, gap = 2;
		for (String view : PClientConfig.MODULE_VIEWS) {
			boolean active = view.equals(c.modulesView), hov = hit(x, y, x + s, y + s, () -> {
				c.modulesView = view;
				scrollTarget = 0;
			});
			Theme.notched(g, x, y, x + s, y + s, 2, active ? Theme.withAlpha(Theme.accent(), 0x60) : hov ? 0x26FFFFFF : 0x12FFFFFF);
			PixelIcons.drawCentered(g, view.equals("grid") ? "grid" : "list", x + s / 2, y + s / 2, 1, active || hov ? Theme.TEXT : Theme.MUTED);
			if (hov) tipNow(L.t("modules.view." + view));
			x += s + gap;
		}
		x += 2;
		int index = PClientConfig.MODULE_SORTS.indexOf(c.modulesSort);
		boolean hov = hit(x, y, x + s, y + s, () -> {
			c.modulesSort = PClientConfig.MODULE_SORTS.get((index + 1) % PClientConfig.MODULE_SORTS.size());
			scrollTarget = 0;
		});
		boolean sorted = !c.modulesSort.equals("default");
		Theme.notched(g, x, y, x + s, y + s, 2, sorted ? Theme.withAlpha(Theme.accent(), 0x60) : hov ? 0x26FFFFFF : 0x12FFFFFF);
		String icon = switch (c.modulesSort) {
			case "az" -> "sortaz";
			case "za" -> "sortza";
			case "recent" -> "sorttime";
			default -> "sort";
		};
		PixelIcons.drawCentered(g, icon, x + s / 2, y + s / 2, 1, sorted || hov ? Theme.TEXT : Theme.MUTED);
		if (hov) tipNow(L.t("modules.sort." + c.modulesSort));
	}

	private void drawModules(GuiGraphicsExtractor g) {
		int y = top + 8;
		// Kategori çipleri; sığmazsa arama alt satıra iner.
		int chipsW = 0;
		for (Filter f : Filter.values()) chipsW += Theme.spacedWidth(L.up(f.key), 1) + 14 + 4;
		int toolsW = 16 * 3 + 2 + 2 + 2 + 6;
		boolean searchBelow = chipsW + 120 + toolsW > cx2 - cx1;
		int x = cx1;
		for (Filter f : Filter.values()) {
			String label = L.up(f.key);
			int w = Theme.spacedWidth(label, 1) + 14;
			boolean active = f == filter, hov = hit(x, y, x + w, y + 16, () -> {
				filter = f;
				scrollTarget = 0;
			});
			int bg = active ? (f == Filter.NEW ? 0xFF2F9E5B : Theme.accent()) : hov ? 0x26FFFFFF : 0x12FFFFFF;
			Theme.notched(g, x, y, x + w, y + 16, 2, bg);
			Theme.spaced(g, label, x + 7, y + 4, active || hov ? Theme.TEXT : Theme.MUTED, 1);
			x += w + 4;
		}
		if (searchBelow) {
			y += 22;
			textField(g, cx1, y, cx2 - toolsW, y + 16, search, 11, "search");
		} else textField(g, Math.max(x + 4, cx2 - toolsW - 140), y, cx2 - toolsW, y + 16, search, 11, "search");
		viewTools(g, cx2 - toolsW + 6, y);

		List<Module> list = visibleModules();
		listY1 = y + 24;
		listY2 = bottom - 6;
		boolean grid = PClientConfig.get().modulesView.equals("grid");
		int itemH = grid ? GRID_H : CARD_H, minW = grid ? GRID_W : 150;
		int cw = cx2 - cx1 - 6, cols = Math.max(2, (cw + GAP) / minW), cardW = (cw - (cols - 1) * GAP) / cols;
		int rows = (list.size() + cols - 1) / cols, contentH = rows * (itemH + GAP) - GAP;
		scrollTick(contentH);
		if (list.isEmpty()) g.centeredText(font, L.t("modules.empty"), (cx1 + cx2) / 2, listY1 + 30, Theme.MUTED);
		g.enableScissor(cx1 - 2, listY1, cx2 + 2, listY2);
		for (int i = 0; i < list.size(); i++) {
			int cx = cx1 + i % cols * (cardW + GAP), cy = listY1 + i / cols * (itemH + GAP) - (int) Math.round(scroll);
			if (cy + itemH < listY1 || cy > listY2) continue;
			if (grid) gridCard(g, list.get(i), cx, cy, cardW);
			else card(g, list.get(i), cx, cy, cardW);
		}
		g.disableScissor();
		scrollbar(g, contentH);
	}

	private Runnable modulePage(Module m) {
		return () -> open(m instanceof MusicModule ? new PClientMusicScreen(this)
			: m.isAvailable() ? new ModuleSettingsScreen(m, this) : new ComingSoonScreen((SoonModule) m, this));
	}

	/** Kare görünümdeki kart: büyük simge, ad, ayarlar düğmesi ve durum düğmesi. */
	private void gridCard(GuiGraphicsExtractor g, Module m, int x, int y, int w) {
		boolean avail = m.isAvailable(), on = m.isEnabled();
		int h = GRID_H, cx = x + w / 2, settingsY = y + h - 41, toggleY = y + h - 21;
		Runnable page = modulePage(m);
		boolean hovTop = hitClipped(x, y, x + w, settingsY, page, page);
		Theme.notched(g, x, y, x + w, y + h, 4, hovTop ? Theme.CARD_HOVER : Theme.CARD);
		Theme.notchedOutline(g, x, y, x + w, y + h, 4, on ? Theme.withAlpha(Theme.accent(), 0xD0) : hovTop ? Theme.LINE_STRONG : Theme.LINE);
		PixelIcons.drawCentered(g, m.icon, cx, y + 20, 3, !avail ? Theme.FAINT : on ? Theme.TEXT : Theme.MUTED);
		String name = Theme.ellipsize(L.t(m.nameKey()), w - 10);
		g.centeredText(font, name, cx, y + 40, avail ? Theme.TEXT : Theme.MUTED);
		if (m.isNew() && avail) Theme.scaledText(g, L.up("tag.new"), x + w - 5 - font.width(L.up("tag.new")) * 0.6f, y + 5, 0.6f, 0xFF4ADE80, false);
		if (hovTop) tip(m.id, L.t(m.descKey()));

		boolean hovSettings = hitClipped(x + 2, settingsY, x + w - 2, settingsY + 19, page, null);
		g.fill(x + 2, settingsY, x + w - 2, settingsY + 19, hovSettings ? 0x26FFFFFF : 0x10FFFFFF);
		String settings = L.up("card.settings");
		Theme.spacedCentered(g, settings, cx - 7, settingsY + 6, hovSettings ? Theme.TEXT : Theme.MUTED, 1);
		PixelIcons.drawCentered(g, "gear", x + w - 13, settingsY + 10, 1, hovSettings ? Theme.TEXT : Theme.FAINT);

		boolean hovToggle = hitClipped(x + 2, toggleY, x + w - 2, y + h - 2, avail ? () -> toggle(m) : page, null);
		int bg = !avail ? Theme.OFF : on ? (hovToggle ? Theme.mix(Theme.accent(), 0xFFFFFFFF, 0.15f) : Theme.accent()) : hovToggle ? Theme.OFF_HOVER : Theme.OFF;
		g.fill(x + 2, toggleY, x + w - 2, y + h - 2, bg);
		String state = L.up(!avail ? "cat.soon" : on ? "card.on" : "card.off");
		Theme.spacedCentered(g, state, cx, toggleY + 6, on || hovToggle ? Theme.TEXT : Theme.MUTED, 1);
	}

	private void card(GuiGraphicsExtractor g, Module m, int x, int y, int w) {
		boolean avail = m.isAvailable(), on = m.isEnabled();
		Runnable openPage = modulePage(m);
		int gearX = x + w - 22;
		boolean hovBody = hitClipped(x, y, gearX, y + CARD_H, avail ? () -> toggle(m) : openPage, openPage);
		boolean hovGear = hitClipped(gearX, y, x + w, y + CARD_H, openPage, null);
		boolean hov = hovBody || hovGear;
		Theme.notched(g, x, y, x + w, y + CARD_H, 3, hov ? Theme.CARD_HOVER : Theme.CARD);
		int outline = !avail ? Theme.LINE : on ? Theme.withAlpha(Theme.accent(), 0xD0) : hov ? Theme.LINE_STRONG : 0x40E5484D;
		Theme.notchedOutline(g, x, y, x + w, y + CARD_H, 3, outline);
		if (on) g.fill(x + 1, y + 4, x + 3, y + CARD_H - 4, Theme.accent());
		int iconColor = !avail ? Theme.FAINT : on ? Theme.TEXT : Theme.MUTED;
		PixelIcons.drawCentered(g, m.icon, x + 14, y + CARD_H / 2, 1, iconColor);
		int nameRoom = gearX - x - 30 - 22;
		String name = Theme.ellipsize(L.t(m.nameKey()), nameRoom);
		g.text(font, name, x + 26, y + 9, avail ? Theme.TEXT : Theme.MUTED, false);
		if (m.isNew() && avail) {
			String tag = L.up("tag.new");
			Theme.scaledText(g, tag, x + 26 + font.width(name) + 3, y + 5, 0.6f, 0xFF4ADE80, false);
		}
		// Durum: küçük anahtar (ya da kilit)
		int sx = gearX - 18, sy = y + CARD_H / 2 - 4;
		if (avail) {
			g.fill(sx, sy, sx + 14, sy + 8, on ? Theme.accent() : Theme.OFF);
			g.fill(on ? sx + 7 : sx + 1, sy + 1, on ? sx + 13 : sx + 7, sy + 7, on ? 0xFFFFFFFF : 0xFF8A8F9C);
		} else PixelIcons.drawCentered(g, "lock", sx + 7, y + CARD_H / 2, 1, Theme.FAINT);
		g.fill(gearX, y + 5, gearX + 1, y + CARD_H - 5, Theme.LINE);
		PixelIcons.drawCentered(g, "gear", gearX + 11, y + CARD_H / 2, 1, hovGear ? Theme.TEXT : Theme.FAINT);
		if (hovGear) tipNow(L.t("card.settings"));
		else if (hovBody) tip(m.id, L.t(m.descKey()));
	}

	/** Liste kırpma alanıyla sınırlanmış tıklama alanı. */
	private boolean hitClipped(int x1, int y1, int x2, int y2, Runnable left, Runnable right) {
		if (mouseY < listY1 || mouseY >= listY2) {
			// Kırpılan bölgede yine de kayıt yap ki tıklama arkadaki karta düşmesin.
			int cy1 = Math.max(y1, listY1), cy2 = Math.min(y2, listY2);
			if (cy2 > cy1) hit(x1, cy1, x2, cy2, left, right);
			return false;
		}
		int cy1 = Math.max(y1, listY1), cy2 = Math.min(y2, listY2);
		if (cy2 <= cy1) return false;
		return hit(x1, cy1, x2, cy2, left, right);
	}

	private void scrollTick(int contentH) {
		maxScroll = Math.max(0, contentH - (listY2 - listY1));
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget));
		scroll += (scrollTarget - scroll) * Math.min(1, dt * 16);
	}

	private void scrollbar(GuiGraphicsExtractor g, int contentH) {
		if (maxScroll <= 0) return;
		int trackH = listY2 - listY1, barH = Math.max(18, trackH * trackH / contentH);
		int barY = listY1 + (int) ((trackH - barH) * (scroll / maxScroll));
		g.fill(cx2 + 4, listY1, cx2 + 6, listY2, 0x14FFFFFF);
		g.fill(cx2 + 4, barY, cx2 + 6, barY + barH, Theme.withAlpha(Theme.accent(), 0xB0));
	}

	// ---------------- Ayarlar ----------------

	private void drawSettings(GuiGraphicsExtractor g) {
		int y = top + 8, x = cx1;
		for (Sub s : Sub.values()) {
			String label = L.up(switch (s) {
				case GENERAL -> "settings.general";
				case PERFORMANCE -> "settings.performance";
				case CONTROLS -> "settings.controls";
			});
			int w = Theme.spacedWidth(label, 1) + 16;
			boolean active = s == sub, hov = hit(x, y, x + w, y + 16, () -> {
				sub = s;
				listening = null;
				scroll = scrollTarget = 0;
			});
			Theme.notched(g, x, y, x + w, y + 16, 2, active ? Theme.accent() : hov ? 0x26FFFFFF : 0x12FFFFFF);
			Theme.spaced(g, label, x + 8, y + 4, active || hov ? Theme.TEXT : Theme.MUTED, 1);
			x += w + 4;
		}
		listY1 = y + 24;
		listY2 = bottom - 6;
		switch (sub) {
			case GENERAL -> drawGeneral(g);
			case PERFORMANCE -> drawPerformance(g);
			case CONTROLS -> drawControls(g);
		}
	}

	private void drawGeneral(GuiGraphicsExtractor g) {
		PClientConfig c = PClientConfig.get();
		int x1 = cx1 + 4, x2 = cx2 - 4, y = listY1;
		y = row(g, x1, x2, y, "settings.menuKey");
		keyButton(g, x2, y - ROW + 5, MENU_KEY, InputConstants.Type.KEYBOARD.getOrCreate(c.menuKey).getDisplayName().getString());

		y = row(g, x1, x2, y, "settings.accent");
		int[] accents = PClientConfig.ACCENTS.stream().mapToInt(Theme::accentFor).toArray();
		swatches(g, x2, y - ROW + 7, accents, Theme.accent(), col -> {
			for (String a : PClientConfig.ACCENTS) if (Theme.accentFor(a) == col) c.accent = a;
		});

		y = row(g, x1, x2, y, "settings.blur");
		toggleSwitch(g, x2 - 24, y - ROW + 7, c.blur, () -> c.blur = !c.blur);

		y = row(g, x1, x2, y, "settings.sound");
		toggleSwitch(g, x2 - 24, y - ROW + 7, c.openSound, () -> c.openSound = !c.openSound);

		y = row(g, x1, x2, y, "settings.reset");
		boolean armed = System.currentTimeMillis() < resetArmedUntil;
		String rl = L.up(armed ? "settings.resetConfirm" : "settings.resetButton");
		int rw = Theme.spacedWidth(rl, 1) + 20;
		button(g, x2 - rw, y - ROW + 5, x2, y - ROW + 21, rl, armed ? Style.DANGER : Style.GHOST, () -> {
			if (System.currentTimeMillis() < resetArmedUntil) {
				ModuleManager.all().forEach(Module::resetToDefaults);
				resetArmedUntil = 0;
			} else resetArmedUntil = System.currentTimeMillis() + 3000;
		});

		// Hakkında kartı
		int ay = Math.max(y + 6, bottom - 54);
		if (ay + 46 <= bottom - 4) {
			Theme.notched(g, x1, ay, x2, ay + 46, 5, 0x14FFFFFF);
			Theme.logo(g, x1 + 10, ay + 9, 28);
			g.text(font, "PClient " + PClient.version, x1 + 46, ay + 9, Theme.TEXT, false);
			List<FormattedCharSequence> lines = font.split(FormattedText.of(L.t("settings.about")), x2 - x1 - 58);
			for (int i = 0; i < Math.min(2, lines.size()); i++) g.text(font, lines.get(i), x1 + 46, ay + 21 + i * 10, Theme.MUTED, false);
		}
	}

	private void drawPerformance(GuiGraphicsExtractor g) {
		PClientConfig c = PClientConfig.get();
		int x1 = cx1 + 4, x2 = cx2 - 4, y = listY1;
		y = row(g, x1, x2, y, "settings.bgFps");
		toggleSwitch(g, x2 - 24, y - ROW + 7, c.backgroundFpsLimit, () -> c.backgroundFpsLimit = !c.backgroundFpsLimit);

		y = row(g, x1, x2, y, "settings.bgFpsValue");
		int w = 80, bx = x2 - w, by = y - ROW + 5;
		int idx = 0;
		for (int i = 0; i < PClientConfig.BACKGROUND_FPS.length; i++) if (PClientConfig.BACKGROUND_FPS[i] <= c.backgroundFps) idx = i;
		int cur = idx;
		boolean hl = hit(bx, by, bx + w / 2, by + 16, () -> c.backgroundFps = PClientConfig.BACKGROUND_FPS[Math.max(0, cur - 1)]);
		boolean hr = hit(bx + w / 2, by, x2, by + 16, () -> c.backgroundFps = PClientConfig.BACKGROUND_FPS[Math.min(PClientConfig.BACKGROUND_FPS.length - 1, cur + 1)]);
		Theme.notched(g, bx, by, x2, by + 16, 3, hl || hr ? Theme.OFF_HOVER : Theme.OFF);
		g.text(font, "‹", bx + 5, by + 4, hl ? Theme.accent() : Theme.MUTED, false);
		g.text(font, "›", x2 - 9, by + 4, hr ? Theme.accent() : Theme.MUTED, false);
		g.centeredText(font, String.valueOf(c.backgroundFps), bx + w / 2, by + 4, c.backgroundFpsLimit ? Theme.TEXT : Theme.FAINT);

		y = row(g, x1, x2, y, "settings.videoOptions");
		String vl = L.up("settings.open");
		int vw = Theme.spacedWidth(vl, 1) + 20;
		button(g, x2 - vw, y - ROW + 5, x2, y - ROW + 21, vl, Style.GHOST,
			() -> open(new net.minecraft.client.gui.screens.options.OptionsScreen(this, minecraft.options)));

		List<FormattedCharSequence> lines = font.split(FormattedText.of(L.t("settings.performanceNote")), x2 - x1);
		for (int i = 0; i < Math.min(3, lines.size()); i++) g.text(font, lines.get(i), x1, y + 6 + i * 10, Theme.FAINT, false);
	}

	private record Bind(Module module, KeySetting key) {}

	private void drawControls(GuiGraphicsExtractor g) {
		List<Bind> binds = new ArrayList<>();
		for (Module m : ModuleManager.all())
			for (Setting<?> s : m.settings()) if (s instanceof KeySetting k) binds.add(new Bind(m, k));
		int x1 = cx1 + 4, x2 = cx2 - 4, rowH = 22, contentH = (binds.size() + 1) * rowH;
		scrollTick(contentH);
		g.enableScissor(cx1 - 2, listY1, cx2 + 2, listY2);
		int y = listY1 - (int) Math.round(scroll);
		PClientConfig c = PClientConfig.get();
		controlRow(g, x1, x2, y, L.t("settings.menuKey"), "PClient", MENU_KEY, InputConstants.Type.KEYBOARD.getOrCreate(c.menuKey).getDisplayName().getString());
		y += rowH;
		for (Bind b : binds) {
			String sub = b.key.group != null ? L.t(b.key.group) + " · " + L.t(b.key.labelKey) : L.t(b.key.labelKey);
			String label = b.key.get() == InputConstants.UNKNOWN.getValue() ? L.t("settings.unbound") : b.key.display();
			controlRow(g, x1, x2, y, L.t(b.module.nameKey()), sub, b.key, label);
			y += rowH;
		}
		g.disableScissor();
		scrollbar(g, contentH);
	}

	private void controlRow(GuiGraphicsExtractor g, int x1, int x2, int y, String title, String sub, Object target, String keyLabel) {
		if (y + 22 < listY1 || y > listY2) return;
		g.text(font, title, x1, y + 2, Theme.TEXT, false);
		g.text(font, Theme.ellipsize(sub, x2 - x1 - 120), x1, y + 12, Theme.FAINT, false);
		if (y + 3 >= listY1 && y + 19 <= listY2) keyButton(g, x2, y + 3, target, keyLabel);
		g.fill(x1, y + 21, x2, y + 22, 0x0FFFFFFF);
	}

	private void keyButton(GuiGraphicsExtractor g, int right, int y, Object target, String label) {
		String v = listening == target ? L.t("settings.pressKey") : label;
		int w = Math.max(80, font.width(v) + 16);
		button(g, right - w, y, right, y + 16, v, listening == target ? Style.PRIMARY : Style.SECONDARY,
			() -> listening = listening == target ? null : target);
	}

	/** Ayar satırı: başlık + açıklama; kontrol sağa çizilir. Bir sonraki satırın y'sini döner. */
	private int row(GuiGraphicsExtractor g, int x1, int x2, int y, String key) {
		g.text(font, L.t(key), x1, y + 3, Theme.TEXT, false);
		g.text(font, Theme.ellipsize(L.t(key + ".desc"), x2 - x1 - 140), x1, y + 14, Theme.FAINT, false);
		g.fill(x1, y + ROW - 3, x2, y + ROW - 2, Theme.LINE);
		return y + ROW;
	}

	// ---------------- Yol noktaları ----------------

	private void drawWaypoints(GuiGraphicsExtractor g) {
		int x1 = cx1, x2 = cx2, y = top + 8;
		if (Waypoints.worldKey() == null) {
			PixelIcons.drawCentered(g, "flag", (x1 + x2) / 2, top + 70, 3, Theme.FAINT);
			g.centeredText(font, L.t("waypoints.noWorld"), (x1 + x2) / 2, top + 96, Theme.MUTED);
			return;
		}
		List<Waypoints.Waypoint> list = Waypoints.current();
		if (!list.contains(selectedWaypoint)) selectedWaypoint = null;
		String add = L.up(selectedWaypoint != null ? "waypoints.rename" : "waypoints.addHere");
		int aw = Theme.spacedWidth(add, 1) + 20;
		String cfg = L.up("card.settings");
		int sw = Theme.spacedWidth(cfg, 1) + 18;
		textField(g, x1, y, x2 - aw - sw - 12, y + 18, waypointName, 11, "flag");
		button(g, x2 - aw - sw - 6, y, x2 - sw - 6, y + 18, add, Style.PRIMARY, this::addOrRenameWaypoint);
		button(g, x2 - sw, y, x2, y + 18, cfg, Style.GHOST, () -> open(new ModuleSettingsScreen(WaypointsModule.instance(), this)));
		y += 24;
		if (!WaypointsModule.instance().isEnabled()) {
			g.text(font, Theme.ellipsize(L.t("waypoints.moduleOff"), x2 - x1), x1, y, 0xFFE5A04D, false);
			y += 12;
		}
		listY1 = y;
		listY2 = bottom - 6;
		int rowH = 24, contentH = list.size() * rowH;
		scrollTick(contentH);
		if (list.isEmpty()) {
			g.centeredText(font, L.t("waypoints.empty"), (x1 + x2) / 2, listY1 + 24, Theme.MUTED);
			g.centeredText(font, L.t("waypoints.hint", WaypointsModule.instance().quickKey.display()), (x1 + x2) / 2, listY1 + 38, Theme.FAINT);
			return;
		}
		var p = minecraft.player;
		g.enableScissor(x1 - 2, listY1, x2 + 2, listY2);
		int ry = listY1 - (int) Math.round(scroll);
		for (Waypoints.Waypoint w : List.copyOf(list)) {
			if (ry + rowH >= listY1 && ry <= listY2) waypointRow(g, w, x1, ry, x2 - (maxScroll > 0 ? 8 : 0), p);
			ry += rowH;
		}
		g.disableScissor();
		scrollbar(g, contentH);
	}

	private void waypointRow(GuiGraphicsExtractor g, Waypoints.Waypoint w, int x1, int y, int x2, net.minecraft.client.player.LocalPlayer p) {
		boolean sel = w == selectedWaypoint;
		int y2 = y + 21;
		boolean hov = hitClipped(x1, y, x2 - 46, y2, () -> {
			selectedWaypoint = sel ? null : w;
			waypointName.set(sel ? "" : w.name);
		}, null);
		Theme.notched(g, x1, y, x2, y2, 3, sel ? Theme.withAlpha(Theme.accent(), 0x26) : hov ? Theme.CARD_HOVER : Theme.CARD);
		Theme.notchedOutline(g, x1, y, x2, y2, 3, sel ? Theme.withAlpha(Theme.accent(), 0xB0) : Theme.LINE);
		// Renk: tıklayınca sıradakine geçer
		boolean hc = hitClipped(x1 + 4, y + 4, x1 + 17, y + 17, () -> {
			int i = 0;
			for (int k = 0; k < Waypoints.COLORS.length; k++) if (Waypoints.COLORS[k] == w.color) i = k;
			w.color = Waypoints.COLORS[(i + 1) % Waypoints.COLORS.length];
			Waypoints.save();
		}, null);
		g.fill(x1 + 5, y + 5, x1 + 16, y + 16, w.color);
		if (hc) g.outline(x1 + 4, y + 4, 13, 13, 0xFFFFFFFF);
		String dim = w.dimension.endsWith("the_nether") ? L.t("dim.nether") : w.dimension.endsWith("the_end") ? L.t("dim.end")
			: w.dimension.endsWith("overworld") ? L.t("dim.overworld") : w.dimension;
		String info = w.x + ", " + w.y + ", " + w.z + "  ·  " + dim;
		boolean here = p != null && w.dimension.equals(Waypoints.dimension());
		if (here) info += "  ·  " + Math.round(w.distanceTo(p.getX(), p.getY(), p.getZ())) + "m";
		int room = x2 - x1 - 24 - 50;
		g.text(font, Theme.ellipsize(w.name, Math.min(room, 140)), x1 + 22, y + 7, w.visible ? Theme.TEXT : Theme.MUTED, false);
		int infoX = x1 + 22 + Math.min(room, 140) + 8;
		g.text(font, Theme.ellipsize(info, x2 - 50 - infoX), infoX, y + 7, Theme.FAINT, false);
		// Görünürlük ve silme
		int ex = x2 - 44;
		boolean he = hitClipped(ex, y + 2, ex + 18, y + 19, () -> {
			w.visible = !w.visible;
			Waypoints.save();
		}, null);
		PixelIcons.drawCentered(g, "eye", ex + 9, y + 11, 1, w.visible ? (he ? Theme.TEXT : Theme.accent()) : Theme.FAINT);
		if (he) tipNow(L.t(w.visible ? "waypoints.hide" : "waypoints.show"));
		int tx = x2 - 22;
		boolean armed = ("wp:" + System.identityHashCode(w)).equals(deleteArmed) && System.currentTimeMillis() < deleteArmedUntil;
		boolean ht = hitClipped(tx, y + 2, tx + 18, y + 19, () -> {
			String id = "wp:" + System.identityHashCode(w);
			if (id.equals(deleteArmed) && System.currentTimeMillis() < deleteArmedUntil) {
				Waypoints.current().remove(w);
				Waypoints.save();
				deleteArmed = null;
			} else {
				deleteArmed = id;
				deleteArmedUntil = System.currentTimeMillis() + 3000;
			}
		}, null);
		PixelIcons.drawCentered(g, "trash", tx + 9, y + 11, 1, armed ? 0xFFE5484D : ht ? Theme.TEXT : Theme.FAINT);
		if (ht) tipNow(L.t(armed ? "waypoints.deleteConfirm" : "waypoints.delete"));
	}

	private void addOrRenameWaypoint() {
		String name = waypointName.value().strip();
		if (selectedWaypoint != null) {
			if (!name.isEmpty()) {
				selectedWaypoint.name = name;
				Waypoints.save();
			}
			selectedWaypoint = null;
			waypointName.set("");
			return;
		}
		if (name.isEmpty()) name = L.t("waypoints.defaultName", Waypoints.current().size() + 1);
		if (Waypoints.addHere(name, Waypoints.nextColor(), false) != null) waypointName.set("");
	}

	// ---------------- Girdi ----------------

	@Override public boolean mouseScrolled(double x, double y, double h, double v) {
		if (x < px + SIDE) {
			profileOffset -= (int) Math.signum(v);
			return true;
		}
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget - v * 30));
		return true;
	}

	@Override public boolean keyPressed(KeyEvent e) {
		if (listening != null) {
			int key = e.key() == InputConstants.KEY_ESCAPE ? -2 : e.key();
			if (listening == MENU_KEY) {
				if (key != -2) PClientConfig.get().menuKey = key;
			} else if (listening instanceof KeySetting k) {
				// ESC atamayı kaldırır (tuşsuz kısayol).
				k.set(key == -2 ? InputConstants.UNKNOWN.getValue() : key);
			}
			listening = null;
			return true;
		}
		if ((creatingProfile || importingProfile) && e.key() == InputConstants.KEY_ESCAPE) {
			creatingProfile = importingProfile = false;
			profileError = null;
			focus(tab == Tab.MODULES ? search : null);
			return true;
		}
		if (e.key() == PClientConfig.get().menuKey && search.value().isEmpty() && !creatingProfile && !importingProfile) {
			onClose();
			return true;
		}
		return super.keyPressed(e);
	}
}
