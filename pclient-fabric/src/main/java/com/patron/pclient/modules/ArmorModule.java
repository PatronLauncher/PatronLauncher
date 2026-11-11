package com.patron.pclient.modules;

import com.patron.pclient.module.Category;
import com.patron.pclient.module.HudModule;
import com.patron.pclient.module.setting.BoolSetting;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** Zırh parçaları ve eldeki eşya; dayanıklılık sayı veya yüzde olarak. */
public final class ArmorModule extends HudModule {
	private static final EquipmentSlot[] SLOTS = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};
	public final BoolSetting mainHand = add(new BoolSetting("mainHand", "setting.mainHand", true));
	public final BoolSetting percent = add(new BoolSetting("percent", "setting.percent", false));

	public ArmorModule() { super("armor", Category.HUD, "armor", true, 0.996, 0.97); }

	private List<ItemStack> stacks(boolean preview) {
		List<ItemStack> out = new ArrayList<>();
		if (preview) {
			if (mainHand.on()) out.add(new ItemStack(Items.NETHERITE_SWORD));
			out.add(new ItemStack(Items.DIAMOND_HELMET));
			out.add(new ItemStack(Items.DIAMOND_CHESTPLATE));
			out.add(new ItemStack(Items.DIAMOND_LEGGINGS));
			out.add(new ItemStack(Items.DIAMOND_BOOTS));
			return out;
		}
		var p = Minecraft.getInstance().player;
		if (p == null) return out;
		if (mainHand.on() && !p.getMainHandItem().isEmpty()) out.add(p.getMainHandItem());
		for (EquipmentSlot s : SLOTS) if (!p.getItemBySlot(s).isEmpty()) out.add(p.getItemBySlot(s));
		return out;
	}

	@Override public boolean visible(boolean preview) { return worldless(preview) || !stacks(preview).isEmpty(); }

	/** Dünya yüklenmeden eşya oluşturulamaz (bileşenler bağlı değil); önizleme simgeyle çizilir. */
	private static boolean worldless(boolean preview) { return preview && Minecraft.getInstance().level == null; }

	private static final String[] SAMPLE = {"1561", "363", "528", "495", "429"};

	private String label(ItemStack s) {
		if (s.isDamageableItem()) {
			int left = s.getMaxDamage() - s.getDamageValue();
			return percent.on() ? Math.round(left * 100f / s.getMaxDamage()) + "%" : String.valueOf(left);
		}
		return s.getCount() > 1 ? String.valueOf(s.getCount()) : "";
	}

	private int labelColor(ItemStack s) {
		if (!s.isDamageableItem()) return color.get();
		float f = (s.getMaxDamage() - s.getDamageValue()) / (float) s.getMaxDamage();
		return f > 0.5f ? color.get() : f > 0.2f ? 0xFFFFD43B : 0xFFFF2A3D;
	}

	@Override protected void draw(GuiGraphicsExtractor g, boolean preview) {
		var font = Minecraft.getInstance().font;
		if (worldless(preview)) {
			int n = mainHand.on() ? 5 : 4;
			w = 16 + 4 + font.width("1561") + 6;
			h = n * 18 + 2;
			if (background.on()) com.patron.pclient.gui.Theme.hudBox(g, 0, 0, w, h);
			for (int i = 0; i < n; i++) {
				int y = 1 + i * 18;
				com.patron.pclient.gui.PixelIcons.draw(g, i == 0 && n == 5 ? "speed" : "armor", 4, y + 3, 1, 0xFF7DD3FC);
				g.text(font, SAMPLE[i + 5 - n], 22, y + 5, color.get(), true);
			}
			return;
		}
		List<ItemStack> list = stacks(preview);
		int textW = 0;
		for (ItemStack s : list) textW = Math.max(textW, font.width(label(s)));
		w = 16 + 4 + textW + 6;
		h = list.size() * 18 + 2;
		if (background.on()) com.patron.pclient.gui.Theme.hudBox(g, 0, 0, w, h);
		for (int i = 0; i < list.size(); i++) {
			ItemStack s = list.get(i);
			int y = 1 + i * 18;
			g.fakeItem(s, 3, y);
			g.text(font, label(s), 22, y + 5, labelColor(s), true);
		}
	}
}
