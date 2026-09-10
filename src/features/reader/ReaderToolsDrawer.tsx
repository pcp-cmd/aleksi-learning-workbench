import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject
} from "react";
import "./ReaderToolsDrawer.css";

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

    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;

    // Reader tools are modal. While the drawer is open, the manuscript must
    // not remain a competing scroll owner.
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    const closeAndReturnFocus = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose();
      returnFocusRef.current?.focus();
    };

    document.addEventListener("keydown", closeAndReturnFocus);

    return () => {
      document.removeEventListener("keydown", closeAndReturnFocus);
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
    };
  }, [onClose, returnFocusRef]);

  return (
    <div
      className="reader-tools-backdrop reader-tools-backdrop--modal"
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
        className="reader-tools-drawer reader-tools-drawer--viewport"
        onWheelCapture={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="reader-tools-drawer__header reader-tools-drawer__header--fixed">
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
        <div
          className="reader-tools-drawer__body reader-tools-drawer__body--scroll"
          data-testid="reader-tools-drawer-scroll"
        >
          {children}
        </div>
      </section>
    </div>
  );
}
