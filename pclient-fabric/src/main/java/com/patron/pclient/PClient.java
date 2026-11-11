package com.patron.pclient;

import com.patron.pclient.config.PClientConfig;
import com.patron.pclient.gui.PClientHomeScreen;
import com.patron.pclient.module.ModuleManager;
import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.input.KeyEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** PClient giriş noktası: modülleri kurar, ayarları yükler ve menü tuşunu dinler. */
public final class PClient implements ClientModInitializer {
	public static final String ID = "pclient";
	public static final Logger LOG = LoggerFactory.getLogger("PClient");
	public static String version = "dev";

	@Override
	public void onInitializeClient() {
		version = FabricLoader.getInstance().getModContainer(ID)
			.map(c -> c.getMetadata().getVersion().getFriendlyString()).orElse("dev");
		long started = System.nanoTime();
		ModuleManager.init();
		PClientConfig.load();
		PClientConfig.installPresets();
		LOG.info("PClient {} hazır ({} modül, {} ms)", version, ModuleManager.all().size(), (System.nanoTime() - started) / 1_000_000);
	}

	/** Klavye olayı; menü tuşu yakalanırsa true döner ve olay oyuna iletilmez. */
	/** Launcher'ın "oyun açılıyor" bildirimini kapatması için verilen işaret (oyun çıktısında aranır). */
	public static final String READY_MARKER = "PCLIENT_READY";
	private static boolean announced;

	/** Yükleme ekranı bitip ilk menü ya da dünya göründüğünde bir kez işaret yazar. */
	public static void announceReady() {
		if (announced) return;
		var mc = net.minecraft.client.Minecraft.getInstance();
		if (mc.gui.overlay() != null || mc.gui.screen() == null && mc.level == null) return;
		announced = true;
		LOG.info("{} PClient {} açıldı", READY_MARKER, version);
	}

	/** Launcher Discord etkinliği için oyun çıktısındaki bu işaretleri okur. */
	private static final String SERVER_JOIN_MARKER = "PCLIENT_SERVER_JOIN", SERVER_LEFT_MARKER = "PCLIENT_SERVER_LEFT";
	private static String currentServer;

	/** Bağlı olunan sunucu değiştiğinde launcher'a bildirir (tik başına yalnızca karşılaştırma). */
	public static void trackServer() {
		var mc = Minecraft.getInstance();
		var data = mc.level != null ? mc.getCurrentServer() : null;
		String ip = data == null ? null : data.ip;
		if (java.util.Objects.equals(ip, currentServer)) return;
		currentServer = ip;
		if (ip == null) LOG.info(SERVER_LEFT_MARKER);
		else LOG.info("{} {}", SERVER_JOIN_MARKER, ip);
	}

	public static boolean onKey(KeyEvent event, int action) {
		Minecraft mc = Minecraft.getInstance();
		if (action != InputConstants.PRESS || mc.gui.screen() != null || mc.player == null) return false;
		var music = ModuleManager.get(com.patron.pclient.modules.MusicModule.class);
		if (music.isEnabled() && event.key() == music.controlsKey.get()) {
			mc.gui.setScreen(new com.patron.pclient.gui.MusicOverlayScreen());
			return true;
		}
		if (event.key() != PClientConfig.get().menuKey) return false;
		mc.gui.setScreen(new PClientHomeScreen());
		return true;
	}
}
