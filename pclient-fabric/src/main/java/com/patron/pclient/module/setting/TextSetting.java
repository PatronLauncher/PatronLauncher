package com.patron.pclient.module.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

/** Kısa metin (ör. otomatik mesaj). Satır sonu içeremez. */
public final class TextSetting extends Setting<String> {
	public final int maxLength;

	public TextSetting(String id, String labelKey, String fallback, int maxLength) {
		super(id, labelKey, fallback);
		this.maxLength = maxLength;
	}

	@Override public void set(String v) {
		String clean = v == null ? "" : v.replaceAll("[\r\n\u00A7]", "");
		value = clean.length() > maxLength ? clean.substring(0, maxLength) : clean;
	}

	@Override public JsonElement save() { return new JsonPrimitive(value); }

	@Override public void load(JsonElement e) {
		if (e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isString()) set(e.getAsString());
	}
}
