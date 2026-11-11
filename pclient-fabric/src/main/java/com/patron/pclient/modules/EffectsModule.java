package com.patron.pclient.modules;

import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.Hud;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;

/** Etkin iksirler: simge, ad + seviye ve kalan süre. */
public final class EffectsModule extends HudModule {
	private static final String[] ROMAN = {"", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"};
	public final BoolSetting icons = add(new BoolSetting("icons", "setting.icons", true));
	public final BoolSetting blink = add(new BoolSetting("blink", "setting.blink", true));

	public EffectsModule() { super("effects", Category.HUD, "potion", true, 0.004, 0.86); }

	private List<MobEffectInstance> effects(boolean preview) {
		if (preview) return List.of(new MobEffectInstance(MobEffects.SPEED, 20 * 95, 1), new MobEffectInstance(MobEffects.STRENGTH, 20 * 48));
		var p = Minecraft.getInstance().player;
		return p == null ? List.of() : new ArrayList<>(p.getActiveEffects());
	}

	@Override public boolean visible(boolean preview) { return !effects(preview).isEmpty(); }

	private static String time(MobEffectInstance e) {
		if (e.isInfiniteDuration()) return "∞";
		int s = e.getDuration() / 20;
		return String.format("%d:%02d", s / 60, s % 60);
	}

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		var font = Minecraft.getInstance().font;
		List<MobEffectInstance> list = effects(preview);
		int textX = icons.on() ? 24 : 5, maxW = 0;
		for (MobEffectInstance e : list) maxW = Math.max(maxW, font.width(name(e)));
		w = textX + maxW + 6;
		h = list.size() * 24 + 2;
		if (background.on()) com.patron.pclient.gui.Theme.hudBox(g, 0, 0, w, h);
		for (int i = 0; i < list.size(); i++) {
			MobEffectInstance e = list.get(i);
			int y = 2 + i * 24;
			// Son 10 saniyede yanıp söner.
			boolean dim = blink.on() && !e.isInfiniteDuration() && e.getDuration() < 200 && (e.getDuration() / 10) % 2 == 0;
			if (icons.on()) g.blitSprite(RenderPipelines.GUI_TEXTURED, Hud.getMobEffectSprite(e.getEffect()), 3, y + 2, 18, 18);
			g.text(font, name(e), textX, y + 2, dim ? 0xFF8A8F9C : color.get(), true);
			g.text(font, time(e), textX, y + 12, 0xFFAEB3BF, true);
		}
	}

	private static String name(MobEffectInstance e) {
		String n = e.getEffect().value().getDisplayName().getString();
		int a = e.getAmplifier();
		return a > 0 && a < ROMAN.length ? n + " " + ROMAN[a] : n;
	}
}
