import { spawnSync } from "node:child_process";
import path from "node:path";

const desktopRoot = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["run", "build"]);
run("pnpm", [
  "exec",
  "playwright",
  "test",
  "-c",
  "e2e/playwright.config.ts",
  "e2e/readme-capture.spec.ts",
]);

const output = path.resolve(desktopRoot, "../../samples/readme-demo/raw");
process.stdout.write(`README captures: ${output}\n`);
