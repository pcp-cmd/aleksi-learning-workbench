import { describe, expect, it } from "vitest";
import {
  APP_ROUTE_REGISTRY,
  PRIMARY_ROUTES
} from "../../src/app/route-registry";

describe("application route registry", () => {
  it("defines the exact five-module desktop learning sequence", () => {
    expect(
      PRIMARY_ROUTES.map(({ path, shortLabel, position }) => ({
        path,
        shortLabel,
        position
      }))
    ).toEqual([
      { path: "/today", shortLabel: "今日", position: 1 },
      { path: "/reader", shortLabel: "精读", position: 2 },
      { path: "/cards", shortLabel: "卡片", position: 3 },
      { path: "/graph", shortLabel: "飞轮", position: 4 },
      { path: "/review", shortLabel: "复习", position: 5 }
    ]);
  });

  it("keeps route identity, navigation position, and labels unique", () => {
    const paths = APP_ROUTE_REGISTRY.map((route) => route.path);
    const primaryPositions = PRIMARY_ROUTES.map((route) => route.position);

    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(primaryPositions).size).toBe(primaryPositions.length);
    expect(PRIMARY_ROUTES.every((route) => route.shortLabel.length > 0)).toBe(true);
    expect(PRIMARY_ROUTES.some((route) => route.path === "/graph")).toBe(true);
  });

  it("classifies Diagnosis as contextual and Verification as advanced", () => {
    expect(
      APP_ROUTE_REGISTRY.find((route) => route.path === "/diagnosis")
        ?.visibility
    ).toBe("contextual");
    expect(
      APP_ROUTE_REGISTRY.find((route) => route.path === "/verification")
        ?.visibility
    ).toBe("advanced");
  });
});
