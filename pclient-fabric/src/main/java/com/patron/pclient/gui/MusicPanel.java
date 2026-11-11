package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.bridge.Spotify;
import com.patron.pclient.modules.MusicModule;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;

/** Spotify oynatıcı denetimleri: müzik ekranı, ESC menüsü ve oyun içi kontrol katmanı aynı paneli kullanır. */
final class MusicPanel {
	static final int GREEN = 0xFF1ED760;
	private final PcScreen s;
	private boolean seeking, changingVolume;
	private int seekX1, seekX2, volumeX1, volumeX2;
	private long value;

	MusicPanel(PcScreen screen) { s = screen; }

	/** Çizer; cover kapak boyutu, kompakt olmayan düzende cihaz adı da gösterilir. */
	void draw(GuiGraphicsExtractor g, Spotify.Track t, int x1, int y, int x2, int size, boolean full) {
		Font font = Theme.font();
		PcTextures.Image cover = t.image().isEmpty() ? null : MusicModule.cover(t.image());
		if (cover != null) cover.blit(g, x1, y, size, size);
		else {
			g.fill(x1, y, x1 + size, y + size, 0x20FFFFFF);
			PixelIcons.drawCentered(g, "music", x1 + size / 2, y + size / 2, full ? 3 : 2, Theme.FAINT);
		}
		int tx = x1 + size + (full ? 14 : 9), room = x2 - tx;
		if (full) {
			g.pose().pushMatrix();
			g.pose().translate(tx, y + 2);
			g.pose().scale(1.25f, 1.25f);
			g.text(font, Theme.ellipsize(t.title(), (int) (room / 1.25f)), 0, 0, Theme.TEXT, false);
			g.pose().popMatrix();
			g.text(font, Theme.ellipsize(t.artists(), room), tx, y + 18, Theme.MUTED, false);
			if (!t.device().isEmpty()) g.text(font, Theme.ellipsize(L.t("music.device", t.device()), room), tx, y + 30, Theme.FAINT, false);
		} else {
			g.text(font, Theme.ellipsize(t.title(), room), tx, y, Theme.TEXT, false);
			g.text(font, Theme.ellipsize(t.artists(), room), tx, y + 11, Theme.MUTED, false);
		}

		int by = y + (full ? 46 : 25);
		long position = seeking ? value : t.position();
		seekX1 = tx;
		seekX2 = x2;
		boolean hov = s.hit(tx - 2, by - 4, x2 + 2, by + 7, () -> {
			if (t.durationMs() <= 0) return;
			seeking = true;
			value = seekValue(s.mouseX, t);
		});
		g.fill(tx, by, x2, by + 3, Theme.OFF_HOVER);
		int fill = t.durationMs() > 0 ? (int) ((x2 - tx) * Math.min(1, position / (double) t.durationMs())) : 0;
		g.fill(tx, by, tx + fill, by + 3, GREEN);
		if (hov || seeking) g.fill(tx + fill - 2, by - 2, tx + fill + 3, by + 5, 0xFFFFFFFF);
		g.text(font, Spotify.time(position), tx, by + 7, Theme.FAINT, false);
		String duration = Spotify.time(t.durationMs());
		g.text(font, duration, x2 - font.width(duration), by + 7, Theme.FAINT, false);

		int b = full ? 22 : 18, gap = full ? 6 : 4, cy = full ? y + 70 : y + 42;
		int cx = full ? (tx + x2) / 2 - 30 : tx + (b + gap) * 2;
		if (control(g, cx - (b + gap) * 2, cy, b, "shuffle", t.shuffle(), () -> Spotify.control("shuffle", t.shuffle() ? 0L : 1L))) s.tipNow(L.t("music.shuffle"));
		if (control(g, cx - b - gap, cy, b, "prev", false, () -> Spotify.control("previous", null))) s.tipNow(L.t("music.previous"));
		boolean play = s.hit(cx, cy, cx + b, cy + b, () -> Spotify.control(t.playing() ? "pause" : "play", null));
		Theme.notched(g, cx, cy, cx + b, cy + b, 3, play ? Theme.mix(GREEN, 0xFFFFFFFF, 0.2f) : GREEN);
		PixelIcons.drawCentered(g, t.playing() ? "pause" : "play", cx + b / 2, cy + b / 2, 1, 0xFF06120A);
		if (control(g, cx + b + gap, cy, b, "next", false, () -> Spotify.control("next", null))) s.tipNow(L.t("music.next"));

		if (t.volume() >= 0) {
			// Dar panelde ses çubuğu düğmelerin altına iner.
			boolean below = !full && room < 170;
			int vw = below ? room - 14 : full ? 58 : 46, vx = x2 - vw, vy = below ? cy + b + 7 : cy + b / 2 - 1;
			volumeX1 = vx;
			volumeX2 = x2;
			int shown = changingVolume ? (int) value : t.volume();
			boolean hv = s.hit(vx - 3, vy - 6, x2 + 3, vy + 9, () -> {
				changingVolume = true;
				value = volumeValue(s.mouseX);
			});
			PixelIcons.drawCentered(g, "volume", vx - 10, vy + 1, 1, hv ? Theme.TEXT : Theme.MUTED);
			g.fill(vx, vy, x2, vy + 3, Theme.OFF_HOVER);
			g.fill(vx, vy, vx + vw * Math.max(0, Math.min(100, shown)) / 100, vy + 3, Theme.TEXT);
			if (hv || changingVolume) s.tipNow(shown + "%");
		}
	}

	private boolean control(GuiGraphicsExtractor g, int x, int y, int b, String icon, boolean active, Runnable action) {
		boolean hov = s.hit(x, y, x + b, y + b, action);
		Theme.notched(g, x, y, x + b, y + b, 3, hov ? 0x26FFFFFF : 0x0FFFFFFF);
		PixelIcons.drawCentered(g, icon, x + b / 2, y + b / 2, 1, active ? GREEN : hov ? Theme.TEXT : Theme.MUTED);
		return hov;
	}

	private long seekValue(double x, Spotify.Track t) {
		return (long) (t.durationMs() * Math.max(0, Math.min(1, (x - seekX1) / (double) Math.max(1, seekX2 - seekX1))));
	}

	private long volumeValue(double x) {
		return Math.round(100 * Math.max(0, Math.min(1, (x - volumeX1) / (double) Math.max(1, volumeX2 - volumeX1))));
	}

	boolean mouseDragged(MouseButtonEvent e) {
		Spotify.Track t = Spotify.track();
		if (seeking && t != null) {
			value = seekValue(e.x(), t);
			return true;
		}
		if (changingVolume) {
			value = volumeValue(e.x());
			return true;
		}
		return false;
	}

	void mouseReleased() {
		if (seeking) Spotify.control("seek", value);
		if (changingVolume) Spotify.control("volume", value);
		seeking = changingVolume = false;
	}
}
