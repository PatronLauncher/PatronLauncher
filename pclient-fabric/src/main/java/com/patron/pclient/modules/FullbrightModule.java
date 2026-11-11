package com.patron.pclient.modules;

import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.setting.SliderSetting;

/** Karanlık yerleri aydınlatır; ışık haritasına gece görüşü uygular (yalnızca görüntü, istemci tarafı). */
public final class FullbrightModule extends Module {
	public final SliderSetting strength = add(new SliderSetting("strength", "setting.strength", 100, 10, 100, 5, "%%%.0f"));

	public FullbrightModule() { super("fullbright", Category.VISUAL, "sun", false); }

	public static float intensity() {
		FullbrightModule m = ModuleManager.get(FullbrightModule.class);
		return m.isEnabled() ? m.strength.get().floatValue() / 100f : 0;
	}
}
