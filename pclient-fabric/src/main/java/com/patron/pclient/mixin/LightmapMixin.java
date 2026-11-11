package com.patron.pclient.mixin;

import com.patron.pclient.modules.FullbrightModule;
import net.minecraft.client.renderer.LightmapRenderStateExtractor;
import net.minecraft.client.renderer.state.LightmapRenderState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Tam aydınlatma: ışık haritasına gece görüşü yoğunluğu ekler (yalnızca görüntü). */
@Mixin(LightmapRenderStateExtractor.class)
public abstract class LightmapMixin {
	@Inject(method = "extract", at = @At("TAIL"))
	private void pclient$fullbright(LightmapRenderState state, float partialTick, CallbackInfo ci) {
		float f = FullbrightModule.intensity();
		if (f > 0) {
			state.nightVisionEffectIntensity = Math.max(state.nightVisionEffectIntensity, f);
			state.nightVisionColor = LightmapRenderStateExtractor.WHITE;
		}
	}
}
