package com.patron.pclient.net;

import com.patron.pclient.PClient;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import java.util.Set;
import net.minecraft.network.ConnectionProtocol;
import net.minecraft.network.ProtocolInfo;
import net.minecraft.network.VarInt;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket;
import net.minecraft.world.entity.PositionMoveRotation;
import net.minecraft.world.phys.Vec3;

/**
 * Bazı proxy ve sürüm çeviricileri başka bir paketi player_position numarasıyla gönderir. Vanilla bu
 * çerçeveyi çözemeyip bağlantıyı keser. Alanları sabit boyutlu olduğundan gerçek paketten kısa bir
 * çerçeve kesinlikle player_position değildir; yalnızca bu çerçeve atlanır.
 */
public final class PacketGuard {
	private static volatile int positionId = -2;
	private static volatile int positionSize;
	private static boolean logged;

	private PacketGuard() {}

	public static boolean shouldDrop(ProtocolInfo<?> info, ByteBuf frame) {
		if (info.id() != ConnectionProtocol.PLAY || info.flow() != PacketFlow.CLIENTBOUND) return false;
		if (positionId == -2) measure(info);
		if (positionId < 0 || frame.readableBytes() >= positionSize) return false;
		int start = frame.readerIndex();
		try {
			if (VarInt.read(frame) != positionId) return false;
		} catch (RuntimeException e) {
			return false;
		} finally {
			frame.readerIndex(start);
		}
		if (!logged) {
			logged = true;
			PClient.LOG.warn("Sunucudan bozuk player_position çerçevesi geldi ({} bayt); atlandı", frame.readableBytes());
		}
		return true;
	}

	/** Numara ve boyut, sürüm değişince de doğru kalsın diye oyunun kendi kodlayıcısından ölçülür. */
	@SuppressWarnings("unchecked")
	private static synchronized void measure(ProtocolInfo<?> info) {
		if (positionId != -2) return;
		ByteBuf buf = Unpooled.buffer();
		try {
			var codec = (StreamCodec<ByteBuf, Packet<?>>) (StreamCodec<?, ?>) info.codec();
			codec.encode(buf, new ClientboundPlayerPositionPacket(0, new PositionMoveRotation(Vec3.ZERO, Vec3.ZERO, 0f, 0f), Set.of()));
			positionSize = buf.readableBytes();
			positionId = VarInt.read(buf);
		} catch (RuntimeException e) {
			positionId = -1;
			PClient.LOG.warn("player_position ölçülemedi; paket koruması kapalı", e);
		} finally {
			buf.release();
		}
	}
}
