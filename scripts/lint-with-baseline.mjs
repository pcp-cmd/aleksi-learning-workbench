import { relative } from "node:path";
import { ESLint } from "eslint";

const EXPECTED_WARNINGS = new Map([
  ["src/features/cards/CardStudioPage.tsx", 1],
  ["src/features/diagnosis/DiagnosisPage.tsx", 1],
  ["src/features/graph/WheelGraphPage.tsx", 1],
  ["src/features/reader/DocumentReader.tsx", 2],
  ["src/features/review/ReviewPage.tsx", 4],
  ["src/features/verification/VerificationPage.tsx", 3],
  ["src/features/verification/verification-draft-state.ts", 1]
]);

const eslint = new ESLint();
const results = await eslint.lintFiles(["."]);
const formatter = await eslint.loadFormatter("stylish");
const errors = results.flatMap((result) =>
  result.messages
    .filter((message) => message.severity === 2)
    .map((message) => ({ result, message }))
);
const warnings = results.flatMap((result) =>
  result.messages
    .filter((message) => message.severity === 1)
    .map((message) => ({ result, message }))
);

if (errors.length > 0) {
  console.error(await formatter.format(results));
  process.exitCode = 1;
} else {
  const actualCounts = new Map();
  const unexpected = [];

  for (const warning of warnings) {
    const path = relative(process.cwd(), warning.result.filePath).replaceAll("\\", "/");
    if (
      warning.message.ruleId !== "react-hooks/exhaustive-deps" ||
      !EXPECTED_WARNINGS.has(path)
    ) {
      unexpected.push(warning);
      continue;
    }
    actualCounts.set(path, (actualCounts.get(path) ?? 0) + 1);
  }

  const baselineDrift = [];
  for (const [path, expectedCount] of EXPECTED_WARNINGS) {
    const actualCount = actualCounts.get(path) ?? 0;
    if (actualCount !== expectedCount) {
      baselineDrift.push(`${path}: expected ${expectedCount}, received ${actualCount}`);
    }
  }

  if (unexpected.length > 0 || baselineDrift.length > 0) {
    console.error(await formatter.format(results));
    if (baselineDrift.length > 0) {
      console.error("Lint baseline drift:\n" + baselineDrift.join("\n"));
    }
    if (unexpected.length > 0) {
      console.error(`Unexpected lint warnings: ${unexpected.length}`);
    }
    process.exitCode = 1;
  } else {
    if (warnings.length > 0) {
      console.log(await formatter.format(results));
    }
    console.log(
      `Lint passed with ${warnings.length} explicitly scoped legacy hook warnings; any new warning fails the gate.`
    );
  }
}
