import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ensures desktop dev/build always compile workspace deps before electron-vite.
 * Gateway imports license/agent-runtime/providers at runtime; a clean checkout
 * without this step fails with Cannot find module under packages/.../dist.
 *
 * We use pnpm's `@grokdesk/desktop^...` filter so the full dependency graph
 * (shared, license, agent-runtime, engine-*, providers, gateway, …) is built
 * in topological order without listing each package by hand.
 */
describe("desktop build scripts include workspace deps", () => {
  it("dev and build scripts topo-build desktop workspace dependencies", () => {
    // apps/desktop/src → apps/desktop/package.json
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "../package.json");
    expect(fs.existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const name of ["dev", "build"] as const) {
      const script = pkg.scripts[name] ?? "";
      // Must build deps of desktop (not desktop itself — that would recurse).
      expect(script).toMatch(/@grokdesk\/desktop\^\.\.\./);
      expect(script).toMatch(/\brun build\b/);
      // electron-vite must run after the workspace build.
      const filterIdx = script.search(/@grokdesk\/desktop\^\.\.\./);
      const viteIdx = script.indexOf("electron-vite");
      expect(filterIdx).toBeGreaterThanOrEqual(0);
      expect(viteIdx).toBeGreaterThan(filterIdx);
    }
  });

  it("desktop depends on license and gateway so ^... pulls them in", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    expect(deps["@grokdesk/license"]).toMatch(/workspace:/);
    expect(deps["@grokdesk/gateway"]).toMatch(/workspace:/);
  });

  it("gateway package depends on license (runtime import)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const gwPkgPath = path.resolve(
      here,
      "../../../packages/gateway/package.json",
    );
    expect(fs.existsSync(gwPkgPath)).toBe(true);
    const gw = JSON.parse(fs.readFileSync(gwPkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(gw.dependencies?.["@grokdesk/license"]).toMatch(/workspace:/);
  });

  it("gateway tsconfig references the license package", () => {
    // apps/desktop/src → repo root → packages/gateway/tsconfig.json
    const here = path.dirname(fileURLToPath(import.meta.url));
    const tsconfigPath = path.resolve(
      here,
      "../../../packages/gateway/tsconfig.json",
    );
    expect(fs.existsSync(tsconfigPath)).toBe(true);
    const ts = JSON.parse(fs.readFileSync(tsconfigPath, "utf8")) as {
      references?: Array<{ path: string }>;
    };
    const paths = (ts.references ?? []).map((r) => r.path);
    expect(paths.some((p) => p.includes("license"))).toBe(true);
  });
});
