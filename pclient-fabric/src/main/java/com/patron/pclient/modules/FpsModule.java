package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

public final class FpsModule extends HudModule {
	public FpsModule() { super("fps", Category.HUD, "fps", true, 0.004, 0.24); }

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		textBox(g, L.t("hud.fps", preview ? 144 : Minecraft.getInstance().getFps()));
	}
}
