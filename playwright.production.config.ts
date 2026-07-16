import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const runtimeDirectory = join(
  process.cwd(),
  "test-results",
  "total-recovery-production-runtime"
);

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "total-recovery.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium-production",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "npm run start",
    env: {
      ALEKSI_APP_SETTINGS_DIR: join(runtimeDirectory, "app-settings"),
      ALEKSI_DEFAULT_VAULT_PATH: join(runtimeDirectory, "default-vault"),
      ALEKSI_SERVER_PORT: "4173",
      ALEKSI_STATIC_DIST_DIR: join(process.cwd(), "dist")
    },
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
