/**
 * better-sqlite3 is compiled for Electron's Node ABI in packaging, and for
 * local Node during `pnpm install`. If the running Node MODULE_VERSION does
 * not match the built binary, rebuild so gateway vitest can open the DB.
 *
 * Dev Node is pinned to 22.x (see root .nvmrc / engines), which is supported
 * by the Electron 43 native rebuild toolchain.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { nativeBindingNeedsRebuild } from "./native-abi-probe.mjs";

const require = createRequire(import.meta.url);
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function needsRebuild() {
  return nativeBindingNeedsRebuild(() => require("better-sqlite3"));
}

if (!needsRebuild()) {
  process.exit(0);
}

console.warn(
  "[gateway] better-sqlite3 ABI mismatch for this Node; rebuilding…",
);
const r = spawnSync(
  "pnpm",
  ["rebuild", "better-sqlite3"],
  { cwd: pkgRoot, stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(r.status ?? 1);
