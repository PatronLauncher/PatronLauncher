package com.patron.pclient.modules;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.L;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.KeySetting;
import java.util.Locale;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/** Tek satırlık küçük bilgi modülleri. */
public final class InfoModules {
	private InfoModules() {}

	static String duration(long ms) {
		long s = Math.max(0, ms) / 1000;
		return s >= 3600 ? String.format("%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String.format("%02d:%02d", s / 60, s % 60);
	}

	/** Dünyadaki gün sayısı (bir Minecraft günü 20 dakikadır). */
	public static final class Day extends HudModule {
		public Day() { super("day", Category.HUD, "sun", false, 0.75, 0.004); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			var level = Minecraft.getInstance().level;
			long day = preview || level == null ? 42 : level.getOverworldClockTime() / 24000L + 1;
			textBox(g, L.t("hud.day", day));
		}
	}

	/** Java bellek kullanımı. */
	public static final class Memory extends HudModule {
		public Memory() { super("memory", Category.HUD, "chip", false, 0.75, 0.06); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			Runtime r = Runtime.getRuntime();
			long used = (r.totalMemory() - r.freeMemory()) >> 20, max = Math.max(1, r.maxMemory() >> 20);
			textBox(g, L.t("hud.memory", used * 100 / max, used, max));
		}
	}

	/** Bağlı olunan sunucunun adresi; tek oyunculuda dünya adı. */
	public static final class ServerAddress extends HudModule {
		public final BoolSetting hideSingle = add(new BoolSetting("hideSingle", "setting.hideSingleplayer", false));

		public ServerAddress() { super("serverip", Category.SERVER, "server", false, 0.5, 0.07); }

		@Override public boolean visible(boolean preview) {
			return preview || !(hideSingle.on() && Minecraft.getInstance().getCurrentServer() == null);
		}

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			Minecraft mc = Minecraft.getInstance();
			String text;
			if (preview) text = "oyna.ornek.net";
			else if (mc.getCurrentServer() != null) text = mc.getCurrentServer().ip;
			else if (mc.getSingleplayerServer() != null) text = L.t("hud.singleplayer", mc.getSingleplayerServer().getWorldData().getLevelName());
			else text = "-";
			textBox(g, text);
		}
	}

	/** Bu dünyaya ya da sunucuya girdiğinden beri geçen süre. */
	public static final class Playtime extends HudModule {
		private Object level;
		private long since;

		public Playtime() { super("playtime", Category.HUD, "hourglass", false, 0.25, 0.004); }

		@Override public void tick() {
			var l = Minecraft.getInstance().level;
			if (l != level) {
				level = l;
				since = System.currentTimeMillis();
			}
		}

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			textBox(g, L.t("hud.playtime", duration(preview || since == 0 ? 3_725_000 : System.currentTimeMillis() - since)));
		}
	}

	/** Tuşla başlat/durdur; durmuşken hızlıca iki kez basınca sıfırlanır. */
	public static final class Stopwatch extends HudModule {
		public final KeySetting key = add(new KeySetting("key", "setting.startStopKey", InputConstants.KEY_K));
		private long start, elapsed, lastStop;
		private boolean running, wasDown;

		public Stopwatch() { super("stopwatch", Category.HUD, "clock", false, 0.25, 0.06); }

		@Override public void tick() {
			boolean down = Minecraft.getInstance().gui.screen() == null && key.isDown();
			if (down && !wasDown) {
				long now = System.currentTimeMillis();
				if (running) {
					elapsed += now - start;
					running = false;
					lastStop = now;
				} else if (now - lastStop < 400) elapsed = 0;
				else {
					start = now;
					running = true;
				}
			}
			wasDown = down;
		}

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			long ms = preview ? 83_420 : elapsed + (running ? System.currentTimeMillis() - start : 0);
			textBox(g, L.t(running || preview ? "hud.stopwatchRun" : "hud.stopwatchStop", duration(ms) + "." + ms / 100 % 10));
		}
	}

	/** Hasar almadan art arda vurduğun darbe sayısı. */
	public static final class Combo extends HudModule {
		public final BoolSetting hideZero = add(new BoolSetting("hideZero", "setting.hideWhenZero", true));
		private int combo, lastHurt;
		private long lastHit;

		public Combo() { super("combo", Category.HUD, "sword", false, 0.42, 0.58); }

		/** MultiPlayerGameMode.attack karışımından çağrılır. */
		public static void onAttack(Entity target) {
			Combo m = ModuleManager.get(Combo.class);
			if (!m.isEnabled() || !(target instanceof LivingEntity living) || living.hurtTime > 0) return;
			m.combo++;
			m.lastHit = System.currentTimeMillis();
		}

		@Override public void tick() {
			var p = Minecraft.getInstance().player;
			if (p == null) return;
			if (p.hurtTime > 0 && lastHurt == 0 || System.currentTimeMillis() - lastHit > 3000) combo = 0;
			lastHurt = p.hurtTime;
		}

		@Override public boolean visible(boolean preview) { return preview || !hideZero.on() || combo > 0; }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) { textBox(g, L.t("hud.combo", preview ? 4 : combo)); }
	}

	/** Son vuruşun mesafesi: gözünden hedefin çarpışma kutusundaki en yakın noktaya. */
	public static final class Reach extends HudModule {
		public final BoolSetting fade = add(new BoolSetting("fade", "setting.hideAfter3s", true));
		private double last = -1;
		private long at;

		public Reach() { super("reach", Category.HUD, "ruler", false, 0.58, 0.58); }

		public static void onAttack(Entity target) {
			Reach m = ModuleManager.get(Reach.class);
			var p = Minecraft.getInstance().player;
			if (!m.isEnabled() || p == null) return;
			Vec3 eye = p.getEyePosition();
			AABB b = target.getBoundingBox();
			Vec3 near = new Vec3(Math.clamp(eye.x, b.minX, b.maxX), Math.clamp(eye.y, b.minY, b.maxY), Math.clamp(eye.z, b.minZ, b.maxZ));
			m.last = eye.distanceTo(near);
			m.at = System.currentTimeMillis();
		}

		@Override public boolean visible(boolean preview) {
			return preview || last >= 0 && (!fade.on() || System.currentTimeMillis() - at < 3000);
		}

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			textBox(g, L.t("hud.reach", String.format(Locale.ROOT, "%.2f", preview ? 2.87 : last)));
		}
	}

	/** Açlık ve gizli doygunluk değeri. */
	public static final class Saturation extends HudModule {
		public Saturation() { super("saturation", Category.HUD, "food", false, 0.996, 0.70); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			var p = Minecraft.getInstance().player;
			int food = preview || p == null ? 18 : p.getFoodData().getFoodLevel();
			float sat = preview || p == null ? 5.6f : p.getFoodData().getSaturationLevel();
			textBox(g, L.t("hud.saturation", food, String.format(Locale.ROOT, "%.1f", sat)));
		}
	}
}
