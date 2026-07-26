import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function spdxId(entry) {
  const safeName = entry.name.replace(/[^A-Za-z0-9.-]+/gu, "-");
  const safeVersion = entry.version.replace(/[^A-Za-z0-9.-]+/gu, "-");
  const suffix = sha256(
    `${entry.ecosystem}\0${entry.name}\0${entry.version}`
  ).slice(0, 12);
  return `SPDXRef-Package-${entry.ecosystem}-${safeName}-${safeVersion}-${suffix}`;
}

function npmPurl(name, version) {
  if (name.startsWith("@") && name.includes("/")) {
    const [namespace, packageName] = name.slice(1).split("/", 2);
    return `pkg:npm/%40${encodeURIComponent(namespace)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function packagePurl(entry) {
  if (entry.ecosystem === "npm") return npmPurl(entry.name, entry.version);
  if (entry.ecosystem === "cargo") {
    return `pkg:cargo/${encodeURIComponent(entry.name)}@${encodeURIComponent(entry.version)}`;
  }
  return `pkg:generic/${encodeURIComponent(entry.name.toLowerCase())}@${encodeURIComponent(entry.version)}`;
}

function spdxLicense(value) {
  if (
    typeof value !== "string" ||
    value === "NOASSERTION" ||
    !/^[A-Za-z0-9.+()-]+(?:\s+(?:AND|OR|WITH)\s+[A-Za-z0-9.+()-]+)*$/u.test(
      value
    )
  ) {
    return "NOASSERTION";
  }
  return value;
}

function packageDownloadLocation(entry) {
  return typeof entry.source === "string" && /^https?:\/\//u.test(entry.source)
    ? entry.source
    : "NOASSERTION";
}

export function createSpdxDocument({
  buildDate,
  identity,
  inputFingerprint,
  inventory,
  sourceState
}) {
  const applicationId = "SPDXRef-Package-Aleksi-Workbench";
  const dependencies = inventory.packages.map((entry) => ({
    SPDXID: spdxId(entry),
    name: entry.name,
    versionInfo: entry.version,
    downloadLocation: packageDownloadLocation(entry),
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: spdxLicense(entry.licenseDeclared),
    copyrightText: "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: packagePurl(entry)
      }
    ]
  }));
  const packages = [
    {
      SPDXID: applicationId,
      name: identity.displayName,
      versionInfo: identity.version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      supplier: `Organization: ${identity.company}`,
      primaryPackagePurpose: "APPLICATION"
    },
    ...dependencies
  ];
  const relationships = [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: applicationId
    },
    ...dependencies.map((dependency) => ({
      spdxElementId: applicationId,
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: dependency.SPDXID
    }))
  ];

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${identity.displayName}-${identity.version}`,
    documentNamespace: `https://spdx.aleksi.invalid/${identity.releaseSlug}/${identity.version}/${sourceState.commit}/${inputFingerprint.slice(0, 20)}`,
    creationInfo: {
      created: buildDate,
      creators: ["Tool: Aleksi deterministic release-evidence generator"]
    },
    documentDescribes: [applicationId],
    packages,
    relationships
  };
}
