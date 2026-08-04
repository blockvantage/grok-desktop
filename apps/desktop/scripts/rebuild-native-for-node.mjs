/**
 * Restore native modules for host Node (tests / gateway vitest).
 * Run after packaging if you need monorepo tests again in the same tree.
 *
 * Rebuilds better-sqlite3 only. Credential secrets use a file vault under
 * userData — never keytar / Keychain (see docs/decisions/2026-07-24-no-keychain.md).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, "../../..");

const NATIVE_MODULES = ["better-sqlite3"];

console.log(
  `[rebuild-native] Restoring ${NATIVE_MODULES.join(", ")} for host Node…`,
);
execFileSync("pnpm", ["rebuild", ...NATIVE_MODULES], {
  cwd: monorepoRoot,
  stdio: "inherit",
  env: process.env,
});
console.log("[rebuild-native] Node rebuild done.");
