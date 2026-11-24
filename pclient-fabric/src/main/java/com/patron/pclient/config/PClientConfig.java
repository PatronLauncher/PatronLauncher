package com.patron.pclient.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.PClient;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.setting.Setting;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.fabricmc.loader.api.FabricLoader;

/**
 * config/pclient.json: genel ayarlar ve etkin profil. Modül durumları profillere göre
 * config/pclient/profiles/<ad>.json dosyalarında tutulur. Bozuk veya eksik alanlar varsayılana döner;
 * dosya bozuksa yedeği alınıp varsayılanlarla devam edilir.
 */
public final class PClientConfig {
	public static final List<String> ACCENTS = List.of("red", "ice", "emerald", "gold", "violet");
	public static final String DEFAULT_PROFILE = "default";
	public static final int[] BACKGROUND_FPS = {5, 10, 15, 30, 60};
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final PClientConfig INSTANCE = new PClientConfig();

	public int menuKey = InputConstants.KEY_RSHIFT;
	/** Arkadaşlar ve mesajlar ekranı (oyun içi). */
	public int friendsKey = InputConstants.KEY_U;
	public boolean blur = true;
	public String accent = "red";
	public boolean openSound = true;
	/** Arkadaş mesajı bildirimi (sağ üst) ve sesi. */
	public boolean messageToasts = true, messageSound = true;
	/** Pencere arka plandayken kare hızı sınırı. */
	public boolean backgroundFpsLimit = true;
	public int backgroundFps = 30;
	/** Ana menüdeki Sodium ve Lithium önerisi kapatıldı. */
	public boolean hidePerformanceNotice = false;
	public static final String DEFAULT_MENU_THEME = "crimson";
	public static final List<String> MODULE_VIEWS = List.of("list", "grid"), MODULE_SORTS = List.of("default", "az", "za", "recent");
	/** Ana menü arka planı. */
	public String menuTheme = DEFAULT_MENU_THEME;
	/** Ana menü temalarındaki parçacık ve ışık efektleri. */
	public boolean animatedThemes = true;
	private int presetsVersion = 0;
	public String modulesView = "list";
	public String modulesSort = "default";
	/** Modül kimliği → oyuncunun son değiştirdiği an (ms); "son değiştirilen" sıralaması için. */
	private final Map<String, Long> touched = new HashMap<>();
	private String profile = DEFAULT_PROFILE;

	private PClientConfig() {}

	public static PClientConfig get() { return INSTANCE; }

	private static Path file() { return FabricLoader.getInstance().getConfigDir().resolve("pclient.json"); }

	private static Path profilesDir() { return FabricLoader.getInstance().getConfigDir().resolve("pclient").resolve("profiles"); }

	private static Path profileFile(String name) { return profilesDir().resolve(name + ".json"); }

	public static void load() {
		Path path = file();
		if (!Files.exists(path)) {
			loadProfile(DEFAULT_PROFILE, null);
			return;
		}
		try {
			JsonObject root = JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
			PClientConfig c = INSTANCE;
			if (num(root, "menuKey")) c.menuKey = root.get("menuKey").getAsInt();
			if (num(root, "friendsKey")) c.friendsKey = root.get("friendsKey").getAsInt();
			if (bool(root, "blur")) c.blur = root.get("blur").getAsBoolean();
			if (bool(root, "openSound")) c.openSound = root.get("openSound").getAsBoolean();
			if (bool(root, "messageToasts")) c.messageToasts = root.get("messageToasts").getAsBoolean();
			if (bool(root, "messageSound")) c.messageSound = root.get("messageSound").getAsBoolean();
			if (bool(root, "hidePerformanceNotice")) c.hidePerformanceNotice = root.get("hidePerformanceNotice").getAsBoolean();
			if (bool(root, "backgroundFpsLimit")) c.backgroundFpsLimit = root.get("backgroundFpsLimit").getAsBoolean();
			if (num(root, "backgroundFps")) c.backgroundFps = Math.max(5, Math.min(120, root.get("backgroundFps").getAsInt()));
			if (root.get("accent") instanceof JsonElement a && a.isJsonPrimitive() && ACCENTS.contains(a.getAsString()))
				c.accent = a.getAsString();
			c.menuTheme = choice(root, "menuTheme", com.patron.pclient.gui.MenuThemes.ALL, DEFAULT_MENU_THEME);
			if (bool(root, "animatedThemes")) c.animatedThemes = root.get("animatedThemes").getAsBoolean();
			if (num(root, "presetsVersion")) c.presetsVersion = root.get("presetsVersion").getAsInt();
			c.modulesView = choice(root, "modulesView", MODULE_VIEWS, "list");
			c.modulesSort = choice(root, "modulesSort", MODULE_SORTS, "default");
			if (root.get("touched") instanceof JsonObject t)
				for (var e : t.entrySet()) if (num(t, e.getKey())) c.touched.put(e.getKey(), e.getValue().getAsLong());
			String name = root.get("profile") instanceof JsonElement p && p.isJsonPrimitive() && validName(p.getAsString())
				? p.getAsString() : DEFAULT_PROFILE;
			// Eski sürüm: modüller doğrudan pclient.json içindeydi; profil dosyası yoksa oradan alınır.
			loadProfile(name, root.get("modules") instanceof JsonObject legacy ? legacy : null);
		} catch (RuntimeException | IOException e) {
			PClient.LOG.warn("pclient.json okunamadı, varsayılanlar kullanılıyor", e);
			try {
				Files.copy(path, path.resolveSibling("pclient.json.bozuk"), StandardCopyOption.REPLACE_EXISTING);
			} catch (IOException ignored) {}
		}
	}

	private static void loadProfile(String name, JsonObject fallback) {
		INSTANCE.profile = name;
		JsonObject mods = fallback;
		Path pf = profileFile(name);
		if (Files.isRegularFile(pf)) {
			try {
				JsonObject root = JsonParser.parseString(Files.readString(pf, StandardCharsets.UTF_8)).getAsJsonObject();
				if (root.get("modules") instanceof JsonObject m) mods = m;
			} catch (RuntimeException | IOException e) {
				PClient.LOG.warn("PClient profili okunamadı: {}", name, e);
			}
		}
		if (mods != null) readModules(mods);
	}

	private static void readModules(JsonObject mods) {
		for (Module m : ModuleManager.all()) {
			if (!(mods.get(m.id) instanceof JsonObject o)) continue;
			if (o.get("settings") instanceof JsonObject s)
				for (Setting<?> setting : m.settings()) setting.load(s.get(setting.id));
			if (m instanceof HudModule h) {
				if (num(o, "x")) h.fx = clamp(o.get("x").getAsDouble());
				if (num(o, "y")) h.fy = clamp(o.get("y").getAsDouble());
			}
			if (bool(o, "enabled")) m.setEnabled(o.get("enabled").getAsBoolean());
		}
	}

	private static JsonObject writeModules() {
		JsonObject mods = new JsonObject();
		for (Module m : ModuleManager.all()) {
			if (!m.isAvailable()) continue;
			JsonObject o = new JsonObject();
			o.addProperty("enabled", m.isEnabled());
			if (m instanceof HudModule h) {
				o.addProperty("x", h.fx);
				o.addProperty("y", h.fy);
			}
			JsonObject s = new JsonObject();
			for (Setting<?> setting : m.settings()) s.add(setting.id, setting.save());
			o.add("settings", s);
			mods.add(m.id, o);
		}
		return mods;
	}

	public static void save() {
		JsonObject root = new JsonObject();
		root.addProperty("version", 2);
		root.addProperty("menuKey", INSTANCE.menuKey);
		root.addProperty("messageToasts", INSTANCE.messageToasts);
		root.addProperty("messageSound", INSTANCE.messageSound);
		root.addProperty("friendsKey", INSTANCE.friendsKey);
		root.addProperty("blur", INSTANCE.blur);
		root.addProperty("openSound", INSTANCE.openSound);
		root.addProperty("hidePerformanceNotice", INSTANCE.hidePerformanceNotice);
		root.addProperty("accent", INSTANCE.accent);
		root.addProperty("backgroundFpsLimit", INSTANCE.backgroundFpsLimit);
		root.addProperty("backgroundFps", INSTANCE.backgroundFps);
		root.addProperty("profile", INSTANCE.profile);
		root.addProperty("menuTheme", INSTANCE.menuTheme);
		root.addProperty("animatedThemes", INSTANCE.animatedThemes);
		root.addProperty("presetsVersion", INSTANCE.presetsVersion);
		root.addProperty("modulesView", INSTANCE.modulesView);
		root.addProperty("modulesSort", INSTANCE.modulesSort);
		JsonObject touched = new JsonObject();
		INSTANCE.touched.forEach(touched::addProperty);
		root.add("touched", touched);
		write(file(), root);
		JsonObject profile = new JsonObject();
		profile.add("modules", writeModules());
		write(profileFile(INSTANCE.profile), profile);
	}

	private static void write(Path path, JsonObject json) {
		try {
			Files.createDirectories(path.getParent());
			Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
			Files.writeString(tmp, GSON.toJson(json), StandardCharsets.UTF_8);
			Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
		} catch (IOException e) {
			PClient.LOG.error("{} kaydedilemedi", path.getFileName(), e);
		}
	}

	// ---------------- Profiller ----------------

	public String profile() { return profile; }

	/** Oyuncu bir modülle etkileşime girdi. */
	public static void touch(String moduleId) { INSTANCE.touched.put(moduleId, System.currentTimeMillis()); }

	public long touchedAt(String moduleId) { return touched.getOrDefault(moduleId, 0L); }

	private static String choice(JsonObject o, String key, List<String> allowed, String fallback) {
		return o.get(key) instanceof JsonElement e && e.isJsonPrimitive() && allowed.contains(e.getAsString()) ? e.getAsString() : fallback;
	}

	/** Profil adları: önce varsayılan, sonra diğerleri alfabetik. */
	public static List<String> profiles() {
		List<String> out = new ArrayList<>();
		Path dir = profilesDir();
		if (Files.isDirectory(dir)) {
			try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, "*.json")) {
				for (Path f : files) {
					String n = f.getFileName().toString();
					n = n.substring(0, n.length() - 5);
					if (validName(n) && !n.equals(DEFAULT_PROFILE)) out.add(n);
				}
			} catch (IOException e) {
				PClient.LOG.warn("PClient profilleri listelenemedi", e);
			}
		}
		out.sort(String.CASE_INSENSITIVE_ORDER);
		if (!INSTANCE.profile.equals(DEFAULT_PROFILE) && !out.contains(INSTANCE.profile)) out.add(INSTANCE.profile);
		out.add(0, DEFAULT_PROFILE);
		return out;
	}

	/** Dosya adı olarak güvenli, kısa profil adı. */
	public static boolean validName(String n) {
		return n != null && !n.isBlank() && n.length() <= 24 && n.strip().equals(n)
			&& n.codePoints().allMatch(c -> Character.isLetterOrDigit(c) || c == ' ' || c == '-' || c == '_')
			&& !n.toLowerCase(Locale.ROOT).matches("con|prn|aux|nul|com\\d|lpt\\d");
	}

	/** Mevcut ayarları kaydedip başka bir profile geçer. */
	public static void switchProfile(String name) {
		if (name.equals(INSTANCE.profile) || !validName(name)) return;
		save();
		ModuleManager.all().forEach(Module::resetToDefaults);
		loadProfile(name, null);
		save();
	}

	/** Mevcut ayarların kopyasıyla yeni profil oluşturur ve ona geçer. */
	public static boolean createProfile(String name) {
		if (!validName(name) || profiles().stream().anyMatch(p -> p.equalsIgnoreCase(name))) return false;
		save();
		INSTANCE.profile = name;
		save();
		return true;
	}

	/** Hazır profilleri bir kez ekler; oyuncu silerse geri getirilmez, aynı adlı profiline dokunulmaz. */
	public static void installPresets() {
		if (INSTANCE.presetsVersion >= 1) return;
		for (ProfileCodes.Preset preset : ProfileCodes.PRESETS) {
			if (Files.exists(profileFile(preset.name()))) continue;
			JsonObject modules = new JsonObject();
			for (Module m : ModuleManager.all()) {
				if (!m.isAvailable()) continue;
				JsonObject o = new JsonObject();
				o.addProperty("enabled", preset.modules().contains(m.id));
				modules.add(m.id, o);
			}
			JsonObject root = new JsonObject();
			root.add("modules", modules);
			write(profileFile(preset.name()), root);
		}
		INSTANCE.presetsVersion = 1;
		save();
	}

	/** Profilin paylaşım kodu; etkin profilin son hali önce kaydedilir. */
	public static String exportCode(String name) {
		save();
		try {
			JsonObject root = JsonParser.parseString(Files.readString(profileFile(name), StandardCharsets.UTF_8)).getAsJsonObject();
			return ProfileCodes.encode(name, root.getAsJsonObject("modules"));
		} catch (IOException | RuntimeException e) {
			PClient.LOG.warn("Profil kodu oluşturulamadı: {}", name, e);
			return null;
		}
	}

	/** Kodu yeni bir profil olarak ekleyip ona geçer; kod geçersizse null döner. */
	public static String importCode(String code) {
		ProfileCodes.Decoded decoded = ProfileCodes.decode(code);
		if (decoded == null) return null;
		String base = decoded.name().strip();
		if (!validName(base) || base.equals(DEFAULT_PROFILE)) base = "Profil";
		String name = base;
		for (int i = 2; hasProfile(name); i++) {
			String suffix = " " + i;
			name = base.substring(0, Math.min(base.length(), 24 - suffix.length())).strip() + suffix;
		}
		JsonObject root = new JsonObject();
		root.add("modules", decoded.modules());
		write(profileFile(name), root);
		switchProfile(name);
		return name;
	}

	private static boolean hasProfile(String name) {
		return profiles().stream().anyMatch(p -> p.equalsIgnoreCase(name));
	}

	public static void deleteProfile(String name) {
		if (name.equals(DEFAULT_PROFILE) || !validName(name)) return;
		if (name.equals(INSTANCE.profile)) switchProfile(DEFAULT_PROFILE);
		try {
			Files.deleteIfExists(profileFile(name));
		} catch (IOException e) {
			PClient.LOG.warn("PClient profili silinemedi: {}", name, e);
		}
	}

	private static boolean num(JsonObject o, String k) {
		JsonElement e = o.get(k);
		return e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isNumber();
	}

	private static boolean bool(JsonObject o, String k) {
		JsonElement e = o.get(k);
		return e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isBoolean();
	}

	private static double clamp(double v) { return Double.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
}
