package com.patron.pclient.gui;

import com.mojang.blaze3d.Blaze3D;
import com.patron.pclient.L;
import java.net.URI;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.metadata.ModMetadata;
import net.fabricmc.loader.api.metadata.Person;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

/** Yüklü Fabric modları: arama, simge, sürüm, açıklama, yazarlar, lisans ve bağlantılar. */
public final class PClientModsScreen extends PcScreen {
	private enum Kind { MOD, LIBRARY, GAME }

	private record Entry(ModContainer container, Kind kind, String name, String version) {
		ModMetadata meta() { return container.getMetadata(); }
	}

	private static final int ROW = 28, LIST_W = 230;
	private static boolean showLibraries;
	private final PcTextField search = new PcTextField(32, L.t("mods.search")).clearOnEscape();
	private final List<Entry> entries = new ArrayList<>();
	private Entry selected;
	private double scroll, scrollTarget, maxScroll;

	public PClientModsScreen(Screen parent) {
		super("title.mods", parent);
		search.onChange(v -> scrollTarget = 0);
		for (ModContainer c : FabricLoader.getInstance().getAllMods()) {
			ModMetadata m = c.getMetadata();
			if (m.getId().equals("java")) continue;
			boolean nested = c.getContainingMod().isPresent(), game = m.getId().equals("minecraft");
			boolean library = nested || m.getId().equals("fabricloader") || (m.containsCustomValue("modmenu") && m.getCustomValue("modmenu").toString().contains("library"));
			entries.add(new Entry(c, game ? Kind.GAME : library ? Kind.LIBRARY : Kind.MOD, m.getName(), m.getVersion().getFriendlyString()));
		}
		entries.sort(Comparator.comparing(Entry::name, String.CASE_INSENSITIVE_ORDER));
	}

	@Override protected void init() { focus(search); }

	@Override protected String dock() { return "mods"; }

	private List<Entry> visible() {
		String q = search.value().toLowerCase(Locale.ROOT).trim();
		List<Entry> out = new ArrayList<>();
		for (Entry e : entries) {
			if (e.kind == Kind.LIBRARY && !showLibraries) continue;
			if (!q.isEmpty() && !(e.name + " " + e.meta().getId() + " " + e.meta().getDescription()).toLowerCase(Locale.ROOT).contains(q)) continue;
			out.add(e);
		}
		return out;
	}

	private PcTextures.Image icon(Entry e) {
		String id = e.meta().getId();
		return PcTextures.get("mod:" + id, () -> {
			String path = e.meta().getIconPath(64).orElseThrow();
			return Files.readAllBytes(e.container.findPath(path).orElseThrow());
		});
	}

	private void drawIcon(GuiGraphicsExtractor g, Entry e, int x, int y, int size) {
		PcTextures.Image image = e.meta().getIconPath(64).isPresent() ? icon(e) : null;
		if (image != null) image.blit(g, x, y, size, size);
		else {
			g.fill(x, y, x + size, y + size, 0x20FFFFFF);
			PixelIcons.drawCentered(g, e.kind == Kind.GAME ? "grass" : "layers", x + size / 2, y + size / 2, size >= 36 ? 2 : 1, Theme.MUTED);
		}
	}

	private String tag(Entry e) {
		return L.t(switch (e.kind) {
			case GAME -> "mods.game";
			case LIBRARY -> "mods.library";
			case MOD -> "mods.mod";
		});
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		frame(g, 620, 340, L.up("mods.title"));
		int x1 = fx + 10, listX2 = fx + Math.min(LIST_W, fw / 2), top = fy + FRAME_HEADER + 8, bottom = fy + fh - 30;
		textField(g, x1, top, listX2, top + 16, search, 11, "search");
		int listY1 = top + 22;
		List<Entry> list = visible();
		if (selected == null || !list.contains(selected)) selected = list.isEmpty() ? null : list.get(0);
		int contentH = list.size() * ROW;
		maxScroll = Math.max(0, contentH - (bottom - listY1));
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget));
		scroll += (scrollTarget - scroll) * Math.min(1, dt * 16);
		g.enableScissor(x1, listY1, listX2 + 1, bottom);
		for (int i = 0; i < list.size(); i++) {
			Entry e = list.get(i);
			int y = listY1 + i * ROW - (int) Math.round(scroll);
			if (y + ROW < listY1 || y > bottom) continue;
			boolean sel = e == selected;
			int cy1 = Math.max(y, listY1), cy2 = Math.min(y + ROW - 2, bottom);
			boolean hov = cy2 > cy1 && hit(x1, cy1, listX2 - 6, cy2, () -> selected = e) && mouseY >= listY1 && mouseY < bottom;
			Theme.notched(g, x1, y, listX2 - 6, y + ROW - 2, 3, sel ? Theme.withAlpha(Theme.accent(), 0x2E) : hov ? Theme.CARD_HOVER : Theme.CARD);
			if (sel) g.fill(x1, y + 3, x1 + 2, y + ROW - 5, Theme.accent());
			drawIcon(g, e, x1 + 6, y + 3, 20);
			int room = listX2 - 6 - x1 - 36;
			g.text(font, Theme.ellipsize(e.name, room), x1 + 31, y + 4, sel ? Theme.TEXT : Theme.MUTED, false);
			g.text(font, Theme.ellipsize(e.version, room), x1 + 31, y + 14, Theme.FAINT, false);
		}
		g.disableScissor();
		if (maxScroll > 0) {
			int trackH = bottom - listY1, barH = Math.max(18, trackH * trackH / contentH), barY = listY1 + (int) ((trackH - barH) * (scroll / maxScroll));
			g.fill(listX2 - 3, listY1, listX2 - 1, bottom, 0x14FFFFFF);
			g.fill(listX2 - 3, barY, listX2 - 1, barY + barH, Theme.withAlpha(Theme.accent(), 0xB0));
		}
		if (list.isEmpty()) g.centeredText(font, L.t("modules.empty"), (x1 + listX2) / 2, listY1 + 24, Theme.MUTED);

		g.fill(listX2 + 4, top, listX2 + 5, bottom, Theme.LINE);
		if (selected != null) details(g, selected, listX2 + 14, top, fx + fw - 12);

		// Alt çubuk
		long mods = entries.stream().filter(e -> e.kind != Kind.LIBRARY).count(), libs = entries.size() - mods;
		g.text(font, L.t("mods.count", mods, libs), x1 + 2, fy + fh - 19, Theme.FAINT, false);
		String folder = L.up("mods.openFolder"), libraries = L.up(showLibraries ? "mods.hideLibraries" : "mods.showLibraries");
		int x2 = fx + fw - 10, fw1 = Theme.spacedWidth(folder, 1) + 18, fw2 = Theme.spacedWidth(libraries, 1) + 18;
		button(g, x2 - fw1, fy + fh - 24, x2, fy + fh - 8, folder, Style.GHOST,
			() -> Blaze3D.openPath(minecraft.gameDirectory.toPath().resolve("mods")));
		button(g, x2 - fw1 - 6 - fw2, fy + fh - 24, x2 - fw1 - 6, fy + fh - 8, libraries, Style.GHOST, () -> {
			showLibraries = !showLibraries;
			scrollTarget = 0;
		});
	}

	private void details(GuiGraphicsExtractor g, Entry e, int x, int y, int x2) {
		ModMetadata m = e.meta();
		drawIcon(g, e, x, y, 40);
		int tx = x + 48, room = x2 - tx;
		g.text(font, Theme.ellipsize(e.name, room), tx, y + 1, Theme.TEXT, false);
		g.text(font, Theme.ellipsize(e.version, room), tx, y + 12, Theme.MUTED, false);
		String tag = L.up(switch (e.kind) {
			case GAME -> "mods.game";
			case LIBRARY -> "mods.library";
			case MOD -> "mods.mod";
		});
		int tw = Theme.spacedWidth(tag, 1) + 10;
		Theme.notched(g, tx, y + 24, tx + tw, y + 36, 2, Theme.withAlpha(Theme.accent(), 0x38));
		Theme.spaced(g, tag, tx + 5, y + 26, Theme.TEXT, 1);
		int cy = y + 50, width = x2 - x;
		// Bağlantılar
		int bx = x;
		for (String key : List.of("homepage", "sources", "issues")) {
			String url = m.getContact().get(key).orElse(null);
			if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) continue;
			String label = L.up("mods.link." + key);
			int bw = Theme.spacedWidth(label, 1) + 14;
			if (bx + bw > x2) break;
			button(g, bx, cy, bx + bw, cy + 15, label, Style.SECONDARY, () -> Blaze3D.openUri(URI.create(url)));
			bx += bw + 4;
		}
		if (bx != x) cy += 22;
		String description = m.getDescription();
		if (!description.isBlank()) {
			List<FormattedCharSequence> lines = font.split(FormattedText.of(description), width);
			for (int i = 0; i < Math.min(6, lines.size()); i++) {
				g.text(font, lines.get(i), x, cy, Theme.MUTED, false);
				cy += 10;
			}
			cy += 6;
		}
		String authors = m.getAuthors().stream().map(Person::getName).collect(Collectors.joining(", "));
		if (!authors.isBlank()) cy = fact(g, x, cy, width, "mods.authors", authors);
		String license = String.join(", ", m.getLicense());
		if (!license.isBlank()) cy = fact(g, x, cy, width, "mods.license", license);
		fact(g, x, cy, width, "mods.id", m.getId());
	}

	private int fact(GuiGraphicsExtractor g, int x, int y, int width, String key, String value) {
		Theme.spaced(g, L.up(key), x, y, Theme.FAINT, 1);
		g.text(font, Theme.ellipsize(value, width), x, y + 10, Theme.TEXT, false);
		return y + 25;
	}

	@Override public boolean mouseScrolled(double x, double y, double h, double v) {
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget - v * 30));
		return true;
	}
}
