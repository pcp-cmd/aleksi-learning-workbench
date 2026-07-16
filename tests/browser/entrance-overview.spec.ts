import { expect, test, type Page } from "@playwright/test";

async function routeNaturalOverviewFixture(page: Page): Promise<void> {
  await page.route("**/motion/overview.json", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        v: "5.12.2",
        fr: 12,
        ip: 0,
        op: 240,
        w: 240,
        h: 240,
        layers: []
      }),
      contentType: "application/json",
      status: 200
    });
  });
}

test("keeps the natural launch visible beyond the old accelerated duration", async ({
  page
}) => {
  await routeNaturalOverviewFixture(page);
  await page.goto("/?launch=browser-first");

  await expect(
    page.getByRole("heading", { name: "Aleksi Learning Workbench" })
  ).toBeVisible();
  await expect(page.locator(".overview-glyph")).toHaveAttribute(
    "data-motion-state",
    "ready"
  );
  await expect(page.locator(".overview-glyph__viewport")).toBeVisible();
  await expect(page.locator(".overview-glyph__fallback")).toHaveCount(0);

  await page.waitForTimeout(1_200);
  await expect(page).toHaveURL(/\/?\?launch=browser-first$/u);
  await expect(page.locator(".launch-splash")).toBeVisible();
});

test("keeps startup bounded with reduced motion and a missing overview asset", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/motion/overview.json", async (route) => {
    await route.fulfill({ body: "missing", status: 404 });
  });

  await page.goto("/?launch=reduced-motion");

  await expect(page.locator(".overview-glyph")).toHaveAttribute(
    "data-motion-state",
    "reduced-motion"
  );
  await expect(page.locator(".overview-glyph__fallback")).toBeVisible();
  await expect(page).toHaveURL(/\/today$/u);
});

test("shows the Today recovery state when the backend is unavailable", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { message: "backend unavailable" } }),
      contentType: "application/json",
      status: 503
    });
  });

  await page.goto("/?launch=backend-unavailable");
  await expect(page).toHaveURL(/\/today$/u);
  await expect(page.locator(".surface-static")).toBeVisible();
  await expect(page.locator(".status-dot--blocked")).toBeVisible();
  await expect(page.locator(".surface-static .button")).toBeVisible();
});
