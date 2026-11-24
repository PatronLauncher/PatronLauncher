package com.patron.pclient.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * PatronLauncher hesabı (site hesabı; Minecraft hesaplarından ayrı). Giriş launcher'da yürür: launcher kod alır,
 * tarayıcıda onay sayfasını açar ve oturumu kendisi saklar. Oyun yalnızca durumu gösterir ve işlemi başlatır.
 */
public final class Patron {
	public enum State { SIGNED_OUT, PENDING, SIGNED_IN }

	private static volatile State state = State.SIGNED_OUT;
	private static volatile String name, code, error;
	private static volatile boolean polling, busy;

	private Patron() {}

	public static State state() { return state; }

	/** Görünen ad (girişliyken). */
	public static String name() { return name; }

	/** Bekleyen girişin kodu (ABCD-EFGH). */
	public static String code() { return code; }

	public static String error() { return error; }

	public static boolean busy() { return busy; }

	private static String text(JsonObject o, String key) {
		JsonElement e = o.get(key);
		return e == null || e.isJsonNull() ? null : e.getAsString();
	}

	private static void read(JsonElement json) {
		JsonObject o = json.getAsJsonObject();
		state = switch (String.valueOf(text(o, "state"))) {
			case "signed_in" -> State.SIGNED_IN;
			case "pending" -> State.PENDING;
			default -> State.SIGNED_OUT;
		};
		String display = text(o, "display");
		name = display != null ? display : text(o, "username");
		code = text(o, "code");
		String e = text(o, "error");
		if (e != null) error = e;
		if (state == State.PENDING) poll();
	}

	private static Void failed(Throwable t) {
		String message = Bridge.message(t);
		if (message != null) error = message;
		busy = false;
		return null;
	}

	public static void refresh() {
		Bridge.get("/v1/patron").thenAccept(Patron::read).exceptionally(Patron::failed);
	}

	/** Girişi başlatır: launcher tarayıcıda onay sayfasını açar (dil launcher'ınki). */
	public static void login() {
		if (busy) return;
		busy = true;
		error = null;
		Bridge.post("/v1/patron/login", new JsonObject(), 20_000).thenAccept(json -> {
			busy = false;
			read(json);
		}).exceptionally(Patron::failed);
	}

	public static void cancel() {
		Bridge.post("/v1/patron/cancel", null, 5_000).thenAccept(Patron::read).exceptionally(Patron::failed);
	}

	public static void reopen() {
		Bridge.post("/v1/patron/reopen", null, 5_000).thenRun(() -> {}).exceptionally(Patron::failed);
	}

	public static void openProfile() {
		Bridge.post("/v1/patron/profile", null, 5_000).thenRun(() -> {}).exceptionally(Patron::failed);
	}

	public static void clearError() { error = null; }

	/** Onay beklenirken iki saniyede bir durum sorulur; giriş bitince durur. */
	private static void poll() {
		if (polling) return;
		polling = true;
		CompletableFuture.delayedExecutor(2, TimeUnit.SECONDS).execute(() -> Bridge.get("/v1/patron").thenAccept(json -> {
			polling = false;
			read(json);
		}).exceptionally(t -> {
			polling = false;
			return failed(t);
		}));
	}
}
