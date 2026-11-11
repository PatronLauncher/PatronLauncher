package com.patron.pclient.modules;

import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.ChoiceSetting;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Gerçek saat. */
public final class ClockModule extends HudModule {
	private static final DateTimeFormatter H24 = DateTimeFormatter.ofPattern("HH:mm"),
		H12 = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH);
	public final ChoiceSetting format = add(new ChoiceSetting("format", "setting.clockFormat", "24", List.of("24", "12")));

	public ClockModule() { super("clock", Category.HUD, "clock", false, 0.996, 0.004); }

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		textBox(g, LocalTime.now().format(format.is("12") ? H12 : H24));
	}
}
