import { describe, it, expect } from "vitest";
import {
  connectorEnvFromParams,
  connectorDoctorServerId,
} from "./connector-params.js";

describe("connectorEnvFromParams", () => {
  it("returns string env map", () => {
    expect(
      connectorEnvFromParams({ env: { TOKEN: "x", n: 1 as unknown as string } }),
    ).toEqual({ TOKEN: "x" });
  });

  it("undefined when missing or empty", () => {
    expect(connectorEnvFromParams({})).toBeUndefined();
    expect(connectorEnvFromParams({ env: {} })).toBeUndefined();
    expect(connectorEnvFromParams({ env: "nope" })).toBeUndefined();
  });
});

describe("connectorDoctorServerId", () => {
  it("string only", () => {
    expect(connectorDoctorServerId({ serverId: "github" })).toBe("github");
    expect(connectorDoctorServerId({ serverId: 1 })).toBeUndefined();
  });
});
