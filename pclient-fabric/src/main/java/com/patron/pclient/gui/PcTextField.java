package com.patron.pclient.gui;

import java.util.function.Consumer;
import java.util.function.IntPredicate;

/**
 * PClient metin kutusunun verisi. Çizim ve odak {@link PcScreen#textField} tarafından yapılır;
 * Minecraft 26.3'te karakter olayları yalnızca metin girişi başlatıldığında gelir, bu yüzden odak
 * PcScreen üzerinden yönetilir.
 */
public final class PcTextField {
	public final int maxLength;
	public final String placeholder;
	private String value = "";
	/** İzin verilen karakterler (varsayılan: tümü). */
	IntPredicate allowed = c -> true;
	/** Değer her değiştiğinde çağrılır. */
	Consumer<String> onChange = v -> {};
	/** ESC önce metni temizler (arama kutuları için). */
	boolean clearOnEscape;
	/** Enter'a basılınca çağrılır. */
	Runnable onSubmit;

	public PcTextField(int maxLength, String placeholder) {
		this.maxLength = maxLength;
		this.placeholder = placeholder;
	}

	public String value() { return value; }

	public PcTextField set(String v) {
		v = v == null ? "" : v;
		if (v.length() > maxLength) v = v.substring(0, maxLength);
		if (!v.equals(value)) {
			value = v;
			onChange.accept(v);
		}
		return this;
	}

	public PcTextField onChange(Consumer<String> c) {
		onChange = c;
		return this;
	}

	public PcTextField onSubmit(Runnable r) {
		onSubmit = r;
		return this;
	}

	public PcTextField clearOnEscape() {
		clearOnEscape = true;
		return this;
	}

	public PcTextField allow(IntPredicate p) {
		allowed = p;
		return this;
	}

	void type(String s) {
		StringBuilder b = new StringBuilder(value);
		s.codePoints().filter(c -> c >= 32 && c != 127 && allowed.test(c)).forEach(b::appendCodePoint);
		set(b.toString());
	}

	void backspace(boolean word) {
		if (value.isEmpty()) return;
		if (!word) {
			set(value.substring(0, value.offsetByCodePoints(value.length(), -1)));
			return;
		}
		String v = value.stripTrailing();
		int i = v.lastIndexOf(' ');
		set(i < 0 ? "" : v.substring(0, i + 1));
	}
}
