package com.patron.pclient.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.authlib.minecraft.UserApiService;
import com.mojang.authlib.services.MinecraftServicesDiscoveryService;
import com.mojang.util.UndashedUuid;
import com.patron.pclient.PClient;
import com.patron.pclient.mixin.MinecraftSessionAccessor;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.minecraft.client.Minecraft;
import net.minecraft.client.User;
import net.minecraft.client.multiplayer.ProfileKeyPairManager;
import net.minecraft.client.multiplayer.chat.report.ReportEnvironment;
import net.minecraft.client.multiplayer.chat.report.ReportingContext;
import net.minecraft.util.Util;

/**
 * Oyun içi hesap menüsünün verisi. Hesap listesi ve Microsoft girişi launcher'dadır; burası yalnızca
 * köprü üzerinden ister ve seçilen hesabın oturumunu çalışan oyuna uygular.
 */
public final class Accounts {
	public record Entry(String id, String name, UUID uuid, boolean microsoft) {}

	private static volatile List<Entry> list = List.of();
	private static volatile String selected;
	private static volatile boolean reachable = true, busy, loginActive;
	private static volatile String error, loginCode, loginUrl;

	private Accounts() {}

	public static List<Entry> list() { return list; }

	public static boolean reachable() { return reachable; }

	public static boolean busy() { return busy || loginActive; }

	public static String error() { return error; }

	public static boolean loginActive() { return loginActive; }

	public static String loginCode() { return loginCode; }

	public static String loginUrl() { return loginUrl; }

	public static void clearError() { error = null; }

	private static UUID parseUuid(String text) {
		return text.contains("-") ? UUID.fromString(text) : UndashedUuid.fromStringLenient(text);
	}

	private static void read(JsonElement json) {
		JsonObject o = json.getAsJsonObject();
		List<Entry> out = new ArrayList<>();
		for (JsonElement e : o.getAsJsonArray("accounts")) {
			JsonObject a = e.getAsJsonObject();
			try {
				out.add(new Entry(a.get("id").getAsString(), a.get("name").getAsString(), parseUuid(a.get("uuid").getAsString()),
					"Microsoft".equals(a.get("kind").getAsString())));
			} catch (RuntimeException skip) {
				PClient.LOG.warn("Hesap kaydı atlandı: {}", a.has("name") ? a.get("name") : "?");
			}
		}
		list = List.copyOf(out);
		selected = o.get("selected").isJsonNull() ? null : o.get("selected").getAsString();
		reachable = true;
	}

	private static Void failed(Throwable t) {
		String message = Bridge.message(t);
		if (message == null) reachable = false;
		else error = message;
		busy = false;
		return null;
	}

	public static void refresh() {
		Bridge.get("/v1/accounts").thenAccept(Accounts::read).exceptionally(Accounts::failed);
	}

	/** Yerel hesap oluşturur ve oyunda ona geçer. */
	public static void addLocal(String name) {
		if (busy) return;
		busy = true;
		error = null;
		JsonObject body = new JsonObject();
		body.addProperty("name", name);
		Bridge.post("/v1/accounts/local", body, 15_000).thenCompose(json -> {
			read(json);
			return selectFuture(selected);
		}).exceptionally(Accounts::failed);
	}

	public static void select(String id) {
		if (busy || id == null) return;
		busy = true;
		error = null;
		selectFuture(id).exceptionally(Accounts::failed);
	}

	private static CompletableFuture<Void> selectFuture(String id) {
		JsonObject body = new JsonObject();
		body.addProperty("id", id);
		return Bridge.post("/v1/accounts/select", body, 45_000).thenAccept(json -> {
			JsonObject reply = json.getAsJsonObject();
			read(reply.get("state"));
			JsonObject session = reply.getAsJsonObject("session");
			Prepared prepared = prepare(session);
			Minecraft.getInstance().execute(() -> {
				apply(prepared);
				busy = false;
			});
		});
	}

	public static void startMicrosoft() {
		if (loginActive) return;
		loginActive = true;
		loginCode = null;
		error = null;
		Bridge.post("/v1/accounts/microsoft/start", null, 15_000).thenRun(Accounts::pollLogin).exceptionally(t -> {
			loginActive = false;
			return failed(t);
		});
	}

	public static void cancelMicrosoft() {
		Bridge.post("/v1/accounts/microsoft/cancel", null, 5_000).thenRun(() -> {}).exceptionally(Accounts::failed);
	}

	private static void pollLogin() {
		CompletableFuture.delayedExecutor(1, TimeUnit.SECONDS).execute(() -> Bridge.get("/v1/accounts/microsoft/status").thenAccept(json -> {
			JsonObject o = json.getAsJsonObject();
			if (!o.get("code").isJsonNull()) loginCode = o.get("code").getAsString();
			loginUrl = o.get("url").getAsString();
			if (o.get("active").getAsBoolean()) {
				pollLogin();
				return;
			}
			loginActive = false;
			loginCode = null;
			if (!o.get("error").isJsonNull()) {
				error = o.get("error").getAsString();
				return;
			}
			String name = o.get("done").isJsonNull() ? null : o.get("done").getAsString();
			Bridge.get("/v1/accounts").thenAccept(list -> {
				read(list);
				Accounts.list.stream().filter(a -> a.microsoft && a.name.equals(name)).findFirst().ifPresent(a -> select(a.id));
			}).exceptionally(Accounts::failed);
		}).exceptionally(t -> {
			loginActive = false;
			return failed(t);
		}));
	}

	private record Prepared(User user, UserApiService api, boolean local) {}

	/** Ağ gerektiren hazırlık arka planda yapılır; oyun durumu yalnızca oyun iş parçacığında değişir. */
	private static Prepared prepare(JsonObject session) {
		Minecraft mc = Minecraft.getInstance();
		String token = session.get("access_token").getAsString();
		String xuid = session.get("xuid").getAsString();
		boolean local = "Local".equals(session.get("kind").getAsString());
		User user = new User(session.get("name").getAsString(), parseUuid(session.get("uuid").getAsString()), token,
			xuid.isEmpty() ? Optional.empty() : Optional.of(xuid), mc.getUser().getClientId());
		UserApiService api = UserApiService.OFFLINE;
		if (!local) {
			try {
				api = MinecraftServicesDiscoveryService.create(mc.getProxy()).createUserApiService(token);
			} catch (RuntimeException e) {
				// Sohbet imzası olmadan da oyuna girilebilir; oturumun kendisi geçerlidir.
				PClient.LOG.warn("Hesap servisleri başlatılamadı", e);
			}
		}
		return new Prepared(user, api, local);
	}

	private static void apply(Prepared p) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.level != null) {
			error = null;
			return;
		}
		MinecraftSessionAccessor a = (MinecraftSessionAccessor) mc;
		UserApiService api = p.api;
		User user = p.user;
		a.pclient$setUser(user);
		a.pclient$setUserApiService(api);
		a.pclient$setProfileFuture(CompletableFuture.supplyAsync(
			() -> mc.services().sessionService().fetchProfile(user.getProfileId(), true), Util.nonCriticalIoPool()));
		a.pclient$setUserPropertiesFuture(CompletableFuture.supplyAsync(() -> {
			try {
				return api.fetchProperties();
			} catch (Exception e) {
				PClient.LOG.warn("Hesap özellikleri alınamadı", e);
				return UserApiService.OFFLINE_PROPERTIES;
			}
		}, Util.nonCriticalIoPool()));
		a.pclient$setProfileKeyPairManager(p.local ? ProfileKeyPairManager.EMPTY_KEY_MANAGER
			: ProfileKeyPairManager.create(api, user, mc.gameDirectory.toPath()));
		a.pclient$setReportingContext(ReportingContext.create(ReportEnvironment.local(), api));
		PClient.LOG.info("PClient hesabı değişti: {}", user.getName());
	}
}
