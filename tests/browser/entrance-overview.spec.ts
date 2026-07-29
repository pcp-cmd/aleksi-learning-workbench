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

async function routeCompletingOverviewFixture(page: Page): Promise<void> {
  await page.route("**/motion/overview.json", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        v: "5.12.2",
        fr: 12,
        ip: 0,
        op: 6,
        w: 240,
        h: 240,
        layers: []
      }),
      contentType: "application/json",
      status: 200
    });
  });
}

test("enters automatically after a real Lottie completion event", async ({
  page
}) => {
  await routeCompletingOverviewFixture(page);
  await page.goto("/?launch=natural-completion", {
    waitUntil: "domcontentloaded"
  });

  await expect(page.locator(".overview-glyph")).toHaveAttribute(
    "data-motion-state",
    "ready"
  );
  await expect(page).toHaveURL(/\/today$/u, { timeout: 5_000 });
});

test("keeps the natural launch visible beyond the old accelerated duration", async ({
  page
}) => {
  test.setTimeout(60_000);
  await routeNaturalOverviewFixture(page);
  await page.goto("/?launch=browser-first", {
    waitUntil: "domcontentloaded"
  });

  await expect(
    page.getByRole("heading", { name: "Aleksi Learning Workbench" })
  ).toBeVisible();
  await expect(page.locator(".overview-glyph")).toHaveAttribute(
    "data-motion-state",
    "ready"
  );
  await expect(page.locator(".overview-glyph__viewport")).toBeVisible();
  await expect(page.locator(".overview-glyph__fallback")).toHaveCount(0);
  const progress = page.getByRole("progressbar", {
    name: "正在进入今日学习"
  });
  await expect(progress).not.toHaveAttribute("aria-valuenow");

  await page.waitForTimeout(1_200);
  await expect(page).toHaveURL(/\/?\?launch=browser-first$/u);
  await expect(page.locator(".launch-splash")).toBeVisible();

  const directEntry = page.getByRole("button", { name: "直接进入" });
  await directEntry.focus();
  await expect(directEntry).toBeFocused();
  await expect(directEntry).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/today$/u);

  await page.locator('.rail-links a[href="/graph"]').click();
  await expect(page).toHaveURL(/\/graph$/u);
  await page.getByRole("link", {
    name: "Aleksi Learning Workbench, back to Today"
  }).click();
  await expect(page).toHaveURL(/\/today$/u);
  await expect(page.locator(".launch-splash")).toHaveCount(0);
});

test("activates direct entry with Space", async ({ page }) => {
  await routeNaturalOverviewFixture(page);
  await page.goto("/?launch=keyboard-space");

  const directEntry = page.getByRole("button", { name: "直接进入" });
  await directEntry.focus();
  await page.keyboard.press("Space");

  await expect(page).toHaveURL(/\/today$/u);
});

test("uses a static gate when reduced motion is requested", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let motionRequested = false;
  await page.route("**/motion/overview.json", async (route) => {
    motionRequested = true;
    await route.abort();
  });

  await page.goto("/?launch=reduced-motion");

  await expect(page).toHaveURL(/\/today$/u);
  expect(motionRequested).toBe(false);
});

test("does not let a missing overview asset block entry", async ({ page }) => {
  await page.route("**/motion/overview.json", async (route) => {
    await route.fulfill({ body: "missing", status: 404 });
  });

  await page.goto("/?launch=missing-overview");

  await expect(page).toHaveURL(/\/today$/u);
  await expect(page.locator(".launch-splash")).toHaveCount(0);
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
