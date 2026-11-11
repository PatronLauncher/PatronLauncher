package com.patron.pclient.modules;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.KeySetting;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.util.Mth;

/** Kamera modülleri: serbest bakış ve anlık bakış. Yalnızca görüntüyü değiştirir, sunucuya bir şey gitmez. */
public final class CameraModules {
	private CameraModules() {}

	/**
	 * Serbest bakış: tuş basılıyken kamera karakterden bağımsız döner, karakter baktığı yöne bakmaya devam eder.
	 * Kamera açısı Camera karışımında, fare hareketi MouseHandler karışımında yönlendirilir.
	 */
	public static final class Freelook extends Module {
		public final KeySetting key = add(new KeySetting("key", "setting.key", InputConstants.KEY_LALT));
		public final BoolSetting toggle = add(new BoolSetting("toggle", "setting.toggleMode", false));
		public final BoolSetting invert = add(new BoolSetting("invert", "setting.invertPitch", false));
		public final BoolSetting firstPerson = add(new BoolSetting("firstPerson", "setting.stayFirstPerson", false));

		private boolean active, wasDown, toggled;
		private float yaw, pitch;
		private CameraType saved;

		public Freelook() { super("freelook", Category.MECHANIC, "eye", false); }

		public static Freelook instance() { return ModuleManager.get(Freelook.class); }

		public boolean active() { return active && isEnabled(); }

		public float yaw() { return yaw; }

		public float pitch() { return pitch; }

		/** Fare hareketi: Entity.turn ile aynı ölçek (0.15). */
		public void turn(double dx, double dy) {
			yaw += (float) dx * 0.15f;
			pitch = Mth.clamp(pitch + (float) (invert.on() ? -dy : dy) * 0.15f, -90f, 90f);
		}

		@Override public void tick() {
			Minecraft mc = Minecraft.getInstance();
			if (mc.player == null) {
				stop(mc);
				return;
			}
			boolean down = key.isDown() && mc.gui.screen() == null;
			if (toggle.on()) {
				if (down && !wasDown) toggled = !toggled;
			} else toggled = down;
			wasDown = down;
			if (toggled && !active) {
				yaw = mc.player.getYRot();
				pitch = mc.player.getXRot();
				saved = mc.options.getCameraType();
				if (saved.isFirstPerson() && !firstPerson.on()) mc.options.setCameraType(CameraType.THIRD_PERSON_BACK);
				active = true;
			} else if (!toggled && active) stop(mc);
		}

		private void stop(Minecraft mc) {
			if (!active) return;
			active = false;
			toggled = false;
			if (saved != null) mc.options.setCameraType(saved);
			saved = null;
		}

		@Override protected void onDisable() { stop(Minecraft.getInstance()); }
	}

	/** Anlık bakış: tuş basılıyken kamerayı önden (ya da arkadan) gösterir, bırakınca eski görünüme döner. */
	public static final class Snaplook extends Module {
		public final KeySetting key = add(new KeySetting("key", "setting.key", InputConstants.KEY_V));
		public final BoolSetting front = add(new BoolSetting("front", "setting.frontView", true));
		private CameraType saved;

		public Snaplook() { super("snaplook", Category.MECHANIC, "swap", false); }

		@Override public void tick() {
			Minecraft mc = Minecraft.getInstance();
			boolean down = mc.player != null && key.isDown() && mc.gui.screen() == null;
			if (down && saved == null) {
				saved = mc.options.getCameraType();
				mc.options.setCameraType(front.on() ? CameraType.THIRD_PERSON_FRONT : CameraType.THIRD_PERSON_BACK);
			} else if (!down && saved != null) {
				mc.options.setCameraType(saved);
				saved = null;
			}
		}

		@Override protected void onDisable() {
			if (saved != null) Minecraft.getInstance().options.setCameraType(saved);
			saved = null;
		}
	}
}
