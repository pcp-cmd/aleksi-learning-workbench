import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";

const READING_BODY = [
  "# 列表内联格式验证",
  "",
  "普通段落：**粗体文本**",
  "",
  "- **无序列表粗体**",
  "",
  "1. **承载对象：**元素生活在哪个集合、空间或分布类中？",
  "2. 普通文字与 `行内代码`",
  "3. [列表内链接](https://example.com)",
  "4. 普通文字、**粗体**、*斜体* 与 `代码`",
  "   - **嵌套无序项：**内容",
  "     1. **嵌套有序项：**内容",
  "",
  "> 引用中的 **粗体**",
  "",
  "| 项目 | 状态 |",
  "| --- | --- |",
  "| 表格 | 正常 |",
  "",
  "```ts",
  "const ready = true;",
  "```",
  "",
  ...Array.from(
    { length: 36 },
    (_, index) =>
      `## 第 ${index + 1} 节\n\n这是用于滚动恢复验证的正文段落 ${index + 1}。包含 **段落粗体**、*斜体* 与 \`行内代码\`。`
  )
].join("\n");

async function selectReaderText(page: Page, text: string) {
  await expect(page.getByTestId("reader-surface")).toContainText(text);
  await page.evaluate((selectedText) => {
    const reader = document.querySelector('[data-testid="reader-surface"]');
    if (!(reader instanceof HTMLElement)) {
      throw new Error("Reader surface not found");
    }

    const walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
      const content = node.textContent ?? "";
      const start = content.indexOf(selectedText);
      if (start >= 0) {
        node.parentElement?.scrollIntoView({ block: "center" });
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + selectedText.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      node = walker.nextNode();
    }

    throw new Error(`Could not select reader text: ${selectedText}`);
  }, text);
  await page.getByTestId("reader-surface").dispatchEvent("mouseup");
}

test("renders list inline Markdown and restores reading context through Diagnosis", async ({
  page,
  request
}, testInfo) => {
  const vaultPath = testInfo.outputPath("vault");
  await rm(vaultPath, { force: true, recursive: true });
  await mkdir(vaultPath, { recursive: true });

  const initialized = await request.post("/api/vault/initialize", {
    data: { path: vaultPath }
  });
  if (!initialized.ok()) {
    throw new Error(
      `Learning-library initialization failed (${initialized.status()}): ${await initialized.text()}`
    );
  }

  const created = await request.post("/api/readings", {
    data: {
      title: "列表内联格式验证",
      concept: "Markdown 渲染",
      body: READING_BODY,
      source: "manual-paste"
    }
  });
  expect(created.ok()).toBe(true);
  const response = (await created.json()) as { reading: { id: string } };
  const readingUrl = `/reader?reading=${response.reading.id}`;

  await page.goto(readingUrl);
  const reader = page.getByTestId("reader-surface");
  await expect(reader).toBeVisible();
  await expect(reader.locator("li strong").filter({ hasText: "承载对象：" })).toHaveText(
    "承载对象："
  );
  await expect(reader.locator("li strong").filter({ hasText: "无序列表粗体" })).toHaveText(
    "无序列表粗体"
  );
  await expect(reader.locator("li strong").filter({ hasText: "嵌套有序项：" })).toHaveText(
    "嵌套有序项："
  );
  await expect(reader.getByRole("link", { name: "列表内链接" })).toHaveAttribute(
    "href",
    "https://example.com"
  );
  await expect(reader.getByRole("table")).toBeVisible();
  await expect(reader.locator("pre code")).toContainText("const ready = true;");

  const targetExcerpt = "这是用于滚动恢复验证的正文段落 18。";
  const outlineSummary = reader.getByText(/^完整目录/u);
  await outlineSummary.click();
  await reader
    .getByRole("navigation", { name: "完整文档目录" })
    .getByRole("button", { name: "第 18 节" })
    .click();
  const targetParagraph = reader.getByText(targetExcerpt, { exact: false });
  await expect(targetParagraph).toBeAttached();
  await outlineSummary.click();
  await targetParagraph.scrollIntoViewIfNeeded();
  const expectedScrollTop = await page.evaluate(() => window.scrollY);
  expect(expectedScrollTop).toBeGreaterThan(0);
  await selectReaderText(page, targetExcerpt);
  await page
    .getByRole("toolbar", { name: "选区动作" })
    .getByRole("button", { name: "记录困难" })
    .click();

  await expect(page).toHaveURL(/\/diagnosis$/u);
  const returnControl = page.getByRole("button", { name: "← 返回阅读材料" });
  await expect(returnControl).toBeVisible();
  await expect(returnControl).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await returnControl.focus();
  await expect(returnControl).toBeFocused();
  const draftValue = "我先把语法标记误认为普通文字，需要回到原段重新核对。";
  await page.getByLabel("我一开始以为的问题").fill(draftValue);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath("diagnosis-reading-return.png")
  });

  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page).toHaveURL(readingUrl);
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - expectedScrollTop))
    .toBeLessThanOrEqual(2);

  await page.goForward();
  await expect(page).toHaveURL(/\/diagnosis$/u);
  await expect(page.getByLabel("我一开始以为的问题")).toHaveValue(draftValue);
  await page.getByLabel("卡点类型").selectOption("proof-search");
  await page.getByLabel("要沉淀成哪类卡片").selectOption("process");
  await page.getByLabel("具体表现").fill("列表内联格式没有按预期显示。");
  await page
    .getByLabel("当前原因假设（待复测）", { exact: true })
    .fill("需要确认渲染链是否保留了列表子节点。");
  await page.getByLabel("下一步最小行动").fill("保存一张流程卡并回到同一段原文。");
  await page.getByRole("button", { name: "保存诊断" }).click();
  await expect(page.getByText(/07-卡点诊断/u).first()).toBeVisible();
  await page.getByRole("button", { name: "继续创建：流程卡" }).click();

  await expect(page).toHaveURL(/\/cards$/u);
  await expect(page.getByRole("button", { name: "← 返回阅读材料" })).toBeVisible();
  await expect(page.getByLabel("我的理解")).toHaveValue(
    "需要确认渲染链是否保留了列表子节点。"
  );
  await expect(page.getByLabel("当前卡点")).toHaveValue("proof-search");
  await expect(page.getByLabel("下一步行动")).toHaveValue(
    "保存一张流程卡并回到同一段原文。"
  );
  await page.getByLabel("任务").fill("验证阅读材料中的列表内联格式");
  await page.getByLabel("步骤").fill("定位渲染链路；核对 AST；验证返回阅读材料");
  await page.getByLabel("关键转折").fill("保留列表项中的 Markdown AST 子节点");
  await page.getByLabel("易错点").fill("把列表项子节点重新转换成纯字符串");
  await page.getByLabel("使用场景").fill("精读材料中的有序与无序列表");
  await page.getByRole("button", { name: "保存卡片" }).click();
  await expect(page.getByText(/05-流程卡/u).first()).toBeVisible();
  await page.getByRole("button", { name: "← 返回阅读材料" }).click();

  await expect(page).toHaveURL(readingUrl);
  await expect(page.getByTestId("reader-surface")).toContainText("列表内联格式验证");
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - expectedScrollTop))
    .toBeLessThanOrEqual(2);
  await expect
    .poll(() =>
      page.evaluate(
        (excerpt) => {
          const activeText = document.activeElement?.textContent?.trim() ?? "";
          return activeText === "第 18 节" || activeText.includes(excerpt);
        },
        targetExcerpt
      )
    )
    .toBe(true);
});

test("opens the material import UI directly from an empty Today workspace", async ({
  page,
  request
}, testInfo) => {
  const vaultPath = testInfo.outputPath("empty-vault");
  await rm(vaultPath, { force: true, recursive: true });
  await mkdir(vaultPath, { recursive: true });
  expect((await request.post("/api/vault/initialize", {
    data: { path: vaultPath }
  })).ok()).toBe(true);

  await page.goto("/today");
  await page.getByRole("link", { name: "开始：开始一篇新精读" }).click();
  await expect(page).toHaveURL(/\/reader$/u);
  const importDialog = page.getByRole("dialog", { name: "新材料" });
  await expect(importDialog).toBeVisible();
  await expect(
    importDialog.getByLabel("粘贴你要精读的内容")
  ).toBeEditable();
});

test("shows a Graph load error and recovers through the visible Retry action", async ({
  page,
  request
}, testInfo) => {
  const vaultPath = testInfo.outputPath("graph-retry-vault");
  await rm(vaultPath, { force: true, recursive: true });
  await mkdir(vaultPath, { recursive: true });
  expect((await request.post("/api/vault/initialize", {
    data: { path: vaultPath }
  })).ok()).toBe(true);

  let allowGraphSuccess = false;
  await page.route("**/api/graph/state", async (route) => {
    if (!allowGraphSuccess) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "GRAPH_UNAVAILABLE", message: "图谱读取失败" } }),
        contentType: "application/json",
        status: 503
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/graph");
  await expect(page.getByRole("alert")).toContainText("图谱读取失败");
  await expect(page.getByText("还没有可显示的概念。")).toHaveCount(0);
  allowGraphSuccess = true;
  await page.getByRole("button", { name: "重试读取" }).click();
  await expect(page.getByText("还没有可显示的概念。")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
