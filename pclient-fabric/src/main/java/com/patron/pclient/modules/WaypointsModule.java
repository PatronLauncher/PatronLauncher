package com.patron.pclient.modules;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.L;
import com.patron.pclient.gui.Theme;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.Overlay;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.KeySetting;
import com.patron.pclient.module.setting.SliderSetting;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;
import net.minecraft.world.phys.Vec3;
import org.joml.Matrix4f;
import org.joml.Vector4f;

/**
 * Yol noktalarını dünyada işaret olarak gösterir; tuşla bulunduğun yere nokta ekler ve ölünce
 * ölüm noktası bırakır. Noktalar menüdeki "Yol Noktaları" sekmesinden yönetilir.
 */
public final class WaypointsModule extends Module implements Overlay {
	public final KeySetting quickKey = add(new KeySetting("quickKey", "setting.quickWaypoint", InputConstants.KEY_N));
	public final BoolSetting markers = add(new BoolSetting("markers", "setting.showMarkers", true));
	public final BoolSetting distance = add(new BoolSetting("distance", "setting.showDistance", true));
	public final SliderSetting maxDistance = add(new SliderSetting("maxDistance", "setting.maxDistance", 5000, 100, 10000, 100, "%.0f"));
	public final BoolSetting deathPoint = add(new BoolSetting("deathPoint", "setting.deathPoint", true));
	private final Matrix4f matrix = new Matrix4f();
	private final Vector4f vec = new Vector4f();
	private boolean wasDown, wasDead;

	public WaypointsModule() { super("waypoints", Category.MECHANIC, "flag", true); }

	public static WaypointsModule instance() { return ModuleManager.get(WaypointsModule.class); }

	@Override public void tick() {
		Minecraft mc = Minecraft.getInstance();
		var p = mc.player;
		if (p == null) {
			wasDead = false;
			return;
		}
		boolean down = mc.gui.screen() == null && quickKey.isDown();
		if (down && !wasDown) {
			var w = Waypoints.addHere(L.t("waypoints.defaultName", Waypoints.current().size() + 1), Waypoints.nextColor(), false);
			if (w != null) p.sendOverlayMessage(Component.literal(L.t("waypoints.added", w.name, w.x, w.y, w.z)));
		}
		wasDown = down;
		boolean dead = p.isDeadOrDying();
		if (dead && !wasDead && deathPoint.on()) Waypoints.addHere(L.t("waypoints.death"), 0xFFFF4D5E, true);
		wasDead = dead;
	}

	@Override public void renderOverlay(GuiGraphicsExtractor g) {
		Minecraft mc = Minecraft.getInstance();
		if (!markers.on() || mc.player == null || mc.level == null) return;
		Camera cam = mc.gameRenderer.mainCamera();
		if (!cam.isInitialized()) return;
		cam.getViewRotationProjectionMatrix(matrix);
		Vec3 cp = cam.position();
		String dim = Waypoints.dimension();
		var font = mc.font;
		for (Waypoints.Waypoint w : Waypoints.current()) {
			if (!w.visible || !w.dimension.equals(dim)) continue;
			double dist = w.distanceTo(mc.player.getX(), mc.player.getY(), mc.player.getZ());
			if (dist > maxDistance.get()) continue;
			vec.set((float) (w.x + 0.5 - cp.x), (float) (w.y + 1.2 - cp.y), (float) (w.z + 0.5 - cp.z), 1f);
			matrix.transform(vec);
			if (vec.w <= 0.05f) continue;
			float nx = vec.x / vec.w, ny = vec.y / vec.w;
			if (Math.abs(nx) > 1.1f || Math.abs(ny) > 1.1f) continue;
			int sx = Math.round((nx + 1) / 2 * g.guiWidth()), sy = Math.round((1 - ny) / 2 * g.guiHeight());
			// Elmas işaret + ad + mesafe
			int c = w.color;
			for (int i = 0; i < 5; i++) g.fill(sx - i, sy - 5 + i, sx + i + 1, sy - 4 + i, c);
			for (int i = 0; i < 4; i++) g.fill(sx - 3 + i, sy + i, sx + 4 - i, sy + i + 1, c);
			String label = distance.on() ? w.name + "  " + Math.round(dist) + "m" : w.name;
			int lw = font.width(label) + 8;
			g.fill(sx - lw / 2, sy - 19, sx + lw / 2, sy - 8, 0x90000000);
			g.fill(sx - lw / 2, sy - 9, sx + lw / 2, sy - 8, Theme.withAlpha(c, 0xFF));
			g.text(font, label, sx - lw / 2 + 4, sy - 17, 0xFFFFFFFF, false);
		}
	}
}
