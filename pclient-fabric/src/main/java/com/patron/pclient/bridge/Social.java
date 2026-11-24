package com.patron.pclient.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.patron.pclient.L;
import com.patron.pclient.PClient;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.minecraft.client.Minecraft;

/**
 * Arkadaşlar ve mesajlar (oyun içi). Veriler PatronLauncher sitesindedir; oyun launcher köprüsü üzerinden ister
 * ({@code /v1/social/api}) ve launcher'ın açık tuttuğu anlık bağlantının olaylarını uzun sorguyla dinler
 * ({@code /v1/social/events}). Site ve launcher'la aynı kutu: bir yerde okunan her yerde okunur.
 */
public final class Social {
	public record Presence(boolean online, String version, String server) {
		public boolean playing() { return version != null || server != null; }
	}
	public record Person(String id, String username, String display, Presence presence) {}
	public record Message(long id, String from, String body, long at) {
		public boolean mine() { return "me".equals(from); }
	}
	public record Chat(String username, String display, String preview, int unread) {}

	private static volatile List<Person> friends = List.of(), incoming = List.of(), outgoing = List.of(), blocked = List.of();
	private static volatile List<Chat> chats = List.of();
	private static volatile List<Message> messages = List.of();
	private static volatile String active, activeDisplay, note;
	private static volatile boolean canSend, signedIn = true, live, started;
	private static volatile String dmPolicy = "friends", presencePolicy = "friends", friendPolicy = "everyone";
	private static volatile long seq;
	/** Arkadaşlar ekranı açıkken gelen mesajlar sohbete ayrıca yazılmaz. */
	public static volatile boolean screenOpen;

	private Social() {}

	public static List<Person> friends() { return friends; }
	public static List<Person> incoming() { return incoming; }
	public static List<Person> outgoing() { return outgoing; }
	public static List<Person> blocked() { return blocked; }
	public static List<Chat> chats() { return chats; }
	public static List<Message> messages() { return messages; }
	public static String active() { return active; }
	public static String activeDisplay() { return activeDisplay; }
	public static boolean canSend() { return canSend; }
	public static boolean signedIn() { return signedIn; }
	public static boolean live() { return live; }
	public static String note() { return note; }
	public static void clearNote() { note = null; }
	public static String dmPolicy() { return dmPolicy; }
	public static String presencePolicy() { return presencePolicy; }
	public static String friendPolicy() { return friendPolicy; }
	public static int unread() { return chats.stream().mapToInt(Chat::unread).sum(); }

	private static String str(JsonObject o, String key) {
		JsonElement e = o.get(key);
		return e == null || e.isJsonNull() ? null : e.getAsString();
	}

	/** Sitenin sosyal ucuna launcher üzerinden istek. */
	private static CompletableFuture<JsonElement> call(String method, String path, JsonObject body) {
		JsonObject req = new JsonObject();
		req.addProperty("method", method);
		req.addProperty("path", path);
		if (body != null) req.add("body", body);
		return Bridge.post("/v1/social/api", req, 15_000).whenComplete((r, t) -> {
			if (t == null) {
				signedIn = true;
				return;
			}
			String m = Bridge.message(t);
			if (m != null && m.contains("NOT_SIGNED_IN")) signedIn = false;
		});
	}

	private static String errorText(Throwable t) {
		String m = Bridge.message(t);
		if (m == null) return L.t("account.launcher");
		for (String code : new String[] { "NOT_FOUND", "SELF", "BLOCKED", "ALREADY_FRIENDS", "REQUESTS_CLOSED", "DM_CLOSED", "RATE_LIMITED" })
			if (m.contains(code)) return L.t("friends.err." + code);
		return L.t("friends.err.generic");
	}

	private static Presence presence(JsonElement e) {
		if (e == null || e.isJsonNull()) return null;
		JsonObject p = e.getAsJsonObject();
		JsonElement playing = p.get("playing");
		if (playing != null && !playing.isJsonNull()) {
			JsonObject pl = playing.getAsJsonObject();
			return new Presence(true, str(pl, "version"), str(pl, "server"));
		}
		return new Presence(p.has("online") && p.get("online").getAsBoolean(), null, null);
	}

	private static List<Person> people(JsonArray arr, boolean withPresence) {
		List<Person> out = new ArrayList<>();
		for (JsonElement e : arr) {
			JsonObject o = e.getAsJsonObject();
			out.add(new Person(str(o, "id"), str(o, "username"), str(o, "displayUsername"), withPresence ? presence(o.get("presence")) : null));
		}
		return List.copyOf(out);
	}

	public static void refreshFriends() {
		call("GET", "/api/social/friends", null).thenAccept(json -> {
			JsonObject o = json.getAsJsonObject();
			friends = people(o.getAsJsonArray("friends"), true);
			incoming = people(o.getAsJsonArray("incoming"), false);
			outgoing = people(o.getAsJsonArray("outgoing"), false);
			blocked = people(o.getAsJsonArray("blocked"), false);
		}).exceptionally(t -> null);
	}

	public static void refreshChats() {
		call("GET", "/api/social/conversations", null).thenAccept(json -> {
			List<Chat> out = new ArrayList<>();
			for (JsonElement e : json.getAsJsonObject().getAsJsonArray("conversations")) {
				JsonObject c = e.getAsJsonObject();
				JsonElement last = c.get("last");
				String preview = "";
				if (last != null && !last.isJsonNull()) {
					JsonObject l = last.getAsJsonObject();
					preview = ("me".equals(str(l, "from")) ? L.t("friends.you") + ": " : "") + str(l, "body");
				}
				out.add(new Chat(str(c, "username"), str(c, "displayUsername"), preview, c.get("unread").getAsInt()));
			}
			chats = List.copyOf(out);
		}).exceptionally(t -> null);
	}

	public static void refreshPrivacy() {
		call("GET", "/api/social/privacy", null).thenAccept(json -> {
			JsonObject o = json.getAsJsonObject();
			dmPolicy = str(o, "dmPolicy");
			presencePolicy = str(o, "presencePolicy");
			friendPolicy = str(o, "friendPolicy");
		}).exceptionally(t -> null);
	}

	public static void refreshAll() {
		refreshFriends();
		refreshChats();
		refreshPrivacy();
	}

	/** Sohbetten çıkıp konuşma listesine döner. */
	public static void close() {
		active = null;
		activeDisplay = null;
		messages = List.of();
	}

	public static void open(String username) {
		active = username;
		activeDisplay = username;
		messages = List.of();
		call("GET", "/api/social/messages?with=" + username, null).thenAccept(json -> {
			JsonObject o = json.getAsJsonObject();
			List<Message> out = new ArrayList<>();
			for (JsonElement e : o.getAsJsonArray("messages")) out.add(message(e.getAsJsonObject()));
			messages = List.copyOf(out);
			canSend = o.get("canSend").getAsBoolean();
			activeDisplay = str(o.getAsJsonObject("with"), "displayUsername");
			markRead(username);
		}).exceptionally(t -> {
			note = errorText(t);
			return null;
		});
	}

	private static void markRead(String username) {
		JsonObject b = new JsonObject();
		b.addProperty("with", username);
		call("POST", "/api/social/read", b).thenRun(Social::refreshChats).exceptionally(t -> null);
	}

	private static Message message(JsonObject m) {
		return new Message(m.get("id").getAsLong(), str(m, "from"), str(m, "body"), m.get("at").getAsLong());
	}

	public static void send(String body) {
		String to = active;
		if (to == null || body.isBlank()) return;
		JsonObject b = new JsonObject();
		b.addProperty("to", to);
		b.addProperty("body", body);
		call("POST", "/api/social/messages", b).thenAccept(json -> addMessage(to, message(json.getAsJsonObject().getAsJsonObject("message"))))
			.exceptionally(t -> {
				note = errorText(t);
				return null;
			});
	}

	private static synchronized void addMessage(String with, Message m) {
		if (!with.equals(active) || messages.stream().anyMatch(x -> x.id() == m.id())) return;
		List<Message> next = new ArrayList<>(messages);
		next.add(m);
		messages = List.copyOf(next);
	}

	/** request | accept | decline | cancel | remove | block | unblock */
	public static void friendAction(String action, String username) {
		note = null;
		JsonObject b = new JsonObject();
		b.addProperty("action", action);
		b.addProperty("username", username);
		call("POST", "/api/social/friends", b).thenAccept(json -> {
			if (("block".equals(action) || "remove".equals(action)) && username.equals(active)) close();
			if ("request".equals(action))
				note = L.t("friends".equals(str(json.getAsJsonObject(), "result")) ? "friends.becameFriends" : "friends.sent");
			refreshFriends();
		}).exceptionally(t -> {
			note = errorText(t);
			return null;
		});
	}

	public static void setPrivacy(String key, String value) {
		JsonObject b = new JsonObject();
		b.addProperty(key, value);
		call("POST", "/api/social/privacy", b).thenRun(Social::refreshPrivacy).exceptionally(t -> {
			note = errorText(t);
			return null;
		});
	}

	// --- Anlık olaylar ---

	/** Oyun açılınca bir kez başlar: launcher'ın olay kuyruğunu uzun sorguyla dinler. */
	public static void start() {
		if (started) return;
		started = true;
		Thread t = new Thread(Social::loop, "PClient-Social");
		t.setDaemon(true);
		t.start();
	}

	private static void loop() {
		boolean first = true;
		while (true) {
			try {
				JsonObject r = Bridge.get("/v1/social/events?since=" + seq).get(16, TimeUnit.SECONDS).getAsJsonObject();
				live = r.get("connected").getAsBoolean();
				long next = r.get("seq").getAsLong();
				if (first) refreshAll();
				else for (JsonElement e : r.getAsJsonArray("events")) handle(e.getAsJsonObject());
				first = false;
				seq = next;
			} catch (InterruptedException stop) {
				return;
			} catch (Exception e) {
				live = false;
				try {
					Thread.sleep(15_000);
				} catch (InterruptedException stop) {
					return;
				}
			}
		}
	}

	private static void handle(JsonObject ev) {
		String type = str(ev, "type");
		if (type == null) return;
		switch (type) {
			case "message" -> {
				String with = str(ev, "with");
				if (with == null || !ev.has("message")) return;
				Message m = message(ev.getAsJsonObject("message"));
				if (with.equals(active)) {
					addMessage(with, m);
					if (!m.mine() && screenOpen) markRead(with);
				}
				refreshChats();
				if (!m.mine() && !screenOpen) notifyChat(with, m.body());
			}
			case "read" -> refreshChats();
			case "friends", "presence" -> refreshFriends();
			case "privacy" -> refreshPrivacy();
			case "connection" -> {
				if (ev.has("online") && ev.get("online").getAsBoolean()) refreshAll();
			}
			default -> {}
		}
	}

	/** Gelen mesaj sağ üstte bildirim kartı olarak gösterilir (sohbete yazılmaz). Ayarlardan kapatılabilir. */
	private static void notifyChat(String from, String body) {
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> {
			try {
				com.patron.pclient.gui.MessageToasts.show(from, body);
			} catch (RuntimeException e) {
				PClient.LOG.warn("Mesaj bildirimi gösterilemedi: {}", e.toString());
			}
		});
	}
}
