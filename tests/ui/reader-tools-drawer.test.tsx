// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderToolsDrawer } from "../../src/features/reader/ReaderToolsDrawer";

afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = "";
  document.documentElement.style.overscrollBehavior = "";
  document.body.style.overflow = "";
  document.body.style.overscrollBehavior = "";
});

describe("ReaderToolsDrawer scroll ownership", () => {
  it("locks the manuscript and gives the drawer body its own vertical scroller", () => {
    const returnFocusRef = createRef<HTMLButtonElement>();
    const onClose = vi.fn();
    const { unmount } = render(
      <>
        <button ref={returnFocusRef} type="button">
          材料
        </button>
        <ReaderToolsDrawer
          label="材料"
          onClose={onClose}
          returnFocusRef={returnFocusRef}
        >
          <div style={{ height: "2400px" }}>长材料列表</div>
        </ReaderToolsDrawer>
      </>
    );

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");

    const scroller = screen.getByTestId("reader-tools-drawer-scroll");
    expect(scroller.style.overflowY).toBe("auto");
    expect(scroller.style.overflowX).toBe("hidden");
    expect(scroller.style.minHeight).toBe("0px");
    expect(scroller.style.overscrollBehavior).toBe("contain");

    unmount();

    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");
  });
});
