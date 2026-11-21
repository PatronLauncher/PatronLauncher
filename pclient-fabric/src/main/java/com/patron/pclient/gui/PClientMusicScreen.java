package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.bridge.Media;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.modules.MusicModule;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.FormattedText;

/** Oyun içi müzik (bilgisayarda çalan oynatıcı): çalan şarkı, kapak, oynatma kontrolleri, ses ve HUD ayarları. */
public final class PClientMusicScreen extends PcScreen {
	private final MusicPanel panel = new MusicPanel(this);

	public PClientMusicScreen(Screen parent) { super("title.music", parent); }

	@Override protected String dock() { return "music"; }

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		Media.poll(1500);
		frame(g, 430, 230, L.up("music.title"));
		int x1 = fx + 16, x2 = fx + fw - 16, top = fy + FRAME_HEADER + 14;
		if (!Media.reachable()) notice(g, "music.launcher", null, null);
		else if (!Media.known()) notice(g, "music.loading", null, null);
		else if (Media.track() == null) notice(g, "music.nothing", null, null);
		else {
			panel.draw(g, Media.track(), x1, top, x2, 92, true);
			if (Media.error() != null) g.text(font, Theme.ellipsize(Media.error(), x2 - x1), x1, top + 100, 0xFFE5A04D, false);
		}
		footer(g, x1, x2);
	}

	private void notice(GuiGraphicsExtractor g, String key, String button, Runnable action) {
		int cx = fx + fw / 2, y = fy + FRAME_HEADER + 34;
		PixelIcons.drawCentered(g, "music", cx, y + 10, 3, Theme.FAINT);
		var lines = font.split(FormattedText.of(L.t(key)), fw - 60);
		y += 34;
		for (var line : lines) {
			g.centeredText(font, line, cx, y, Theme.MUTED);
			y += 11;
		}
		if (button != null) {
			int w = Theme.spacedWidth(button, 1) + 28;
			button(g, cx - w / 2, y + 8, cx + w / 2, y + 28, button, Style.PRIMARY, action);
		}
	}

	private void footer(GuiGraphicsExtractor g, int x1, int x2) {
		MusicModule module = ModuleManager.get(MusicModule.class);
		int y = fy + fh - 24;
		String name = module.isEnabled() ? L.t("music.keyHint", module.controlsKey.display())
			: L.t("music.hud");
		g.text(font, Theme.ellipsize(name, x2 - x1 - 170), x1, y + 4, Theme.FAINT, false);
		String settings = L.up("card.settings");
		int sw = Theme.spacedWidth(settings, 1) + 18;
		button(g, x2 - sw, y, x2, y + 16, settings, Style.GHOST, () -> open(new ModuleSettingsScreen(module, this)));
		String label = L.up(module.isEnabled() ? "music.hudOn" : "music.hudOff");
		int lw = Theme.spacedWidth(label, 1) + 18;
		button(g, x2 - sw - 6 - lw, y, x2 - sw - 6, y + 16, label, module.isEnabled() ? Style.PRIMARY : Style.SECONDARY, () -> {
			module.setEnabled(!module.isEnabled());
			com.patron.pclient.config.PClientConfig.touch(module.id);
		});
	}

	@Override public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		return panel.mouseDragged(e) || super.mouseDragged(e, dx, dy);
	}

	@Override public boolean mouseReleased(MouseButtonEvent e) {
		panel.mouseReleased();
		return super.mouseReleased(e);
	}
}
