import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
      "@grokdesk/shared": resolve(
        __dirname,
        "../../packages/shared/dist/index.js",
      ),
      "@grokdesk/license": resolve(
        __dirname,
        "../../packages/license/dist/index.js",
      ),
      "@grokdesk/entitlement-client": resolve(
        __dirname,
        "../../packages/entitlement-client/dist/index.js",
      ),
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    setupFiles: ["src/test/setup-jsdom.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
