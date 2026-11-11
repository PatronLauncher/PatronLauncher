package com.patron.pclient.mixin;

import com.mojang.blaze3d.platform.FramerateLimitTracker;
import com.patron.pclient.config.PClientConfig;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Performans: oyun penceresi arka plandayken kare hızı sınırlanır (pil ve ısı için). */
@Mixin(FramerateLimitTracker.class)
public abstract class FramerateLimitTrackerMixin {
	@Inject(method = "getFramerateLimit", at = @At("RETURN"), cancellable = true)
	private void pclient$backgroundLimit(CallbackInfoReturnable<Integer> cir) {
		PClientConfig c = PClientConfig.get();
		if (c.backgroundFpsLimit && !Minecraft.getInstance().isWindowActive())
			cir.setReturnValue(Math.min(cir.getReturnValueI(), c.backgroundFps));
	}
}
