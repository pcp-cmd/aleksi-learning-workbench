import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
      thresholds: {
        branches: 80,
        functions: 87,
        lines: 78,
        statements: 78
      }
    },
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    maxWorkers: 4,
    restoreMocks: true
  }
});
