package com.patron.pclient.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import com.patron.pclient.modules.VisualModules;
import net.minecraft.client.renderer.ScreenEffectRenderer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Alçak ateş: ekrandaki ateş katmanı aşağı kaydırılır; dönüşüm yalnızca bu çizim için geçerlidir. */
@Mixin(ScreenEffectRenderer.class)
public abstract class ScreenEffectRendererMixin {
	@Inject(method = "submitFire", at = @At("HEAD"))
	private static void pclient$lowerFire(PoseStack pose, SubmitNodeCollector collector, TextureAtlasSprite sprite, CallbackInfo ci) {
		pose.pushPose();
		pose.translate(0f, -VisualModules.LowFire.shift(), 0f);
	}

	@Inject(method = "submitFire", at = @At("TAIL"))
	private static void pclient$restoreFire(PoseStack pose, SubmitNodeCollector collector, TextureAtlasSprite sprite, CallbackInfo ci) {
		pose.popPose();
	}
}
