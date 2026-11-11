package com.patron.pclient.gui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.multiplayer.SafetyScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;

/**
 * Minecraft'ın menülerini PClient karşılıklarıyla değiştirir: ana menü, ESC menüsü, dünya seçimi ve
 * sunucu listesi. Oyuncu yalnızca Minecraft ayarlarına (PClient içinden) erişir.
 */
public final class VanillaMenus {
	private VanillaMenus() {}

	/** Gui.setScreen başında çağrılır; gerekirse yerine PClient ekranı döner. */
	public static Screen replace(Screen screen) {
		Minecraft mc = Minecraft.getInstance();
		// Dünya yokken ekran kapatılırsa Minecraft kendi ana menüsünü açar; onun yerine PClient'ınki gelir.
		if (screen == null) return mc.level == null ? new PClientTitleScreen() : null;
		// Yalnızca tam vanilla sınıfları değiştirilir; başka modların alt sınıflarına dokunulmaz.
		Class<?> c = screen.getClass();
		if (c == TitleScreen.class) return new PClientTitleScreen();
		if (c == PauseScreen.class && ((PauseScreen) screen).showsPauseMenu()) return new PClientPauseScreen();
		Screen home = mc.level == null ? new PClientTitleScreen() : null;
		if (c == SelectWorldScreen.class) return new PClientWorldsScreen(home);
		if (c == JoinMultiplayerScreen.class || c == SafetyScreen.class) return new PClientServersScreen(home);
		return screen;
	}
}
