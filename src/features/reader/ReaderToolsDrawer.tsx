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

    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;

    // Reader tools are modal. Lock both document scroll owners while the
    // drawer is open so wheel/trackpad input cannot move the manuscript.
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
      style={{
        height: "100dvh",
        maxHeight: "100dvh",
        minHeight: 0,
        overflow: "hidden"
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="reader-tools-drawer"
        onWheelCapture={(event) => event.stopPropagation()}
        role="dialog"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          maxHeight: "100dvh",
          minHeight: 0,
          overflow: "hidden"
        }}
      >
        <header
          className="reader-tools-drawer__header"
          style={{ flex: "0 0 auto" }}
        >
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
          className="reader-tools-drawer__body"
          data-testid="reader-tools-drawer-scroll"
          style={{
            flex: "1 1 0",
            minHeight: 0,
            overflowX: "hidden",
            overflowY: "auto",
            overscrollBehavior: "contain",
            scrollbarGutter: "stable"
          }}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
