import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "../i18n";
import Icon from "./Icon";
import { MusicToggle } from "./MusicPlayer";
import { useAppearance } from "../appearance";
export default function TitleBar({
  onError,
}: {
  onError: (m: string) => void;
}) {
  const { prefs } = useAppearance();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        void getCurrentWindow()
          .isFullscreen()
          .then((full) => getCurrentWindow().setFullscreen(!full))
          .catch(() => onError(t("Tam ekran değiştirilemedi.")));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onError]);
  const act = async (a: "minimize" | "toggleMaximize" | "close") => {
    try {
      await getCurrentWindow()[a]();
    } catch {
      onError(t("Pencere işlemi tamamlanamadı."));
    }
  };
  return (
    <div
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("button"))
          void act("toggleMaximize");
      }}
    >
      <span data-tauri-drag-region>
        {prefs.ui_mode === "pclient" ? "PClient · PatronLauncher" : "PatronLauncher"}
      </span>
      <div className="titlebar-tools">
        <MusicToggle />
      </div>
      {/* Soldan sağa: küçült, büyüt, kapat. */}
      <div className="window-controls">
        <button
          className="window-minimize"
          aria-label={t("Küçült")}
          title={t("Küçült")}
          onClick={() => void act("minimize")}
        >
          <Icon name="minimize" />
        </button>
        <button
          className="window-maximize"
          aria-label={t("Büyüt veya geri yükle")}
          title={t("Büyüt veya geri yükle")}
          onClick={() => void act("toggleMaximize")}
        >
          <Icon name="maximize" />
        </button>
        <button
          className="window-close"
          aria-label={t("Kapat")}
          title={t("Kapat")}
          onClick={() => void act("close")}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
