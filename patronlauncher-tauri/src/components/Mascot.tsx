import { useRef, useState } from "react";

/**
 * Sunucu panelinin üstünde dolaşan küçük kırmızı maskot ("Pıtırcık").
 * Tüm hareketler CSS ile yapılır; azaltılmış hareket ve data-motion="off"
 * iken genel kurallar animasyonları durdurur ve maskot solda sabit durur.
 */
export default function Mascot() {
  const [poke, setPoke] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <div className="mascot-lane" aria-hidden="true">
      <div className="mascot-walker">
        <div
          className={"mascot " + (poke ? "poke" : "")}
          key={poke}
          onClick={() => {
            clearTimeout(timer.current);
            setPoke((n) => n + 1);
            timer.current = setTimeout(() => setPoke(0), 800);
          }}
        >
          <svg viewBox="0 0 32 32" className="mascot-svg">
            <defs>
              <linearGradient id="mascot-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ff6b78" />
                <stop offset="1" stopColor="#d81f3a" />
              </linearGradient>
            </defs>
            <g className="mascot-antenna">
              <path d="M16 9V4.5" stroke="#d81f3a" strokeWidth="1.6" strokeLinecap="round" />
              <circle className="mascot-spark" cx="16" cy="3.6" r="2.1" fill="#ffd166" />
            </g>
            <rect className="mascot-foot l" x="9" y="25.5" width="4.5" height="3.5" rx="1.2" fill="#a8132a" />
            <rect className="mascot-foot r" x="18.5" y="25.5" width="4.5" height="3.5" rx="1.2" fill="#a8132a" />
            <rect x="4" y="8.5" width="24" height="19" rx="7" fill="url(#mascot-body)" />
            <rect x="7.5" y="11" width="6" height="2.4" rx="1.2" fill="#fff" opacity=".35" />
            <g className="mascot-eyes">
              <rect className="mascot-eye" x="10.5" y="15" width="3.4" height="5" rx="1" fill="#2a0710" />
              <rect className="mascot-eye" x="18.1" y="15" width="3.4" height="5" rx="1" fill="#2a0710" />
              <rect x="11.2" y="15.6" width="1.2" height="1.4" fill="#fff" />
              <rect x="18.8" y="15.6" width="1.2" height="1.4" fill="#fff" />
            </g>
            <ellipse cx="8.6" cy="21.4" rx="1.8" ry="1.1" fill="#ff9aa6" opacity=".7" />
            <ellipse cx="23.4" cy="21.4" rx="1.8" ry="1.1" fill="#ff9aa6" opacity=".7" />
            <path className="mascot-mouth" d="M14.4 22.2q1.6 1.4 3.2 0" stroke="#2a0710" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
