// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation
} from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  createReadingReturnContext,
  createRouteReturnContext,
  parseNavigationReturnContext,
  readReadingRestoreContext,
  sanitizeReturnDestination,
  stateWithReturnContext
} from "../../src/app/navigation-return";
import { ContextualReturnControl } from "../../src/components/ContextualReturnControl";

function LocationSnapshot() {
  const location = useLocation();
  const restore = readReadingRestoreContext(location.state);
  return (
    <output data-testid="location">
      {JSON.stringify({
        path: `${location.pathname}${location.search}`,
        restore
      })}
    </output>
  );
}

describe("context-aware workflow return", () => {
  it("validates bounded internal destinations and rejects forged route state", () => {
    expect(sanitizeReturnDestination("/reader?reading=reading-1")).toBe(
      "/reader?reading=reading-1"
    );
    expect(sanitizeReturnDestination("https://example.com/reader")).toBeNull();
    expect(sanitizeReturnDestination("//example.com/cards")).toBeNull();
    expect(sanitizeReturnDestination("/settings")).toBeNull();
    expect(
      parseNavigationReturnContext({
        version: 1,
        source: "reading",
        returnTo: "/reader?reading=reading-1",
        documentId: "reading-1",
        scrollTop: Number.POSITIVE_INFINITY,
        readingMode: "intensive"
      })
    ).toBeNull();
  });

  it("returns to the exact reading material with scroll and focus context", () => {
    const prepare = vi.fn(() => true);
    const context = createReadingReturnContext({
      documentId: "reading-1",
      scrollTop: 864,
      sectionAnchor: "第三节",
      focusExcerpt: "承载对象"
    });
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/diagnosis",
            state: stateWithReturnContext(context)
          }
        ]}
      >
        <Routes>
          <Route
            element={
              <>
                <ContextualReturnControl onPrepareReturn={prepare} />
                <LocationSnapshot />
              </>
            }
            path="/diagnosis"
          />
          <Route element={<LocationSnapshot />} path="/reader" />
        </Routes>
      </MemoryRouter>
    );

    const control = screen.getByRole("button", { name: "← 返回阅读材料" });
    control.focus();
    expect(control).toHaveFocus();
    fireEvent.click(control);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location").textContent).toContain(
      '"path":"/reader?reading=reading-1"'
    );
    expect(screen.getByTestId("location").textContent).toContain(
      '"scrollTop":864'
    );
    expect(screen.getByTestId("location").textContent).toContain(
      '"sectionAnchor":"第三节"'
    );
  });

  it("uses a card-library origin and a predictable fallback without claiming a reading origin", () => {
    const cardOrigin = createRouteReturnContext("cards", "/cards?cardId=card-1");
    const view = render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/verification",
            state: stateWithReturnContext(cardOrigin)
          }
        ]}
      >
        <Routes>
          <Route
            element={<ContextualReturnControl fallback={{ source: "cards", to: "/cards" }} />}
            path="/verification"
          />
          <Route element={<LocationSnapshot />} path="/cards" />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "← 返回卡片库" }));
    expect(screen.getByTestId("location").textContent).toContain(
      '"path":"/cards?cardId=card-1"'
    );

    view.unmount();
    render(
      <MemoryRouter initialEntries={["/verification"]}>
        <Routes>
          <Route
            element={<ContextualReturnControl fallback={{ source: "cards", to: "/cards" }} />}
            path="/verification"
          />
          <Route element={<LocationSnapshot />} path="/cards" />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "← 返回卡片库" }));
    expect(screen.getByTestId("location").textContent).toContain(
      '"path":"/cards"'
    );
  });
});
