package com.patron.pclient.mixin;

import com.patron.pclient.module.ModuleManager;
import com.patron.pclient.modules.InterfaceModules;
import com.patron.pclient.modules.VisualModules;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.Hud;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.scores.Objective;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** PClient HUD öğeleri sohbetin altına, oyun HUD'unun üstüne çizilir. F1 ile gizlenir. */
@Mixin(Hud.class)
public abstract class HudMixin {
	@Inject(
		method = "extractRenderState",
		at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/Hud;extractChat(Lnet/minecraft/client/gui/GuiGraphicsExtractor;Lnet/minecraft/client/DeltaTracker;)V")
	)
	private void pclient$hud(GuiGraphicsExtractor graphics, DeltaTracker delta, CallbackInfo ci) {
		ModuleManager.renderHud(graphics);
	}

	/** Özel nişangah açıkken Minecraft'ın nişangahı çizilmez. */
	@Inject(method = "extractCrosshair", at = @At("HEAD"), cancellable = true)
	private void pclient$crosshair(GuiGraphicsExtractor graphics, DeltaTracker delta, CallbackInfo ci) {
		if (VisualModules.Crosshair.replacesVanilla()) ci.cancel();
	}

	@Unique private boolean pclient$scoreboardScaled, pclient$bossScaled;

	@Inject(method = "displayScoreboardSidebar", at = @At("HEAD"), cancellable = true)
	private void pclient$scoreboardStart(GuiGraphicsExtractor graphics, Objective objective, CallbackInfo ci) {
		if (InterfaceModules.Scoreboard.hidden()) ci.cancel();
		else pclient$scoreboardScaled = InterfaceModules.Scoreboard.begin(graphics);
	}

	@Inject(method = "displayScoreboardSidebar", at = @At("RETURN"))
	private void pclient$scoreboardEnd(GuiGraphicsExtractor graphics, Objective objective, CallbackInfo ci) {
		if (pclient$scoreboardScaled) graphics.pose().popMatrix();
		pclient$scoreboardScaled = false;
	}

	@Inject(method = "extractBossOverlay", at = @At("HEAD"), cancellable = true)
	private void pclient$bossStart(GuiGraphicsExtractor graphics, DeltaTracker delta, CallbackInfo ci) {
		if (InterfaceModules.BossBar.hidden()) ci.cancel();
		else pclient$bossScaled = InterfaceModules.BossBar.begin(graphics);
	}

	@Inject(method = "extractBossOverlay", at = @At("RETURN"))
	private void pclient$bossEnd(GuiGraphicsExtractor graphics, DeltaTracker delta, CallbackInfo ci) {
		if (pclient$bossScaled) graphics.pose().popMatrix();
		pclient$bossScaled = false;
	}

	@Inject(method = "extractVignette", at = @At("HEAD"), cancellable = true)
	private void pclient$vignette(GuiGraphicsExtractor graphics, Entity camera, CallbackInfo ci) {
		if (InterfaceModules.ScreenEffects.hideVignette()) ci.cancel();
	}

	@Inject(method = "extractPortalOverlay", at = @At("HEAD"), cancellable = true)
	private void pclient$portal(GuiGraphicsExtractor graphics, float alpha, CallbackInfo ci) {
		if (InterfaceModules.ScreenEffects.hidePortal()) ci.cancel();
	}

	@Inject(method = "extractConfusionOverlay", at = @At("HEAD"), cancellable = true)
	private void pclient$nausea(GuiGraphicsExtractor graphics, float strength, CallbackInfo ci) {
		if (InterfaceModules.ScreenEffects.hideNausea()) ci.cancel();
	}
}
