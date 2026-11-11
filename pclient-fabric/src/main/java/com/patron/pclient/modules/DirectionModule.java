package com.patron.pclient.modules;

import com.patron.pclient.gui.Theme;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.SliderSetting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.util.Mth;

/** Ekranın üstünde kayan pusula şeridi: ana yönler, ara yönler ve derece. */
public final class DirectionModule extends HudModule {
	/** Minecraft'ta 0° güneydir; dizin 45°'lik dilimlere göre. */
	private static final String[] NAMES = {"S", "SW", "W", "NW", "N", "NE", "E", "SE"};
	public final SliderSetting width = add(new SliderSetting("width", "setting.width", 160, 90, 260, 10, "%.0f"));
	public final BoolSetting degrees = add(new BoolSetting("degrees", "setting.showDegrees", true));
	public final BoolSetting ticks = add(new BoolSetting("ticks", "setting.showTicks", true));

	public DirectionModule() { super("direction", Category.HUD, "compass", false, 0.5, 0.0); }

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		var font = Minecraft.getInstance().font;
		var p = Minecraft.getInstance().player;
		float yaw = preview || p == null ? 168f : Mth.wrapDegrees(p.getYRot());
		w = (int) Math.round(width.get());
		h = degrees.on() ? 24 : 14;
		if (background.on()) Theme.hudBox(g, 0, 0, w, h);
		int cx = w / 2;
		float span = 75f, pxPerDeg = (w / 2f - 8) / span;
		for (int d = 0; d < 360; d += 15) {
			float rel = Mth.wrapDegrees(d - yaw);
			if (Math.abs(rel) > span) continue;
			int x = cx + Math.round(rel * pxPerDeg);
			if (d % 45 == 0) {
				String n = NAMES[d / 45];
				int c = n.equals("N") ? Theme.accent() : n.length() == 1 ? color.get() : Theme.withAlpha(color.get(), 0xA8);
				g.text(font, n, x - font.width(n) / 2, 3, c, true);
			} else if (ticks.on()) g.fill(x, 4, x + 1, 9, Theme.withAlpha(color.get(), 0x70));
		}
		g.fill(cx, 0, cx + 1, 2, Theme.accent());
		if (degrees.on()) {
			String deg = Math.floorMod(Math.round(yaw), 360) + "°";
			g.text(font, deg, cx - font.width(deg) / 2, 14, Theme.withAlpha(color.get(), 0xC0), true);
		}
	}
}
