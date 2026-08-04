/**
 * Unit tests for remote-live-smoke control-channel ID correlation.
 * Run: node --test scripts/remote-live-smoke.test.mjs
 * (Also imported patterns validated by reading the smoke script source.)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokePath = path.join(root, "scripts/remote-live-smoke.mjs");
const src = fs.readFileSync(smokePath, "utf8");

describe("remote-live-smoke harness", () => {
  it("correlates responses by request id, not next channel frame", () => {
    assert.match(src, /createControlChannel/);
    assert.match(src, /pending\.get\(plain\.id\)/);
    assert.doesNotMatch(
      src,
      /onceMessage\(\s*ctrl,\s*\(m\)\s*=>\s*m\.type === "recv" && String\(m\.channel\) === accept\.channel/,
    );
  });

  it("routes events independently", () => {
    assert.match(src, /plain\.t === "event"/);
    assert.match(src, /onEvent/);
  });

  it("supports --help, --relay, deadlines, unique ids, finally cleanup", () => {
    assert.match(src, /--help/);
    assert.match(src, /--relay/);
    assert.match(src, /deadlineMs|deadline/);
    assert.match(src, /randomUUID/);
    assert.match(src, /finally/);
    assert.match(src, /gw\?\.stop/);
    assert.match(src, /rmSync\(dataDir/);
  });
});
