package com.patron.pclient.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import com.patron.pclient.modules.VisualModules;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Hasar sallantısını kapatma. */
@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
	@Inject(method = "bobHurt", at = @At("HEAD"), cancellable = true)
	private void pclient$noHurtCam(CameraRenderState camera, PoseStack pose, CallbackInfo ci) {
		if (VisualModules.NoHurtCam.active()) ci.cancel();
	}
}
