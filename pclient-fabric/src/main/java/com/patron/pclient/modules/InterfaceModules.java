package com.patron.pclient.modules;

import com.mojang.blaze3d.vertex.PoseStack;
import com.patron.pclient.mixin.OverlayTextureAccessor;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.ColorSetting;
import com.patron.pclient.module.setting.SliderSetting;
import java.util.Locale;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.toasts.AdvancementToast;
import net.minecraft.client.gui.components.toasts.RecipeToast;
import net.minecraft.client.gui.components.toasts.SystemToast;
import net.minecraft.client.gui.components.toasts.Toast;
import net.minecraft.client.gui.components.toasts.TutorialToast;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.sounds.SoundEvents;

/** Minecraft'ın kendi arayüzünü ve görüntüsünü ayarlayan modüller; oyun mekaniğine etkisi yoktur. */
public final class InterfaceModules {
	private InterfaceModules() {}

	/** Skor tablosu: gizle, boyutlandır, dikey kaydır. */
	public static final class Scoreboard extends Module {
		public final BoolSetting hide = add(new BoolSetting("hide", "setting.hide", false));
		public final SliderSetting size = add(new SliderSetting("size", "setting.scale", 1, 0.5, 1.5, 0.05, "%.2fx"));
		public final SliderSetting offset = add(new SliderSetting("offset", "setting.verticalOffset", 0, -80, 80, 2, "%.0f"));

		public Scoreboard() { super("scoreboard", Category.VISUAL, "grid", false); }

		private static Scoreboard self() { return ModuleManager.get(Scoreboard.class); }

		public static boolean hidden() {
			Scoreboard m = self();
			return m.isEnabled() && m.hide.on();
		}

		/** Çizimi sağ-orta noktaya göre ölçekler; false dönerse dönüşüm uygulanmadı. */
		public static boolean begin(GuiGraphicsExtractor g) {
			Scoreboard m = self();
			if (!m.isEnabled()) return false;
			float s = m.size.get().floatValue(), w = g.guiWidth(), h = g.guiHeight() / 2f;
			g.pose().pushMatrix();
			g.pose().translate(w, h + m.offset.get().floatValue());
			g.pose().scale(s, s);
			g.pose().translate(-w, -h);
			return true;
		}
	}

	/** Boss çubuğu: gizle ya da boyutlandır. */
	public static final class BossBar extends Module {
		public final BoolSetting hide = add(new BoolSetting("hide", "setting.hide", false));
		public final SliderSetting size = add(new SliderSetting("size", "setting.scale", 1, 0.5, 1.5, 0.05, "%.2fx"));

		public BossBar() { super("bossbar", Category.VISUAL, "flag", false); }

		private static BossBar self() { return ModuleManager.get(BossBar.class); }

		public static boolean hidden() {
			BossBar m = self();
			return m.isEnabled() && m.hide.on();
		}

		/** Ekranın üst ortasına göre ölçekler. */
		public static boolean begin(GuiGraphicsExtractor g) {
			BossBar m = self();
			if (!m.isEnabled()) return false;
			float s = m.size.get().floatValue(), cx = g.guiWidth() / 2f;
			g.pose().pushMatrix();
			g.pose().translate(cx, 0);
			g.pose().scale(s, s);
			g.pose().translate(-cx, 0);
			return true;
		}
	}

	/** Ekranı kaplayan süs efektlerini kapatır. Görüşü kısıtlayan oyun etkilerine dokunmaz. */
	public static final class ScreenEffects extends Module {
		public final BoolSetting vignette = add(new BoolSetting("vignette", "setting.hideVignette", true));
		public final BoolSetting portal = add(new BoolSetting("portal", "setting.hidePortal", true));
		public final BoolSetting nausea = add(new BoolSetting("nausea", "setting.hideNausea", false));
		public final BoolSetting totem = add(new BoolSetting("totem", "setting.hideTotem", false));

		public ScreenEffects() { super("screeneffects", Category.VISUAL, "layers", false); }

		private static ScreenEffects self() { return ModuleManager.get(ScreenEffects.class); }

		public static boolean hideVignette() { return self().isEnabled() && self().vignette.on(); }

		public static boolean hidePortal() { return self().isEnabled() && self().portal.on(); }

		public static boolean hideNausea() { return self().isEnabled() && self().nausea.on(); }

		public static boolean hideTotem() { return self().isEnabled() && self().totem.on(); }
	}

	/** Sağ üstteki bildirimleri türüne göre gizler. */
	public static final class HideToasts extends Module {
		public final BoolSetting advancements = add(new BoolSetting("advancements", "setting.toastAdvancements", true));
		public final BoolSetting recipes = add(new BoolSetting("recipes", "setting.toastRecipes", true));
		public final BoolSetting tutorial = add(new BoolSetting("tutorial", "setting.toastTutorial", true));
		public final BoolSetting system = add(new BoolSetting("system", "setting.toastSystem", false));

		public HideToasts() { super("toasts", Category.VISUAL, "close", false); }

		public static boolean blocks(Toast toast) {
			HideToasts m = ModuleManager.get(HideToasts.class);
			if (!m.isEnabled()) return false;
			return toast instanceof AdvancementToast && m.advancements.on()
				|| toast instanceof RecipeToast && m.recipes.on()
				|| toast instanceof TutorialToast && m.tutorial.on()
				|| toast instanceof SystemToast && m.system.on();
		}
	}

	/** Tab listesinde gecikme çubukları yerine milisaniye yazar. */
	public static final class TabPing extends Module {
		public TabPing() { super("tabping", Category.SERVER, "signal", false); }

		/** true: sayı çizildi, Minecraft'ın simgesi atlanmalı. */
		public static boolean draw(GuiGraphicsExtractor g, int width, int x, int y, PlayerInfo info) {
			if (!ModuleManager.get(TabPing.class).isEnabled()) return false;
			int ms = info.getLatency();
			int color = ms <= 0 ? 0xFF9CA3AF : ms < 80 ? 0xFF4ADE80 : ms < 160 ? 0xFFFFD43B : 0xFFFF6B6B;
			String text = ms <= 0 ? "?" : Integer.toString(ms);
			var font = Minecraft.getInstance().font;
			g.text(font, text, x + width - font.width(text) - 1, y, color, true);
			return true;
		}
	}

	/** Üçüncü şahısta kendi isim etiketini gösterir. */
	public static final class OwnName extends Module {
		public OwnName() { super("ownname", Category.VISUAL, "user", false); }

		public static boolean shows(Object entity) {
			return ModuleManager.get(OwnName.class).isEnabled() && entity == Minecraft.getInstance().player;
		}
	}

	/** Sohbet: uzun geçmiş, tekrarları birleştirme, adın geçince vurgu ve ses. */
	public static final class ChatPlus extends Module {
		private static final int VANILLA_HISTORY = 100;
		public final SliderSetting history = add(new SliderSetting("history", "setting.chatHistory", 500, 100, 2000, 100, "%.0f"));
		public final BoolSetting compact = add(new BoolSetting("compact", "setting.chatCompact", true));
		public final BoolSetting mentions = add(new BoolSetting("mentions", "setting.chatMentions", true));
		public final BoolSetting sound = add(new BoolSetting("sound", "setting.chatMentionSound", true));
		public final ColorSetting color = add(new ColorSetting("color", "setting.color", 0xFFFFD43B));

		private String last;
		private int repeats;

		public ChatPlus() { super("chatplus", Category.SERVER, "chat", false); }

		private static ChatPlus self() { return ModuleManager.get(ChatPlus.class); }

		public static int historyLimit() {
			ChatPlus m = self();
			return m.isEnabled() ? m.history.get().intValue() : VANILLA_HISTORY;
		}

		/** Art arda gelen aynı mesajın kaçıncı tekrarı olduğunu döner (1: yeni mesaj). */
		public static int repeatOf(Component message) {
			ChatPlus m = self();
			if (!m.isEnabled() || !m.compact.on() || message == null) return 1;
			String text = message.getString();
			if (text.equals(m.last)) return ++m.repeats;
			m.last = text;
			m.repeats = 1;
			return 1;
		}

		public static Component decorate(Component message, int repeat) {
			ChatPlus m = self();
			if (!m.isEnabled() || message == null) return message;
			MutableComponent out = null;
			if (repeat == 1 && m.mentions.on() && m.mentionsMe(message.getString())) {
				out = Component.literal("● ").withColor(m.color.get() & 0xFFFFFF).append(message.copy());
				if (m.sound.on()) Minecraft.getInstance().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.NOTE_BLOCK_PLING, 1.6f));
			}
			if (repeat > 1) out = message.copy().append(Component.literal(" (x" + repeat + ")").withColor(0xAEB3BF));
			return out != null ? out : message;
		}

		private boolean mentionsMe(String text) {
			String me = Minecraft.getInstance().getUser().getName();
			if (me == null || me.isEmpty() || text.startsWith("<" + me + ">")) return false;
			return text.toLowerCase(Locale.ROOT).contains(me.toLowerCase(Locale.ROOT));
		}
	}

	/** Baktığın bloğun çerçevesi: renk ve kalınlık. */
	public static final class BlockOutline extends Module {
		public final ColorSetting color = add(new ColorSetting("color", "setting.color", 0xFFFF2A3D));
		public final SliderSetting thickness = add(new SliderSetting("thickness", "setting.thickness", 3, 1, 8, 0.5, "%.1f"));

		public BlockOutline() { super("blockoutline", Category.VISUAL, "box", false); }

		private static BlockOutline self() { return ModuleManager.get(BlockOutline.class); }

		public static int color(int vanilla) { return self().isEnabled() ? self().color.get() : vanilla; }

		public static float width(float vanilla) { return self().isEnabled() ? self().thickness.get().floatValue() : vanilla; }
	}

	/** Hasar alan varlıkların rengi. Doku yalnızca renk değişince güncellenir. */
	public static final class HitColor extends Module {
		/** OverlayTexture kurucusundaki Minecraft varsayılanı. */
		private static final int VANILLA = 0xB2FF0000;
		private static final int ALPHA = 0xB2000000, SIZE = 16, RED_ROWS = 8;
		public final ColorSetting color = add(new ColorSetting("color", "setting.color", 0xFF38BDF8));
		private int applied = VANILLA;

		public HitColor() { super("hitcolor", Category.VISUAL, "sword", false); }

		@Override public void tick() { apply(color.get() & 0xFFFFFF | ALPHA); }

		@Override protected void onDisable() { apply(VANILLA); }

		private void apply(int argb) {
			if (argb == applied) return;
			var renderer = Minecraft.getInstance().gameRenderer;
			if (renderer == null) return;
			var texture = ((OverlayTextureAccessor) renderer.overlayTexture()).pclient$texture();
			var pixels = texture.getPixels();
			if (pixels == null) return;
			for (int y = 0; y < RED_ROWS; y++)
				for (int x = 0; x < SIZE; x++) pixels.setPixel(x, y, argb);
			texture.upload();
			applied = argb;
		}
	}

	/** Birinci şahısta el ve eşya: boyut ve konum. */
	public static final class HandView extends Module {
		public final SliderSetting size = add(new SliderSetting("size", "setting.scale", 1, 0.4, 1.4, 0.05, "%.2fx"));
		public final SliderSetting x = add(new SliderSetting("x", "setting.handX", 0, -0.6, 0.6, 0.02, "%.2f"));
		public final SliderSetting y = add(new SliderSetting("y", "setting.handY", 0, -0.6, 0.6, 0.02, "%.2f"));
		public final SliderSetting z = add(new SliderSetting("z", "setting.handZ", 0, -0.6, 0.6, 0.02, "%.2f"));

		public HandView() { super("handview", Category.VISUAL, "shirt", false); }

		public static boolean begin(PoseStack pose) {
			HandView m = ModuleManager.get(HandView.class);
			if (!m.isEnabled()) return false;
			float s = m.size.get().floatValue();
			pose.pushPose();
			pose.translate(m.x.get(), m.y.get(), m.z.get());
			pose.scale(s, s, s);
			return true;
		}
	}
}
