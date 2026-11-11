package com.patron.pclient.gui;

import com.patron.pclient.L;
import java.util.function.Consumer;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

/** Sunucu ekleme, düzenleme ve doğrudan bağlanma formu (PClient tasarımı). */
public final class PClientServerEditScreen extends PcScreen {
	private enum Kind { ADD, EDIT, DIRECT }

	private final Kind kind;
	private final ServerData target;
	private final Consumer<ServerData> done;
	private final PcTextField name = new PcTextField(48, L.t("servers.nameHint"));
	private final PcTextField address = new PcTextField(128, "play.example.com");
	private String error;

	private PClientServerEditScreen(Screen parent, Kind kind, ServerData target, Consumer<ServerData> done) {
		super("title.servers", parent);
		this.kind = kind;
		this.target = target;
		this.done = done;
		if (target != null) {
			name.set(target.name);
			address.set(target.ip);
		}
		address.allow(c -> c != ' ');
		name.onSubmit(this::save);
		address.onSubmit(this::save);
	}

	public static PClientServerEditScreen add(Screen parent, Consumer<ServerData> added) {
		return new PClientServerEditScreen(parent, Kind.ADD, null, added);
	}

	public static PClientServerEditScreen edit(Screen parent, ServerData data, Runnable saved) {
		return new PClientServerEditScreen(parent, Kind.EDIT, data, d -> saved.run());
	}

	public static PClientServerEditScreen direct(Screen parent, Consumer<ServerData> join) {
		return new PClientServerEditScreen(parent, Kind.DIRECT, null, join);
	}

	@Override protected String dock() { return null; }

	@Override protected void init() {
		if (!isFocused(address)) focus(kind == Kind.DIRECT ? address : name);
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		String title = switch (kind) {
			case ADD -> L.up("servers.addTitle");
			case EDIT -> L.up("servers.editTitle");
			case DIRECT -> L.up("servers.direct");
		};
		frame(g, 340, kind == Kind.DIRECT ? 130 : 170, title);
		int x1 = fx + 16, x2 = fx + fw - 16, y = fy + FRAME_HEADER + 12;
		if (kind != Kind.DIRECT) {
			Theme.spaced(g, L.up("servers.name"), x1, y, Theme.FAINT, 1);
			y += 11;
			textField(g, x1, y, x2, y + 18, name);
			y += 26;
		}
		Theme.spaced(g, L.up("servers.address"), x1, y, Theme.FAINT, 1);
		y += 11;
		textField(g, x1, y, x2, y + 18, address);

		int by = fy + fh - 32;
		g.fill(fx + 1, by - 6, fx + fw - 1, by - 5, Theme.LINE);
		boolean valid = ServerAddress.isValidAddress(address.value().trim());
		String ok = L.up(kind == Kind.DIRECT ? "servers.join" : "common.save");
		button(g, x2 - 110, by, x2, by + 22, ok, Style.PRIMARY, valid ? this::save : null);
		button(g, x2 - 196, by, x2 - 116, by + 22, L.up("common.cancel"), Style.GHOST, this::onClose);
		if (error != null) g.text(font, Theme.ellipsize(error, x2 - 206 - x1), x1, by + 7, 0xFFE5484D, false);
	}

	private void save() {
		String ip = address.value().trim();
		if (!ServerAddress.isValidAddress(ip)) {
			error = L.t("servers.badAddress");
			return;
		}
		String n = name.value().trim().isEmpty() ? L.t("servers.defaultName") : name.value().trim();
		switch (kind) {
			case ADD -> {
				minecraft.gui.setScreen(parent);
				done.accept(new ServerData(n, ip, ServerData.Type.OTHER));
			}
			case EDIT -> {
				target.name = n;
				target.ip = ip;
				minecraft.gui.setScreen(parent);
				done.accept(target);
			}
			case DIRECT -> done.accept(new ServerData(L.t("servers.defaultName"), ip, ServerData.Type.OTHER));
		}
	}
}
