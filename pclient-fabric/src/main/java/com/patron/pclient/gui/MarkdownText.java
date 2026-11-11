package com.patron.pclient.gui;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** Modrinth proje açıklamalarını (Markdown ve HTML karışımı) oyunda gösterilecek düz metin bloklarına çevirir. */
final class MarkdownText {
	enum Kind { HEADING, PARAGRAPH, BULLET, RULE }

	record Block(Kind kind, String text) {}

	private static final int MAX_CHARS = 60_000;
	private static final int FLAGS = Pattern.CASE_INSENSITIVE | Pattern.DOTALL;
	private static final Pattern DROPPED = Pattern.compile("<(iframe|script|style)\\b.*?</\\1\\s*>|<!--.*?-->", FLAGS);
	private static final Pattern BREAK = Pattern.compile("<br\\s*/?>|</p\\s*>|</div\\s*>|</h[1-6]\\s*>|</ul\\s*>|</ol\\s*>|<center\\s*>|</center\\s*>", FLAGS);
	private static final Pattern RULE_TAG = Pattern.compile("<hr\\s*/?>", FLAGS);
	private static final Pattern HEADING_TAG = Pattern.compile("<h[1-6]\\b[^>]*>", FLAGS);
	private static final Pattern LIST_TAG = Pattern.compile("<li\\b[^>]*>", FLAGS);
	private static final Pattern ANY_TAG = Pattern.compile("</?[a-zA-Z][^>]*>");
	private static final Pattern IMAGE = Pattern.compile("!\\[[^\\]]*]\\([^)]*\\)");
	private static final Pattern EMPTY_LINK = Pattern.compile("\\[\\s*]\\([^)]*\\)");
	private static final Pattern LINK = Pattern.compile("\\[([^\\]]*)]\\([^)]*\\)");
	private static final Pattern EMPHASIS = Pattern.compile("\\*\\*|__|~~|`");
	private static final Pattern SINGLE_STAR = Pattern.compile("(?<![\\w*])\\*(?=\\S)|(?<=\\S)\\*(?![\\w*])");
	// Oyun yazı tipinde karşılığı olmayan emoji ve simgeler ile biçim kodları kaldırılır.
	private static final Pattern UNDRAWABLE = Pattern.compile("[^\\p{L}\\p{M}\\p{N}\\p{P}\\p{Zs}\\p{Sm}\\p{Sc}\\n]|§");
	private static final Pattern TABLE_RULE = Pattern.compile("^\\|?[\\s:|-]+\\|?$");
	private static final Pattern BULLET = Pattern.compile("^\\s*(?:[-*+]|\\d+[.)])\\s+(.*)$");
	private static final Pattern HEADING = Pattern.compile("^#{1,6}\\s+(.*?)\\s*#*$");
	private static final Pattern RULE = Pattern.compile("^\\s*(?:-{3,}|\\*{3,}|_{3,})\\s*$");

	private MarkdownText() {}

	static List<Block> parse(String source) {
		String text = source.length() > MAX_CHARS ? source.substring(0, MAX_CHARS) : source;
		text = text.replace("\r", "");
		text = DROPPED.matcher(text).replaceAll("");
		text = RULE_TAG.matcher(text).replaceAll("\n---\n");
		text = HEADING_TAG.matcher(text).replaceAll("\n# ");
		text = LIST_TAG.matcher(text).replaceAll("\n- ");
		text = BREAK.matcher(text).replaceAll("\n\n");
		text = IMAGE.matcher(text).replaceAll("");
		text = ANY_TAG.matcher(text).replaceAll("");
		text = EMPTY_LINK.matcher(text).replaceAll("");
		text = LINK.matcher(text).replaceAll("$1");
		text = text.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
		text = UNDRAWABLE.matcher(text).replaceAll("");

		List<Block> out = new ArrayList<>();
		StringBuilder paragraph = new StringBuilder();
		boolean code = false;
		for (String raw : text.split("\n", -1)) {
			String line = raw.strip();
			if (line.startsWith("```")) {
				code = !code;
				flush(paragraph, out);
				continue;
			}
			if (code) {
				if (!line.isEmpty()) out.add(new Block(Kind.PARAGRAPH, line));
				continue;
			}
			if (line.isEmpty()) {
				flush(paragraph, out);
				continue;
			}
			if (RULE.matcher(line).matches()) {
				flush(paragraph, out);
				out.add(new Block(Kind.RULE, ""));
				continue;
			}
			if (line.startsWith("|")) {
				flush(paragraph, out);
				if (!TABLE_RULE.matcher(line).matches()) add(out, Kind.PARAGRAPH, String.join("  ·  ", tableCells(line)));
				continue;
			}
			var heading = HEADING.matcher(line);
			if (heading.matches()) {
				flush(paragraph, out);
				add(out, Kind.HEADING, heading.group(1));
				continue;
			}
			var bullet = BULLET.matcher(raw);
			if (bullet.matches()) {
				flush(paragraph, out);
				add(out, Kind.BULLET, bullet.group(1));
				continue;
			}
			if (line.startsWith(">")) line = line.substring(1).strip();
			if (paragraph.length() > 0) paragraph.append(' ');
			paragraph.append(line);
		}
		flush(paragraph, out);
		return out;
	}

	private static List<String> tableCells(String line) {
		List<String> cells = new ArrayList<>();
		for (String cell : line.split("\\|")) if (!cell.isBlank()) cells.add(cell.strip());
		return cells;
	}

	private static void flush(StringBuilder paragraph, List<Block> out) {
		if (paragraph.length() > 0) add(out, Kind.PARAGRAPH, paragraph.toString());
		paragraph.setLength(0);
	}

	private static void add(List<Block> out, Kind kind, String text) {
		String clean = SINGLE_STAR.matcher(EMPHASIS.matcher(text).replaceAll("")).replaceAll("").strip();
		if (!clean.isEmpty()) out.add(new Block(kind, clean));
	}
}
