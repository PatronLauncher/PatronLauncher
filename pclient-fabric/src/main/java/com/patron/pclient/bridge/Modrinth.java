package com.patron.pclient.bridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.patron.pclient.L;
import com.patron.pclient.PClient;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.util.Util;

/**
 * Oyun içinden Modrinth: arama ve kaynak/shader paketi kurulumu. Dosyalar yalnızca Modrinth CDN'inden
 * iner, SHA-512 özeti doğrulanmadan paket klasörüne taşınmaz.
 */
public final class Modrinth {
	public enum Kind {
		RESOURCE("resourcepack", "resourcepacks", "[\"minecraft\"]"), SHADER("shader", "shaderpacks", "[\"iris\",\"optifine\"]");

		final String type, folder, loaders;

		Kind(String type, String folder, String loaders) {
			this.type = type;
			this.folder = folder;
			this.loaders = loaders;
		}
	}

	public record Hit(String id, String title, String author, String description, String icon, long downloads, long follows, List<String> categories, Kind kind) {}

	public record Page(List<Hit> hits, int total) {}

	record Remote(String url, String file, String sha512, long size) {}

	/** Projenin Minecraft sürümüne uyan bir dosyası. */
	public record Release(String id, String name, String number, String type, String date, long downloads, Remote file) {}

	public record Shot(String url, String full, String title) {}

	public record Project(String body, List<Shot> gallery, String license, String published, String updated, long followers,
		String source, String issues, String wiki, String discord, List<Release> releases) {}

	private static final String API = "https://api.modrinth.com/v2/";
	private static final long MAX_FILE = 1024L * 1024 * 1024;
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Map<String, Integer> PROGRESS = new ConcurrentHashMap<>();
	private static Map<String, JsonObject> installed;
	private static volatile String error;
	private static volatile boolean irisInstalled;

	private Modrinth() {}

	public static String error() { return error; }

	public static void clearError() { error = null; }

	/** İndirme yüzdesi; indirilmiyorsa -1. */
	public static int progress(String id) { return PROGRESS.getOrDefault(id, -1); }

	private static String gameVersion() { return SharedConstants.getCurrentVersion().name(); }

	private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }

	private static String userAgent() { return "PatronLauncher-PClient/" + PClient.version; }

	private static JsonElement getJson(String url) throws IOException {
		HttpURLConnection c = (HttpURLConnection) URI.create(url).toURL().openConnection();
		c.setConnectTimeout(8000);
		c.setReadTimeout(15_000);
		c.setRequestProperty("User-Agent", userAgent());
		try (InputStream in = c.getInputStream()) {
			return JsonParser.parseString(new String(in.readNBytes(8 * 1024 * 1024), StandardCharsets.UTF_8));
		} finally {
			c.disconnect();
		}
	}

	public static CompletableFuture<Page> search(Kind kind, String query, int offset) {
		return search(kind, query, offset, query.isBlank() ? "downloads" : "relevance", List.of());
	}

	private static JsonArray facet(String... values) {
		JsonArray group = new JsonArray();
		for (String value : values) group.add(value);
		return group;
	}

	/** Her filtre grubunun içinde "herhangi biri", gruplar arasında "hepsi" geçerlidir (Modrinth facet kuralı). */
	public static CompletableFuture<Page> search(Kind kind, String query, int offset, String index, List<List<String>> filters) {
		return CompletableFuture.supplyAsync(() -> {
			try {
				JsonArray facets = new JsonArray();
				facets.add(facet("project_type:" + kind.type));
				facets.add(facet("versions:" + gameVersion()));
				for (List<String> group : filters) facets.add(facet(group.stream().map(c -> "categories:" + c).toArray(String[]::new)));
				JsonObject o = getJson(API + "search?limit=20&offset=" + offset + "&index=" + enc(index)
					+ "&query=" + enc(query) + "&facets=" + enc(facets.toString())).getAsJsonObject();
				List<Hit> hits = new ArrayList<>();
				for (JsonElement e : o.getAsJsonArray("hits")) {
					JsonObject h = e.getAsJsonObject();
					hits.add(new Hit(h.get("project_id").getAsString(), text(h, "title"), text(h, "author"), text(h, "description"), text(h, "icon_url"),
						number(h, "downloads"), number(h, "follows"), strings(h, h.has("display_categories") ? "display_categories" : "categories"), kind));
				}
				return new Page(hits, o.get("total_hits").getAsInt());
			} catch (IOException e) {
				throw new IllegalStateException(e);
			}
		}, Util.nonCriticalIoPool());
	}

	private static long number(JsonObject o, String key) {
		JsonElement e = o.get(key);
		return e == null || e.isJsonNull() ? 0 : e.getAsLong();
	}

	private static List<String> strings(JsonObject o, String key) {
		List<String> out = new ArrayList<>();
		if (o.get(key) instanceof JsonArray list) list.forEach(e -> out.add(e.getAsString()));
		return out;
	}

	private static List<Release> releases(String project, String loaders, String extension) throws IOException {
		String url = API + "project/" + enc(project) + "/version?loaders=" + enc(loaders) + "&game_versions=" + enc("[\"" + gameVersion() + "\"]");
		List<Release> out = new ArrayList<>();
		for (JsonElement v : getJson(url).getAsJsonArray()) {
			JsonObject version = v.getAsJsonObject();
			JsonObject chosen = null;
			for (JsonElement f : version.getAsJsonArray("files")) {
				JsonObject o = f.getAsJsonObject();
				if (!text(o, "filename").endsWith(extension)) continue;
				if (chosen == null || o.get("primary").getAsBoolean()) chosen = o;
			}
			if (chosen == null) continue;
			Remote file = new Remote(text(chosen, "url"), text(chosen, "filename"), chosen.getAsJsonObject("hashes").get("sha512").getAsString(), chosen.get("size").getAsLong());
			out.add(new Release(text(version, "id"), text(version, "name"), text(version, "version_number"), text(version, "version_type"),
				shortDate(text(version, "date_published")), number(version, "downloads"), file));
		}
		return out;
	}

	private static String shortDate(String date) { return date.length() >= 10 ? date.substring(0, 10) : date; }

	/** Proje sayfası: açıklama, galeri, bağlantılar ve bu Minecraft sürümüne uyan dosyalar. */
	public static CompletableFuture<Project> project(Hit hit) {
		return CompletableFuture.supplyAsync(() -> {
			try {
				JsonObject o = getJson(API + "project/" + enc(hit.id)).getAsJsonObject();
				List<Shot> gallery = new ArrayList<>();
				for (JsonElement e : o.getAsJsonArray("gallery")) {
					JsonObject g = e.getAsJsonObject();
					gallery.add(new Shot(text(g, "url"), g.has("raw_url") ? text(g, "raw_url") : text(g, "url"), text(g, "title")));
				}
				String license = o.get("license") instanceof JsonObject l ? (text(l, "name").isEmpty() ? text(l, "id") : text(l, "name")) : "";
				return new Project(text(o, "body"), gallery, license, shortDate(text(o, "published")), shortDate(text(o, "updated")), number(o, "followers"),
					text(o, "source_url"), text(o, "issues_url"), text(o, "wiki_url"), text(o, "discord_url"), releases(hit.id, hit.kind.loaders, ".zip"));
			} catch (IOException e) {
				throw new IllegalStateException(e);
			}
		}, Util.nonCriticalIoPool());
	}

	private static String text(JsonObject o, String key) {
		JsonElement e = o.get(key);
		return e == null || e.isJsonNull() ? "" : e.getAsString();
	}

	public static byte[] icon(String url) { return image(url, 64); }

	/** Görseller WebP olduğu için launcher PNG'ye çevirir; launcher kapalıysa gösterilmez. */
	public static byte[] image(String url, int size) {
		JsonObject body = new JsonObject();
		body.addProperty("url", url);
		body.addProperty("size", size);
		return Base64.getDecoder().decode(Bridge.post("/v1/image", body, 30_000).join().getAsJsonObject().get("png").getAsString());
	}

	/** Kararlı dosya varsa o, yoksa en yenisi. */
	private static Release latest(String project, String loaders, String extension) throws IOException {
		List<Release> list = releases(project, loaders, extension);
		if (list.isEmpty()) throw new IOException("Bu Minecraft sürümü için yayımlanmış dosya yok.");
		return list.stream().filter(r -> r.type.equals("release")).findFirst().orElse(list.getFirst());
	}

	private static void download(Remote r, Path dir, String id) throws IOException, NoSuchAlgorithmException {
		URI uri = URI.create(r.url);
		if (!"https".equals(uri.getScheme()) || !"cdn.modrinth.com".equals(uri.getHost())) throw new IOException("Güvenilmeyen indirme adresi.");
		if (!r.file.matches("[^\\\\/:*?\"<>|]+") || r.file.startsWith(".")) throw new IOException("Geçersiz dosya adı.");
		if (r.size <= 0 || r.size > MAX_FILE) throw new IOException("Dosya boyutu geçersiz.");
		Files.createDirectories(dir);
		Path target = dir.resolve(r.file), temp = dir.resolve(r.file + ".part");
		MessageDigest digest = MessageDigest.getInstance("SHA-512");
		HttpURLConnection c = (HttpURLConnection) uri.toURL().openConnection();
		c.setConnectTimeout(10_000);
		c.setReadTimeout(30_000);
		c.setRequestProperty("User-Agent", userAgent());
		try (InputStream in = c.getInputStream(); OutputStream out = Files.newOutputStream(temp)) {
			byte[] buffer = new byte[64 * 1024];
			long total = 0;
			for (int n; (n = in.read(buffer)) > 0; ) {
				total += n;
				if (total > r.size) throw new IOException("Dosya beklenenden büyük.");
				digest.update(buffer, 0, n);
				out.write(buffer, 0, n);
				PROGRESS.put(id, (int) (total * 100 / r.size));
			}
		} catch (IOException e) {
			Files.deleteIfExists(temp);
			throw e;
		} finally {
			c.disconnect();
		}
		if (!HexFormat.of().formatHex(digest.digest()).equalsIgnoreCase(r.sha512)) {
			Files.deleteIfExists(temp);
			throw new IOException("Dosya doğrulanamadı (SHA-512 eşleşmiyor).");
		}
		Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
	}

	// ---------------- Kurulu paketler ----------------

	private static Path registry() { return FabricLoader.getInstance().getConfigDir().resolve("pclient").resolve("modrinth.json"); }

	private static Path folder(Kind kind) { return Minecraft.getInstance().gameDirectory.toPath().resolve(kind.folder); }

	private static synchronized Map<String, JsonObject> records() {
		if (installed != null) return installed;
		installed = new LinkedHashMap<>();
		try {
			if (Files.isRegularFile(registry()))
				for (var e : JsonParser.parseString(Files.readString(registry(), StandardCharsets.UTF_8)).getAsJsonObject().entrySet())
					if (e.getValue() instanceof JsonObject o) installed.put(e.getKey(), o);
		} catch (IOException | RuntimeException e) {
			PClient.LOG.warn("modrinth.json okunamadı", e);
		}
		return installed;
	}

	private static synchronized void saveRecords() {
		JsonObject root = new JsonObject();
		records().forEach(root::add);
		try {
			Files.createDirectories(registry().getParent());
			Files.writeString(registry(), GSON.toJson(root), StandardCharsets.UTF_8);
		} catch (IOException e) {
			PClient.LOG.warn("modrinth.json yazılamadı", e);
		}
	}

	/** Paket hâlâ klasördeyse dosya adını döner. */
	public static synchronized String installedFile(String id) {
		JsonObject o = records().get(id);
		if (o == null) return null;
		String file = text(o, "file");
		Kind kind = Kind.valueOf(text(o, "kind"));
		return Files.isRegularFile(folder(kind).resolve(file)) ? file : null;
	}

	public static synchronized List<Hit> installedHits() {
		List<Hit> out = new ArrayList<>();
		for (var e : records().entrySet()) {
			if (installedFile(e.getKey()) == null) continue;
			JsonObject o = e.getValue();
			out.add(new Hit(e.getKey(), text(o, "title"), text(o, "author"), text(o, "description"), text(o, "icon"), 0, 0, List.of(), Kind.valueOf(text(o, "kind"))));
		}
		return out;
	}

	/** Kurulu dosyanın Modrinth sürüm kimliği; eski kayıtlarda boş. */
	public static synchronized String installedVersion(String id) {
		JsonObject o = records().get(id);
		return o == null || installedFile(id) == null ? "" : text(o, "version");
	}

	/** Kurulu dosyanın okunabilir sürüm numarası (ör. "1.4.2"); eski kayıtlarda boş. */
	public static synchronized String installedNumber(String id) {
		JsonObject o = records().get(id);
		return o == null ? "" : text(o, "number");
	}

	/** Paketin indirildiği an (epoch ms). Eski kayıtlarda dosyanın değişme zamanı kullanılır. */
	public static synchronized long installedAt(String id) {
		JsonObject o = records().get(id);
		if (o == null) return 0;
		long at = number(o, "installed");
		if (at > 0) return at;
		try {
			return Files.getLastModifiedTime(folder(Kind.valueOf(text(o, "kind"))).resolve(text(o, "file"))).toMillis();
		} catch (IOException | RuntimeException e) {
			return 0;
		}
	}

	public static synchronized boolean favorite(String id) {
		JsonObject o = records().get(id);
		return o != null && o.has("favorite") && o.get("favorite").getAsBoolean();
	}

	/** Yalnızca indirilmiş paketler favorilenebilir; durum modrinth.json'a yazılır. */
	public static synchronized void toggleFavorite(String id) {
		JsonObject o = records().get(id);
		if (o == null) return;
		if (favorite(id)) o.remove("favorite");
		else o.addProperty("favorite", true);
		saveRecords();
	}

	public static CompletableFuture<Void> install(Hit hit) { return install(hit, null); }

	/** Belirli bir sürümü (null ise en güncel kararlıyı) kurar; önceki sürümün dosyası kaldırılır. */
	public static CompletableFuture<Void> install(Hit hit, Release release) {
		if (progress(hit.id) >= 0) return CompletableFuture.completedFuture(null);
		PROGRESS.put(hit.id, 0);
		error = null;
		return CompletableFuture.runAsync(() -> {
			try {
				Release chosen = release != null ? release : latest(hit.id, hit.kind.loaders, ".zip");
				Remote remote = chosen.file;
				String previous = installedFile(hit.id);
				download(remote, folder(hit.kind), hit.id);
				if (previous != null && !previous.equals(remote.file)) Files.deleteIfExists(folder(hit.kind).resolve(previous));
				JsonObject o = new JsonObject();
				o.addProperty("file", remote.file);
				o.addProperty("version", chosen.id);
				o.addProperty("number", chosen.number);
				o.addProperty("installed", System.currentTimeMillis());
				o.addProperty("kind", hit.kind.name());
				o.addProperty("title", hit.title);
				o.addProperty("author", hit.author);
				o.addProperty("description", hit.description);
				o.addProperty("icon", hit.icon);
				synchronized (Modrinth.class) {
					// Güncellemede favori işareti korunur.
					if (favorite(hit.id)) o.addProperty("favorite", true);
					records().put(hit.id, o);
					saveRecords();
				}
			} catch (IOException | NoSuchAlgorithmException | RuntimeException e) {
				error = e.getMessage();
				throw new IllegalStateException(e);
			} finally {
				PROGRESS.remove(hit.id);
			}
		}, Util.nonCriticalIoPool());
	}

	public static synchronized void remove(Hit hit) {
		String file = installedFile(hit.id);
		try {
			if (file != null) Files.deleteIfExists(folder(hit.kind).resolve(file));
			records().remove(hit.id);
			saveRecords();
		} catch (IOException e) {
			error = e.getMessage();
		}
	}

	// ---------------- Etkinleştirme ----------------

	private static String packId(String file) { return "file/" + file; }

	public static boolean resourceActive(String file) {
		return Minecraft.getInstance().getResourcePackRepository().getSelectedIds().contains(packId(file));
	}

	/** Kaynak paketini açar/kapatır ve kaynakları oyunda hemen yeniden yükler. */
	public static void toggleResource(String file) {
		Minecraft mc = Minecraft.getInstance();
		var repository = mc.getResourcePackRepository();
		repository.reload();
		String id = packId(file);
		if (repository.getSelectedIds().contains(id)) repository.removePack(id);
		else if (!repository.addPack(id)) {
			error = id;
			return;
		}
		mc.options.updateResourcePacks(repository);
	}

	public static boolean irisLoaded() { return FabricLoader.getInstance().isModLoaded("iris"); }

	public static boolean sodiumLoaded() { return FabricLoader.getInstance().isModLoaded("sodium"); }

	/** Iris indirildi, etkinleşmesi için oyun yeniden başlatılmalı. */
	public static boolean irisInstalled() { return irisInstalled; }

	/**
	 * Iris'i launcher kurar: Iris'in istediği Sodium sürümünü de birlikte getirir ve ikisini doğrular.
	 * Modlar burada doğrudan indirilmez; uyumsuz bir Iris oyunun açılmasını engelliyordu.
	 */
	public static void installIris() {
		if (progress("iris") >= 0) return;
		PROGRESS.put("iris", 0);
		error = null;
		Bridge.post("/v1/iris/install", null, 180_000).whenComplete((reply, failure) -> {
			PROGRESS.remove("iris");
			if (failure == null) irisInstalled = true;
			else error = Bridge.message(failure) == null ? L.t("modrinth.launcherNeeded") : Bridge.message(failure);
		});
	}

	// Iris derleme bağımlılığı değildir; yüklüyse herkese açık API'si yansımayla kullanılır.
	private static Object irisConfig() throws ReflectiveOperationException {
		return Class.forName("net.irisshaders.iris.Iris").getMethod("getIrisConfig").invoke(null);
	}

	public static boolean shaderActive(String file) {
		if (!irisLoaded()) return false;
		try {
			Object config = irisConfig();
			boolean enabled = (boolean) config.getClass().getMethod("areShadersEnabled").invoke(config);
			Optional<?> name = (Optional<?>) config.getClass().getMethod("getShaderPackName").invoke(config);
			return enabled && name.isPresent() && file.equals(name.get());
		} catch (ReflectiveOperationException e) {
			return false;
		}
	}

	/** Shader paketini uygular ya da kapatır; dünya içindeyse de hemen değişir. */
	public static void toggleShader(String file) {
		try {
			boolean active = shaderActive(file);
			Object config = irisConfig();
			if (!active) config.getClass().getMethod("setShaderPackName", String.class).invoke(config, file);
			config.getClass().getMethod("setShadersEnabled", boolean.class).invoke(config, !active);
			config.getClass().getMethod("save").invoke(config);
			Class.forName("net.irisshaders.iris.Iris").getMethod("reload").invoke(null);
		} catch (ReflectiveOperationException e) {
			PClient.LOG.warn("Shader değiştirilemedi", e);
			error = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
		}
	}
}
