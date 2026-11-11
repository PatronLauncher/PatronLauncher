package com.patron.pclient.modules;

import com.patron.pclient.gui.Theme;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.ChoiceSetting;
import com.patron.pclient.module.setting.SliderSetting;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.material.MapColor;

/**
 * Köşede harita: yüklü parçaların üst bloklarından harita renkleriyle çizilir. Doku her tikte birkaç
 * satır güncellenir; tam tur bitince gösterilen harita değişir (takılma olmaz).
 */
public final class MinimapModule extends HudModule {
	private static final int TEX = 128, VISIBLE = 90;
	private static final Identifier ID = Identifier.fromNamespaceAndPath("pclient", "minimap");
	public final SliderSetting size = add(new SliderSetting("size", "setting.mapSize", 96, 64, 160, 4, "%.0f"));
	public final ChoiceSetting zoom = add(new ChoiceSetting("zoom", "setting.mapZoom", "near", List.of("near", "far")));
	public final BoolSetting rotate = add(new BoolSetting("rotate", "setting.rotateWithPlayer", true));
	public final BoolSetting players = add(new BoolSetting("players", "setting.showPlayers", true));
	public final BoolSetting waypoints = add(new BoolSetting("waypoints", "setting.showWaypoints", true));
	public final BoolSetting coords = add(new BoolSetting("coords", "setting.showCoords", true));
	public final BoolSetting north = add(new BoolSetting("north", "setting.showNorth", true));

	private DynamicTexture texture;
	/** Hazırlanan tur: arka tampon, merkez ve ilerleme. */
	private final int[] back = new int[TEX * TEX];
	private final int[] prevHeight = new int[TEX];
	private int passX, passZ, passScale, row = TEX;
	/** Gösterilen haritanın merkezi. */
	private int shownX, shownZ, shownScale = 1;
	private boolean ready, pending;
	private ClientLevel lastLevel;
	private final BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();

	public MinimapModule() { super("minimap", Category.HUD, "map", false, 0.996, 0.01); }

	@Override public void tick() {
		Minecraft mc = Minecraft.getInstance();
		ClientLevel level = mc.level;
		if (level == null || mc.player == null) return;
		if (level != lastLevel) {
			lastLevel = level;
			ready = pending = false;
			row = TEX;
		}
		if (row >= TEX && !pending) {
			passX = mc.player.getBlockX();
			passZ = mc.player.getBlockZ();
			passScale = zoom.is("far") ? 2 : 1;
			row = 0;
		}
		if (row >= TEX) return;
		boolean ceiling = level.dimensionType().hasCeiling();
		int rows = ceiling ? 8 : 16, startY = mc.player.getBlockY() + 2;
		for (int n = 0; n < rows && row < TEX; n++, row++) scanRow(level, row, ceiling, startY);
		// Tur bitti: doku çizim sırasında (görüntü iş parçacığında) güncellenir.
		if (row >= TEX) pending = true;
	}

	private void scanRow(ClientLevel level, int j, boolean ceiling, int startY) {
		int bz = passZ + (j - TEX / 2) * passScale;
		for (int i = 0; i < TEX; i++) {
			int bx = passX + (i - TEX / 2) * passScale;
			if (!level.hasChunk(bx >> 4, bz >> 4)) {
				back[j * TEX + i] = 0xFF101216;
				prevHeight[i] = Integer.MIN_VALUE;
				continue;
			}
			int y = ceiling ? scanDown(level, bx, startY, bz) : level.getHeight(Heightmap.Types.WORLD_SURFACE, bx, bz) - 1;
			pos.set(bx, y, bz);
			BlockState s = level.getBlockState(pos);
			MapColor color = s.getMapColor(level, pos);
			if (color == MapColor.NONE && y > level.getMinY()) {
				pos.setY(--y);
				s = level.getBlockState(pos);
				color = s.getMapColor(level, pos);
			}
			MapColor.Brightness b = MapColor.Brightness.NORMAL;
			if (s.getFluidState().is(FluidTags.WATER)) {
				int depth = 0;
				while (depth < 12 && level.getBlockState(pos.setY(y - depth - 1)).getFluidState().is(FluidTags.WATER)) depth++;
				b = depth > 7 ? MapColor.Brightness.LOW : depth > 3 ? MapColor.Brightness.NORMAL : MapColor.Brightness.HIGH;
			} else if (prevHeight[i] != Integer.MIN_VALUE && j > 0) {
				b = y > prevHeight[i] ? MapColor.Brightness.HIGH : y < prevHeight[i] ? MapColor.Brightness.LOW : MapColor.Brightness.NORMAL;
			}
			prevHeight[i] = y;
			int argb = color == MapColor.NONE ? 0xFF101216 : color.calculateARGBColor(b) | 0xFF000000;
			back[j * TEX + i] = argb;
		}
	}

	/** Tavanlı boyutlar (Nether): oyuncunun biraz üstünden aşağı inip ilk dolu bloğu bulur. */
	private int scanDown(ClientLevel level, int x, int startY, int z) {
		boolean air = false;
		for (int y = startY, end = Math.max(level.getMinY(), startY - 40); y > end; y--) {
			BlockState s = level.getBlockState(pos.set(x, y, z));
			if (s.isAir()) air = true;
			else if (air) return y;
		}
		return startY;
	}

	private void publish() {
		var img = texture.getPixels();
		if (img == null) return;
		for (int j = 0; j < TEX; j++) for (int i = 0; i < TEX; i++) img.setPixel(i, j, back[j * TEX + i]);
		texture.upload();
		shownX = passX;
		shownZ = passZ;
		shownScale = passScale;
		ready = true;
	}

	private void ensureTexture() {
		if (texture != null) return;
		texture = new DynamicTexture(() -> "PClient minimap", TEX, TEX, true);
		Minecraft.getInstance().getTextureManager().register(ID, texture);
	}

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		Minecraft mc = Minecraft.getInstance();
		var font = mc.font;
		int s = (int) Math.round(size.get());
		w = s;
		h = s + (coords.on() ? 12 : 0);
		Theme.hudBox(g, -1, -1, s + 1, s + 1);
		g.outline(-1, -1, s + 2, s + 2, Theme.withAlpha(Theme.accent(), 0xC0));
		var p = mc.player;
		boolean live = !preview && p != null && mc.level != null;
		if (live) {
			ensureTexture();
			if (pending) {
				publish();
				pending = false;
			}
		}
		float yaw = live ? p.getYRot() : 200f;
		double angle = rotate.on() ? Math.toRadians(-yaw - 180) : 0;
		float px = s / (float) VISIBLE;
		g.enableScissor(0, 0, s, s);
		g.fill(0, 0, s, s, 0xFF101216);
		if (live && ready) {
			double ox = (p.getX() - (shownX + 0.5)) / shownScale, oz = (p.getZ() - (shownZ + 0.5)) / shownScale;
			g.pose().pushMatrix();
			g.pose().translate(s / 2f, s / 2f);
			g.pose().rotate((float) angle);
			g.pose().scale(px, px);
			g.pose().translate((float) (-TEX / 2.0 - ox), (float) (-TEX / 2.0 - oz));
			g.blit(RenderPipelines.GUI_TEXTURED, ID, 0, 0, 0f, 0f, TEX, TEX, TEX, TEX);
			g.pose().popMatrix();
			if (players.on() || waypoints.on()) markers(g, s, px, angle, p);
		} else if (!live) {
			// Önizleme: birkaç renk bloğu
			for (int i = 0; i < 6; i++) for (int j = 0; j < 6; j++)
				g.fill(i * s / 6, j * s / 6, (i + 1) * s / 6, (j + 1) * s / 6, (i + j) % 3 == 0 ? 0xFF4E7A35 : (i * j) % 4 == 1 ? 0xFF3A5FCD : 0xFF5F8F3E);
		}
		// Oyuncu oku (merkez)
		g.pose().pushMatrix();
		g.pose().translate(s / 2f, s / 2f);
		if (!rotate.on()) g.pose().rotate((float) Math.toRadians(yaw + 180));
		for (int i = 0; i < 4; i++) g.fill(-i, -3 + i, i + 1, -2 + i, 0xFFFFFFFF);
		g.fill(-3, 1, 4, 2, 0xFFFFFFFF);
		g.pose().popMatrix();
		g.disableScissor();
		if (north.on()) {
			// Kuzey (-z) yönü, harita döndürmesiyle aynı dönüşümle kenara yerleşir.
			double na = rotate.on() ? angle : 0;
			float r = s / 2f - 6;
			int nx = Math.round(s / 2f + r * (float) Math.sin(na)), ny = Math.round(s / 2f - r * (float) Math.cos(na));
			g.fill(nx - 4, ny - 5, nx + 4, ny + 5, 0xC0000000);
			g.text(font, "N", nx - 2, ny - 4, Theme.accent(), false);
		}
		if (coords.on()) {
			String c = live ? p.getBlockX() + ", " + p.getBlockY() + ", " + p.getBlockZ() : "128, 64, -340";
			g.text(font, c, (s - font.width(c)) / 2, s + 3, color.get(), true);
		}
	}

	private void markers(GuiGraphicsExtractor g, int s, float px, double angle, net.minecraft.client.player.LocalPlayer p) {
		double sin = Math.sin(angle), cos = Math.cos(angle);
		int scale = shownScale;
		if (players.on()) for (AbstractClientPlayer other : Minecraft.getInstance().level.players()) {
			if (other == p) continue;
			dot(g, s, px, sin, cos, (other.getX() - p.getX()) / scale, (other.getZ() - p.getZ()) / scale, 0xFFFFFFFF, 1);
		}
		if (waypoints.on()) {
			String dim = Waypoints.dimension();
			for (Waypoints.Waypoint w : Waypoints.current())
				if (w.visible && w.dimension.equals(dim))
					dot(g, s, px, sin, cos, (w.x + 0.5 - p.getX()) / scale, (w.z + 0.5 - p.getZ()) / scale, w.color, 2);
		}
	}

	private void dot(GuiGraphicsExtractor g, int s, float px, double sin, double cos, double dx, double dz, int color, int r) {
		double x = (dx * cos - dz * sin) * px + s / 2.0, y = (dx * sin + dz * cos) * px + s / 2.0;
		int ix = (int) Math.round(Math.max(r + 1, Math.min(s - r - 2, x))), iy = (int) Math.round(Math.max(r + 1, Math.min(s - r - 2, y)));
		g.fill(ix - r - 1, iy - r - 1, ix + r + 2, iy + r + 2, 0xC0000000);
		g.fill(ix - r, iy - r, ix + r + 1, iy + r + 1, color);
	}
}
