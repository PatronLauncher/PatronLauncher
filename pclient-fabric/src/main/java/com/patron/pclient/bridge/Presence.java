package com.patron.pclient.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Sunucudaki hangi oyuncuların PClient kullandığını öğrenir. Servise yalnızca oyuncu UUID'leri gider;
 * sunucu adresi veya kullanıcı adı gönderilmez. support.json'da adres yoksa hiç ağ isteği yapılmaz.
 */
public final class Presence {
	private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
	private static final AtomicBoolean BUSY = new AtomicBoolean();
	private static volatile Set<UUID> online = Set.of();

	private Presence() {}

	public static boolean isOnline(UUID id) { return online.contains(id); }

	public static void clear() { online = Set.of(); }

	public static void sync(UUID self, Collection<UUID> players) {
		String url = Support.presence();
		if (url.isEmpty() || !BUSY.compareAndSet(false, true)) return;
		exchange(url, self, players).whenComplete((found, error) -> {
			if (found != null) online = found;
			BUSY.set(false);
		});
	}

	/** Kendi varlığını bildirir, aynı yanıtta verilen oyunculardan PClient kullananları alır. */
	public static CompletableFuture<Set<UUID>> exchange(String url, UUID self, Collection<UUID> players) {
		JsonObject body = new JsonObject();
		body.addProperty("self", self.toString());
		JsonArray list = new JsonArray();
		players.forEach(p -> list.add(p.toString()));
		body.add("players", list);
		HttpRequest request = HttpRequest.newBuilder(URI.create(url + "/v1/presence"))
			.timeout(Duration.ofSeconds(8))
			.header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(body.toString()))
			.build();
		Set<UUID> asked = new HashSet<>(players);
		return HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenApply(response -> {
			Set<UUID> found = new HashSet<>();
			if (response.statusCode() != 200) return found;
			for (JsonElement e : JsonParser.parseString(response.body()).getAsJsonObject().getAsJsonArray("online")) {
				UUID id = UUID.fromString(e.getAsString());
				if (asked.contains(id)) found.add(id);
			}
			return found;
		});
	}
}
