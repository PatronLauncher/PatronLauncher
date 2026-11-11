package com.patron.pclient.module.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;
import com.mojang.blaze3d.platform.InputConstants;

/** Klavye tuşu (InputConstants klavye kodu). */
public final class KeySetting extends Setting<Integer> {
	public KeySetting(String id, String labelKey, int fallback) { super(id, labelKey, fallback); }

	public boolean isDown() { return value != InputConstants.UNKNOWN.getValue() && InputConstants.isKeyDown(value); }

	public String display() { return InputConstants.Type.KEYBOARD.getOrCreate(value).getDisplayName().getString(); }

	@Override public JsonElement save() { return new JsonPrimitive(value); }

	@Override public void load(JsonElement e) {
		if (e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isNumber()) value = e.getAsInt();
	}
}
