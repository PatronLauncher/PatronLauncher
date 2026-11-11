package com.patron.pclient.mixin;

import com.patron.pclient.net.PacketGuard;
import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import java.util.List;
import net.minecraft.network.PacketDecoder;
import net.minecraft.network.PacketListener;
import net.minecraft.network.ProtocolInfo;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Bağlantıyı koparan bozuk player_position çerçevesini okumadan atlar. */
@Mixin(PacketDecoder.class)
public abstract class PacketDecoderMixin<T extends PacketListener> {
	@Shadow @Final private ProtocolInfo<T> protocolInfo;

	@Inject(method = "decode", at = @At("HEAD"), cancellable = true)
	private void pclient$dropMalformed(ChannelHandlerContext ctx, ByteBuf frame, List<Object> out, CallbackInfo ci) {
		if (PacketGuard.shouldDrop(protocolInfo, frame)) {
			frame.skipBytes(frame.readableBytes());
			ci.cancel();
		}
	}
}
