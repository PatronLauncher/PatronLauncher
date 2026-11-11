package com.patron.pclient.module;

import com.patron.pclient.module.setting.Setting;
import java.util.ArrayList;
import java.util.List;

/** Tüm PClient modüllerinin temeli. Modüller yalnızca istemci tarafında çalışır. */
public abstract class Module {
	public final String id;
	public final Category category;
	public final String icon;
	private final boolean enabledByDefault;
	private boolean enabled;
	private final List<Setting<?>> settings = new ArrayList<>();

	protected Module(String id, Category category, String icon, boolean enabledByDefault) {
		this.id = id;
		this.category = category;
		this.icon = icon;
		this.enabledByDefault = enabledByDefault;
		this.enabled = enabledByDefault;
	}

	/** Çeviri anahtarları: module.<id>.name ve module.<id>.desc */
	public String nameKey() { return "module." + id + ".name"; }

	public String descKey() { return "module." + id + ".desc"; }

	private String section;
	private boolean fresh;

	protected final <S extends Setting<?>> S add(S s) {
		s.group = section;
		settings.add(s);
		return s;
	}

	/** Bundan sonra eklenen ayarlar bu bölüm başlığı altında gösterilir. */
	protected final void section(String key) { section = key; }

	/** Menüde "YENİ" etiketiyle gösterilir. */
	public final Module fresh() {
		fresh = true;
		return this;
	}

	public List<Setting<?>> settings() { return settings; }

	public boolean isEnabled() { return enabled; }

	public boolean enabledByDefault() { return enabledByDefault; }

	public void setEnabled(boolean on) {
		if (on == enabled || !isAvailable()) return;
		enabled = on;
		ModuleManager.markStale();
		if (on) onEnable();
		else onDisable();
	}

	/** Henüz geliştirilmekte olan özellikler false döner; menüde "Yakında" görünür. */
	public boolean isAvailable() { return true; }

	/** Menüde "YENİ" etiketi. */
	public boolean isNew() { return fresh; }

	public void resetToDefaults() {
		settings.forEach(s -> s.reset());
		setEnabled(enabledByDefault);
	}

	protected void onEnable() {}

	protected void onDisable() {}

	/** Her istemci tikinde (saniyede 20) çağrılır; yalnızca etkin modüller için. */
	public void tick() {}
}
