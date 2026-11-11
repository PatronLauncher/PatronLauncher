package com.patron.pclient.gui;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.L;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.ChoiceSetting;
import com.patron.pclient.module.setting.ColorSetting;
import com.patron.pclient.module.setting.KeySetting;
import com.patron.pclient.module.setting.Setting;
import com.patron.pclient.module.setting.SliderSetting;
import com.patron.pclient.module.setting.TextSetting;
import com.patron.pclient.modules.VisualModules;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;

/** Tek bir modülün ayarları: bölüm başlıkları, arama, anahtar, kaydırıcı, renk, seçenek, tuş ve metin. */
public final class ModuleSettingsScreen extends PcScreen {
	private static final int ROW = 24, SECTION = 18;
	private final Module module;
	private final PcTextField search = new PcTextField(32, L.t("search.settings")).clearOnEscape();
	private final Map<TextSetting, PcTextField> textFields = new IdentityHashMap<>();
	private SliderSetting dragging;
	private int dragX1, dragX2;
	private KeySetting listening;
	private double scroll, maxScroll;
	private int px, py, pw, ph, bodyY1, bodyY2;

	private final String initialState;

	public ModuleSettingsScreen(Module module, Screen parent) {
		super("title.settings", parent);
		this.module = module;
		this.initialState = state();
		search.onChange(v -> scroll = 0);
	}

	private String state() {
		StringBuilder out = new StringBuilder().append(module.isEnabled());
		for (Setting<?> s : module.settings()) out.append('|').append(s.save());
		return out.toString();
	}

	/** Gerçekten bir ayar değiştiyse modül "son değiştirilen" sırasında öne geçer. */
	@Override public void removed() {
		if (!state().equals(initialState)) com.patron.pclient.config.PClientConfig.touch(module.id);
		super.removed();
	}

	@Override protected String dock() { return "modules"; }

	private List<Setting<?>> visibleSettings() {
		String q = search.value().toLowerCase(Locale.ROOT).trim();
		List<Setting<?>> out = new ArrayList<>();
		for (Setting<?> s : module.settings()) {
			String hay = L.t(s.labelKey) + " " + (s.group == null ? "" : L.t(s.group));
			if (q.isEmpty() || hay.toLowerCase(Locale.ROOT).contains(q)) out.add(s);
		}
		return out;
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		pw = Math.min(width - 24, 440);
		int avail = height - 46 - 8;
		ph = Math.min(avail - 8, 320);
		px = (width - pw) / 2;
		py = 8 + Math.max(0, (avail - ph) / 2);
		panel(g, px, py, px + pw, py + ph);

		// Başlık
		if (iconButton(g, px + 10, py + 10, 18, "back", this::onClose)) tipNow(L.t("common.back"));
		Theme.notched(g, px + 34, py + 8, px + 58, py + 32, 4, 0x14FFFFFF);
		PixelIcons.drawCentered(g, module.icon, px + 46, py + 20, 2, module.isEnabled() ? Theme.accent() : Theme.MUTED);
		g.text(font, L.t(module.nameKey()), px + 66, py + 9, Theme.TEXT, false);
		boolean on = module.isEnabled();
		int onW = 72;
		button(g, px + pw - 12 - onW, py + 11, px + pw - 12, py + 27, L.up(on ? "card.on" : "card.off"), on ? Style.PRIMARY : Style.SECONDARY,
			() -> module.setEnabled(!module.isEnabled()));
		int previewW = module instanceof VisualModules.Crosshair ? 40 : 0;
		if (module instanceof VisualModules.Crosshair ch) {
			int bx = px + pw - 12 - onW - 8 - previewW, by = py + 6;
			Theme.notched(g, bx, by, bx + previewW, by + 28, 3, 0xFF2B3A4A);
			ch.draw(g, bx + previewW / 2, by + 14);
		}
		g.text(font, Theme.ellipsize(L.t(module.descKey()), pw - 66 - onW - 22 - previewW), px + 66, py + 21, Theme.MUTED, false);
		g.fill(px + 1, py + 40, px + pw - 1, py + 41, Theme.LINE);

		int x1 = px + 16, x2 = px + pw - 16;
		// Arama (ayar çoksa) ve nişangah önizlemesi
		int y0 = py + 46;
		if (module.settings().size() > 5) {
			textField(g, x1, y0, Math.min(x2, x1 + 180), y0 + 16, search, 11, "search");
			y0 += 22;
		}
		bodyY1 = y0;
		bodyY2 = py + ph - 34;
		List<Setting<?>> list = visibleSettings();
		int contentH = (module instanceof HudModule && search.value().isBlank() ? ROW : 0);
		String group = null;
		for (Setting<?> s : list) {
			if (!Objects.equals(s.group, group)) {
				group = s.group;
				if (group != null) contentH += SECTION;
			}
			contentH += ROW;
		}
		maxScroll = Math.max(0, contentH - (bodyY2 - bodyY1));
		scroll = Math.max(0, Math.min(maxScroll, scroll));
		g.enableScissor(px + 2, bodyY1, px + pw - 2, bodyY2);
		int y = bodyY1 - (int) scroll;
		int labelRoom = x2 - x1;
		if (module instanceof HudModule && search.value().isBlank()) {
			label(g, x1, y, L.t("setting.position"));
			if (visible(y)) button(g, x2 - 90, y + 4, x2, y + 19, L.up("setting.editPosition"), Style.GHOST, () -> open(new HudEditorScreen(this)));
			y += ROW;
		}
		group = null;
		for (Setting<?> s : list) {
			if (!Objects.equals(s.group, group)) {
				group = s.group;
				if (group != null) {
					Theme.spaced(g, L.up(group), x1, y + 7, Theme.accent(), 1);
					y += SECTION;
				}
			}
			label(g, x1 + (s.group != null ? 6 : 0), y, Theme.ellipsize(L.t(s.labelKey), Math.min(labelRoom, (x2 - x1) / 2)));
			if (visible(y)) control(g, s, x2, y, x1 + (x2 - x1) / 2);
			g.fill(x1, y + ROW - 1, x2, y + ROW, 0x0FFFFFFF);
			y += ROW;
		}
		if (module.settings().isEmpty()) g.centeredText(font, L.t("setting.none"), px + pw / 2, bodyY1 + 20, Theme.MUTED);
		else if (list.isEmpty()) g.centeredText(font, L.t("setting.noMatch"), px + pw / 2, bodyY1 + 20, Theme.MUTED);
		g.disableScissor();
		if (maxScroll > 0) {
			int trackH = bodyY2 - bodyY1, barH = Math.max(18, trackH * trackH / contentH);
			int barY = bodyY1 + (int) ((trackH - barH) * (scroll / maxScroll));
			g.fill(px + pw - 7, bodyY1, px + pw - 5, bodyY2, 0x14FFFFFF);
			g.fill(px + pw - 7, barY, px + pw - 5, barY + barH, Theme.withAlpha(Theme.accent(), 0xB0));
		}

		// Alt çubuk
		g.fill(px + 1, py + ph - 30, px + pw - 1, py + ph - 29, Theme.LINE);
		String reset = L.up("setting.reset");
		button(g, px + 12, py + ph - 24, px + 24 + Theme.spacedWidth(reset, 1), py + ph - 8, reset, Style.GHOST, () -> {
			module.resetToDefaults();
			textFields.clear();
		});
		String done = L.up("setting.done");
		button(g, px + pw - 24 - Theme.spacedWidth(done, 1), py + ph - 24, px + pw - 12, py + ph - 8, done, Style.PRIMARY, this::onClose);
	}

	private boolean visible(int y) { return y + 4 >= bodyY1 && y + 19 <= bodyY2; }

	private void label(GuiGraphicsExtractor g, int x, int y, String text) {
		g.text(font, text, x, y + 8, Theme.TEXT, false);
	}

	private void control(GuiGraphicsExtractor g, Setting<?> s, int right, int y, int mid) {
		switch (s) {
			case BoolSetting b -> toggleSwitch(g, right - 24, y + 6, b.on(), b::toggle);
			case SliderSetting sl -> {
				int tw = 110, tx1 = right - tw, ty = y + 11;
				String v = sl.display();
				g.text(font, v, tx1 - 8 - font.width(v), y + 8, Theme.MUTED, false);
				boolean hov = hit(tx1 - 3, y + 4, right + 3, y + 20, () -> {
					dragging = sl;
					dragX1 = tx1;
					dragX2 = right;
					sl.setFraction((mouseX - tx1) / (double) tw);
				});
				g.fill(tx1, ty, right, ty + 2, Theme.OFF_HOVER);
				int fx = tx1 + (int) Math.round(sl.fraction() * tw);
				g.fill(tx1, ty, fx, ty + 2, Theme.accent());
				Theme.notched(g, fx - 3, ty - 4, fx + 4, ty + 6, 2, hov || dragging == sl ? 0xFFFFFFFF : 0xFFD9DBE1);
			}
			case ColorSetting c -> swatches(g, right, y + 7, ColorSetting.PALETTE, c.get(), c::set);
			case ChoiceSetting ch -> {
				int w = 104, x = right - w;
				String v = L.t("choice." + ch.id + "." + ch.get());
				boolean hl = hit(x, y + 4, x + w / 2, y + 20, () -> ch.cycle(-1)), hr = hit(x + w / 2, y + 4, right, y + 20, () -> ch.cycle(1));
				Theme.notched(g, x, y + 4, right, y + 20, 3, hl || hr ? Theme.OFF_HOVER : Theme.OFF);
				g.text(font, "‹", x + 5, y + 8, hl ? Theme.accent() : Theme.MUTED, false);
				g.text(font, "›", right - 9, y + 8, hr ? Theme.accent() : Theme.MUTED, false);
				g.centeredText(font, Theme.ellipsize(v, w - 22), x + w / 2, y + 8, Theme.TEXT);
			}
			case KeySetting k -> {
				String v = listening == k ? L.t("settings.pressKey")
					: k.get() == InputConstants.UNKNOWN.getValue() ? L.t("settings.unbound") : k.display();
				int w = Math.max(80, font.width(v) + 16);
				button(g, right - w, y + 4, right, y + 20, v, listening == k ? Style.PRIMARY : Style.SECONDARY,
					() -> listening = listening == k ? null : k);
			}
			case TextSetting t -> {
				PcTextField f = textFields.computeIfAbsent(t, k -> new PcTextField(k.maxLength, L.t("setting.messagePlaceholder"))
					.set(k.get()).onChange(k::set));
				textField(g, mid, y + 4, right, y + 20, f);
			}
		}
	}

	@Override public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		if (dragging != null) {
			dragging.setFraction((e.x() - dragX1) / (double) (dragX2 - dragX1));
			return true;
		}
		return super.mouseDragged(e, dx, dy);
	}

	@Override public boolean mouseReleased(MouseButtonEvent e) {
		dragging = null;
		return super.mouseReleased(e);
	}

	@Override public boolean mouseScrolled(double x, double y, double h, double v) {
		scroll -= v * 20;
		return true;
	}

	@Override public boolean keyPressed(KeyEvent e) {
		if (listening != null) {
			// ESC kısayolu kaldırır.
			listening.set(e.key() == InputConstants.KEY_ESCAPE ? InputConstants.UNKNOWN.getValue() : e.key());
			listening = null;
			return true;
		}
		return super.keyPressed(e);
	}
}
