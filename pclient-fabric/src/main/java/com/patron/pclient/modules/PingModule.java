package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.PlayerInfo;

/** Sunucu gecikmesi. Tek oyunculu dünyada gizlenir. */
public final class PingModule extends HudModule {
	public final BoolSetting colored = add(new BoolSetting("colored", "setting.coloredPing", true));

	public PingModule() { super("ping", Category.HUD, "signal", true, 0.004, 0.38); }

	private static int latency() {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null || mc.getConnection() == null || mc.hasSingleplayerServer()) return -1;
		PlayerInfo info = mc.getConnection().getPlayerInfo(mc.player.getUUID());
		return info == null ? -1 : info.getLatency();
	}

	@Override public boolean visible(boolean preview) { return preview || latency() >= 0; }

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		int ms = preview ? 42 : latency();
		int old = color.get();
		if (colored.on()) color.set(ms < 80 ? 0xFF4ADE80 : ms < 160 ? 0xFFFFD43B : 0xFFFF2A3D);
		textBox(g, L.t("hud.ping", ms));
		color.set(old);
	}
}
