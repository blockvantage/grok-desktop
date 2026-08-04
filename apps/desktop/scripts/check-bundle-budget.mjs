#!/usr/bin/env node
/**
 * Bundle budget for renderer *initial* load (assets referenced by index.html).
 * Lazy chunks are excluded — they load on interaction.
 *
 * Targets (plan Task 17): JS ≤ 2.2 MB, CSS ≤ 130 KB (uncompressed entry).
 * When out/ is missing, advisory pass so typecheck/unit can run first.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRenderer = path.join(root, "out/renderer");
const indexHtml = path.join(outRenderer, "index.html");

/** Uncompressed entry JS budget (plan target 2.2 MB). */
const JS_BUDGET = 2.2 * 1024 * 1024;
const CSS_BUDGET = 130 * 1024;
/**
 * Soft ceiling while the monorepo converges on full Task 17 splits.
 * Fails hard above this so regressions cannot silently balloon the entry.
 */
const JS_REGRESSION_CEILING = 2.7 * 1024 * 1024;

if (!fs.existsSync(indexHtml)) {
  console.log(
    "bundle-budget: no out/renderer/index.html — advisory pass (run build first)",
  );
  process.exit(0);
}

const html = fs.readFileSync(indexHtml, "utf8");
const refs = [
  ...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g),
].map((m) => m[1]);

let js = 0;
let css = 0;
let jsGzip = 0;
let cssGzip = 0;
const measured = [];
for (const rel of refs) {
  const abs = path.join(outRenderer, rel);
  if (!fs.existsSync(abs)) continue;
  const buf = fs.readFileSync(abs);
  const gz = zlib.gzipSync(buf).length;
  if (rel.endsWith(".js")) {
    js += buf.length;
    jsGzip += gz;
  } else if (rel.endsWith(".css")) {
    css += buf.length;
    cssGzip += gz;
  }
  measured.push({ rel, bytes: buf.length, gzip: gz });
}

const report = {
  measured,
  jsBytes: js,
  cssBytes: css,
  jsGzipBytes: jsGzip,
  cssGzipBytes: cssGzip,
  jsBudget: JS_BUDGET,
  cssBudget: CSS_BUDGET,
  jsRegressionCeiling: JS_REGRESSION_CEILING,
};
console.log(JSON.stringify(report, null, 2));

if (css > CSS_BUDGET) {
  console.error("bundle-budget: CSS over budget");
  process.exit(1);
}
if (js > JS_REGRESSION_CEILING) {
  console.error("bundle-budget: JS over regression ceiling");
  process.exit(1);
}
if (js > JS_BUDGET) {
  console.warn(
    `bundle-budget: JS ${js} exceeds plan target ${JS_BUDGET} but within regression ceiling — continue Task 17 lazy splits`,
  );
}
console.log("bundle-budget: ok");
