package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.config.PClientConfig;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.FormattedCharSequence;

/**
 * Arkadaş mesajı bildirimleri (Steam tarzı): sağ üstte, sağdan kayarak gelen kart; birkaç saniye kalır, sonra kayarak
 * çıkar. En çok üç kart üst üste durur. Ses ve bildirim PClient ayarlarından kapatılabilir.
 */
public final class MessageToasts {
	private record Toast(String from, String body, long shownAt) {}

	private static final List<Toast> ACTIVE = new ArrayList<>();
	private static final long IN_MS = 260, STAY_MS = 5200, OUT_MS = 320;
	private static final int W = 210, MAX = 3;

	private MessageToasts() {}

	/** Yeni mesaj bildirimi (oyun iş parçacığında çağrılır). */
	public static void show(String from, String body) {
		if (!PClientConfig.get().messageToasts) return;
		synchronized (ACTIVE) {
			ACTIVE.add(new Toast(from, body, System.currentTimeMillis()));
			while (ACTIVE.size() > MAX) ACTIVE.remove(0);
		}
		if (PClientConfig.get().messageSound) {
			Minecraft.getInstance().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.AMETHYST_BLOCK_CHIME, 1.7F, 0.9F));
		}
	}

	/** 0→1 yumuşak yavaşlayan eğri. */
	private static float ease(float t) {
		t = Math.max(0, Math.min(1, t));
		return 1 - (1 - t) * (1 - t) * (1 - t);
	}

	/** HUD'dan ve PClient menülerinden her karede çağrılır. */
	public static void render(GuiGraphicsExtractor g) {
		List<Toast> list;
		long now = System.currentTimeMillis();
		synchronized (ACTIVE) {
			ACTIVE.removeIf(t -> now - t.shownAt > IN_MS + STAY_MS + OUT_MS);
			if (ACTIVE.isEmpty()) return;
			list = List.copyOf(ACTIVE);
		}
		Minecraft mc = Minecraft.getInstance();
		Font font = mc.font;
		int screenW = mc.getWindow().getGuiScaledWidth();
		int y = 8;
		g.nextStratum();
		for (int i = list.size() - 1; i >= 0; i--) {
			Toast t = list.get(i);
			long age = now - t.shownAt;
			float slide = age < IN_MS ? ease(age / (float) IN_MS) : age > IN_MS + STAY_MS ? 1 - ease((age - IN_MS - STAY_MS) / (float) OUT_MS) : 1;
			List<FormattedCharSequence> lines = font.split(FormattedText.of(t.body), W - 46);
			if (lines.size() > 2) lines = lines.subList(0, 2);
			int h = 26 + lines.size() * 10;
			int x = screenW - 8 - Math.round(W * slide);
			Theme.notched(g, x, y, x + W, y + h, 4, 0xF20A0B10);
			Theme.notchedOutline(g, x, y, x + W, y + h, 4, Theme.LINE_STRONG);
			g.fill(x, y + 4, x + 2, y + h - 4, Theme.accent());
			// Avatar: adın ilk harfi.
			Theme.notched(g, x + 8, y + 7, x + 28, y + 27, 3, Theme.withAlpha(Theme.accent(), 0x48));
			String letter = t.from.isEmpty() ? "?" : t.from.substring(0, 1).toUpperCase();
			g.text(font, letter, x + 18 - font.width(letter) / 2, y + 13, Theme.TEXT, false);
			g.text(font, Theme.ellipsize(t.from, W - 90), x + 34, y + 7, Theme.TEXT, false);
			String hint = L.t("friends.openHint");
			Theme.scaledText(g, hint, x + W - 8 - font.width(hint) * 0.7f, y + 8, 0.7f, Theme.FAINT, false);
			int ly = y + 19;
			for (FormattedCharSequence l : lines) {
				g.text(font, l, x + 34, ly, Theme.MUTED, false);
				ly += 10;
			}
			// Kalan süre çubuğu.
			float left = 1 - Math.min(1, Math.max(0, (age - IN_MS) / (float) STAY_MS));
			g.fill(x + 6, y + h - 3, x + 6 + Math.round((W - 12) * left), y + h - 2, Theme.withAlpha(Theme.accent(), 0x90));
			y += h + 6;
		}
	}
}
