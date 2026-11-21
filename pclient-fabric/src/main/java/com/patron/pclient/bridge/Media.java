package com.patron.pclient.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Oyun içi müzik durumu. Launcher, bilgisayarda çalan oynatıcıyı (Spotify, YouTube Music, Deezer…)
 * Windows medya oturumundan okur; hesap bağlamak gerekmez. Tek bir sorgu sürer; müzik ekranı ve
 * HUD aynı durumu okur.
 */
public final class Media {
	public record Track(String title, String artists, String image, long durationMs, long progressMs, boolean playing, boolean shuffle,
		String device, int volume, long receivedAt) {
		/** İki sorgu arasında ilerleme çubuğu akıcı kalsın diye tahmini konum. */
		public long position() {
			long p = progressMs + (playing ? System.currentTimeMillis() - receivedAt : 0);
			return durationMs > 0 ? Math.min(p, durationMs) : p;
		}
	}

	private static final AtomicBoolean POLLING = new AtomicBoolean();
	private static volatile boolean reachable = true, known;
	private static volatile String error;
	private static volatile Track track;
	private static volatile long lastPoll;

	private Media() {}

	public static boolean reachable() { return reachable; }

	/** İlk yanıt geldi mi. */
	public static boolean known() { return known; }

	public static String error() { return error; }

	public static Track track() { return track; }

	private static String text(JsonObject o, String key) {
		JsonElement e = o.get(key);
		return e == null || e.isJsonNull() ? "" : e.getAsString();
	}

	private static long number(JsonObject o, String key) {
		JsonElement e = o.get(key);
		return e == null || e.isJsonNull() ? 0 : e.getAsLong();
	}

	private static Track parse(JsonElement json) {
		if (json == null || !json.isJsonObject()) return null;
		JsonObject o = json.getAsJsonObject();
		JsonElement volume = o.get("volume");
		return new Track(text(o, "title"), text(o, "artists"), text(o, "image"), number(o, "duration_ms"), number(o, "progress_ms"),
			o.get("is_playing").getAsBoolean(), o.get("shuffle").getAsBoolean(), text(o, "device"),
			volume == null || volume.isJsonNull() ? -1 : volume.getAsInt(), System.currentTimeMillis());
	}

	private static void fail(Throwable t) {
		String message = Bridge.message(t);
		if (message == null) reachable = false;
		else error = message;
		known = true;
		POLLING.set(false);
	}

	/** Çağrı sıklığından bağımsız olarak en fazla intervalMs'de bir sorgular. */
	public static void poll(long intervalMs) {
		long now = System.currentTimeMillis();
		if (now - lastPoll < intervalMs || !POLLING.compareAndSet(false, true)) return;
		lastPoll = now;
		Bridge.get("/v1/media/now").thenAccept(json -> {
			track = parse(json);
			reachable = true;
			known = true;
			error = null;
			POLLING.set(false);
		}).exceptionally(t -> {
			fail(t);
			return null;
		});
	}

	/** Kapak resmi (PNG). Şarkı o arada değiştiyse hata verir; bir sonraki şarkıda yeni anahtar gelir. */
	public static byte[] cover(String key) throws IOException {
		JsonObject body = new JsonObject();
		body.addProperty("key", key);
		JsonElement png = Bridge.post("/v1/media/cover", body, 15_000).join().getAsJsonObject().get("png");
		if (png == null || png.isJsonNull()) throw new IOException("Kapak resmi yok.");
		return Base64.getDecoder().decode(png.getAsString());
	}

	public static void control(String action, Long value) {
		JsonObject body = new JsonObject();
		body.addProperty("action", action);
		if (value != null) body.addProperty("value", value);
		// Düğme anında tepki versin; gerçek durum bir sonraki sorguyla gelir.
		Track t = track;
		if (t != null) {
			long now = System.currentTimeMillis();
			track = switch (action) {
				case "play" -> new Track(t.title, t.artists, t.image, t.durationMs, t.position(), true, t.shuffle, t.device, t.volume, now);
				case "pause" -> new Track(t.title, t.artists, t.image, t.durationMs, t.position(), false, t.shuffle, t.device, t.volume, now);
				case "shuffle" -> new Track(t.title, t.artists, t.image, t.durationMs, t.position(), t.playing, value != null && value == 1, t.device, t.volume, now);
				case "volume" -> new Track(t.title, t.artists, t.image, t.durationMs, t.position(), t.playing, t.shuffle, t.device, value == null ? t.volume : value.intValue(), now);
				case "seek" -> new Track(t.title, t.artists, t.image, t.durationMs, value == null ? t.position() : value, t.playing, t.shuffle, t.device, t.volume, now);
				default -> t;
			};
		}
		error = null;
		Bridge.post("/v1/media/control", body, 15_000).thenRun(() -> lastPoll = System.currentTimeMillis() - 100_000).exceptionally(e -> {
			fail(e);
			return null;
		});
	}

	public static String time(long ms) {
		long s = Math.max(0, ms) / 1000;
		return s / 60 + ":" + String.format("%02d", s % 60);
	}
}
