/**
 * Dictation admission — before capture and before STT upload.
 * Free Desk: no product-license fail-closed; runtime security pause still blocks.
 * Imports pure helpers only (no Electron / engine-grok).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  dictationGateFromAssert,
  dictationGateFromStatus,
  ensureDictationEntitlement,
  type DictationEntitlementGate,
} from "./dictation-entitlement.js";

describe("dictation admission (free Desk)", () => {
  it("wires free-app dictation gate into production dictation IPC", () => {
    const mainSource = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf8",
    );
    expect(mainSource).toMatch(/dictationGateFromStatus/);
    expect(mainSource).toMatch(
      /registerDictationIpc\(\{[\s\S]*?entitlementGate:\s*dictationGateFromStatus/,
    );
    // No product-license manager status probe.
    expect(mainSource).not.toMatch(/manager\.getStatus\(\)/);
    // F1: dictation channels share the privileged sender gate.
    expect(mainSource).toMatch(
      /registerDictationIpc\(\{[\s\S]*?assertSender:\s*gate/,
    );
  });

  it("guards dictation start with a single-flight lock", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dictation-service.ts", import.meta.url)),
      "utf8",
    );
    // Rejects an overlapping start before the async gates; cleared in finally.
    expect(src).toMatch(
      /if \(starting \|\| state === "listening" \|\| state === "processing"\)/,
    );
    expect(src).toMatch(/starting = true;/);
    expect(src).toMatch(/error: "dictation_busy"/);
    expect(src).toMatch(/finally \{\s*starting = false;/);
  });

  it("fails closed when assertSender is not configured", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dictation-service.ts", import.meta.url)),
      "utf8",
    );
    expect(src).toMatch(
      /assertSender not configured \(fail-closed\)/,
    );
    expect(src).not.toMatch(/opts\?\.assertSender\?\.\(event\)/);
  });

  it.each(["capture_start", "stt_upload"] as const)(
    "admits at %s when no gate is configured (free Desk)",
    async (boundary) => {
      await expect(
        ensureDictationEntitlement(null, boundary),
      ).resolves.toEqual({ ok: true });
      await expect(
        ensureDictationEntitlement(undefined, boundary),
      ).resolves.toEqual({ ok: true });
    },
  );

  it("production gate ignores product-license status (always allows)", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ state: "lease_expired" })
      .mockResolvedValueOnce({ state: "revoked" });
    const gate = dictationGateFromStatus(getStatus);

    await expect(gate.assertDictationAllowed("capture_start")).resolves.toEqual({
      ok: true,
    });
    await expect(gate.assertDictationAllowed("stt_upload")).resolves.toEqual({
      ok: true,
    });
    // Free path does not probe product license status.
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("blocks dictation when admission is paused (hard runtime block)", async () => {
    const getStatus = vi.fn(async () => ({ state: "active" }));
    const gate = dictationGateFromStatus(getStatus, () => ({
      ready: false,
      reason: "admission_paused",
    }));
    await expect(gate.assertDictationAllowed("capture_start")).resolves.toEqual({
      ok: false,
      error: "entitlement_read_only",
      state: "admission_paused",
    });
  });

  it("allows dictation when only managed runtime is missing (STT uses token API)", async () => {
    const getStatus = vi.fn(async () => ({ state: "active" }));
    const gate = dictationGateFromStatus(getStatus, () => ({
      ready: false,
      reason: "managed_runtime_unavailable",
    }));
    await expect(gate.assertDictationAllowed("capture_start")).resolves.toEqual({
      ok: true,
    });
  });

  it("allows when gate permits dictation", async () => {
    const gate: DictationEntitlementGate = {
      assertDictationAllowed: async () => ({ ok: true }),
    };
    await expect(
      ensureDictationEntitlement(gate, "capture_start"),
    ).resolves.toEqual({
      ok: true,
    });
  });

  it("blocks when gate returns entitlement_read_only (runtime pause)", async () => {
    const gate: DictationEntitlementGate = {
      assertDictationAllowed: async () => ({
        ok: false,
        error: "entitlement_read_only",
        state: "admission_paused",
      }),
    };
    await expect(
      ensureDictationEntitlement(gate, "stt_upload"),
    ).resolves.toEqual({
      ok: false,
      error: "entitlement_read_only",
      state: "admission_paused",
    });
  });

  it("dictationGateFromAssert maps EntitlementReadOnlyError safely", async () => {
    const assertCapability = vi.fn(async () => {
      const err = new Error(
        "Entitlement is read-only for this operation",
      ) as Error & {
        code: string;
        state: string;
        name: string;
      };
      err.name = "EntitlementReadOnlyError";
      err.code = "entitlement_read_only";
      err.state = "admission_paused";
      throw err;
    });
    const gate = dictationGateFromAssert(assertCapability);
    const result = await gate.assertDictationAllowed("capture_start");
    expect(result).toEqual({
      ok: false,
      error: "entitlement_read_only",
      state: "admission_paused",
    });
    expect(assertCapability).toHaveBeenCalledWith(
      "grok_operation",
      "dictation",
    );
  });

  it("dictationGateFromAssert allows when assert resolves", async () => {
    const assertCapability = vi.fn(async () => {});
    const gate = dictationGateFromAssert(assertCapability);
    await expect(gate.assertDictationAllowed("capture_start")).resolves.toEqual({
      ok: true,
    });
  });
});
