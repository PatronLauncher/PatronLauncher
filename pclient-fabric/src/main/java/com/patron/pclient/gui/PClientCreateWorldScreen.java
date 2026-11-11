package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.PClient;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.util.FileUtil;
import net.minecraft.world.Difficulty;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.levelgen.WorldOptions;
import net.minecraft.world.level.levelgen.presets.WorldPreset;
import net.minecraft.world.level.levelgen.presets.WorldPresets;

/** PClient yeni dünya ekranı: ad, oyun modu, zorluk, dünya türü, tohum ve temel seçenekler. */
public final class PClientCreateWorldScreen extends PcScreen {
	private enum Mode { SURVIVAL, HARDCORE, CREATIVE }

	private record Kind(String key, ResourceKey<WorldPreset> preset) {}

	private static final Kind[] KINDS = {
		new Kind("create.type.normal", WorldPresets.NORMAL),
		new Kind("create.type.flat", WorldPresets.FLAT),
		new Kind("create.type.large", WorldPresets.LARGE_BIOMES),
		new Kind("create.type.amplified", WorldPresets.AMPLIFIED)};

	private final PcTextField name = new PcTextField(64, L.t("create.defaultName"));
	private final PcTextField seed = new PcTextField(32, L.t("create.seedHint"));
	private Mode mode = Mode.SURVIVAL;
	private Difficulty difficulty = Difficulty.NORMAL;
	private int kind;
	private boolean cheats, structures = true, bonusChest;
	private String error;

	public PClientCreateWorldScreen(Screen parent) {
		super("title.createWorld", parent);
		name.onSubmit(this::create);
		seed.onSubmit(this::create);
	}

	@Override protected String dock() { return null; }

	@Override protected void init() {
		if (!isFocused(seed)) focus(name);
	}

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		frame(g, 420, 300, L.up("create.title"));
		int x1 = fx + 16, x2 = fx + fw - 16, y = fy + FRAME_HEADER + 10;
		int mid = (x1 + x2) / 2;

		Theme.spaced(g, L.up("create.name"), x1, y, Theme.FAINT, 1);
		Theme.spaced(g, L.up("create.seed"), mid + 4, y, Theme.FAINT, 1);
		y += 11;
		textField(g, x1, y, mid - 4, y + 18, name);
		textField(g, mid + 4, y, x2, y + 18, seed);
		y += 28;

		boolean hardcore = mode == Mode.HARDCORE;
		String modeLabel = switch (mode) {
			case SURVIVAL -> GameType.SURVIVAL.getLongDisplayName().getString();
			case CREATIVE -> GameType.CREATIVE.getLongDisplayName().getString();
			case HARDCORE -> L.t("worlds.hardcore");
		};
		y = choice(g, x1, x2, y, "create.mode", modeLabel, () -> mode = Mode.values()[(mode.ordinal() + 1) % Mode.values().length]);
		y = choice(g, x1, x2, y, "create.difficulty", (hardcore ? Difficulty.HARD : difficulty).getDisplayName().getString(),
			hardcore ? null : () -> difficulty = Difficulty.values()[(difficulty.ordinal() + 1) % Difficulty.values().length]);
		y = choice(g, x1, x2, y, "create.type", L.t(KINDS[kind].key), () -> kind = (kind + 1) % KINDS.length);
		y = toggle(g, x1, x2, y, "create.cheats", cheats && !hardcore, hardcore ? null : () -> cheats = !cheats);
		y = toggle(g, x1, x2, y, "create.structures", structures, () -> structures = !structures);
		y = toggle(g, x1, x2, y, "create.bonusChest", bonusChest && !hardcore, hardcore ? null : () -> bonusChest = !bonusChest);

		int by = fy + fh - 32;
		g.fill(fx + 1, by - 6, fx + fw - 1, by - 5, Theme.LINE);
		button(g, x2 - 140, by, x2, by + 22, L.up("create.create"), Style.PRIMARY, this::create);
		button(g, x2 - 226, by, x2 - 146, by + 22, L.up("common.cancel"), Style.GHOST, this::onClose);
		if (error != null) g.text(font, Theme.ellipsize(error, x2 - 236 - x1), x1, by + 7, 0xFFE5484D, false);
		else if (hardcore) g.text(font, Theme.ellipsize(L.t("create.hardcoreNote"), x2 - 236 - x1), x1, by + 7, Theme.FAINT, false);
	}

	/** Değeri tıklayınca sıradakine geçen seçim satırı. */
	private int choice(GuiGraphicsExtractor g, int x1, int x2, int y, String key, String value, Runnable next) {
		g.text(font, L.t(key), x1, y + 5, next == null ? Theme.MUTED : Theme.TEXT, false);
		int w = Math.max(110, font.width(value) + 34);
		boolean hov = next != null && hit(x2 - w, y, x2, y + 18, next);
		Theme.notched(g, x2 - w, y, x2, y + 18, 3, next == null ? 0x0AFFFFFF : hov ? Theme.OFF_HOVER : Theme.OFF);
		g.text(font, value, x2 - w + 8, y + 5, next == null ? Theme.FAINT : Theme.TEXT, false);
		PixelIcons.draw(g, "next", x2 - 14, y + 5, 1, hov ? Theme.TEXT : Theme.FAINT);
		g.fill(x1, y + 22, x2, y + 23, Theme.LINE);
		return y + 27;
	}

	private int toggle(GuiGraphicsExtractor g, int x1, int x2, int y, String key, boolean on, Runnable flip) {
		g.text(font, L.t(key), x1, y + 5, flip == null ? Theme.MUTED : Theme.TEXT, false);
		if (flip != null) toggleSwitch(g, x2 - 24, y + 3, on, flip);
		else g.fill(x2 - 24, y + 3, x2, y + 15, 0x14FFFFFF);
		g.fill(x1, y + 22, x2, y + 23, Theme.LINE);
		return y + 27;
	}

	private void create() {
		String levelName = name.value().trim().isEmpty() ? L.t("create.defaultName") : name.value().trim();
		String id;
		try {
			id = FileUtil.findAvailableName(minecraft.getLevelSource().getBaseDir(), levelName, "");
		} catch (Exception e) {
			error = L.t("create.badName");
			return;
		}
		boolean hardcore = mode == Mode.HARDCORE;
		GameType type = mode == Mode.CREATIVE ? GameType.CREATIVE : GameType.SURVIVAL;
		Difficulty diff = hardcore ? Difficulty.HARD : difficulty;
		LevelSettings settings = new LevelSettings(levelName, type,
			new LevelSettings.DifficultySettings(diff, hardcore, false), cheats && !hardcore, WorldDataConfiguration.DEFAULT);
		long seedValue = WorldOptions.parseSeed(seed.value()).orElse(WorldOptions.randomSeed());
		WorldOptions options = new WorldOptions(seedValue, structures, bonusChest && !hardcore);
		ResourceKey<WorldPreset> preset = KINDS[kind].preset;
		PClient.LOG.info("PClient: yeni dünya {} ({})", id, preset.identifier());
		minecraft.createWorldOpenFlows().createFreshLevel(id, settings, options,
			registries -> registries.lookupOrThrow(Registries.WORLD_PRESET).getOrThrow(preset).value().createWorldDimensions(), this);
	}
}
