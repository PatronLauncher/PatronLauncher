package com.patron.pclient.mixin;

import com.patron.pclient.modules.CameraModules;
import com.patron.pclient.modules.ZoomModule;
import net.minecraft.client.Camera;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Yakınlaştırma (görüş alanı) ve serbest bakış (kamera açısı karakterden bağımsız). */
@Mixin(Camera.class)
public abstract class CameraMixin {
	@Shadow protected abstract void setRotation(float yRot, float xRot);

	@Inject(method = "calculateFov", at = @At("RETURN"), cancellable = true)
	private void pclient$zoom(float partialTick, CallbackInfoReturnable<Float> cir) {
		cir.setReturnValue(ZoomModule.instance().modifyFov(cir.getReturnValueF()));
	}

	@Redirect(method = "alignWithEntity", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Camera;setRotation(FF)V"))
	private void pclient$freelook(Camera camera, float yRot, float xRot) {
		CameraModules.Freelook f = CameraModules.Freelook.instance();
		if (f.active()) setRotation(f.yaw(), f.pitch());
		else setRotation(yRot, xRot);
	}
}
