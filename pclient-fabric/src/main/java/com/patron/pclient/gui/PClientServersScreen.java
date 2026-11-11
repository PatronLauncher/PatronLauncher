package com.patron.pclient.gui;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.Blaze3D;
import com.mojang.blaze3d.platform.NativeImage;
import com.patron.pclient.L;
import com.patron.pclient.PClient;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.FaviconTexture;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.client.multiplayer.ServerStatusPinger;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.server.network.EventLoopGroupHolder;
import net.minecraft.util.FormattedCharSequence;

/**
 * PClient sunucu ekranı. "Önerilen" sekmesi PatronLauncher sunucu listesini (launcher başlatırken
 * oyun klasörüne yazar) bölge, etiket ve sıralama seçenekleriyle gösterir; "Sunucularım" sekmesi
 * Minecraft'ın kendi kayıtlı sunucularıdır. Sağdaki panel seçili sunucunun ayrıntılarıdır.
 */
public final class PClientServersScreen extends PcScreen {
	private enum Tab { FEATURED, MINE }

	private enum Sort { FEATURED, PLAYERS, PING, NAME }

	/** Launcher listesindeki bir sunucu. */
	record Listed(String id, String name, String address, String country, List<String> languages, List<String> tags,
		String description, boolean featured, boolean sponsored, String versions, String website, String discord) {}

	private static final int ROW = 34;
	/** Ad çözümleme engelleyici olduğundan ping'ler ayrı iş parçacıklarında yapılır (vanilla gibi). */
	private static final ExecutorService PING_POOL = Executors.newFixedThreadPool(4, r -> {
		Thread t = new Thread(r, "PClient sunucu ping");
		t.setDaemon(true);
		return t;
	});
	private static Tab lastTab;
	private static Sort sort = Sort.FEATURED;
	/** Bölge filtresi (ülke kodu) ve etiket filtresi; null: tümü. */
	private static String region, tag;
	/** Yalnızca yerel hesapla girilebilen sunucular. */

	private Tab tab;
	private final PcTextField search = new PcTextField(40, L.t("servers.search")).clearOnEscape();
	private final ServerStatusPinger pinger = new ServerStatusPinger();
	private ServerList saved;
	private List<Listed> featured = List.of();
	/** Önerilen sunucuların ping verisi (adrese göre). */
	private final Map<String, ServerData> featuredData = new HashMap<>();
	private final Map<String, FaviconTexture> icons = new HashMap<>();
	private final Map<String, byte[]> iconBytes = new HashMap<>();
	private Object selected;
	private long deleteArmedUntil, lastClick, copiedAt;
	private Object lastClicked;
	private double scroll, scrollTarget, maxScroll;
	private int listY1, listY2;

	public PClientServersScreen(Screen parent) {
		super("title.servers", parent);
		search.onChange(v -> scrollTarget = 0);
	}

	@Override protected String dock() { return minecraft.level == null ? "servers" : null; }

	@Override protected void init() {
		if (saved == null) {
			saved = new ServerList(minecraft);
			saved.load();
			featured = readFeatured(minecraft);
			tab = lastTab != null ? lastTab : featured.isEmpty() ? Tab.MINE : Tab.FEATURED;
		}
	}

	private static String str(JsonObject o, String k) {
		JsonElement e = o.get(k);
		return e != null && e.isJsonPrimitive() ? e.getAsString() : "";
	}

	private static List<String> strings(JsonObject o, String k) {
		List<String> out = new ArrayList<>();
		if (o.get(k) != null && o.get(k).isJsonArray()) o.getAsJsonArray(k).forEach(t -> out.add(t.getAsString()));
		return out;
	}

	/** Launcher'ın yazdığı sunucu listesi: <oyun klasörü>/pclient/servers.json. */
	static List<Listed> readFeatured(net.minecraft.client.Minecraft minecraft) {
		Path file = minecraft.gameDirectory.toPath().resolve("pclient").resolve("servers.json");
		if (!Files.isRegularFile(file)) return List.of();
		String lang = minecraft.options.languageCode == null ? "en" : minecraft.options.languageCode.substring(0, 2);
		List<Listed> out = new ArrayList<>();
		try {
			JsonObject root = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
			for (JsonElement el : root.getAsJsonArray("servers")) {
				try {
					JsonObject o = el.getAsJsonObject();
					String address = str(o, "address");
					if (o.has("port") && !o.get("port").isJsonNull()) address += ":" + o.get("port").getAsInt();
					String desc = "";
					if (o.get("description") instanceof JsonObject d)
						desc = d.has(lang) ? d.get(lang).getAsString() : d.has("en") ? d.get("en").getAsString() : d.has("tr") ? d.get("tr").getAsString() : "";
					out.add(new Listed(str(o, "id"), str(o, "name"), address, str(o, "country").toLowerCase(Locale.ROOT), strings(o, "languages"),
						strings(o, "tags"), desc, o.has("featured") && o.get("featured").getAsBoolean(),
						o.has("sponsored") && o.get("sponsored").getAsBoolean(), str(o, "versions"), str(o, "website"), str(o, "discord")));
				} catch (RuntimeException e) {
					PClient.LOG.warn("PClient sunucu kaydı atlandı", e);
				}
			}
		} catch (Exception e) {
			PClient.LOG.warn("PClient sunucu listesi okunamadı", e);
		}
		return out;
	}

	private ServerData dataFor(Listed l) {
		return featuredData.computeIfAbsent(l.address, a -> new ServerData(l.name, a, ServerData.Type.OTHER));
	}

	private ServerData data(Object o) { return o instanceof Listed l ? dataFor(l) : (ServerData) o; }

	private static int players(ServerData d) { return d.players != null ? d.players.online() : -1; }

	private static long latency(ServerData d) {
		return d.state() == ServerData.State.SUCCESSFUL || d.state() == ServerData.State.INCOMPATIBLE ? d.ping : Long.MAX_VALUE;
	}

	private List<Object> visible() {
		String q = search.value().toLowerCase(Locale.ROOT).trim();
		List<Object> out = new ArrayList<>();
		if (tab == Tab.FEATURED) {
			for (Listed l : featured) {
				if (region != null && !region.equals(l.country)) continue;
				if (tag != null && !l.tags.contains(tag)) continue;
				String hay = l.name + " " + l.address + " " + String.join(" ", l.tags) + " " + l.description + " " + l.versions;
				if (q.isEmpty() || hay.toLowerCase(Locale.ROOT).contains(q)) out.add(l);
			}
		} else {
			for (int i = 0; i < saved.size(); i++) {
				ServerData d = saved.get(i);
				if (q.isEmpty() || (d.name + " " + d.ip).toLowerCase(Locale.ROOT).contains(q)) out.add(d);
			}
		}
		Comparator<Object> cmp = switch (sort) {
			case FEATURED -> tab == Tab.FEATURED
				? Comparator.comparingInt(o -> -(((Listed) o).sponsored ? 2 : 0) - (((Listed) o).featured ? 1 : 0)) : null;
			case PLAYERS -> Comparator.comparingInt(o -> -players(data(o)));
			case PING -> Comparator.comparingLong(o -> latency(data(o)));
			case NAME -> Comparator.comparing(o -> data(o).name.toLowerCase(Locale.ROOT));
		};
		if (cmp != null) out.sort(cmp);
		return out;
	}

	@Override public void tick() { pinger.tick(); }

	private void ping(ServerData d) { ping(minecraft, pinger, d); }

	static void ping(net.minecraft.client.Minecraft minecraft, ServerStatusPinger pinger, ServerData d) {
		if (d.state() != ServerData.State.INITIAL) return;
		d.setState(ServerData.State.PINGING);
		d.motd = Component.empty();
		d.status = Component.empty();
		PING_POOL.submit(() -> {
			try {
				pinger.pingServer(d, () -> {}, () -> d.setState(d.protocol == SharedConstants.getProtocolVersion()
					? ServerData.State.SUCCESSFUL : ServerData.State.INCOMPATIBLE), EventLoopGroupHolder.remote(minecraft.options.useNativeTransport()));
			} catch (UnknownHostException e) {
				d.setState(ServerData.State.UNREACHABLE);
				d.motd = Component.literal(L.t("servers.unknownHost"));
			} catch (Exception e) {
				d.setState(ServerData.State.UNREACHABLE);
				d.motd = Component.literal(L.t("servers.cantConnect"));
			}
		});
	}

	private static String countryName(String code) {
		String key = "country." + code;
		String t = L.t(key);
		return t.equals("pclient." + key) ? code.toUpperCase(Locale.ROOT) : t;
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		frame(g, 640, 350, L.up("servers.title"));
		// Sekmeler başlık satırında.
		int tx = fx + 34 + Theme.spacedWidth(L.up("servers.title"), 2) + 14;
		for (Tab t : Tab.values()) {
			String label = L.up(t == Tab.FEATURED ? "servers.featured" : "servers.mine") + "  " + (t == Tab.FEATURED ? featured.size() : saved.size());
			int w = Theme.spacedWidth(label, 1) + 16;
			boolean active = t == tab, hov = hit(tx, fy + 6, tx + w, fy + 22, () -> {
				tab = lastTab = t;
				selected = null;
				scrollTarget = 0;
			});
			Theme.notched(g, tx, fy + 6, tx + w, fy + 22, 3, active ? Theme.withAlpha(Theme.accent(), 0x38) : hov ? 0x1AFFFFFF : 0x0AFFFFFF);
			Theme.notchedOutline(g, tx, fy + 6, tx + w, fy + 22, 3, active ? Theme.accent() : Theme.LINE);
			Theme.spaced(g, label, tx + 8, fy + 10, active || hov ? Theme.TEXT : Theme.MUTED, 1);
			tx += w + 6;
		}

		int x1 = fx + 12, x2 = fx + fw - 12, top = fy + FRAME_HEADER + 8;
		// Üst satır: arama, sıralama, yenile, doğrudan bağlan
		String direct = L.up("servers.direct");
		int dw = Theme.spacedWidth(direct, 1) + 16;
		String sortLabel = L.up("servers.sort." + sort.name().toLowerCase(Locale.ROOT));
		int sw = Theme.spacedWidth(sortLabel, 1) + 26;
		int searchX2 = x2 - dw - sw - 34;
		textField(g, x1, top, searchX2, top + 18, search, 11, "search");
		if (button(g, searchX2 + 6, top, searchX2 + 6 + sw, top + 18, sortLabel, Style.GHOST,
			() -> sort = Sort.values()[(sort.ordinal() + 1) % Sort.values().length])) tipNow(L.t("servers.sortHint"));
		if (iconButton(g, x2 - dw - 24, top, 18, "refresh", this::refresh)) tipNow(L.t("servers.refresh"));
		button(g, x2 - dw, top, x2, top + 18, direct, Style.GHOST, () -> open(PClientServerEditScreen.direct(this, this::join)));
		int y = top + 24;

		// Bölge ve etiket çipleri (yalnızca önerilenler)
		if (tab == Tab.FEATURED && !featured.isEmpty()) {
			y = chips(g, x1, x2, y);
		}

		int split = x1 + (int) ((x2 - x1) * 0.57f);
		listY1 = y;
		listY2 = fy + fh - 10;
		List<Object> list = visible();
		if (!list.contains(selected)) selected = list.isEmpty() ? null : list.get(0);
		int addH = tab == Tab.MINE ? 24 : 0;
		int contentH = list.size() * (ROW + 3) + addH;
		maxScroll = Math.max(0, contentH - (listY2 - listY1));
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget));
		scroll += (scrollTarget - scroll) * Math.min(1, dt * 16);
		int lx2 = split - 6 - (maxScroll > 0 ? 6 : 0);
		if (list.isEmpty()) {
			String empty = !search.value().isBlank() || region != null || tag != null ? L.t("servers.noMatch")
				: tab == Tab.FEATURED ? L.t("servers.featuredEmpty") : L.t("servers.mineEmpty");
			List<FormattedCharSequence> lines = font.split(FormattedText.of(empty), split - x1 - 20);
			for (int i = 0; i < lines.size(); i++) g.centeredText(font, lines.get(i), (x1 + split) / 2, listY1 + 24 + i * 10, Theme.MUTED);
		}
		g.enableScissor(x1 - 2, listY1, split, listY2);
		for (int i = 0; i < list.size(); i++) {
			int ry = listY1 + i * (ROW + 3) - (int) Math.round(scroll);
			if (ry + ROW < listY1 || ry > listY2) continue;
			row(g, list.get(i), x1, ry, lx2);
		}
		if (tab == Tab.MINE) {
			int ay = listY1 + list.size() * (ROW + 3) - (int) Math.round(scroll);
			if (ay + 20 > listY1 && ay < listY2)
				button(g, x1, Math.max(ay, listY1), lx2, Math.min(ay + 20, listY2), "+ " + L.up("servers.add"), Style.GHOST, () -> open(PClientServerEditScreen.add(this, d -> {
					saved.add(d, false);
					saved.save();
					tab = lastTab = Tab.MINE;
					selected = d;
				})));
		}
		g.disableScissor();
		if (maxScroll > 0) {
			int trackH = listY2 - listY1, barH = Math.max(18, trackH * trackH / Math.max(1, contentH));
			int barY = listY1 + (int) ((trackH - barH) * (scroll / maxScroll));
			g.fill(split - 8, listY1, split - 6, listY2, 0x14FFFFFF);
			g.fill(split - 8, barY, split - 6, barY + barH, Theme.withAlpha(Theme.accent(), 0xB0));
		}
		detail(g, selected, split + 4, listY1, x2, listY2);
	}

	/** Bölge çipleri (ülke kodu + sayı) ve en sık etiketler; bir sonraki satırın y'sini döner. */
	private int chips(GuiGraphicsExtractor g, int x1, int x2, int y) {
		Map<String, Integer> countries = new LinkedHashMap<>();
		Map<String, Integer> tags = new HashMap<>();
		for (Listed l : featured) {
			if (!l.country.isEmpty()) countries.merge(l.country, 1, Integer::sum);
			for (String t : l.tags) tags.merge(t, 1, Integer::sum);
		}
		int x = x1;
		x = chip(g, x, y, L.up("servers.allRegions") + " " + featured.size(), region == null, () -> region = null, null);
		List<Map.Entry<String, Integer>> sortedCountries = new ArrayList<>(countries.entrySet());
		sortedCountries.sort((a, b) -> b.getValue() - a.getValue());
		for (Map.Entry<String, Integer> c : sortedCountries) {
			String code = c.getKey();
			String label = code.toUpperCase(Locale.ROOT) + " " + c.getValue();
			if (x + Theme.spacedWidth(label, 1) + 16 > x2) break;
			x = chip(g, x, y, label, code.equals(region), () -> {
				region = code.equals(region) ? null : code;
				scrollTarget = 0;
			}, countryName(code));
		}
		y += 20;
		x = x1;
		List<Map.Entry<String, Integer>> sortedTags = new ArrayList<>(tags.entrySet());
		sortedTags.sort((a, b) -> b.getValue() - a.getValue() != 0 ? b.getValue() - a.getValue() : a.getKey().compareTo(b.getKey()));
		Theme.spaced(g, L.up("servers.tags"), x, y + 4, Theme.FAINT, 1);
		x += Theme.spacedWidth(L.up("servers.tags"), 1) + 8;
		for (Map.Entry<String, Integer> t : sortedTags) {
			String name = t.getKey();
			if (x + font.width(name) + 12 > x2) break;
			x = chip(g, x, y, name, name.equals(tag), () -> {
				tag = name.equals(tag) ? null : name;
				scrollTarget = 0;
			}, null);
		}
		return y + 22;
	}

	private int chip(GuiGraphicsExtractor g, int x, int y, String label, boolean active, Runnable action, String tooltip) {
		int w = Theme.spacedWidth(label, 1) + 12;
		boolean hov = hit(x, y, x + w, y + 15, action);
		Theme.notched(g, x, y, x + w, y + 15, 2, active ? Theme.accent() : hov ? 0x26FFFFFF : 0x12FFFFFF);
		Theme.spaced(g, label, x + 6, y + 4, active || hov ? Theme.TEXT : Theme.MUTED, 1);
		if (hov && tooltip != null) tipNow(tooltip);
		return x + w + 4;
	}

	private void row(GuiGraphicsExtractor g, Object entry, int x1, int y, int x2) {
		ServerData d = data(entry);
		ping(d);
		Listed listed = entry instanceof Listed l ? l : null;
		boolean sel = entry.equals(selected), inList = mouseY >= listY1 && mouseY < listY2;
		int cy1 = Math.max(y, listY1), cy2 = Math.min(y + ROW, listY2);
		boolean hov = inList && cy2 > cy1 && hit(x1, cy1, x2, cy2, () -> pick(entry));
		Theme.notched(g, x1, y, x2, y + ROW, 4, sel ? Theme.withAlpha(Theme.accent(), 0x2A) : hov ? Theme.CARD_HOVER : Theme.CARD);
		Theme.notchedOutline(g, x1, y, x2, y + ROW, 4, sel ? Theme.withAlpha(Theme.accent(), 0xB0) : hov ? Theme.LINE_STRONG : Theme.LINE);

		int ix = x1 + 4, iy = y + 3;
		icon(g, d, ix, iy, 28);

		int rx = x2 - 6;
		pingBars(g, d, rx - 18, y + 6);
		String players = d.players != null ? d.players.online() + "/" + d.players.max() : "";
		if (!players.isEmpty()) g.text(font, players, rx - 22 - font.width(players), y + 6, Theme.MUTED, false);

		int tx = ix + 34, room = x2 - tx - 60;
		String name = Theme.ellipsize(d.name, room);
		g.text(font, name, tx, y + 6, Theme.TEXT, false);
		int after = tx + font.width(name) + 5;
		if (listed != null && !listed.country.isEmpty() && after + 16 < x2 - 60) {
			String cc = listed.country.toUpperCase(Locale.ROOT);
			g.fill(after, y + 5, after + font.width(cc) * 3 / 4 + 6, y + 14, 0x30FFFFFF);
			Theme.scaledText(g, cc, after + 3, y + 7, 0.75f, Theme.MUTED, false);
			after += font.width(cc) * 3 / 4 + 10;
		}
		if (listed != null && (listed.featured || listed.sponsored) && after + 30 < x2 - 60) {
			String t = L.up(listed.sponsored ? "servers.sponsored" : "servers.highlight");
			int tw = (int) (font.width(t) * 0.75f) + 8;
			Theme.notched(g, after, y + 5, after + tw, y + 14, 2, Theme.withAlpha(Theme.accent(), 0x40));
			Theme.scaledText(g, t, after + 4, y + 7, 0.75f, Theme.TEXT, false);
		}
		// MOTD ya da açıklamanın ilk satırı
		List<FormattedCharSequence> lines = d.motd == null || d.motd.getString().isBlank()
			? (listed != null && !listed.description.isEmpty() ? font.split(Component.literal(listed.description), x2 - tx - 8) : List.of())
			: font.split(d.motd, x2 - tx - 8);
		int motdColor = d.state() == ServerData.State.UNREACHABLE ? 0xFFE5484D : Theme.MUTED;
		if (!lines.isEmpty()) g.text(font, lines.get(0), tx, y + 19, motdColor, false);
	}

	private void icon(GuiGraphicsExtractor g, ServerData d, int x, int y, int size) {
		Theme.notched(g, x, y, x + size, y + size, 2, 0xFF16181F);
		FaviconTexture icon = favicon(d);
		if (icon != null) g.blit(RenderPipelines.GUI_TEXTURED, icon.textureLocation(), x, y, 0f, 0f, size, size, size, size);
		else {
			String letter = d.name.isEmpty() ? "?" : d.name.substring(0, 1).toUpperCase(Locale.ROOT);
			float s = size / 16f;
			Theme.scaledText(g, letter, x + size / 2f - font.width(letter) * s / 2f, y + size / 2f - 4 * s, s, Theme.accent(), false);
		}
	}

	private void pingBars(GuiGraphicsExtractor g, ServerData d, int x, int y) {
		int bars = switch (d.state()) {
			case SUCCESSFUL, INCOMPATIBLE -> d.ping < 0 ? 0 : d.ping < 150 ? 5 : d.ping < 300 ? 4 : d.ping < 600 ? 3 : d.ping < 1000 ? 2 : 1;
			default -> 0;
		};
		int barColor = d.state() == ServerData.State.INCOMPATIBLE ? 0xFFE5A04D : bars >= 4 ? 0xFF4ADE80 : bars >= 2 ? 0xFFF5C542 : 0xFFE5484D;
		boolean pinging = d.state() == ServerData.State.PINGING || d.state() == ServerData.State.INITIAL;
		for (int i = 0; i < 5; i++) {
			int h = 2 + i * 2, bx = x + i * 4;
			int c = pinging ? ((System.currentTimeMillis() / 120) % 5 == i ? Theme.MUTED : 0x30FFFFFF) : i < bars ? barColor : 0x30FFFFFF;
			g.fill(bx, y + 10 - h, bx + 3, y + 10, c);
		}
	}

	/** Sağ panel: seçili sunucunun ayrıntıları ve eylemleri. */
	private void detail(GuiGraphicsExtractor g, Object entry, int x1, int y1, int x2, int y2) {
		Theme.notched(g, x1, y1, x2, y2, 5, 0x14FFFFFF);
		Theme.notchedOutline(g, x1, y1, x2, y2, 5, Theme.LINE);
		if (entry == null) {
			PixelIcons.drawCentered(g, "server", (x1 + x2) / 2, (y1 + y2) / 2 - 10, 3, Theme.FAINT);
			g.centeredText(font, L.t("servers.pick"), (x1 + x2) / 2, (y1 + y2) / 2 + 12, Theme.MUTED);
			return;
		}
		ServerData d = data(entry);
		Listed l = entry instanceof Listed li ? li : null;
		int x = x1 + 10, w = x2 - x1 - 20, y = y1 + 10;
		icon(g, d, x, y, 40);
		int tx = x + 48;
		g.text(font, Theme.ellipsize(d.name, x2 - tx - 10), tx, y + 2, Theme.TEXT, false);
		boolean copied = System.currentTimeMillis() - copiedAt < 1500;
		String addr = copied ? L.t("servers.copied") : d.ip;
		boolean ha = hit(tx, y + 13, tx + Math.min(font.width(addr), x2 - tx - 10), y + 23, () -> {
			minecraft.keyboardHandler.setClipboard(d.ip);
			copiedAt = System.currentTimeMillis();
		});
		g.text(font, Theme.ellipsize(addr, x2 - tx - 10), tx, y + 14, copied ? 0xFF4ADE80 : ha ? Theme.TEXT : Theme.accent(), false);
		if (ha && !copied) tipNow(L.t("servers.copy"));
		if (l != null) {
			String sub = (l.country.isEmpty() ? "" : countryName(l.country)) + (l.languages.isEmpty() ? "" : "  ·  " + String.join(", ", l.languages).toUpperCase(Locale.ROOT));
			g.text(font, Theme.ellipsize(sub, x2 - tx - 10), tx, y + 26, Theme.FAINT, false);
		}
		y += 48;

		// Oyuncu doluluğu ve gecikme
		if (d.players != null && d.players.max() > 0) {
			float f = Math.min(1f, d.players.online() / (float) d.players.max());
			String p = L.t("servers.playersOf", d.players.online(), d.players.max());
			g.text(font, p, x, y, Theme.TEXT, false);
			if (latency(d) != Long.MAX_VALUE) {
				String ms = d.ping + " ms";
				g.text(font, ms, x + w - font.width(ms), y, Theme.MUTED, false);
			}
			y += 11;
			g.fill(x, y, x + w, y + 3, 0x22FFFFFF);
			g.fill(x, y, x + Math.round(w * f), y + 3, Theme.accent());
			y += 8;
		} else {
			String status = switch (d.state()) {
				case UNREACHABLE -> L.t("servers.offline");
				case INITIAL, PINGING -> L.t("servers.checking");
				default -> "";
			};
			if (!status.isEmpty()) {
				g.text(font, status, x, y, d.state() == ServerData.State.UNREACHABLE ? 0xFFE5484D : Theme.MUTED, false);
				y += 14;
			}
		}
		if (d.state() == ServerData.State.INCOMPATIBLE && d.version != null) {
			g.text(font, Theme.ellipsize(L.t("servers.needsVersion", d.version.getString()), w), x, y, 0xFFE5A04D, false);
			y += 12;
		}
		if (l != null && !l.versions.isEmpty()) {
			g.text(font, Theme.ellipsize(L.t("servers.versions", l.versions), w), x, y, Theme.MUTED, false);
			y += 12;
		}
		int buttonsY = y2 - 26;
		int linksH = l != null && (!l.website.isEmpty() || !l.discord.isEmpty()) ? 20 : 0;
		int textBottom = buttonsY - linksH - 6;

		// MOTD
		if (d.motd != null && !d.motd.getString().isBlank()) {
			List<FormattedCharSequence> motd = font.split(d.motd, w - 8);
			int mh = Math.min(2, motd.size()) * 10 + 6;
			if (y + mh < textBottom) {
				g.fill(x, y, x + w, y + mh, 0x40000000);
				for (int i = 0; i < Math.min(2, motd.size()); i++) g.text(font, motd.get(i), x + 4, y + 3 + i * 10, Theme.MUTED, false);
				y += mh + 6;
			}
		}
		// Açıklama
		if (l != null && !l.description.isEmpty()) {
			List<FormattedCharSequence> desc = font.split(FormattedText.of(l.description), w);
			for (FormattedCharSequence line : desc) {
				if (y + 10 > textBottom - (l.tags.isEmpty() ? 0 : 16)) break;
				g.text(font, line, x, y, Theme.TEXT, false);
				y += 10;
			}
			y += 4;
		}
		// Etiketler
		if (l != null && !l.tags.isEmpty() && y + 13 <= textBottom) {
			int cx = x;
			for (String t : l.tags) {
				int tw = (int) (font.width(t) * 0.75f) + 8;
				if (cx + tw > x + w) break;
				g.fill(cx, y, cx + tw, y + 11, 0x22FFFFFF);
				Theme.scaledText(g, t, cx + 4, y + 2, 0.75f, Theme.MUTED, false);
				cx += tw + 3;
			}
		}
		// Bağlantılar
		if (linksH > 0) {
			int lx = x, ly = buttonsY - linksH;
			if (!l.website.isEmpty()) {
				String label = L.up("servers.website");
				int lw = Theme.spacedWidth(label, 1) + 16;
				button(g, lx, ly, lx + lw, ly + 16, label, Style.GHOST, () -> openLink(l.website));
				lx += lw + 4;
			}
			if (!l.discord.isEmpty()) {
				String label = "DISCORD";
				int lw = Theme.spacedWidth(label, 1) + 16;
				button(g, lx, ly, lx + lw, ly + 16, label, Style.GHOST, () -> openLink(l.discord));
			}
		}
		// Eylemler
		int bx2 = x + w;
		String joinLabel = L.up("servers.join");
		int jw = Math.max(70, Theme.spacedWidth(joinLabel, 1) + 24);
		button(g, bx2 - jw, buttonsY, bx2, buttonsY + 20, joinLabel, Style.PRIMARY, () -> join(d));
		int bx = bx2 - jw - 4;
		if (entry instanceof ServerData sd) {
			boolean armed = System.currentTimeMillis() < deleteArmedUntil;
			String del = L.up(armed ? "servers.deleteConfirm" : "servers.delete");
			int dw = Theme.spacedWidth(del, 1) + 16;
			button(g, bx - dw, buttonsY, bx, buttonsY + 20, del, armed ? Style.DANGER : Style.GHOST, () -> delete(sd));
			bx -= dw + 4;
			String edit = L.up("servers.edit");
			int ew = Theme.spacedWidth(edit, 1) + 16;
			if (bx - ew >= x)
				button(g, bx - ew, buttonsY, bx, buttonsY + 20, edit, Style.GHOST, () -> open(PClientServerEditScreen.edit(this, sd, () -> {
					saved.save();
					sd.setState(ServerData.State.INITIAL);
				})));
		} else if (l != null) {
			boolean already = saved.get(l.address) != null;
			String save = L.up(already ? "servers.saved" : "servers.saveToMine");
			int svw = Theme.spacedWidth(save, 1) + 16;
			if (bx - svw >= x)
				button(g, bx - svw, buttonsY, bx, buttonsY + 20, save, Style.GHOST, already ? null : () -> {
					saved.add(new ServerData(l.name, l.address, ServerData.Type.OTHER), false);
					saved.save();
				});
		}
	}

	/** Yalnızca http(s) bağlantıları açılır (liste launcher'da doğrulanmıştır). */
	private void openLink(String url) {
		try {
			URI uri = URI.create(url);
			if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) Blaze3D.openUri(uri);
		} catch (RuntimeException e) {
			PClient.LOG.warn("Bağlantı açılamadı: {}", url, e);
		}
	}

	/** Ping'le gelen sunucu simgesi; gelmediyse null (baş harf çizilir). */
	private FaviconTexture favicon(ServerData d) {
		byte[] bytes = d.getIconBytes();
		if (bytes == null) return icons.get(d.ip);
		if (Arrays.equals(bytes, iconBytes.get(d.ip))) return icons.get(d.ip);
		iconBytes.put(d.ip, bytes);
		FaviconTexture t = icons.computeIfAbsent(d.ip, ip -> FaviconTexture.forServer(minecraft.getTextureManager(), ip));
		try {
			t.upload(NativeImage.read(bytes));
		} catch (Exception e) {
			t.clear();
			icons.remove(d.ip).close();
			return null;
		}
		return t;
	}

	private void pick(Object entry) {
		long now = System.currentTimeMillis();
		if (entry.equals(lastClicked) && now - lastClick < 350) {
			join(data(entry));
			return;
		}
		lastClicked = entry;
		lastClick = now;
		selected = entry;
		deleteArmedUntil = 0;
	}

	private void refresh() {
		pinger.removeAll();
		featuredData.clear();
		saved.load();
		featured = readFeatured(minecraft);
	}

	private void delete(ServerData d) {
		if (System.currentTimeMillis() >= deleteArmedUntil) {
			deleteArmedUntil = System.currentTimeMillis() + 3000;
			return;
		}
		deleteArmedUntil = 0;
		saved.remove(d);
		saved.save();
		selected = null;
	}

	/** Sunucuya bağlanır; bağlantı başarısız olursa bu ekrana dönülür. */
	void join(ServerData d) {
		if (!ServerAddress.isValidAddress(d.ip)) return;
		ConnectScreen.startConnecting(this, minecraft, ServerAddress.parseString(d.ip), d, false, null);
	}

	@Override public boolean mouseScrolled(double x, double y, double h, double v) {
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget - v * 30));
		return true;
	}

	@Override public void removed() {
		super.removed();
		pinger.removeAll();
		icons.values().forEach(FaviconTexture::close);
		icons.clear();
		iconBytes.clear();
	}
}
