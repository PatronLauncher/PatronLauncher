package com.patron.pclient.module.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

/** Hazır paletten renk seçimi (ARGB). */
public final class ColorSetting extends Setting<Integer> {
	public static final int[] PALETTE = {
		0xFFFFFFFF, 0xFFFF2A3D, 0xFFFF8A2A, 0xFFFFD43B, 0xFF4ADE80, 0xFF38BDF8, 0xFFA78BFA, 0xFFF472B6, 0xFF9CA3AF,
	};

	public ColorSetting(String id, String labelKey, int fallback) { super(id, labelKey, fallback); }

	@Override public JsonElement save() { return new JsonPrimitive(String.format("#%08X", value)); }

	@Override public void load(JsonElement e) {
		if (e == null || !e.isJsonPrimitive()) return;
		String s = e.getAsString();
		if (s.matches("#[0-9A-Fa-f]{8}")) value = (int) Long.parseLong(s.substring(1), 16);
	}
}
