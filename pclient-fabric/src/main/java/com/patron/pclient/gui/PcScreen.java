package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.bridge.Accounts;
import com.patron.pclient.bridge.Patron;
import com.patron.pclient.config.PClientConfig;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.modules.SoonModule;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.FormattedCharSequence;

/**
 * Tüm PClient ekranlarının temeli. Anlık (immediate-mode) çizim: her karede tıklanabilir alanlar
 * yeniden kaydedilir, tıklama son karedeki alanlara göre işlenir. Alt kısımda ortak menü çubuğu (dock) bulunur.
 */
public abstract class PcScreen extends Screen {
	protected final Screen parent;
	private final List<Hit> hits = new ArrayList<>();
	private final long openedAt = System.nanoTime();
	private long lastFrame = System.nanoTime();
	/** Son karenin süresi (saniye). */
	protected float dt;
	protected int mouseX, mouseY;
	private List<FormattedCharSequence> tooltip;
	private String hoverKey;
	private long hoverSince;

	private record Hit(int x1, int y1, int x2, int y2, Runnable left, Runnable right) {}

	/** Odaktaki metin kutusu; karakterler yalnızca odak varken alınır. */
	private PcTextField focused;
	/** Son karede çizilen metin kutuları (Tab ile geçiş için). */
	private final List<PcTextField> fields = new ArrayList<>();

	protected PcScreen(String titleKey, Screen parent) {
		super(Component.literal(L.t(titleKey)));
		this.parent = parent;
	}

	@Override public boolean isPauseScreen() { return false; }

	/** Alt menü çubuğunda vurgulanacak öğe; null ise çubuk gizlenir. */
	protected String dock() { return ""; }

	@Override public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float delta) {
		if (minecraft.level == null && !MenuThemes.draw(g, width, height)) extractPanorama(g, delta);
		if (PClientConfig.get().blur) extractBlurredBackground(g);
		g.fillGradient(0, 0, width, height, 0x8C04050A, 0xC804050A);
	}

	@Override public final void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float delta) {
		long now = System.nanoTime();
		dt = Math.min(0.1f, (now - lastFrame) / 1e9f);
		lastFrame = now;
		hits.clear();
		fields.clear();
		tooltip = null;
		mouseX = mx;
		mouseY = my;
		// Açılışta hafif yukarı kayarak belirme.
		float t = Math.min(1, (now - openedAt) / 1e9f / 0.22f), ease = 1 - (1 - t) * (1 - t) * (1 - t);
		g.pose().pushMatrix();
		g.pose().translate(0, (1 - ease) * 8);
		draw(g, mx, my);
		g.pose().popMatrix();
		if (dock() != null) drawDock(g);
		// Açılır menü ve onay penceresi her şeyin üstünde; açıkken alttaki öğeler vurgulanmaz.
		overlayDrawing = true;
		if (menuItems != null) drawMenu(g);
		if (confirm != null) drawConfirm(g);
		overlayDrawing = false;
		if (tooltip != null) drawTooltip(g);
		MessageToasts.render(g);
	}

	protected abstract void draw(GuiGraphicsExtractor g, int mx, int my);

	// --- Tıklama alanları ---

	protected boolean hover(int x1, int y1, int x2, int y2) {
		if ((menuItems != null || confirm != null) && !overlayDrawing) return false;
		return mouseX >= x1 && mouseX < x2 && mouseY >= y1 && mouseY < y2;
	}

	/** Tıklanabilir alan kaydeder; fare üstündeyse true. */
	protected boolean hit(int x1, int y1, int x2, int y2, Runnable left) { return hit(x1, y1, x2, y2, left, null); }

	protected boolean hit(int x1, int y1, int x2, int y2, Runnable left, Runnable right) {
		hits.add(new Hit(x1, y1, x2, y2, left, right));
		return hover(x1, y1, x2, y2);
	}

	@Override public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
		// Başka bir yere tıklanınca metin kutusu odağı bırakılır; kutunun kendi alanı odağı geri verir.
		focus(null);
		List<Hit> snapshot = List.copyOf(hits);
		for (int i = snapshot.size() - 1; i >= 0; i--) {
			Hit h = snapshot.get(i);
			if (e.x() < h.x1 || e.x() >= h.x2 || e.y() < h.y1 || e.y() >= h.y2) continue;
			int b = e.button();
			Runnable r = b == com.mojang.blaze3d.platform.InputConstants.MOUSE_BUTTON_LEFT ? h.left
				: b == com.mojang.blaze3d.platform.InputConstants.MOUSE_BUTTON_RIGHT ? h.right : null;
			if (r == null) continue;
			click();
			r.run();
			return true;
		}
		return super.mouseClicked(e, doubleClick);
	}

	protected void click() {
		minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0F));
	}

	protected void open(Screen s) { minecraft.gui.setScreen(s); }

	@Override public void onClose() { minecraft.gui.setScreen(parent); }

	@Override public void removed() {
		focused = null;
		closeOverlays();
		accountOpen = false;
		accountClosing = false;
		PClientConfig.save();
	}

	// --- Metin kutuları ---

	protected void focus(PcTextField f) {
		if (focused == f) return;
		focused = f;
		// 26.3 (SDL): karakter olayları için metin girişi açıkça başlatılmalıdır.
		minecraft.onTextInputFocusChange(this, f != null);
	}

	protected boolean isFocused(PcTextField f) { return focused == f; }

	protected void textField(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, PcTextField f) { textField(g, x1, y1, x2, y2, f, 0, null); }

	/** Metin kutusu çizer; padLeft solda simge için boşluk, icon isteğe bağlı simge adı. */
	protected void textField(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, PcTextField f, int padLeft, String icon) {
		fields.add(f);
		boolean foc = focused == f, hov = hit(x1, y1, x2, y2, () -> focus(f));
		Theme.notched(g, x1, y1, x2, y2, 3, foc ? 0x26FFFFFF : hov ? 0x1CFFFFFF : 0x12FFFFFF);
		Theme.notchedOutline(g, x1, y1, x2, y2, 3, foc ? Theme.withAlpha(fieldAccent(), 0xA0) : hov ? Theme.LINE_STRONG : Theme.LINE);
		int ty = (y1 + y2) / 2 - 4;
		if (icon != null) PixelIcons.draw(g, icon, x1 + 6, ty + 1, 1, foc ? Theme.TEXT : Theme.MUTED);
		int tx = x1 + 6 + padLeft, room = x2 - tx - 6;
		String v = f.value();
		if (v.isEmpty()) {
			g.text(font, Theme.ellipsize(f.placeholder, room), tx, ty, Theme.FAINT, false);
			if (foc && System.currentTimeMillis() / 500 % 2 == 0) g.fill(tx, ty - 1, tx + 1, ty + 9, Theme.TEXT);
			return;
		}
		// Uzun metinde sonu görünür kalır.
		String shown = v;
		while (!shown.isEmpty() && font.width(shown) > room - 2) shown = shown.substring(shown.offsetByCodePoints(0, 1));
		g.text(font, shown, tx, ty, Theme.TEXT, false);
		if (foc && System.currentTimeMillis() / 500 % 2 == 0) {
			int caret = tx + font.width(shown);
			g.fill(caret, ty - 1, caret + 1, ty + 9, Theme.TEXT);
		}
	}

	@Override public boolean keyPressed(net.minecraft.client.input.KeyEvent e) {
		if ((menuItems != null || confirm != null) && e.key() == com.mojang.blaze3d.platform.InputConstants.KEY_ESCAPE) {
			closeOverlays();
			return true;
		}
		if (accountOpen && !accountClosing && e.key() == com.mojang.blaze3d.platform.InputConstants.KEY_ESCAPE) {
			focus(null);
			closeAccount();
			return true;
		}
		if (focused != null && fieldKey(e)) return true;
		return super.keyPressed(e);
	}

	/** Odaktaki metin kutusuna tuş işler; işlendiyse true. */
	private boolean fieldKey(net.minecraft.client.input.KeyEvent e) {
		PcTextField f = focused;
		int k = e.key();
		switch (k) {
			case com.mojang.blaze3d.platform.InputConstants.KEY_ESCAPE -> {
				if (f.clearOnEscape && !f.value().isEmpty()) {
					f.set("");
					return true;
				}
				focus(null);
				return false;
			}
			case com.mojang.blaze3d.platform.InputConstants.KEY_BACKSPACE -> f.backspace(e.hasControlDown());
			case com.mojang.blaze3d.platform.InputConstants.KEY_RETURN, com.mojang.blaze3d.platform.InputConstants.KEY_NUMPADENTER -> {
				if (f.onSubmit != null) f.onSubmit.run();
			}
			case com.mojang.blaze3d.platform.InputConstants.KEY_TAB -> {
				if (fields.size() > 1) {
					int i = fields.indexOf(f);
					focus(fields.get(Math.floorMod(i + (e.hasShiftDown() ? -1 : 1), fields.size())));
				}
			}
			default -> {
				if (e.hasControlDown() && k == com.mojang.blaze3d.platform.InputConstants.KEY_V) f.type(minecraft.keyboardHandler.getClipboard());
				else if (e.hasControlDown() && k == com.mojang.blaze3d.platform.InputConstants.KEY_C) minecraft.keyboardHandler.setClipboard(f.value());
				// Yazı yazılırken harf tuşları kısayol olarak işlenmez; F tuşları ve benzerleri geçer.
				else return k >= com.mojang.blaze3d.platform.InputConstants.KEY_SPACE && k <= 0xFF;
			}
		}
		return true;
	}

	@Override public boolean charTyped(net.minecraft.client.input.CharacterEvent e) {
		if (focused != null && e.isAllowedChatCharacter()) {
			focused.type(e.codepointAsString());
			return true;
		}
		return super.charTyped(e);
	}

	// --- Araç ipucu ---

	/** Fare bir süre aynı öğenin üstünde kalınca ipucu gösterir. */
	protected void tip(String key, String text) {
		if (!key.equals(hoverKey)) {
			hoverKey = key;
			hoverSince = System.nanoTime();
		}
		if ((System.nanoTime() - hoverSince) / 1e6 > 350) tooltip = font.split(FormattedText.of(text), 180);
	}

	protected void tipNow(String text) { tooltip = font.split(FormattedText.of(text), 180); }

	private void drawTooltip(GuiGraphicsExtractor g) {
		int w = 0;
		for (FormattedCharSequence l : tooltip) w = Math.max(w, font.width(l));
		int h = tooltip.size() * 10 + 8, x = Math.min(mouseX + 10, width - w - 14), y = Math.max(4, mouseY - h - 4);
		g.nextStratum();
		Theme.notched(g, x, y, x + w + 10, y + h, 3, 0xF20A0B10);
		g.fill(x + 3, y, x + w + 10, y + 1, Theme.accent());
		for (int i = 0; i < tooltip.size(); i++) g.text(font, tooltip.get(i), x + 5, y + 5 + i * 10, Theme.TEXT, false);
	}

	// --- Alt menü çubuğu ---

	private record DockItem(String id, String icon, String label, Runnable action) {}

	private List<DockItem> dockItems() {
		// Ana menüde (dünyada değilken) çubuk sade: Sunucular ve Modüller ortadaki düğmelerde, Arkadaşlar ve
		// Kozmetikler soldaki profil panelinde. Oyun içinde (duraklatma menüsü) tüm öğeler çubukta kalır.
		boolean menu = minecraft.level == null;
		List<DockItem> items = new ArrayList<>();
		items.add(new DockItem("home", "home", L.t("dock.home"), () -> open(menu ? new PClientTitleScreen() : new PClientHomeScreen())));
		if (!menu) items.add(new DockItem("modules", "grid", L.t("dock.modules"), () -> open(new ModulesScreen(ModulesScreen.Tab.MODULES))));
		items.add(new DockItem("hud", "hud", L.t("dock.hud"), () -> open(new HudEditorScreen(this))));
		if (!menu) items.add(new DockItem("friends", "chat", L.t("dock.friends"), () -> open(new PClientFriendsScreen(this))));
		items.addAll(List.of(
			new DockItem("music", "music", L.t("module.music.name"), () -> open(new PClientMusicScreen(this))),
			new DockItem("themes", "image", L.t("dock.themes"), () -> open(new PClientThemesScreen(this))),
			new DockItem("mods", "puzzle", L.t("dock.mods"), () -> open(new PClientModsScreen(this))),
			new DockItem("modrinth", "download", L.t("dock.modrinth"), () -> open(new PClientModrinthScreen(this))),
			new DockItem("schematics", "house", L.t("module.schematics.name"), () -> open(new ComingSoonScreen((SoonModule) ModuleManager.byId("schematics"), this)))));
		if (!menu) items.add(new DockItem("cosmetics", "shirt", L.t("module.cosmetics.name"), () -> open(new ComingSoonScreen((SoonModule) ModuleManager.byId("cosmetics"), this))));
		items.addAll(List.of(
			new DockItem("minecraft", "grass", L.t("dock.minecraft"), () -> open(new net.minecraft.client.gui.screens.options.OptionsScreen(this, minecraft.options))),
			new DockItem("settings", "gear", L.t("dock.settings"), () -> open(new ModulesScreen(ModulesScreen.Tab.SETTINGS)))));
		return items;
	}

	protected void closeFromDock() {
		// Ana menünün altında kapatılacak bir şey yoktur.
		if (!(this instanceof PClientTitleScreen)) onClose();
	}

	private void drawDock(GuiGraphicsExtractor g) {
		List<DockItem> items = dockItems();
		int size = 22, gap = 4, w = items.size() * (size + gap) - gap + 10, x = (width - w) / 2, y = height - size - 12;
		Theme.notched(g, x, y - 5, x + w, y + size + 5, 4, 0xD80A0B10);
		Theme.notchedOutline(g, x, y - 5, x + w, y + size + 5, 4, Theme.LINE);
		for (int i = 0; i < items.size(); i++) {
			DockItem d = items.get(i);
			int bx = x + 5 + i * (size + gap);
			// Açık sekmenin düğmesine yeniden basınca sekme kapanır.
			boolean active = d.id.equals(dock()), hov = hit(bx, y, bx + size, y + size, active ? this::closeFromDock : d.action);
			int bg = active ? Theme.withAlpha(Theme.accent(), 0x40) : hov ? 0x26FFFFFF : 0x0FFFFFFF;
			Theme.notched(g, bx, y, bx + size, y + size, 3, bg);
			if (active) Theme.notchedOutline(g, bx, y, bx + size, y + size, 3, Theme.accent());
			if (d.id.equals("modrinth")) Theme.modrinthLogo(g, bx + size / 2 - 7, y + size / 2 - 7, 14);
			else PixelIcons.drawCentered(g, d.icon, bx + size / 2, y + size / 2, 1, active || hov ? Theme.TEXT : Theme.MUTED);
			if (hov) dockLabel(g, d.label, bx + size / 2, y - 9);
		}
	}

	private void dockLabel(GuiGraphicsExtractor g, String label, int cx, int bottom) {
		int w = Math.max(font.width(label), font.width("PClient")) + 12, h = 24, x = cx - w / 2, y = bottom - h;
		g.nextStratum();
		Theme.notched(g, x, y, x + w, y + h, 3, 0xF20A0B10);
		g.text(font, label, x + 6, y + 4, Theme.TEXT, false);
		Theme.scaledText(g, "PClient", x + 6, y + 15, 0.75f, Theme.FAINT, false);
	}

	// --- Hesap menüsü (sol üst) ---

	private static boolean accountOpen, accountClosing;
	/** Menünün açılma/kapanma animasyonunun başladığı an (ns). */
	private static long accountAnimAt;
	private static final float ACCOUNT_ANIM_MS = 160f;
	private PcTextField accountField;

	private void openAccount() {
		accountOpen = true;
		accountClosing = false;
		accountAnimAt = System.nanoTime();
		Accounts.clearError();
		Accounts.refresh();
		Patron.clearError();
		Patron.refresh();
	}

	private void closeAccount() {
		if (!accountOpen || accountClosing) return;
		accountClosing = true;
		accountAnimAt = System.nanoTime();
	}

	/** 0→1 açılış (kapanırken 1→0), yumuşak yavaşlayan eğri. */
	private static float accountProgress() {
		float t = Math.min(1f, (System.nanoTime() - accountAnimAt) / 1e6f / ACCOUNT_ANIM_MS);
		float eased = 1f - (1f - t) * (1f - t) * (1f - t);
		return accountClosing ? 1f - eased : eased;
	}

	private PcTextField accountField() {
		if (accountField == null) {
			accountField = new PcTextField(16, L.t("account.namePlaceholder")).onSubmit(this::addLocalAccount);
			accountField.allow(c -> Character.isLetterOrDigit(c) && c < 128 || c == '_');
		}
		return accountField;
	}

	private void addLocalAccount() {
		String name = accountField().value().strip();
		if (name.isEmpty() || Accounts.busy()) return;
		Accounts.addLocal(name);
		accountField().set("");
	}

	/** Etkin hesabı gösterir; tıklayınca hesap değiştirme ve ekleme menüsü açılır. Ekranın sonunda çağrılır. */
	protected void accountWidget(GuiGraphicsExtractor g) {
		String name = minecraft.getUser().getName();
		int x = 8, y = 8, w = font.width(name) + 38, h = 20;
		boolean hov = hit(x, y, x + w, y + h, () -> {
			if (accountOpen && !accountClosing) closeAccount();
			else openAccount();
		});
		Theme.notched(g, x, y, x + w, y + h, 3, hov || accountOpen ? 0xE81A1C26 : 0xC00A0B10);
		Theme.notchedOutline(g, x, y, x + w, y + h, 3, accountOpen ? Theme.accent() : Theme.LINE);
		PixelIcons.drawCentered(g, "user", x + 11, y + h / 2, 1, Theme.accent());
		g.text(font, name, x + 20, y + 6, Theme.TEXT, false);
		PixelIcons.drawCentered(g, "chevron", x + w - 9, y + h / 2, 1, Theme.MUTED);
		// Hesap eklenebildiğini belli eden + düğmesi; menüyü açar.
		int px = x + w + 3;
		boolean add = hit(px, y, px + h, y + h, () -> {
			if (!accountOpen || accountClosing) openAccount();
		});
		float pulse = (float) (Math.sin(System.nanoTime() / 1e9 * 3) * 0.5 + 0.5);
		Theme.notched(g, px, y, px + h, y + h, 3, add ? Theme.accent() : Theme.withAlpha(Theme.accent(), 0x30 + (int) (pulse * 0x30)));
		Theme.notchedOutline(g, px, y, px + h, y + h, 3, Theme.accent());
		g.fill(px + 6, y + 9, px + 14, y + 11, Theme.TEXT);
		g.fill(px + 9, y + 6, px + 11, y + 14, Theme.TEXT);
		if (add) tipNow(L.t("account.add"));
		if (accountOpen) {
			float progress = accountProgress();
			if (accountClosing && progress <= 0f) {
				accountOpen = false;
				accountClosing = false;
			} else accountMenu(g, x, y + h + 3, progress);
		}
	}

	private void accountMenu(GuiGraphicsExtractor g, int x, int y, float progress) {
		// Kapanırken tıklamalar menüye gitmez.
		if (!accountClosing) hit(0, 0, width, height, this::closeAccount);
		boolean inWorld = minecraft.level != null, reachable = Accounts.reachable();
		List<Accounts.Entry> list = Accounts.list();
		int w = 196, rowH = 20, rows = Math.min(7, Math.max(1, list.size()));
		int h = 8 + rows * rowH + 4;
		boolean login = Accounts.loginActive();
		if (!reachable || inWorld) h += 26;
		else h += login ? 64 : 52;
		String error = Accounts.error();
		List<FormattedCharSequence> errorLines = error == null ? List.of() : font.split(FormattedText.of(error), w - 16);
		h += errorLines.size() * 10;
		// Üstte PatronLauncher hesabı bölümü.
		int patronH = patronHeight();
		h += patronH;
		g.nextStratum();
		// Açılış: menü yukarıdan aşağı açılır ve hafifçe kayar; kapanış tersi.
		int shown = Math.max(1, Math.round(h * progress));
		y -= Math.round((1f - progress) * 6);
		g.enableScissor(x - 1, y - 1, x + w + 1, y + shown + 1);
		Theme.notched(g, x, y, x + w, y + h, 5, 0xF60A0B10);
		Theme.notchedOutline(g, x, y, x + w, y + h, 5, Theme.LINE_STRONG);
		if (!accountClosing) hit(x, y, x + w, y + h, () -> {});
		int x1 = x + 6, x2 = x + w - 6;
		patronSection(g, x1, y + 6, x2);
		int top = y + patronH;
		int ry = top + 6;
		if (list.isEmpty()) g.text(font, L.t(reachable ? "account.empty" : "account.launcher"), x1 + 2, ry + 6, Theme.MUTED, false);
		java.util.UUID current = minecraft.getUser().getProfileId();
		for (int i = 0; i < rows && i < list.size(); i++) {
			Accounts.Entry a = list.get(i);
			boolean on = a.uuid().equals(current), enabled = !on && !inWorld && !Accounts.busy();
			boolean hov = enabled ? hit(x1, ry, x2, ry + rowH - 2, () -> Accounts.select(a.id())) : hover(x1, ry, x2, ry + rowH - 2);
			Theme.notched(g, x1, ry, x2, ry + rowH - 2, 3, on ? Theme.withAlpha(Theme.accent(), 0x2E) : hov && enabled ? 0x1EFFFFFF : 0x08FFFFFF);
			PixelIcons.drawCentered(g, "user", x1 + 10, ry + 9, 1, on ? Theme.accent() : Theme.FAINT);
			String tag = L.up(a.microsoft() ? "account.microsoft" : "account.local");
			int tagW = (int) Math.ceil(font.width(tag) * 0.7f);
			g.text(font, Theme.ellipsize(a.name(), x2 - x1 - 26 - tagW), x1 + 20, ry + 5, on ? Theme.TEXT : Theme.MUTED, false);
			Theme.scaledText(g, tag, x2 - 5 - tagW, ry + 6, 0.7f, a.microsoft() ? 0xFF57B6FF : Theme.FAINT, false);
			ry += rowH;
		}
		ry = top + 8 + rows * rowH;
		for (FormattedCharSequence line : errorLines) {
			g.text(font, line, x1 + 2, ry, 0xFFE5A04D, false);
			ry += 10;
		}
		if (!reachable) {
			if (!list.isEmpty()) g.text(font, Theme.ellipsize(L.t("account.launcher"), x2 - x1), x1 + 2, ry + 6, 0xFFE5A04D, false);
			g.disableScissor();
			return;
		}
		if (inWorld) {
			g.text(font, Theme.ellipsize(L.t("account.inWorld"), x2 - x1), x1 + 2, ry + 6, Theme.MUTED, false);
			g.disableScissor();
			return;
		}
		g.fill(x1, ry, x2, ry + 1, Theme.LINE);
		ry += 5;
		if (login) {
			g.text(font, Theme.ellipsize(L.t("account.msBrowser"), x2 - x1), x1 + 2, ry + 1, Theme.MUTED, false);
			ry += 12;
			button(g, x1, ry, x2, ry + 20, L.up("account.cancel"), Style.GHOST, Accounts::cancelMicrosoft);
			ry += 24;
		} else {
			microsoftButton(g, x1, ry, x2, ry + 20);
			ry += 24;
		}
		textField(g, x1, ry, x2 - 24, ry + 18, accountField());
		button(g, x2 - 20, ry, x2, ry + 18, "+", Style.PRIMARY, this::addLocalAccount);
		g.disableScissor();
	}

	/** PatronLauncher hesabı bölümünün yüksekliği (başlık + satır + ayırıcı). */
	private int patronHeight() {
		int h = 12 + 22 + 8;
		if (Patron.state() == Patron.State.PENDING) h += 24;
		if (Patron.error() != null) h += 10;
		return h;
	}

	/**
	 * Menünün en üstünde PatronLauncher hesabı (site hesabı): girişli ise ad + profil, bekliyorsa kod,
	 * değilse "PatronLauncher hesabıyla giriş yap" (launcher tarayıcıda onay sayfasını açar).
	 */
	private void patronSection(GuiGraphicsExtractor g, int x1, int y, int x2) {
		Theme.scaledText(g, L.up("patron.title"), x1 + 2, y, 0.7f, Theme.FAINT, false);
		int ry = y + 10;
		Patron.State st = Patron.state();
		int accent = Theme.accent();
		if (st == Patron.State.SIGNED_IN) {
			Theme.notched(g, x1, ry, x2, ry + 20, 3, 0x183DDC84);
			Theme.notchedOutline(g, x1, ry, x2, ry + 20, 3, 0x553DDC84);
			String n = Patron.name() == null ? "?" : Patron.name();
			// Baş harf yerine PatronLauncher'ın piksel logosu (Microsoft düğmesindeki logo gibi).
			Theme.logo(g, x1 + 4, ry + 3, 14);
			String label = L.up("patron.profile");
			int bw = font.width(label) + 10;
			g.text(font, Theme.ellipsize(n, x2 - x1 - bw - 30), x1 + 21, ry + 6, Theme.TEXT, false);
			button(g, x2 - bw - 2, ry + 2, x2 - 2, ry + 18, label, Style.GHOST, Patron::openProfile);
		} else if (st == Patron.State.PENDING) {
			Theme.notched(g, x1, ry, x2, ry + 20, 3, 0x18FFB454);
			Theme.notchedOutline(g, x1, ry, x2, ry + 20, 3, 0x55FFB454);
			String c = Patron.code() == null ? "…" : Patron.code();
			g.text(font, L.t("patron.code"), x1 + 5, ry + 6, Theme.MUTED, false);
			g.text(font, c, x2 - 5 - font.width(c), ry + 6, 0xFFFFB454, false);
			ry += 24;
			int mid = (x1 + x2) / 2;
			button(g, x1, ry, mid - 2, ry + 18, L.up("patron.reopen"), Style.SECONDARY, Patron::reopen);
			button(g, mid + 2, ry, x2, ry + 18, L.up("account.cancel"), Style.GHOST, Patron::cancel);
		} else {
			boolean hov = hit(x1, ry, x2, ry + 20, Patron::login);
			Theme.notched(g, x1, ry, x2, ry + 20, 3, hov ? accent : Theme.withAlpha(accent, 0xC8));
			Theme.notchedOutline(g, x1, ry, x2, ry + 20, 3, accent);
			PixelIcons.drawCentered(g, "user", x1 + 11, ry + 10, 1, Theme.TEXT);
			g.text(font, Theme.ellipsize(L.t(Patron.busy() ? "patron.opening" : "patron.login"), x2 - x1 - 26), x1 + 21, ry + 6, Theme.TEXT, false);
		}
		ry += 22;
		if (Patron.error() != null) {
			g.text(font, Theme.ellipsize(L.t("patron.error"), x2 - x1), x1 + 2, ry, 0xFFE5A04D, false);
			ry += 10;
		}
		g.fill(x1, ry + 2, x2, ry + 3, Theme.LINE);
	}

	/** Microsoft'un dört kareli logosuyla giriş düğmesi; tarayıcıda doğrudan giriş sayfası açılır. */
	private void microsoftButton(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		boolean hov = hit(x1, y1, x2, y2, Accounts::startMicrosoft);
		Theme.notched(g, x1, y1, x2, y2, 3, hov ? 0xFF2B2F3A : 0xFF20232C);
		Theme.notchedOutline(g, x1, y1, x2, y2, 3, hov ? 0xFF57B6FF : Theme.LINE_STRONG);
		int lx = x1 + 7, ly = y1 + 5;
		g.fill(lx, ly, lx + 4, ly + 4, 0xFFF25022);
		g.fill(lx + 5, ly, lx + 9, ly + 4, 0xFF7FBA00);
		g.fill(lx, ly + 5, lx + 4, ly + 9, 0xFF00A4EF);
		g.fill(lx + 5, ly + 5, lx + 9, ly + 9, 0xFFFFB900);
		g.text(font, Theme.ellipsize(L.t("account.msLogin"), x2 - lx - 16), lx + 15, y1 + 6, Theme.TEXT, false);
	}

	// --- Açılır menü (sağ tık / "⋯") ve onay penceresi: Discord tarzı, tüm ekranlarda ortak ---

	/** Menü öğesi; label null ise ayırıcı çizgi. */
	protected record MenuItem(String icon, String label, Runnable run, boolean danger) {
		public static MenuItem sep() { return new MenuItem(null, null, null, false); }
	}
	private record Confirm(String icon, String title, String text, String ok, Runnable run) {}

	private List<MenuItem> menuItems;
	private int menuX, menuY;
	private long menuAt;
	private Confirm confirm;
	private long confirmAt;
	private boolean overlayDrawing;

	/** Fare konumunda (ya da bir düğmenin altında) menü açar; ekrana sığmazsa içeri kayar. */
	protected void openMenu(int x, int y, List<MenuItem> items) {
		menuItems = List.copyOf(items);
		menuX = x;
		menuY = y;
		menuAt = System.nanoTime();
		focus(null);
	}

	/** Tehlikeli işlemler (engelle, çıkar) için ortadaki onay penceresi. */
	protected void askConfirm(String icon, String title, String text, String ok, Runnable run) {
		menuItems = null;
		confirm = new Confirm(icon, title, text, ok, run);
		confirmAt = System.nanoTime();
		focus(null);
	}

	protected boolean overlayOpen() { return menuItems != null || confirm != null; }

	protected void closeOverlays() {
		menuItems = null;
		confirm = null;
	}

	private static float easeOut(long since, float ms) {
		float t = Math.min(1f, (System.nanoTime() - since) / 1e6f / ms);
		return 1f - (1f - t) * (1f - t) * (1f - t);
	}

	private void drawMenu(GuiGraphicsExtractor g) {
		List<MenuItem> items = menuItems;
		int rowH = 17, sepH = 7, w = 0, h = 6;
		for (MenuItem it : items) {
			if (it.label() == null) h += sepH;
			else {
				w = Math.max(w, font.width(it.label()));
				h += rowH;
			}
		}
		w += 34;
		int x = Math.max(4, Math.min(menuX, width - w - 4)), y = menuY + h > height - 4 ? Math.max(4, menuY - h) : menuY;
		g.nextStratum();
		// Menünün dışına tıklama (sol ya da sağ) menüyü kapatır; öğeler bundan sonra kaydedildiği için önce onlar denenir.
		hit(0, 0, width, height, this::closeOverlays, this::closeOverlays);
		float p = easeOut(menuAt, 140);
		int shown = Math.max(1, Math.round(h * p));
		g.enableScissor(x - 1, y - 1, x + w + 1, y + shown + 1);
		Theme.notched(g, x, y, x + w, y + h, 4, 0xF80B0C12);
		Theme.notchedOutline(g, x, y, x + w, y + h, 4, Theme.LINE_STRONG);
		g.fill(x + 4, y, x + 22, y + 1, Theme.accent());
		hit(x, y, x + w, y + h, () -> {}, () -> {});
		int ry = y + 3;
		for (MenuItem it : items) {
			if (it.label() == null) {
				g.fill(x + 6, ry + 3, x + w - 6, ry + 4, Theme.LINE);
				ry += sepH;
				continue;
			}
			MenuItem item = it;
			boolean hov = hit(x + 3, ry, x + w - 3, ry + rowH, () -> {
				closeOverlays();
				item.run().run();
			});
			int danger = 0xFFFF7A8A;
			if (hov) Theme.notched(g, x + 3, ry, x + w - 3, ry + rowH, 2, it.danger() ? 0x38E5484D : 0x1EFFFFFF);
			int color = it.danger() ? danger : hov ? Theme.TEXT : 0xFFD7DBE4;
			if (it.icon() != null) PixelIcons.drawCentered(g, it.icon(), x + 12, ry + rowH / 2, 1, it.danger() ? danger : hov ? Theme.TEXT : Theme.MUTED);
			g.text(font, it.label(), x + 23, ry + 5, color, false);
			ry += rowH;
		}
		g.disableScissor();
	}

	private void drawConfirm(GuiGraphicsExtractor g) {
		Confirm c = confirm;
		float p = easeOut(confirmAt, 200);
		g.nextStratum();
		g.fill(0, 0, width, height, Theme.withAlpha(0xFF04050A, (int) (0xB4 * p)));
		// Pencerenin dışına tıklamak vazgeçer.
		hit(0, 0, width, height, this::closeOverlays, this::closeOverlays);
		int w = Math.min(270, width - 40);
		List<FormattedCharSequence> lines = font.split(FormattedText.of(c.text()), w - 28);
		List<FormattedCharSequence> titleLines = font.split(FormattedText.of(c.title()), w - 28);
		int h = 14 + 26 + 8 + titleLines.size() * 11 + 6 + lines.size() * 10 + 14 + 20 + 14;
		int x = (width - w) / 2, y = (height - h) / 2 + Math.round((1 - p) * 8);
		Theme.notched(g, x, y, x + w, y + h, 7, 0xFA101219);
		Theme.notchedOutline(g, x, y, x + w, y + h, 7, Theme.LINE_STRONG);
		for (int i = 0; i < 7; i++) g.fill(x + 7 - i, y + i, x + 8 - i, y + i + 1, Theme.accent());
		g.fill(x + 7, y, x + 40, y + 1, Theme.accent());
		hit(x, y, x + w, y + h, () -> {}, () -> {});
		int ix = x + 14, iy = y + 14;
		Theme.notched(g, ix, iy, ix + 26, iy + 26, 3, Theme.withAlpha(Theme.accent(), 0x36));
		Theme.notchedOutline(g, ix, iy, ix + 26, iy + 26, 3, Theme.withAlpha(Theme.accent(), 0x80));
		PixelIcons.drawCentered(g, c.icon(), ix + 13, iy + 13, 1, Theme.accent());
		int ty = iy + 26 + 8;
		for (FormattedCharSequence l : titleLines) {
			g.text(font, l, x + 14, ty, Theme.TEXT, false);
			ty += 11;
		}
		ty += 6;
		for (FormattedCharSequence l : lines) {
			g.text(font, l, x + 14, ty, Theme.MUTED, false);
			ty += 10;
		}
		String cancel = L.t("friends.cancelBtn");
		int by = y + h - 14 - 20, okW = Math.max(70, font.width(c.ok()) + 24), cancelW = Math.max(64, font.width(cancel) + 20);
		button(g, x + w - 14 - okW, by, x + w - 14, by + 20, L.upper(c.ok()), Style.DANGER, () -> {
			closeOverlays();
			c.run().run();
		});
		button(g, x + w - 14 - okW - 6 - cancelW, by, x + w - 14 - okW - 6, by + 20, L.upper(cancel), Style.GHOST, this::closeOverlays);
	}

	// --- Kayan vurgulu seçim (Herkes / Arkadaşlar / Kimse) ---

	private final java.util.Map<String, Float> segmentPos = new java.util.HashMap<>();

	/** Eşit parçalı seçim; seçili parçanın arkasındaki vurgu yumuşakça kayar. */
	protected void segmented(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, String id, String[] labels, int selected, java.util.function.IntConsumer pick) {
		int n = labels.length;
		float cur = segmentPos.getOrDefault(id, (float) selected);
		cur += (selected - cur) * Math.min(1f, dt * 14f);
		if (Math.abs(selected - cur) < 0.002f) cur = selected;
		segmentPos.put(id, cur);
		Theme.notched(g, x1, y1, x2, y2, 3, 0x40000000);
		Theme.notchedOutline(g, x1, y1, x2, y2, 3, Theme.LINE);
		float segW = (x2 - x1 - 4) / (float) n;
		int tx = Math.round(x1 + 2 + cur * segW);
		Theme.notched(g, tx, y1 + 2, Math.round(tx + segW), y2 - 2, 2, Theme.accent());
		g.fill(tx + 2, y1 + 2, Math.round(tx + segW) - 2, y1 + 3, 0x40FFFFFF);
		for (int i = 0; i < n; i++) {
			int sx1 = Math.round(x1 + 2 + i * segW), sx2 = Math.round(x1 + 2 + (i + 1) * segW);
			int idx = i;
			boolean hov = hit(sx1, y1, sx2, y2, () -> {
				if (idx != selected) pick.accept(idx);
			});
			boolean on = i == selected;
			String label = Theme.ellipsize(labels[i], sx2 - sx1 - 6);
			g.text(font, label, (sx1 + sx2) / 2 - font.width(label) / 2, (y1 + y2) / 2 - 4, on ? Theme.TEXT : hov ? 0xFFE9ECF2 : Theme.MUTED, false);
		}
	}

	// --- Ortak kontroller ---

	public enum Style { PRIMARY, SECONDARY, GHOST, DANGER }

	protected boolean button(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, String label, Style style, Runnable action) {
		boolean hov = action != null && hit(x1, y1, x2, y2, action);
		int accent = style == Style.DANGER ? 0xFFE5484D : Theme.accent();
		int bg = switch (style) {
			case PRIMARY, DANGER -> hov ? Theme.mix(accent, 0xFFFFFFFF, 0.15f) : accent;
			case SECONDARY -> hov ? Theme.OFF_HOVER : Theme.OFF;
			case GHOST -> hov ? 0x1EFFFFFF : 0x00000000;
		};
		Theme.notched(g, x1, y1, x2, y2, 3, bg);
		if (style == Style.GHOST) Theme.notchedOutline(g, x1, y1, x2, y2, 3, hov ? Theme.LINE_STRONG : Theme.LINE);
		int color = style == Style.PRIMARY || style == Style.DANGER || hov ? Theme.TEXT : Theme.MUTED;
		fittedLabel(g, label, x1, y1, x2, y2, color);
		return hov;
	}

	/** Etiketi düğmeye sığdırır: önce harf aralığını kaldırır, yine sığmazsa küçültür. */
	protected void fittedLabel(GuiGraphicsExtractor g, String label, int x1, int y1, int x2, int y2, int color) {
		int room = x2 - x1 - 10, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 - 4;
		if (Theme.spacedWidth(label, 1) <= room) {
			Theme.spacedCentered(g, label, cx, cy, color, 1);
			return;
		}
		int w = font.width(label);
		float scale = Math.min(1f, room / (float) w);
		Theme.scaledText(g, label, cx - w * scale / 2f, cy + (1 - scale) * 4, scale, color, false);
	}

	protected boolean iconButton(GuiGraphicsExtractor g, int x, int y, int size, String icon, Runnable action) {
		boolean hov = hit(x, y, x + size, y + size, action);
		Theme.notched(g, x, y, x + size, y + size, 3, hov ? 0x2EFFFFFF : 0x12FFFFFF);
		PixelIcons.drawCentered(g, icon, x + size / 2, y + size / 2, 1, hov ? Theme.TEXT : Theme.MUTED);
		return hov;
	}

	/** Aç/kapat anahtarı (24x12). */
	protected void toggleSwitch(GuiGraphicsExtractor g, int x, int y, boolean on, Runnable action) {
		boolean hov = hit(x - 2, y - 2, x + 26, y + 14, action);
		int track = on ? Theme.accent() : hov ? Theme.OFF_HOVER : Theme.OFF;
		g.fill(x, y, x + 24, y + 12, track);
		int kx = on ? x + 13 : x + 1;
		g.fill(kx, y + 1, kx + 10, y + 11, on ? 0xFFFFFFFF : 0xFF8A8F9C);
	}

	/** Paletten renk seçici; seçili olan beyaz çerçeveli. */
	protected void swatches(GuiGraphicsExtractor g, int rightX, int y, int[] colors, int selected, java.util.function.IntConsumer pick) {
		int s = 11, gap = 3, x = rightX - colors.length * (s + gap) + gap;
		for (int i = 0; i < colors.length; i++) {
			int c = colors[i], sx = x + i * (s + gap);
			boolean hov = hit(sx - 1, y - 1, sx + s + 1, y + s + 1, () -> pick.accept(c));
			if (c == selected || hov) g.outline(sx - 2, y - 2, s + 4, s + 4, c == selected ? 0xFFFFFFFF : Theme.LINE_STRONG);
			g.fill(sx, y, sx + s, y + s, c);
		}
	}

	/** Çerçeve paneli konumu (frame ile hesaplanır). */
	protected int fx, fy, fw, fh;
	protected static final int FRAME_HEADER = 28;

	/** Ortalanmış ana panel ve başlık satırı (logo, başlık, kapat düğmesi). */
	protected void frame(GuiGraphicsExtractor g, int maxW, int maxH, String title) {
		placeFrame(maxW, maxH);
		panel(g, fx, fy, fx + fw, fy + fh);
		g.fill(fx + 1, fy + FRAME_HEADER, fx + fw - 1, fy + FRAME_HEADER + 1, Theme.LINE);
		Theme.logo(g, fx + 14, fy + 7, 14);
		Theme.spaced(g, title, fx + 34, fy + 10, Theme.TEXT, 2);
		if (iconButton(g, fx + fw - 26, fy + 6, 16, parent != null ? "back" : "close", this::onClose)) tipNow(L.t(parent != null ? "common.back" : "common.close"));
	}

	/** Paneli alt menünün üstünde ortalar; kendi çerçevesini çizen ekranlar da kullanır. */
	protected void placeFrame(int maxW, int maxH) {
		fw = Math.min(width - 24, maxW);
		int avail = height - 46 - 8;
		fh = Math.min(avail - 8, maxH);
		fx = (width - fw) / 2;
		fy = 8 + Math.max(0, (avail - fh) / 2);
	}

	/** Metin kutusu odak rengi. */
	protected int fieldAccent() { return Theme.accent(); }

	/** Ana panel: kesik köşeli koyu zemin, ince çerçeve ve sol üst kesikte vurgu çizgisi. */
	protected void panel(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		Theme.notched(g, x1, y1, x2, y2, 8, Theme.PANEL);
		Theme.notchedOutline(g, x1, y1, x2, y2, 8, Theme.LINE_STRONG);
		for (int i = 0; i < 8; i++) g.fill(x1 + 8 - i, y1 + i, x1 + 9 - i, y1 + i + 1, Theme.accent());
		g.fill(x1 + 8, y1, x1 + 40, y1 + 1, Theme.accent());
	}
}
