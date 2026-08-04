import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const manifests = [
  "package.json",
  "apps/desktop/package.json",
  "apps/mobile/package.json",
  "packages/agent-runtime/package.json",
  "packages/engine-grok/package.json",
  "packages/engine-testkit/package.json",
  "packages/entitlement-client/package.json",
  "packages/gateway/package.json",
  "packages/license/package.json",
  "packages/provider-echo/package.json",
  "packages/provider-grok/package.json",
  "packages/shared/package.json",
  "services/remote-relay/package.json",
];

describe("workspace release version", () => {
  it("keeps every first-party manifest at 1.0.0", () => {
    expect(manifests).toHaveLength(13);
    for (const manifest of manifests) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, manifest), "utf8"),
      ) as { version?: string };
      expect(pkg.version, manifest).toBe("1.0.0");
    }
  });
});
