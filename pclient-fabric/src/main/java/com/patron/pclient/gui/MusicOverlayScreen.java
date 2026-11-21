package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.bridge.Media;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.modules.MusicModule;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;

/** Oyun sürerken imleci açan hafif müzik kontrol katmanı. Aynı tuş ya da ESC ile oyuna dönülür. */
public final class MusicOverlayScreen extends PcScreen {
	private final MusicPanel panel = new MusicPanel(this);

	public MusicOverlayScreen() { super("title.music", null); }

	@Override protected String dock() { return null; }

	@Override public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float delta) {}

	@Override public void onClose() {
		minecraft.gui.setScreen(null);
		minecraft.mouseHandler.grabMouse();
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		Media.poll(1500);
		int w = Math.min(width - 16, 280), h = 80, x = (width - w) / 2, y = height - h - 58;
		Theme.notched(g, x, y, x + w, y + h, 5, 0xF00A0B10);
		Theme.notchedOutline(g, x, y, x + w, y + h, 5, Theme.withAlpha(MusicPanel.GREEN, 0x90));
		Media.Track track = Media.track();
		if (track != null) panel.draw(g, track, x + 9, y + 10, x + w - 10, 60, false);
		else g.centeredText(font, Theme.ellipsize(L.t(!Media.reachable() ? "music.launcher" : "music.nothing"), w - 20), x + w / 2, y + 36, Theme.MUTED);
		String hint = L.t("music.overlayHint", ModuleManager.get(MusicModule.class).controlsKey.display());
		g.centeredText(font, hint, width / 2, y - 12, Theme.TEXT);
	}

	@Override public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		return panel.mouseDragged(e) || super.mouseDragged(e, dx, dy);
	}

	@Override public boolean mouseReleased(MouseButtonEvent e) {
		panel.mouseReleased();
		return super.mouseReleased(e);
	}

	@Override public boolean keyPressed(KeyEvent e) {
		if (e.key() == ModuleManager.get(MusicModule.class).controlsKey.get()) {
			onClose();
			return true;
		}
		return super.keyPressed(e);
	}
}
