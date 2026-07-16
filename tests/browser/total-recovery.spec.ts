import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const EVIDENCE_DIRECTORY = join(
  process.cwd(),
  "artifacts",
  "total-recovery-browser-evidence-20260717"
);

const VIEWPORTS = [
  { width: 1440, height: 960, label: "1440x960" },
  { width: 1280, height: 800, label: "1280x800" },
  { width: 960, height: 680, label: "960x680" }
] as const;

const FLYWHEEL_SUPPLEMENTAL_VIEWPORT = {
  width: 1024,
  height: 768,
  label: "1024x768"
} as const;

type CardResponse = {
  card: { id: string; relativePath: string };
};

type EvidenceRecord = {
  fontFamilies: { body: string; heading: string; mono: string };
  horizontalOverflow: boolean;
  label: string;
  primaryAction: { text: string; visible: boolean } | null;
  routeUrl: string;
  screenshotPath: string;
  viewport: { width: number; height: number };
};

async function postJson<T>(
  request: APIRequestContext,
  path: string,
  data: unknown
): Promise<T> {
  const response = await request.post(path, { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}

function cardInput(type: string, sourceReadingId: string) {
  const common = {
    type,
    title: `积分 · ${type}`,
    concept: "积分",
    relatedConcepts: ["极限"],
    sourceReadingId,
    excerpt: "积分把局部变化累积为整体数量。",
    understanding: "先理解面积近似，再理解极限过程。",
    blockType: "definition",
    nextAction: "闭卷解释这一维度。"
  };

  switch (type) {
    case "concept":
      return {
        ...common,
        formalExplanation: "定积分是黎曼和在分割变细时的极限。",
        myUnderstanding: "把许多窄条面积相加并让误差趋近于零。",
        commonMisunderstanding: "原函数只是计算工具，不是定义本身。",
        usageContext: "面积、累计量与平均值。"
      };
    case "example":
      return {
        ...common,
        exampleContent: "计算区间 [0,1] 上函数 x 的面积。",
        whyItFits: "黎曼和极限等于 1/2。",
        trainingPurpose: "把定义连接到一个可计算对象。"
      };
    case "boundary":
      return {
        ...common,
        confusingObjects: "定积分与原函数",
        similarity: "二者通过微积分基本定理相连。",
        keyDifference: "一个是极限定义的数值，一个是函数族。",
        judgementRule: "先判断问题询问累计量还是求导逆运算。"
      };
    case "process":
      return {
        ...common,
        task: "用定义解释定积分。",
        steps: "分割区间；取样；求和；控制误差；取极限。",
        keyTurn: "误差控制必须对所有足够细的分割成立。",
        pitfall: "只写出求和式却不说明极限。",
        usageContext: "从图像直觉进入严格定义。"
      };
    case "mistake":
      return {
        ...common,
        mistake: "把积分定义成任意一个原函数。",
        originalThinking: "因为积分符号常和求原函数同时出现。",
        realCause: "混淆定积分、原函数与不定积分。",
        correctMethod: "先区分对象，再使用基本定理连接。",
        recognitionSignal: "题目给出区间端点时先检查是否询问累计量。"
      };
    default:
      throw new Error(`Unsupported card type ${type}`);
  }
}

async function makeDue(vaultPath: string, relativePath: string): Promise<void> {
  const absolutePath = join(vaultPath, ...relativePath.split("/"));
  const raw = await readFile(absolutePath, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const updated = raw.replace(/^nextReview: "[^"]+"$/mu, `nextReview: "${today}"`);
  if (updated === raw) {
    throw new Error(`Unable to set nextReview in ${relativePath}`);
  }
  await writeFile(absolutePath, updated, "utf8");
}

async function capture(
  page: Page,
  records: EvidenceRecord[],
  label: string,
  viewport: { width: number; height: number }
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.locator(".route-loading").count()).toBe(0);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );

  const screenshotName = `${label}-${viewport.width}x${viewport.height}.png`;
  const screenshotPath = join(EVIDENCE_DIRECTORY, screenshotName);
  const diagnostics = await page.evaluate(() => {
    const body = getComputedStyle(document.body).fontFamily;
    const heading = document.querySelector("h1");
    const monoProbe = document.createElement("code");
    monoProbe.textContent = "font-probe";
    monoProbe.style.position = "fixed";
    monoProbe.style.visibility = "hidden";
    monoProbe.style.fontFamily = "var(--font-mono)";
    document.body.append(monoProbe);
    const mono = getComputedStyle(monoProbe).fontFamily;
    monoProbe.remove();
    const actionScope =
      document.querySelector<HTMLElement>('[role="dialog"]') ??
      document.querySelector<HTMLElement>("main");
    const candidates = Array.from(
      actionScope?.querySelectorAll<HTMLElement>(
        ".button, button:not([disabled]), a[href]"
      ) ?? []
    );
    const primary = candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    });

    return {
      fontFamilies: {
        body,
        heading: heading === null ? body : getComputedStyle(heading).fontFamily,
        mono
      },
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      primaryAction:
        primary === undefined
          ? null
          : { text: primary.innerText.trim(), visible: true },
      routeUrl: `${location.pathname}${location.search}`
    };
  });

  expect(diagnostics.horizontalOverflow, `${label} overflows at ${viewport.width}px`).toBe(false);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: screenshotPath
  });
  records.push({
    ...diagnostics,
    label,
    screenshotPath: relative(process.cwd(), screenshotPath).replaceAll("\\", "/"),
    viewport
  });
}

test("records deterministic production evidence for the complete workbench", async ({
  page,
  request
}, testInfo) => {
  test.setTimeout(180_000);
  await rm(EVIDENCE_DIRECTORY, { force: true, recursive: true });
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const records: EvidenceRecord[] = [];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/?launch=production-evidence-${viewport.label}`);
    await expect(page.locator(".overview-glyph")).toHaveAttribute(
      "data-motion-state",
      "reduced-motion"
    );
    await capture(page, records, "entrance", viewport);
    await expect(page).toHaveURL(/\/today$/u);
  }

  const vaultPath = testInfo.outputPath("vault");
  await rm(vaultPath, { force: true, recursive: true });
  await mkdir(vaultPath, { recursive: true });
  await postJson(request, "/api/vault/initialize", { path: vaultPath });
  const reading = await postJson<{
    reading: { id: string; relativePath: string };
  }>(request, "/api/readings", {
    title: "积分的严格定义",
    concept: "积分",
    body: "# 积分\n\n积分把局部变化累积为整体数量。\n\n$$\\int_0^1 x\\,dx=\\frac12$$",
    source: "manual-paste"
  });

  const cards = new Map<string, CardResponse["card"]>();
  for (const type of ["concept", "example", "boundary", "process", "mistake"]) {
    const response = await postJson<CardResponse>(
      request,
      "/api/cards",
      cardInput(type, reading.reading.id)
    );
    cards.set(type, response.card);
  }
  const conceptCard = cards.get("concept");
  if (conceptCard === undefined) {
    throw new Error("Concept card was not created");
  }
  await makeDue(vaultPath, conceptCard.relativePath);
  await postJson(request, "/api/index/rebuild", { confirmed: true });

  const candidate = await postJson<{ candidate: { id: string } }>(
    request,
    "/api/verification/candidates",
    {
      cardId: conceptCard.id,
      statement: "定积分由黎曼和的极限定义。",
      proofAttempt: "当分割网格趋于零时，所有合法取样的黎曼和收敛到同一数值。",
      predecessorIds: [],
      relations: [],
      assistanceLevel: "none"
    }
  );
  await postJson(
    request,
    `/api/verification/candidates/${candidate.candidate.id}/verdict`,
    {
      verifierKind: "human-review",
      verificationReport: {
        summary: "陈述准确地区分了定义与计算工具。",
        criticalErrors: [],
        gaps: []
      },
      verdict: "correct",
      repairHints: "",
      confirmed: false
    }
  );

  const routes = [
    {
      label: "today",
      url: "/today",
      heading: "今日学习",
      ready: ".today-next-card",
      readyCount: 1
    },
    {
      label: "reader",
      url: `/reader?reading=${reading.reading.id}`,
      heading: "精读工作台",
      ready: '[data-testid="reader-surface"]',
      readyCount: 1
    },
    {
      label: "cards",
      url: `/cards?cardId=${conceptCard.id}`,
      heading: "卡片工作台",
      ready: ".recent-card-row",
      readyCount: 5
    },
    {
      label: "flywheel",
      url: "/graph?concept=%E7%A7%AF%E5%88%86&stage=concept",
      heading: "主题飞轮",
      ready: ".flywheel-stage-card",
      readyCount: 5
    },
    {
      label: "review",
      url: `/review?cardId=${conceptCard.id}&concept=%E7%A7%AF%E5%88%86`,
      heading: "今日复习",
      ready: ".review-card",
      readyCount: 1
    },
    {
      label: "diagnosis",
      url: "/diagnosis",
      heading: "卡点诊断",
      ready: ".diagnosis-form",
      readyCount: 1
    },
    {
      label: "verification",
      url: `/verification?cardId=${conceptCard.id}&evidenceId=${candidate.candidate.id}`,
      heading: "证据验证",
      ready: ".verification-review-gate",
      readyCount: 1
    }
  ] as const;

  for (const route of routes) {
    await page.goto(route.url);
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
    await expect(page.locator(route.ready)).toHaveCount(route.readyCount);
    for (const viewport of VIEWPORTS) {
      await capture(page, records, route.label, viewport);
    }
  }

  await page.goto("/graph?concept=%E7%A7%AF%E5%88%86&stage=concept");
  await expect(page.locator(".flywheel-stage-card")).toHaveCount(5);
  await capture(page, records, "flywheel", FLYWHEEL_SUPPLEMENTAL_VIEWPORT);

  await page.goto(
    `/verification?cardId=${conceptCard.id}&evidenceId=${candidate.candidate.id}`
  );
  await page.getByText("撤销这条已接受证据").click();
  await capture(page, records, "verification-advanced", VIEWPORTS[1]);

  await page.goto("/today");
  await page.getByRole("button", { name: "打开设置" }).click();
  await expect(page.getByRole("dialog", { name: "本地学习库设置" })).toBeVisible();
  for (const viewport of VIEWPORTS) {
    await capture(page, records, "settings", viewport);
  }
  await page.setViewportSize(VIEWPORTS[1]);
  await page.getByRole("button", { name: "显示高级设置" }).click();
  await capture(page, records, "settings-advanced", VIEWPORTS[1]);
  await page.getByRole("button", { name: "关闭" }).click();

  await page.route("**/api/review/today", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ generatedAt: "2026-07-17T00:00:00.000Z", items: [] }),
      contentType: "application/json",
      status: 200
    });
  });
  await page.goto("/review");
  await expect(page.getByText("今天没有到期卡片。")).toBeVisible();
  await capture(page, records, "review-empty", VIEWPORTS[2]);

  await page.route("**/api/today/next", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { message: "本地学习库暂时不可用" } }),
      contentType: "application/json",
      status: 503
    });
  });
  await page.goto("/today");
  await expect(page.getByText("本地学习库无法访问")).toBeVisible();
  await expect(page.getByText("打开设置", { exact: true })).toBeVisible();
  await capture(page, records, "today-error", VIEWPORTS[2]);

  await writeFile(
    join(EVIDENCE_DIRECTORY, "browser-production-evidence.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceMode: "production-dist-served-by-express",
        requiredViewports: VIEWPORTS,
        entranceScreenshots: VIEWPORTS.map(
          (viewport) =>
            `artifacts/total-recovery-browser-evidence-20260717/entrance-${viewport.width}x${viewport.height}.png`
        ),
        records
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  expect(records).toHaveLength((routes.length + 2) * VIEWPORTS.length + 5);
  expect(records.every((record) => !record.horizontalOverflow)).toBe(true);
});
