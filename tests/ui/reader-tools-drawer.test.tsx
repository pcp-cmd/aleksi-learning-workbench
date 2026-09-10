// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("locks and restores the document scroll owners", () => {
    document.documentElement.style.overflow = "auto";
    document.documentElement.style.overscrollBehavior = "contain";
    document.body.style.overflow = "visible";
    document.body.style.overscrollBehavior = "auto";

    const returnFocusRef = createRef<HTMLButtonElement>();
    const { unmount } = render(
      <>
        <button ref={returnFocusRef} type="button">
          材料
        </button>
        <ReaderToolsDrawer
          label="材料"
          onClose={vi.fn()}
          returnFocusRef={returnFocusRef}
        >
          <div>长材料列表</div>
        </ReaderToolsDrawer>
      </>
    );

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overscrollBehavior).toBe("none");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.overscrollBehavior).toBe("none");

    unmount();

    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.documentElement.style.overscrollBehavior).toBe("contain");
    expect(document.body.style.overflow).toBe("visible");
    expect(document.body.style.overscrollBehavior).toBe("auto");
  });

  it("keeps wheel input inside the modal drawer", () => {
    const returnFocusRef = createRef<HTMLButtonElement>();
    const outerWheel = vi.fn();

    render(
      <div onWheel={outerWheel}>
        <button ref={returnFocusRef} type="button">
          材料
        </button>
        <ReaderToolsDrawer
          label="材料"
          onClose={vi.fn()}
          returnFocusRef={returnFocusRef}
        >
          <div>U01 U02 U03 U04 U05 U06</div>
        </ReaderToolsDrawer>
      </div>
    );

    const scroller = screen.getByTestId("reader-tools-drawer-scroll");
    expect(scroller).toHaveClass("reader-tools-drawer__body--scroll");
    fireEvent.wheel(scroller, { deltaY: 600 });
    expect(outerWheel).not.toHaveBeenCalled();
  });

  it("keeps viewport and overflow rules in the drawer stylesheet", async () => {
    const css = await readFile(
      join(process.cwd(), "src/features/reader/ReaderToolsDrawer.css"),
      "utf8"
    );

    expect(css).toContain(".reader-tools-drawer--viewport");
    expect(css).toContain("height: 100dvh;");
    expect(css).toContain("min-height: 0;");
    expect(css).toContain("overflow: hidden;");
    expect(css).toContain(".reader-tools-drawer__body--scroll");
    expect(css).toContain("overflow-y: auto;");
    expect(css).toContain("overscroll-behavior: contain;");
    expect(css).toContain("scrollbar-gutter: stable;");
  });
});
