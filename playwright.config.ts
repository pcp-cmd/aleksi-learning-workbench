import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const browserRuntimeDirectory = join(
  process.cwd(),
  "test-results",
  "browser-runtime"
);

export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: "total-recovery.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "npm run dev",
    env: {
      ALEKSI_APP_SETTINGS_DIR: join(browserRuntimeDirectory, "app-settings"),
      ALEKSI_DEFAULT_VAULT_PATH: join(browserRuntimeDirectory, "default-vault")
    },
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
