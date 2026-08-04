import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  envWithGrokPath,
  envWithManagedBinary,
  findGlobalGrokBinary,
  resolveManagedGrokBinary,
} from "./discover.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "grokdesk-discover-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveManagedGrokBinary", () => {
  it("accepts an explicit absolute managed path", async () => {
    const dir = await makeTempDir();
    const bin = path.join(dir, "managed-grok");
    await fs.writeFile(bin, "#!/bin/sh\necho ok\n", { mode: 0o755 });

    const found = await resolveManagedGrokBinary({
      managedBinaryPath: bin,
      env: {
        PATH: path.join(dir, "on-path"),
        HOME: dir,
        GROK_BUILD_PATH: path.join(dir, "ignored"),
      },
      platform: "darwin",
    });
    expect(found).toBe(path.resolve(bin));
  });

  it("ignores ambient GROKDESK_MANAGED_GROK_BINARY", async () => {
    const dir = await makeTempDir();
    const bin = path.join(dir, "env-managed");
    await fs.writeFile(bin, "#!/bin/sh\necho ok\n", { mode: 0o755 });

    const found = await resolveManagedGrokBinary({
      env: {
        GROKDESK_MANAGED_GROK_BINARY: bin,
        PATH: "",
        HOME: dir,
      },
      platform: "darwin",
    });
    expect(found).toBeNull();
  });

  it("packaged selection accepts an explicit path but rejects ambient overrides", async () => {
    const dir = await makeTempDir();
    const explicit = path.join(dir, "verified-managed");
    const ambient = path.join(dir, "ambient-managed");
    await fs.writeFile(explicit, "#!/bin/sh\necho verified\n", { mode: 0o755 });
    await fs.writeFile(ambient, "#!/bin/sh\necho ambient\n", { mode: 0o755 });

    const found = await resolveManagedGrokBinary({
      managedBinaryPath: explicit,
      env: {
        GROKDESK_PACKAGED: "1",
        GROKDESK_MANAGED_GROK_BINARY: ambient,
        GROKDESK_DEV_GROK_BINARY: ambient,
        PATH: "",
        HOME: dir,
      },
      platform: "darwin",
    });
    expect(found).toBe(path.resolve(explicit));
  });

  it("ignores PATH, common locations, and GROK_BUILD_PATH", async () => {
    const home = await makeTempDir();
    const localBin = path.join(home, ".local", "bin");
    await fs.mkdir(localBin, { recursive: true });
    const globalBin = path.join(localBin, "grok");
    await fs.writeFile(globalBin, "#!/bin/sh\necho global\n", { mode: 0o755 });
    const buildPath = path.join(home, "build-path-grok");
    await fs.writeFile(buildPath, "#!/bin/sh\necho build\n", { mode: 0o755 });

    const found = await resolveManagedGrokBinary({
      env: {
        PATH: localBin,
        HOME: home,
        GROK_BUILD_PATH: buildPath,
        GROKDESK_PACKAGED: "1",
      },
      platform: "darwin",
    });
    expect(found).toBeNull();
  });

  it("rejects relative paths", async () => {
    const found = await resolveManagedGrokBinary({
      managedBinaryPath: "relative/grok",
      env: { PATH: "", HOME: await makeTempDir() },
      platform: "darwin",
    });
    expect(found).toBeNull();
  });

  it("allows GROKDESK_DEV_GROK_BINARY only when unpackaged or unlock", async () => {
    const dir = await makeTempDir();
    const bin = path.join(dir, "dev-grok");
    await fs.writeFile(bin, "#!/bin/sh\necho dev\n", { mode: 0o755 });

    const unpackaged = await resolveManagedGrokBinary({
      env: {
        GROKDESK_DEV_GROK_BINARY: bin,
        GROKDESK_PACKAGED: "0",
        PATH: "",
        HOME: dir,
      },
      platform: "darwin",
    });
    expect(unpackaged).toBe(path.resolve(bin));

    const packaged = await resolveManagedGrokBinary({
      env: {
        GROKDESK_DEV_GROK_BINARY: bin,
        GROKDESK_PACKAGED: "1",
        PATH: "",
        HOME: dir,
      },
      platform: "darwin",
    });
    expect(packaged).toBeNull();

    const unlocked = await resolveManagedGrokBinary({
      env: {
        GROKDESK_DEV_GROK_BINARY: bin,
        GROKDESK_PACKAGED: "1",
        GROKDESK_DEV_UNLOCK: "1",
        PATH: "",
        HOME: dir,
      },
      platform: "darwin",
    });
    expect(unlocked).toBe(path.resolve(bin));
  });

  it("unlock falls back to global ~/.grok install when no managed path", async () => {
    const home = await makeTempDir();
    const grokBinDir = path.join(home, ".grok", "bin");
    await fs.mkdir(grokBinDir, { recursive: true });
    const global = path.join(grokBinDir, "grok");
    await fs.writeFile(global, "#!/bin/sh\necho global\n", { mode: 0o755 });

    const found = await resolveManagedGrokBinary({
      managedBinaryPath: null,
      env: {
        GROKDESK_PACKAGED: "1",
        GROKDESK_DEV_UNLOCK: "1",
        PATH: "",
        HOME: home,
      },
      platform: "darwin",
    });
    expect(found).toBe(path.resolve(global));
  });
});

describe("findGlobalGrokBinary (diagnostics only)", () => {
  it("returns GROK_BUILD_PATH when the file is executable", async () => {
    const dir = await makeTempDir();
    const bin = path.join(dir, "fake-grok");
    await fs.writeFile(bin, "#!/bin/sh\necho ok\n", { mode: 0o755 });

    const found = await findGlobalGrokBinary(
      {
        GROK_BUILD_PATH: bin,
        PATH: "",
        HOME: dir,
      },
      "darwin",
    );

    expect(found).toBe(bin);
  });

  // Windows has no Unix execute bit — access(X_OK)/F_OK treats any existing
  // file as runnable, so this permission check is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "returns null when GROK_BUILD_PATH is not executable",
    async () => {
      const dir = await makeTempDir();
      const bin = path.join(dir, "not-exec");
      await fs.writeFile(bin, "nope\n", { mode: 0o644 });

      const found = await findGlobalGrokBinary(
        {
          GROK_BUILD_PATH: bin,
          PATH: "",
          HOME: path.join(dir, "empty-home"),
        },
        "darwin",
      );

      expect(found).toBeNull();
    },
  );

  it("finds a candidate under ~/.local/bin/grok on mac/linux", async () => {
    const home = await makeTempDir();
    const localBin = path.join(home, ".local", "bin");
    await fs.mkdir(localBin, { recursive: true });
    const bin = path.join(localBin, "grok");
    await fs.writeFile(bin, "#!/bin/sh\necho grok\n", { mode: 0o755 });

    const found = await findGlobalGrokBinary(
      {
        PATH: "",
        HOME: home,
      },
      "darwin",
    );

    expect(found).toBe(bin);
  });

  it("finds the official install under ~/.grok/bin/grok", async () => {
    const home = await makeTempDir();
    const grokBin = path.join(home, ".grok", "bin");
    await fs.mkdir(grokBin, { recursive: true });
    const bin = path.join(grokBin, "grok");
    await fs.writeFile(bin, "#!/bin/sh\necho grok\n", { mode: 0o755 });

    const found = await findGlobalGrokBinary(
      {
        PATH: "",
        HOME: home,
      },
      "darwin",
    );

    expect(found).toBe(bin);
  });

  it("finds a win32 candidate under AppData/Local/grok", async () => {
    const home = await makeTempDir();
    const winDir = path.join(home, "AppData", "Local", "grok");
    await fs.mkdir(winDir, { recursive: true });
    const bin = path.join(winDir, "grok.exe");
    await fs.writeFile(bin, "fake", { mode: 0o755 });

    const found = await findGlobalGrokBinary(
      {
        PATH: "",
        USERPROFILE: home,
        HOME: "",
      },
      "win32",
    );

    expect(found).toBe(bin);
  });

  it("returns null when nothing is found", async () => {
    const home = await makeTempDir();
    const found = await findGlobalGrokBinary(
      {
        PATH: "",
        HOME: home,
      },
      "darwin",
    );
    expect(found).toBeNull();
  });
});

describe("envWithManagedBinary", () => {
  it("prepends only the binary directory", () => {
    const env = envWithManagedBinary(
      "/opt/desk/runtimes/grok/current/grok",
      { PATH: "/usr/bin", HOME: "/Users/test" },
      "darwin",
    );
    expect(env.PATH?.startsWith("/opt/desk/runtimes/grok/current")).toBe(true);
    expect(env.PATH).not.toContain("/Users/test/.grok/bin");
    expect(env.PATH).toContain("/usr/bin");
  });
});

describe("envWithGrokPath", () => {
  it("prepends ~/.grok/bin to PATH (diagnostics)", () => {
    const home = "/Users/test";
    const env = envWithGrokPath(
      { PATH: "/usr/bin", HOME: home },
      "darwin",
    );
    expect(env.PATH?.startsWith(`${home}/.grok/bin`)).toBe(true);
    expect(env.PATH).toContain("/usr/bin");
  });
});
