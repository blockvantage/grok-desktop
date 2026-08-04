/**
 * Rebuild / fetch native modules against the Electron ABI used by the packaged app.
 *
 * - better-sqlite3: gateway child runs as Electron-as-Node (ELECTRON_RUN_AS_NODE=1)
 *
 * Credential secrets use AES file vault under userData — never keytar/Keychain
 * (docs/decisions/2026-07-24-no-keychain.md).
 *
 * In a pnpm monorepo electron-builder's auto-rebuild can report success while
 * packaging a Node-built .node — run this explicitly before dist/pack.
 *
 * Host rebuild (default):
 *   node scripts/rebuild-native-for-electron.mjs
 *
 * Cross-target (e.g. Windows x64 from macOS) uses prebuild-install instead of
 * node-gyp (source cross-compile is unsupported):
 *   node scripts/rebuild-native-for-electron.mjs --platform win32 --arch x64
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuild } from "@electron/rebuild";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const monorepoRoot = path.resolve(desktopRoot, "../..");

const electronVersion = require("electron/package.json").version;

/**
 * Native modules that must match Electron's NODE_MODULE_VERSION.
 */
const NATIVE_MODULES = ["better-sqlite3"];

function parseArgs(argv) {
  let platform = process.platform;
  let arch = process.arch;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--platform" && argv[i + 1]) {
      platform = argv[++i];
    } else if (a === "--arch" && argv[i + 1]) {
      arch = argv[++i];
    } else if (a.startsWith("--platform=")) {
      platform = a.slice("--platform=".length);
    } else if (a.startsWith("--arch=")) {
      arch = a.slice("--arch=".length);
    }
  }
  return { platform, arch };
}

function resolvePackageDir(name, fromPaths) {
  try {
    const pkgJson = require.resolve(`${name}/package.json`, { paths: fromPaths });
    return path.dirname(pkgJson);
  } catch {
    return null;
  }
}

/**
 * Locate every physical install of a package under the monorepo (pnpm may
 * hoist or nest copies that electron-builder can pick up).
 */
function findPackageDirs(name) {
  const dirs = new Set();
  const searchRoots = [desktopRoot, monorepoRoot, path.join(monorepoRoot, "packages/gateway")];
  for (const root of searchRoots) {
    const d = resolvePackageDir(name, [root]);
    if (d) dirs.add(d);
  }
  // pnpm store layout: node_modules/.pnpm/<name>@*/node_modules/<name>
  const pnpmDir = path.join(monorepoRoot, "node_modules/.pnpm");
  if (fs.existsSync(pnpmDir)) {
    const unscoped = name.startsWith("@") ? name.split("/")[1] : name;
    const scopePrefix = name.startsWith("@") ? name.split("/")[0].slice(1) + "+" : "";
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith(`${scopePrefix}${unscoped}@`) && !entry.startsWith(`${unscoped}@`)) {
        continue;
      }
      const candidate = path.join(
        pnpmDir,
        entry,
        "node_modules",
        name,
      );
      if (fs.existsSync(path.join(candidate, "package.json"))) {
        dirs.add(candidate);
      }
    }
  }
  return [...dirs];
}

function runPrebuildInstall(pkgDir, { platform, arch, electronVersion }) {
  const args = [
    "prebuild-install",
    "--runtime",
    "electron",
    "--target",
    electronVersion,
    "--platform",
    platform,
    "--arch",
    arch,
    "--force",
  ];
  console.log(
    `[rebuild-native] prebuild-install in ${pkgDir} → electron ${electronVersion} ${platform}-${arch}`,
  );
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", ...args],
    {
      cwd: pkgDir,
      stdio: "inherit",
      env: {
        ...process.env,
        npm_config_platform: platform,
        npm_config_arch: arch,
        npm_config_target: electronVersion,
        npm_config_runtime: "electron",
        npm_config_disturl: "https://electronjs.org/headers",
      },
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `prebuild-install failed for ${pkgDir} (${platform}-${arch}): exit ${result.status}`,
    );
  }
}

function assertNodeBinaryPlatform(filePath, platform) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected native binary missing: ${filePath}`);
  }
  // Light-weight magic check without depending on `file(1)`.
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  const isPe = buf[0] === 0x4d && buf[1] === 0x5a; // MZ
  const isMachO =
    (buf[0] === 0xcf && buf[1] === 0xfa) || // 64-bit LE
    (buf[0] === 0xce && buf[1] === 0xfa) ||
    (buf[0] === 0xca && buf[1] === 0xfe); // fat
  const isElf = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  if (platform === "win32" && !isPe) {
    throw new Error(
      `Native binary is not a Windows PE image: ${filePath} (wrong platform packed)`,
    );
  }
  if (platform === "darwin" && !isMachO) {
    throw new Error(
      `Native binary is not a Mach-O image: ${filePath} (wrong platform packed)`,
    );
  }
  if (platform === "linux" && !isElf) {
    throw new Error(
      `Native binary is not an ELF image: ${filePath} (wrong platform packed)`,
    );
  }
}

const { platform: targetPlatform, arch: targetArch } = parseArgs(process.argv.slice(2));
const isCross =
  targetPlatform !== process.platform || targetArch !== process.arch;

console.log(
  `[rebuild-native] Target electron ${electronVersion} ${targetPlatform}-${targetArch}` +
    (isCross ? " (cross / prebuild)" : " (host / @electron/rebuild)"),
);

if (!isCross) {
  console.log(
    `[rebuild-native] Rebuilding ${NATIVE_MODULES.join(", ")} for Electron ${electronVersion}…`,
  );

  await rebuild({
    buildPath: monorepoRoot,
    electronVersion,
    arch: targetArch,
    force: true,
    onlyModules: NATIVE_MODULES,
    projectRootPath: monorepoRoot,
  });

  // Also rebuild from the desktop package path so local node_modules copies match.
  await rebuild({
    buildPath: desktopRoot,
    electronVersion,
    arch: targetArch,
    force: true,
    onlyModules: NATIVE_MODULES,
    projectRootPath: monorepoRoot,
  });
} else {
  // Cross-target: node-gyp cannot compile; fetch official prebuilds.
  const bsqlDirs = findPackageDirs("better-sqlite3");
  if (bsqlDirs.length === 0) {
    throw new Error("better-sqlite3 not found in monorepo node_modules");
  }
  for (const dir of bsqlDirs) {
    runPrebuildInstall(dir, {
      platform: targetPlatform,
      arch: targetArch,
      electronVersion,
    });
    assertNodeBinaryPlatform(
      path.join(dir, "build", "Release", "better_sqlite3.node"),
      targetPlatform,
    );
  }

}

console.log("[rebuild-native] Done.");
