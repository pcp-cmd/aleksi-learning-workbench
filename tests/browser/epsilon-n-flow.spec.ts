import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type IndexAsset = {
  assetType: string;
  concept: string | null;
  id: string;
  relativePath: string;
};

const READING_BODY = [
  "# 数列极限 ε-N 定义",
  "",
  "对任意 ε > 0，存在 N。",
  "",
  "行内公式：$x_n \\to a$",
  "",
  "$$",
  "\\forall \\varepsilon > 0,\\ \\exists N,\\ \\forall n > N,\\ |x_n-a|<\\varepsilon",
  "$$",
  "",
  "| Concept | Status |",
  "| :--- | ---: |",
  "| Sequence | Ready |",
  "",
  "- [x] GFM ready",
  "",
  "~~旧记法~~",
  "",
  "https://openai.com"
].join("\n");

const VISUAL_QA_DIRECTORY = join(
  process.cwd(),
  "artifacts",
  "total-refinement-screenshots"
);
const VISUAL_REFERENCE_PATH = join(
  process.cwd(),
  "docs",
  "reference",
  "aleksi-workbench-selected-flywheel-reference.png"
);

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function vaultPathFor(vaultPath: string, relativePath: string): string {
  return join(vaultPath, ...relativePath.split("/"));
}

async function readIndexAssets(vaultPath: string): Promise<IndexAsset[]> {
  try {
    const raw = await readFile(
      vaultPathFor(vaultPath, ".aleksi/index.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw) as { assets?: IndexAsset[] };
    return parsed.assets ?? [];
  } catch {
    return [];
  }
}

async function findConceptCard(vaultPath: string): Promise<IndexAsset | null> {
  const assets = await readIndexAssets(vaultPath);
  return (
    assets.find(
      (asset) => asset.assetType === "concept" && asset.concept === "ε-N"
    ) ?? null
  );
}

async function findCardByType(
  vaultPath: string,
  assetType: string
): Promise<IndexAsset | null> {
  const assets = await readIndexAssets(vaultPath);
  return assets.find((asset) => asset.assetType === assetType) ?? null;
}

async function waitForConceptCard(vaultPath: string): Promise<IndexAsset> {
  await expect
    .poll(async () => (await findConceptCard(vaultPath))?.relativePath ?? "")
    .toContain("02-概念卡/");

  const definitionCard = await findConceptCard(vaultPath);
  if (definitionCard === null) {
    throw new Error("Concept card was not indexed");
  }

  return definitionCard;
}

async function waitForCardType(
  vaultPath: string,
  assetType: string
): Promise<IndexAsset> {
  await expect
    .poll(async () => (await findCardByType(vaultPath, assetType))?.relativePath ?? "")
    .not.toBe("");

  const card = await findCardByType(vaultPath, assetType);
  if (card === null) {
    throw new Error(`${assetType} card was not indexed`);
  }
  return card;
}

async function makeCardDueToday(vaultPath: string, relativePath: string) {
  const cardPath = vaultPathFor(vaultPath, relativePath);
  const raw = await readFile(cardPath, "utf8");
  const nextReview = todayUtcDate();
  const updated = raw.replace(
    /^nextReview: "[^"]+"$/mu,
    `nextReview: "${nextReview}"`
  );

  if (updated === raw) {
    throw new Error(`Could not update nextReview in ${relativePath}`);
  }

  await writeFile(cardPath, updated, "utf8");
}

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

async function captureVisualQa(page: Page) {
  await rm(VISUAL_QA_DIRECTORY, { force: true, recursive: true });
  await mkdir(VISUAL_QA_DIRECTORY, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/graph");
  await expect(page.getByRole("heading", { name: "主题飞轮" })).toBeVisible();
  await expect(page.locator(".flywheel-stage-card")).toHaveCount(5);

  const viewports = [
    { height: 768, label: "desktop-1366x768", width: 1366 },
    { height: 900, label: "desktop-1440x900", width: 1440 },
    { height: 1080, label: "desktop-1920x1080", width: 1920 },
    { height: 900, label: "split-screen-720x900", width: 720 },
    { height: 1024, label: "tablet-768x1024", width: 768 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
        )
      )
      .toBe(true);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: join(VISUAL_QA_DIRECTORY, `graph-${viewport.label}.png`)
    });
  }

  const touchTargets = await page.locator(".flywheel-stage-card").evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    })
  );
  expect(touchTargets.every((target) => target.height >= 44 && target.width >= 44)).toBe(true);

  const routeScreenshots = [
    { file: "today-desktop-1440x900.png", heading: "今日学习", route: "/today" },
    { file: "reader-desktop-1440x900.png", heading: "精读工作台", route: "/reader" }
  ] as const;

  await page.setViewportSize({ height: 900, width: 1440 });
  for (const screen of routeScreenshots) {
    await page.goto(screen.route);
    await expect(page.getByRole("heading", { name: screen.heading })).toBeVisible();
    if (screen.route === "/today") {
      await expect(page.locator(".today-next-card")).toBeVisible();
    } else {
      await expect(page.getByTestId("reader-surface")).toBeVisible();
    }
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: join(VISUAL_QA_DIRECTORY, screen.file)
    });
  }

  await selectReaderText(page, "对任意 ε > 0，存在 N。");
  await page.getByRole("button", { name: "创建卡片" }).click();
  await page.getByRole("menuitem", { name: "概念" }).click();
  await expect(page).toHaveURL(/\/cards$/u);
  await expect(page.locator(".card-editor")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: join(VISUAL_QA_DIRECTORY, "cards-desktop-1440x900.png")
  });

  await page.setViewportSize({ height: 1092, width: 1456 });
  await page.goto("/graph");
  await expect(page.getByRole("heading", { name: "主题飞轮" })).toBeVisible();
  await expect(page.locator(".flywheel-stage-card")).toHaveCount(5);
  const implementationPath = join(
    VISUAL_QA_DIRECTORY,
    "graph-reference-viewport-1456x1092.png"
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: implementationPath
  });

  const referenceData = (await readFile(VISUAL_REFERENCE_PATH)).toString("base64");
  const implementationData = (await readFile(implementationPath)).toString("base64");
  await page.setViewportSize({ height: 1160, width: 2048 });
  await page.setContent(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #e8e1d7; color: #3b3028; font-family: system-ui, sans-serif; }
    h1 { margin: 0 0 18px; font: 600 20px/1.3 Georgia, serif; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
    figure { margin: 0; padding: 14px; border: 1px solid #cfc4b5; border-radius: 18px; background: #f8f4ed; }
    figcaption { margin-bottom: 10px; color: #7b6658; font-size: 14px; }
    img { display: block; width: 100%; height: auto; border-radius: 10px; border: 1px solid #ddd2c3; }
  </style>
</head>
<body>
  <h1>Selected flywheel reference vs implemented Workbench state · 1456 × 1092</h1>
  <main>
    <figure><figcaption>Reference</figcaption><img alt="Reference" src="data:image/png;base64,${referenceData}"></figure>
    <figure><figcaption>Implementation</figcaption><img alt="Implementation" src="data:image/png;base64,${implementationData}"></figure>
  </main>
</body>
</html>`);
  await expect(page.locator("img")).toHaveCount(2);
  await expect
    .poll(() =>
      page.locator("img").evaluateAll((images) =>
        images.every((image) => image instanceof HTMLImageElement && image.complete)
      )
    )
    .toBe(true);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: join(VISUAL_QA_DIRECTORY, "reference-vs-implementation.png")
  });
}

test("completes the epsilon-N learning loop and reloads persisted state", async ({
  page
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    browserErrors.push(`page: ${error.message}`);
  });

  const appSettingsDir = process.env.ALEKSI_APP_SETTINGS_DIR;
  if (appSettingsDir !== undefined) {
    await rm(appSettingsDir, { force: true, recursive: true });
  }

  const vaultPath = testInfo.outputPath("vault");
  await rm(vaultPath, { force: true, recursive: true });
  await mkdir(vaultPath, { recursive: true });

  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();

  await page.getByRole("button", { name: "打开设置" }).click();
  await page.getByLabel("新学习库位置").fill(vaultPath);
  await page.getByRole("button", { name: "创建本地学习库" }).click();
  await expect(page.getByText(vaultPath).first()).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("link", { name: "精读工作台" }).click();
  await expect(page.getByRole("heading", { name: "精读工作台" })).toBeVisible();
  await page.getByRole("button", { name: /新材料/u }).click();
  await page.getByLabel("粘贴你要精读的内容").fill(READING_BODY);
  await page.getByRole("button", { name: "开始精读" }).click();
  await expect(page.getByText(/01-阅读材料\/数列极限/u).first()).toBeVisible();
  await expect.poll(async () => page.locator(".katex").count()).toBeGreaterThan(0);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(page.locator("del")).toHaveText("旧记法");
  const externalLink = page.getByRole("link", { name: "https://openai.com" });
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");

  await selectReaderText(page, "对任意 ε > 0，存在 N。");
  const firstSelectionToolbar = page.getByRole("toolbar", { name: "选区动作" });
  await expect(firstSelectionToolbar.getByRole("button")).toHaveCount(3);
  await firstSelectionToolbar.getByRole("button", { name: "摘录" }).click();
  await expect(page.getByRole("dialog", { name: "摘录篮" })).toBeVisible();
  await expect(page.getByRole("region", { name: "摘录篮" })).toContainText(
    "对任意 ε > 0，存在 N。"
  );
  await page.getByRole("button", { name: "关闭摘录篮" }).click();

  await selectReaderText(page, "对任意 ε > 0，存在 N。");
  const cardSelectionToolbar = page.getByRole("toolbar", { name: "选区动作" });
  await cardSelectionToolbar.getByRole("button", { name: "创建卡片" }).click();
  await expect(
    page.getByRole("menu", { name: "选择卡片类型" }).getByRole("menuitem")
  ).toHaveCount(5);
  await page.getByRole("menuitem", { name: "概念" }).click();

  await expect(page).toHaveURL(/\/cards$/u);
  await expect(page.getByRole("heading", { name: "① 原文" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "② 我的重述" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "③ 结构化卡片" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "④ 下一步行动" })).toBeVisible();
  await page.getByText("来源与分类设置", { exact: true }).click();
  await page.getByLabel("当前卡点").selectOption("proof-search");
  await page.getByLabel("正式解释").fill("∀ε>0，∃N，n>N ⇒ |x_n-a|<ε。");
  await page.getByLabel("我自己的理解").fill("尾部项会进入任意小的目标邻域。");
  await page.getByLabel("常见误解").fill("N 可以依赖 ε，但不能依赖 n。");
  await page.getByLabel("使用场景").fill("判断数列是否收敛到一个目标值。");
  await page.getByRole("button", { name: "保存卡片" }).click();
  await expect(page.getByText(/02-概念卡.*ε-N/u).first()).toBeVisible();

  const conceptCard = await waitForConceptCard(vaultPath);

  await page.goto("/graph");
  await expect(page.getByRole("heading", { name: "主题飞轮" })).toBeVisible();
  await expect(page.getByText(/覆盖：\s*1 \/ 5\s*个维度已建立/u)).toBeVisible();
  await page.getByRole("button", { name: /^2\. 例子/u }).click();
  await page.getByRole("button", { name: "在 Reader 补例子卡" }).click();
  await expect(page).toHaveURL(/\/reader\?concept=/u);
  await expect(page.getByText("来自主题飞轮的下一步")).toBeVisible();

  await selectReaderText(page, "对任意 ε > 0，存在 N。");
  await page
    .getByRole("toolbar", { name: "选区动作" })
    .getByRole("button", { name: "记录困难" })
    .click();
  await expect(page).toHaveURL(/\/diagnosis$/u);
  await expect(
    page.getByRole("textbox", { name: "概念", exact: true })
  ).toHaveValue("ε-N");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "精读工作台" })).toBeVisible();

  await selectReaderText(page, "对任意 ε > 0，存在 N。");
  await page
    .getByRole("toolbar", { name: "选区动作" })
    .getByRole("button", { name: "创建卡片" })
    .click();
  await page.getByRole("menuitem", { name: "例子" }).click();
  await page.getByLabel("我的理解").fill("用具体数列检查 ε 给定后如何选择统一的 N。");
  await page.getByLabel("例子内容").fill("令 x_n=1/n，给定 ε>0 时选择 N>1/ε。");
  await page.getByLabel("为什么它符合").fill("所有 n>N 都有 1/n<ε。");
  await page.getByLabel("它训练我什么").fill("训练量词顺序和统一控制尾项。");
  await page.getByLabel("下一步行动").fill("再写一个需要估计 N 的数列例子。");
  await page.getByRole("button", { name: "保存卡片" }).click();
  await expect(page.getByText(/03-例子卡.*ε-N/u).first()).toBeVisible();
  await waitForCardType(vaultPath, "example");

  await page.goto("/graph");
  await expect(page.getByText(/覆盖：\s*2 \/ 5\s*个维度已建立/u)).toBeVisible();

  await page.goto("/diagnosis");
  await expect(page.getByRole("heading", { name: "卡点诊断" })).toBeVisible();
  await page.getByRole("textbox", { name: "概念", exact: true }).fill("ε-N");
  await page.getByLabel("关联卡片").selectOption(conceptCard.id);
  await page.getByLabel("卡点类型").selectOption("proof-search");
  await page.getByLabel("要沉淀成哪类卡片").selectOption("process");
  await page.getByLabel("具体表现").fill("我不知道证明时先选 ε 还是先找 N。");
  await page.getByLabel("我一开始以为的问题").fill("我以为是计算不熟。");
  await page
    .getByLabel("当前原因假设（待复测）", { exact: true })
    .fill("量词依赖关系还没有拆清楚。");
  await page.getByLabel("下一步最小行动").fill("写出 ε、N、n 的依赖表。");
  await page.getByRole("button", { name: "保存诊断" }).click();
  await expect(page.getByText(/07-卡点诊断/u).first()).toBeVisible();
  await page.getByRole("button", { name: "生成 Codex 任务 Markdown" }).click();
  await expect(page.getByText(/10-Codex任务/u).first()).toBeVisible();

  await makeCardDueToday(vaultPath, conceptCard.relativePath);

  await page.getByRole("link", { name: "今日复习" }).click();
  await expect(page.getByRole("heading", { name: "今日复习" })).toBeVisible();
  await expect(page.getByText("ε-N").first()).toBeVisible();
  await page
    .getByLabel("我的闭卷回答")
    .fill("先给任意精度 ε，再找到统一控制所有后续项的 N。");
  await page.getByLabel("3 · 比较有把握").click();
  await page.getByRole("button", { name: "保存尝试并揭示答案" }).click();
  await expect(page.getByText("答案面")).toBeVisible();
  await page.getByLabel("会了").click();
  await page.getByLabel("本次卡点").selectOption("proof-search");
  await page.getByRole("button", { name: "保存复习结果" }).click();
  await expect(page.getByText("本次证据已保存", { exact: true })).toBeVisible();

  await expect(page.getByRole("navigation", { name: "学习模块" }).getByRole("link", { name: "证据验证" })).toHaveCount(0);
  await page.getByRole("link", { name: "为本卡提交或查看证据" }).click();
  await expect(page).toHaveURL(new RegExp(`/verification\\?cardId=${conceptCard.id}$`, "u"));
  await expect(page.getByRole("heading", { name: "证据验证" })).toBeVisible();
  await expect(page.getByLabel("关联卡片")).toHaveValue(conceptCard.id);
  await page
    .getByLabel("我主张的结论")
    .fill("ε-N 定义中的 N 可以依赖 ε，但不能依赖 n。");
  await page
    .getByLabel("我的证明或论证")
    .fill("量词顺序是先对任意 ε，再存在 N，最后要求所有 n>N 都成立，因此 N 在选定 ε 后固定。 ");
  await page
    .getByRole("button", { name: "保存不可覆盖的候选证据" })
    .click();
  await expect(page.getByText("结构化审查门")).toBeVisible();
  await page.getByLabel("审查摘要").fill("论证还缺少对依赖关系的明确排除说明。");
  await page.getByLabel("论证缺口 1 位置").fill("结尾");
  await page
    .getByLabel("论证缺口 1 问题")
    .fill("没有直接说明为什么 N 不能随 n 改变。");
  await page.getByLabel("修复提示").fill("补一句：存在量词位于对所有 n 之前。 ");
  await page
    .getByRole("button", { name: "保存不可覆盖的审查结论" })
    .click();
  await expect(page.getByText("需要修复").first()).toBeVisible();
  await expect(page.getByText(/请保留这份旧稿/u)).toBeVisible();

  const verificationDirectory = join(vaultPath, "10-Codex任务", "验证证据");
  await expect
    .poll(async () => (await readdir(verificationDirectory)).length)
    .toBe(2);

  await page.reload();
  await expect(page.getByRole("heading", { name: "证据验证" })).toBeVisible();
  await expect(page.getByText("需要修复").first()).toBeVisible();
  await page.goto("/graph");
  await expect(page.getByText(/覆盖：\s*2 \/ 5\s*个维度已建立/u)).toBeVisible();

  await captureVisualQa(page);
  expect(browserErrors).toEqual([]);
});
