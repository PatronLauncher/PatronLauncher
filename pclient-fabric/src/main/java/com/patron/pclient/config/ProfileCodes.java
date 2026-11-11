package com.patron.pclient.config;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.setting.Setting;
import com.patron.pclient.module.setting.TextSetting;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * Paylaşılabilir profil kodları ve hazır profiller. Kod yalnızca varsayılandan farklı değerleri taşır.
 * Metin ayarları (otomatik mesajlar) koda girmez ve koddan alınmaz: başkasının profili oyuncunun
 * ağzından sohbete ya da komut satırına bir şey yazdıramaz.
 */
public final class ProfileCodes {
	public static final String PREFIX = "PCLIENT1-";
	private static final int MAX_JSON = 256 * 1024;

	public record Preset(String name, String icon, List<String> modules) {}

	public static final List<Preset> PRESETS = List.of(
		new Preset("PvP", "sword", List.of("keystrokes", "cps", "fps", "ping", "armor", "effects", "combo", "reach", "target", "crosshair", "sprint", "hitcolor", "lowfire", "hurtcam", "fpsboost")),
		new Preset("UHC", "food", List.of("coords", "direction", "fps", "ping", "armor", "effects", "saturation", "lowhealth", "durawarn", "items", "minimap", "waypoints", "sprint", "zoom")),
		new Preset("SkyBlock", "bag", List.of("coords", "fps", "ping", "clock", "items", "helditem", "players", "chat", "chatplus", "scoreboard", "waypoints", "zoom", "sprint")),
		new Preset("Survival", "house", List.of("coords", "direction", "minimap", "waypoints", "fps", "day", "worldtime", "armor", "effects", "durawarn", "zoom", "fullbright", "sprint")));

	private ProfileCodes() {}

	public static String iconOf(String profile) {
		for (Preset p : PRESETS) if (p.name.equals(profile)) return p.icon;
		return "user";
	}

	/** Bir profilin modül kaydını en kısa koda çevirir. */
	public static String encode(String name, JsonObject modules) {
		JsonObject out = new JsonObject();
		for (Module m : ModuleManager.all()) {
			if (!m.isAvailable() || !(modules.get(m.id) instanceof JsonObject o)) continue;
			JsonObject d = new JsonObject();
			if (o.get("enabled") instanceof JsonElement e && e.isJsonPrimitive() && e.getAsBoolean() != m.enabledByDefault()) d.add("enabled", e);
			if (m instanceof HudModule h) {
				if (o.has("x") && Math.abs(o.get("x").getAsDouble() - h.defaultX()) > 1e-4) d.addProperty("x", round(o.get("x").getAsDouble()));
				if (o.has("y") && Math.abs(o.get("y").getAsDouble() - h.defaultY()) > 1e-4) d.addProperty("y", round(o.get("y").getAsDouble()));
			}
			if (o.get("settings") instanceof JsonObject saved) {
				JsonObject settings = new JsonObject();
				for (Setting<?> s : m.settings())
					if (!(s instanceof TextSetting) && saved.has(s.id) && !saved.get(s.id).equals(s.defaultJson())) settings.add(s.id, saved.get(s.id));
				if (settings.size() > 0) d.add("settings", settings);
			}
			if (d.size() > 0) out.add(m.id, d);
		}
		JsonObject root = new JsonObject();
		root.addProperty("name", name);
		root.add("modules", out);
		try {
			ByteArrayOutputStream bytes = new ByteArrayOutputStream();
			try (GZIPOutputStream gz = new GZIPOutputStream(bytes)) {
				gz.write(root.toString().getBytes(StandardCharsets.UTF_8));
			}
			return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.toByteArray());
		} catch (IOException e) {
			throw new IllegalStateException(e);
		}
	}

	private static double round(double v) { return Math.round(v * 10000) / 10000.0; }

	public record Decoded(String name, JsonObject modules) {}

	/** Kodu çözer ve yalnızca bilinen modül ve ayarları bırakır; geçersizse null. */
	public static Decoded decode(String text) {
		String code = text == null ? "" : text.strip();
		if (!code.startsWith(PREFIX)) return null;
		try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(Base64.getUrlDecoder().decode(code.substring(PREFIX.length()))))) {
			byte[] raw = in.readNBytes(MAX_JSON + 1);
			if (raw.length > MAX_JSON) return null;
			JsonObject root = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
			if (!(root.get("modules") instanceof JsonObject modules) || !root.get("name").isJsonPrimitive()) return null;
			JsonObject clean = new JsonObject();
			for (Module m : ModuleManager.all()) {
				if (!m.isAvailable() || !(modules.get(m.id) instanceof JsonObject o)) continue;
				JsonObject d = new JsonObject();
				for (String key : List.of("enabled", "x", "y")) if (o.has(key)) d.add(key, o.get(key));
				if (o.get("settings") instanceof JsonObject saved) {
					JsonObject settings = new JsonObject();
					for (Setting<?> s : m.settings()) if (!(s instanceof TextSetting) && saved.has(s.id)) settings.add(s.id, saved.get(s.id));
					d.add("settings", settings);
				}
				clean.add(m.id, d);
			}
			return new Decoded(root.get("name").getAsString(), clean);
		} catch (IOException | RuntimeException e) {
			return null;
		}
	}
}
