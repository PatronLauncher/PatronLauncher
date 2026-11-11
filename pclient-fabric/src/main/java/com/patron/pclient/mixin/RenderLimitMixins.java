package com.patron.pclient.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import com.patron.pclient.modules.InterfaceModules;
import com.patron.pclient.modules.PerformanceModules;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.gui.components.toasts.Toast;
import net.minecraft.client.gui.components.toasts.ToastManager;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleEngine;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.FirstPersonHandsAndItemsRenderer;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderDispatcher;
import net.minecraft.client.renderer.culling.Frustum;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.state.level.BlockOutlineRenderState;
import net.minecraft.client.renderer.state.level.FirstPersonHandsAndItemsRenderState;
import net.minecraft.client.renderer.state.level.PlayerRenderState;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.BlockEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Küçük bağlantı noktaları tek yerde; her biri modül kapalıyken hemen çıkar. */
public final class RenderLimitMixins {
	private RenderLimitMixins() {}

	@Mixin(EntityRenderer.class)
	public abstract static class Entities {
		@Inject(method = "shouldRender", at = @At("HEAD"), cancellable = true)
		private void pclient$limit(Entity entity, Frustum frustum, double camX, double camY, double camZ, float partialTick, CallbackInfoReturnable<Boolean> cir) {
			if (PerformanceModules.FpsBoost.skipEntity(entity, camX, camY, camZ)) cir.setReturnValue(false);
		}
	}

	@Mixin(BlockEntityRenderDispatcher.class)
	public abstract static class BlockEntities {
		@Inject(method = "tryExtractRenderState", at = @At("HEAD"), cancellable = true)
		private void pclient$limit(BlockEntity blockEntity, float partialTick, ModelFeatureRenderer.CrumblingOverlay overlay, boolean flag, CallbackInfoReturnable<Object> cir) {
			if (PerformanceModules.FpsBoost.skipBlockEntity(blockEntity)) cir.setReturnValue(null);
		}
	}

	@Mixin(ParticleEngine.class)
	public abstract static class Particles {
		@Inject(method = "add", at = @At("HEAD"), cancellable = true)
		private void pclient$limit(Particle particle, CallbackInfo ci) {
			if (PerformanceModules.Particles.drop()) ci.cancel();
		}
	}

	@Mixin(ToastManager.class)
	public abstract static class Toasts {
		@Inject(method = "addToast", at = @At("HEAD"), cancellable = true)
		private void pclient$hide(Toast toast, CallbackInfo ci) {
			if (InterfaceModules.HideToasts.blocks(toast)) ci.cancel();
		}
	}

	@Mixin(PlayerTabOverlay.class)
	public abstract static class TabList {
		@Inject(method = "extractPingIcon", at = @At("HEAD"), cancellable = true)
		private void pclient$ping(GuiGraphicsExtractor g, int width, int x, int y, PlayerInfo info, CallbackInfo ci) {
			if (InterfaceModules.TabPing.draw(g, width, x, y, info)) ci.cancel();
		}

		@Inject(method = "getNameForDisplay", at = @At("RETURN"), cancellable = true)
		private void pclient$badge(PlayerInfo info, CallbackInfoReturnable<net.minecraft.network.chat.Component> cir) {
			cir.setReturnValue(com.patron.pclient.modules.PClientBadge.tab(info, cir.getReturnValue()));
		}
	}

	@Mixin(LivingEntityRenderer.class)
	public abstract static class Names {
		@Inject(method = "shouldShowName(Lnet/minecraft/world/entity/LivingEntity;D)Z", at = @At("HEAD"), cancellable = true)
		private void pclient$ownName(LivingEntity entity, double distanceSq, CallbackInfoReturnable<Boolean> cir) {
			if (InterfaceModules.OwnName.shows(entity)) cir.setReturnValue(true);
		}
	}

	@Mixin(LevelRenderer.class)
	public abstract static class Outline {
		@ModifyVariable(method = "submitHitOutline", at = @At("HEAD"), argsOnly = true, ordinal = 0)
		private int pclient$color(int color) { return InterfaceModules.BlockOutline.color(color); }

		@ModifyVariable(method = "submitHitOutline", at = @At("HEAD"), argsOnly = true, ordinal = 0)
		private float pclient$width(float width) { return InterfaceModules.BlockOutline.width(width); }
	}

	@Mixin(FirstPersonHandsAndItemsRenderer.class)
	public abstract static class Hands {
		@Unique private boolean pclient$pushed;

		@Inject(method = "submitHandsWithItems", at = @At("HEAD"))
		private void pclient$begin(float partialTick, PoseStack pose, SubmitNodeCollector collector, PlayerRenderState player, FirstPersonHandsAndItemsRenderState state, CallbackInfo ci) {
			pclient$pushed = InterfaceModules.HandView.begin(pose);
		}

		@Inject(method = "submitHandsWithItems", at = @At("RETURN"))
		private void pclient$end(float partialTick, PoseStack pose, SubmitNodeCollector collector, PlayerRenderState player, FirstPersonHandsAndItemsRenderState state, CallbackInfo ci) {
			if (pclient$pushed) pose.popPose();
			pclient$pushed = false;
		}
	}

	@Mixin(LocalPlayer.class)
	public abstract static class Totem {
		@Inject(method = "displayItemActivation", at = @At("HEAD"), cancellable = true)
		private void pclient$hide(ItemStack item, CallbackInfo ci) {
			if (InterfaceModules.ScreenEffects.hideTotem()) ci.cancel();
		}
	}
}
