/**
 * Generate a minimal CycloneDX SBOM from pnpm-lock.yaml (no live network).
 * Usage: node scripts/generate-sbom.mjs [out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(root, "pnpm-lock.yaml");
const outPath = process.argv[2] || null;

const lock = fs.readFileSync(lockPath, "utf8");
// packages: section keys look like:
//  /zod@3.23.8:
//  /@noble/hashes@2.2.0:
const re = /^\s{2}(?:'|"|)?((?:@[^/]+\/)?[^@\s'"]+)@([^:()\s'"]+)/gm;
const components = new Map();
let m;
while ((m = re.exec(lock)) !== null) {
  const name = m[1];
  const version = m[2];
  if (!name || !version || name === "packages") continue;
  const key = `${name}@${version}`;
  if (components.has(key)) continue;
  const purlName = name.startsWith("@")
    ? name.replace("/", "%2F")
    : name;
  components.set(key, {
    type: "library",
    name,
    version,
    purl: `pkg:npm/${purlName}@${version}`,
  });
}

const list = [...components.values()].sort((a, b) =>
  a.name.localeCompare(b.name),
);
const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ name: "grokdesk-generate-sbom", version: "0.1.1" }],
    component: {
      type: "application",
      name: "grok-desktop",
      version: "0.1.2",
    },
  },
  components: list,
};
const json = JSON.stringify(bom, null, 2);
const hash = createHash("sha256").update(json).digest("hex");
bom.metadata.component.hashes = [{ alg: "SHA-256", content: hash }];
const finalJson = JSON.stringify(bom, null, 2);

if (outPath) {
  fs.writeFileSync(outPath, finalJson + "\n", "utf8");
  console.error(`Wrote ${outPath} (${list.length} components) sha256=${hash.slice(0, 16)}…`);
} else {
  process.stdout.write(finalJson + "\n");
  console.error(`SBOM components: ${list.length} sha256=${hash.slice(0, 16)}…`);
}
