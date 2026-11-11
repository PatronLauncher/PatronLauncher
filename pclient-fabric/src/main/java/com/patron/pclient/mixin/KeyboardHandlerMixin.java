package com.patron.pclient.mixin;

import com.patron.pclient.PClient;
import net.minecraft.client.KeyboardHandler;
import net.minecraft.client.input.KeyEvent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** PClient menü tuşunu oyun içinde yakalar. */
@Mixin(KeyboardHandler.class)
public abstract class KeyboardHandlerMixin {
	@Inject(method = "keyPress", at = @At("HEAD"), cancellable = true)
	private void pclient$keyPress(long window, int action, KeyEvent event, CallbackInfo ci) {
		if (PClient.onKey(event, action)) ci.cancel();
	}
}
