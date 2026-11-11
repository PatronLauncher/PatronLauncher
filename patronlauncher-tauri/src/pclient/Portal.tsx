import logo from "../assets/patronlauncher3transparent-mark.png";
import type { CSSProperties } from "react";
/**
 * Arayüz geçiş perdesi. Tıklanan noktadan açılan bir halka ekranı kaplar,
 * logo ve hedef dünyanın adı belirir; perde kapalıyken arayüz değişir.
 * Yalnızca görseldir; ekran okuyuculara gösterilmez.
 */
export default function Portal({
  to,
  x,
  y,
}: {
  to: "launcher" | "pclient";
  x: number;
  y: number;
}) {
  return (
    <div
      className="ui-portal"
      data-to={to}
      aria-hidden="true"
      style={{ "--ox": `${x}px`, "--oy": `${y}px` } as CSSProperties}
    >
      <div className="ui-portal-floor" />
      <div className="ui-portal-beam" />
      <div className="ui-portal-core">
        <img src={logo} alt="" />
        <strong>
          {to === "pclient" ? (
            <>
              P<span>CLIENT</span>
            </>
          ) : (
            <>
              PATRON<span>LAUNCHER</span>
            </>
          )}
        </strong>
        <i className="ui-portal-track" />
      </div>
      <div className="ui-portal-slices">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
