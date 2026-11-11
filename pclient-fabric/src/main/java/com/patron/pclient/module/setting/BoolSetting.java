package com.patron.pclient.module.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

public final class BoolSetting extends Setting<Boolean> {
	public BoolSetting(String id, String labelKey, boolean fallback) { super(id, labelKey, fallback); }

	public boolean on() { return value; }

	public void toggle() { value = !value; }

	@Override public JsonElement save() { return new JsonPrimitive(value); }

	@Override public void load(JsonElement e) {
		if (e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isBoolean()) value = e.getAsBoolean();
	}
}
