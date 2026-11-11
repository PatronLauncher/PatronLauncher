package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.phys.Vec3;

/** Yatay hız (blok/saniye), konum farkından hesaplanır. */
public final class SpeedModule extends HudModule {
	private Vec3 last;
	private double speed;

	public SpeedModule() { super("speed", Category.HUD, "speed", false, 0.004, 0.45); }

	@Override public void tick() {
		var p = Minecraft.getInstance().player;
		if (p == null) {
			last = null;
			speed = 0;
			return;
		}
		Vec3 now = p.position();
		if (last != null) {
			double dx = now.x - last.x, dz = now.z - last.z;
			// Hafif yumuşatma: sayının titremesini önler.
			speed = speed * 0.5 + Math.sqrt(dx * dx + dz * dz) * 20 * 0.5;
		}
		last = now;
	}

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		textBox(g, L.t("hud.speed", String.format(java.util.Locale.ROOT, "%.2f", preview ? 5.61 : speed)));
	}
}
