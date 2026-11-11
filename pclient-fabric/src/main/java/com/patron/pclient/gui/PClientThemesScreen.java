package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.config.PClientConfig;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;

/** Ana menü arka planı seçimi. Seçim anında uygulanır ve panelin arkasında görünür. */
public final class PClientThemesScreen extends PcScreen {
	public PClientThemesScreen(Screen parent) { super("title.themes", parent); }

	@Override protected String dock() { return "themes"; }

	/** Oyun içindeyken de temalar görünsün diye arka plan bu ekranda hep temadır. */
	@Override public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float delta) {
		if (!MenuThemes.draw(g, width, height)) extractPanorama(g, delta);
		g.fillGradient(0, 0, width, height, 0x7004050A, 0xB804050A);
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		frame(g, 500, 300, L.up("themes.title"));
		PClientConfig c = PClientConfig.get();
		int x1 = fx + 14, x2 = fx + fw - 14, gap = 10, top = fy + FRAME_HEADER + 12;
		int cols = 2, cardW = (x2 - x1 - gap) / cols, available = fy + fh - 30 - top, thumbH = Math.max(36, Math.min(cardW * 9 / 16, (available - gap) / 2 - 18));
		cardW = Math.min(cardW, thumbH * 16 / 9);
		int gridW = cardW * cols + gap, start = (x1 + x2 - gridW) / 2;
		for (int i = 0; i < MenuThemes.ALL.size(); i++) {
			String id = MenuThemes.ALL.get(i);
			int x = start + i % cols * (cardW + gap), y = top + i / cols * (thumbH + 18 + gap);
			boolean active = id.equals(c.menuTheme), hov = hit(x, y, x + cardW, y + thumbH + 18, () -> c.menuTheme = id);
			if (!MenuThemes.thumbnail(g, id, x + 1, y + 1, cardW - 2, thumbH)) g.fill(x + 1, y + 1, x + cardW - 1, y + thumbH + 1, 0xFF14161E);
			g.fill(x + 1, y + thumbH + 1, x + cardW - 1, y + thumbH + 17, hov || active ? Theme.CARD_HOVER : Theme.CARD);
			g.text(font, Theme.ellipsize(L.t("themes." + id), cardW - 30), x + 7, y + thumbH + 5, active ? Theme.TEXT : Theme.MUTED, false);
			int dotX = x + cardW - 13, dotY = y + thumbH + 6;
			g.fill(dotX, dotY, dotX + 6, dotY + 6, active ? Theme.accent() : Theme.OFF_HOVER);
			g.outline(x, y, cardW, thumbH + 18, active ? Theme.accent() : hov ? Theme.LINE_STRONG : Theme.LINE);
		}
		String active = L.t("themes.active", L.t("themes." + c.menuTheme));
		g.text(font, Theme.ellipsize(active, fw / 3), x1, fy + fh - 19, Theme.MUTED, false);
		String reset = L.up("themes.reset");
		int rw = Theme.spacedWidth(reset, 1) + 18;
		String effects = L.t("themes.effects");
		int sx = x2 - rw - 34;
		toggleSwitch(g, sx, fy + fh - 22, c.animatedThemes, () -> c.animatedThemes = !c.animatedThemes);
		g.text(font, effects, sx - font.width(effects) - 6, fy + fh - 19, Theme.MUTED, false);
		button(g, x2 - rw, fy + fh - 24, x2, fy + fh - 8, reset, Style.GHOST, () -> c.menuTheme = PClientConfig.DEFAULT_MENU_THEME);
	}

	@Override public void removed() {
		super.removed();
		MenuThemes.releaseUnused();
	}
}
