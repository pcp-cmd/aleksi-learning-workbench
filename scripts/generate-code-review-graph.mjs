import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const outputDir = path.join(root, "artifacts", "review");
const sourceEvidenceDir = path.join(root, "docs", "review");
const extensions = [".ts", ".tsx", ".mts", ".mjs", ".rs"];
const sourceRoots = ["scripts", "server", "shared", "src", "src-tauri/src"];
const ignored = new Set(["node_modules", "dist", "coverage", "artifacts", "test-results"]);

async function collect(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const relative = path.posix.join(directory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) files.push(...await collect(relative));
    else if (extensions.includes(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

const files = (await Promise.all(sourceRoots.map(collect))).flat().sort();
const fileSet = new Set(files);

function resolveLocal(source, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
  for (const candidate of [base, ...extensions.map((extension) => base + extension), ...extensions.map((extension) => path.posix.join(base, `index${extension}`))]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function layerOf(id) {
  if (id.startsWith("src-tauri/")) return "desktop";
  return id.split("/")[0];
}

function complexityOf(node) {
  let complexity = 1;
  const visit = (child) => {
    if (child !== node && (ts.isFunctionDeclaration(child) || ts.isMethodDeclaration(child) || ts.isArrowFunction(child) || ts.isFunctionExpression(child))) return;
    if (ts.isIfStatement(child) || ts.isForStatement(child) || ts.isForInStatement(child) || ts.isForOfStatement(child) || ts.isWhileStatement(child) || ts.isDoStatement(child) || ts.isConditionalExpression(child) || ts.isCaseClause(child) || ts.isCatchClause(child)) complexity += 1;
    if (ts.isBinaryExpression(child) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(child.operatorToken.kind)) complexity += 1;
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return complexity;
}

function analyzeTypeScript(id, text) {
  const kind = id.endsWith("x") ? ts.ScriptKind.TSX : id.endsWith("mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(id, text, ts.ScriptTarget.Latest, true, kind);
  const imports = [];
  const externalImports = new Set();
  const exports = new Set();
  const functions = [];
  const routes = [];
  const addImport = (value, typeOnly = false) => {
    const local = resolveLocal(id, value);
    if (local) imports.push({ target: local, typeOnly });
    else if (!value.startsWith(".")) externalImports.add(value);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addImport(node.moduleSpecifier.text, Boolean(node.importClause?.isTypeOnly));
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addImport(node.moduleSpecifier.text, Boolean(node.isTypeOnly));
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) addImport(node.arguments[0].text);
    if (ts.isExportAssignment(node)) exports.add("default");
    if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) && node.name?.text) exports.add(node.name.text);
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const name = node.name?.text ?? (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : null);
      if (name) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const end = source.getLineAndCharacterOfPosition(node.end).line + 1;
      functions.push({ file: id, name, kind: ts.isArrowFunction(node) ? "arrow" : "function", start, end, lines: end - start + 1, complexity: complexityOf(node) });
      }
    }
    if (ts.isJsxAttribute(node) && node.name.text === "path" && node.initializer && ts.isStringLiteral(node.initializer)) routes.push(node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports: [...new Map(imports.map((entry) => [`${entry.target}:${entry.typeOnly}`, entry])).values()], externalImports: [...externalImports].sort(), exports: [...exports].sort(), functions, routes };
}

function analyzeRust(id, text) {
  const imports = [];
  for (const match of text.matchAll(/^\s*(?:pub\s+)?mod\s+([a-zA-Z0-9_]+)\s*;/gm)) {
    const target = path.posix.join(path.posix.dirname(id), `${match[1]}.rs`);
    if (fileSet.has(target)) imports.push({ target, typeOnly: false });
  }
  const exports = [...text.matchAll(/^\s*pub\s+(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/gm)].map((match) => match[1]);
  const functions = [...text.matchAll(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/gm)].map((match) => ({ name: match[1], startLine: text.slice(0, match.index).split(/\r?\n/).length, complexity: 1 }));
  return { imports, externalImports: [], exports, functions, routes: [] };
}

const nodes = [];
const edges = [];
for (const id of files) {
  const text = await readFile(path.join(root, id), "utf8");
  const analysis = id.endsWith(".rs") ? analyzeRust(id, text) : analyzeTypeScript(id, text);
  for (const dependency of analysis.imports) edges.push({ source: id, target: dependency.target, typeOnly: dependency.typeOnly });
  nodes.push({ id, layer: layerOf(id), lines: text.split(/\r?\n/).length, bytes: Buffer.byteLength(text), inDegree: 0, outDegree: analysis.imports.length, pageRank: 0, betweenness: 0, exports: analysis.exports, functions: analysis.functions, functionCount: analysis.functions.length, routes: analysis.routes, todos: (text.match(/\b(?:TODO|FIXME)\b/g) ?? []).length, externalImports: analysis.externalImports });
}

const byId = new Map(nodes.map((node) => [node.id, node]));
const outgoing = new Map(nodes.map((node) => [node.id, []]));
const runtimeOutgoing = new Map(nodes.map((node) => [node.id, []]));
const incoming = new Map(nodes.map((node) => [node.id, []]));
for (const edge of edges) {
  outgoing.get(edge.source).push(edge.target);
  if (!edge.typeOnly) runtimeOutgoing.get(edge.source).push(edge.target);
  incoming.get(edge.target).push(edge.source);
  byId.get(edge.target).inDegree += 1;
}

let ranks = new Map(nodes.map((node) => [node.id, 1 / nodes.length]));
for (let round = 0; round < 40; round += 1) {
  const next = new Map(nodes.map((node) => [node.id, 0.15 / nodes.length]));
  for (const node of nodes) {
    const targets = outgoing.get(node.id);
    if (targets.length === 0) continue;
    for (const target of targets) next.set(target, next.get(target) + 0.85 * ranks.get(node.id) / targets.length);
  }
  ranks = next;
}
for (const node of nodes) node.pageRank = ranks.get(node.id);

// Brandes betweenness for this small, unweighted module graph.
for (const source of nodes.map((node) => node.id)) {
  const stack = [];
  const predecessors = new Map(nodes.map((node) => [node.id, []]));
  const sigma = new Map(nodes.map((node) => [node.id, 0]));
  const distance = new Map(nodes.map((node) => [node.id, -1]));
  sigma.set(source, 1); distance.set(source, 0);
  const queue = [source];
  while (queue.length) {
    const current = queue.shift(); stack.push(current);
    for (const target of outgoing.get(current)) {
      if (distance.get(target) < 0) { queue.push(target); distance.set(target, distance.get(current) + 1); }
      if (distance.get(target) === distance.get(current) + 1) { sigma.set(target, sigma.get(target) + sigma.get(current)); predecessors.get(target).push(current); }
    }
  }
  const dependency = new Map(nodes.map((node) => [node.id, 0]));
  while (stack.length) {
    const target = stack.pop();
    for (const predecessor of predecessors.get(target)) dependency.set(predecessor, dependency.get(predecessor) + sigma.get(predecessor) / sigma.get(target) * (1 + dependency.get(target)));
    if (target !== source) byId.get(target).betweenness += dependency.get(target);
  }
}

function stronglyConnectedComponents() {
  let index = 0;
  const stack = []; const onStack = new Set(); const indexes = new Map(); const lows = new Map(); const result = [];
  const visit = (id) => {
    indexes.set(id, index); lows.set(id, index); index += 1; stack.push(id); onStack.add(id);
    for (const target of runtimeOutgoing.get(id)) {
      if (!indexes.has(target)) { visit(target); lows.set(id, Math.min(lows.get(id), lows.get(target))); }
      else if (onStack.has(target)) lows.set(id, Math.min(lows.get(id), indexes.get(target)));
    }
    if (lows.get(id) === indexes.get(id)) {
      const component = []; let value;
      do { value = stack.pop(); onStack.delete(value); component.push(value); } while (value !== id);
      if (component.length > 1 || runtimeOutgoing.get(id).includes(id)) result.push(component.sort());
    }
  };
  for (const node of nodes) if (!indexes.has(node.id)) visit(node.id);
  return result;
}

// Deterministic weak components are transparent and reproducible; unlike the supplied
// review artifact, this does not pretend to reproduce an unspecified clustering model.
const unvisited = new Set(nodes.map((node) => node.id));
const communities = [];
while (unvisited.size) {
  const first = [...unvisited].sort()[0]; const queue = [first]; const members = []; unvisited.delete(first);
  while (queue.length) {
    const id = queue.shift(); members.push(id);
    for (const neighbor of [...outgoing.get(id), ...incoming.get(id)].sort()) if (unvisited.delete(neighbor)) queue.push(neighbor);
  }
  communities.push({ id: communities.length, size: members.length, nodes: members.sort() });
}

const layerEdgeCounts = new Map();
for (const edge of edges) {
  const key = `${layerOf(edge.source)} -> ${layerOf(edge.target)}`;
  layerEdgeCounts.set(key, (layerEdgeCounts.get(key) ?? 0) + 1);
}
const sortMetric = (field) => [...nodes].sort((a, b) => b[field] - a[field] || a.id.localeCompare(b.id)).slice(0, 20).map((node) => ({ id: node.id, [field]: node[field] }));
const runtimeCycles = stronglyConnectedComponents();
const graph = {
  meta: {
    project: "Aleksi Learning Workbench",
    version: "0.1.5-rc.1-remediated",
    generatedAt: new Date().toISOString(),
    analysisType: "Reproducible CRG-style static code knowledge graph",
    moduleNodes: nodes.length,
    moduleEdges: edges.length,
    typescriptFunctions: nodes.filter((node) => !node.id.endsWith(".rs")).reduce((sum, node) => sum + node.functionCount, 0),
    note: "Source-resolved static dependency edges; weak-component communities are deliberately labeled and do not claim equivalence to the baseline artifact's unspecified clustering model."
  },
  runtimeCycles,
  layerEdges: [...layerEdgeCounts].sort().map(([layers, count]) => ({ layers, count })),
  nodes,
  edges,
  communities,
  topInDegree: sortMetric("inDegree"),
  topOutDegree: sortMetric("outDegree"),
  topBetweenness: sortMetric("betweenness"),
  findings: []
};

const hotspotIds = ["src/features/reader/ReaderPage.tsx", "src/features/review/ReviewPage.tsx", "server/services/index-service.ts", "src-tauri/src/runtime.rs", "server/services/vault-service.ts", "src/features/verification/VerificationPage.tsx", "src/features/reader/ReadingForm.tsx"];
const hotspotRows = hotspotIds.map((id) => byId.get(id)).filter(Boolean).map((node) => `| \`${node.id}\` | ${node.lines} | ${node.functionCount} | ${node.inDegree} | ${node.outDegree} |`).join("\n");
const report = `# Aleksi Code Review Report — 0.1.5-rc.1 Remediated\n\nGenerated: ${graph.meta.generatedAt}\n\n## Summary\n\n- Modules: ${nodes.length}\n- Dependency edges: ${edges.length}\n- TypeScript/JavaScript functions: ${graph.meta.typescriptFunctions}\n- Runtime dependency cycles: ${runtimeCycles.length}\n- Weak dependency components: ${communities.length}\n\n## Hotspots after remediation\n\n| Module | Lines | Functions | In | Out |\n|---|---:|---:|---:|---:|\n${hotspotRows}\n\n## Highest in-degree\n\n${graph.topInDegree.slice(0, 10).map((entry) => `- \`${entry.id}\`: ${entry.inDegree}`).join("\n")}\n\n## Highest out-degree\n\n${graph.topOutDegree.slice(0, 10).map((entry) => `- \`${entry.id}\`: ${entry.outDegree}`).join("\n")}\n\n## Method boundary\n\nThe supplied baseline and this output both use source-resolved static module edges. The baseline did not identify its community algorithm, so this report uses deterministic weak components and does not present the community count as directly comparable. Function complexity remains available per node for TypeScript/JavaScript; Rust function complexity is intentionally not inferred by regex.\n`;

await mkdir(outputDir, { recursive: true });
await mkdir(sourceEvidenceDir, { recursive: true });
const jsonPath = path.join(outputDir, "Aleksi-Code-Review-Graph-0.1.5-rc.1-remediated.json");
const reportPath = path.join(outputDir, "Aleksi-Code-Review-Report-0.1.5-rc.1-remediated.md");
await writeFile(jsonPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
await writeFile(reportPath, report, "utf8");
await writeFile(path.join(sourceEvidenceDir, path.basename(jsonPath)), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
await writeFile(path.join(sourceEvidenceDir, path.basename(reportPath)), report, "utf8");
console.log(`Graph written: ${jsonPath}`);
console.log(`Report written: ${reportPath}`);
console.log(`Modules=${nodes.length} edges=${edges.length} cycles=${runtimeCycles.length}`);
if (runtimeCycles.length > 0) process.exitCode = 1;
