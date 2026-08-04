#!/usr/bin/env node
/**
 * Minimal Grok CLI fixture for process/E2E tests.
 * Not a production binary — never selected by managed runtime discovery.
 *
 * Supports: --version, --help, models, agent --help, logout, -p (echo title JSON).
 */
import { parseArgs } from "node:util";

const args = process.argv.slice(2);
const joined = args.join(" ");

if (args.includes("--version") || args[0] === "-V") {
  process.stdout.write("0.0.0-test-fixture (test-grok-cli)\n");
  process.exit(0);
}

if (args.includes("--help") || args[0] === "-h") {
  process.stdout.write(`test-grok-cli (fixture)
  --version
  --help
  --no-auto-update
  models
  agent stdio
  logout
  -p <prompt> [--json-schema ...]
`);
  process.exit(0);
}

if (args[0] === "agent" && (args.includes("--help") || args[1] === "--help")) {
  process.stdout.write("agent stdio — ACP surface (fixture)\n");
  process.exit(0);
}

if (args[0] === "models" || joined.includes("models")) {
  process.stdout.write(
    JSON.stringify(
      {
        models: ["grok-4.5", "grok-test"],
        default: "grok-4.5",
        signedIn: false,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

if (args[0] === "logout") {
  process.stdout.write("Logged out (fixture)\n");
  process.exit(0);
}

// Title / prompt one-shot: emit structured JSON envelope
if (args.includes("-p") || args.includes("--prompt")) {
  process.stdout.write(
    JSON.stringify({
      text: "Fixture reply",
      structuredOutput: { title: "Fixture Title" },
    }) + "\n",
  );
  process.exit(0);
}

// Streaming-json agent mode: emit a short NDJSON session then exit
if (args.includes("streaming-json") || args.includes("--output-format")) {
  const lines = [
    JSON.stringify({ type: "message", role: "assistant", text: "fixture ok" }),
    JSON.stringify({ type: "done", summary: "fixture complete" }),
  ];
  for (const line of lines) process.stdout.write(line + "\n");
  process.exit(0);
}

process.stderr.write(`test-grok-cli: unhandled args: ${joined}\n`);
process.exit(2);
