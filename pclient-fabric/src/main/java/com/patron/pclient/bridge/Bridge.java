package com.patron.pclient.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.util.Util;

/**
 * Launcher köprüsü istemcisi. Launcher, oyun klasörüne her açılışta yeni bir port ve parola yazar;
 * dosya her istekte okunur, böylece launcher yeniden açılsa da oyun bağlantıyı kendiliğinden bulur.
 * Tüm istekler arka plan iş parçacığında çalışır.
 */
public final class Bridge {
	public static final class BridgeException extends RuntimeException {
		public final boolean unreachable;

		BridgeException(String message, boolean unreachable) {
			super(message);
			this.unreachable = unreachable;
		}
	}

	private record Endpoint(int port, String token) {}

	private Bridge() {}

	private static Path file() {
		return Minecraft.getInstance().gameDirectory.toPath().resolve("pclient").resolve("bridge.json");
	}

	private static Endpoint endpoint() {
		try {
			JsonObject o = JsonParser.parseString(Files.readString(file(), StandardCharsets.UTF_8)).getAsJsonObject();
			return new Endpoint(o.get("port").getAsInt(), o.get("token").getAsString());
		} catch (IOException | RuntimeException e) {
			throw new BridgeException("launcher", true);
		}
	}

	private static JsonElement request(String method, String path, JsonObject body, int timeoutMs) {
		Endpoint endpoint = endpoint();
		HttpURLConnection c = null;
		try {
			c = (HttpURLConnection) URI.create("http://127.0.0.1:" + endpoint.port + path).toURL().openConnection();
			c.setRequestMethod(method);
			c.setConnectTimeout(1500);
			c.setReadTimeout(timeoutMs);
			c.setUseCaches(false);
			c.setRequestProperty("Authorization", "Bearer " + endpoint.token);
			if (body != null) {
				byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
				c.setDoOutput(true);
				c.setFixedLengthStreamingMode(bytes.length);
				c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
				try (OutputStream out = c.getOutputStream()) {
					out.write(bytes);
				}
			}
			int status = c.getResponseCode();
			try (InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream()) {
				String text = in == null ? "" : new String(in.readAllBytes(), StandardCharsets.UTF_8);
				JsonElement json = text.isEmpty() ? JsonNull.INSTANCE : JsonParser.parseString(text);
				if (status >= 400) {
					boolean withMessage = json.isJsonObject() && json.getAsJsonObject().has("error");
					throw new BridgeException(withMessage ? json.getAsJsonObject().get("error").getAsString() : "HTTP " + status, status == 403);
				}
				return json;
			}
		} catch (IOException | IllegalStateException e) {
			throw new BridgeException("launcher", true);
		} finally {
			if (c != null) c.disconnect();
		}
	}

	public static CompletableFuture<JsonElement> get(String path) {
		return CompletableFuture.supplyAsync(() -> request("GET", path, null, 15_000), Util.nonCriticalIoPool());
	}

	public static CompletableFuture<JsonElement> post(String path, JsonObject body, int timeoutMs) {
		return CompletableFuture.supplyAsync(() -> request("POST", path, body == null ? new JsonObject() : body, timeoutMs), Util.nonCriticalIoPool());
	}

	/** Bir iş zincirinden çıkan hatanın oyuncuya gösterilecek metni; launcher kapalıysa null. */
	public static String message(Throwable t) {
		while (t.getCause() != null && !(t instanceof BridgeException)) t = t.getCause();
		return t instanceof BridgeException b && b.unreachable ? null : t.getMessage();
	}
}
