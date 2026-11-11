package com.patron.pclient.gui;

import com.patron.pclient.config.PClientConfig;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.Identifier;

/**
 * PClient görsel dili: koyu zemin, vurgu rengi (varsayılan Patron kırmızısı) ve logodaki gibi
 * sol üst / sağ alt köşesi 45° kesik paneller.
 */
public final class Theme {
	public static final Identifier LOGO = Identifier.fromNamespaceAndPath("pclient", "textures/gui/logo.png");
	public static final int LOGO_W = 128, LOGO_H = 133;
	public static final Identifier MODRINTH_LOGO = Identifier.fromNamespaceAndPath("pclient", "textures/gui/modrinth.png");
	public static final int MODRINTH_GREEN = 0xFF1BD96A;

	public static final int TEXT = 0xFFF2F3F7, MUTED = 0xFF9AA0AD, FAINT = 0xFF5C616E;
	public static final int PANEL = 0xEC0A0B10, HEADER = 0xF2101118, CARD = 0xB8151720, CARD_HOVER = 0xD81C1F2A;
	public static final int LINE = 0x1FFFFFFF, LINE_STRONG = 0x38FFFFFF, OFF = 0xFF262933, OFF_HOVER = 0xFF30343F;

	private Theme() {}

	public static int accent() { return accentFor(PClientConfig.get().accent); }

	public static int accentFor(String name) {
		return switch (name) {
			case "ice" -> 0xFF38BDF8;
			case "emerald" -> 0xFF34D399;
			case "gold" -> 0xFFFBBF24;
			case "violet" -> 0xFFA78BFA;
			default -> 0xFFFF2A3D;
		};
	}

	public static int withAlpha(int c, int a) { return (a & 0xFF) << 24 | c & 0xFFFFFF; }

	/** ARGB doğrusal karışım. */
	public static int mix(int a, int b, float t) {
		t = Math.max(0, Math.min(1, t));
		int r = 0;
		for (int s = 0; s < 32; s += 8) {
			int ca = a >>> s & 0xFF, cb = b >>> s & 0xFF;
			r |= Math.round(ca + (cb - ca) * t) << s;
		}
		return r;
	}

	/** Sol üst ve sağ alt köşesi n piksel kesik dolu dikdörtgen. */
	public static void notched(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int n, int color) {
		n = Math.min(n, Math.min(x2 - x1, y2 - y1) / 2);
		for (int i = 0; i < n; i++) g.fill(x1 + n - i, y1 + i, x2, y1 + i + 1, color);
		g.fill(x1, y1 + n, x2, y2 - n, color);
		for (int i = 0; i < n; i++) g.fill(x1, y2 - n + i, x2 - i - 1, y2 - n + i + 1, color);
	}

	/** notched() ile aynı biçimde 1 piksellik çerçeve. */
	public static void notchedOutline(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int n, int color) {
		n = Math.min(n, Math.min(x2 - x1, y2 - y1) / 2);
		g.fill(x1 + n, y1, x2, y1 + 1, color);
		g.fill(x2 - 1, y1 + 1, x2, y2 - n, color);
		g.fill(x1, y2 - 1, x2 - n, y2, color);
		g.fill(x1, y1 + n, x1 + 1, y2 - 1, color);
		for (int i = 1; i < n; i++) {
			g.fill(x1 + n - i, y1 + i, x1 + n - i + 1, y1 + i + 1, color);
			g.fill(x2 - n + i - 1, y2 - i - 1, x2 - n + i, y2 - i, color);
		}
	}

	/** Yuvarlak köşeli dolu dikdörtgen. */
	public static void rounded(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int r, int color) {
		r = Math.min(r, Math.min(x2 - x1, y2 - y1) / 2);
		for (int i = 0; i < r; i++) {
			int rest = r - i, inset = r - (int) Math.round(Math.sqrt(r * r - rest * rest));
			g.fill(x1 + inset, y1 + i, x2 - inset, y1 + i + 1, color);
			g.fill(x1 + inset, y2 - i - 1, x2 - inset, y2 - i, color);
		}
		g.fill(x1, y1 + r, x2, y2 - r, color);
	}

	/** Oyun içi HUD kutusu. */
	public static void hudBox(GuiGraphicsExtractor g, int x, int y, int w, int h) {
		g.fill(x, y, x + w, y + h, 0x78000000);
	}

	/** Logo, verilen yükseklikte (genişlik orana göre). */
	public static void logo(GuiGraphicsExtractor g, int x, int y, int size) {
		int w = size * LOGO_W / LOGO_H;
		g.blit(RenderPipelines.GUI_TEXTURED, LOGO, x, y, 0, 0, w, size, LOGO_W, LOGO_H, LOGO_W, LOGO_H);
	}

	public static void discordLogo(GuiGraphicsExtractor g, int x, int y, int size) {
		g.blit(RenderPipelines.GUI_TEXTURED, Identifier.fromNamespaceAndPath("pclient", "textures/gui/discord.png"), x, y, 0, 0, size, size, 64, 64, 64, 64);
	}

	public static void modrinthLogo(GuiGraphicsExtractor g, int x, int y, int size) {
		g.blit(RenderPipelines.GUI_TEXTURED, MODRINTH_LOGO, x, y, 0, 0, size, size, 128, 128, 128, 128);
	}

	public static Font font() { return Minecraft.getInstance().font; }

	/** Harf aralıklı yazı (başlık ve buton etiketleri için). */
	public static int spacedWidth(String s, int spacing) {
		if (s.isEmpty()) return 0;
		int w = 0;
		for (int i = 0; i < s.length(); ) {
			int cp = s.codePointAt(i);
			w += font().width(new String(Character.toChars(cp))) + spacing;
			i += Character.charCount(cp);
		}
		return w - spacing;
	}

	public static void spaced(GuiGraphicsExtractor g, String s, int x, int y, int color, int spacing) {
		for (int i = 0; i < s.length(); ) {
			int cp = s.codePointAt(i);
			String ch = new String(Character.toChars(cp));
			g.text(font(), ch, x, y, color, false);
			x += font().width(ch) + spacing;
			i += Character.charCount(cp);
		}
	}

	public static void spacedCentered(GuiGraphicsExtractor g, String s, int cx, int y, int color, int spacing) {
		spaced(g, s, cx - spacedWidth(s, spacing) / 2, y, color, spacing);
	}

	public static void scaledText(GuiGraphicsExtractor g, String s, float x, float y, float scale, int color, boolean shadow) {
		g.pose().pushMatrix();
		g.pose().translate(x, y);
		g.pose().scale(scale, scale);
		g.text(font(), s, 0, 0, color, shadow);
		g.pose().popMatrix();
	}

	/** Genişliğe sığmayan metni "…" ile kısaltır. */
	public static String ellipsize(String s, int maxW) {
		if (font().width(s) <= maxW) return s;
		return font().plainSubstrByWidth(s, Math.max(0, maxW - font().width("…"))) + "…";
	}
}
