import { describe, it, expect } from "vitest";
import { doctorMcpServer, doctorMcpServers } from "./mcp-doctor.js";

const CANARY = "sk-doctor-CANARY-should-never-appear";

describe("mcp doctor (CMD-03)", () => {
  it("never includes secret values in the report", () => {
    const report = doctorMcpServer({
      id: "github",
      command: "npx",
      args: ["-y", "mcp-server"],
      env: { GITHUB_TOKEN: CANARY },
      enabled: true,
    });
    const json = JSON.stringify(report);
    expect(json).not.toContain(CANARY);
    expect(report.findings.some((f) => f.code === "literal_secret_values")).toBe(
      true,
    );
    expect(report.findings.find((f) => f.code === "literal_secret_values")?.envKeys).toEqual(
      ["GITHUB_TOKEN"],
    );
  });

  it("accepts vault refs and placeholders without warning as literals", () => {
    const report = doctorMcpServer({
      id: "gh",
      command: "npx",
      args: [],
      env: {
        GITHUB_TOKEN: "${GITHUB_TOKEN}",
        API_KEY: "vault:abc",
      },
      enabled: true,
    });
    expect(
      report.findings.some((f) => f.code === "literal_secret_values"),
    ).toBe(false);
  });

  it("errors on missing command", () => {
    const report = doctorMcpServer({
      id: "x",
      command: "",
      args: [],
      enabled: true,
    });
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.severity === "error")).toBe(true);
  });

  it("batches without leaking", () => {
    const reports = doctorMcpServers([
      {
        id: "a",
        command: "npx",
        args: [],
        env: { TOKEN: CANARY },
        enabled: true,
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain(CANARY);
  });
});
