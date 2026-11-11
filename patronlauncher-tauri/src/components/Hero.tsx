import { locale, t } from "../i18n";
import { useEffect, useRef, type ReactNode } from "react";
export type Parallax = { tx: number; ty: number; mx: number; my: number };
/** Saniyede hedefe yaklaşma hızı; büyük değer daha çabuk oturur. */
const EASE = 7;
export default function Hero({
  name,
  parallax,
  welcome,
  loader = "Vanilla",
  children,
}: {
  name: string;
  welcome: string;
  loader?: string;
  parallax: React.RefObject<Parallax>;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null),
    frame = useRef(0),
    last = useRef(0);
  // Fare değerleri doğrudan uygulanmaz: tx/ty hedeftir, mx/my her karede ona
  // üstel olarak yaklaşır. Hızlı giriş-çıkışta titreme yerine yumuşak oturma olur.
  const step = (time: number) => {
    const p = parallax.current,
      node = ref.current;
    const dt = Math.min((time - (last.current || time)) / 1000, 0.05);
    last.current = time;
    const k = 1 - Math.exp(-EASE * dt);
    p.mx += (p.tx - p.mx) * k;
    p.my += (p.ty - p.my) * k;
    const done = Math.abs(p.tx - p.mx) < 0.001 && Math.abs(p.ty - p.my) < 0.001;
    if (done) {
      p.mx = p.tx;
      p.my = p.ty;
    }
    node?.style.setProperty("--mx", p.mx.toFixed(4));
    node?.style.setProperty("--my", p.my.toFixed(4));
    frame.current = done || !node ? 0 : requestAnimationFrame(step);
  };
  const kick = () => {
    if (frame.current) return;
    last.current = 0;
    frame.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <section
      className="hero"
      id="hero"
      ref={ref}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        parallax.current.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
        parallax.current.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
        kick();
      }}
      onMouseLeave={() => {
        parallax.current.tx = parallax.current.ty = 0;
        kick();
      }}
    >
      <div className="layer moon-l">
        <div className="moon" />
      </div>
      <div className="sky" />
      <div className="cube c1" />
      <div className="cube c2" />
      <div className="txt">
        <div className="hero-badges">
          <span className="bd">MINECRAFT JAVA EDITION</span>
          <span className="bd m" title={loader}>
            {loader.toLocaleUpperCase(locale())}
          </span>
        </div>
        <div className="lbl" style={{ marginTop: 14 }}>
          {welcome}
        </div>
        <h2>{name}</h2>
        <p>{t("Dünyana kaldığın yerden devam et.")}</p>
      </div>
      <div className="hero-stage">{children}</div>
    </section>
  );
}
