package com.patron.pclient.mixin;

import com.patron.pclient.modules.ExtraHudModules;
import com.patron.pclient.modules.InfoModules;
import net.minecraft.core.BlockPos;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Vuruşları kombo ve mesafe göstergelerine bildirir (yalnızca okur, saldırıyı değiştirmez). */
@Mixin(MultiPlayerGameMode.class)
public abstract class MultiPlayerGameModeMixin {
	@Inject(method = "attack", at = @At("HEAD"))
	private void pclient$attack(Player player, Entity target, CallbackInfo ci) {
		InfoModules.Reach.onAttack(target);
		InfoModules.Combo.onAttack(target);
		ExtraHudModules.Session.onAttack();
	}

	@Inject(method = "destroyBlock", at = @At("RETURN"))
	private void pclient$blockBroken(BlockPos pos, CallbackInfoReturnable<Boolean> cir) {
		if (cir.getReturnValueZ()) ExtraHudModules.Session.onBlockBroken();
	}
}
