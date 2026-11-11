package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.PClient;
import com.patron.pclient.config.PClientConfig;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.sounds.SoundEvents;

/** Menü tuşuyla açılan giriş ekranı: logo, büyük "MODÜLLER" düğmesi ve kısayollar. */
public final class PClientHomeScreen extends PcScreen {
	public PClientHomeScreen() { super("title.home", null); }

	@Override protected String dock() { return "home"; }

	@Override protected void init() {
		if (PClientConfig.get().openSound)
			minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.AMETHYST_BLOCK_CHIME, 1.6F, 0.6F));
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		int cx = width / 2, cy = height / 2 - 18;
		// Logo ve hafif nefes alan parıltı.
		float pulse = (float) (Math.sin(System.nanoTime() / 1e9 * 2.2) * 0.5 + 0.5);
		Theme.notched(g, cx - 34, cy - 82, cx + 34, cy - 14, 10, Theme.withAlpha(Theme.accent(), (int) (14 + pulse * 22)));
		Theme.notchedOutline(g, cx - 34, cy - 82, cx + 34, cy - 14, 10, Theme.withAlpha(Theme.accent(), (int) (60 + pulse * 70)));
		Theme.logo(g, cx - 23, cy - 78, 48);
		String p = "P", client = "CLIENT";
		int tw = font.width(p) + Theme.spacedWidth(client, 2) + 2;
		g.pose().pushMatrix();
		g.pose().translate(cx - tw, cy - 4);
		g.pose().scale(2, 2);
		g.text(font, p, 0, 0, Theme.accent(), true);
		Theme.spaced(g, client, font.width(p) + 1, 0, Theme.TEXT, 2);
		g.pose().popMatrix();
		Theme.spacedCentered(g, L.up("home.tagline"), cx, cy + 18, Theme.FAINT, 1);

		// Ana düğme satırı (Lunar düzenine benzer: simge, büyük düğme, simge).
		int by = cy + 34, bw = 120, bh = 22;
		if (iconButton(g, cx - bw / 2 - 28, by, bh, "hud", () -> open(new HudEditorScreen(this)))) tipNow(L.t("dock.hud"));
		button(g, cx - bw / 2, by, cx + bw / 2, by + bh, L.up("home.modules"), Style.PRIMARY,
			() -> open(new ModulesScreen(ModulesScreen.Tab.MODULES)));
		if (iconButton(g, cx + bw / 2 + 6, by, bh, "gear", () -> open(new ModulesScreen(ModulesScreen.Tab.SETTINGS))))
			tipNow(L.t("dock.settings"));

		// Durum satırı: kaç modül etkin.
		int on = 0, total = 0;
		for (Module m : ModuleManager.all()) {
			if (!m.isAvailable()) continue;
			total++;
			if (m.isEnabled()) on++;
		}
		g.centeredText(font, L.t("home.status", on, total), cx, by + bh + 10, Theme.MUTED);

		// Alt köşeler.
		g.text(font, "PClient " + PClient.version, 8, height - 14, Theme.FAINT, false);
		String hint = L.t("home.hint", com.mojang.blaze3d.platform.InputConstants.Type.KEYBOARD
			.getOrCreate(PClientConfig.get().menuKey).getDisplayName().getString());
		g.text(font, hint, width - font.width(hint) - 8, height - 14, Theme.FAINT, false);
		accountWidget(g);
	}
}
