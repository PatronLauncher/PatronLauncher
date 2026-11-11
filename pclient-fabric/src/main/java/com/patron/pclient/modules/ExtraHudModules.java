package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.gui.Theme;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.Overlay;
import com.patron.pclient.module.setting.SliderSetting;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.core.BlockPos;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.PrimedTnt;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.phys.Vec3;
import org.joml.Matrix4f;
import org.joml.Vector4f;

/** Ek HUD modülleri. Dünyayı okuyanlar değerlerini tikte (saniyede 20) günceller, karede yalnızca çizer. */
public final class ExtraHudModules {
	private ExtraHudModules() {}

	private static String tenths(double v) { return Double.toString(Math.round(v * 10) / 10.0); }

	/** Bulunduğun bloğun ışık düzeyi. */
	public static final class Light extends HudModule {
		private int block, sky;

		public Light() { super("light", Category.HUD, "sun", false, 0.22, 0.24); }

		@Override public void tick() {
			Minecraft mc = Minecraft.getInstance();
			if (mc.level == null || mc.player == null) return;
			BlockPos pos = mc.player.blockPosition();
			block = mc.level.getBrightness(LightLayer.BLOCK, pos);
			sky = mc.level.getBrightness(LightLayer.SKY, pos);
		}

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			int b = preview ? 12 : block, s = preview ? 15 : sky;
			textBox(g, L.t("hud.light", Math.max(b, s), b, s));
		}
	}

	/** Yatay ve dikey bakış açısı. */
	public static final class Rotation extends HudModule {
		public Rotation() { super("rotation", Category.HUD, "compass", false, 0.22, 0.30); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			var p = Minecraft.getInstance().player;
			double yaw = preview || p == null ? 45.5 : Mth.wrapDegrees(p.getYRot()), pitch = preview || p == null ? -12.3 : p.getXRot();
			textBox(g, L.t("hud.rotation", tenths(yaw), tenths(pitch)));
		}
	}

	/** Dünyadaki saat (SS:DD). */
	public static final class WorldTime extends HudModule {
		private static final long DAY = 24_000, DAWN_OFFSET = 6_000, TICKS_PER_HOUR = 1_000;

		public WorldTime() { super("worldtime", Category.HUD, "clock", false, 0.25, 0.11); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			var level = Minecraft.getInstance().level;
			long t = preview || level == null ? 12_000 : (level.getOverworldClockTime() + DAWN_OFFSET) % DAY;
			long hour = t / TICKS_PER_HOUR, minute = t % TICKS_PER_HOUR * 60 / TICKS_PER_HOUR;
			textBox(g, L.t("hud.worldtime", (hour < 10 ? "0" : "") + hour + ":" + (minute < 10 ? "0" : "") + minute));
		}
	}

	/** Sunucudaki oyuncu sayısı. */
	public static final class Players extends HudModule {
		public Players() { super("players", Category.SERVER, "user", false, 0.75, 0.11); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			var connection = Minecraft.getInstance().getConnection();
			textBox(g, L.t("hud.players", preview ? 128 : connection == null ? 1 : connection.getOnlinePlayers().size()));
		}
	}

	/** Eldeki eşya: simge, ad ve dayanıklılık. */
	public static final class HeldItem extends HudModule {
		private ItemStack stack;
		private String name = "", detail = "";

		public HeldItem() { super("helditem", Category.HUD, "bag", false, 0.18, 0.96); }

		@Override public void tick() {
			var p = Minecraft.getInstance().player;
			ItemStack held = p == null ? null : p.getMainHandItem();
			if (held == null || held.isEmpty()) {
				stack = null;
				return;
			}
			stack = held;
			name = held.getHoverName().getString();
			detail = held.isDamageableItem() ? (held.getMaxDamage() - held.getDamageValue()) + " / " + held.getMaxDamage() : "x" + held.getCount();
		}

		@Override public boolean visible(boolean preview) { return preview || stack != null; }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			var font = Minecraft.getInstance().font;
			String title = preview ? L.t("hud.targetSample") : name, sub = preview ? "1248 / 1561" : detail;
			int textX = preview ? 6 : 24;
			w = textX + Math.max(font.width(title), font.width(sub)) + 6;
			h = 26;
			if (background.on()) Theme.hudBox(g, 0, 0, w, h);
			if (!preview && stack != null) g.fakeItem(stack, 4, 5);
			g.text(font, title, textX, 4, color.get(), true);
			g.text(font, sub, textX, 14, 0xFFAEB3BF, true);
		}
	}

	/** Bu oturumdaki vuruş, kırılan blok ve ölüm sayıları. */
	public static final class Session extends HudModule {
		private int hits, blocks, deaths;
		private boolean wasDead;

		public Session() { super("session", Category.HUD, "chip", false, 0.22, 0.36); }

		public static void onAttack() {
			Session m = ModuleManager.get(Session.class);
			if (m.isEnabled()) m.hits++;
		}

		public static void onBlockBroken() {
			Session m = ModuleManager.get(Session.class);
			if (m.isEnabled()) m.blocks++;
		}

		@Override public void tick() {
			var p = Minecraft.getInstance().player;
			boolean dead = p != null && p.isDeadOrDying();
			if (dead && !wasDead) deaths++;
			wasDead = dead;
		}

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			linesBox(g, List.of(
				L.t("hud.sessionHits", preview ? 128 : hits),
				L.t("hud.sessionBlocks", preview ? 342 : blocks),
				L.t("hud.sessionDeaths", preview ? 3 : deaths)));
		}
	}

	/** Bindiğin hayvanın ya da aracın adı, hızı ve canı. */
	public static final class Mount extends HudModule {
		private final List<String> lines = new ArrayList<>();
		private double lastX, lastZ;
		private Entity last;

		public Mount() { super("mount", Category.HUD, "run", false, 0.996, 0.86); }

		@Override public void tick() {
			var p = Minecraft.getInstance().player;
			Entity vehicle = p == null ? null : p.getVehicle();
			lines.clear();
			if (vehicle == null) {
				last = null;
				return;
			}
			double speed = vehicle == last ? Math.hypot(vehicle.getX() - lastX, vehicle.getZ() - lastZ) * 20 : 0;
			last = vehicle;
			lastX = vehicle.getX();
			lastZ = vehicle.getZ();
			lines.add(vehicle.getDisplayName().getString());
			lines.add(L.t("hud.mountSpeed", tenths(speed)));
			if (vehicle instanceof LivingEntity l) lines.add(L.t("hud.mountHealth", tenths(l.getHealth()), tenths(l.getMaxHealth())));
		}

		@Override public boolean visible(boolean preview) { return preview || !lines.isEmpty(); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			linesBox(g, preview ? List.of(L.t("hud.mountSample"), L.t("hud.mountSpeed", "12.4"), L.t("hud.mountHealth", "24.0", "30.0")) : lines);
		}
	}

	/** Yakındaki ateşlenmiş TNT'lerin üstünde patlamaya kalan saniye. */
	public static final class TntTimer extends Module implements Overlay {
		private static final double RANGE_SQ = 48 * 48;
		private static final int FUSE_WARNING_TICKS = 20, TICKS_PER_SECOND = 20;
		private final List<PrimedTnt> nearby = new ArrayList<>();
		private final Matrix4f matrix = new Matrix4f();
		private final Vector4f vec = new Vector4f();

		public TntTimer() { super("tnttimer", Category.HUD, "fire", false); }

		@Override public void tick() {
			Minecraft mc = Minecraft.getInstance();
			nearby.clear();
			if (mc.level == null || mc.player == null) return;
			for (Entity e : mc.level.entitiesForRendering())
				if (e instanceof PrimedTnt tnt && tnt.distanceToSqr(mc.player) <= RANGE_SQ) nearby.add(tnt);
		}

		@Override public void renderOverlay(GuiGraphicsExtractor g) {
			if (nearby.isEmpty()) return;
			Minecraft mc = Minecraft.getInstance();
			Camera cam = mc.gameRenderer.mainCamera();
			if (!cam.isInitialized()) return;
			cam.getViewRotationProjectionMatrix(matrix);
			Vec3 cp = cam.position();
			for (PrimedTnt tnt : nearby) {
				vec.set((float) (tnt.getX() - cp.x), (float) (tnt.getY() + 1.2 - cp.y), (float) (tnt.getZ() - cp.z), 1f);
				matrix.transform(vec);
				if (vec.w <= 0.05f) continue;
				float nx = vec.x / vec.w, ny = vec.y / vec.w;
				if (Math.abs(nx) > 1.1f || Math.abs(ny) > 1.1f) continue;
				int sx = Math.round((nx + 1) / 2 * g.guiWidth()), sy = Math.round((1 - ny) / 2 * g.guiHeight());
				int fuse = tnt.getFuse();
				String text = tenths((double) fuse / TICKS_PER_SECOND) + "s";
				int half = mc.font.width(text) / 2 + 3;
				g.fill(sx - half, sy - 6, sx + half, sy + 6, 0x90000000);
				g.text(mc.font, text, sx - half + 3, sy - 4, fuse <= FUSE_WARNING_TICKS ? 0xFFFF6B6B : 0xFFFFD43B, true);
			}
		}
	}

	/** Dayanıklılığı azalan eşya için ekranda uyarı. */
	public static final class DurabilityWarning extends Module implements Overlay {
		private static final int CHECK_EVERY_TICKS = 10;
		public final SliderSetting threshold = add(new SliderSetting("threshold", "setting.warnBelow", 10, 1, 50, 1, "%%%.0f"));
		private String warning;
		private int timer;

		public DurabilityWarning() { super("durawarn", Category.HUD, "armor", false); }

		@Override public void tick() {
			if (++timer < CHECK_EVERY_TICKS) return;
			timer = 0;
			var p = Minecraft.getInstance().player;
			warning = null;
			if (p == null) return;
			int lowest = (int) Math.round(threshold.get()) + 1;
			for (EquipmentSlot slot : EquipmentSlot.values()) {
				ItemStack s = p.getItemBySlot(slot);
				if (s.isEmpty() || !s.isDamageableItem()) continue;
				int left = (s.getMaxDamage() - s.getDamageValue()) * 100 / s.getMaxDamage();
				if (left < lowest) {
					lowest = left;
					warning = L.t("hud.durabilityLow", s.getHoverName().getString(), left);
				}
			}
		}

		@Override public void renderOverlay(GuiGraphicsExtractor g) {
			if (warning == null) return;
			var font = Minecraft.getInstance().font;
			g.text(font, warning, (g.guiWidth() - font.width(warning)) / 2, g.guiHeight() - 92, 0xFFFF6B6B, true);
		}
	}

	/** Canın azalınca ekran kenarları kırmızı yanıp söner. */
	public static final class LowHealth extends Module implements Overlay {
		private static final int EDGE = 56, RED = 0xFF2A3D, MAX_ALPHA = 150;
		private static final double PULSE_MS = 260;
		public final SliderSetting threshold = add(new SliderSetting("threshold", "setting.warnBelow", 30, 10, 60, 5, "%%%.0f"));

		public LowHealth() { super("lowhealth", Category.HUD, "potion", false); }

		@Override public void renderOverlay(GuiGraphicsExtractor g) {
			var p = Minecraft.getInstance().player;
			if (p == null || p.isDeadOrDying() || p.getHealth() / p.getMaxHealth() * 100 > threshold.get()) return;
			double pulse = 0.65 + 0.35 * Math.sin(System.currentTimeMillis() / PULSE_MS);
			int solid = (int) (MAX_ALPHA * pulse) << 24 | RED, clear = RED;
			int width = g.guiWidth(), height = g.guiHeight();
			g.fillGradient(0, 0, width, EDGE, solid, clear);
			g.fillGradient(0, height - EDGE, width, height, clear, solid);
		}
	}
}
