import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GROKDESK_VERSION } from "./index.js";

describe("GROKDESK_VERSION", () => {
  it("matches monorepo root package.json version", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // packages/shared/src → monorepo root
    const rootPkg = path.resolve(here, "../../../package.json");
    const { version } = JSON.parse(readFileSync(rootPkg, "utf8")) as {
      version: string;
    };
    expect(GROKDESK_VERSION).toBe(version);
    expect(GROKDESK_VERSION).toBe("1.0.0");
  });
});
