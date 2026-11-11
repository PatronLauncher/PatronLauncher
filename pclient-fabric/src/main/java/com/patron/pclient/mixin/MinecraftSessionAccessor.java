package com.patron.pclient.mixin;

import com.mojang.authlib.minecraft.UserApiService;
import com.mojang.authlib.services.ProfileResult;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.User;
import net.minecraft.client.multiplayer.ProfileKeyPairManager;
import net.minecraft.client.multiplayer.chat.report.ReportingContext;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Oyun içi hesap değiştirme: Minecraft'ın oturuma bağlı alanları. */
@Mixin(Minecraft.class)
public interface MinecraftSessionAccessor {
	@Mutable @Accessor("user") void pclient$setUser(User user);

	@Mutable @Accessor("userApiService") void pclient$setUserApiService(UserApiService service);

	@Mutable @Accessor("profileFuture") void pclient$setProfileFuture(CompletableFuture<ProfileResult> future);

	@Mutable @Accessor("userPropertiesFuture") void pclient$setUserPropertiesFuture(CompletableFuture<UserApiService.UserProperties> future);

	@Mutable @Accessor("profileKeyPairManager") void pclient$setProfileKeyPairManager(ProfileKeyPairManager manager);

	@Accessor("reportingContext") void pclient$setReportingContext(ReportingContext context);
}
