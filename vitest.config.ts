import { defineConfig } from "vitest/config";

// Root config for repo-level scripts tests (PATH: scripts/**/*.test.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts"],
  },
});
