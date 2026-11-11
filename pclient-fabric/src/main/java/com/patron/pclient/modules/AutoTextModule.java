package com.patron.pclient.modules;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.setting.KeySetting;
import com.patron.pclient.module.setting.TextSetting;
import net.minecraft.client.Minecraft;

/**
 * Kısayol tuşlarıyla hazır sohbet mesajı veya komut gönderir ("/" ile başlayanlar komuttur).
 * Spam'ı önlemek için aynı kısayol en çok saniyede bir çalışır.
 */
public final class AutoTextModule extends Module {
	private static final int SLOTS = 4;
	private static final String[] DEFAULTS = {"gg", "/lobby", "", ""};
	private final KeySetting[] keys = new KeySetting[SLOTS];
	private final TextSetting[] texts = new TextSetting[SLOTS];
	private final boolean[] wasDown = new boolean[SLOTS];
	private final long[] last = new long[SLOTS];

	public AutoTextModule() {
		super("autotext", Category.SERVER, "chat", false);
		for (int i = 0; i < SLOTS; i++) {
			section("section.hotkey" + (i + 1));
			keys[i] = add(new KeySetting("key" + i, "setting.key", InputConstants.UNKNOWN.getValue()));
			texts[i] = add(new TextSetting("text" + i, "setting.message", DEFAULTS[i], 120));
		}
	}

	@Override public void tick() {
		Minecraft mc = Minecraft.getInstance();
		var conn = mc.getConnection();
		for (int i = 0; i < SLOTS; i++) {
			boolean down = mc.gui.screen() == null && keys[i].isDown();
			if (down && !wasDown[i] && conn != null && System.currentTimeMillis() - last[i] > 1000) {
				String text = texts[i].get().trim();
				if (!text.isEmpty()) {
					last[i] = System.currentTimeMillis();
					if (text.startsWith("/")) conn.sendCommand(text.substring(1));
					else conn.sendChat(text);
				}
			}
			wasDown[i] = down;
		}
	}
}
