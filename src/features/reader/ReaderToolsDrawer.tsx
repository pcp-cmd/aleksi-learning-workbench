import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject
} from "react";

type ReaderToolsDrawerProps = {
  children: ReactNode;
  label: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
};

export function ReaderToolsDrawer({
  children,
  label,
  onClose,
  returnFocusRef
}: ReaderToolsDrawerProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const closeAndReturnFocus = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose();
      returnFocusRef.current?.focus();
    };
    document.addEventListener("keydown", closeAndReturnFocus);
    return () => document.removeEventListener("keydown", closeAndReturnFocus);
  }, [onClose, returnFocusRef]);

  return (
    <div
      className="reader-tools-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
          returnFocusRef.current?.focus();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="reader-tools-drawer"
        role="dialog"
      >
        <header className="reader-tools-drawer__header">
          <h2 id={titleId}>{label}</h2>
          <button
            aria-label={`关闭${label}`}
            className="button button-ghost"
            onClick={() => {
              onClose();
              returnFocusRef.current?.focus();
            }}
            ref={closeRef}
            type="button"
          >
            关闭
          </button>
        </header>
        <div className="reader-tools-drawer__body">{children}</div>
      </section>
    </div>
  );
}
