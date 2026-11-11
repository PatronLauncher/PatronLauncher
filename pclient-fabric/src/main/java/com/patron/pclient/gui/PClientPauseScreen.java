package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.bridge.Spotify;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.network.chat.CommonComponents;

/** ESC menüsü: oyuna dönüş, Minecraft ayarları, PClient kısayolları ve çıkış. */
public final class PClientPauseScreen extends PcScreen {
	private final MusicPanel music = new MusicPanel(this);

	public PClientPauseScreen() { super("title.pause", null); }

	@Override public boolean isPauseScreen() { return true; }

	@Override protected String dock() { return "home"; }

	@Override public void onClose() {
		minecraft.gui.setScreen(null);
		minecraft.mouseHandler.grabMouse();
	}

	/** Minecraft'ın kendi çevirisiyle büyük harf etiket. */
	private static String mc(String key) { return L.upper(I18n.get(key)); }

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		int cx = width / 2, w = 210, half = (w - 6) / 2, bh = 20;
		int y = Math.max(10, height / 2 - 100);
		Theme.logo(g, cx - 13, y, 26);
		y += 32;
		String p = "P", client = "CLIENT";
		int tw = font.width(p) + Theme.spacedWidth(client, 2) + 2;
		Theme.scaledText(g, p, cx - tw * 0.75f, y, 1.5f, Theme.accent(), true);
		g.pose().pushMatrix();
		g.pose().translate(cx - tw * 0.75f + (font.width(p) + 1) * 1.5f, y);
		g.pose().scale(1.5f, 1.5f);
		Theme.spaced(g, client, 0, 0, Theme.TEXT, 2);
		g.pose().popMatrix();
		y += 16;
		String where = minecraft.hasSingleplayerServer() ? L.t("pause.singleplayer")
			: minecraft.getCurrentServer() != null ? minecraft.getCurrentServer().ip : L.t("pause.multiplayer");
		g.centeredText(font, Theme.ellipsize(where, w), cx, y, Theme.MUTED);
		y += 16;

		int x1 = cx - w / 2, x2 = cx + w / 2;
		button(g, x1, y, x2, y + 24, mc("menu.returnToGame"), Style.PRIMARY, this::onClose);
		y += 30;
		button(g, x1, y, x1 + half, y + bh, L.up("pause.minecraftOptions"), Style.SECONDARY,
			() -> open(new OptionsScreen(this, minecraft.options)));
		button(g, x2 - half, y, x2, y + bh, L.up("home.modules"), Style.SECONDARY,
			() -> open(new ModulesScreen(ModulesScreen.Tab.MODULES)));
		y += bh + 6;
		button(g, x1, y, x1 + half, y + bh, L.up("dock.hud"), Style.GHOST, () -> open(new HudEditorScreen(this)));
		button(g, x2 - half, y, x2, y + bh, L.up("dock.settings"), Style.GHOST, () -> open(new ModulesScreen(ModulesScreen.Tab.SETTINGS)));
		y += bh + 12;
		String quit = L.upper(CommonComponents.disconnectButtonLabel(minecraft.isLocalServer()).getString());
		button(g, x1, y, x2, y + bh, quit, Style.DANGER, () -> minecraft.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
		drawMusic(g, cx - w / 2);
		accountWidget(g);
	}

	/** Çalan şarkı varsa sağ üstte oynatıcı; menüyle çakışmayacak genişliğe sığdırılır. */
	private void drawMusic(GuiGraphicsExtractor g, int menuLeft) {
		Spotify.poll(2000);
		Spotify.Track track = Spotify.track();
		int w = Math.min(280, menuLeft - 16);
		if (track == null || w < 150) return;
		boolean narrow = w - 19 - 60 < 170;
		int cover = narrow ? 40 : 60, h = narrow ? 92 : 80, x = width - w - 8, y = 8;
		Theme.notched(g, x, y, x + w, y + h, 5, 0xE00A0B10);
		Theme.notchedOutline(g, x, y, x + w, y + h, 5, Theme.withAlpha(MusicPanel.GREEN, 0x90));
		music.draw(g, track, x + 9, y + 10, x + w - 10, cover, false);
	}

	@Override public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		return music.mouseDragged(e) || super.mouseDragged(e, dx, dy);
	}

	@Override public boolean mouseReleased(MouseButtonEvent e) {
		music.mouseReleased();
		return super.mouseReleased(e);
	}
}
