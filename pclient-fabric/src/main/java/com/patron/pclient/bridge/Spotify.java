package com.patron.pclient.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Oyun içi Spotify durumu. Tek bir sorgu sürer; müzik ekranı ve HUD aynı durumu okur. Spotify
 * anahtarları launcher'da kalır, oyun yalnızca şarkı bilgisini ve kontrol sonucunu görür.
 */
public final class Spotify {
	public record Track(String title, String artists, String image, long durationMs, long progressMs, boolean playing, boolean shuffle,
		String device, int volume, long receivedAt) {
		/** İki sorgu arasında ilerleme çubuğu akıcı kalsın diye tahmini konum. */
		public long position() {
			long p = progressMs + (playing ? System.currentTimeMillis() - receivedAt : 0);
			return durationMs > 0 ? Math.min(p, durationMs) : p;
		}
	}

	private static final long STATUS_RETRY_MS = 15_000;
	private static final AtomicBoolean POLLING = new AtomicBoolean();
	private static volatile boolean reachable = true, connected, known, connecting;
	private static volatile String accountName, error;
	private static volatile Track track;
	private static volatile long lastPoll, lastStatus;

	private Spotify() {}

	public static boolean reachable() { return reachable; }

	public static boolean known() { return known; }

	public static boolean connected() { return connected; }

	public static boolean connecting() { return connecting; }

	public static String accountName() { return accountName; }

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
		POLLING.set(false);
	}

	/** Çağrı sıklığından bağımsız olarak en fazla intervalMs'de bir sorgular. */
	public static void poll(long intervalMs) {
		long now = System.currentTimeMillis();
		if (now - lastPoll < intervalMs || !POLLING.compareAndSet(false, true)) return;
		lastPoll = now;
		if (!connected) {
			if (known && now - lastStatus < STATUS_RETRY_MS) {
				POLLING.set(false);
				return;
			}
			lastStatus = now;
			Bridge.get("/v1/spotify/status").thenAccept(json -> {
				JsonObject o = json.getAsJsonObject();
				connected = o.get("connected").getAsBoolean();
				accountName = text(o, "name");
				known = true;
				reachable = true;
				error = null;
				// Bağlıysa şarkı bilgisi hemen bir sonraki karede istenir.
				if (connected) lastPoll = 0;
				POLLING.set(false);
			}).exceptionally(t -> {
				fail(t);
				known = true;
				return null;
			});
			return;
		}
		Bridge.get("/v1/spotify/now").thenAccept(json -> {
			track = parse(json);
			reachable = true;
			error = null;
			POLLING.set(false);
		}).exceptionally(t -> {
			fail(t);
			return null;
		});
	}

	public static void connect() {
		if (connecting) return;
		connecting = true;
		error = null;
		Bridge.post("/v1/spotify/login", null, 190_000).thenRun(() -> {
			connected = true;
			connecting = false;
			lastPoll = 0;
			known = false;
		}).exceptionally(t -> {
			fail(t);
			connecting = false;
			return null;
		});
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
		Bridge.post("/v1/spotify/control", body, 15_000).thenRun(() -> lastPoll = System.currentTimeMillis() - 100_000).exceptionally(e -> {
			fail(e);
			return null;
		});
	}

	public static String time(long ms) {
		long s = Math.max(0, ms) / 1000;
		return s / 60 + ":" + String.format("%02d", s % 60);
	}
}
