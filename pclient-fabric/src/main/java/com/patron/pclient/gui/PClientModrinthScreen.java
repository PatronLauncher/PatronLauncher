package com.patron.pclient.gui;

import com.mojang.blaze3d.Blaze3D;
import com.patron.pclient.L;
import com.patron.pclient.bridge.Modrinth;
import com.patron.pclient.bridge.Support;
import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

/** Oyun içi Modrinth: filtreli gezinme, proje sayfası (açıklama, galeri, sürümler) ve kurulu paketler. */
public final class PClientModrinthScreen extends PcScreen {
	private enum Tab { RESOURCE, SHADER, INSTALLED }

	private enum Page { BODY, GALLERY, VERSIONS }

	/** İndirilenler sekmesinin görünüm filtresi. */
	private enum Show { ALL, RESOURCE, SHADER, FAVORITE, ACTIVE }

	private record Section(String key, List<String> tags) {}

	private record Act(String label, boolean brand, Runnable run) {}

	private record Line(FormattedCharSequence text, int color, int indent, int height, boolean rule) {}

	private static final int GREEN = Theme.MODRINTH_GREEN, GREEN_HOVER = 0xFF3CE588, GREEN_SOFT = 0x331BD96A, INK = 0xFF08110C;
	private static final int BG = 0xF6141619, RAISED = 0xFF212429, RAISED_HOVER = 0xFF2B2F35, CONTROL = 0xFF30343B, RULE = 0x1EFFFFFF;
	private static final int SUB = 0xFFB0BAC5, DIM = 0xFF7D8590, ORANGE = 0xFFE5A04D, RED = 0xFFE5484D;
	private static final int ROW = 54, HEADER = 30, SIDE_W = 134, NARROW = 540, FILTER_ROW = 13;
	private static final long SEARCH_DELAY_MS = 300;
	private static final List<String> SORTS = List.of("relevance", "downloads", "follows", "newest", "updated");
	private static final List<Section> RESOURCE_SECTIONS = List.of(
		new Section("categories", List.of("combat", "cursed", "decoration", "modded", "realistic", "simplistic", "themed", "tweaks", "utility", "vanilla-like")),
		new Section("features", List.of("audio", "blocks", "core-shaders", "entities", "environment", "equipment", "fonts", "gui", "items", "locale", "models")),
		new Section("resolutions", List.of("8x-", "16x", "32x", "48x", "64x", "128x", "256x", "512x+")));
	private static final List<Section> SHADER_SECTIONS = List.of(
		new Section("categories", List.of("cartoon", "cursed", "fantasy", "realistic", "semi-realistic", "vanilla-like")),
		new Section("features", List.of("atmosphere", "bloom", "colored-lighting", "foliage", "path-tracing", "pbr", "reflections", "shadows")),
		new Section("performance", List.of("potato", "low", "medium", "high", "screenshot")));

	private static Tab tab = Tab.RESOURCE;
	private static String sort = "relevance";
	private static final Map<Tab, Set<String>> FILTERS = new EnumMap<>(Tab.class);
	private static final Set<String> COLLAPSED = new HashSet<>(Set.of("features"));
	private static final List<String> LOCAL_SORTS = List.of("recent", "name", "active");
	private static final int GOLD = 0xFFF5C451;
	private static Show show = Show.ALL;
	private static String localSort = "recent";

	private final PcTextField search = new PcTextField(64, L.t("modrinth.search")).clearOnEscape();
	private final PcTextField localSearch = new PcTextField(64, L.t("modrinth.searchInstalled")).clearOnEscape();
	private final List<Modrinth.Hit> hits = new ArrayList<>();
	/** İndirilenler sekmesinde filtrelenmemiş tam liste ve her görünümün sayısı. */
	private final List<Modrinth.Hit> installedAll = new ArrayList<>();
	private final Map<Show, Integer> showCounts = new EnumMap<>(Show.class);
	private final Set<String> imageKeys = new HashSet<>();
	private int total, generation, listY1, listY2, sideY1, sideY2;
	private boolean loading, failed, showFilters;
	private long searchAt = 1;
	private double scroll, scrollTarget, maxScroll, sideScroll, sideTarget, sideMax;

	private Modrinth.Hit detail;
	private Modrinth.Project project;
	private boolean detailFailed;
	private Page page = Page.BODY;
	private Modrinth.Shot zoom;
	private List<Line> lines;
	private int linesWidth = -1;

	public PClientModrinthScreen(Screen parent) {
		super("title.modrinth", parent);
		search.onChange(v -> searchAt = System.currentTimeMillis() + SEARCH_DELAY_MS);
		// Yerel arama ağ kullanmaz; her tuşta hemen süzülür.
		localSearch.onChange(v -> {
			if (tab == Tab.INSTALLED) refilter();
		});
	}

	/** Etkin sekmenin arama kutusu. */
	private PcTextField field() { return tab == Tab.INSTALLED ? localSearch : search; }

	/** Ana sayfadaki ön gösterimden doğrudan proje sayfasıyla açılır. */
	public PClientModrinthScreen(Screen parent, Modrinth.Hit open) {
		this(parent);
		tab = open.kind() == Modrinth.Kind.SHADER ? Tab.SHADER : Tab.RESOURCE;
		openDetail(open);
	}

	@Override protected void init() {
		if (detail == null && zoom == null) focus(field());
	}

	@Override protected String dock() { return "modrinth"; }

	@Override protected int fieldAccent() { return GREEN; }

	private Set<String> filters() { return FILTERS.computeIfAbsent(tab, t -> new HashSet<>()); }

	private List<Section> sections() { return tab == Tab.SHADER ? SHADER_SECTIONS : RESOURCE_SECTIONS; }

	private List<List<String>> filterGroups() {
		List<List<String>> groups = new ArrayList<>();
		for (Section section : sections()) {
			List<String> chosen = section.tags.stream().filter(filters()::contains).toList();
			if (!chosen.isEmpty()) groups.add(chosen);
		}
		return groups;
	}

	private void load(boolean append) {
		if (tab == Tab.INSTALLED) {
			installedAll.clear();
			installedAll.addAll(Modrinth.installedHits());
			loading = false;
			failed = false;
			refilter();
			return;
		}
		int current = ++generation, offset = append ? hits.size() : 0;
		loading = true;
		failed = false;
		Modrinth.Kind kind = tab == Tab.SHADER ? Modrinth.Kind.SHADER : Modrinth.Kind.RESOURCE;
		Modrinth.search(kind, search.value().strip(), offset, sort, filterGroups()).whenComplete((result, error) -> minecraft.execute(() -> {
			if (current != generation) return;
			loading = false;
			if (error != null) {
				failed = true;
				return;
			}
			if (!append) {
				hits.clear();
				scroll = scrollTarget = 0;
			}
			hits.addAll(result.hits());
			total = result.total();
		}));
	}

	// --- İndirilenler: yerel arama, görünüm ve sıralama ---

	private static boolean active(Modrinth.Hit h) {
		String file = Modrinth.installedFile(h.id());
		return file != null && (h.kind() == Modrinth.Kind.RESOURCE ? Modrinth.resourceActive(file) : Modrinth.shaderActive(file));
	}

	private static boolean shows(Show s, Modrinth.Hit h, boolean on) {
		return switch (s) {
			case ALL -> true;
			case RESOURCE -> h.kind() == Modrinth.Kind.RESOURCE;
			case SHADER -> h.kind() == Modrinth.Kind.SHADER;
			case FAVORITE -> Modrinth.favorite(h.id());
			case ACTIVE -> on;
		};
	}

	private static boolean matches(Modrinth.Hit h, String query) {
		if (query.isEmpty()) return true;
		for (String text : new String[] {h.title(), h.author(), h.description(), Objects.requireNonNullElse(Modrinth.installedFile(h.id()), "")})
			if (text.toLowerCase(Locale.ROOT).contains(query)) return true;
		return false;
	}

	/**
	 * Tam listeden görünür satırları üretir. Dosya ve etkinlik bilgisi burada bir kez okunur;
	 * çizim sırasında sayılar yeniden hesaplanmaz. Favoriler her sıralamada en üstte kalır.
	 */
	private void refilter() {
		String query = localSearch.value().strip().toLowerCase(Locale.ROOT);
		Map<String, Boolean> on = new HashMap<>();
		Map<String, Long> at = new HashMap<>();
		for (Modrinth.Hit h : installedAll) {
			on.put(h.id(), active(h));
			at.put(h.id(), Modrinth.installedAt(h.id()));
		}
		showCounts.clear();
		hits.clear();
		for (Modrinth.Hit h : installedAll) {
			boolean found = matches(h, query);
			for (Show s : Show.values()) if (found && shows(s, h, on.get(h.id()))) showCounts.merge(s, 1, Integer::sum);
			if (found && shows(show, h, on.get(h.id()))) hits.add(h);
		}
		Comparator<Modrinth.Hit> recent = Comparator.comparingLong((Modrinth.Hit h) -> at.get(h.id())).reversed();
		Comparator<Modrinth.Hit> order = switch (localSort) {
			case "name" -> Comparator.comparing((Modrinth.Hit h) -> h.title().toLowerCase(Locale.ROOT));
			case "active" -> Comparator.comparing((Modrinth.Hit h) -> !on.get(h.id())).thenComparing(recent);
			default -> recent;
		};
		hits.sort(Comparator.comparing((Modrinth.Hit h) -> !Modrinth.favorite(h.id())).thenComparing(order));
		total = hits.size();
	}

	private void cycleLocalSort() {
		localSort = LOCAL_SORTS.get((LOCAL_SORTS.indexOf(localSort) + 1) % LOCAL_SORTS.size());
		refilter();
	}

	/** Bir işlemden sonra İndirilenler listesi güncel kalsın (etkinlik, favori, silme). */
	private Runnable thenRefresh(Runnable action) {
		if (action == null) return null;
		return () -> {
			action.run();
			if (tab == Tab.INSTALLED) load(false);
		};
	}

	private void select(Tab t) {
		tab = t;
		detail = null;
		zoom = null;
		showFilters = false;
		hits.clear();
		scroll = scrollTarget = sideScroll = sideTarget = 0;
		Modrinth.clearError();
		focus(field());
		load(false);
	}

	private void openDetail(Modrinth.Hit hit) {
		detail = hit;
		project = null;
		detailFailed = false;
		page = Page.BODY;
		lines = null;
		linesWidth = -1;
		scroll = scrollTarget = 0;
		if (minecraft != null) focus(null);
		Modrinth.project(hit).whenComplete((result, error) -> net.minecraft.client.Minecraft.getInstance().execute(() -> {
			if (detail != hit) return;
			detailFailed = error != null;
			project = result;
		}));
	}

	private void closeDetail() {
		detail = null;
		zoom = null;
		scroll = scrollTarget = 0;
		focus(field());
		// Proje sayfasında favori/silme yapılmış olabilir.
		if (tab == Tab.INSTALLED) load(false);
	}

	@Override public void onClose() {
		if (zoom != null) zoom = null;
		else if (detail != null) closeDetail();
		else super.onClose();
	}

	/** Alt menüdeki düğme her durumda sekmeyi kapatır. */
	@Override protected void closeFromDock() { minecraft.gui.setScreen(parent); }

	// --- Çizim ---

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		if (searchAt != 0 && System.currentTimeMillis() >= searchAt) {
			searchAt = 0;
			load(false);
		}
		placeFrame(800, 440);
		Theme.rounded(g, fx, fy, fx + fw, fy + fh, 7, BG);
		g.fill(fx + 7, fy, fx + fw - 7, fy + 1, Theme.withAlpha(GREEN, 0x90));
		header(g);
		if (detail != null) drawDetail(g);
		else drawBrowse(g);
		statusStrip(g);
		if (zoom != null) drawZoom(g);
	}

	private void header(GuiGraphicsExtractor g) {
		Theme.modrinthLogo(g, fx + 10, fy + 7, 16);
		String word = "modrinth";
		Theme.scaledText(g, word, fx + 30, fy + 9, 1.5f, GREEN, false);
		int x = fx + 30 + (int) (font.width(word) * 1.5f) + 12;
		for (Tab t : Tab.values()) {
			String label = L.t("modrinth.tab." + t.name().toLowerCase(Locale.ROOT));
			int w = font.width(label) + 14;
			boolean active = t == tab, hov = hit(x, fy + 7, x + w, fy + 23, () -> select(t));
			Theme.rounded(g, x, fy + 7, x + w, fy + 23, 8, active ? GREEN_SOFT : hov ? RAISED_HOVER : 0);
			g.text(font, label, x + 7, fy + 11, active ? GREEN : hov ? Theme.TEXT : SUB, false);
			x += w + 3;
		}
		if (iconButton(g, fx + fw - 24, fy + 7, 16, parent != null ? "back" : "close", this::closeFromDock)) tipNow(L.t(parent != null ? "common.back" : "common.close"));
		g.fill(fx + 1, fy + HEADER, fx + fw - 1, fy + HEADER + 1, RULE);
	}

	private boolean brandButton(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, String label, boolean brand, Runnable action, boolean clip) {
		boolean hov = action != null && (clip ? clipped(x1, y1, x2, y2, action) : hit(x1, y1, x2, y2, action));
		Theme.rounded(g, x1, y1, x2, y2, 4, brand ? (hov ? GREEN_HOVER : GREEN) : hov ? 0xFF3A3F47 : CONTROL);
		String text = Theme.ellipsize(label, x2 - x1 - 8);
		g.text(font, text, (x1 + x2 - font.width(text)) / 2, (y1 + y2) / 2 - 4, brand ? INK : action == null ? DIM : hov ? Theme.TEXT : SUB, false);
		return hov;
	}

	private boolean clipped(int x1, int y1, int x2, int y2, Runnable action) {
		int top = Math.max(y1, listY1), bottom = Math.min(y2, listY2);
		return bottom > top && action != null && hit(x1, top, x2, bottom, action);
	}

	private void statusStrip(GuiGraphicsExtractor g) {
		int x1 = fx + 12, x2 = fx + fw - 12, y = fy + fh - 15;
		String error = Modrinth.error();
		String credit = "modrinth.com";
		int creditX = x2 - font.width(credit) - 12;
		boolean link = hit(creditX, y - 1, x2, y + 10, () -> Blaze3D.openUri(URI.create("https://modrinth.com")));
		g.text(font, credit, creditX, y, link ? GREEN_HOVER : GREEN, false);
		PixelIcons.drawCentered(g, "external", x2 - 4, y + 4, 1, link ? GREEN_HOVER : GREEN);
		if (link) tipNow(L.t("modrinth.openSite"));
		int room = creditX - x1 - 10;
		if (error != null) {
			Runnable help = Support.opener(Support.discord().isEmpty() ? Support.website() : Support.discord());
			if (help != null) {
				room -= 58;
				brandButton(g, x1 + room + 4, y - 3, x1 + room + 54, y + 10, L.t("support.getHelp"), false, help, false);
			}
			g.text(font, Theme.ellipsize(error, room), x1, y, ORANGE, false);
			return;
		}
		String note = detail != null ? "" : tab != Tab.INSTALLED ? L.t("modrinth.results", String.format(Locale.ROOT, "%,d", total))
			: hits.size() == installedAll.size() ? L.t("modrinth.count", hits.size()) : L.t("modrinth.countOf", hits.size(), installedAll.size());
		String unofficial = L.t("modrinth.unofficial");
		g.text(font, Theme.ellipsize(note.isEmpty() ? unofficial : note + "  ·  " + unofficial, room), x1, y, DIM, false);
	}

	private void drawBrowse(GuiGraphicsExtractor g) {
		int x1 = fx + 12, x2 = fx + fw - 12, y = fy + HEADER + 7, bottom = fy + fh - 20;
		boolean filterable = tab != Tab.INSTALLED, narrow = fw < NARROW;
		int listRight = filterable && !narrow ? x2 - SIDE_W - 8 : x2;
		if (!filterable) {
			int sortW = 120, fieldRight = x2 - sortW - 4;
			textField(g, x1, y, fieldRight, y + 17, localSearch, 11, "search");
			String label = L.t("modrinth.sortLabel", L.t("modrinth.sort." + localSort));
			if (brandButton(g, fieldRight + 4, y, x2, y + 17, label, false, this::cycleLocalSort, false)) tipNow(L.t("modrinth.sortHint"));
			y = chips(g, x1, y + 22, x2) + 5;
		}
		if (filterable) {
			int sortW = 110, filterW = narrow ? 60 : 0, fieldRight = listRight - sortW - filterW - (narrow ? 8 : 4);
			textField(g, x1, y, fieldRight, y + 17, search, 11, "search");
			String label = L.t("modrinth.sortLabel", L.t("modrinth.sort." + sort));
			if (brandButton(g, fieldRight + 4, y, fieldRight + 4 + sortW, y + 17, label, false, this::cycleSort, false)) tipNow(L.t("modrinth.sortHint"));
			if (narrow) {
				int count = filters().size();
				brandButton(g, x2 - filterW, y, x2, y + 17, L.t("modrinth.filters") + (count > 0 ? " " + count : ""), showFilters, () -> showFilters = !showFilters, false);
			}
			y += 23;
		}
		if (filterable && !narrow) sidebar(g, listRight + 8, fy + HEADER + 7, x2, bottom);
		if (filterable && narrow && showFilters) {
			sidebar(g, x1, y, x2, bottom);
			return;
		}
		if (tab == Tab.SHADER && !Modrinth.irisLoaded()) y = irisBanner(g, x1, y, listRight);
		listY1 = y;
		listY2 = bottom;
		list(g, x1, listRight);
	}

	/** Tür/favori/etkin görünüm çipleri; sığmazsa alt satıra geçer. Alt kenarı döner. */
	private int chips(GuiGraphicsExtractor g, int x1, int y, int x2) {
		int x = x1;
		for (Show s : Show.values()) {
			String label = L.t("modrinth.show." + s.name().toLowerCase(Locale.ROOT));
			String count = Integer.toString(showCounts.getOrDefault(s, 0));
			boolean star = s == Show.FAVORITE;
			int w = font.width(label) + font.width(count) + 18 + (star ? 13 : 0);
			if (x > x1 && x + w > x2) {
				x = x1;
				y += 17;
			}
			boolean on = s == show, hov = hit(x, y, x + w, y + 14, () -> {
				show = s;
				scroll = scrollTarget = 0;
				refilter();
			});
			Theme.rounded(g, x, y, x + w, y + 14, 7, on ? GREEN_SOFT : hov ? RAISED_HOVER : RAISED);
			int tx = x + 7;
			if (star) {
				PixelIcons.drawCentered(g, "star", tx + 4, y + 7, 1, on ? GOLD : hov ? Theme.TEXT : DIM);
				tx += 13;
			}
			g.text(font, label, tx, y + 3, on ? GREEN : hov ? Theme.TEXT : SUB, false);
			g.text(font, count, tx + font.width(label) + 4, y + 3, on ? GREEN : DIM, false);
			x += w + 4;
		}
		return y + 14;
	}

	private void cycleSort() {
		sort = SORTS.get((SORTS.indexOf(sort) + 1) % SORTS.size());
		load(false);
	}

	private int irisBanner(GuiGraphicsExtractor g, int x1, int y, int x2) {
		Theme.rounded(g, x1, y, x2, y + 22, 4, 0x30E5A04D);
		String text = L.t(Modrinth.irisInstalled() ? "modrinth.irisRestart" : Modrinth.sodiumLoaded() ? "modrinth.irisMissing" : "modrinth.sodiumMissing");
		boolean canInstall = Modrinth.sodiumLoaded() && !Modrinth.irisInstalled();
		int room = x2 - x1 - 12 - (canInstall ? 110 : 0);
		g.text(font, Theme.ellipsize(text, room), x1 + 7, y + 7, 0xFFE5C07A, false);
		if (canInstall) {
			boolean working = Modrinth.progress("iris") >= 0;
			brandButton(g, x2 - 104, y + 3, x2 - 4, y + 19, L.t(working ? "modrinth.installing" : "modrinth.installIris"), !working, working ? null : Modrinth::installIris, false);
		}
		return y + 28;
	}

	// --- Filtreler ---

	private void sidebar(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		Theme.rounded(g, x1, y1, x2, y2, 5, 0xFF1B1E22);
		g.text(font, L.t("modrinth.filters"), x1 + 8, y1 + 7, Theme.TEXT, false);
		if (!filters().isEmpty()) {
			String clear = L.t("modrinth.clearFilters");
			int cx = x2 - font.width(clear) - 8;
			boolean hov = hit(cx, y1 + 5, x2 - 6, y1 + 17, () -> {
				filters().clear();
				load(false);
			});
			g.text(font, clear, cx, y1 + 7, hov ? GREEN_HOVER : GREEN, false);
		}
		sideY1 = y1 + 20;
		sideY2 = y2 - 4;
		int content = 0;
		for (Section section : sections()) content += FILTER_ROW + 3 + (COLLAPSED.contains(section.key) ? 0 : section.tags.size() * FILTER_ROW);
		sideMax = Math.max(0, content - (sideY2 - sideY1));
		sideTarget = Math.max(0, Math.min(sideMax, sideTarget));
		sideScroll += (sideTarget - sideScroll) * Math.min(1, dt * 16);
		int y = sideY1 - (int) Math.round(sideScroll);
		g.enableScissor(x1, sideY1, x2, sideY2);
		for (Section section : sections()) {
			boolean open = !COLLAPSED.contains(section.key);
			boolean hov = sideHit(x1, y, x2, y + FILTER_ROW, () -> {
				if (!COLLAPSED.remove(section.key)) COLLAPSED.add(section.key);
			});
			g.text(font, L.t("modrinth.section." + section.key), x1 + 8, y + 3, hov ? Theme.TEXT : SUB, false);
			g.text(font, open ? "−" : "+", x2 - 13, y + 3, DIM, false);
			y += FILTER_ROW;
			if (open) for (String tag : section.tags) {
				filterRow(g, tag, x1 + 8, y, x2 - 6);
				y += FILTER_ROW;
			}
			y += 3;
		}
		g.disableScissor();
		if (sideMax > 0) {
			int track = sideY2 - sideY1, bar = Math.max(14, track * track / (content + 1)), barY = sideY1 + (int) ((track - bar) * (sideScroll / sideMax));
			g.fill(x2 - 3, barY, x2 - 1, barY + bar, Theme.withAlpha(GREEN, 0x90));
		}
	}

	private boolean sideHit(int x1, int y1, int x2, int y2, Runnable action) {
		int top = Math.max(y1, sideY1), bottom = Math.min(y2, sideY2);
		return bottom > top && hit(x1, top, x2, bottom, action);
	}

	private void filterRow(GuiGraphicsExtractor g, String tag, int x1, int y, int x2) {
		boolean on = filters().contains(tag);
		boolean hov = sideHit(x1, y, x2, y + FILTER_ROW, () -> {
			if (!filters().remove(tag)) filters().add(tag);
			searchAt = System.currentTimeMillis() + 150;
		});
		Theme.rounded(g, x1, y + 2, x1 + 9, y + 11, 2, on ? GREEN : hov ? 0xFF484E57 : CONTROL);
		if (on) {
			g.fill(x1 + 2, y + 6, x1 + 4, y + 8, INK);
			g.fill(x1 + 3, y + 7, x1 + 5, y + 9, INK);
			g.fill(x1 + 5, y + 5, x1 + 7, y + 7, INK);
			g.fill(x1 + 4, y + 6, x1 + 6, y + 8, INK);
		}
		g.text(font, L.t("modrinth.tag." + tag), x1 + 13, y + 3, on ? GREEN : hov ? Theme.TEXT : SUB, false);
	}

	// --- Liste ---

	private void list(GuiGraphicsExtractor g, int x1, int x2) {
		int contentH = hits.size() * ROW;
		maxScroll = Math.max(0, contentH - (listY2 - listY1));
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget));
		scroll += (scrollTarget - scroll) * Math.min(1, dt * 16);
		if (!loading && tab != Tab.INSTALLED && hits.size() < total && scrollTarget >= maxScroll - ROW) load(true);
		int cx = (x1 + x2) / 2;
		if (hits.isEmpty()) {
			String key = loading ? "modrinth.loading" : failed ? "modrinth.failed"
				: tab == Tab.INSTALLED ? (installedAll.isEmpty() ? "modrinth.noneInstalled" : show == Show.FAVORITE && localSearch.value().isBlank() ? "modrinth.noFavorites" : "modrinth.noMatch")
				: "modrinth.empty";
			g.centeredText(font, L.t(key), cx, listY1 + 40, Theme.MUTED);
			return;
		}
		int right = x2 - 5;
		g.enableScissor(x1 - 1, listY1, x2 + 1, listY2);
		for (int i = 0; i < hits.size(); i++) {
			int y = listY1 + i * ROW - (int) Math.round(scroll);
			if (y + ROW >= listY1 && y <= listY2) row(g, hits.get(i), x1, y, right);
		}
		g.disableScissor();
		if (maxScroll > 0) {
			int trackH = listY2 - listY1, barH = Math.max(18, trackH * trackH / contentH), barY = listY1 + (int) ((trackH - barH) * (scroll / maxScroll));
			g.fill(x2 - 2, barY, x2, barY + barH, Theme.withAlpha(GREEN, 0x90));
		}
	}

	/** Paketin durumuna göre ana düğme: indir, indiriliyor, etkinleştir ya da kapat. */
	private Act action(Modrinth.Hit h) {
		String file = Modrinth.installedFile(h.id());
		boolean resource = h.kind() == Modrinth.Kind.RESOURCE;
		boolean active = file != null && (resource ? Modrinth.resourceActive(file) : Modrinth.shaderActive(file));
		int progress = Modrinth.progress(h.id());
		if (progress >= 0) return new Act(progress + "%", false, null);
		if (file == null) return new Act(L.t("modrinth.download"), true, () -> install(h, null));
		if (!resource && !Modrinth.irisLoaded()) return new Act(L.t("modrinth.installed"), false, null);
		return new Act(L.t(active ? "modrinth.disable" : "modrinth.enable"), !active, () -> {
			if (resource) Modrinth.toggleResource(file);
			else Modrinth.toggleShader(file);
		});
	}

	private void install(Modrinth.Hit h, Modrinth.Release release) {
		Modrinth.install(h, release).whenComplete((v, e) -> minecraft.execute(() -> {
			if (tab == Tab.INSTALLED) load(false);
		}));
	}

	private void row(GuiGraphicsExtractor g, Modrinth.Hit h, int x1, int y, int x2) {
		boolean inList = mouseY >= listY1 && mouseY < listY2 && hover(x1, y, x2, y + ROW - 4);
		clipped(x1, y, x2, y + ROW - 4, () -> openDetail(h));
		Theme.rounded(g, x1, y, x2, y + ROW - 4, 5, inList ? RAISED_HOVER : RAISED);
		icon(g, h, x1 + 5, y + 5, 40);
		int bw = 84, bx = x2 - bw - 6, by = y + 27;
		Act act = action(h);
		brandButton(g, bx, by, bx + bw, by + 17, act.label, act.brand, thenRefresh(act.run), true);
		String file = Modrinth.installedFile(h.id());
		if (file != null && tab == Tab.INSTALLED) favoriteStar(g, h, x2 - 17, y + 4, true);
		boolean resource = h.kind() == Modrinth.Kind.RESOURCE, active = file != null && (resource ? Modrinth.resourceActive(file) : Modrinth.shaderActive(file));
		if (file != null && !active && Modrinth.progress(h.id()) < 0) {
			int tx = bx - 18;
			boolean hovTrash = clipped(tx, by, tx + 15, by + 17, () -> {
				Modrinth.remove(h);
				if (tab == Tab.INSTALLED) load(false);
			});
			PixelIcons.drawCentered(g, "trash", tx + 7, by + 8, 1, hovTrash ? RED : DIM);
			if (hovTrash) tipNow(L.t("modrinth.remove"));
		}
		if (h.downloads() > 0) {
			String count = compact(h.downloads()), stars = compact(h.follows());
			int sx = x2 - 6 - font.width(stars);
			g.text(font, stars, sx, y + 8, SUB, false);
			PixelIcons.drawCentered(g, "star", sx - 7, y + 12, 1, DIM);
			int dx = sx - 18 - font.width(count);
			g.text(font, count, dx, y + 8, SUB, false);
			PixelIcons.drawCentered(g, "download", dx - 7, y + 12, 1, DIM);
		}
		int tx = x1 + 52, room = bx - tx - 24;
		int nameRoom = Math.max(40, x2 - 100 - tx);
		String title = Theme.ellipsize(h.title(), nameRoom);
		g.text(font, title, tx, y + 7, inList ? GREEN : Theme.TEXT, false);
		String by2 = L.t("modrinth.by", h.author());
		g.text(font, Theme.ellipsize(by2, Math.max(0, nameRoom - font.width(title) - 6)), tx + font.width(title) + 6, y + 7, DIM, false);
		g.text(font, Theme.ellipsize(h.description(), room + 18), tx, y + 19, SUB, false);
		int cx = tx;
		if (tab == Tab.INSTALLED) {
			// İndirilen paketlerde etiket yerine tür, durum ve sürüm gösterilir.
			cx = badge(g, L.t(h.kind() == Modrinth.Kind.SHADER ? "modrinth.kind.shader" : "modrinth.kind.resource"), cx, y + 33, bx - 22, SUB, 0x22FFFFFF);
			if (active) cx = badge(g, L.t("modrinth.activeBadge"), cx, y + 33, bx - 22, GREEN, GREEN_SOFT);
			String number = Modrinth.installedNumber(h.id());
			if (!number.isEmpty()) badge(g, "v" + number, cx, y + 33, bx - 22, DIM, 0x14FFFFFF);
			return;
		}
		for (String c : h.categories()) {
			String label = L.t("modrinth.tag." + c);
			// "minecraft", "iris" gibi yükleyici etiketleri filtre değildir, gösterilmez.
			if (label.startsWith("pclient.")) continue;
			int w = (int) (font.width(label) * 0.75f) + 8;
			if (cx + w > bx - 22) break;
			Theme.rounded(g, cx, y + 33, cx + w, y + 44, 3, 0x22FFFFFF);
			Theme.scaledText(g, label, cx + 4, y + 35.5f, 0.75f, SUB, false);
			cx += w + 3;
		}
	}

	/** Küçük etiket rozeti; sığmazsa çizilmez. Sonraki rozetin x'ini döner. */
	private int badge(GuiGraphicsExtractor g, String label, int x, int y, int limit, int color, int fill) {
		int w = (int) (font.width(label) * 0.75f) + 8;
		if (x + w > limit) return x;
		Theme.rounded(g, x, y, x + w, y + 11, 3, fill);
		Theme.scaledText(g, label, x + 4, y + 2.5f, 0.75f, color, false);
		return x + w + 3;
	}

	/** Favori yıldızı: doluysa altın, değilse soluk; tıklayınca durum değişir. */
	private void favoriteStar(GuiGraphicsExtractor g, Modrinth.Hit h, int x, int y, boolean inList) {
		boolean fav = Modrinth.favorite(h.id());
		Runnable toggle = () -> {
			Modrinth.toggleFavorite(h.id());
			if (tab == Tab.INSTALLED && detail == null) refilter();
		};
		boolean hov = inList ? clipped(x, y, x + 13, y + 13, toggle) : hit(x, y, x + 13, y + 13, toggle);
		if (hov) Theme.rounded(g, x, y, x + 13, y + 13, 3, 0x22FFFFFF);
		PixelIcons.drawCentered(g, "star", x + 7, y + 7, 1, fav ? GOLD : hov ? Theme.TEXT : 0xFF555B64);
		if (hov) tipNow(L.t(fav ? "modrinth.unfavorite" : "modrinth.favorite"));
	}

	private void icon(GuiGraphicsExtractor g, Modrinth.Hit h, int x, int y, int size) {
		PcTextures.Image image = null;
		if (!h.icon().isEmpty()) {
			String key = "mr:" + h.icon();
			imageKeys.add(key);
			image = PcTextures.get(key, () -> Modrinth.icon(h.icon()));
		}
		if (image != null) image.blit(g, x, y, size, size);
		else {
			Theme.rounded(g, x, y, x + size, y + size, 4, 0x20FFFFFF);
			PixelIcons.drawCentered(g, h.kind() == Modrinth.Kind.SHADER ? "sun" : "image", x + size / 2, y + size / 2, 2, DIM);
		}
	}

	private static String compact(long n) {
		if (n >= 1_000_000) return String.format(Locale.ROOT, "%.1fM", n / 1_000_000.0);
		if (n >= 1_000) return String.format(Locale.ROOT, "%.0fK", n / 1_000.0);
		return Long.toString(n);
	}

	// --- Proje sayfası ---

	private void drawDetail(GuiGraphicsExtractor g) {
		int x1 = fx + 12, x2 = fx + fw - 12, y = fy + HEADER + 7;
		if (iconButton(g, x1, y, 16, "back", this::closeDetail)) tipNow(L.t("common.back"));
		icon(g, detail, x1 + 22, y, 40);
		int tx = x1 + 70, bw = 104, bx = x2 - bw;
		int room = bx - tx - 8;
		Theme.scaledText(g, Theme.ellipsize(detail.title(), (int) (room / 1.25f)), tx, y + 1, 1.25f, Theme.TEXT, false);
		g.text(font, Theme.ellipsize(L.t("modrinth.by", detail.author()), room), tx, y + 15, SUB, false);
		g.text(font, Theme.ellipsize(detail.description(), room), tx, y + 27, DIM, false);
		Act act = action(detail);
		brandButton(g, bx, y, x2, y + 20, act.label, act.brand, act.run, false);
		if (Modrinth.installedFile(detail.id()) != null) favoriteStar(g, detail, bx - 18, y + 3, false);
		brandButton(g, bx, y + 24, x2, y + 40, L.t("modrinth.openWeb"), false, () -> Blaze3D.openUri(URI.create("https://modrinth.com/project/" + detail.id())), false);
		y += 47;
		int tabs = x1;
		for (Page p : Page.values()) {
			String label = L.t("modrinth.page." + p.name().toLowerCase(Locale.ROOT)) + (project == null ? "" : switch (p) {
				case GALLERY -> " " + project.gallery().size();
				case VERSIONS -> " " + project.releases().size();
				default -> "";
			});
			int w = font.width(label) + 14;
			boolean active = p == page, hov = hit(tabs, y, tabs + w, y + 15, () -> {
				page = p;
				scroll = scrollTarget = 0;
			});
			g.text(font, label, tabs + 7, y + 3, active ? GREEN : hov ? Theme.TEXT : SUB, false);
			if (active) g.fill(tabs + 3, y + 13, tabs + w - 3, y + 15, GREEN);
			tabs += w + 2;
		}
		y += 15;
		g.fill(x1, y, x2, y + 1, RULE);
		y += 5;
		listY1 = y;
		listY2 = fy + fh - 20;
		boolean wide = fw >= NARROW;
		int contentRight = wide ? x2 - SIDE_W - 8 : x2;
		if (project == null) {
			g.centeredText(font, L.t(detailFailed ? "modrinth.failed" : "modrinth.loading"), (x1 + contentRight) / 2, listY1 + 30, Theme.MUTED);
			return;
		}
		if (wide) info(g, contentRight + 8, listY1, x2, listY2);
		int contentH = switch (page) {
			case BODY -> bodyHeight(contentRight - x1 - 8);
			case GALLERY -> galleryHeight(contentRight - x1 - 8);
			case VERSIONS -> project.releases().size() * 28;
		};
		maxScroll = Math.max(0, contentH - (listY2 - listY1));
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget));
		scroll += (scrollTarget - scroll) * Math.min(1, dt * 16);
		int top = listY1 - (int) Math.round(scroll);
		g.enableScissor(x1 - 1, listY1, contentRight + 1, listY2);
		switch (page) {
			case BODY -> drawBody(g, x1, top);
			case GALLERY -> drawGallery(g, x1, top, contentRight - x1 - 8);
			case VERSIONS -> drawVersions(g, x1, top, contentRight - 6);
		}
		g.disableScissor();
		if (maxScroll > 0) {
			int trackH = listY2 - listY1, barH = Math.max(18, trackH * trackH / contentH), barY = listY1 + (int) ((trackH - barH) * (scroll / maxScroll));
			g.fill(contentRight - 2, barY, contentRight, barY + barH, Theme.withAlpha(GREEN, 0x90));
		}
	}

	private int bodyHeight(int width) {
		if (lines == null || linesWidth != width) {
			lines = new ArrayList<>();
			linesWidth = width;
			for (MarkdownText.Block block : MarkdownText.parse(project.body())) {
				switch (block.kind()) {
					case RULE -> lines.add(new Line(null, 0, 0, 10, true));
					case HEADING -> {
						lines.add(new Line(null, 0, 0, 4, false));
						for (FormattedCharSequence s : font.split(Component.literal(block.text()).withStyle(ChatFormatting.BOLD), width)) lines.add(new Line(s, Theme.TEXT, 0, 12, false));
						lines.add(new Line(null, 0, 0, 2, false));
					}
					case BULLET -> {
						boolean first = true;
						for (FormattedCharSequence s : font.split(FormattedText.of(block.text()), width - 10)) {
							lines.add(new Line(s, SUB, first ? 10 : -10, 10, false));
							first = false;
						}
						lines.add(new Line(null, 0, 0, 2, false));
					}
					default -> {
						for (FormattedCharSequence s : font.split(FormattedText.of(block.text()), width)) lines.add(new Line(s, SUB, 0, 10, false));
						lines.add(new Line(null, 0, 0, 6, false));
					}
				}
			}
			if (lines.isEmpty()) lines.add(new Line(font.split(FormattedText.of(detail.description()), width).getFirst(), SUB, 0, 10, false));
		}
		return lines.stream().mapToInt(Line::height).sum();
	}

	private void drawBody(GuiGraphicsExtractor g, int x, int y) {
		for (Line line : lines) {
			if (y + line.height >= listY1 && y <= listY2) {
				if (line.rule) g.fill(x, y + 4, x + linesWidth, y + 5, RULE);
				else if (line.text != null) {
					// Madde işaretinin devam satırları (negatif girinti) aynı hizada başlar.
					if (line.indent > 0) g.fill(x + 3, y + 3, x + 6, y + 6, GREEN);
					g.text(font, line.text, x + Math.abs(line.indent), y, line.color, false);
				}
			}
			y += line.height;
		}
	}

	private int galleryColumns(int width) { return width >= 330 ? 3 : 2; }

	private int galleryCellH(int width) {
		int columns = galleryColumns(width);
		return ((width - (columns - 1) * 6) / columns) * 9 / 16;
	}

	private int galleryHeight(int width) {
		int size = project.gallery().size(), rows = (size + galleryColumns(width) - 1) / galleryColumns(width);
		return size == 0 ? 40 : rows * (galleryCellH(width) + 6);
	}

	private void drawGallery(GuiGraphicsExtractor g, int x, int y, int width) {
		List<Modrinth.Shot> gallery = project.gallery();
		if (gallery.isEmpty()) {
			g.centeredText(font, L.t("modrinth.noGallery"), x + width / 2, y + 16, Theme.MUTED);
			return;
		}
		int columns = galleryColumns(width), cellH = galleryCellH(width), cellW = (width - (columns - 1) * 6) / columns;
		for (int i = 0; i < gallery.size(); i++) {
			Modrinth.Shot shot = gallery.get(i);
			int cx = x + (i % columns) * (cellW + 6), cy = y + (i / columns) * (cellH + 6);
			if (cy + cellH < listY1 || cy > listY2) continue;
			boolean hov = mouseY >= listY1 && mouseY < listY2 && hover(cx, cy, cx + cellW, cy + cellH);
			clipped(cx, cy, cx + cellW, cy + cellH, () -> zoom = shot);
			g.fill(cx, cy, cx + cellW, cy + cellH, 0xFF0D0F12);
			PcTextures.Image image = galleryImage(shot.url(), 512);
			if (image != null) image.cover(g, cx, cy, cellW, cellH);
			else PixelIcons.drawCentered(g, "image", cx + cellW / 2, cy + cellH / 2, 2, DIM);
			if (hov) g.outline(cx, cy, cellW, cellH, GREEN);
		}
	}

	private PcTextures.Image galleryImage(String url, int size) {
		String key = "mrg:" + size + ":" + url;
		imageKeys.add(key);
		return PcTextures.get(key, () -> Modrinth.image(url, size));
	}

	private void drawVersions(GuiGraphicsExtractor g, int x1, int y, int x2) {
		List<Modrinth.Release> releases = project.releases();
		if (releases.isEmpty()) {
			g.centeredText(font, L.t("modrinth.noVersions"), (x1 + x2) / 2, y + 16, Theme.MUTED);
			return;
		}
		String installed = Modrinth.installedVersion(detail.id());
		boolean busy = Modrinth.progress(detail.id()) >= 0;
		for (Modrinth.Release release : releases) {
			if (y + 28 >= listY1 && y <= listY2) {
				Theme.rounded(g, x1, y, x2, y + 25, 4, RAISED);
				int badgeColor = switch (release.type()) {
					case "release" -> GREEN;
					case "beta" -> ORANGE;
					default -> RED;
				};
				String badge = L.t("modrinth.release." + release.type());
				int bw = font.width(badge) + 8;
				Theme.rounded(g, x1 + 5, y + 7, x1 + 5 + bw, y + 18, 3, Theme.withAlpha(badgeColor, 0x38));
				g.text(font, badge, x1 + 9, y + 9, badgeColor, false);
				int tx = x1 + bw + 11, buttonX = x2 - 74;
				String meta = L.t("modrinth.versionMeta", compact(release.downloads()), release.date());
				int room = buttonX - tx - 8 - font.width(meta);
				g.text(font, Theme.ellipsize(release.name().isEmpty() ? release.number() : release.name(), Math.max(0, room)), tx, y + 9, Theme.TEXT, false);
				g.text(font, meta, buttonX - 6 - font.width(meta), y + 9, DIM, false);
				boolean current = release.id().equals(installed);
				brandButton(g, buttonX, y + 4, x2 - 5, y + 21, L.t(current ? "modrinth.installed" : "modrinth.download"), !current, current || busy ? null : () -> install(detail, release), true);
			}
			y += 28;
		}
	}

	private void info(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2) {
		Theme.rounded(g, x1, y1, x2, y2, 5, 0xFF1B1E22);
		int x = x1 + 8, w = x2 - x1 - 16, y = y1 + 8;
		y = fact(g, "modrinth.info.downloads", String.format(Locale.ROOT, "%,d", detail.downloads()), x, y, w);
		y = fact(g, "modrinth.info.followers", String.format(Locale.ROOT, "%,d", project.followers()), x, y, w);
		y = fact(g, "modrinth.info.updated", project.updated(), x, y, w);
		y = fact(g, "modrinth.info.published", project.published(), x, y, w);
		if (!project.license().isEmpty()) y = fact(g, "modrinth.info.license", project.license(), x, y, w);
		y += 2;
		int lx = x;
		for (String[] link : new String[][] {{"modrinth.link.source", project.source()}, {"modrinth.link.issues", project.issues()}, {"modrinth.link.wiki", project.wiki()}, {"modrinth.link.discord", project.discord()}}) {
			if (link[1].isEmpty() || !link[1].startsWith("http") || y + 11 > y2) continue;
			String label = L.t(link[0]);
			int lw = font.width(label);
			if (lx + lw > x + w) {
				lx = x;
				y += 11;
			}
			URI uri = URI.create(link[1]);
			boolean hov = hit(lx, y - 1, lx + lw, y + 10, () -> Blaze3D.openUri(uri));
			g.text(font, label, lx, y, hov ? GREEN_HOVER : GREEN, false);
			lx += lw + 8;
		}
	}

	private int fact(GuiGraphicsExtractor g, String key, String value, int x, int y, int w) {
		g.text(font, L.t(key), x, y, DIM, false);
		g.text(font, Theme.ellipsize(value, w), x, y + 10, Theme.TEXT, false);
		return y + 24;
	}

	private void drawZoom(GuiGraphicsExtractor g) {
		g.nextStratum();
		hit(0, 0, width, height, () -> zoom = null);
		g.fill(0, 0, width, height, 0xE0000000);
		PcTextures.Image image = galleryImage(zoom.full(), 1024);
		if (image == null) image = galleryImage(zoom.url(), 512);
		if (image != null) image.contain(g, 24, 16, width - 48, height - 40);
		else g.centeredText(font, L.t("modrinth.loading"), width / 2, height / 2, Theme.MUTED);
		if (!zoom.title().isEmpty()) g.centeredText(font, zoom.title(), width / 2, height - 18, Theme.TEXT);
	}

	@Override public boolean mouseScrolled(double x, double y, double h, double v) {
		if (detail == null && tab != Tab.INSTALLED && y >= sideY1 && y < sideY2 && x >= fx + fw - 12 - SIDE_W) sideTarget = Math.max(0, Math.min(sideMax, sideTarget - v * 26));
		else scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget - v * 30));
		return true;
	}

	@Override public void removed() {
		super.removed();
		imageKeys.forEach(PcTextures::release);
		imageKeys.clear();
	}
}
