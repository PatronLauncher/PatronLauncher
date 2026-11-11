package com.patron.pclient.module.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

public final class SliderSetting extends Setting<Double> {
	public final double min, max, step;
	/** Değer gösterim biçimi, örn. "%.1fx". */
	public final String format;

	public SliderSetting(String id, String labelKey, double fallback, double min, double max, double step, String format) {
		super(id, labelKey, fallback);
		this.min = min;
		this.max = max;
		this.step = step;
		this.format = format;
	}

	@Override public void set(Double v) {
		double s = Math.round((v - min) / step) * step + min;
		value = Math.max(min, Math.min(max, s));
	}

	/** 0..1 arası konumdan değer atar. */
	public void setFraction(double f) { set(min + (max - min) * Math.max(0, Math.min(1, f))); }

	public double fraction() { return (value - min) / (max - min); }

	public String display() { return String.format(java.util.Locale.ROOT, format, value); }

	@Override public JsonElement save() { return new JsonPrimitive(value); }

	@Override public void load(JsonElement e) {
		if (e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isNumber()) set(e.getAsDouble());
	}
}
