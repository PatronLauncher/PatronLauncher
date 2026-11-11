package com.patron.pclient.module;

import com.patron.pclient.gui.Theme;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.ColorSetting;
import com.patron.pclient.module.setting.SliderSetting;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/**
 * Ekranda konumlandırılabilen modül. Konum, ekranın boş alanına göre 0..1 oranıyla tutulur;
 * böylece pencere boyutu değişse de öğe ekran dışına taşmaz.
 */
public abstract class HudModule extends Module {
	public double fx, fy;
	private final double defX, defY;
	public final SliderSetting scale = add(new SliderSetting("scale", "setting.scale", 1.0, 0.5, 2.0, 0.05, "%.2fx"));
	public final BoolSetting background = add(new BoolSetting("background", "setting.background", true));
	public final com.patron.pclient.module.setting.ColorSetting color = add(new ColorSetting("color", "setting.textColor", 0xFFFFFFFF));

	/** Son çizimdeki ölçeksiz boyut (düzenleyici için). */
	protected int w = 40, h = 16;

	protected HudModule(String id, Category category, String icon, boolean on, double defX, double defY) {
		super(id, category, icon, on);
		this.defX = this.fx = defX;
		this.defY = this.fy = defY;
	}

	@Override public void resetToDefaults() {
		super.resetToDefaults();
		fx = defX;
		fy = defY;
	}

	public double defaultX() { return defX; }

	public double defaultY() { return defY; }

	/** Yalnızca konumu ve boyutu varsayılana döndürür; diğer ayarlara dokunmaz. */
	public void resetLayout() {
		fx = defX;
		fy = defY;
		scale.reset();
	}

	/** Öğeyi (0,0) noktasına ölçeksiz çizer ve boyutunu w/h olarak günceller. preview: örnek veriyle çiz. */
	protected abstract void draw(GuiGraphicsExtractor g, boolean preview);

	/** Gösterilecek bir şey yoksa false (ör. etkin iksir yokken). Önizlemede her zaman görünür. */
	public boolean visible(boolean preview) { return true; }

	public int scaledW() { return (int) Math.ceil(w * scale.get()); }

	public int scaledH() { return (int) Math.ceil(h * scale.get()); }

	public int x(int screenW) { return (int) Math.round(fx * Math.max(0, screenW - scaledW())); }

	public int y(int screenH) { return (int) Math.round(fy * Math.max(0, screenH - scaledH())); }

	public void moveTo(int x, int y, int screenW, int screenH) {
		int fw = Math.max(1, screenW - scaledW()), fh = Math.max(1, screenH - scaledH());
		fx = Math.max(0, Math.min(1, x / (double) fw));
		fy = Math.max(0, Math.min(1, y / (double) fh));
	}

	public final void render(GuiGraphicsExtractor g, boolean preview) {
		if (!visible(preview)) return;
		float s = scale.get().floatValue();
		g.pose().pushMatrix();
		g.pose().translate(x(g.guiWidth()), y(g.guiHeight()));
		g.pose().scale(s, s);
		draw(g, preview);
		g.pose().popMatrix();
	}

	// --- Ortak çizim yardımcıları ---

	/** Tek satırlık kutu: arka plan + metin; boyutu günceller. */
	protected void textBox(GuiGraphicsExtractor g, String text) {
		var font = Minecraft.getInstance().font;
		w = font.width(text) + 10;
		h = 16;
		if (background.on()) Theme.hudBox(g, 0, 0, w, h);
		g.text(font, text, 5, 4, color.get(), true);
	}

	/** Çok satırlı kutu. */
	protected void linesBox(GuiGraphicsExtractor g, List<String> lines) {
		var font = Minecraft.getInstance().font;
		int width = 0;
		for (String l : lines) width = Math.max(width, font.width(l));
		w = width + 10;
		h = lines.size() * 10 + 6;
		if (background.on()) Theme.hudBox(g, 0, 0, w, h);
		for (int i = 0; i < lines.size(); i++) g.text(font, lines.get(i), 5, 4 + i * 10, color.get(), true);
	}
}
