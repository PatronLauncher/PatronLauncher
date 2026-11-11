package com.patron.pclient.gui;

import com.patron.pclient.config.PClientConfig;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.Identifier;

/** Ana menü arka plan temaları. "vanilla" Minecraft'ın dönen manzarasını kullanır. */
public final class MenuThemes {
	public static final String VANILLA = "vanilla";
	public static final List<String> ALL = List.of("crimson", "glacier", "emerald", VANILLA);
	private static final Identifier PANORAMA = Identifier.withDefaultNamespace("textures/gui/title/background/panorama_0.png");

	private MenuThemes() {}

	private static byte[] read(String id) throws IOException {
		var path = FabricLoader.getInstance().getModContainer("pclient").orElseThrow().findPath("assets/pclient/backgrounds/" + id + ".jpg").orElseThrow();
		try (InputStream in = java.nio.file.Files.newInputStream(path)) {
			return in.readAllBytes();
		}
	}

	private static PcTextures.Image image(String id) {
		return PcTextures.get("theme:" + id, () -> read(id));
	}

	/** Seçili temayı ekranı dolduracak şekilde çizer; manzara kullanılacaksa false döner. */
	public static boolean draw(GuiGraphicsExtractor g, int width, int height) {
		String id = PClientConfig.get().menuTheme;
		if (VANILLA.equals(id)) return false;
		PcTextures.Image image = image(id);
		if (image == null) return false;
		// Çok yavaş kayma: manzaradaki gibi canlı dursun.
		float drift = (float) (Math.sin(System.currentTimeMillis() / 26000.0) * 0.5 + 0.5);
		float scale = Math.max((width * 1.05f) / image.width(), (height * 1.05f) / image.height());
		int w = Math.round(image.width() * scale), h = Math.round(image.height() * scale);
		g.pose().pushMatrix();
		g.pose().translate(-(w - width) * drift, -(h - height) / 2f);
		image.blit(g, 0, 0, w, h);
		g.pose().popMatrix();
		if (PClientConfig.get().animatedThemes) effects(g, id, width, height);
		return true;
	}

	/** i. parçacığın k. sabit rastgele değeri (0..1). */
	private static double seed(int i, int k) {
		double v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
		return v - Math.floor(v);
	}

	private static int alpha(int rgb, double a) { return (int) (Math.max(0, Math.min(1, a)) * 255) << 24 | rgb; }

	/** Görselin üstünde çizilen ışık ve parçacıklar; dokusuz dikdörtgenler olduğu için maliyeti çok düşüktür. */
	private static void effects(GuiGraphicsExtractor g, String id, int width, int height) {
		double t = System.currentTimeMillis() / 1000.0;
		switch (id) {
			case "crimson" -> {
				aurora(g, t, width, height, 0xFF2040);
				embers(g, t, width, height);
			}
			case "glacier" -> {
				aurora(g, t, width, height, 0x30F0D0);
				snow(g, t, width, height);
			}
			case "emerald" -> {
				mist(g, t, width, height);
				fireflies(g, t, width, height);
			}
			default -> {}
		}
	}

	private static void aurora(GuiGraphicsExtractor g, double t, int width, int height, int rgb) {
		int bands = 22, bandW = width / bands + 1, bottom = height * 45 / 100;
		for (int i = 0; i < bands; i++) {
			double wave = Math.sin(t * 0.55 + i * 0.5) * Math.sin(t * 0.23 + i * 0.17);
			if (wave <= 0) continue;
			int x = i * width / bands, end = bottom - (int) (height * 0.12 * (1 - wave));
			g.fillGradient(x, 0, x + bandW, end, alpha(rgb, wave * 0.08), alpha(rgb, wave * 0.3));
			g.fillGradient(x, end, x + bandW, end + height / 12, alpha(rgb, wave * 0.3), alpha(rgb, 0));
		}
	}

	private static void embers(GuiGraphicsExtractor g, double t, int width, int height) {
		for (int i = 0; i < 70; i++) {
			double life = (t * (0.035 + seed(i, 1) * 0.06) + seed(i, 2)) % 1;
			int x = (int) (seed(i, 3) * width + Math.sin(t * (0.6 + seed(i, 4)) + i) * 14);
			int y = height - (int) (life * height * 1.05);
			int size = seed(i, 5) > 0.55 ? 2 : 1;
			double flicker = 0.65 + 0.35 * Math.sin(t * (3 + seed(i, 6) * 5) + i), fade = Math.min(1, (1 - life) * 1.6);
			int rgb = seed(i, 7) > 0.5 ? 0xFF6A30 : 0xFFB84A;
			g.fill(x - 1, y - 1, x + size + 1, y + size + 1, alpha(rgb, flicker * fade * 0.18));
			g.fill(x, y, x + size, y + size, alpha(rgb, flicker * fade));
		}
	}

	private static void snow(GuiGraphicsExtractor g, double t, int width, int height) {
		for (int i = 0; i < 90; i++) {
			double fall = (t * (0.03 + seed(i, 1) * 0.07) + seed(i, 2)) % 1;
			int x = (int) (seed(i, 3) * width + Math.sin(t * (0.3 + seed(i, 4) * 0.5) + i) * 18 + fall * 30) % width;
			int y = (int) (fall * height);
			int size = seed(i, 5) > 0.7 ? 2 : 1;
			g.fill(x, y, x + size, y + size, alpha(0xD8F4FF, 0.35 + seed(i, 6) * 0.5));
		}
	}

	private static void mist(GuiGraphicsExtractor g, double t, int width, int height) {
		for (int i = 0; i < 5; i++) {
			int y = height * (45 + i * 9) / 100 + (int) (Math.sin(t * 0.2 + i) * 8), h = height / 7;
			double a = 0.05 + 0.04 * Math.sin(t * 0.3 + i * 1.7);
			g.fillGradient(0, y, width, y + h / 2, alpha(0xBFEAD0, 0), alpha(0xBFEAD0, a));
			g.fillGradient(0, y + h / 2, width, y + h, alpha(0xBFEAD0, a), alpha(0xBFEAD0, 0));
		}
	}

	private static void fireflies(GuiGraphicsExtractor g, double t, int width, int height) {
		for (int i = 0; i < 46; i++) {
			int x = (int) ((seed(i, 1) + Math.sin(t * (0.1 + seed(i, 2) * 0.15) + i) * 0.04) * width);
			int y = (int) ((0.3 + seed(i, 3) * 0.65 + Math.cos(t * (0.12 + seed(i, 4) * 0.15) + i * 2) * 0.04) * height);
			double pulse = Math.sin(t * (0.8 + seed(i, 5) * 1.4) + i * 3);
			if (pulse <= 0) continue;
			g.fill(x - 2, y - 2, x + 4, y + 4, alpha(0xD8FF70, pulse * 0.16));
			g.fill(x, y, x + 2, y + 2, alpha(0xEFFFA0, pulse));
		}
	}

	/** Tema seçim kartındaki küçük önizleme; görsel henüz yüklenmediyse false. */
	public static boolean thumbnail(GuiGraphicsExtractor g, String id, int x, int y, int w, int h) {
		if (VANILLA.equals(id)) {
			g.blit(RenderPipelines.GUI_TEXTURED, PANORAMA, x, y, 0, 180, w, h, 1024, 576, 1024, 1024);
			return true;
		}
		PcTextures.Image image = image(id);
		if (image == null) return false;
		image.blit(g, x, y, w, h);
		return true;
	}

	/** Tema ekranından çıkınca kullanılmayan büyük dokular bellekten atılır. */
	public static void releaseUnused() {
		String active = PClientConfig.get().menuTheme;
		for (String id : ALL) if (!id.equals(active) && !VANILLA.equals(id)) PcTextures.release("theme:" + id);
	}
}
