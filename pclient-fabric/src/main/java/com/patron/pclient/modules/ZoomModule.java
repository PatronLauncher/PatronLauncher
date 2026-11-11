package com.patron.pclient.modules;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.KeySetting;
import com.patron.pclient.module.setting.SliderSetting;
import net.minecraft.client.Minecraft;

/** Basılı tutulan tuşla yakınlaştırma; tekerlekle oran ayarlanır. Görüş alanı Camera karışımında değişir. */
public final class ZoomModule extends Module {
	public final KeySetting key = add(new KeySetting("key", "setting.key", InputConstants.KEY_C));
	public final SliderSetting factor = add(new SliderSetting("factor", "setting.zoomFactor", 4, 2, 10, 0.5, "%.1fx"));
	public final BoolSetting smooth = add(new BoolSetting("smooth", "setting.cinematic", true));
	public final BoolSetting scroll = add(new BoolSetting("scroll", "setting.scrollAdjust", true));
	public final BoolSetting animate = add(new BoolSetting("animate", "setting.animate", true));

	private float progress;
	private double scrollMul = 1;
	private long lastFrame;
	private boolean wasZooming;
	private Boolean savedSmooth;

	public ZoomModule() { super("zoom", Category.MECHANIC, "zoom", true); }

	public static ZoomModule instance() { return ModuleManager.get(ZoomModule.class); }

	/** Tuş basılı ve oyun ekranında mıyız? */
	public boolean zooming() {
		Minecraft mc = Minecraft.getInstance();
		return isEnabled() && mc.player != null && mc.gui.screen() == null && key.isDown();
	}

	/** Camera.calculateFov dönüş değerine uygulanır. */
	public float modifyFov(float fov) {
		long now = System.nanoTime();
		float dt = lastFrame == 0 ? 0 : Math.min(0.1f, (now - lastFrame) / 1e9f);
		lastFrame = now;
		boolean z = zooming();
		float target = z ? 1 : 0;
		progress = animate.on() ? progress + (target - progress) * Math.min(1, dt * 14) : target;
		if (!z && progress < 0.001f) {
			progress = 0;
			scrollMul = 1;
		}
		if (progress <= 0) return fov;
		double f = 1 + (factor.get() * scrollMul - 1) * progress;
		return (float) (fov / f);
	}

	/** Yakınlaştırırken tekerlek olayını yakalar (true: olay tüketildi). */
	public boolean onScroll(double amount) {
		if (!zooming() || !scroll.on() || amount == 0) return false;
		scrollMul = Math.max(0.5, Math.min(6, scrollMul * (amount > 0 ? 1.15 : 1 / 1.15)));
		return true;
	}

	@Override public void tick() {
		Minecraft mc = Minecraft.getInstance();
		boolean z = zooming();
		if (z && !wasZooming && smooth.on()) {
			savedSmooth = mc.options.smoothCamera;
			mc.options.smoothCamera = true;
		} else if (!z && wasZooming && savedSmooth != null) {
			mc.options.smoothCamera = savedSmooth;
			savedSmooth = null;
		}
		wasZooming = z;
	}

	@Override protected void onDisable() {
		if (savedSmooth != null) Minecraft.getInstance().options.smoothCamera = savedSmooth;
		savedSmooth = null;
		wasZooming = false;
		progress = 0;
	}
}
