package com.patron.pclient;

import net.minecraft.client.resources.language.I18n;

/** Çeviri kısayolu: anahtarlar assets/pclient/lang altındadır. */
public final class L {
	private L() {}

	public static String t(String key, Object... args) {
		return I18n.get("pclient." + key, args);
	}

	/** Türkçe büyük harf kuralları ("i" → "İ") dil seçimine göre uygulanır. */
	public static String up(String key, Object... args) {
		return upper(t(key, args));
	}

	public static String upper(String s) {
		String lang = net.minecraft.client.Minecraft.getInstance().options.languageCode;
		return s.toUpperCase(lang != null && lang.startsWith("tr") ? java.util.Locale.forLanguageTag("tr") : java.util.Locale.ROOT);
	}
}
