package com.patron.pclient.modules;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.patron.pclient.PClient;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.world.level.storage.LevelResource;

/**
 * Yol noktası kaydı: config/pclient/waypoints.json. Noktalar dünyaya (tek oyunculu klasör adı veya
 * sunucu adresi) ve boyuta göre ayrılır.
 */
public final class Waypoints {
	public static final int[] COLORS = {0xFFFF4D5E, 0xFF38BDF8, 0xFF4ADE80, 0xFFFFD43B, 0xFFA78BFA, 0xFFFF8A2A, 0xFFF472B6, 0xFFFFFFFF};
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static Map<String, List<Waypoint>> all;

	private Waypoints() {}

	public static final class Waypoint {
		public String name;
		public int x, y, z, color;
		public String dimension;
		public boolean visible = true;
		/** Ölüm noktası: yeni ölümde yerine yenisi yazılır. */
		public boolean death;

		public Waypoint(String name, int x, int y, int z, String dimension, int color) {
			this.name = name;
			this.x = x;
			this.y = y;
			this.z = z;
			this.dimension = dimension;
			this.color = color;
		}

		public double distanceTo(double px, double py, double pz) {
			double dx = x + 0.5 - px, dy = y + 0.5 - py, dz = z + 0.5 - pz;
			return Math.sqrt(dx * dx + dy * dy + dz * dz);
		}
	}

	private static Path file() { return FabricLoader.getInstance().getConfigDir().resolve("pclient").resolve("waypoints.json"); }

	/** Şu anki dünyanın anahtarı; dünyada değilken null. */
	public static String worldKey() {
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null) return null;
		if (mc.getSingleplayerServer() != null) {
			Path root = mc.getSingleplayerServer().getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize();
			return "sp:" + (root.getFileName() == null ? "world" : root.getFileName().toString());
		}
		if (mc.getCurrentServer() != null) return "mp:" + mc.getCurrentServer().ip.toLowerCase(Locale.ROOT);
		return null;
	}

	public static String dimension() {
		var level = Minecraft.getInstance().level;
		return level == null ? "" : level.dimension().identifier().toString();
	}

	/** Şu anki dünyanın tüm noktaları (değiştirilebilir liste). */
	public static List<Waypoint> current() {
		String key = worldKey();
		if (key == null) return new ArrayList<>();
		return load().computeIfAbsent(key, k -> new ArrayList<>());
	}

	public static Waypoint addHere(String name, int color, boolean death) {
		var p = Minecraft.getInstance().player;
		if (p == null || worldKey() == null) return null;
		List<Waypoint> list = current();
		if (death) list.removeIf(w -> w.death);
		var pos = p.blockPosition();
		Waypoint w = new Waypoint(name, pos.getX(), pos.getY(), pos.getZ(), dimension(), color);
		w.death = death;
		list.add(w);
		save();
		return w;
	}

	public static int nextColor() { return COLORS[current().size() % COLORS.length]; }

	private static Map<String, List<Waypoint>> load() {
		if (all != null) return all;
		all = new LinkedHashMap<>();
		Path path = file();
		if (!Files.isRegularFile(path)) return all;
		try {
			JsonObject root = JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
			for (Map.Entry<String, JsonElement> world : root.entrySet()) {
				if (!world.getValue().isJsonArray()) continue;
				List<Waypoint> list = new ArrayList<>();
				for (JsonElement el : world.getValue().getAsJsonArray()) {
					if (!(el instanceof JsonObject o)) continue;
					try {
						Waypoint w = new Waypoint(o.get("name").getAsString(), o.get("x").getAsInt(), o.get("y").getAsInt(), o.get("z").getAsInt(),
							o.get("dimension").getAsString(), (int) Long.parseLong(o.get("color").getAsString().substring(1), 16));
						w.visible = !o.has("visible") || o.get("visible").getAsBoolean();
						w.death = o.has("death") && o.get("death").getAsBoolean();
						list.add(w);
					} catch (RuntimeException ignored) {
						// Bozuk tek bir kayıt diğerlerini etkilemesin.
					}
				}
				all.put(world.getKey(), list);
			}
		} catch (RuntimeException | IOException e) {
			PClient.LOG.warn("waypoints.json okunamadı", e);
		}
		return all;
	}

	public static void save() {
		if (all == null) return;
		JsonObject root = new JsonObject();
		for (Map.Entry<String, List<Waypoint>> world : all.entrySet()) {
			if (world.getValue().isEmpty()) continue;
			JsonArray arr = new JsonArray();
			for (Waypoint w : world.getValue()) {
				JsonObject o = new JsonObject();
				o.addProperty("name", w.name);
				o.addProperty("x", w.x);
				o.addProperty("y", w.y);
				o.addProperty("z", w.z);
				o.addProperty("dimension", w.dimension);
				o.addProperty("color", String.format("#%08X", w.color));
				o.addProperty("visible", w.visible);
				if (w.death) o.addProperty("death", true);
				arr.add(o);
			}
			root.add(world.getKey(), arr);
		}
		Path path = file();
		try {
			Files.createDirectories(path.getParent());
			Path tmp = path.resolveSibling("waypoints.json.tmp");
			Files.writeString(tmp, GSON.toJson(root), StandardCharsets.UTF_8);
			Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
		} catch (IOException e) {
			PClient.LOG.error("waypoints.json kaydedilemedi", e);
		}
	}
}
