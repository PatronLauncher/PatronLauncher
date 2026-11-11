package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import java.util.ArrayDeque;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Saniyedeki tıklama sayısı. Tıklamalar MouseHandler karışımından gelir. */
public final class CpsModule extends HudModule {
	private static final ArrayDeque<Long> LEFT = new ArrayDeque<>(), RIGHT = new ArrayDeque<>();
	public final BoolSetting showRight = add(new BoolSetting("showRight", "setting.showRight", true));

	public CpsModule() { super("cps", Category.HUD, "mouse", true, 0.004, 0.31); }

	public static synchronized void click(int button) {
		long now = System.currentTimeMillis();
		// 26.3 SDL kullanır: tuş numaraları GLFW'den farklıdır, sabitler kullanılır.
		if (button == com.mojang.blaze3d.platform.InputConstants.MOUSE_BUTTON_LEFT) LEFT.addLast(now);
		else if (button == com.mojang.blaze3d.platform.InputConstants.MOUSE_BUTTON_RIGHT) RIGHT.addLast(now);
	}

	public static synchronized int left() { return count(LEFT); }

	public static synchronized int right() { return count(RIGHT); }

	private static int count(ArrayDeque<Long> q) {
		long cutoff = System.currentTimeMillis() - 1000;
		while (!q.isEmpty() && q.peekFirst() < cutoff) q.pollFirst();
		return q.size();
	}

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		int l = preview ? 9 : left(), r = preview ? 4 : right();
		textBox(g, showRight.on() ? L.t("hud.cps2", l, r) : L.t("hud.cps", l));
	}
}
