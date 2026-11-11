package com.patron.pclient.mixin;

import com.patron.pclient.gui.VanillaMenus;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Ana menü ve ESC menüsü açılırken PClient ekranlarını devreye sokar. */
@Mixin(Gui.class)
public abstract class GuiMixin {
	@ModifyVariable(method = "setScreen", at = @At("HEAD"), argsOnly = true)
	private Screen pclient$replaceMenus(Screen screen) {
		return VanillaMenus.replace(screen);
	}
}
