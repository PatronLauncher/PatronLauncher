package com.patron.pclient.gui;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.L;
import com.patron.pclient.config.PClientConfig;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.ModuleManager;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;

/**
 * HUD düzenleyici. Öğeler sürüklenir; kenarlara, ekran ortasına, diğer öğelerin kenar ve ortalarına ve
 * aralarındaki eşit boşluklara mıknatıslanır. Her değişiklik geri alınabilir. "Otomatik hizala", öğeleri
 * bulundukları bölgeye göre eşit aralıklarla dizer.
 */
public final class HudEditorScreen extends PcScreen {
	private static final int SNAP = 4, STACK_GAP = 3, MARGIN = 4, HOTBAR_MARGIN = 58, HISTORY = 64, TOOLBAR_H = 26;
	private static final long SCROLL_MERGE_MS = 450;

	private record State(double fx, double fy, double scale, boolean enabled) {}

	private record Line(boolean vertical, int position) {}

	/** İki öğe arasındaki boşluk işareti (a..b aralığı, cross diğer eksendeki konum). */
	private record Gap(boolean horizontal, int a, int b, int cross) {}

	private record Rect(int x, int y, int w, int h) {
		int right() { return x + w; }

		int bottom() { return y + h; }

		int cx() { return x + w / 2; }

		int cy() { return y + h / 2; }
	}

	private final Deque<Map<String, State>> undo = new ArrayDeque<>(), redo = new ArrayDeque<>();
	private final Set<Line> guides = new HashSet<>();
	private final List<Gap> gaps = new ArrayList<>();
	private Map<String, State> pending;
	private HudModule dragging, selected, focus;
	private int offX, offY;
	private long lastScroll;
	private static boolean snapping = true, showGrid = true;

	public HudEditorScreen(Screen parent) { super("title.hudEditor", parent); }

	@Override protected String dock() { return null; }

	@Override public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float delta) {
		if (minecraft.level == null && !MenuThemes.draw(g, width, height)) extractPanorama(g, delta);
		g.fill(0, 0, width, height, 0x50000000);
		if (!showGrid) return;
		for (int x = 0; x < width; x += 16) g.fill(x, 0, x + 1, height, 0x0AFFFFFF);
		for (int y = 0; y < height; y += 16) g.fill(0, y, width, y + 1, 0x0AFFFFFF);
	}

	private boolean preview(HudModule h) { return minecraft.player == null || !h.visible(false); }

	private List<HudModule> active() {
		return ModuleManager.huds().stream().filter(HudModule::isEnabled).filter(h -> h.visible(preview(h))).toList();
	}

	private Rect rect(HudModule h) { return new Rect(h.x(width), h.y(height), h.scaledW(), h.scaledH()); }

	// ---------------- Geçmiş ----------------

	private Map<String, State> capture() {
		Map<String, State> out = new HashMap<>();
		for (HudModule h : ModuleManager.huds()) out.put(h.id, new State(h.fx, h.fy, h.scale.get(), h.isEnabled()));
		return out;
	}

	private void restore(Map<String, State> snapshot) {
		for (HudModule h : ModuleManager.huds()) {
			State s = snapshot.get(h.id);
			if (s == null) continue;
			h.fx = s.fx;
			h.fy = s.fy;
			h.scale.set(s.scale);
			h.setEnabled(s.enabled);
		}
	}

	/** Değişiklik öncesi durumu geçmişe ekler ve değişen modüllerin zamanını günceller. */
	private void commit(Map<String, State> before) {
		Map<String, State> now = capture();
		if (now.equals(before)) return;
		undo.push(before);
		while (undo.size() > HISTORY) undo.removeLast();
		redo.clear();
		for (var e : now.entrySet()) if (!Objects.equals(e.getValue(), before.get(e.getKey()))) PClientConfig.touch(e.getKey());
	}

	private void change(Runnable action) {
		Map<String, State> before = capture();
		action.run();
		commit(before);
	}

	private void undo() {
		if (undo.isEmpty()) return;
		redo.push(capture());
		restore(undo.pop());
	}

	private void redo() {
		if (redo.isEmpty()) return;
		undo.push(capture());
		restore(redo.pop());
	}

	// ---------------- Çizim ----------------

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		for (Line l : guides) {
			if (l.vertical) g.fill(l.position, 0, l.position + 1, height, Theme.withAlpha(Theme.accent(), 0xB0));
			else g.fill(0, l.position, width, l.position + 1, Theme.withAlpha(Theme.accent(), 0xB0));
		}
		List<HudModule> list = active();
		if (selected != null && !list.contains(selected)) selected = null;
		HudModule hovered = null;
		for (HudModule h : list) {
			h.render(g, preview(h));
			if (hover(rect(h).x, rect(h).y, rect(h).right(), rect(h).bottom())) hovered = h;
		}
		// Fare düğme şeridine geçince odak kaybolmaz.
		if (focus != null && list.contains(focus) && overStrip(focus)) hovered = focus;
		focus = dragging != null ? dragging : hovered != null ? hovered : selected;
		for (HudModule h : list) {
			Rect r = rect(h);
			boolean on = h == focus || h == selected;
			g.outline(r.x - 1, r.y - 1, r.w + 2, r.h + 2, on ? Theme.accent() : 0x50FFFFFF);
		}
		for (Gap gap : gaps) drawGap(g, gap);
		if (focus != null) focusInfo(g, focus);
		toolbar(g);
		if (list.isEmpty()) g.centeredText(font, L.t("hudEditor.empty"), width / 2, height / 2 - 4, Theme.MUTED);
	}

	private void drawGap(GuiGraphicsExtractor g, Gap gap) {
		int color = Theme.withAlpha(Theme.accent(), 0xE0);
		if (gap.horizontal) {
			g.fill(gap.a, gap.cross, gap.b, gap.cross + 1, color);
			g.fill(gap.a, gap.cross - 2, gap.a + 1, gap.cross + 3, color);
			g.fill(gap.b - 1, gap.cross - 2, gap.b, gap.cross + 3, color);
		} else {
			g.fill(gap.cross, gap.a, gap.cross + 1, gap.b, color);
			g.fill(gap.cross - 2, gap.a, gap.cross + 3, gap.a + 1, color);
			g.fill(gap.cross - 2, gap.b - 1, gap.cross + 3, gap.b, color);
		}
	}

	private static final int STRIP = 13;

	private int stripY(Rect r) { return r.y > STRIP + 12 ? r.y - STRIP - 13 : r.bottom() + 14; }

	private boolean overStrip(HudModule h) {
		Rect r = rect(h);
		int y = stripY(r);
		return hover(r.x - 1, y, r.x + STRIP * 3 + 8, y + STRIP) || hover(r.x - 1, Math.min(y, r.y), r.right() + 1, Math.max(y + STRIP, r.bottom()));
	}

	/** Odaktaki öğenin adı, konumu ve hızlı düğmeleri. */
	private void focusInfo(GuiGraphicsExtractor g, HudModule h) {
		Rect r = rect(h);
		String name = L.t(h.nameKey()) + "  ·  " + r.x + ", " + r.y + "  ·  " + Math.round(h.scale.get() * 100) + "%";
		int ly = r.y > 12 ? r.y - 11 : r.bottom() + 2;
		int lw = font.width(name) + 6, lx = Math.max(0, Math.min(width - lw, r.x - 1));
		g.fill(lx, ly, lx + lw, ly + 10, Theme.accent());
		g.text(font, name, lx + 3, ly + 1, 0xFFFFFFFF, false);
		if (dragging != null) return;
		int y = stripY(r), x = Math.max(0, Math.min(width - STRIP * 3 - 8, r.x - 1));
		if (strip(g, x, y, "gear", () -> open(new ModuleSettingsScreen(h, this)))) tipNow(L.t("card.settings"));
		if (strip(g, x + STRIP + 4, y, "refresh", () -> change(h::resetLayout))) tipNow(L.t("hudEditor.resetOne"));
		if (strip(g, x + (STRIP + 4) * 2, y, "close", () -> change(() -> {
			h.setEnabled(false);
			if (selected == h) selected = null;
		}))) tipNow(L.t("hudEditor.hide"));
	}

	private boolean strip(GuiGraphicsExtractor g, int x, int y, String icon, Runnable action) {
		boolean hov = hit(x, y, x + STRIP, y + STRIP, action);
		g.fill(x, y, x + STRIP, y + STRIP, hov ? Theme.accent() : 0xE60A0B10);
		g.outline(x, y, STRIP, STRIP, Theme.LINE_STRONG);
		PixelIcons.drawCentered(g, icon, x + STRIP / 2 + 1, y + STRIP / 2 + 1, 1, Theme.TEXT);
		return hov;
	}

	private record Tool(String icon, String tip, boolean on, boolean enabled, Runnable action) {}

	private void toolbar(GuiGraphicsExtractor g) {
		List<Tool> tools = List.of(
			new Tool("undo", L.t("hudEditor.undo"), false, !undo.isEmpty(), this::undo),
			new Tool("redo", L.t("hudEditor.redo"), false, !redo.isEmpty(), this::redo),
			new Tool("wand", L.t("hudEditor.auto"), false, !active().isEmpty(), () -> change(this::autoArrange)),
			new Tool("refresh", L.t("hudEditor.resetAll"), false, true, () -> change(() -> ModuleManager.huds().forEach(HudModule::resetLayout))),
			new Tool("magnet", L.t("hudEditor.snap"), snapping, true, () -> snapping = !snapping),
			new Tool("grid", L.t("hudEditor.grid"), showGrid, true, () -> showGrid = !showGrid),
			new Tool("help", L.t("hudEditor.help"), false, true, () -> {}));
		String mods = L.up("dock.modules"), done = L.up("setting.done");
		int size = 18, gap = 3, toolsW = tools.size() * (size + gap);
		int mw = Theme.spacedWidth(mods, 1) + 18, dw = Theme.spacedWidth(done, 1) + 18;
		int w = 8 + toolsW + 6 + mw + 4 + dw + 8, x = (width - w) / 2, y = height - TOOLBAR_H - 6;
		Theme.notched(g, x, y, x + w, y + TOOLBAR_H, 4, 0xE60A0B10);
		Theme.notchedOutline(g, x, y, x + w, y + TOOLBAR_H, 4, Theme.LINE_STRONG);
		int bx = x + 8, by = y + (TOOLBAR_H - size) / 2;
		for (Tool t : tools) {
			boolean hov = t.enabled ? hit(bx, by, bx + size, by + size, t.action) : hover(bx, by, bx + size, by + size);
			Theme.notched(g, bx, by, bx + size, by + size, 3, t.on ? Theme.withAlpha(Theme.accent(), 0x50) : hov && t.enabled ? 0x2EFFFFFF : 0x0FFFFFFF);
			PixelIcons.drawCentered(g, t.icon, bx + size / 2, by + size / 2, 1, !t.enabled ? Theme.FAINT : t.on || hov ? Theme.TEXT : Theme.MUTED);
			if (hov) tipNow(t.tip);
			bx += size + gap;
		}
		bx += 6;
		button(g, bx, by, bx + mw, by + size, mods, Style.GHOST, () -> open(new ModulesScreen(ModulesScreen.Tab.MODULES)));
		bx += mw + 4;
		button(g, bx, by, bx + dw, by + size, done, Style.PRIMARY, this::onClose);
	}

	// ---------------- Mıknatıs ----------------

	private record Snap(int delta, List<Line> lines, Gap gap) {}

	/** Üç bağlantı noktasını (baş, orta, son) adaylarla karşılaştırır; en yakın olanı seçer. */
	private void best(int[] anchors, int[] targets, boolean vertical, Snap[] out) {
		for (int anchor : anchors) for (int target : targets) {
			int delta = target - anchor;
			if (Math.abs(delta) > SNAP) continue;
			if (out[0] == null || Math.abs(delta) < Math.abs(out[0].delta)) out[0] = new Snap(delta, List.of(new Line(vertical, target)), null);
		}
	}

	private Rect snapped(Rect moving, List<Rect> others) {
		guides.clear();
		gaps.clear();
		if (!snapping || isAltDown()) return clamp(moving);
		Snap[] x = {null}, y = {null};
		int[] xTargets = new int[3 + others.size() * 3], yTargets = new int[3 + others.size() * 3];
		xTargets[0] = 0;
		xTargets[1] = width / 2;
		xTargets[2] = width;
		yTargets[0] = 0;
		yTargets[1] = height / 2;
		yTargets[2] = height;
		for (int i = 0; i < others.size(); i++) {
			Rect o = others.get(i);
			xTargets[3 + i * 3] = o.x;
			xTargets[4 + i * 3] = o.cx();
			xTargets[5 + i * 3] = o.right();
			yTargets[3 + i * 3] = o.y;
			yTargets[4 + i * 3] = o.cy();
			yTargets[5 + i * 3] = o.bottom();
		}
		best(new int[] {moving.x, moving.cx(), moving.right()}, xTargets, true, x);
		best(new int[] {moving.y, moving.cy(), moving.bottom()}, yTargets, false, y);
		gapSnap(moving, others, true, x);
		gapSnap(moving, others, false, y);
		Rect result = clamp(new Rect(moving.x + (x[0] == null ? 0 : x[0].delta), moving.y + (y[0] == null ? 0 : y[0].delta), moving.w, moving.h));
		if (x[0] != null) {
			guides.addAll(x[0].lines);
			if (x[0].gap != null) gaps.add(x[0].gap);
		}
		if (y[0] != null) {
			guides.addAll(y[0].lines);
			if (y[0].gap != null) gaps.add(y[0].gap);
		}
		return result;
	}

	/** Aynı sıradaki (yataysa satır, dikeyse sütun) öğelere eşit boşluk ve bitişik dizilim adayları. */
	private void gapSnap(Rect m, List<Rect> others, boolean horizontal, Snap[] out) {
		List<Rect> row = new ArrayList<>();
		for (Rect o : others) {
			boolean overlap = horizontal ? o.y < m.bottom() && m.y < o.bottom() : o.x < m.right() && m.x < o.right();
			if (overlap) row.add(o);
		}
		row.sort(Comparator.comparingInt(r -> horizontal ? r.x : r.y));
		int start = horizontal ? m.x : m.y, size = horizontal ? m.w : m.h;
		int cross = horizontal ? m.cy() : m.cx();
		for (int i = 0; i < row.size(); i++) {
			Rect a = row.get(i);
			int aStart = horizontal ? a.x : a.y, aEnd = horizontal ? a.right() : a.bottom();
			// Yanına eşit, küçük bir boşlukla dizilme.
			consider(out, aEnd + STACK_GAP - start, new Gap(horizontal, aEnd, aEnd + STACK_GAP, cross));
			consider(out, aStart - STACK_GAP - size - start, new Gap(horizontal, aStart - STACK_GAP, aStart, cross));
			if (i + 1 >= row.size()) continue;
			Rect b = row.get(i + 1);
			int bStart = horizontal ? b.x : b.y, bEnd = horizontal ? b.right() : b.bottom(), between = bStart - aEnd;
			if (between <= 0) continue;
			// Mevcut iki öğenin boşluğu kadar sonrasına ya da öncesine.
			consider(out, bEnd + between - start, new Gap(horizontal, bEnd, bEnd + between, cross));
			consider(out, aStart - between - size - start, new Gap(horizontal, aStart - between, aStart, cross));
			// İki öğenin tam ortasına.
			if (size < between) {
				int equal = (between - size) / 2;
				consider(out, aEnd + equal - start, new Gap(horizontal, aEnd, aEnd + equal, cross));
			}
		}
	}

	private void consider(Snap[] out, int delta, Gap gap) {
		if (Math.abs(delta) > SNAP || gap.b - gap.a <= 0) return;
		if (out[0] == null || Math.abs(delta) < Math.abs(out[0].delta) || out[0].gap == null && Math.abs(delta) == Math.abs(out[0].delta))
			out[0] = new Snap(delta, List.of(), gap);
	}

	private Rect clamp(Rect r) {
		return new Rect(Math.max(0, Math.min(width - r.w, r.x)), Math.max(0, Math.min(height - r.h, r.y)), r.w, r.h);
	}

	private boolean isAltDown() {
		return InputConstants.isKeyDown(InputConstants.KEY_LALT) || InputConstants.isKeyDown(InputConstants.KEY_RALT);
	}

	// ---------------- Otomatik hizalama ----------------

	/** Öğeleri bulundukları sütuna (sol, orta, sağ) göre gruplar ve eşit aralıklarla, çakışmadan dizer. */
	private void autoArrange() {
		Map<Integer, List<HudModule>> columns = new HashMap<>();
		for (HudModule h : active()) columns.computeIfAbsent(Math.min(2, rect(h).cx() * 3 / Math.max(1, width)), k -> new ArrayList<>()).add(h);
		for (var entry : columns.entrySet()) {
			entry.getValue().sort(Comparator.comparingInt(h -> rect(h).y));
			arrangeColumn(entry.getKey(), entry.getValue());
		}
	}

	private int stackHeight(List<HudModule> items) {
		return items.isEmpty() ? 0 : items.stream().mapToInt(HudModule::scaledH).sum() + (items.size() - 1) * STACK_GAP;
	}

	/** Dizer ve dizinin bittiği y'yi döner. */
	private int place(List<HudModule> items, int column, int offset, int y) {
		for (HudModule h : items) {
			int w = h.scaledW();
			h.moveTo(column == 0 ? offset : column == 2 ? width - offset - w : (width - w) / 2, y, width, height);
			y += h.scaledH() + STACK_GAP;
		}
		return y;
	}

	private void arrangeColumn(int column, List<HudModule> items) {
		// Ortadaki sütunun altı oyunda araç çubuğuna ayrılmıştır.
		int bottomMargin = column == 1 ? HOTBAR_MARGIN : MARGIN, limit = height - MARGIN - bottomMargin;
		if (stackHeight(items) > limit) {
			wrapColumn(column, items, limit);
			return;
		}
		List<HudModule> top = new ArrayList<>(), middle = new ArrayList<>(), bottom = new ArrayList<>();
		for (HudModule h : items) {
			int row = Math.min(2, rect(h).cy() * 3 / Math.max(1, height));
			(row == 0 ? top : row == 2 ? bottom : middle).add(h);
		}
		int topEnd = place(top, column, MARGIN, MARGIN);
		int bottomStart = height - bottomMargin - stackHeight(bottom);
		place(bottom, column, MARGIN, bottomStart);
		int middleH = stackHeight(middle), low = top.isEmpty() ? MARGIN : topEnd;
		int high = bottomStart - middleH - (bottom.isEmpty() ? 0 : STACK_GAP);
		place(middle, column, MARGIN, Math.max(low, Math.min(high, (height - middleH) / 2)));
	}

	/** Sütuna sığmayan öğeler yukarıdan aşağıya dizilir, taşanlar içeriye doğru yeni sütuna geçer. */
	private void wrapColumn(int column, List<HudModule> items, int limit) {
		int offset = MARGIN;
		List<HudModule> current = new ArrayList<>();
		for (HudModule h : items) {
			current.add(h);
			if (stackHeight(current) <= limit || current.size() == 1) continue;
			current.remove(h);
			place(current, column, offset, MARGIN);
			offset += current.stream().mapToInt(HudModule::scaledW).max().orElse(0) + STACK_GAP;
			current = new ArrayList<>(List.of(h));
		}
		place(current, column, offset, MARGIN);
	}

	// ---------------- Girdi ----------------

	private HudModule at(double mx, double my) {
		List<HudModule> list = active();
		for (int i = list.size() - 1; i >= 0; i--) {
			Rect r = rect(list.get(i));
			if (mx >= r.x && mx < r.right() && my >= r.y && my < r.bottom()) return list.get(i);
		}
		return null;
	}

	@Override public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
		if (super.mouseClicked(e, doubleClick)) return true;
		HudModule h = at(e.x(), e.y());
		if (e.button() == InputConstants.MOUSE_BUTTON_RIGHT) {
			if (h == null) return false;
			click();
			open(new ModuleSettingsScreen(h, this));
			return true;
		}
		selected = h;
		if (h == null) return false;
		dragging = h;
		pending = capture();
		offX = (int) e.x() - h.x(width);
		offY = (int) e.y() - h.y(height);
		return true;
	}

	@Override public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		if (dragging == null) return super.mouseDragged(e, dx, dy);
		List<Rect> others = active().stream().filter(h -> h != dragging).map(this::rect).toList();
		Rect moved = snapped(new Rect((int) e.x() - offX, (int) e.y() - offY, dragging.scaledW(), dragging.scaledH()), others);
		dragging.moveTo(moved.x, moved.y, width, height);
		return true;
	}

	@Override public boolean mouseReleased(MouseButtonEvent e) {
		dragging = null;
		guides.clear();
		gaps.clear();
		if (pending != null) {
			commit(pending);
			pending = null;
		}
		return super.mouseReleased(e);
	}

	@Override public boolean mouseScrolled(double mx, double my, double h, double v) {
		HudModule m = at(mx, my);
		if (m == null || v == 0) return false;
		long now = System.currentTimeMillis();
		// Peş peşe tekerlek hareketleri tek geri alma adımı olur.
		Map<String, State> before = now - lastScroll > SCROLL_MERGE_MS ? capture() : null;
		lastScroll = now;
		m.scale.set(m.scale.get() + (v > 0 ? 0.05 : -0.05));
		if (before != null) commit(before);
		else PClientConfig.touch(m.id);
		return true;
	}

	@Override public boolean keyPressed(KeyEvent e) {
		int key = e.key();
		if (e.hasControlDown() && key == InputConstants.KEY_Z) {
			if (e.hasShiftDown()) redo();
			else undo();
			return true;
		}
		if (e.hasControlDown() && key == InputConstants.KEY_Y) {
			redo();
			return true;
		}
		if (selected != null) {
			int step = e.hasShiftDown() ? 10 : 1;
			int dx = key == InputConstants.KEY_LEFT ? -step : key == InputConstants.KEY_RIGHT ? step : 0;
			int dy = key == InputConstants.KEY_UP ? -step : key == InputConstants.KEY_DOWN ? step : 0;
			if (dx != 0 || dy != 0) {
				HudModule h = selected;
				change(() -> {
					Rect r = clamp(new Rect(h.x(width) + dx, h.y(height) + dy, h.scaledW(), h.scaledH()));
					h.moveTo(r.x, r.y, width, height);
				});
				return true;
			}
			if (key == InputConstants.KEY_DELETE) {
				HudModule h = selected;
				selected = null;
				change(() -> h.setEnabled(false));
				return true;
			}
			if (key == InputConstants.KEY_R) {
				change(selected::resetLayout);
				return true;
			}
		}
		return super.keyPressed(e);
	}
}
