#!/usr/bin/env node
/**
 * Stage electron-builder output as the stable free-download asset names
 * used by the marketing site (GitHub releases/latest/download/...).
 *
 * Expected final names (must match grok-landing src/lib/downloads.ts):
 *   GrokDesk-mac-arm64.dmg
 *   GrokDesk-mac-x64.dmg
 *   GrokDesk-win-x64.exe
 *
 * Usage:
 *   node scripts/stage-free-release-assets.mjs \
 *     --target darwin-arm64|darwin-x64|win32-x64 \
 *     --release-dir apps/desktop/release \
 *     --out-dir free-assets
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const STABLE = {
  "darwin-arm64": {
    match: /\.dmg$/i,
    name: "GrokDesk-mac-arm64.dmg",
    prefer: /arm64/i,
    exclude: /(?:x64|intel|amd64)/i,
  },
  "darwin-x64": {
    match: /\.dmg$/i,
    name: "GrokDesk-mac-x64.dmg",
    prefer: /x64|intel|amd64/i,
    // electron-builder's default x64 DMG has no architecture suffix, while
    // the Apple Silicon artifact is explicitly suffixed with `arm64`.
    exclude: /(?:arm64|aarch64)/i,
  },
  "win32-x64": {
    match: /\.exe$/i,
    name: "GrokDesk-win-x64.exe",
    prefer: /Setup|x64|win/i,
  },
};

function parseArgs(argv) {
  const out = {
    target: "",
    releaseDir: "apps/desktop/release",
    outDir: "free-assets",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") out.target = argv[++i] ?? "";
    else if (a === "--release-dir") out.releaseDir = argv[++i] ?? out.releaseDir;
    else if (a === "--out-dir") out.outDir = argv[++i] ?? out.outDir;
  }
  return out;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function main() {
  const args = parseArgs(process.argv);
  const rule = STABLE[args.target];
  if (!rule) {
    console.error(
      `Unknown --target ${args.target}. Use: ${Object.keys(STABLE).join(" | ")}`,
    );
    process.exit(1);
  }

  const files = walk(args.releaseDir).filter((f) => rule.match.test(f));
  const candidates = files.filter(
    (f) =>
      !/blockmap/i.test(f) &&
      !/portable/i.test(f) &&
      !/\.d\.yml$/i.test(f) &&
      !(rule.exclude?.test(f) ?? false),
  );
  if (candidates.length === 0) {
    console.error(`No installer matching ${rule.match} under ${args.releaseDir}`);
    console.error("Found:", walk(args.releaseDir).join("\n") || "(empty)");
    process.exit(1);
  }

  candidates.sort((a, b) => {
    const sa = rule.prefer.test(a) ? 0 : 1;
    const sb = rule.prefer.test(b) ? 0 : 1;
    return sa - sb || a.localeCompare(b);
  });
  const source = candidates[0];

  fs.mkdirSync(args.outDir, { recursive: true });
  const dest = path.join(args.outDir, rule.name);
  fs.copyFileSync(source, dest);

  const hash = createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
  fs.writeFileSync(`${dest}.sha256`, `${hash}  ${rule.name}\n`);

  console.log(
    JSON.stringify(
      { target: args.target, source, dest, sha256: hash, asset: rule.name },
      null,
      2,
    ),
  );
}

main();
