package com.patron.pclient.module.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;
import java.util.List;

/** Sabit seçenekler arasında döner; seçenek etiketleri çeviri anahtarıdır. */
public final class ChoiceSetting extends Setting<String> {
	public final List<String> options;

	public ChoiceSetting(String id, String labelKey, String fallback, List<String> options) {
		super(id, labelKey, fallback);
		this.options = List.copyOf(options);
	}

	public void cycle(int dir) {
		int i = options.indexOf(value);
		value = options.get(Math.floorMod(i + dir, options.size()));
	}

	public boolean is(String option) { return value.equals(option); }

	@Override public JsonElement save() { return new JsonPrimitive(value); }

	@Override public void load(JsonElement e) {
		if (e != null && e.isJsonPrimitive() && options.contains(e.getAsString())) value = e.getAsString();
	}
}
