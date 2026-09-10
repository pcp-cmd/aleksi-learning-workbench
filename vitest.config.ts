import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
      thresholds: {
        // Vitest 4 uses a more accurate AST-based V8 coverage mapping than the
        // previous release line, so preserve the post-migration measured
        // branch baseline instead of comparing the new metric to the old one.
        branches: 74.5,
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
