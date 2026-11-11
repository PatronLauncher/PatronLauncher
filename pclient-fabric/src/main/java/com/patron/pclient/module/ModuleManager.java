package com.patron.pclient.module;

import com.patron.pclient.gui.HudEditorScreen;
import com.patron.pclient.modules.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/**
 * Modül kaydı, tik ve HUD çizimi. Etkin modüller dizilerde hazır tutulur: kapalı modüller kare ve tik
 * başına hiçbir iş yaptırmaz, her karede yeni liste de oluşturulmaz.
 */
public final class ModuleManager {
	private static final List<Module> MODULES = new ArrayList<>();
	private static final Map<Class<?>, Module> BY_CLASS = new HashMap<>();
	private static final Map<String, Module> BY_ID = new HashMap<>();
	private static final List<HudModule> HUDS = new ArrayList<>();
	private static final List<HudModule> HUDS_VIEW = Collections.unmodifiableList(HUDS);
	private static final Module[] NO_MODULES = {};
	private static final HudModule[] NO_HUDS = {};
	private static final Overlay[] NO_OVERLAYS = {};
	private static Module[] activeModules = NO_MODULES;
	private static HudModule[] activeHuds = NO_HUDS;
	private static Overlay[] activeOverlays = NO_OVERLAYS;
	private static boolean stale = true;

	private ModuleManager() {}

	private static void add(Module m) {
		MODULES.add(m);
		BY_CLASS.put(m.getClass(), m);
		BY_ID.put(m.id, m);
		if (m instanceof HudModule h) HUDS.add(h);
	}

	public static void init() {
		if (!MODULES.isEmpty()) return;
		// HUD
		add(new KeystrokesModule());
		add(new CoordinatesModule());
		add(new FpsModule());
		add(new CpsModule());
		add(new PingModule());
		add(new ArmorModule());
		add(new EffectsModule());
		add(new ClockModule());
		add(new SpeedModule());
		add(new MinimapModule().fresh());
		add(new DirectionModule().fresh());
		add(new WorldInfoModules.TargetInfo().fresh());
		add(new WorldInfoModules.ItemCounter().fresh());
		add(new InfoModules.Combo().fresh());
		add(new InfoModules.Reach().fresh());
		add(new InfoModules.Saturation().fresh());
		add(new InfoModules.Day().fresh());
		add(new InfoModules.Playtime().fresh());
		add(new InfoModules.Stopwatch().fresh());
		add(new InfoModules.Memory().fresh());
		add(new WorldInfoModules.Packs().fresh());
		add(new ExtraHudModules.Light().fresh());
		add(new ExtraHudModules.Rotation().fresh());
		add(new ExtraHudModules.WorldTime().fresh());
		add(new ExtraHudModules.HeldItem().fresh());
		add(new ExtraHudModules.Session().fresh());
		add(new ExtraHudModules.Mount().fresh());
		add(new ExtraHudModules.TntTimer().fresh());
		add(new ExtraHudModules.DurabilityWarning().fresh());
		add(new ExtraHudModules.LowHealth().fresh());
		add(new MusicModule().fresh());
		// Sunucu
		add(new InfoModules.ServerAddress().fresh());
		add(new ExtraHudModules.Players().fresh());
		add(new AutoTextModule().fresh());
		add(new VisualModules.ChatTweaks().fresh());
		add(new InterfaceModules.ChatPlus().fresh());
		add(new InterfaceModules.TabPing().fresh());
		add(new com.patron.pclient.modules.PClientBadge().fresh());
		// Mekanik
		add(new ToggleSprintModule());
		add(new ZoomModule());
		add(new CameraModules.Freelook().fresh());
		add(new CameraModules.Snaplook().fresh());
		add(new WaypointsModule().fresh());
		// Görsel
		add(new FullbrightModule());
		add(new VisualModules.Crosshair().fresh());
		add(new VisualModules.NoHurtCam().fresh());
		add(new VisualModules.LowFire().fresh());
		add(new VisualModules.Hitboxes().fresh());
		add(new VisualModules.ChunkBorders().fresh());
		add(new VisualModules.ClearWeather().fresh());
		add(new InterfaceModules.Scoreboard().fresh());
		add(new InterfaceModules.BossBar().fresh());
		add(new InterfaceModules.ScreenEffects().fresh());
		add(new InterfaceModules.HideToasts().fresh());
		add(new InterfaceModules.OwnName().fresh());
		add(new InterfaceModules.BlockOutline().fresh());
		add(new InterfaceModules.HitColor().fresh());
		add(new InterfaceModules.HandView().fresh());
		// Performans
		add(new PerformanceModules.FpsBoost().fresh());
		add(new PerformanceModules.Particles().fresh());
		// Geliştirme aşamasındakiler
		add(new SoonModule("schematics", "house", true));
		add(new SoonModule("replay", "rewind", false));
		add(new SoonModule("cosmetics", "shirt", false));
	}

	public static List<Module> all() { return Collections.unmodifiableList(MODULES); }

	public static Module byId(String id) { return BY_ID.get(id); }

	@SuppressWarnings("unchecked")
	public static <T extends Module> T get(Class<T> type) {
		Module m = BY_CLASS.get(type);
		if (m == null) throw new IllegalStateException(type.getName());
		return (T) m;
	}

	public static List<HudModule> huds() { return HUDS_VIEW; }

	/** Bir modül açılıp kapandığında etkin diziler bir sonraki kullanımda yeniden kurulur. */
	static void markStale() { stale = true; }

	private static void refreshActive() {
		if (!stale) return;
		stale = false;
		List<Module> modules = new ArrayList<>();
		List<HudModule> huds = new ArrayList<>();
		List<Overlay> overlays = new ArrayList<>();
		for (Module m : MODULES) {
			if (!m.isEnabled()) continue;
			modules.add(m);
			if (m instanceof HudModule h) huds.add(h);
			if (m instanceof Overlay o) overlays.add(o);
		}
		activeModules = modules.toArray(NO_MODULES);
		activeHuds = huds.toArray(NO_HUDS);
		activeOverlays = overlays.toArray(NO_OVERLAYS);
	}

	public static void tick() {
		refreshActive();
		for (Module m : activeModules) m.tick();
	}

	/** Oyun içi HUD. HUD düzenleyicisi açıkken öğeleri düzenleyici kendisi çizer. */
	public static void renderHud(GuiGraphicsExtractor g) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null || mc.gui.screen() instanceof HudEditorScreen) return;
		refreshActive();
		for (HudModule h : activeHuds) h.render(g, false);
		for (Overlay o : activeOverlays) o.renderOverlay(g);
	}
}
