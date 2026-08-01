#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "docs/current/CURRENT_CONTRACT.md");
const checkOnly = process.argv.includes("--check");

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await read(relativePath));
}

function fail(message) {
  throw new Error(`Current contract generation failed: ${message}`);
}

function cargoPackageMetadata(source) {
  const packageSection = source.match(
    /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/mu
  )?.[1];
  if (packageSection === undefined) {
    fail("src-tauri/Cargo.toml is missing [package]");
  }
  const value = (key) =>
    packageSection.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`, "mu"))?.[1];
  const name = value("name");
  const version = value("version");
  if (name === undefined || version === undefined) {
    fail("src-tauri/Cargo.toml package name/version is missing");
  }
  return { name, version };
}

function unwrapExpression(node) {
  if (
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return unwrapExpression(node.expression);
  }
  return node;
}

function propertyName(node) {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  ) {
    return node.text;
  }
  fail(`unsupported property name: ${node.getText()}`);
}

function literalValue(node) {
  const value = unwrapExpression(node);
  if (ts.isStringLiteral(value) || ts.isNumericLiteral(value)) {
    return value.text;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (value.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  fail(`unsupported literal value: ${value.getText()}`);
}

function objectRecord(node) {
  const value = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(value)) {
    fail(`expected object literal, found ${value.getText()}`);
  }
  const record = {};
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const name = propertyName(property.name);
    if (["path", "label", "visibility", "position"].includes(name)) {
      record[name] = literalValue(property.initializer);
    }
  }
  return record;
}

function routeContract(source) {
  const file = ts.createSourceFile(
    "route-registry.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let registry;
  file.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) {
      return;
    }
    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "APP_ROUTE_REGISTRY" &&
        declaration.initializer !== undefined
      ) {
        registry = unwrapExpression(declaration.initializer);
      }
    }
  });
  if (registry === undefined || !ts.isArrayLiteralExpression(registry)) {
    fail("APP_ROUTE_REGISTRY is not an array literal");
  }
  const routes = registry.elements.map(objectRecord);
  if (
    routes.length === 0 ||
    routes.some(
      (route) =>
        typeof route.path !== "string" ||
        typeof route.label !== "string" ||
        typeof route.visibility !== "string"
    )
  ) {
    fail("route registry contains an incomplete route contract");
  }
  return routes;
}

function overviewContract(source) {
  const file = ts.createSourceFile(
    "OverviewGlyph.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let path;
  let durationMs;
  let speed;
  let loop;

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (
        node.name.text === "OVERVIEW_MOTION_PATH" &&
        node.initializer !== undefined
      ) {
        path = literalValue(node.initializer);
      }
      if (
        node.name.text === "OVERVIEW_SOURCE_DURATION_MS" &&
        node.initializer !== undefined
      ) {
        durationMs = Number(literalValue(node.initializer));
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setSpeed" &&
      node.arguments[0] !== undefined
    ) {
      speed = Number(literalValue(node.arguments[0]));
    }
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "loop") {
      loop = literalValue(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);

  if (
    typeof path !== "string" ||
    !Number.isFinite(durationMs) ||
    !Number.isFinite(speed) ||
    typeof loop !== "boolean"
  ) {
    fail("overview motion constants are incomplete");
  }
  return { durationMs, loop, path, speed };
}

async function importStandaloneTypeScript(source, filename) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

async function launchContract(machineSource, tokenSource) {
  const [machine, token] = await Promise.all([
    importStandaloneTypeScript(machineSource, "launch-machine.ts"),
    importStandaloneTypeScript(tokenSource, "launch-token.ts")
  ]);
  const animations = [
    "loading",
    "playing",
    "complete",
    "unavailable",
    "reduced"
  ];
  const services = ["starting", "ready", "failed"];
  const canEnter = (animation, service, directEntryRequested) =>
    machine.launchCanEnter({
      animation,
      service,
      directEntryRequested,
      failure: service === "failed" ? "failure" : null
    });

  const terminalVisualStates = animations.filter((animation) =>
    canEnter(animation, "ready", false)
  );
  const serviceGateRequired = services
    .filter((service) => service !== "ready")
    .every((service) =>
      animations.every(
        (animation) =>
          !canEnter(animation, service, false) &&
          !canEnter(animation, service, true)
      )
    );
  const directEntryBypassesOnlyVisualGate = animations.every((animation) =>
    canEnter(animation, "ready", true)
  );

  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
  const tokenRootOnly =
    token.readLaunchToken("/?launch=contract-token") === "contract-token" &&
    token.readLaunchToken("/today?launch=contract-token") === null;
  const tokenSingleUse =
    token.consumeLaunchToken("contract-token", storage) === true &&
    token.consumeLaunchToken("contract-token", storage) === false;

  if (
    !serviceGateRequired ||
    !directEntryBypassesOnlyVisualGate ||
    !tokenRootOnly ||
    !tokenSingleUse ||
    terminalVisualStates.join(",") !== "complete,unavailable,reduced"
  ) {
    fail("launch state-machine semantics no longer match the documented dual gate");
  }
  return {
    directEntryBypassesOnlyVisualGate,
    serviceGate: "ready",
    terminalVisualStates,
    tokenRootOnly,
    tokenSingleUse
  };
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function routeRows(routes) {
  return routes
    .map((route) => {
      const order =
        route.visibility === "primary" ? String(route.position ?? "") : "—";
      return `| ${order} | \`${markdownCell(route.path)}\` | ${markdownCell(
        route.visibility
      )} | ${markdownCell(route.label)} |`;
    })
    .join("\n");
}

const [
  packageJson,
  identity,
  tauri,
  cargoSource,
  routeSource,
  launchMachineSource,
  launchTokenSource,
  overviewSource
] = await Promise.all([
  readJson("package.json"),
  readJson("release/identity.json"),
  readJson("src-tauri/tauri.conf.json"),
  read("src-tauri/Cargo.toml"),
  read("src/app/route-registry.tsx"),
  read("src/features/entrance/launch-machine.ts"),
  read("src/features/entrance/launch-token.ts"),
  read("src/features/entrance/OverviewGlyph.tsx")
]);

const cargo = cargoPackageMetadata(cargoSource);
const routes = routeContract(routeSource);
const overview = overviewContract(overviewSource);
const launch = await launchContract(launchMachineSource, launchTokenSource);

for (const [source, version] of [
  ["package.json", packageJson.version],
  ["release/identity.json", identity.version],
  ["src-tauri/tauri.conf.json", tauri.version],
  ["src-tauri/Cargo.toml", cargo.version]
]) {
  if (version !== identity.version) {
    fail(`${source} version ${version ?? "missing"} != ${identity.version}`);
  }
}
if (
  tauri.productName !== identity.displayName ||
  tauri.identifier !== identity.identifier ||
  tauri.bundle?.publisher !== identity.publisher
) {
  fail("Tauri product identity differs from release/identity.json");
}
if (
  tauri.bundle?.windows?.webviewInstallMode?.type !==
  identity.webView2?.installMode
) {
  fail("Tauri WebView2 mode differs from release/identity.json");
}

const output = `# ${identity.displayName} Current Contract

> Generated by \`npm run generate:current-contract\`. Do not edit this file by hand.
> The generator validates the sources listed below and fails instead of silently reconciling conflicting values.

## Product and release identity

| Field | Current value |
|---|---|
| Candidate version | \`${identity.version}\` |
| Display name | ${identity.displayName} |
| Short name | ${identity.shortName} |
| Application identifier | \`${identity.identifier}\` |
| Rust package | \`${cargo.name}\` |
| Executable | \`${identity.executableName}\` |
| Installer | \`${identity.installerFilename}\` |
| Release directory | \`${identity.releaseDirectory}\` |
| Canonical installer path | \`${identity.releaseDirectory}/${identity.installerFilename}\` |
| Local protocol | \`${identity.localProtocolVersion}\` |
| Project schema | \`${identity.projectSchemaVersion}\` |

<!-- current-contract:historical-table:start -->
| Historical compatibility field | Pinned value |
|---|---|
| Upgrade predecessor | \`${identity.upgradeFromVersion}\` |
| Predecessor installer | \`${identity.upgradeFrom.installerFilename}\` |
<!-- current-contract:historical-table:end -->

## Startup contract

The application uses a dual gate. The local service must be \`${launch.serviceGate}\`.
Natural entry additionally waits for the real animation completion callback. “直接进入”
bypasses only the visual gate and never bypasses service readiness. A service failure keeps
entry blocked and visible.

| Startup field | Current value |
|---|---|
| Accepted motion asset | \`${overview.path}\` |
| Source duration | ${overview.durationMs.toLocaleString("en-US")} ms |
| Playback speed | \`setSpeed(${overview.speed})\` |
| Loop | \`loop: ${overview.loop}\` |
| Terminal visual states | ${launch.terminalVisualStates.map((state) => `\`${state}\``).join(", ")} |
| Browser launch token | Root route only; single use per session token |
| Desktop presentation | Once per native window session; safe route restored after the gate |
| Reduced motion / unavailable asset | Truthful static terminal visual state; service gate still required |

## Route registry

The primary user path remains Today → Reader → Cards → Flywheel → Review.
Contextual and advanced tools remain available and are not removed.

| Order | Path | Visibility | User label |
|---:|---|---|---|
${routeRows(routes)}

## Signing and WebView2

| Field | Current value |
|---|---|
| Signing status | \`${identity.signing.status}\` |
| Signing metadata only | \`${identity.signing.metadataOnly}\` |
| Legal publisher status | \`${identity.signing.legalPublisherStatus}\` |
| WebView2 policy | \`${identity.webView2.policy}\` |
| Tauri install mode | \`${identity.webView2.installMode}\` |
| Network required when WebView2 is missing | \`${identity.webView2.networkRequiredWhenMissing}\` |
| NSIS install scope | \`${tauri.bundle.windows.nsis.installMode}\` |

This candidate is not a signed stable release. Its current \`${identity.webView2.policy}\`
policy may require network access on first installation when WebView2 is absent.
The installer carries a bundled Node runtime. End users do not need Node.js,
Visual Studio, Visual Studio Build Tools, Rust, the Windows SDK, or VS Code to run it.
Those native build tools are developer/CI dependencies only.

## Machine-readable sources

- \`package.json\`
- \`release/identity.json\`
- \`src-tauri/Cargo.toml\`
- \`src-tauri/tauri.conf.json\`
- \`src/features/entrance/launch-machine.ts\`
- \`src/features/entrance/launch-token.ts\`
- \`src/features/entrance/OverviewGlyph.tsx\`
- \`src/app/route-registry.tsx\`
`;

if (checkOnly) {
  let current;
  try {
    current = await readFile(outputPath, "utf8");
  } catch {
    fail("docs/current/CURRENT_CONTRACT.md is missing; run npm run generate:current-contract");
  }
  if (current !== output) {
    fail("docs/current/CURRENT_CONTRACT.md is stale; run npm run generate:current-contract");
  }
  console.log("Current contract is synchronized.");
} else {
  await writeFile(outputPath, output, "utf8");
  console.log("Wrote docs/current/CURRENT_CONTRACT.md");
}
