import { t } from "../i18n";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
export function Toggle(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type="checkbox"
      className={"ui-toggle " + (props.className ?? "")}
    />
  );
}
type Props = SelectHTMLAttributes<HTMLSelectElement> & { icon?: ReactNode };
function text(n: ReactNode): string {
  return Children.toArray(n)
    .map((x) =>
      isValidElement<{ children?: ReactNode }>(x)
        ? text(x.props.children)
        : String(x),
    )
    .join("");
}
export function Select({
  children,
  value,
  defaultValue,
  onChange,
  id,
  icon,
  ...props
}: Props) {
  const uid = useId(),
    button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [position, setPosition] = useState({
      top: 0,
      left: 0,
      width: 200,
      height: 300,
    }),
    [internal, setInternal] = useState(defaultValue ?? "");
  const options: {
    value: string;
    label: string;
    disabled: boolean;
    icon?: string;
  }[] = [];
  const visit = (nodes: ReactNode, disabled = false) =>
    Children.forEach(nodes, (n) => {
      if (!isValidElement<any>(n)) return;
      if (n.type === "option")
        options.push({
          value: String(
            (n as any).props.value ?? text((n as any).props.children),
          ),
          label: text((n as any).props.children),
          disabled: disabled || !!(n as any).props.disabled,
          icon: (n as any).props["data-icon"],
        });
      else if ((n as any).props.children)
        visit(
          (n as any).props.children,
          disabled || !!(n as any).props.disabled,
        );
    });
  visit(children);
  const current = String(value ?? internal),
    chosen = options.find((o) => o.value === current),
    filtered = options.filter((o) =>
      o.label.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")),
    ),
    long = options.length > 8;
  function place() {
    const r = button.current!.getBoundingClientRect(),
      height = Math.min(360, Math.max(180, innerHeight - 32)),
      width = Math.min(Math.max(r.width, 240), innerWidth - 24),
      below = innerHeight - r.bottom - 12,
      above = r.top - 12;
    setPosition({
      top:
        below >= Math.min(height, 220)
          ? r.bottom + 6
          : Math.max(8, r.top - Math.min(height, above) - 6),
      left: Math.min(Math.max(8, r.left), innerWidth - width - 8),
      width,
      height: Math.min(height, Math.max(below, above)),
    });
  }
  const show = () => {
    if (props.disabled) return;
    place();
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === current),
      ),
    );
    setOpen(true);
  };
  const choose = (v: string) => {
    setInternal(v);
    onChange?.({
      target: { value: v },
      currentTarget: { value: v },
    } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const click = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !button.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const resize = () => place();
    document.addEventListener("pointerdown", click);
    addEventListener("resize", resize);
    addEventListener("scroll", resize, true);
    menu.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      document.removeEventListener("pointerdown", click);
      removeEventListener("resize", resize);
      removeEventListener("scroll", resize, true);
    };
  }, [open]);
  useEffect(() => {
    menu.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const keys = (e: React.KeyboardEvent) => {
    if (
      [
        "ArrowDown",
        "ArrowUp",
        "Enter",
        " ",
        "Escape",
        "Tab",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      if (e.key === "Tab") {
        setOpen(false);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (!open) {
        if (e.key === " " || e.key === "Enter" || e.key.startsWith("Arrow")) {
          e.preventDefault();
          show();
        }
        return;
      }
      if (e.key === "Enter" || (e.key === " " && e.target === button.current)) {
        e.preventDefault();
        if (filtered[active] && !filtered[active].disabled)
          choose(filtered[active].value);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        let next = active;
        for (let i = 0; i < filtered.length; i++) {
          next =
            (next + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) %
            filtered.length;
          if (!filtered[next].disabled) break;
        }
        setActive(next);
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        setActive(e.key === "Home" ? 0 : filtered.length - 1);
      }
    }
  };
  return (
    <span className={"ui-select-wrap " + (props.className ?? "")}>
      <button
        type="button"
        ref={button}
        id={id}
        className="ui-select"
        disabled={props.disabled}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-expanded={open}
        aria-controls={uid}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        role="combobox"
        title={props.title}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={keys}
      >
        <span className="ui-select-icon">{icon ?? (chosen?.icon ? <img src={chosen.icon} alt=""/> : '◇')}</span>
        <span>{chosen?.label ?? options[0]?.label ?? t("Seç")}</span>
        <i>⌄</i>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="ui-select-portal"
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.height,
            }}
            onKeyDown={keys}
          >
            {long && (
              <input
                className="field"
                placeholder={t("Listede ara…")}
                aria-label={t("Seçeneklerde ara")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
              />
            )}
            <div
              role="listbox"
              id={uid}
              aria-label={props["aria-label"] ?? t("Seçenekler")}
            >
              {filtered.map((o, i) => (
                <div
                  role="option"
                  aria-selected={o.value === current}
                  aria-disabled={o.disabled}
                  id={`${uid}-${i}`}
                  data-index={i}
                  key={o.value + "-" + i}
                  className={i === active ? "highlight" : ""}
                  onPointerMove={() => setActive(i)}
                  onClick={() => {
                    if (!o.disabled) choose(o.value);
                  }}
                >
                  {o.icon && <img src={o.icon} alt="" />}
                  <span>{o.label}</span>
                  {o.value === current && <b>✓</b>}
                </div>
              ))}
            </div>
            {!filtered.length && <p>{t("Sonuç bulunamadı.")}</p>}
          </div>,
          button.current?.closest("dialog") ?? document.body,
        )}
    </span>
  );
}
