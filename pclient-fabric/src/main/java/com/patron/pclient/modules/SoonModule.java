package com.patron.pclient.modules;

import com.patron.pclient.module.Category;
import com.patron.pclient.module.Module;

/** Geliştirme aşamasındaki özellik. Menüde görünür, "Yakında" sayfası açar; açılıp kapatılamaz. */
public final class SoonModule extends Module {
	/** Öne çıkan (vitrin sayfası hazırlanmış) özellik. */
	public final boolean featured;

	public SoonModule(String id, String icon, boolean featured) {
		super(id, Category.SOON, icon, false);
		this.featured = featured;
	}

	@Override public boolean isAvailable() { return false; }

	@Override public boolean isNew() { return featured; }
}
