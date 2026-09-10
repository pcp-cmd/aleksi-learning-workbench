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
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;

    // The Reader tool drawer is modal. While it is open, the drawer body is
    // the only vertical scroll owner; the manuscript behind it must not move.
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
        onWheelCapture={(event) => {
          // Keep wheel input inside the modal subtree. CSS overscroll containment
          // then prevents boundary hand-off to the Reader manuscript.
          event.stopPropagation();
        }}
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
        <div className="reader-tools-drawer__body" ref={bodyRef}>
          {children}
        </div>
      </section>
    </div>
  );
}
