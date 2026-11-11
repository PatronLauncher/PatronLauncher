package com.patron.pclient.modules;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.L;
import com.patron.pclient.bridge.Spotify;
import com.patron.pclient.gui.PcTextures;
import com.patron.pclient.gui.Theme;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.KeySetting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Çalan Spotify şarkısını ekranda gösterir. Kontroller alt çubuktaki müzik ekranındadır. */
public final class MusicModule extends HudModule {
	private static final int WIDTH = 156, HEIGHT = 38;
	public final BoolSetting showCover = add(new BoolSetting("cover", "setting.musicCover", true));
	public final BoolSetting showProgress = add(new BoolSetting("progress", "setting.musicProgress", true));
	public final KeySetting controlsKey = add(new KeySetting("controlsKey", "setting.musicControls", InputConstants.KEY_J));
	private static String coverKey;

	public MusicModule() { super("music", Category.HUD, "music", false, 0.004, 0.62); }

	/** Yalnızca son şarkının kapağı bellekte tutulur. */
	public static PcTextures.Image cover(String url) {
		String key = "cover:" + url;
		if (!key.equals(coverKey)) {
			if (coverKey != null) PcTextures.release(coverKey);
			coverKey = key;
		}
		return PcTextures.get(key, () -> PcTextures.download(url));
	}

	@Override public void tick() { Spotify.poll(4000); }

	@Override public boolean visible(boolean preview) { return preview || Spotify.track() != null; }

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		var font = Minecraft.getInstance().font;
		Spotify.Track t = Spotify.track();
		String title = t != null ? t.title() : L.t("music.previewTitle"), artists = t != null ? t.artists() : L.t("music.previewArtist");
		w = WIDTH;
		h = HEIGHT;
		if (background.on()) Theme.hudBox(g, 0, 0, w, h);
		int textX = 6;
		if (showCover.on()) {
			PcTextures.Image cover = t == null || t.image().isEmpty() ? null : cover(t.image());
			if (cover != null) cover.blit(g, 4, 4, 30, 30);
			else g.fill(4, 4, 34, 34, 0x30FFFFFF);
			textX = 39;
		}
		int room = w - textX - 5;
		g.text(font, Theme.ellipsize(title, room), textX, 6, color.get(), true);
		g.text(font, Theme.ellipsize(artists, room), textX, 17, 0xFFB5BAC6, true);
		if (showProgress.on()) {
			double fraction = t == null || t.durationMs() <= 0 ? 0.42 : Math.min(1, t.position() / (double) t.durationMs());
			g.fill(textX, 30, w - 5, 32, 0x50FFFFFF);
			g.fill(textX, 30, textX + (int) ((w - 5 - textX) * fraction), 32, 0xFF1ED760);
		}
	}
}
