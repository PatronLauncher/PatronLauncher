package com.patron.pclient.modules;

import com.patron.pclient.L;
import com.patron.pclient.gui.PixelIcons;
import com.patron.pclient.gui.Theme;
import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import com.patron.pclient.module.setting.SliderSetting;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.server.packs.repository.Pack;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;

/** Envanter, hedef ve kaynak paketi bilgisi gösteren modüller. */
public final class WorldInfoModules {
	private WorldInfoModules() {}

	/** Ok, inci, altın elma ve totem sayıları. */
	public static final class ItemCounter extends HudModule {
		public final BoolSetting arrows = add(new BoolSetting("arrows", "setting.countArrows", true));
		public final BoolSetting pearls = add(new BoolSetting("pearls", "setting.countPearls", true));
		public final BoolSetting apples = add(new BoolSetting("apples", "setting.countApples", true));
		public final BoolSetting totems = add(new BoolSetting("totems", "setting.countTotems", true));
		public final BoolSetting hideEmpty = add(new BoolSetting("hideEmpty", "setting.hideEmpty", true));

		private record Row(Item icon, int count, String sample) {}

		private List<Row> cached = List.of();

		public ItemCounter() { super("items", Category.HUD, "bag", false, 0.996, 0.45); }

		private static int count(Item... items) {
			var p = Minecraft.getInstance().player;
			if (p == null) return 0;
			var inv = p.getInventory();
			int n = 0;
			for (int i = 0; i < inv.getContainerSize(); i++) {
				ItemStack s = inv.getItem(i);
				for (Item it : items) if (s.is(it)) n += s.getCount();
			}
			return n;
		}

		private List<Row> rows(boolean preview) {
			List<Row> out = new ArrayList<>();
			if (arrows.on()) out.add(new Row(Items.ARROW, preview ? 64 : count(Items.ARROW, Items.SPECTRAL_ARROW, Items.TIPPED_ARROW), "64"));
			if (pearls.on()) out.add(new Row(Items.ENDER_PEARL, preview ? 16 : count(Items.ENDER_PEARL), "16"));
			if (apples.on()) out.add(new Row(Items.GOLDEN_APPLE, preview ? 12 : count(Items.GOLDEN_APPLE, Items.ENCHANTED_GOLDEN_APPLE), "12"));
			if (totems.on()) out.add(new Row(Items.TOTEM_OF_UNDYING, preview ? 2 : count(Items.TOTEM_OF_UNDYING), "2"));
			if (!preview && hideEmpty.on()) out.removeIf(r -> r.count == 0);
			return out;
		}

		@Override public void tick() { cached = rows(false); }

		@Override public boolean visible(boolean preview) { return preview || !cached.isEmpty(); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			var font = Minecraft.getInstance().font;
			List<Row> list = preview ? rows(true) : cached;
			boolean items = Minecraft.getInstance().level != null;
			int tw = 0;
			for (Row r : list) tw = Math.max(tw, font.width(String.valueOf(r.count)));
			w = 22 + tw + 6;
			h = list.size() * 18 + 2;
			if (background.on()) Theme.hudBox(g, 0, 0, w, h);
			for (int i = 0; i < list.size(); i++) {
				Row r = list.get(i);
				int y = 1 + i * 18;
				// Dünya yüklenmeden eşya oluşturulamaz; menüdeki önizlemede piksel simge çizilir.
				if (items) g.fakeItem(new ItemStack(r.icon), 3, y);
				else PixelIcons.draw(g, "bag", 6, y + 4, 1, 0xFF7DD3FC);
				g.text(font, String.valueOf(r.count), 22, y + 5, r.count == 0 ? 0xFFFF6B6B : color.get(), true);
			}
		}
	}

	/** Baktığın blok veya varlık: ad, simge, konum ve can. */
	public static final class TargetInfo extends HudModule {
		public final BoolSetting blocks = add(new BoolSetting("blocks", "setting.showBlocks", true));
		public final BoolSetting entities = add(new BoolSetting("entities", "setting.showEntities", true));
		public final BoolSetting coords = add(new BoolSetting("coords", "setting.showCoords", true));

		public TargetInfo() { super("target", Category.HUD, "eye", false, 0.5, 0.12); }

		private record Info(String name, String detail, ItemStack icon, float health) {}

		private Info cached;

		private Info info(boolean preview) {
			Minecraft mc = Minecraft.getInstance();
			if (preview) return new Info(L.t("hud.targetSample"), "128, 12, -340", null, -1);
			if (mc.level == null || mc.hitResult == null) return null;
			if (blocks.on() && mc.hitResult instanceof BlockHitResult b && mc.hitResult.getType() == net.minecraft.world.phys.HitResult.Type.BLOCK) {
				BlockState s = mc.level.getBlockState(b.getBlockPos());
				if (s.isAir()) return null;
				var pos = b.getBlockPos();
				Item item = s.getBlock().asItem();
				return new Info(s.getBlock().getName().getString(), coords.on() ? pos.getX() + ", " + pos.getY() + ", " + pos.getZ() : null,
					item == Items.AIR ? null : new ItemStack(item), -1);
			}
			if (entities.on() && mc.hitResult instanceof EntityHitResult e) {
				var ent = e.getEntity();
				float hp = ent instanceof LivingEntity l ? l.getHealth() : -1;
				String detail = ent instanceof LivingEntity l
					? String.format(Locale.ROOT, "%.1f / %.0f", l.getHealth(), l.getMaxHealth()) : null;
				return new Info(ent.getDisplayName().getString(), detail, null, hp);
			}
			return null;
		}

		@Override public void tick() { cached = info(false); }

		@Override public boolean visible(boolean preview) { return preview || cached != null; }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
			var font = Minecraft.getInstance().font;
			Info i = preview ? info(true) : cached;
			if (i == null) return;
			int tx = i.icon != null ? 24 : 6;
			w = tx + Math.max(font.width(i.name), i.detail == null ? 0 : font.width(i.detail) + (i.health >= 0 ? 10 : 0)) + 6;
			h = i.detail == null ? 18 : 26;
			if (background.on()) Theme.hudBox(g, 0, 0, w, h);
			if (i.icon != null) g.fakeItem(i.icon, 4, (h - 16) / 2);
			g.text(font, i.name, tx, 4, color.get(), true);
			if (i.detail != null) {
				int dx = tx;
				if (i.health >= 0) {
					g.text(font, "♥", dx, 14, 0xFFFF4D5E, true);
					dx += 10;
				}
				g.text(font, i.detail, dx, 14, 0xFFAEB3BF, true);
			}
		}
	}

	/** Etkin kaynak paketlerinin adları. */
	public static final class Packs extends HudModule {
		private static final int REFRESH_TICKS = 20;
		public final SliderSetting max = add(new SliderSetting("max", "setting.maxRows", 4, 1, 8, 1, "%.0f"));
		private List<String> cached = List.of();
		private int timer = REFRESH_TICKS;

		public Packs() { super("packs", Category.HUD, "layers", false, 0.004, 0.40); }

		private List<String> names(boolean preview) {
			if (preview) return List.of("PClient PvP 16x", "Faithful 32x");
			List<String> out = new ArrayList<>();
			for (Pack p : Minecraft.getInstance().getResourcePackRepository().getSelectedPacks()) {
				String id = p.getId();
				if (id.equals("vanilla") || id.startsWith("fabric") || id.equals("high_contrast") || id.startsWith("minecraft:")) continue;
				out.add(0, p.getTitle().getString());
			}
			return out.subList(0, Math.min(out.size(), (int) Math.round(max.get())));
		}

		@Override public void tick() {
			if (++timer < REFRESH_TICKS) return;
			timer = 0;
			cached = names(false);
		}

		@Override public boolean visible(boolean preview) { return preview || !cached.isEmpty(); }

		@Override protected void draw(GuiGraphicsExtractor g, boolean preview) { linesBox(g, preview ? names(true) : cached); }
	}
}
