// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { queryClient } from "../../src/app/query-client";
import { PRIMARY_ROUTES } from "../../src/app/route-registry";
import { apiClient } from "../../src/lib/api-client";

const ROUTE_LABELS = [
  "今日学习",
  "精读工作台",
  "卡片工作台",
  "主题飞轮",
  "今日复习"
];
const ROUTE_SHORT_LABELS = ["今日", "精读", "卡片", "飞轮", "复习"];
const ROUTE_NUMBERS = ["01", "02", "03", "04", "05"];

afterEach(() => {
  queryClient.clear();
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
});

describe("reading-first app shell", () => {
  it("redirects an ordinary root visit directly to Today", async () => {
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/today"));
    expect(screen.getByRole("heading", { name: "今日学习" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "进入学习器" })).not.toBeInTheDocument();
  });

  it("renders the five learning routes while keeping verification contextual", () => {
    window.history.pushState({}, "", "/today");
    render(<App />);

    const nav = screen.getByRole("navigation", { name: "学习模块" });
    const brandLink = within(nav).getByRole("link", {
      name: "Aleksi Learning Workbench, back to Today"
    });
    expect(brandLink).toHaveAttribute("href", "/today");
    expect(brandLink).toHaveAttribute("title", "Aleksi Learning Workbench · Back to Today");
    expect(brandLink.querySelector(".flywheel-brand-mark")).not.toBeInTheDocument();
    expect(within(brandLink).getByText("A")).toBeInTheDocument();
    expect(within(brandLink).getByText("Aleksi")).toBeInTheDocument();
    expect(within(brandLink).getByText("Workbench")).toBeInTheDocument();

    const routeRail = nav.querySelector(".rail-links");
    expect(routeRail).not.toBeNull();
    const links = within(routeRail as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(within(nav).queryByRole("link", { name: "证据验证" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "验证" })).not.toBeInTheDocument();
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(ROUTE_LABELS);
    for (const [index, link] of links.entries()) {
      expect(within(link).getByText(ROUTE_NUMBERS[index])).toBeInTheDocument();
      expect(within(link).getByText(ROUTE_SHORT_LABELS[index])).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "今日学习" })).toBeInTheDocument();

    expect(screen.queryByLabelText("上下文状态")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "上下文说明" })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上下文说明" })).not.toBeInTheDocument();
  });

  it("exposes the default main routes and shared API/query clients", () => {
    expect(PRIMARY_ROUTES.map((route) => route.path)).toEqual([
      "/today",
      "/reader",
      "/cards",
      "/graph",
      "/review"
    ]);
    expect(PRIMARY_ROUTES.map((route) => route.label)).toEqual(ROUTE_LABELS);
    const readerRoute = PRIMARY_ROUTES.find((route) => route.path === "/reader");
    expect(readerRoute?.description).toContain("阅读优先");
    expect(readerRoute?.description).toContain("响应式");
    expect(readerRoute?.description).not.toContain("760px");
    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      refetchOnWindowFocus: false,
      retry: false
    });
    expect(apiClient.get).toEqual(expect.any(Function));
    expect(apiClient.post).toEqual(expect.any(Function));
  });

  it("protects the light paper workbench tokens and geometry CSS", async () => {
    const root = process.cwd();
    const [app, fonts, tokens, workbench, primitives, components, reader, cards, flywheel] = await Promise.all([
      readFile(join(root, "src/app/App.tsx"), "utf8"),
      readFile(join(root, "src/styles/fonts.css"), "utf8"),
      readFile(join(root, "src/styles/tokens.css"), "utf8"),
      readFile(join(root, "src/styles/workbench.css"), "utf8"),
      readFile(join(root, "src/styles/primitives.css"), "utf8"),
      readFile(join(root, "src/styles/components.css"), "utf8"),
      readFile(join(root, "src/features/reader/reader.css"), "utf8"),
      readFile(join(root, "src/features/cards/cards.css"), "utf8"),
      readFile(join(root, "src/features/graph/flywheel.css"), "utf8")
    ]);
    const activeCss = [workbench, primitives, components, reader, cards, flywheel].join("\n");

    expect(app).toContain('import "../styles/fonts.css"');
    expect(app).not.toContain("if (import.meta.env.DEV)");
    expect(app).not.toContain('void import("../styles/fonts.css")');
    expect(fonts).toContain('font-family: "Anthropic Serif Web Text";');
    expect(fonts).toContain('url("/fonts/claude/c66fc489e-C-BHYa_K.ttf")');
    expect(fonts).toContain('font-family: "Anthropic Sans Web Text";');
    expect(fonts).toContain('font-family: "Anthropic Mono Variable";');

    expect(tokens).toContain("--canvas: #f7f1e6;");
    expect(tokens).toContain("--paper: #fffaf0;");
    expect(tokens).not.toContain("--bg:");
    expect(tokens).not.toContain("--surface:");
    expect(tokens).toContain("--surface-raised: #fffdf7;");
    expect(tokens).toContain("--surface-active: #f3e4d5;");
    expect(tokens).toContain("--text-primary: #25211c;");
    expect(tokens).toContain("--text-secondary: #3a332b;");
    expect(tokens).toContain("--text-tertiary: #6f6558;");
    expect(tokens).toContain("--border-subtle: #dfd2bf;");
    expect(tokens).toContain("--border-strong: #cdbba3;");
    expect(tokens).toContain("--accent: #b66a3c;");
    expect(tokens).toContain("--accent-muted: #ead2bd;");
    expect(tokens).toContain("--warning: #8b5b26;");
    expect(tokens).toContain("--trust-supported: var(--success);");
    expect(tokens).toContain("--trust-review: #527ba2;");
    expect(tokens).toContain("--trust-revoked: #9a5549;");
    expect(tokens).not.toContain("--bg: #10100d;");
    expect(tokens).not.toContain("--surface: #171711;");
    expect(tokens).toContain("--radius-sm: 10px;");
    expect(tokens).toContain("--radius-md: 16px;");
    expect(tokens).toContain("--radius-lg: 24px;");
    expect(tokens).toContain("--article-main: 760px;");
    expect(tokens).toContain('"Anthropic Serif Web Text"');
    expect(tokens).toContain('"Anthropic Sans Web Text"');
    expect(tokens).toContain('"Anthropic Mono Variable"');
    expect(tokens).toContain('"Microsoft YaHei"');
    expect(tokens).toContain('"Cascadia Mono"');
    expect(tokens).toContain("--font-mono:");

    expect(workbench).toContain("width: 80px;");
    expect(workbench).toContain("margin-left: 80px;");
    expect(workbench).not.toContain(".action-band {");
    expect(workbench).not.toContain(".context-drawer {");
    expect(workbench).toContain(".launch-splash");
    expect(workbench).not.toContain(".entrance-button");
    expect(workbench).not.toContain("writing-mode: vertical-rl;");
    expect(workbench).not.toContain("backdrop-filter: blur");
    expect(workbench).toContain(".rail-link.is-active::before");
    expect(workbench).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
    expect(workbench).not.toContain(".action-band__cell--primary");

    expect(primitives).toContain(".surface-static");
    expect(primitives).toContain(".surface-interactive:hover");
    expect(reader).toContain(".reader-paper");
    expect(cards).toContain(".card-editor__step--source");
    expect(flywheel).toContain(".flywheel-stage-position--concept");
    expect(primitives).toContain("width: 8px;");
    expect(primitives).toContain("height: 8px;");
    expect(primitives).toContain("@media (prefers-reduced-motion: reduce)");
    for (const alias of ["--bg", "--clay", "--surface", "--text-strong", "--line"]) {
      expect(activeCss).not.toContain(`var(${alias})`);
    }
    expect(activeCss).not.toContain(".claude-card");
    expect(activeCss).not.toContain("!important");
  });
});
