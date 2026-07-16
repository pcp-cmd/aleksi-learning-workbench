import packageJson from "../../package.json";

const IDENTITY_VALUE = /^[a-z0-9.-]+$/u;

export type BuildIdentity = {
  version: string;
  buildId: string;
};

function identityValue(
  name: "ALEKSI_APP_VERSION" | "ALEKSI_BUILD_ID",
  value: string
): string {
  if (!IDENTITY_VALUE.test(value)) {
    throw new Error(
      `${name} must contain only lowercase ASCII letters, digits, dots, and hyphens`
    );
  }

  return value;
}

export function runtimeBuildIdentity(
  env: Record<string, string | undefined> = process.env
): BuildIdentity {
  const version = identityValue(
    "ALEKSI_APP_VERSION",
    env.ALEKSI_APP_VERSION ?? packageJson.version
  );
  const buildId = identityValue(
    "ALEKSI_BUILD_ID",
    env.ALEKSI_BUILD_ID ?? `dev-${packageJson.version}`
  );

  return { version, buildId };
}
