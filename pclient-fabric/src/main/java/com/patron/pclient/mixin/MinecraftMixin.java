package com.patron.pclient.mixin;

import com.patron.pclient.module.ModuleManager;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Modül tikleri istemci tikinin sonunda çalışır. */
@Mixin(Minecraft.class)
public abstract class MinecraftMixin {
	@Inject(method = "tick", at = @At("TAIL"))
	private void pclient$tick(CallbackInfo ci) {
		ModuleManager.tick();
		com.patron.pclient.PClient.announceReady();
		com.patron.pclient.PClient.trackServer();
		com.patron.pclient.DevShots.tick();
	}
}
