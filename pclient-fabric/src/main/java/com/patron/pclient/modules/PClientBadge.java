package com.patron.pclient.modules;

import com.patron.pclient.bridge.Presence;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;
import com.patron.pclient.module.ModuleManager;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

/**
 * PClient oyuncularının TAB'da, sohbette ve kafalarının üstündeki isim etiketinde adının önünde piksel
 * logo gösterir. Başka oyuncuların PClient kullandığı varlık servisinden (Presence) öğrenilir;
 * logo yalnızca PClient'ta görünür.
 */
public final class PClientBadge extends Module {
	private static final Style GLYPH = Style.EMPTY
		.withFont(new FontDescription.Resource(Identifier.fromNamespaceAndPath("pclient", "badge")))
		.withColor(ChatFormatting.WHITE);
	private static final int SYNC_TICKS = 20 * 30, MAX_HEAD = 64;

	private int ticks;

	public PClientBadge() { super("pclientbadge", Category.SERVER, "user", true); }

	private static boolean active() { return ModuleManager.get(PClientBadge.class).isEnabled(); }

	@Override public void tick() {
		Minecraft mc = Minecraft.getInstance();
		ClientPacketListener net = mc.getConnection();
		if (net == null || mc.player == null || mc.isLocalServer()) {
			ticks = 0;
			return;
		}
		if (ticks++ % SYNC_TICKS != 0) return;
		List<UUID> players = new ArrayList<>();
		for (PlayerInfo info : net.getOnlinePlayers()) players.add(info.getProfile().id());
		Presence.sync(mc.player.getUUID(), players);
	}

	@Override protected void onDisable() { Presence.clear(); }

	private static boolean isUser(UUID id) {
		var player = Minecraft.getInstance().player;
		return player != null && id.equals(player.getUUID()) || Presence.isOnline(id);
	}

	private static MutableComponent glyph() { return Component.literal("").setStyle(GLYPH); }

	public static Component tab(PlayerInfo info, Component name) {
		if (!active() || !isUser(info.getProfile().id())) return name;
		return Component.empty().append(glyph()).append(" ").append(name);
	}

	/** Oyuncunun kafasının üstündeki isim etiketi (yalnızca gerçek oyuncular; NPC'lerin UUID'si listede olmaz). */
	public static Component nameTag(Entity entity, Component name) {
		if (name == null || !(entity instanceof Player) || !active() || !isUser(entity.getUUID())) return name;
		return Component.empty().append(glyph()).append(" ").append(name);
	}

	public static Component chat(Component message) {
		ClientPacketListener net = Minecraft.getInstance().getConnection();
		if (message == null || net == null || !active()) return message;
		String head = head(message.getString());
		if (head.isEmpty()) return message;
		int at = -1;
		for (PlayerInfo info : net.getOnlinePlayers()) {
			if (!isUser(info.getProfile().id())) continue;
			int found = nameIndex(head, info.getProfile().name());
			if (found >= 0 && (at < 0 || found < at)) at = found;
		}
		return at < 0 ? message : insertAt(message, at);
	}

	/** Gönderen kısmı: "[Rütbe] Ad: mesaj", "<Ad> mesaj", "Ad » mesaj". Ayraç yoksa sohbet mesajı sayılmaz. */
	public static String head(String text) {
		int limit = Math.min(text.length(), MAX_HEAD);
		for (int i = 0; i < limit; i++) {
			char c = text.charAt(i);
			boolean clock = c == ':' && i + 1 < text.length() && Character.isDigit(text.charAt(i + 1));
			if (!clock && (c == ':' || c == '»' || c == '>' || c == '➤' || c == '➥' || c == '▶')) return text.substring(0, i + 1);
		}
		return "";
	}

	public static int nameIndex(String head, String name) {
		for (int i = head.indexOf(name); i >= 0; i = head.indexOf(name, i + 1)) {
			int end = i + name.length();
			if ((i == 0 || !nameChar(head.charAt(i - 1))) && (end == head.length() || !nameChar(head.charAt(end)))) return i;
		}
		return -1;
	}

	private static boolean nameChar(char c) { return c == '_' || Character.isLetterOrDigit(c); }

	/** Renkleri ve tıklama olaylarını koruyarak logoyu verilen karakterin önüne ekler. */
	public static Component insertAt(Component message, int at) {
		MutableComponent out = Component.empty();
		int[] offset = {0};
		boolean[] placed = {false};
		message.visit((style, text) -> {
			int start = offset[0];
			offset[0] += text.length();
			if (placed[0] || at >= offset[0]) {
				out.append(Component.literal(text).setStyle(style));
				return Optional.empty();
			}
			placed[0] = true;
			if (at > start) out.append(Component.literal(text.substring(0, at - start)).setStyle(style));
			out.append(glyph()).append(Component.literal(" "));
			out.append(Component.literal(text.substring(at - start)).setStyle(style));
			return Optional.empty();
		}, Style.EMPTY);
		return out;
	}
}
