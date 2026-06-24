import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/**/*.test.ts",
      "client/**/*.spec.ts",
      "packaging/**/*.test.ts",
      "packaging/**/*.spec.ts",
    ],
    exclude: ["**/node_modules/**", "**/node_modules_broken/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      // `pnpm test` stays fast; coverage is opt-in via `pnpm test:coverage`.
      enabled: false,
      reporter: ["text-summary", "text", "html", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      // Measure the hand-written source only. Generated SQL, build output, type
      // declarations, test files/helpers and config are excluded so the numbers
      // reflect real, testable logic.
      include: ["server/**/*.ts", "client/src/**/*.{ts,tsx}", "shared/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/__tests__/**",
        "**/*.d.ts",
        "server/python_bridges/**",
        "server/scripts/**",
        "drizzle/**",
        "**/dist/**",
      ],
      // Floor, not a target: set to the current baseline so coverage can only
      // ratchet up. Raise these as new suites land (see CLAUDE.md "Build
      // Complete" directive — coverage is part of building features fully).
      thresholds: {
        lines: 9,
        functions: 6,
        branches: 6,
        statements: 9,
      },
    },
  },
});
