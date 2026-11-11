package com.patron.pclient.modules;

import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.Overlay;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.ChoiceSetting;
import com.patron.pclient.module.setting.ColorSetting;
import com.patron.pclient.module.setting.SliderSetting;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.debug.DebugScreenEntries;
import net.minecraft.client.gui.components.debug.DebugScreenEntryStatus;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

/** Yalnızca görüntüyü değiştiren modüller; oyun mekaniğine ve sunucuya etkisi yoktur. */
public final class VisualModules {
	private VisualModules() {}

	/** Özel nişangah: biçim, boyut, boşluk, kalınlık, renk ve kontur. Vanilla nişangah Hud karışımında gizlenir. */
	public static final class Crosshair extends Module implements Overlay {
		public final ChoiceSetting style = add(new ChoiceSetting("style", "setting.style", "cross", List.of("cross", "dot", "circle", "square", "x")));
		public final SliderSetting size = add(new SliderSetting("size", "setting.size", 5, 2, 14, 1, "%.0f"));
		public final SliderSetting gap = add(new SliderSetting("gap", "setting.gap", 2, 0, 8, 1, "%.0f"));
		public final SliderSetting thickness = add(new SliderSetting("thickness", "setting.thickness", 1, 1, 3, 1, "%.0f"));
		public final ColorSetting color = add(new ColorSetting("color", "setting.color", 0xFFFFFFFF));
		public final BoolSetting outline = add(new BoolSetting("outline", "setting.outline", true));
		public final BoolSetting centerDot = add(new BoolSetting("centerDot", "setting.centerDot", false));
		public final BoolSetting cooldown = add(new BoolSetting("cooldown", "setting.attackCooldown", true));

		public Crosshair() { super("crosshair", Category.VISUAL, "crosshair", false); }

		public static boolean replacesVanilla() { return ModuleManager.get(Crosshair.class).isEnabled(); }

		@Override public void renderOverlay(GuiGraphicsExtractor g) {
			Minecraft mc = Minecraft.getInstance();
			if (mc.player == null || !mc.options.getCameraType().isFirstPerson() || mc.gui.screen() != null && !(mc.gui.screen() instanceof net.minecraft.client.gui.screens.ChatScreen)) return;
			draw(g, g.guiWidth() / 2, g.guiHeight() / 2);
			if (cooldown.on()) {
				float f = mc.player.getAttackStrengthScale(0f);
				if (f < 1f) {
					int cx = g.guiWidth() / 2, y = g.guiHeight() / 2 + (int) Math.round(size.get() + gap.get()) + 5;
					g.fill(cx - 8, y, cx + 8, y + 2, 0x80000000);
					g.fill(cx - 8, y, cx - 8 + Math.round(16 * f), y + 2, color.get());
				}
			}
		}

		/** (cx, cy) merkezli çizer; ayar sayfası önizlemesi de bunu kullanır. */
		public void draw(GuiGraphicsExtractor g, int cx, int cy) {
			int s = (int) Math.round(size.get()), gp = (int) Math.round(gap.get()), t = (int) Math.round(thickness.get());
			int c = color.get(), half = t / 2;
			switch (style.get()) {
				case "dot" -> rect(g, cx - half - 1, cy - half - 1, cx - half + t + 1, cy - half + t + 1, c);
				case "circle" -> {
					int r = Math.max(2, s);
					int steps = r * 10;
					for (int i = 0; i < steps; i++) {
						double a = Math.PI * 2 * i / steps;
						int x = cx + (int) Math.round(Math.cos(a) * r), y = cy + (int) Math.round(Math.sin(a) * r);
						if (outline.on()) g.fill(x - 1, y - 1, x + t + 1, y + t + 1, 0x90000000);
					}
					for (int i = 0; i < steps; i++) {
						double a = Math.PI * 2 * i / steps;
						int x = cx + (int) Math.round(Math.cos(a) * r), y = cy + (int) Math.round(Math.sin(a) * r);
						g.fill(x, y, x + t, y + t, c);
					}
				}
				case "square" -> {
					int r = Math.max(2, s);
					rect(g, cx - r, cy - r, cx + r + 1, cy - r + t, c);
					rect(g, cx - r, cy + r + 1 - t, cx + r + 1, cy + r + 1, c);
					rect(g, cx - r, cy - r, cx - r + t, cy + r + 1, c);
					rect(g, cx + r + 1 - t, cy - r, cx + r + 1, cy + r + 1, c);
				}
				case "x" -> {
					for (int i = gp; i <= gp + s; i++) {
						rect(g, cx + i, cy + i, cx + i + t, cy + i + t, c);
						rect(g, cx - i, cy + i, cx - i + t, cy + i + t, c);
						rect(g, cx + i, cy - i, cx + i + t, cy - i + t, c);
						rect(g, cx - i, cy - i, cx - i + t, cy - i + t, c);
					}
				}
				default -> {
					rect(g, cx - half, cy - gp - s, cx - half + t, cy - gp, c);
					rect(g, cx - half, cy + gp + 1, cx - half + t, cy + gp + 1 + s, c);
					rect(g, cx - gp - s, cy - half, cx - gp, cy - half + t, c);
					rect(g, cx + gp + 1, cy - half, cx + gp + 1 + s, cy - half + t, c);
				}
			}
			if (centerDot.on() && !style.is("dot")) rect(g, cx - half, cy - half, cx - half + t, cy - half + t, c);
		}

		private void rect(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int c) {
			if (outline.on()) g.fill(x1 - 1, y1 - 1, x2 + 1, y2 + 1, 0x90000000);
			g.fill(x1, y1, x2, y2, c);
		}
	}

	/** Hasar alınca kameranın sarsılmasını kapatır. */
	public static final class NoHurtCam extends Module {
		public NoHurtCam() { super("hurtcam", Category.VISUAL, "shake", false); }

		public static boolean active() { return ModuleManager.get(NoHurtCam.class).isEnabled(); }
	}

	/** Yanarken ekranı kaplayan ateşi aşağı çeker. */
	public static final class LowFire extends Module {
		public final SliderSetting offset = add(new SliderSetting("offset", "setting.fireHeight", 0.3, 0.05, 0.5, 0.05, "%.2f"));

		public LowFire() { super("lowfire", Category.VISUAL, "fire", false); }

		/** Ateş katmanının aşağı kaydırılacağı miktar (0: etkisiz). */
		public static float shift() {
			LowFire m = ModuleManager.get(LowFire.class);
			return m.isEnabled() ? m.offset.get().floatValue() : 0f;
		}
	}

	/** Minecraft'ın hata ayıklama görüntülerinden birini açık tutar; kapanınca eski durumuna döner. */
	private abstract static class DebugToggle extends Module {
		private final Identifier entry;
		private DebugScreenEntryStatus before;

		DebugToggle(String id, String icon, Identifier entry) {
			super(id, Category.VISUAL, icon, false);
			this.entry = entry;
		}

		@Override public void tick() {
			var entries = Minecraft.getInstance().debugEntries;
			if (entries == null) return;
			if (before == null) before = entries.getStatus(entry);
			if (entries.getStatus(entry) != DebugScreenEntryStatus.ALWAYS_ON) entries.setStatus(entry, DebugScreenEntryStatus.ALWAYS_ON);
		}

		@Override protected void onDisable() {
			var entries = Minecraft.getInstance().debugEntries;
			if (entries != null && before != null) entries.setStatus(entry, before);
			before = null;
		}
	}

	/** Varlık çarpışma kutularını gösterir (F3+B ile aynı görüntü). */
	public static final class Hitboxes extends DebugToggle {
		public Hitboxes() { super("hitboxes", "box", DebugScreenEntries.ENTITY_HITBOXES); }
	}

	/** Chunk sınırlarını gösterir (F3+G ile aynı görüntü). */
	public static final class ChunkBorders extends DebugToggle {
		public ChunkBorders() { super("chunkborders", "grid", DebugScreenEntries.CHUNK_BORDERS); }
	}

	/** Yağmuru ve fırtınayı yalnızca senin ekranında kaldırır. */
	public static final class ClearWeather extends Module {
		public ClearWeather() { super("weather", Category.VISUAL, "cloud", false); }

		@Override public void tick() {
			var level = Minecraft.getInstance().level;
			if (level == null) return;
			level.setRainLevel(0);
			level.setThunderLevel(0);
		}
	}

	/** Sohbet mesajlarının başına saat ekler. */
	public static final class ChatTweaks extends Module {
		public final ChoiceSetting format = add(new ChoiceSetting("format", "setting.timeFormat", "hm", List.of("hm", "hms")));
		public final ColorSetting color = add(new ColorSetting("color", "setting.color", 0xFF9CA3AF));

		public ChatTweaks() { super("chat", Category.SERVER, "chat", false); }

		/** ChatComponent karışımından: etkinse mesajın başına zaman damgası eklenir. */
		public static Component decorate(Component message) {
			ChatTweaks m = ModuleManager.get(ChatTweaks.class);
			if (!m.isEnabled() || message == null) return message;
			String time = LocalTime.now().format(DateTimeFormatter.ofPattern(m.format.is("hms") ? "HH:mm:ss" : "HH:mm"));
			return Component.literal("[" + time + "] ").withColor(m.color.get() & 0xFFFFFF).append(message.copy());
		}
	}
}
