package com.patron.pclient.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.Blaze3D;
import com.patron.pclient.PClient;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.minecraft.client.Minecraft;

/** Launcher'ın oyun klasörüne yazdığı destek bağlantıları (Discord ve web sitesi). */
public final class Support {
	private static String discord, website, presence;

	private Support() {}

	private static void load() {
		if (discord != null) return;
		discord = website = presence = "";
		Path file = Minecraft.getInstance().gameDirectory.toPath().resolve("pclient").resolve("support.json");
		if (!Files.isRegularFile(file)) return;
		try {
			JsonObject o = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
			discord = https(o.get("discord"));
			website = https(o.get("website"));
			presence = https(o.get("presence"));
		} catch (IOException | RuntimeException e) {
			PClient.LOG.warn("support.json okunamadı", e);
		}
	}

	private static String https(JsonElement value) {
		String url = value == null || !value.isJsonPrimitive() ? "" : value.getAsString();
		return url.startsWith("https://") ? url : "";
	}

	public static String discord() {
		load();
		return discord;
	}

	public static String website() {
		load();
		return website;
	}

	public static String presence() {
		load();
		return presence;
	}

	/** Boş bağlantı için null döner; düğme pasif çizilir. */
	public static Runnable opener(String url) {
		return url.isEmpty() ? null : () -> Blaze3D.openUri(URI.create(url));
	}

	public static void openGameFolder() {
		Blaze3D.openPath(Minecraft.getInstance().gameDirectory.toPath());
	}
}
