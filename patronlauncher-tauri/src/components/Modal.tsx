import { t } from "../i18n";
import { useEffect, useRef, type ReactNode } from "react";
export default function Modal({
  title,
  close,
  children,
  locked = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="profile-modal v-mod-consent"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) close();
      }}
    >
      <div className="actions modal-heading">
        <h2>{title}</h2>
        <button
          className="btn"
          type="button"
          aria-label={t("Pencereyi kapat")}
          disabled={locked}
          onClick={close}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
