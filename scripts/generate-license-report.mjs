function npmPackageName(path, entry) {
  if (typeof entry.name === "string" && entry.name.length > 0) {
    return entry.name;
  }
  const marker = "node_modules/";
  const markerIndex = path.lastIndexOf(marker);
  return markerIndex === -1 ? path : path.slice(markerIndex + marker.length);
}

function tomlValue(block, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `^\\s*${escapedField}\\s*=\\s*"([^"]+)"\\s*$`,
    "mu"
  ).exec(block);
  return match?.[1] ?? null;
}

export function parseCargoLockPackages(cargoLock) {
  const packages = [];
  for (const block of cargoLock.split(/^\[\[package\]\]\s*$/mu).slice(1)) {
    const name = tomlValue(block, "name");
    const version = tomlValue(block, "version");
    if (name === null || version === null) continue;
    packages.push({
      checksum: tomlValue(block, "checksum"),
      ecosystem: "cargo",
      licenseDeclared: "NOASSERTION",
      name,
      optional: false,
      source: tomlValue(block, "source"),
      version
    });
  }
  return packages;
}

export function parseNpmProductionPackages(packageLock) {
  if (
    typeof packageLock !== "object" ||
    packageLock === null ||
    packageLock.lockfileVersion !== 3 ||
    typeof packageLock.packages !== "object" ||
    packageLock.packages === null
  ) {
    throw new Error("package-lock.json must use lockfileVersion 3 with a packages map");
  }

  const packages = [];
  for (const [path, entry] of Object.entries(packageLock.packages)) {
    if (
      path.length === 0 ||
      typeof entry !== "object" ||
      entry === null ||
      entry.dev === true ||
      entry.link === true ||
      typeof entry.version !== "string"
    ) {
      continue;
    }
    packages.push({
      checksum: typeof entry.integrity === "string" ? entry.integrity : null,
      ecosystem: "npm",
      licenseDeclared:
        typeof entry.license === "string" && entry.license.trim().length > 0
          ? entry.license.trim()
          : "NOASSERTION",
      name: npmPackageName(path, entry),
      optional: entry.optional === true,
      source: typeof entry.resolved === "string" ? entry.resolved : null,
      version: entry.version
    });
  }
  return packages;
}

function packageKey(entry) {
  return `${entry.ecosystem}\0${entry.name}\0${entry.version}`;
}

function packageSort(left, right) {
  const leftKey = packageKey(left);
  const rightKey = packageKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function createLicenseInventory({
  buildDate,
  cargoLock,
  nodeVersion,
  packageLock
}) {
  const dependencies = [
    ...parseNpmProductionPackages(packageLock),
    ...parseCargoLockPackages(cargoLock).filter(
      (entry) => entry.name !== "aleksi-workbench"
    ),
    {
      checksum: null,
      ecosystem: "runtime",
      licenseDeclared: "MIT",
      name: "Node.js",
      notice:
        "The release licenses directory includes the hash-verified official LICENSE and third-party notices matching this exact Node.js runtime.",
      officialLicenseUrl: `https://github.com/nodejs/node/blob/${nodeVersion}/LICENSE`,
      optional: false,
      source: "https://nodejs.org/",
      version: nodeVersion.replace(/^v/u, "")
    }
  ];

  const unique = new Map();
  for (const dependency of dependencies) {
    const key = packageKey(dependency);
    if (!unique.has(key)) unique.set(key, dependency);
  }
  const packages = [...unique.values()].sort(packageSort);
  const countsByEcosystem = Object.fromEntries(
    ["cargo", "npm", "runtime"].map((ecosystem) => [
      ecosystem,
      packages.filter((entry) => entry.ecosystem === ecosystem).length
    ])
  );

  return {
    schemaVersion: 1,
    generatedAt: buildDate,
    scope:
      "Lockfile-level declaration inventory for production npm dependencies, Cargo.lock packages, and the bundled Node.js runtime.",
    completeness: {
      exactUpstreamLicenseTextsBundled: false,
      exactBundledRuntimeLicenseIncluded: true,
      legalReviewRequiredBeforeExternalDistribution: true,
      note:
        "Declared license expressions are evidence inputs, not a legal conclusion. Cargo.lock does not carry crate license expressions, so Cargo entries remain NOASSERTION until an approved metadata/text collection step is added."
    },
    summary: {
      totalPackages: packages.length,
      noAssertion: packages.filter(
        (entry) => entry.licenseDeclared === "NOASSERTION"
      ).length,
      countsByEcosystem
    },
    packages
  };
}

function markdownCell(value) {
  return String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

export function createLicenseReadme(inventory) {
  return `# Dependency license evidence

Generated: ${inventory.generatedAt}

This directory is a deterministic lockfile-level license inventory for the Aleksi Workbench release. It is not a legal opinion and it does not claim that every required upstream license or notice text has been bundled.

- npm production packages: ${inventory.summary.countsByEcosystem.npm}
- Cargo.lock packages: ${inventory.summary.countsByEcosystem.cargo}
- Bundled runtimes: ${inventory.summary.countsByEcosystem.runtime}
- Entries with \`NOASSERTION\`: ${inventory.summary.noAssertion}

The exact, hash-verified Node.js runtime \`LICENSE\` is included beside this report. Before external distribution, review \`dependency-licenses.json\` and collect any additional exact upstream license or notice texts required for the locked npm and Cargo packages. The canonical release remains an unsigned preview.
`;
}

export function createThirdPartyNotices(inventory) {
  const rows = inventory.packages
    .map(
      (entry) =>
        `| ${markdownCell(entry.ecosystem)} | ${markdownCell(entry.name)} | ${markdownCell(entry.version)} | ${markdownCell(entry.licenseDeclared)} |`
    )
    .join("\n");
  return `# Third-party dependency declarations

This table reproduces license declarations available from locked metadata. \`NOASSERTION\` means the lockfile did not provide a declaration; it does not mean that no license applies.

| Ecosystem | Package | Version | Declared license |
| --- | --- | --- | --- |
${rows}
`;
}
