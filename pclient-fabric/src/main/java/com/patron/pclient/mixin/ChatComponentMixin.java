package com.patron.pclient.mixin;

import com.patron.pclient.modules.InterfaceModules;
import com.patron.pclient.modules.VisualModules;
import java.util.List;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.client.multiplayer.chat.GuiMessage;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Constant;
import org.spongepowered.asm.mixin.injection.ModifyConstant;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Sohbet süslemeleri: saat, tekrarları birleştirme, adın geçince vurgu ve uzun geçmiş. */
@Mixin(ChatComponent.class)
public abstract class ChatComponentMixin {
	@Shadow @Final private List<GuiMessage> allMessages;

	@Shadow private void refreshTrimmedMessages() {}

	@ModifyVariable(
		method = "addMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/multiplayer/chat/GuiMessageSource;Lnet/minecraft/client/multiplayer/chat/GuiMessageTag;)V",
		at = @At("HEAD"), argsOnly = true, ordinal = 0)
	private Component pclient$timestamp(Component message) {
		int repeat = InterfaceModules.ChatPlus.repeatOf(message);
		if (repeat > 1 && !allMessages.isEmpty()) {
			allMessages.remove(0);
			refreshTrimmedMessages();
		}
		// Rozet önce eklenir; saat damgasındaki ":" gönderen kısmını şaşırtmasın.
		Component badged = com.patron.pclient.modules.PClientBadge.chat(message);
		return VisualModules.ChatTweaks.decorate(InterfaceModules.ChatPlus.decorate(badged, repeat));
	}

	@ModifyConstant(method = {"addMessageToDisplayQueue", "addMessageToQueue"}, constant = @Constant(intValue = 100))
	private int pclient$history(int vanilla) { return InterfaceModules.ChatPlus.historyLimit(); }
}
