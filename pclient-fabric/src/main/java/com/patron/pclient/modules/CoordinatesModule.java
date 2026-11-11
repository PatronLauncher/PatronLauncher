package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.core.Direction;

/** Konum, bakış yönü ve biyom. */
public final class CoordinatesModule extends HudModule {
	public final BoolSetting direction = add(new BoolSetting("direction", "setting.direction", true));
	public final BoolSetting biome = add(new BoolSetting("biome", "setting.biome", true));
	public final BoolSetting compact = add(new BoolSetting("compact", "setting.compact", false));

	public CoordinatesModule() { super("coords", Category.HUD, "pin", true, 0.004, 0.006); }

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		var p = Minecraft.getInstance().player;
		var level = Minecraft.getInstance().level;
		int x = preview || p == null ? 500 : p.getBlockX(), y = preview || p == null ? 62 : p.getBlockY(),
			z = preview || p == null ? 250 : p.getBlockZ();
		Direction dir = preview || p == null ? Direction.NORTH : p.getDirection();
		List<String> lines = new ArrayList<>();
		if (compact.on()) lines.add(L.t("hud.xyz", x, y, z));
		else {
			lines.add("X: " + x);
			lines.add("Y: " + y);
			lines.add("Z: " + z);
		}
		if (direction.on()) lines.add(L.t("hud.facing", L.t("dir." + dir.getName()), axis(dir)));
		if (biome.on()) {
			String name = "minecraft:plains";
			if (!preview && p != null && level != null) name = level.getBiome(p.blockPosition()).getRegisteredName();
			lines.add(L.t("hud.biome", I18n.get("biome." + name.replace(':', '.'))));
		}
		linesBox(g, lines);
	}

	private static String axis(Direction d) {
		return switch (d) {
			case NORTH -> "-Z";
			case SOUTH -> "+Z";
			case EAST -> "+X";
			case WEST -> "-X";
			default -> "";
		};
	}
}
