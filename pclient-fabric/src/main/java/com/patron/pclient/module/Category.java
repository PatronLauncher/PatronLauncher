package com.patron.pclient.module;

/** Menüdeki modül kategorileri. */
public enum Category {
	HUD("cat.hud"),
	SERVER("cat.server"),
	MECHANIC("cat.mechanic"),
	VISUAL("cat.visual"),
	PERFORMANCE("cat.performance"),
	SOON("cat.soon");

	public final String key;

	Category(String key) { this.key = key; }
}
