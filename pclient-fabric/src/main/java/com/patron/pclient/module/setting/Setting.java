package com.patron.pclient.module.setting;

import com.google.gson.JsonElement;

/** Bir modül ayarı. Değerler JSON olarak saklanır; geçersiz kayıtlar varsayılana döner. */
public abstract sealed class Setting<T> permits BoolSetting, SliderSetting, ColorSetting, ChoiceSetting, KeySetting, TextSetting {
	public final String id;
	public final String labelKey;
	protected final T fallback;
	protected T value;
	/** Ayar sayfasında altında gösterileceği bölüm başlığının çeviri anahtarı (null: bölümsüz). */
	public String group;

	protected Setting(String id, String labelKey, T fallback) {
		this.id = id;
		this.labelKey = labelKey;
		this.fallback = fallback;
		this.value = fallback;
	}

	public T get() { return value; }

	public void set(T v) { value = v; }

	public void reset() { value = fallback; }

	public abstract JsonElement save();

	/** Varsayılan değerin kayıt biçimi (profil kodları yalnızca farkları taşır). */
	public final JsonElement defaultJson() {
		T current = value;
		value = fallback;
		JsonElement json = save();
		value = current;
		return json;
	}

	/** Kayıttan okur; tip uyuşmazsa varsayılan korunur. */
	public abstract void load(JsonElement e);
}
