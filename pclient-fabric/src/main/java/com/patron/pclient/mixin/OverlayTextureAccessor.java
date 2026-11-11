package com.patron.pclient.mixin;

import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.renderer.texture.OverlayTexture;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Vuruş rengi modülü hasar dokusunu buradan günceller. */
@Mixin(OverlayTexture.class)
public interface OverlayTextureAccessor {
	@Accessor("texture")
	DynamicTexture pclient$texture();
}
