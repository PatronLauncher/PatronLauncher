package com.patron.pclient.gui;

import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.renderpearl.api.textures.FilterMode;
import com.patron.pclient.PClient;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Callable;
import javax.imageio.ImageIO;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Util;

/** Çalışma anında yüklenen dokular (tema görselleri, kapak resimleri, mod simgeleri). */
public final class PcTextures {
	public record Image(Identifier id, int width, int height) {
		public void blit(GuiGraphicsExtractor g, int x, int y, int w, int h) {
			g.blit(RenderPipelines.GUI_TEXTURED, id, x, y, 0, 0, w, h, width, height, width, height);
		}

		/** Alanı oranı bozmadan doldurur; taşan kenarlar kırpılır. */
		public void cover(GuiGraphicsExtractor g, int x, int y, int w, int h) {
			int regionW = width, regionH = width * h / w;
			if (regionH > height) {
				regionH = height;
				regionW = height * w / h;
			}
			g.blit(RenderPipelines.GUI_TEXTURED, id, x, y, (width - regionW) / 2f, (height - regionH) / 2f, w, h, regionW, regionH, width, height);
		}

		/** Alanın içine oranı bozmadan sığdırır ve ortalar. */
		public void contain(GuiGraphicsExtractor g, int x, int y, int w, int h) {
			float scale = Math.min(w / (float) width, h / (float) height);
			int drawW = Math.round(width * scale), drawH = Math.round(height * scale);
			blit(g, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
		}
	}

	private static final Map<String, Image> LOADED = new ConcurrentHashMap<>();
	private static final Set<String> PENDING = ConcurrentHashMap.newKeySet();
	private static final Set<String> FAILED = ConcurrentHashMap.newKeySet();
	private static int counter;

	private PcTextures() {}

	/** Yüklenmişse dokuyu döner; değilse arka planda yüklemeyi başlatır ve null döner. */
	public static Image get(String key, Callable<byte[]> source) {
		Image image = LOADED.get(key);
		if (image != null || FAILED.contains(key) || !PENDING.add(key)) return image;
		CompletableFuture.supplyAsync(() -> {
			try {
				return decode(source.call());
			} catch (Exception e) {
				throw new IllegalStateException(e);
			}
		}, Util.nonCriticalIoPool()).whenComplete((pixels, error) -> {
			if (error != null || pixels == null) {
				PClient.LOG.debug("Görsel yüklenemedi: {}", key, error);
				FAILED.add(key);
				PENDING.remove(key);
				return;
			}
			Minecraft.getInstance().execute(() -> {
				Identifier id = Identifier.fromNamespaceAndPath("pclient", "dynamic/" + counter++);
				DynamicTexture texture = new DynamicTexture(() -> "PClient " + key, pixels) {
					{ sampler = RenderSystem.getSamplerCache().getClampToEdge(FilterMode.LINEAR); }
				};
				Minecraft.getInstance().getTextureManager().register(id, texture);
				LOADED.put(key, new Image(id, pixels.getWidth(), pixels.getHeight()));
				PENDING.remove(key);
			});
		});
		return null;
	}

	/** Dokuyu bellekten atar; tekrar istenirse yeniden yüklenir. */
	public static void release(String key) {
		Image image = LOADED.remove(key);
		if (image != null) Minecraft.getInstance().getTextureManager().release(image.id);
		FAILED.remove(key);
	}

	private static NativeImage decode(byte[] bytes) throws IOException {
		BufferedImage source = ImageIO.read(new ByteArrayInputStream(bytes));
		if (source == null) throw new IOException("biçim desteklenmiyor");
		int w = source.getWidth(), h = source.getHeight();
		NativeImage out = new NativeImage(w, h, false);
		int[] row = new int[w];
		for (int y = 0; y < h; y++) {
			source.getRGB(0, y, w, 1, row, 0, w);
			for (int x = 0; x < w; x++) out.setPixel(x, y, row[x]);
		}
		return out;
	}

	/** Yalnızca https adreslerinden, boyut sınırıyla indirir. */
	public static byte[] download(String url) throws IOException {
		URI uri = URI.create(url);
		if (!"https".equals(uri.getScheme())) throw new IOException("yalnızca https");
		HttpURLConnection c = (HttpURLConnection) uri.toURL().openConnection();
		c.setConnectTimeout(5000);
		c.setReadTimeout(10_000);
		try (InputStream in = c.getInputStream()) {
			byte[] bytes = in.readNBytes(4 * 1024 * 1024 + 1);
			if (bytes.length > 4 * 1024 * 1024) throw new IOException("görsel çok büyük");
			return bytes;
		} finally {
			c.disconnect();
		}
	}
}
