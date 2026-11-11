import { t } from "../i18n";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { modLink } from "../mods";
import ModImage, { allowedImage } from "./ModImage";
const schema = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter(
    (t) =>
      ![
        "iframe",
        "style",
        "script",
        "svg",
        "math",
        "form",
        "input",
        "video",
        "audio",
      ].includes(t),
  ),
  strip: [
    ...(defaultSchema.strip ?? []),
    "script",
    "style",
    "iframe",
    "svg",
    "math",
    "form",
    "object",
    "embed",
    "video",
    "audio",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": ["title"],
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    td: ["align"],
    th: ["align"],
    code: ["className"],
  },
  protocols: { ...defaultSchema.protocols, href: ["https"], src: ["https"] },
};
function videoLinks() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node.children) return;
      node.children = node.children.map((child: any) => {
        if (
          child.type === "element" &&
          ["iframe", "video"].includes(child.tagName)
        ) {
          const src = child.properties?.src;
          try {
            const u = new URL(String(src));
            if (
              [
                "www.youtube.com",
                "youtube.com",
                "www.youtube-nocookie.com",
                "youtu.be",
                "player.vimeo.com",
              ].includes(u.hostname) &&
              u.protocol === "https:" &&
              !u.username &&
              !u.password &&
              !u.port
            ) {
              let href = u.href;
              if (u.pathname.startsWith("/embed/"))
                href =
                  "https://www.youtube.com/watch?v=" +
                  encodeURIComponent(u.pathname.split("/")[2]);
              if (u.hostname === "player.vimeo.com")
                href = "https://vimeo.com/" + u.pathname.split("/").at(-1);
              return {
                type: "element",
                tagName: "a",
                properties: { href },
                children: [{ type: "text", value: t("Videoyu aç") }],
              };
            }
          } catch {}
          return { type: "text", value: "" };
        }
        walk(child);
        return child;
      });
    };
    walk(tree);
  };
}
export default function ModContent({
  text,
  open,
  enlarge,
}: {
  text: string;
  open: (url: string) => void;
  enlarge?: (src: string, alt: string) => void;
}) {
  return (
    <div className="mod-content rich-content">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, videoLinks, [rehypeSanitize, schema]]}
        urlTransform={(url, key) =>
          key === "src" ? (allowedImage(url) ? url : "") : (modLink(url) ?? "")
        }
        components={{
          a: ({ href, children }) =>
            href && modLink(href) ? (
              <button className="mod-link" onClick={() => open(href)}>
                {children} ↗
              </button>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) => (
            <ModImage src={src} alt={alt} enlarge={enlarge} />
          ),
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
