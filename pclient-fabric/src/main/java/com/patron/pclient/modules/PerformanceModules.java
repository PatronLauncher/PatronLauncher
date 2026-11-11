package com.patron.pclient.modules;

import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.SliderSetting;
import java.util.concurrent.ThreadLocalRandom;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.entity.BeaconBlockEntity;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.phys.Vec3;

/**
 * Kare hızını artıran modüller. Bu yollar kare başına binlerce kez çağrılır; bu yüzden değerler
 * alanlarda hazır tutulur ve modül kapalıyken tek bir boolean okumasıyla çıkılır.
 */
public final class PerformanceModules {
	private PerformanceModules() {}

	/** Uzaktaki varlıkları ve blok varlıklarını çizmez. Oyuncular her zaman çizilir. */
	public static final class FpsBoost extends Module {
		public final SliderSetting entityDistance = add(new SliderSetting("entityDistance", "setting.entityDistance", 64, 16, 160, 8, "%.0f"));
		public final SliderSetting blockEntityDistance = add(new SliderSetting("blockEntityDistance", "setting.blockEntityDistance", 48, 16, 128, 8, "%.0f"));
		public final BoolSetting hideArmorStands = add(new BoolSetting("hideArmorStands", "setting.hideArmorStands", false));

		private static boolean on, hideStands;
		private static double entitySq, blockSq, camX, camY, camZ;

		public FpsBoost() { super("fpsboost", Category.PERFORMANCE, "speed", false); }

		private void refreshLimits() {
			double e = entityDistance.get(), b = blockEntityDistance.get();
			entitySq = e * e;
			blockSq = b * b;
			hideStands = hideArmorStands.on();
		}

		@Override protected void onEnable() {
			refreshLimits();
			on = true;
		}

		@Override protected void onDisable() { on = false; }

		@Override public void tick() {
			refreshLimits();
			var camera = Minecraft.getInstance().gameRenderer.mainCamera();
			if (!camera.isInitialized()) return;
			Vec3 p = camera.position();
			camX = p.x;
			camY = p.y;
			camZ = p.z;
		}

		public static boolean skipEntity(Entity entity, double camX, double camY, double camZ) {
			if (!on || entity instanceof Player) return false;
			if (hideStands && entity instanceof ArmorStand) return true;
			return entity.distanceToSqr(camX, camY, camZ) > entitySq;
		}

		public static boolean skipBlockEntity(BlockEntity blockEntity) {
			if (!on || blockEntity instanceof BeaconBlockEntity) return false;
			BlockPos pos = blockEntity.getBlockPos();
			double dx = pos.getX() + 0.5 - camX, dy = pos.getY() + 0.5 - camY, dz = pos.getZ() + 0.5 - camZ;
			return dx * dx + dy * dy + dz * dz > blockSq;
		}
	}

	/** Oluşan parçacıkların yalnızca ayarlanan yüzdesi çizilir. */
	public static final class Particles extends Module {
		public final SliderSetting amount = add(new SliderSetting("amount", "setting.particleAmount", 50, 0, 100, 5, "%.0f%%"));

		private static boolean on;
		private static double keep = 100;

		public Particles() { super("particles", Category.PERFORMANCE, "star", false); }

		@Override protected void onEnable() {
			keep = amount.get();
			on = true;
		}

		@Override protected void onDisable() { on = false; }

		@Override public void tick() { keep = amount.get(); }

		public static boolean drop() { return on && ThreadLocalRandom.current().nextDouble(100) >= keep; }
	}
}
