package com.patron.pclient.module;

import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Konumu sabit olmayan, tüm ekrana çizen modüller (nişangah, yol noktası işaretleri). */
public interface Overlay {
	void renderOverlay(GuiGraphicsExtractor g);
}
