package com.patron.pclient.gui;

import com.patron.pclient.L;
import com.patron.pclient.modules.SoonModule;
import java.util.List;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/**
 * Geliştirme aşamasındaki özelliklerin tanıtım sayfası. Görseller "Önizleme" olarak etiketlidir;
 * özellik hazır olana kadar hiçbir şey çalışıyormuş gibi gösterilmez.
 */
public final class ComingSoonScreen extends PcScreen {
	private final SoonModule module;

	public ComingSoonScreen(SoonModule module, Screen parent) {
		super("title.soon", parent);
		this.module = module;
	}

	@Override protected String dock() { return module.id; }

	@Override protected void draw(GuiGraphicsExtractor g, int mx, int my) {
		boolean wide = module.id.equals("music") || module.id.equals("schematics");
		int pw = Math.min(width - 24, wide ? 440 : 320), avail = height - 46 - 8, ph = Math.min(avail - 8, 250);
		int px = (width - pw) / 2, py = 8 + Math.max(0, (avail - ph) / 2);
		panel(g, px, py, px + pw, py + ph);
		iconButton(g, px + 10, py + 10, 18, "back", this::onClose);
		String tag = L.up("soon.tag");
		int tagW = Theme.spacedWidth(tag, 2) + 14;
		Theme.notched(g, px + pw - 12 - tagW, py + 12, px + pw - 12, py + 26, 3, Theme.withAlpha(Theme.accent(), 0x30));
		Theme.notchedOutline(g, px + pw - 12 - tagW, py + 12, px + pw - 12, py + 26, 3, Theme.accent());
		Theme.spaced(g, tag, px + pw - 5 - tagW, py + 15, Theme.accent(), 2);

		int colW = wide ? pw / 2 - 10 : pw - 36, x = px + 18, y = py + 38;
		Theme.notched(g, x, y, x + 34, y + 34, 5, Theme.withAlpha(Theme.accent(), 0x26));
		PixelIcons.drawCentered(g, module.icon, x + 17, y + 17, 2, Theme.accent());
		Theme.scaledText(g, L.t(module.nameKey()), x + 42, y + 4, 1.5f, Theme.TEXT, false);
		g.text(font, L.t("soon.subtitle"), x + 42, y + 21, Theme.MUTED, false);
		y += 44;
		for (FormattedCharSequence l : font.split(FormattedText.of(L.t(module.descKey())), colW)) {
			g.text(font, l, x, y, Theme.MUTED, false);
			y += 10;
		}
		y += 6;
		for (int i = 1; i <= 5; i++) {
			String key = "pclient.module." + module.id + ".f" + i;
			if (!net.minecraft.locale.Language.getInstance().has(key)) break;
			g.fill(x, y + 3, x + 3, y + 6, Theme.accent());
			List<FormattedCharSequence> lines = font.split(FormattedText.of(I18n.get(key)), colW - 10);
			for (FormattedCharSequence l : lines) {
				g.text(font, l, x + 9, y, Theme.TEXT, false);
				y += 10;
			}
			y += 3;
		}
		String noteKey = "pclient.module." + module.id + ".note";
		if (net.minecraft.locale.Language.getInstance().has(noteKey)) {
			int ny = py + ph - 12 - font.split(FormattedText.of(I18n.get(noteKey)), pw - 36).size() * 10;
			if (ny > y + 4) for (FormattedCharSequence l : font.split(FormattedText.of(I18n.get(noteKey)), pw - 36)) {
				g.text(font, l, x, ny, Theme.FAINT, false);
				ny += 10;
			}
		}
		if (module.id.equals("music")) musicPreview(g, px + pw / 2 + 8, py + 44, pw / 2 - 26);
		if (module.id.equals("schematics")) buildsPreview(g, px + pw / 2 + 8, py + 44, pw / 2 - 26);
	}

	/** Oyun içi müzik çalarının nasıl görüneceğine dair örnek. */
	private void musicPreview(GuiGraphicsExtractor g, int x, int y, int w) {
		Theme.spaced(g, L.up("soon.preview"), x, y, Theme.FAINT, 2);
		y += 14;
		Theme.notched(g, x, y, x + w, y + 78, 5, 0x1AFFFFFF);
		Theme.notched(g, x + 8, y + 8, x + 44, y + 44, 4, Theme.withAlpha(Theme.accent(), 0x55));
		PixelIcons.drawCentered(g, "music", x + 26, y + 26, 2, Theme.TEXT);
		g.text(font, Theme.ellipsize(L.t("soon.music.track"), w - 60), x + 52, y + 12, Theme.TEXT, false);
		g.text(font, Theme.ellipsize(L.t("soon.music.artist"), w - 60), x + 52, y + 24, Theme.MUTED, false);
		int bx1 = x + 8, bx2 = x + w - 8, by = y + 54;
		float p = (float) ((System.nanoTime() / 1e9 / 30) % 1);
		g.fill(bx1, by, bx2, by + 2, Theme.OFF_HOVER);
		g.fill(bx1, by, bx1 + (int) ((bx2 - bx1) * p), by + 2, Theme.accent());
		int cx = x + w / 2;
		PixelIcons.drawCentered(g, "prev", cx - 22, by + 13, 1, Theme.MUTED);
		PixelIcons.drawCentered(g, "pause", cx, by + 13, 1, Theme.TEXT);
		PixelIcons.drawCentered(g, "next", cx + 22, by + 13, 1, Theme.MUTED);
	}

	/** Yapı kataloğunun nasıl görüneceğine dair örnek kartlar. */
	private void buildsPreview(GuiGraphicsExtractor g, int x, int y, int w) {
		Theme.spaced(g, L.up("soon.preview"), x, y, Theme.FAINT, 2);
		y += 14;
		boolean world = minecraft.level != null; // Dünya yokken eşya bileşenleri hazır değildir; simge kullanılır.
		ItemStack[] blocks = world ? new ItemStack[] {new ItemStack(Items.QUARTZ_BLOCK), new ItemStack(Items.STONE_BRICKS), new ItemStack(Items.CHERRY_PLANKS), new ItemStack(Items.OAK_LOG)} : null;
		int cw = (w - 6) / 2, ch = 52;
		for (int i = 0; i < 4; i++) {
			int cx = x + i % 2 * (cw + 6), cy = y + i / 2 * (ch + 6);
			Theme.notched(g, cx, cy, cx + cw, cy + ch, 4, 0x1AFFFFFF);
			g.pose().pushMatrix();
			g.pose().translate(cx + cw / 2f - 12, cy + 4);
			g.pose().scale(1.5f, 1.5f);
			if (blocks != null) g.fakeItem(blocks[i], 0, 0);
			else PixelIcons.draw(g, "house", 3, 3, 1, Theme.MUTED);
			g.pose().popMatrix();
			g.centeredText(font, Theme.ellipsize(L.t("soon.build" + (i + 1)), cw - 8), cx + cw / 2, cy + 32, Theme.TEXT);
			Theme.scaledText(g, L.t("soon.blocks", 1200 + i * 850), cx + 6, cy + 43, 0.75f, Theme.FAINT, false);
		}
	}
}
