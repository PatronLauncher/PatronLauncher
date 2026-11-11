package com.patron.pclient.gui;

import com.mojang.blaze3d.platform.NativeImage;
import com.patron.pclient.L;
import com.patron.pclient.PClient;
import java.io.InputStream;
import java.nio.file.Files;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.FaviconTexture;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.world.level.storage.LevelSummary;

/** PClient tek oyunculu ekranı: dünya listesi, arama, oyna, sil ve yeni dünya. */
public final class PClientWorldsScreen extends PcScreen {
	private static final int ROW = 40;
	private final PcTextField search = new PcTextField(32, L.t("worlds.search")).clearOnEscape();
	private CompletableFuture<List<LevelSummary>> loading;
	private List<LevelSummary> worlds = List.of();
	private String error;
	private String selected;
	private long deleteArmedUntil;
	private double scroll, scrollTarget, maxScroll;
	private int listY1, listY2;
	private final Map<String, FaviconTexture> icons = new HashMap<>();
	private long lastClick;
	private String lastClicked;

	public PClientWorldsScreen(Screen parent) { super("title.worlds", parent); }

	@Override protected String dock() { return minecraft.level == null ? "home" : null; }

	@Override protected void init() {
		search.onChange(v -> scrollTarget = 0);
		if (loading == null) reload();
	}

	private void reload() {
		error = null;
		try {
			var source = minecraft.getLevelSource();
			loading = source.loadLevelSummaries(source.findLevelCandidates());
		} catch (Exception e) {
			PClient.LOG.warn("Dünya listesi okunamadı", e);
			error = L.t("worlds.error");
			loading = CompletableFuture.completedFuture(List.of());
		}
	}

	@Override public void tick() {
		if (loading != null && loading.isDone()) {
			try {
				List<LevelSummary> list = new ArrayList<>(loading.join());
				list.sort(null);
				worlds = list;
				if (selected == null && !list.isEmpty()) selected = list.get(0).getLevelId();
			} catch (Exception e) {
				PClient.LOG.warn("Dünya listesi okunamadı", e);
				error = L.t("worlds.error");
			}
			loading = null;
		}
	}

	private List<LevelSummary> visible() {
		String q = search.value().toLowerCase(Locale.ROOT).trim();
		if (q.isEmpty()) return worlds;
		List<LevelSummary> out = new ArrayList<>();
		for (LevelSummary w : worlds)
			if ((w.getLevelName() + " " + w.getLevelId()).toLowerCase(Locale.ROOT).contains(q)) out.add(w);
		return out;
	}

	private LevelSummary selectedWorld() {
		for (LevelSummary w : worlds) if (w.getLevelId().equals(selected)) return w;
		return null;
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		frame(g, 520, 320, L.up("worlds.title"));
		int x1 = fx + 12, x2 = fx + fw - 12, top = fy + FRAME_HEADER + 9;
		int nw = Theme.spacedWidth(L.up("worlds.create"), 1) + 30;
		textField(g, x1, top, Math.min(x1 + 190, x2 - nw - 8), top + 18, search, 11, "search");
		button(g, x2 - nw, top, x2, top + 18, "", Style.PRIMARY, () -> open(new PClientCreateWorldScreen(this)));
		PixelIcons.draw(g, "plus", x2 - nw + 7, top + 5, 1, Theme.TEXT);
		Theme.spaced(g, L.up("worlds.create"), x2 - nw + 19, top + 5, Theme.TEXT, 1);

		listY1 = top + 26;
		listY2 = fy + fh - 40;
		List<LevelSummary> list = visible();
		int contentH = list.size() * (ROW + 4);
		maxScroll = Math.max(0, contentH - (listY2 - listY1));
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget));
		scroll += (scrollTarget - scroll) * Math.min(1, dt * 16);
		if (loading != null) g.centeredText(font, L.t("worlds.loading"), (x1 + x2) / 2, listY1 + 30, Theme.MUTED);
		else if (error != null) g.centeredText(font, error, (x1 + x2) / 2, listY1 + 30, Theme.MUTED);
		else if (list.isEmpty()) {
			g.centeredText(font, L.t(worlds.isEmpty() ? "worlds.empty" : "worlds.noMatch"), (x1 + x2) / 2, listY1 + 30, Theme.MUTED);
		}
		g.enableScissor(x1 - 2, listY1, x2 + 2, listY2);
		for (int i = 0; i < list.size(); i++) {
			int y = listY1 + i * (ROW + 4) - (int) Math.round(scroll);
			if (y + ROW < listY1 || y > listY2) continue;
			row(g, list.get(i), x1, y, x2 - (maxScroll > 0 ? 6 : 0));
		}
		g.disableScissor();
		if (maxScroll > 0) {
			int trackH = listY2 - listY1, barH = Math.max(18, trackH * trackH / contentH);
			int barY = listY1 + (int) ((trackH - barH) * (scroll / maxScroll));
			g.fill(x2 - 2, listY1, x2, listY2, 0x14FFFFFF);
			g.fill(x2 - 2, barY, x2, barY + barH, Theme.withAlpha(Theme.accent(), 0xB0));
		}

		// Alt çubuk: seçili dünya için işlemler.
		int by = fy + fh - 32;
		g.fill(fx + 1, by - 6, fx + fw - 1, by - 5, Theme.LINE);
		LevelSummary w = selectedWorld();
		boolean playable = w != null && w.primaryActionActive() && !w.isLocked();
		button(g, x2 - 130, by, x2, by + 22, L.up("worlds.play"), Style.PRIMARY, playable ? () -> play(w) : null);
		boolean armed = System.currentTimeMillis() < deleteArmedUntil;
		String del = L.up(armed ? "worlds.deleteConfirm" : "worlds.delete");
		int dw = Theme.spacedWidth(del, 1) + 22;
		button(g, x2 - 136 - dw, by, x2 - 136, by + 22, del, armed ? Style.DANGER : Style.GHOST,
			w != null && w.canDelete() ? () -> delete(w) : null);
		if (w != null) {
			g.text(font, Theme.ellipsize(w.getLevelName(), x2 - 150 - dw - x1), x1, by + 2, Theme.TEXT, false);
			String info = w.isLocked() ? L.t("worlds.locked") : w.getInfo().getString();
			g.text(font, Theme.ellipsize(info, x2 - 150 - dw - x1), x1, by + 13, Theme.FAINT, false);
		}
	}

	private void row(GuiGraphicsExtractor g, LevelSummary w, int x1, int y, int x2) {
		boolean sel = w.getLevelId().equals(selected), inList = mouseY >= listY1 && mouseY < listY2;
		int cy1 = Math.max(y, listY1), cy2 = Math.min(y + ROW, listY2);
		boolean hov = inList && cy2 > cy1 && hit(x1, cy1, x2, cy2, () -> pick(w));
		Theme.notched(g, x1, y, x2, y + ROW, 4, sel ? Theme.withAlpha(Theme.accent(), 0x2A) : hov ? Theme.CARD_HOVER : Theme.CARD);
		Theme.notchedOutline(g, x1, y, x2, y + ROW, 4, sel ? Theme.withAlpha(Theme.accent(), 0xB0) : hov ? Theme.LINE_STRONG : Theme.LINE);
		int ix = x1 + 4, iy = y + 4;
		Theme.notched(g, ix, iy, ix + 32, iy + 32, 2, 0xFF16181F);
		FaviconTexture icon = icon(w);
		if (icon != null) g.blit(RenderPipelines.GUI_TEXTURED, icon.textureLocation(), ix, iy, 0f, 0f, 32, 32, 32, 32);
		else PixelIcons.drawCentered(g, "grass", ix + 16, iy + 16, 2, Theme.FAINT);
		int tx = ix + 40, room = x2 - tx - 8;
		g.text(font, Theme.ellipsize(w.getLevelName(), room), tx, y + 6, Theme.TEXT, false);
		String when = w.getLastPlayed() > 0
			? DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale()).format(new Date(w.getLastPlayed()))
			: "";
		g.text(font, Theme.ellipsize(w.getLevelId() + (when.isEmpty() ? "" : "  ·  " + when), room), tx, y + 17, Theme.MUTED, false);
		String mode = w.isHardcore() ? L.t("worlds.hardcore") : w.getGameMode().getLongDisplayName().getString();
		if (w.hasCommands()) mode += "  ·  " + L.t("worlds.cheats");
		mode += "  ·  " + w.getWorldVersionName().getString();
		g.text(font, Theme.ellipsize(mode, room), tx, y + 28, w.isHardcore() ? 0xFFE5484D : Theme.FAINT, false);
		if (hov && !sel) tip("world:" + w.getLevelId(), L.t("worlds.doubleClick"));
	}

	private static Locale locale() {
		String code = net.minecraft.client.Minecraft.getInstance().options.languageCode;
		return code == null ? Locale.ROOT : Locale.forLanguageTag(code.replace('_', '-'));
	}

	/** Dünya simgesi; simge dosyası yoksa null (yer tutucu çizilir). */
	private FaviconTexture icon(LevelSummary w) {
		String id = w.getLevelId();
		if (icons.containsKey(id)) return icons.get(id);
		FaviconTexture t = null;
		var path = w.getIcon();
		if (path != null && Files.isRegularFile(path)) {
			t = FaviconTexture.forWorld(minecraft.getTextureManager(), id);
			try (InputStream in = Files.newInputStream(path)) {
				t.upload(NativeImage.read(in));
			} catch (Exception e) {
				t.close();
				t = null;
			}
		}
		icons.put(id, t);
		return t;
	}

	private void pick(LevelSummary w) {
		long now = System.currentTimeMillis();
		if (w.getLevelId().equals(lastClicked) && now - lastClick < 350 && w.primaryActionActive() && !w.isLocked()) {
			play(w);
			return;
		}
		lastClicked = w.getLevelId();
		lastClick = now;
		selected = w.getLevelId();
		deleteArmedUntil = 0;
	}

	private void play(LevelSummary w) {
		minecraft.createWorldOpenFlows().openWorld(w.getLevelId(), () -> minecraft.gui.setScreen(this));
	}

	private void delete(LevelSummary w) {
		if (System.currentTimeMillis() >= deleteArmedUntil) {
			deleteArmedUntil = System.currentTimeMillis() + 3000;
			return;
		}
		deleteArmedUntil = 0;
		try (var access = minecraft.getLevelSource().createAccess(w.getLevelId())) {
			access.deleteLevel();
		} catch (Exception e) {
			PClient.LOG.warn("Dünya silinemedi: {}", w.getLevelId(), e);
			error = L.t("worlds.deleteFailed");
		}
		FaviconTexture t = icons.remove(w.getLevelId());
		if (t != null) t.close();
		selected = null;
		reload();
	}

	@Override public boolean mouseScrolled(double x, double y, double h, double v) {
		scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget - v * 30));
		return true;
	}

	@Override public void removed() {
		super.removed();
		icons.values().forEach(t -> {
			if (t != null) t.close();
		});
		icons.clear();
	}
}
