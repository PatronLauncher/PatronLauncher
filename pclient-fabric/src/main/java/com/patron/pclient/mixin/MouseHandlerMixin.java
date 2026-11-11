package com.patron.pclient.mixin;

import com.mojang.blaze3d.platform.InputConstants;
import com.patron.pclient.modules.CameraModules;
import com.patron.pclient.modules.CpsModule;
import com.patron.pclient.modules.ZoomModule;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.player.LocalPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Tıklama sayacı (CPS), yakınlaştırırken tekerlekle oran ayarı ve serbest bakışta fare hareketi. */
@Mixin(MouseHandler.class)
public abstract class MouseHandlerMixin {
	@Inject(method = "onButton", at = @At("HEAD"))
	private void pclient$onButton(long window, MouseButtonInfo info, int action, CallbackInfo ci) {
		if (action == InputConstants.PRESS) CpsModule.click(info.button());
	}

	@Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
	private void pclient$onScroll(long window, double xOffset, double yOffset, CallbackInfo ci) {
		if (ZoomModule.instance().onScroll(yOffset)) ci.cancel();
	}

	@Redirect(method = "turnPlayer", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/player/LocalPlayer;turn(DD)V"))
	private void pclient$freelook(LocalPlayer player, double dx, double dy) {
		CameraModules.Freelook f = CameraModules.Freelook.instance();
		if (f.active()) f.turn(dx, dy);
		else player.turn(dx, dy);
	}
}
