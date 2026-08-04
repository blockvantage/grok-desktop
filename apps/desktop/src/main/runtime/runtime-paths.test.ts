import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertNoSymlinkEscape,
  assertPathUnderRoot,
  assertSafeRuntimeVersion,
  currentPointerPath,
  ensureRuntimeLayout,
  grokRuntimeRoot,
  installationJsonPath,
  isStagingOrQuarantinePath,
  quarantineDir,
  runtimeBinary,
  runtimeBinaryName,
  runtimeVersionDir,
  stagingDir,
} from "./runtime-paths.js";

describe("runtime-paths", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-runtime-paths-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runtimeBinary path layout under userData", () => {
    expect(runtimeBinary(root, "0.9.4", "darwin-arm64")).toBe(
      path.join(root, "runtimes/grok/0.9.4/darwin-arm64/grok"),
    );
    expect(runtimeBinary(root, "0.9.4", "win32-x64")).toBe(
      path.join(root, "runtimes/grok/0.9.4/win32-x64/grok.exe"),
    );
    expect(runtimeBinary(root, "1.0.0-beta.1", "darwin-x64")).toBe(
      path.join(root, "runtimes/grok/1.0.0-beta.1/darwin-x64/grok"),
    );
  });

  it("rejects path traversal versions", () => {
    expect(() => runtimeBinary(root, "../escape", "darwin-arm64")).toThrowError(
      "invalid_runtime_version",
    );
    expect(() =>
      runtimeBinary(root, "0.9.4/../../etc", "darwin-arm64"),
    ).toThrowError("invalid_runtime_version");
    expect(() => runtimeBinary(root, "..", "darwin-arm64")).toThrowError(
      "invalid_runtime_version",
    );
    expect(() => runtimeBinary(root, "foo\\bar", "darwin-arm64")).toThrowError(
      "invalid_runtime_version",
    );
    expect(() => assertSafeRuntimeVersion("")).toThrowError(
      "invalid_runtime_version",
    );
    expect(() => assertSafeRuntimeVersion(".hidden")).toThrowError(
      "invalid_runtime_version",
    );
  });

  it("rejects unknown targets", () => {
    expect(() => runtimeBinary(root, "0.9.4", "linux-x64")).toThrowError(
      /invalid_runtime_target/,
    );
  });

  it("layouts pointer, staging, quarantine under runtimes/grok", () => {
    expect(grokRuntimeRoot(root)).toBe(path.join(root, "runtimes", "grok"));
    expect(currentPointerPath(root)).toBe(
      path.join(root, "runtimes", "grok", "current.json"),
    );
    expect(stagingDir(root)).toBe(
      path.join(root, "runtimes", "grok", "staging"),
    );
    expect(quarantineDir(root)).toBe(
      path.join(root, "runtimes", "grok", "quarantine"),
    );
    expect(installationJsonPath(root, "0.9.4", "darwin-arm64")).toBe(
      path.join(
        root,
        "runtimes/grok/0.9.4/darwin-arm64/installation.json",
      ),
    );
  });

  it("ensureRuntimeLayout creates user-only dirs", () => {
    const layout = ensureRuntimeLayout(root);
    expect(fs.existsSync(layout.root)).toBe(true);
    expect(fs.existsSync(layout.staging)).toBe(true);
    expect(fs.existsSync(layout.quarantine)).toBe(true);
    if (process.platform !== "win32") {
      const mode = fs.statSync(layout.root).mode & 0o777;
      expect(mode).toBe(0o700);
    }
  });

  it("assertPathUnderRoot rejects escape", () => {
    const runtimeRoot = grokRuntimeRoot(root);
    fs.mkdirSync(runtimeRoot, { recursive: true });
    expect(() =>
      assertPathUnderRoot(path.join(root, "secret"), runtimeRoot),
    ).toThrowError(/path escapes/);
    expect(
      assertPathUnderRoot(
        path.join(runtimeRoot, "0.9.4", "darwin-arm64"),
        runtimeRoot,
      ),
    ).toBe(path.resolve(runtimeRoot, "0.9.4", "darwin-arm64"));
  });

  it("rejects symlink escape under version path", () => {
    if (process.platform === "win32") {
      // Symlink creation often requires elevation on Windows CI.
      return;
    }
    const runtimeRoot = grokRuntimeRoot(root);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-outside-"));
    try {
      fs.mkdirSync(runtimeRoot, { recursive: true });
      const link = path.join(runtimeRoot, "0.9.4");
      fs.symlinkSync(outside, link, "dir");
      expect(() =>
        assertNoSymlinkEscape(
          path.join(link, "darwin-arm64", "grok"),
          runtimeRoot,
        ),
      ).toThrowError(/symlink escapes|path escapes|symlink_escape/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("isStagingOrQuarantinePath detects non-selectable areas", () => {
    const stageFile = path.join(stagingDir(root), "part", "grok");
    const qFile = path.join(quarantineDir(root), "bad", "grok");
    const good = runtimeBinary(root, "0.9.4", "darwin-arm64");
    expect(isStagingOrQuarantinePath(root, stageFile)).toBe(true);
    expect(isStagingOrQuarantinePath(root, qFile)).toBe(true);
    expect(isStagingOrQuarantinePath(root, good)).toBe(false);
  });

  it("runtimeBinaryName maps platforms", () => {
    expect(runtimeBinaryName("darwin-arm64")).toBe("grok");
    expect(runtimeBinaryName("win32-x64")).toBe("grok.exe");
    expect(runtimeBinaryName("win32-arm64")).toBe("grok.exe");
  });

  it("runtimeVersionDir stays under root for safe versions", () => {
    const dir = runtimeVersionDir(root, "0.9.4", "darwin-arm64");
    expect(dir.startsWith(grokRuntimeRoot(root))).toBe(true);
  });
});
