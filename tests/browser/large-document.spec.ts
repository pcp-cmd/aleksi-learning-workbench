import { expect, test } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { DOCUMENT_IMPORT_PART_BYTES } from "../../shared/document-limits";

function largeBook(): Buffer {
  const chapters = Array.from({ length: 180 }, (_, index) => [
    `# 第 ${index + 1} 章`,
    "",
    `${"本章正文用于验证大型 Markdown 的增量读取。".repeat(260)}`,
    "",
    `唯一标记 large-browser-marker-${index + 1}`,
    ""
  ].join("\n"));
  return Buffer.from(chapters.join("\n"), "utf8");
}

test("opens and searches a large Markdown document without mounting the complete DOM", async ({
  page,
  request
}, testInfo) => {
  const vaultPath = testInfo.outputPath("large-vault");
  await rm(vaultPath, { force: true, recursive: true });
  await mkdir(vaultPath, { recursive: true });
  expect((await request.post("/api/vault/initialize", {
    data: { path: vaultPath }
  })).ok()).toBe(true);

  const source = largeBook();
  expect(source.byteLength).toBeGreaterThan(1_900_000);
  const created = await request.post("/api/document-imports", {
    data: {
      fileName: "large-browser-book.md",
      expectedBytes: source.byteLength,
      title: "浏览器大型教材",
      concept: "大文档"
    }
  });
  expect(created.ok()).toBe(true);
  const sessionId = ((await created.json()) as {
    session: { sessionId: string };
  }).session.sessionId;
  for (let offset = 0; offset < source.byteLength; offset += DOCUMENT_IMPORT_PART_BYTES) {
    const part = source.subarray(
      offset,
      Math.min(source.byteLength, offset + DOCUMENT_IMPORT_PART_BYTES)
    );
    const uploaded = await request.put(
      `/api/document-imports/${sessionId}/parts?offset=${offset}`,
      { data: part, headers: { "Content-Type": "application/octet-stream" } }
    );
    expect(uploaded.ok()).toBe(true);
  }
  const finalized = await request.post(
    `/api/document-imports/${sessionId}/finalize`,
    { data: {} }
  );
  expect(finalized.ok()).toBe(true);
  const documentId = ((await finalized.json()) as {
    reading: { documentId: string };
  }).reading.documentId;

  await page.goto(`/reader?reading=${documentId}`);
  await expect(page.getByText("大型材料 · 分节载入", { exact: false })).toBeVisible();
  await expect(page.getByText("完整目录 · 180 个主章节")).toBeVisible();
  await expect.poll(() => page.locator(".document-chunk").count()).toBeLessThanOrEqual(3);
  await page.evaluate(() => {
    const root = document.querySelector("#root") as HTMLElement & { documentProbe?: string };
    root.documentProbe = "preserved";
  });

  await page.getByText("全文搜索", { exact: true }).click();
  const searchInput = page.getByLabel("搜索完整材料");
  await searchInput.fill("large-browser-marker-180");
  await searchInput.press("Enter");
  const result = page.getByText("large-browser-marker-180", { exact: false });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByTestId("reader-surface")).toContainText(
    "large-browser-marker-180"
  );
  await expect.poll(() => page.locator(".document-chunk").count()).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() =>
    (document.querySelector("#root") as HTMLElement & { documentProbe?: string })
      .documentProbe
  )).toBe("preserved");
});
