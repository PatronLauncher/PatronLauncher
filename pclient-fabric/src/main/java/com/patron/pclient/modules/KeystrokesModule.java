package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.gui.Theme;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** WASD, fare tuşları ve zıplama; basılan tuş vurgu rengiyle yumuşakça dolar. */
public final class KeystrokesModule extends HudModule {
	private static final int K = 22, GAP = 2, W = K * 3 + GAP * 2;
	public final BoolSetting mouse = add(new BoolSetting("mouse", "setting.mouseButtons", true));
	public final BoolSetting space = add(new BoolSetting("space", "setting.spaceBar", true));
	public final BoolSetting cps = add(new BoolSetting("cps", "setting.showCps", true));
	private final float[] anim = new float[7];
	private long lastFrame;

	public KeystrokesModule() { super("keystrokes", Category.HUD, "keys", true, 0.004, 0.62); }

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		var o = Minecraft.getInstance().options;
		long now = System.nanoTime();
		dt = lastFrame == 0 ? 0 : Math.min(0.1f, (now - lastFrame) / 1e9f);
		lastFrame = now;
		w = W;
		int y = 0;
		key(g, 0, o.keyUp, K + GAP, y, K, K, null);
		y += K + GAP;
		key(g, 1, o.keyLeft, 0, y, K, K, null);
		key(g, 2, o.keyDown, K + GAP, y, K, K, null);
		key(g, 3, o.keyRight, (K + GAP) * 2, y, K, K, null);
		y += K + GAP;
		if (mouse.on()) {
			int half = (W - GAP) / 2;
			key(g, 4, o.keyAttack, 0, y, half, K, cps.on() ? L.t("hud.cpsShort", preview ? 9 : CpsModule.left()) : null);
			key(g, 5, o.keyUse, half + GAP, y, W - half - GAP, K, cps.on() ? L.t("hud.cpsShort", preview ? 4 : CpsModule.right()) : null);
			y += K + GAP;
		}
		if (space.on()) {
			key(g, 6, o.keyJump, 0, y, W, 12, "");
			y += 12 + GAP;
		}
		h = y - GAP;
	}

	/** Son karenin süresi (saniye); basma animasyonu için. */
	private float dt;

	private void key(GuiGraphicsExtractor g, int idx, KeyMapping km, int x, int y, int kw, int kh, String sub) {
		boolean down = km.isDown();
		anim[idx] += (down ? 1 : -1) * dt * 12f;
		anim[idx] = Math.max(0, Math.min(1, anim[idx]));
		float a = anim[idx];
		if (background.on() || a > 0) {
			int bg = Theme.mix(0x99000000, Theme.withAlpha(Theme.accent(), 0xE6), a);
			g.fill(x, y, x + kw, y + kh, bg);
		}
		var font = Minecraft.getInstance().font;
		int textColor = Theme.mix(color.get(), 0xFFFFFFFF, a);
		if (sub != null && sub.isEmpty()) {
			// Boşluk çubuğu: ortada ince çizgi.
			g.fill(x + kw / 2 - 12, y + kh / 2 - 1, x + kw / 2 + 12, y + kh / 2, textColor);
			return;
		}
		String label = km.getTranslatedKeyMessage().getString();
		if (label.length() > 3) label = label.substring(0, 3);
		if (sub == null) g.centeredText(font, label, x + kw / 2, y + (kh - 8) / 2, textColor);
		else {
			g.pose().pushMatrix();
			g.centeredText(font, label, x + kw / 2, y + 3, textColor);
			g.pose().translate(x + kw / 2f, y + 13);
			g.pose().scale(0.6f, 0.6f);
			g.centeredText(font, sub, 0, 0, Theme.withAlpha(textColor, 0xC0));
			g.pose().popMatrix();
		}
	}
}
