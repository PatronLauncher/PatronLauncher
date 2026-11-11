package com.patron.pclient.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/** Launcher'ın indirdiği Minecraft haberleri. Launcher'dan yeni geldiyse kısa aralıklarla yeniden sorulur. */
public final class News {
	public record Article(String title, String date, String url, String image) {
		/** Görsel, launcher'ın ürettiği PNG veri adresidir. */
		public byte[] pixels() {
			return Base64.getDecoder().decode(image.substring(image.indexOf(',') + 1));
		}
	}

	private static final long RETRY_MS = 4000;
	private static volatile List<Article> articles = List.of();
	private static volatile boolean pending;
	private static long nextAt;

	private News() {}

	public static List<Article> articles() {
		long now = System.currentTimeMillis();
		if (articles.isEmpty() && !pending && now >= nextAt) {
			pending = true;
			nextAt = now + RETRY_MS;
			Bridge.get("/v1/news").whenComplete((reply, failure) -> {
				pending = false;
				if (failure == null) articles = parse(reply);
			});
		}
		return articles;
	}

	private static List<Article> parse(JsonElement reply) {
		List<Article> out = new ArrayList<>();
		for (JsonElement e : reply.getAsJsonObject().getAsJsonArray("articles")) {
			JsonObject o = e.getAsJsonObject();
			String url = o.get("url").getAsString();
			if (!url.startsWith("https://")) continue;
			String image = o.get("image") == null || o.get("image").isJsonNull() ? "" : o.get("image").getAsString();
			out.add(new Article(o.get("title").getAsString(), o.get("date").getAsString(), url, image));
		}
		return out;
	}
}
