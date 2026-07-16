import { expect, test } from "@playwright/test";

test("plays the launch splash once per nonce and enters Today automatically", async ({
  page
}) => {
  await page.goto("/?launch=browser-first");

  await expect(
    page.getByRole("heading", { name: "Aleksi Learning Workbench" })
  ).toBeVisible();
  await expect(page.getByText("将真实 overview.json")).toHaveCount(0);
  await expect(page.locator(".overview-glyph")).toHaveAttribute(
    "data-motion-state",
    "ready"
  );
  await expect(page.locator(".overview-glyph svg")).toBeVisible();

  await expect(page).toHaveURL(/\/today$/u);
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();

  await page.goto("/?launch=browser-first");
  await expect(page).toHaveURL(/\/today$/u);
  await expect(page.locator(".launch-splash")).toHaveCount(0);

  await page.goto("/?launch=browser-second");
  await expect(page.locator(".launch-splash")).toBeVisible();
  await expect(page).toHaveURL(/\/today$/u);
});

test("keeps startup bounded with reduced motion and a missing overview asset", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/motion/overview.json", async (route) => {
    await route.fulfill({
      body: "missing",
      status: 404
    });
  });

  await page.goto("/?launch=reduced-motion");

  await expect(page.locator(".overview-glyph")).toHaveAttribute(
    "data-motion-state",
    "reduced-motion"
  );
  await expect(page.locator(".overview-glyph__fallback")).toBeVisible();

  await expect(page).toHaveURL(/\/today$/u);
});

test("shows the Today recovery state when the backend is unavailable after splash", async ({
  page
}) => {
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { message: "本地服务暂时不可用" } }),
      contentType: "application/json",
      status: 503
    });
  });

  await page.goto("/?launch=backend-unavailable");
  await expect(page).toHaveURL(/\/today$/u);
  await expect(page.getByText("本地学习库无法访问")).toBeVisible();
  await expect(
    page.getByText("请打开设置选择其他位置或创建新的学习库。")
  ).toBeVisible();
});
