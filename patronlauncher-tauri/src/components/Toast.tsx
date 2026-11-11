import { t } from "../i18n";
import Icon from "./Icon";

export default function Toast({
  message,
  visible,
  close,
}: {
  message: string;
  visible: boolean;
  close: () => void;
}) {
  return (
    <div id="toast" className={visible ? "show" : ""} role="status">
      {message && (
        <>
          <span className="dot" />
          {message}
          {visible && (
            <button className="alert-close" aria-label={t("Kapat")} title={t("Kapat")} onClick={close}>
              <Icon name="close" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
