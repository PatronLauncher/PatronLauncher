package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/**
 * Koşma tuşunu basılı tutar; Minecraft'ın kendi "koşmayı aç/kapat" davranışıyla aynıdır,
 * sunucuya fazladan hiçbir şey göndermez.
 */
public final class ToggleSprintModule extends HudModule {
	public final BoolSetting showText = add(new BoolSetting("showText", "setting.showStatus", true));
	/** Minecraft'ın kendi "Eğilme: Aç/Kapat" ayarını kullanır; modül kapanınca eski hali geri gelir. */
	public final BoolSetting toggleSneak = add(new BoolSetting("toggleSneak", "setting.toggleSneak", false));
	private Boolean savedCrouch;

	public ToggleSprintModule() {
		super("sprint", Category.MECHANIC, "run", false, 0.004, 0.995);
		background.set(false);
	}

	@Override public void tick() {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player != null) mc.options.keySprint.setDown(true);
		var crouch = mc.options.toggleCrouch();
		if (toggleSneak.on() && savedCrouch == null) {
			savedCrouch = crouch.get();
			crouch.set(true);
		} else if (!toggleSneak.on() && savedCrouch != null) {
			crouch.set(savedCrouch);
			savedCrouch = null;
		}
	}

	@Override protected void onDisable() {
		Minecraft.getInstance().options.keySprint.setDown(false);
		if (savedCrouch != null) Minecraft.getInstance().options.toggleCrouch().set(savedCrouch);
		savedCrouch = null;
	}

	@Override public boolean visible(boolean preview) { return showText.on(); }

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		var p = Minecraft.getInstance().player;
		String key = !preview && p != null && p.isShiftKeyDown() ? "hud.sneaking" : "hud.sprintToggled";
		textBox(g, "[" + L.t(key) + "]");
	}
}
