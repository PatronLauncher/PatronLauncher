package com.patron.pclient;

import com.patron.pclient.gui.ComingSoonScreen;
import com.patron.pclient.gui.HudEditorScreen;
import com.patron.pclient.gui.ModuleSettingsScreen;
import com.patron.pclient.gui.ModulesScreen;
import com.patron.pclient.gui.PClientHomeScreen;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.modules.SoonModule;
import java.io.File;
import java.util.List;
import java.util.function.Supplier;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;

/**
 * Yalnızca geliştirme: -Dpclient.devshots=<klasör> verilirse ana menüden sonra PClient ekranlarını
 * sırayla açıp ekran görüntüsü alır ve oyunu kapatır. Normal oyunda hiçbir şey yapmaz.
 */
public final class DevShots {
	private static final String DIR = System.getProperty("pclient.devshots");
	private static final String DEV_ACCOUNT = "11111111-1111-4111-8111-111111111111";
	private static int tick = -1;

	private record Shot(String name, Supplier<Screen> screen) {}

	private static final List<Shot> SHOTS = List.of(
		new Shot("00-title", com.patron.pclient.gui.PClientTitleScreen::new),
		new Shot("01-home", PClientHomeScreen::new),
		new Shot("09-pause", com.patron.pclient.gui.PClientPauseScreen::new),
		new Shot("02-modules", () -> new ModulesScreen(ModulesScreen.Tab.MODULES)),
		new Shot("03-settings", () -> new ModulesScreen(ModulesScreen.Tab.SETTINGS)),
		new Shot("04-module-keystrokes", () -> new ModuleSettingsScreen(ModuleManager.byId("keystrokes"), null)),
		new Shot("05-module-zoom", () -> new ModuleSettingsScreen(ModuleManager.byId("zoom"), null)),
		new Shot("06-hud-editor", () -> new HudEditorScreen(null)),
		new Shot("07-music", () -> new com.patron.pclient.gui.PClientMusicScreen(null)),
		new Shot("24-themes", () -> new com.patron.pclient.gui.PClientThemesScreen(null)),
		new Shot("25-mods", () -> new com.patron.pclient.gui.PClientModsScreen(null)),
		new Shot("26-modules-grid", () -> {
			com.patron.pclient.config.PClientConfig.get().modulesView = "grid";
			com.patron.pclient.config.PClientConfig.get().modulesSort = "az";
			return new ModulesScreen(ModulesScreen.Tab.MODULES);
		}),
		new Shot("27-modules-list", () -> {
			com.patron.pclient.config.PClientConfig.get().modulesView = "list";
			com.patron.pclient.config.PClientConfig.get().modulesSort = "default";
			return new ModulesScreen(ModulesScreen.Tab.MODULES);
		}),
		new Shot("28-hud-arrange", () -> {
			for (String id : List.of("fps", "cps", "ping", "clock", "coords", "keystrokes", "music", "minimap")) ModuleManager.byId(id).setEnabled(true);
			return new HudEditorScreen(null);
		}),
		new Shot("36-modrinth-filtered", () -> modrinthPage("filtered")),
		new Shot("37-modrinth-detail", () -> modrinthPage("BODY")),
		new Shot("38-modrinth-detail-loaded", () -> Minecraft.getInstance().gui.screen()),
		new Shot("39-modrinth-gallery", () -> modrinthPage("GALLERY")),
		new Shot("40-modrinth-versions", () -> modrinthPage("VERSIONS")),
		new Shot("41-title-panels", com.patron.pclient.gui.PClientTitleScreen::new),
		new Shot("42-title-panels-loaded", () -> Minecraft.getInstance().gui.screen()),
		new Shot("29-modrinth", () -> new com.patron.pclient.gui.PClientModrinthScreen(null)),
		new Shot("31-preset-PvP", () -> preset("PvP")),
		new Shot("32-preset-UHC", () -> preset("UHC")),
		new Shot("33-preset-SkyBlock", () -> preset("SkyBlock")),
		new Shot("34-preset-Survival", () -> preset("Survival")),
		new Shot("35-profiles", () -> {
			com.patron.pclient.config.PClientConfig.switchProfile(com.patron.pclient.config.PClientConfig.DEFAULT_PROFILE);
			return new ModulesScreen(ModulesScreen.Tab.MODULES);
		}),
		new Shot("08-schematics", () -> new ComingSoonScreen((SoonModule) ModuleManager.byId("schematics"), null)),
		new Shot("10-worlds", () -> new com.patron.pclient.gui.PClientWorldsScreen(new com.patron.pclient.gui.PClientTitleScreen())),
		new Shot("11-create-world", () -> new com.patron.pclient.gui.PClientCreateWorldScreen(null)),
		new Shot("12-servers", () -> new com.patron.pclient.gui.PClientServersScreen(new com.patron.pclient.gui.PClientTitleScreen())),
		new Shot("13-server-add",() -> com.patron.pclient.gui.PClientServerEditScreen.add(null, d -> {})),
		// Vanilla ekran istekleri PClient karşılıklarına yönlendirilmeli.
		new Shot("14-vanilla-select-world", () -> new net.minecraft.client.gui.screens.worldselection.SelectWorldScreen(null)),
		new Shot("15-vanilla-multiplayer", () -> new net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen(null)),
		new Shot("17-waypoints-noworld", () -> new ModulesScreen(ModulesScreen.Tab.WAYPOINTS)),
		new Shot("18-module-minimap", () -> new ModuleSettingsScreen(ModuleManager.byId("minimap"), null)),
		new Shot("19-module-crosshair", () -> new ModuleSettingsScreen(ModuleManager.byId("crosshair"), null)),
		new Shot("20-module-autotext", () -> new ModuleSettingsScreen(ModuleManager.byId("autotext"), null)));

	private DevShots() {}

	/** Filtreli liste ya da gerçek bir projenin istenen sekmesi. */
	private static Screen modrinthPage(String page) {
		try {
			var type = com.patron.pclient.gui.PClientModrinthScreen.class;
			if (page.equals("filtered")) {
				var filters = type.getDeclaredField("FILTERS");
				var tab = type.getDeclaredField("tab");
				filters.setAccessible(true);
				tab.setAccessible(true);
				Object shader = tab.getType().getEnumConstants()[1];
				tab.set(null, shader);
				@SuppressWarnings("unchecked")
				var map = (java.util.Map<Object, java.util.Set<String>>) filters.get(null);
				map.put(shader, new java.util.HashSet<>(java.util.Set.of("realistic", "shadows")));
				return new com.patron.pclient.gui.PClientModrinthScreen(null);
			}
			var hit = new com.patron.pclient.bridge.Modrinth.Hit("HVnmMxH1", "Complementary Shaders - Reimagined", "EminGT", "Preserving the elements of Minecraft with exceptional quality.",
				"", 72423937, 11573, List.of("vanilla-like"), com.patron.pclient.bridge.Modrinth.Kind.SHADER);
			var screen = new com.patron.pclient.gui.PClientModrinthScreen(null, hit);
			var field = type.getDeclaredField("page");
			field.setAccessible(true);
			for (Object constant : field.getType().getEnumConstants()) if (constant.toString().equals(page)) field.set(screen, constant);
			return screen;
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException(e);
		}
	}

	private static Screen preset(String name) {
		com.patron.pclient.config.PClientConfig.switchProfile(name);
		return new HudEditorScreen(null);
	}

	/** Profil kodu gidiş-dönüşü ve gerçek Modrinth kurulumu; sonuçlar günlüğe yazılır. */
	private static void featureChecks(String shot, int t, Minecraft mc) {
		if (t == 3 && shot.equals("29-modrinth") && com.patron.pclient.bridge.Modrinth.irisLoaded()) {
			var kind = com.patron.pclient.bridge.Modrinth.Kind.SHADER;
			com.patron.pclient.bridge.Modrinth.search(kind, "complementary reimagined", 0).thenCompose(page -> {
				var hit = page.hits().getFirst();
				return com.patron.pclient.bridge.Modrinth.install(hit).thenRun(() -> mc.execute(() -> {
					String file = com.patron.pclient.bridge.Modrinth.installedFile(hit.id());
					com.patron.pclient.bridge.Modrinth.toggleShader(file);
					PClient.LOG.info("devshot shader {} active -> {}, error {}", file, com.patron.pclient.bridge.Modrinth.shaderActive(file), com.patron.pclient.bridge.Modrinth.error());
				}));
			}).exceptionally(e -> {
				PClient.LOG.error("devshot shader", e);
				return null;
			});
		}
		if (t == 10 && shot.equals("31-preset-PvP")) {
			String code = com.patron.pclient.config.PClientConfig.exportCode("PvP");
			String imported = com.patron.pclient.config.PClientConfig.importCode(code);
			int enabled = (int) ModuleManager.all().stream().filter(m -> m.isAvailable() && m.isEnabled()).count();
			PClient.LOG.info("devshot profile code {} chars -> {} ({} on), bad -> {}", code.length(), imported, enabled, com.patron.pclient.config.PClientConfig.importCode("PCLIENT1-bozuk"));
			com.patron.pclient.config.PClientConfig.switchProfile("PvP");
			com.patron.pclient.config.PClientConfig.deleteProfile(imported);
		}
		if (t == 5 && shot.equals("29-modrinth")) {
			var modrinth = com.patron.pclient.bridge.Modrinth.Kind.RESOURCE;
			com.patron.pclient.bridge.Modrinth.search(modrinth, "dark mode gui", 0).thenCompose(page -> {
				var hit = page.hits().getFirst();
				PClient.LOG.info("devshot modrinth {} results, first {}", page.total(), hit.title());
				return com.patron.pclient.bridge.Modrinth.install(hit).thenRun(() -> mc.execute(() -> {
					String file = com.patron.pclient.bridge.Modrinth.installedFile(hit.id());
					com.patron.pclient.bridge.Modrinth.toggleResource(file);
					PClient.LOG.info("devshot modrinth installed {} active -> {}", file, com.patron.pclient.bridge.Modrinth.resourceActive(file));
					com.patron.pclient.bridge.Modrinth.toggleResource(file);
				}));
			}).exceptionally(e -> {
				PClient.LOG.error("devshot modrinth", e);
				return null;
			});
		}
		// Açık sekmenin düğmesi sekmeyi kapatmalı.
		if (t == 28 && shot.equals("24-themes")) {
			try {
				var close = com.patron.pclient.gui.PcScreen.class.getDeclaredMethod("closeFromDock");
				close.setAccessible(true);
				close.invoke(mc.gui.screen());
				PClient.LOG.info("devshot dock close -> {}", mc.gui.screen().getClass().getSimpleName());
			} catch (ReflectiveOperationException e) {
				PClient.LOG.error("devshot dock", e);
			}
		}
	}

	/** Dünya testi: PClient formuyla düz dünya oluşturur, ESC menüsünü dener ve oyunu kapatır. */
	private static void inWorld(Minecraft mc, int t) {
		if (t == 0) {
			var screen = new com.patron.pclient.gui.PClientCreateWorldScreen(null);
			mc.gui.setScreen(screen);
			try {
				var kind = screen.getClass().getDeclaredField("kind");
				kind.setAccessible(true);
				kind.setInt(screen, 1);
				var create = screen.getClass().getDeclaredMethod("create");
				create.setAccessible(true);
				create.invoke(screen);
			} catch (ReflectiveOperationException e) {
				PClient.LOG.error("devshot dünya oluşturulamadı", e);
				mc.stop();
			}
			return;
		}
		if (mc.level == null || mc.player == null) {
			if (t > 20 * 120) mc.stop();
			return;
		}
		if (worldAt < 0) worldAt = t;
		int w = t - worldAt;
		if (w == 20) {
			for (String id : List.of("minimap", "direction", "target", "items", "crosshair", "playtime", "waypoints", "combo",
				"light", "rotation", "worldtime", "players", "helditem", "session", "tnttimer", "durawarn", "lowhealth", "tabping", "chatplus",
				"scoreboard", "bossbar", "screeneffects", "toasts", "ownname", "blockoutline", "hitcolor", "handview", "fpsboost", "particles", "chunkborders"))
				ModuleManager.byId(id).setEnabled(true);
			var p = mc.player;
			var server = mc.getSingleplayerServer();
			double tntX = p.getX() + 3, tntY = p.getY() + 1, tntZ = p.getZ() - 4;
			if (server != null) server.execute(() -> {
				var world = server.overworld();
				var tnt = new net.minecraft.world.entity.item.PrimedTnt(world, tntX, tntY, tntZ, null);
				tnt.setFuse(400);
				world.addFreshEntity(tnt);
			});
			var chat = mc.gui.hud.getChat();
			for (int n = 0; n < 3; n++) chat.addClientSystemMessage(net.minecraft.network.chat.Component.literal("PClient tekrar deneme"));
			chat.addClientSystemMessage(net.minecraft.network.chat.Component.literal("Merhaba " + mc.getUser().getName()));
			var list = com.patron.pclient.modules.Waypoints.current();
			list.add(new com.patron.pclient.modules.Waypoints.Waypoint("Ev", p.getBlockX() + 12, p.getBlockY(), p.getBlockZ() - 20,
				com.patron.pclient.modules.Waypoints.dimension(), 0xFF38BDF8));
			list.add(new com.patron.pclient.modules.Waypoints.Waypoint("Maden", p.getBlockX() - 30, p.getBlockY(), p.getBlockZ() + 40,
				com.patron.pclient.modules.Waypoints.dimension(), 0xFFFFD43B));
			// Hedef bilgisi ve pusula için kamerayı biraz aşağı ve kuzeydoğuya çevir.
			p.setYRot(-150f);
			p.setXRot(25f);
		}
		if (w == 80) Screenshot.grab(new File(DIR), "21-hud-ingame.png", mc.gameRenderer.mainRenderTarget(), 1, msg -> PClient.LOG.info("devshot 21-hud-ingame.png"));
		if (w == 85) PClient.LOG.info("devshot fps {}", mc.getFps());
		if (w == 90) mc.gui.setScreen(new ModulesScreen(ModulesScreen.Tab.WAYPOINTS));
		if (w == 110) Screenshot.grab(new File(DIR), "22-waypoints.png", mc.gameRenderer.mainRenderTarget(), 1, msg -> PClient.LOG.info("devshot 22-waypoints.png"));
		if (w == 115) mc.gui.setScreen(new ModulesScreen(ModulesScreen.Tab.MODULES));
		if (w == 135) Screenshot.grab(new File(DIR), "23-modules-ingame.png", mc.gameRenderer.mainRenderTarget(), 1, msg -> PClient.LOG.info("devshot 23-modules-ingame.png"));
		if (w == 140) mc.gui.setScreen(null);
		if (w == 142) {
			ModuleManager.byId("music").setEnabled(true);
			PClient.onKey(new net.minecraft.client.input.KeyEvent(com.mojang.blaze3d.platform.InputConstants.KEY_J, 0, 0), com.mojang.blaze3d.platform.InputConstants.PRESS);
			PClient.LOG.info("devshot music key -> {}", mc.gui.screen() == null ? "null" : mc.gui.screen().getClass().getSimpleName());
		}
		if (w == 146) Screenshot.grab(new File(DIR), "30-music-overlay.png", mc.gameRenderer.mainRenderTarget(), 1, msg -> PClient.LOG.info("devshot 30-music-overlay.png"));
		if (w == 149 && mc.gui.screen() != null) {
			mc.gui.screen().keyPressed(new net.minecraft.client.input.KeyEvent(com.mojang.blaze3d.platform.InputConstants.KEY_J, 0, 0));
			PClient.LOG.info("devshot music key again -> {}", mc.gui.screen() == null ? "null" : mc.gui.screen().getClass().getSimpleName());
		}
		if (w == 152) {
			checkNetwork();
			var name = mc.getUser().getName();
			var chat = mc.gui.hud.getChat();
			chat.addClientSystemMessage(net.minecraft.network.chat.Component.literal("<" + name + "> selam"));
			chat.addClientSystemMessage(net.minecraft.network.chat.Component.literal("[VIP] " + name + " » merhaba"));
			chat.addClientSystemMessage(net.minecraft.network.chat.Component.literal(name + " oyuna katıldı"));
			var self = mc.getConnection().getPlayerInfo(mc.player.getUUID());
			PClient.LOG.info("devcheck tab adı başlangıcı {}", (int) mc.gui.hud.getTabList().getNameForDisplay(self).getString().charAt(0));
			mc.gui.hud.getTabList().setVisible(true);
		}
		if (w == 158) Screenshot.grab(new File(DIR), "44-badge.png", mc.gameRenderer.mainRenderTarget(), 1, msg -> PClient.LOG.info("devshot 44-badge.png"));
		if (w == 160) mc.gui.hud.getTabList().setVisible(false);
		if (w == 162) mc.pauseGame(false);
		if (w == 170) PClient.LOG.info("devshot ingame pause -> {}", mc.gui.screen() == null ? "null" : mc.gui.screen().getClass().getSimpleName());
		if (w == 175) Screenshot.grab(new File(DIR), "16-pause-ingame.png", mc.gameRenderer.mainRenderTarget(), 1, msg -> PClient.LOG.info("devshot 16-pause-ingame.png"));
		if (w == 190) mc.stop();
	}

	private static int worldAt = -1;

	/** Disconnect raporlarındaki çerçeveyi gerçek çözücüden geçirir; varlık servisini de dener. */
	private static void checkNetwork() {
		var access = net.minecraft.core.RegistryAccess.fromRegistryOfRegistries(net.minecraft.core.registries.BuiltInRegistries.REGISTRY);
		var info = net.minecraft.network.protocol.game.GameProtocols.CLIENTBOUND_TEMPLATE.bind(net.minecraft.network.RegistryFriendlyByteBuf.decorator(access));
		var channel = new io.netty.channel.embedded.EmbeddedChannel(new net.minecraft.network.PacketDecoder<>(info));
		var real = io.netty.buffer.Unpooled.buffer();
		@SuppressWarnings("unchecked")
		var codec = (net.minecraft.network.codec.StreamCodec<io.netty.buffer.ByteBuf, net.minecraft.network.protocol.Packet<?>>) (net.minecraft.network.codec.StreamCodec<?, ?>) info.codec();
		codec.encode(real, new net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket(7,
			new net.minecraft.world.entity.PositionMoveRotation(net.minecraft.world.phys.Vec3.ZERO, net.minecraft.world.phys.Vec3.ZERO, 0f, 0f), java.util.Set.of()));
		int size = real.readableBytes();
		int id = real.getByte(0);
		for (int length : new int[] {11, 12}) {
			var frame = io.netty.buffer.Unpooled.buffer();
			frame.writeByte(id);
			frame.writeZero(length - 1);
			channel.writeInbound(frame);
			PClient.LOG.info("devcheck bozuk {} bayt -> çıktı {}", length, channel.inboundMessages().size());
			channel.inboundMessages().clear();
		}
		channel.writeInbound(real);
		PClient.LOG.info("devcheck gerçek {} bayt, id {} -> {}", size, id, channel.inboundMessages().peek());
		channel.finishAndReleaseAll();
		PClient.LOG.info("devcheck rozet baş='{}' konum={}", com.patron.pclient.modules.PClientBadge.head("[12:30] [VIP] Dev_1 » selam: x"),
			com.patron.pclient.modules.PClientBadge.nameIndex("[VIP] Dev_1 »", "Dev_1"));
		String presence = System.getenv("PCLIENT_PRESENCE_TEST");
		if (presence != null) {
			var a = java.util.UUID.fromString("11111111-1111-4111-8111-111111111111");
			var b = java.util.UUID.fromString("22222222-2222-4222-8222-222222222222");
			com.patron.pclient.bridge.Presence.exchange(presence, a, List.of(a, b)).whenComplete((found, error) ->
				PClient.LOG.info("devcheck varlık {} hata {}", found, error));
		}
	}

	public static void tick() {
		if (DIR == null) return;
		Minecraft mc = Minecraft.getInstance();
		if (tick < 0) {
			if (!(mc.gui.screen() instanceof TitleScreen || mc.gui.screen() instanceof com.patron.pclient.gui.PClientTitleScreen)) return;
			tick = 0;
		}
		tick++;
		int phase = tick - 80;
		if (phase < 0) return;
		int i = phase / 30, t = phase % 30;
		if (i >= SHOTS.size()) {
			inWorld(mc, phase - SHOTS.size() * 30);
			return;
		}
		if (t == 0) {
			Screen next = SHOTS.get(i).screen.get();
			// Aynı ekranı döndüren adım, ağ yüklemesinin bitmesi için ekranı açık tutar.
			if (next != mc.gui.screen()) mc.gui.setScreen(next);
		}
		// Tıklama testi: ana ekrandaki MODÜLLER düğmesine gerçek bir sol tık olayı gönderilir.
		if (t == 27 && SHOTS.get(i).name.equals("01-home")) {
			var s = mc.gui.screen();
			double x = s.width / 2.0, y = s.height / 2.0 - 18 + 34 + 11;
			s.mouseClicked(new net.minecraft.client.input.MouseButtonEvent(x, y,
				new net.minecraft.client.input.MouseButtonInfo(com.mojang.blaze3d.platform.InputConstants.MOUSE_BUTTON_LEFT, 0)), false);
			PClient.LOG.info("devshot click -> {}", mc.gui.screen().getClass().getSimpleName());
		}
		// Arama kutusu: modüller açılınca metin girişi (SDL) başlamış olmalı.
		if (t == 20 && SHOTS.get(i).name.equals("02-modules")) {
			try {
				var f = com.mojang.blaze3d.platform.TextInputManager.class.getDeclaredField("textInputEnabled");
				f.setAccessible(true);
				PClient.LOG.info("devshot textInput -> {}", f.get(mc.textInputManager()));
			} catch (ReflectiveOperationException e) {
				PClient.LOG.warn("devshot textInput okunamadı", e);
			}
		}
		// ESC testi: ayarlardan ESC ile çıkınca PClient ana menüsü gelmeli.
		if (t == 28 && SHOTS.get(i).name.equals("03-settings")) {
			mc.gui.screen().keyPressed(new net.minecraft.client.input.KeyEvent(com.mojang.blaze3d.platform.InputConstants.KEY_ESCAPE, 0, 0));
			PClient.LOG.info("devshot esc -> {}", mc.gui.screen() == null ? "null" : mc.gui.screen().getClass().getSimpleName());
		}
		if (t == 26 && SHOTS.get(i).name.startsWith("1") && SHOTS.get(i).name.contains("vanilla"))
			PClient.LOG.info("devshot {} -> {}", SHOTS.get(i).name, mc.gui.screen().getClass().getSimpleName());
		featureChecks(SHOTS.get(i).name, t, mc);
		// HUD düzenleyici: otomatik hizalama ve geri alma gerçek düğme işleviyle denenir.
		if (t == 15 && SHOTS.get(i).name.equals("28-hud-arrange")) {
			try {
				var s = mc.gui.screen();
				var change = HudEditorScreen.class.getDeclaredMethod("change", Runnable.class);
				var arrange = HudEditorScreen.class.getDeclaredMethod("autoArrange");
				change.setAccessible(true);
				arrange.setAccessible(true);
				change.invoke(s, (Runnable) () -> {
					try {
						arrange.invoke(s);
					} catch (ReflectiveOperationException e) {
						throw new IllegalStateException(e);
					}
				});
			} catch (ReflectiveOperationException e) {
				PClient.LOG.error("devshot otomatik hizalama", e);
			}
		}
		if (t == 26 && SHOTS.get(i).name.equals("00-title")) com.patron.pclient.bridge.Accounts.select(DEV_ACCOUNT);
		if (t == 20 && SHOTS.get(i).name.equals("01-home")) {
			try {
				var open = com.patron.pclient.gui.PcScreen.class.getDeclaredField("accountOpen");
				open.setAccessible(true);
				open.setBoolean(null, true);
				com.patron.pclient.bridge.Accounts.refresh();
			} catch (ReflectiveOperationException e) {
				PClient.LOG.error("devshot hesap menüsü", e);
			}
		}
		if (t == 25) {
			PClient.LOG.info("devshot user -> {}", mc.getUser().getName());
			String name = SHOTS.get(i).name + ".png";
			Screenshot.grab(new File(DIR), name, mc.gameRenderer.mainRenderTarget(), 1, msg -> PClient.LOG.info("devshot {}", name));
		}
	}
}
