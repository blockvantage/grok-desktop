# Mobile Remote P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working end-to-end P0: QR-pair a phone to Grok Desk over a blind relay, E2E-encrypted control channel, and mobile Home/Tasks/Approvals/Inbox/Pause-all against the local gateway.

**Architecture:** Extend `@grokdesk/shared` with remote protocol + pure-JS crypto; add gateway `RemoteService` (devices, pairing, allowlisted IPC proxy); run a minimal `services/remote-relay` that only routes opaque frames; Electron main keeps a desk-side relay session; Expo app is the phone client. Telepresence (P1) is intentionally out of this plan.

**Tech Stack:** TypeScript monorepo (pnpm), Zod, `@noble/curves` + `@noble/ciphers` (or tweetnacl), better-sqlite3, Vitest, Electron, Expo (React Native), WebSocket relay (Node `ws` or Cloudflare-compatible later).

**Spec:** `docs/superpowers/specs/2026-07-12-mobile-remote-design.md`  
**Out of this plan:** WebRTC telepresence, Schedule/Memory deep UI, Face ID, multi-machine, push notifications.

---

## File structure (create / modify)

```
packages/shared/src/
  remote-crypto.ts              # NEW: X25519 + AEAD, QR encode/decode, session keys
  remote-crypto.test.ts         # NEW
  remote-protocol.ts            # NEW: Zod envelopes, pairing payload, control frames
  remote-protocol.test.ts       # NEW
  remote-allowlist.ts           # NEW: methods mobile may call
  remote-allowlist.test.ts      # NEW
  index.ts                      # export remote modules (browser-safe)

packages/gateway/src/
  db.ts                         # migration v3: remote_devices, remote_pair_challenges
  services/remote.ts            # NEW: pair, devices, revoke, proxy IPC
  services/remote.test.ts       # NEW
  index.ts                      # wire RemoteService + remote.* IPC methods

services/remote-relay/          # NEW package (add to pnpm-workspace)
  package.json
  src/index.ts                  # HTTP health + WS route for opaque frames
  src/store.ts                  # in-memory channels (dev); swap later
  src/store.test.ts
  vitest.config.ts
  tsconfig.json

apps/desktop/src/main/
  remote-session.ts             # NEW: desk relay client, pair polling, frame IO
  remote-session.test.ts        # NEW (unit with fake WS if pure logic extracted)
  index.ts                      # start/stop remote session with gateway
  ipc-bridge.ts                 # ensure remote.* methods pass through gateway.handle

apps/desktop/src/renderer/
  components/views/settings/remote-tab.tsx   # NEW: enable, QR, devices, revoke
  components/views/settings-view.tsx         # add Remote tab
  lib/remote-ui.ts                           # NEW: format device rows helpers
  lib/remote-ui.test.ts

apps/mobile/                    # NEW Expo app under monorepo
  package.json
  app.json
  App.tsx
  src/crypto/session.ts         # thin wrappers over @grokdesk/shared
  src/relay/client.ts           # WS client
  src/api/gateway.ts            # request() over E2E control channel
  src/storage/device-keys.ts    # SecureStore
  src/screens/PairScreen.tsx
  src/screens/HomeScreen.tsx
  src/screens/TasksScreen.tsx
  src/screens/TaskDetailScreen.tsx
  src/screens/InboxScreen.tsx
  src/navigation.tsx
  src/state/connection.tsx

pnpm-workspace.yaml             # add services/*
package.json                    # optional scripts: relay:dev, mobile:start
```

---

## Protocol (concrete)

### QR payload (`PairingQrV1`)

```ts
{
  v: 1,
  mid: string,       // machine id
  mpk: string,       // base64url machine X25519 public key (32 bytes)
  secret: string,    // base64url 32-byte pairing secret
  relay: string,     // e.g. ws://127.0.0.1:8787
  exp: number        // unix ms expiry
}
```

QR string = `grokdesk://pair/` + base64url(JSON).

### Crypto

1. Both sides: X25519 keypairs.  
2. Shared = ECDH(mySecret, theirPublic).  
3. Root key = HKDF-SHA256(shared || pairSecret, salt=`grokdesk-remote-v1`, info=`session-root`, 32 bytes).  
4. Frame key = HKDF(..., info=`control-frame`, 32).  
5. Frames: `nonce(24) || ciphertext` with XChaCha20-Poly1305 (via `@noble/ciphers`).  

### Control frame (after encrypt, plaintext JSON)

```ts
type ControlPlain =
  | { t: "req"; id: string; method: string; params: unknown }
  | { t: "res"; id: string; ok: true; result: unknown }
  | { t: "res"; id: string; ok: false; error: string }
  | { t: "event"; channel: string; payload: unknown }
  | { t: "hello"; role: "desk" | "phone"; deviceId: string; protocol: 1 };
```

### Relay WebSocket messages (never product plaintext)

```ts
// Client → relay
{ type: "hello"; role: "desk" | "phone"; machineId: string; deviceId?: string; token: string }
{ type: "send"; channel: string; blob: string } // base64 ciphertext
// Relay → client
{ type: "recv"; channel: string; blob: string }
{ type: "err"; message: string }
```

`token` for desk = HMAC or random machine relay token stored in settings after enable.  
`token` for phone = short-lived token returned in sealed pair response (opaque to relay beyond equality check if we use random session tokens registered at pair time).

**P0 simplification for tokens:** Relay trusts first-hello registration:

- Desk hello registers `machineId` + `deskToken` (set at enable).  
- Pair completion registers `deviceId` + `deviceToken` on channel `pair:{machineId}` then `ctrl:{machineId}:{deviceId}`.  
- Relay only checks token match; tokens are random 32-byte values, not content keys.

---

### Task 1: Shared remote crypto + QR

**Files:**
- Create: `packages/shared/src/remote-crypto.ts`
- Create: `packages/shared/src/remote-crypto.test.ts`
- Modify: `packages/shared/package.json` (deps)
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add noble dependencies**

```bash
cd /Users/maceo/blockvantage/grok-desktop
pnpm --filter @grokdesk/shared add @noble/curves @noble/ciphers @noble/hashes
```

- [ ] **Step 2: Write failing tests**

```ts
// packages/shared/src/remote-crypto.test.ts
import { describe, expect, it } from "vitest";
import {
  b64uDecode,
  b64uEncode,
  decodePairingQr,
  deriveControlKeys,
  encodePairingQr,
  generateX25519KeyPair,
  openFrame,
  sealFrame,
  type PairingQrV1,
} from "./remote-crypto.js";

describe("remote-crypto", () => {
  it("round-trips pairing QR", () => {
    const qr: PairingQrV1 = {
      v: 1,
      mid: "machine-1",
      mpk: b64uEncode(new Uint8Array(32).fill(1)),
      secret: b64uEncode(new Uint8Array(32).fill(2)),
      relay: "ws://127.0.0.1:8787",
      exp: Date.now() + 60_000,
    };
    const s = encodePairingQr(qr);
    expect(s.startsWith("grokdesk://pair/")).toBe(true);
    expect(decodePairingQr(s)).toEqual(qr);
  });

  it("desk and phone derive same control key and seal frames", () => {
    const desk = generateX25519KeyPair();
    const phone = generateX25519KeyPair();
    const pairSecret = new Uint8Array(32).fill(7);
    const deskKeys = deriveControlKeys({
      mySecret: desk.secretKey,
      theirPublic: phone.publicKey,
      pairSecret,
    });
    const phoneKeys = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: desk.publicKey,
      pairSecret,
    });
    expect(b64uEncode(deskKeys.frameKey)).toBe(b64uEncode(phoneKeys.frameKey));
    const plain = new TextEncoder().encode(JSON.stringify({ t: "hello", role: "phone" }));
    const sealed = sealFrame(deskKeys.frameKey, plain);
    const opened = openFrame(phoneKeys.frameKey, sealed);
    expect(new TextDecoder().decode(opened)).toBe(new TextDecoder().decode(plain));
  });

  it("rejects expired QR", () => {
    const qr: PairingQrV1 = {
      v: 1,
      mid: "m",
      mpk: b64uEncode(new Uint8Array(32)),
      secret: b64uEncode(new Uint8Array(32)),
      relay: "ws://x",
      exp: Date.now() - 1000,
    };
    expect(() => decodePairingQr(encodePairingQr(qr), { now: Date.now() })).toThrow(
      /expired/i,
    );
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
pnpm --filter @grokdesk/shared test -- src/remote-crypto.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 4: Implement crypto**

```ts
// packages/shared/src/remote-crypto.ts
import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";

export type PairingQrV1 = {
  v: 1;
  mid: string;
  mpk: string;
  secret: string;
  relay: string;
  exp: number;
};

export type X25519KeyPair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

const QR_PREFIX = "grokdesk://pair/";

export function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(bin)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const raw =
    typeof atob !== "undefined"
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, "base64").toString("binary");
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function generateX25519KeyPair(): X25519KeyPair {
  const secretKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(secretKey);
  return { publicKey, secretKey };
}

export function encodePairingQr(qr: PairingQrV1): string {
  const json = JSON.stringify(qr);
  return QR_PREFIX + b64uEncode(new TextEncoder().encode(json));
}

export function decodePairingQr(
  raw: string,
  opts?: { now?: number },
): PairingQrV1 {
  if (!raw.startsWith(QR_PREFIX)) throw new Error("Invalid pairing QR prefix");
  const json = new TextDecoder().decode(b64uDecode(raw.slice(QR_PREFIX.length)));
  const qr = JSON.parse(json) as PairingQrV1;
  if (qr.v !== 1) throw new Error("Unsupported pairing QR version");
  if (typeof qr.mid !== "string" || !qr.mid) throw new Error("Invalid mid");
  if (typeof qr.relay !== "string" || !qr.relay) throw new Error("Invalid relay");
  if (typeof qr.exp !== "number") throw new Error("Invalid exp");
  const now = opts?.now ?? Date.now();
  if (qr.exp < now) throw new Error("Pairing QR expired");
  if (b64uDecode(qr.mpk).length !== 32) throw new Error("Invalid mpk");
  if (b64uDecode(qr.secret).length !== 32) throw new Error("Invalid secret");
  return qr;
}

export function deriveControlKeys(args: {
  mySecret: Uint8Array;
  theirPublic: Uint8Array;
  pairSecret: Uint8Array;
}): { frameKey: Uint8Array } {
  const shared = x25519.getSharedSecret(args.mySecret, args.theirPublic);
  const ikm = new Uint8Array(shared.length + args.pairSecret.length);
  ikm.set(shared, 0);
  ikm.set(args.pairSecret, shared.length);
  const frameKey = hkdf(
    sha256,
    ikm,
    new TextEncoder().encode("grokdesk-remote-v1"),
    new TextEncoder().encode("control-frame"),
    32,
  );
  return { frameKey };
}

export function sealFrame(frameKey: Uint8Array, plain: Uint8Array): Uint8Array {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(frameKey, nonce);
  const ct = cipher.encrypt(plain);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return out;
}

export function openFrame(frameKey: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (sealed.length < 25) throw new Error("Frame too short");
  const nonce = sealed.slice(0, 24);
  const ct = sealed.slice(24);
  const cipher = xchacha20poly1305(frameKey, nonce);
  return cipher.decrypt(ct);
}

export function randomToken(bytes = 32): string {
  return b64uEncode(randomBytes(bytes));
}
```

Note: verify `@noble/curves` X25519 import path for the installed version (`@noble/curves/ed25519` exports `x25519` in recent versions). If import fails, use `@noble/curves/nist` or package docs for the pinned version.

- [ ] **Step 5: Export from index**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./remote-crypto.js";
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
pnpm --filter @grokdesk/shared test -- src/remote-crypto.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/package.json packages/shared/src/remote-crypto.ts packages/shared/src/remote-crypto.test.ts packages/shared/src/index.ts pnpm-lock.yaml
git commit -m "feat(shared): remote pairing crypto and QR codec"
```

---

### Task 2: Remote protocol envelopes + method allowlist

**Files:**
- Create: `packages/shared/src/remote-protocol.ts`
- Create: `packages/shared/src/remote-protocol.test.ts`
- Create: `packages/shared/src/remote-allowlist.ts`
- Create: `packages/shared/src/remote-allowlist.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/remote-allowlist.test.ts
import { describe, expect, it } from "vitest";
import { isRemoteAllowedMethod } from "./remote-allowlist.js";

describe("remote-allowlist", () => {
  it("allows coworker control methods", () => {
    expect(isRemoteAllowedMethod("tasks.list")).toBe(true);
    expect(isRemoteAllowedMethod("tasks.create")).toBe(true);
    expect(isRemoteAllowedMethod("tasks.approve")).toBe(true);
    expect(isRemoteAllowedMethod("tasks.pauseAll")).toBe(true);
    expect(isRemoteAllowedMethod("events.list")).toBe(true);
    expect(isRemoteAllowedMethod("inbox.list")).toBe(true);
    expect(isRemoteAllowedMethod("tray.status")).toBe(true);
  });

  it("denies auth and license mutation from phone", () => {
    expect(isRemoteAllowedMethod("auth.signIn")).toBe(false);
    expect(isRemoteAllowedMethod("license.activate")).toBe(false);
    expect(isRemoteAllowedMethod("connectors.enable")).toBe(false);
  });
});
```

```ts
// packages/shared/src/remote-protocol.test.ts
import { describe, expect, it } from "vitest";
import { parseControlPlain, serializeControlPlain } from "./remote-protocol.js";

describe("remote-protocol", () => {
  it("round-trips req frames", () => {
    const plain = {
      t: "req" as const,
      id: "1",
      method: "tasks.list",
      params: {},
    };
    const again = parseControlPlain(serializeControlPlain(plain));
    expect(again).toEqual(plain);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @grokdesk/shared test -- src/remote-allowlist.test.ts src/remote-protocol.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/remote-allowlist.ts
const ALLOWED = new Set<string>([
  "tasks.create",
  "tasks.list",
  "tasks.get",
  "tasks.cancel",
  "tasks.setTitle",
  "tasks.delete",
  "tasks.approve",
  "tasks.pauseAll",
  "tasks.resumeAll",
  "events.list",
  "inbox.list",
  "inbox.markRead",
  "inbox.dismiss",
  "artifacts.list",
  "tray.status",
  "rolePacks.list",
  "models.list",
  "settings.get",
  // remote meta (handled by RemoteService, not generic proxy only)
  "remote.status",
  "remote.devices.list",
]);

export function isRemoteAllowedMethod(method: string): boolean {
  return ALLOWED.has(method);
}

export function listRemoteAllowedMethods(): string[] {
  return [...ALLOWED].sort();
}
```

```ts
// packages/shared/src/remote-protocol.ts
import { z } from "zod";

export const ControlPlainSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("req"),
    id: z.string().min(1),
    method: z.string().min(1),
    params: z.unknown(),
  }),
  z.object({
    t: z.literal("res"),
    id: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    t: z.literal("res"),
    id: z.string().min(1),
    ok: z.literal(false),
    error: z.string(),
  }),
  z.object({
    t: z.literal("event"),
    channel: z.string().min(1),
    payload: z.unknown(),
  }),
  z.object({
    t: z.literal("hello"),
    role: z.enum(["desk", "phone"]),
    deviceId: z.string().min(1),
    protocol: z.literal(1),
  }),
]);

export type ControlPlain = z.infer<typeof ControlPlainSchema>;

export function serializeControlPlain(plain: ControlPlain): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(plain));
}

export function parseControlPlain(bytes: Uint8Array): ControlPlain {
  const json = JSON.parse(new TextDecoder().decode(bytes));
  return ControlPlainSchema.parse(json);
}

export const PairOfferPlainSchema = z.object({
  v: z.literal(1),
  deviceId: z.string().min(1),
  deviceLabel: z.string().min(1).max(64),
  devicePub: z.string().min(1), // base64url
  pairSecret: z.string().min(1),
});

export type PairOfferPlain = z.infer<typeof PairOfferPlainSchema>;

export const PairAcceptPlainSchema = z.object({
  v: z.literal(1),
  machineId: z.string().min(1),
  machinePub: z.string().min(1),
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
  channel: z.string().min(1),
});

export type PairAcceptPlain = z.infer<typeof PairAcceptPlainSchema>;
```

- [ ] **Step 4: Export + test PASS + commit**

```ts
// index.ts
export * from "./remote-protocol.js";
export * from "./remote-allowlist.js";
```

```bash
pnpm --filter @grokdesk/shared test -- src/remote-allowlist.test.ts src/remote-protocol.test.ts
git add packages/shared/src/remote-*.ts packages/shared/src/index.ts
git commit -m "feat(shared): remote control protocol and method allowlist"
```

---

### Task 3: DB migration for remote devices

**Files:**
- Modify: `packages/gateway/src/db.ts`
- Create: `packages/gateway/src/db.remote.test.ts` (or extend existing db tests if present)

- [ ] **Step 1: Write failing test**

```ts
// packages/gateway/src/db.remote.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { openDatabase } from "./db.js";

describe("db remote migration", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it("creates remote_devices table at schema v3", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-db-"));
    dirs.push(dir);
    const db = openDatabase(path.join(dir, "t.sqlite"));
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(Number(row.value)).toBeGreaterThanOrEqual(3);
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='remote_devices'",
      )
      .get();
    expect(table).toBeTruthy();
    db.close();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (version still 2)

```bash
pnpm --filter @grokdesk/gateway test -- src/db.remote.test.ts
```

- [ ] **Step 3: Append migration v3**

In `packages/gateway/src/db.ts`, append to `MIGRATIONS`:

```ts
  {
    version: 3,
    sql: `
CREATE TABLE IF NOT EXISTS remote_devices (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  public_key TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS remote_pair_challenges (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  machine_pub TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
```

- [ ] **Step 4: Test PASS + commit**

```bash
pnpm --filter @grokdesk/gateway test -- src/db.remote.test.ts
git add packages/gateway/src/db.ts packages/gateway/src/db.remote.test.ts
git commit -m "feat(gateway): sqlite schema for remote devices"
```

---

### Task 4: Gateway RemoteService (pair + devices + proxy)

**Files:**
- Create: `packages/gateway/src/services/remote.ts`
- Create: `packages/gateway/src/services/remote.test.ts`
- Modify: `packages/gateway/src/index.ts`
- Modify: `packages/shared/src/ipc.ts` (add `remote.*` methods)

- [ ] **Step 1: Add IPC methods to shared**

Append to `IpcRequestSchema` union in `packages/shared/src/ipc.ts`:

```ts
  z.object({
    id: z.string(),
    method: z.literal("remote.status"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("remote.enable"),
    params: z.object({
      relayUrl: z.string().min(1).default("ws://127.0.0.1:8787"),
    }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("remote.disable"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("remote.pairing.start"),
    params: z.object({
      ttlMs: z.number().int().positive().max(900_000).default(120_000),
    }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("remote.devices.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("remote.devices.revoke"),
    params: z.object({ deviceId: z.string().min(1) }),
  }),
```

Add a quick parse test in `packages/shared/src/ipc.test.ts` for `remote.pairing.start`.

- [ ] **Step 2: Failing RemoteService tests**

```ts
// packages/gateway/src/services/remote.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openDatabase } from "../db.js";
import { RemoteService } from "./remote.js";
import {
  b64uEncode,
  decodePairingQr,
  deriveControlKeys,
  generateX25519KeyPair,
  b64uDecode,
} from "@grokdesk/shared";
import { createHash, randomBytes } from "node:crypto";

function sha256b64u(s: string): string {
  return createHash("sha256").update(s).digest("base64url");
}

describe("RemoteService", () => {
  let dir: string;
  let remote: RemoteService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-remote-"));
    const db = openDatabase(path.join(dir, "t.sqlite"));
    remote = new RemoteService(db, {
      machineId: "mach-1",
      getRelayUrl: () => "ws://127.0.0.1:8787",
      getEnabled: () => true,
      setEnabled: () => {},
      getDeskToken: () => "desk-token",
      setDeskToken: () => {},
      getMachineKeyPair: () => {
        // deterministic test key — service should also accept inject
        return generateX25519KeyPair();
      },
      persistMachineKeyPair: () => {},
    });
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("startPairing returns scannable QR that expires in future", () => {
    const { qrString, challengeId } = remote.startPairing({ ttlMs: 60_000 });
    expect(challengeId).toBeTruthy();
    const qr = decodePairingQr(qrString);
    expect(qr.mid).toBe("mach-1");
    expect(qr.relay).toContain("8787");
  });

  it("accepts a valid pair offer and lists device", () => {
    // Use a RemoteService with fixed keys for ECDH
    const machine = generateX25519KeyPair();
    const db = openDatabase(path.join(dir, "t2.sqlite"));
    const svc = new RemoteService(db, {
      machineId: "mach-1",
      getRelayUrl: () => "ws://127.0.0.1:8787",
      getEnabled: () => true,
      setEnabled: () => {},
      getDeskToken: () => "desk-token",
      setDeskToken: () => {},
      getMachineKeyPair: () => machine,
      persistMachineKeyPair: () => {},
    });
    const { qrString } = svc.startPairing({ ttlMs: 60_000 });
    const qr = decodePairingQr(qrString);
    const phone = generateX25519KeyPair();
    const accept = svc.acceptPairOffer({
      deviceId: "dev-1",
      deviceLabel: "Test Phone",
      devicePub: b64uEncode(phone.publicKey),
      pairSecret: qr.secret,
    });
    expect(accept.deviceId).toBe("dev-1");
    expect(accept.channel).toContain("ctrl:");
    const devices = svc.listDevices();
    expect(devices.some((d) => d.id === "dev-1" && !d.revokedAt)).toBe(true);

    const keys = deriveControlKeys({
      mySecret: phone.secretKey,
      theirPublic: machine.publicKey,
      pairSecret: b64uDecode(qr.secret),
    });
    expect(keys.frameKey.length).toBe(32);
  });

  it("revoke blocks device", () => {
    const machine = generateX25519KeyPair();
    const db = openDatabase(path.join(dir, "t3.sqlite"));
    const svc = new RemoteService(db, {
      machineId: "mach-1",
      getRelayUrl: () => "ws://127.0.0.1:8787",
      getEnabled: () => true,
      setEnabled: () => {},
      getDeskToken: () => "desk-token",
      setDeskToken: () => {},
      getMachineKeyPair: () => machine,
      persistMachineKeyPair: () => {},
    });
    const { qrString } = svc.startPairing({ ttlMs: 60_000 });
    const qr = decodePairingQr(qrString);
    const phone = generateX25519KeyPair();
    svc.acceptPairOffer({
      deviceId: "dev-2",
      deviceLabel: "X",
      devicePub: b64uEncode(phone.publicKey),
      pairSecret: qr.secret,
    });
    svc.revokeDevice("dev-2");
    expect(svc.isDeviceActive("dev-2")).toBe(false);
  });
});
```

Trim unused imports (`sha256b64u`, `randomBytes`) when implementing if not needed.

- [ ] **Step 3: Implement RemoteService**

```ts
// packages/gateway/src/services/remote.ts
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import {
  b64uDecode,
  b64uEncode,
  encodePairingQr,
  generateX25519KeyPair,
  randomToken,
  type X25519KeyPair,
  isRemoteAllowedMethod,
  type PairAcceptPlain,
} from "@grokdesk/shared";

export type RemoteDeviceRow = {
  id: string;
  label: string;
  publicKey: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type RemoteHostHooks = {
  machineId: string;
  getRelayUrl: () => string;
  getEnabled: () => boolean;
  setEnabled: (on: boolean) => void;
  getDeskToken: () => string | null;
  setDeskToken: (token: string) => void;
  getMachineKeyPair: () => X25519KeyPair;
  persistMachineKeyPair: (kp: X25519KeyPair) => void;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export class RemoteService {
  constructor(
    private db: Db,
    private hooks: RemoteHostHooks,
  ) {}

  status() {
    return {
      enabled: this.hooks.getEnabled(),
      relayUrl: this.hooks.getRelayUrl(),
      machineId: this.hooks.machineId,
      deviceCount: this.listDevices().filter((d) => !d.revokedAt).length,
    };
  }

  enable(relayUrl: string) {
    if (!this.hooks.getDeskToken()) {
      this.hooks.setDeskToken(randomToken(32));
    }
    // ensure machine key exists
    this.hooks.getMachineKeyPair();
    this.hooks.setEnabled(true);
    return this.status();
  }

  disable() {
    this.hooks.setEnabled(false);
    return this.status();
  }

  startPairing(opts: { ttlMs: number }): {
    qrString: string;
    challengeId: string;
    expiresAt: string;
  } {
    if (!this.hooks.getEnabled()) throw new Error("Remote access is disabled");
    const kp = this.hooks.getMachineKeyPair();
    const secret = randomToken(32);
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + opts.ttlMs).toISOString();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO remote_pair_challenges (id, secret_hash, machine_pub, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        challengeId,
        hashToken(secret),
        b64uEncode(kp.publicKey),
        expiresAt,
        createdAt,
      );
    const qrString = encodePairingQr({
      v: 1,
      mid: this.hooks.machineId,
      mpk: b64uEncode(kp.publicKey),
      secret,
      relay: this.hooks.getRelayUrl(),
      exp: Date.parse(expiresAt),
    });
    return { qrString, challengeId, expiresAt };
  }

  acceptPairOffer(offer: {
    deviceId: string;
    deviceLabel: string;
    devicePub: string;
    pairSecret: string;
  }): PairAcceptPlain & { deviceToken: string } {
    const row = this.db
      .prepare(
        `SELECT id, secret_hash, expires_at FROM remote_pair_challenges
         WHERE secret_hash = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(hashToken(offer.pairSecret)) as
      | { id: string; secret_hash: string; expires_at: string }
      | undefined;
    if (!row) throw new Error("Unknown or expired pairing secret");
    if (Date.parse(row.expires_at) < Date.now()) {
      throw new Error("Pairing challenge expired");
    }
    const deviceToken = randomToken(32);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO remote_devices (id, label, public_key, device_token_hash, created_at, last_seen_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           public_key = excluded.public_key,
           device_token_hash = excluded.device_token_hash,
           revoked_at = NULL,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(
        offer.deviceId,
        offer.deviceLabel,
        offer.devicePub,
        hashToken(deviceToken),
        now,
        now,
      );
    this.db.prepare(`DELETE FROM remote_pair_challenges WHERE id = ?`).run(row.id);
    const kp = this.hooks.getMachineKeyPair();
    return {
      v: 1,
      machineId: this.hooks.machineId,
      machinePub: b64uEncode(kp.publicKey),
      deviceId: offer.deviceId,
      deviceToken,
      channel: `ctrl:${this.hooks.machineId}:${offer.deviceId}`,
    };
  }

  listDevices(): RemoteDeviceRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, public_key as publicKey, created_at as createdAt,
                last_seen_at as lastSeenAt, revoked_at as revokedAt
         FROM remote_devices ORDER BY created_at DESC`,
      )
      .all() as RemoteDeviceRow[];
    return rows;
  }

  revokeDevice(deviceId: string): void {
    this.db
      .prepare(
        `UPDATE remote_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(new Date().toISOString(), deviceId);
  }

  isDeviceActive(deviceId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT revoked_at as revokedAt FROM remote_devices WHERE id = ?`,
      )
      .get(deviceId) as { revokedAt: string | null } | undefined;
    return !!row && !row.revokedAt;
  }

  verifyDeviceToken(deviceId: string, token: string): boolean {
    const row = this.db
      .prepare(
        `SELECT device_token_hash as h, revoked_at as revokedAt FROM remote_devices WHERE id = ?`,
      )
      .get(deviceId) as { h: string; revokedAt: string | null } | undefined;
    if (!row || row.revokedAt) return false;
    return row.h === hashToken(token);
  }

  touchDevice(deviceId: string): void {
    this.db
      .prepare(`UPDATE remote_devices SET last_seen_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), deviceId);
  }

  assertMethodAllowed(method: string): void {
    if (!isRemoteAllowedMethod(method)) {
      throw new Error(`Method not allowed over remote: ${method}`);
    }
  }
}
```

Wire key persistence via settings JSON keys `remote.machineSecretB64`, `remote.machinePubB64`, `remote.deskToken`, `remote.enabled`, `remote.relayUrl` in Gateway constructor hooks (SettingsService get/set).

- [ ] **Step 4: Wire Gateway.handle cases**

In `packages/gateway/src/index.ts`:

- Construct `this.remote = new RemoteService(this.db, hooks)` in `start()`.
- Add switch cases for `remote.status`, `remote.enable`, `remote.disable`, `remote.pairing.start`, `remote.devices.list`, `remote.devices.revoke`.

- [ ] **Step 5: Tests PASS + commit**

```bash
pnpm --filter @grokdesk/shared test
pnpm --filter @grokdesk/gateway test -- src/services/remote.test.ts
git add packages/shared packages/gateway
git commit -m "feat(gateway): remote pairing service and IPC methods"
```

---

### Task 5: Blind relay service (dev)

**Files:**
- Create: `services/remote-relay/package.json`
- Create: `services/remote-relay/tsconfig.json`
- Create: `services/remote-relay/vitest.config.ts`
- Create: `services/remote-relay/src/store.ts`
- Create: `services/remote-relay/src/store.test.ts`
- Create: `services/remote-relay/src/index.ts`
- Modify: `pnpm-workspace.yaml` → add `services/*`

- [ ] **Step 1: Workspace + package skeleton**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"
```

`services/remote-relay/package.json`:

```json
{
  "name": "@grokdesk/remote-relay",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Store tests + implementation**

In-memory:

- `register(role, machineId, deviceId?, token)`  
- `send(channel, blob, fromToken)` → enqueue for other subscribers  
- `subscribe(channel, token, push)`  

Reject mismatched tokens.

- [ ] **Step 3: WS server**

Listen `process.env.PORT || 8787`. On message JSON, dispatch. Log only machineId/deviceId/channel/byte length — never blob contents in production log level (dev may log length only).

- [ ] **Step 4: Manual smoke**

```bash
pnpm install
pnpm --filter @grokdesk/remote-relay test
pnpm --filter @grokdesk/remote-relay dev
# second terminal: websocat or small script join two clients on channel test
```

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml services/remote-relay pnpm-lock.yaml
git commit -m "feat(relay): blind WebSocket frame router for remote access"
```

---

### Task 6: Desk remote session (main process)

**Files:**
- Create: `apps/desktop/src/main/remote-session.ts`
- Create: `apps/desktop/src/main/remote-frame-codec.ts` (pure encode/decode helpers if easier to test)
- Create: `apps/desktop/src/main/remote-frame-codec.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Behavior:**

1. When `remote.enable` / settings say enabled, connect WS to relay as `role=desk`.  
2. On `remote.pairing.start`, main already has QR from gateway; phone will send pair offer over relay channel `pair:{machineId}` as **sealed** blob OR clear JSON for pair offer only if sealed with machine public key.

**P0 pair offer transport:** Phone sends relay message on channel `pair:{mid}`:

```json
{ "type": "pair_offer", "deviceId", "deviceLabel", "devicePub", "pairSecret" }
```

This is the **one** exception where pairSecret appears on the wire to the relay. To keep the cloud blind to long-term secrets: pairSecret is single-use and expires in minutes; relay still must not log bodies. **Better P0.1:** seal pair_offer with machine public key (nacl box). Implement seal with machine `mpk` from QR using X25519 + ephemeral phone key already in offer — for true blindness, encrypt `pairSecret` field so relay sees only ciphertext.

**Minimum for P0 security story:** entire `pair_offer` JSON sealed with `sealFrame(HKDF(pairSecret), ...)` wait — chicken and egg. Use: `crypto_box_seal` equivalent to machine public key (ephemeral). Implement `sealToPublic(machinePub, plain)` / `openSealed(machineSecret, sealed)` in remote-crypto Task 1 follow-up if not done — add in this task if missing.

3. After accept, desk derives `frameKey` for device, listens on `ctrl:{mid}:{deviceId}`.  
4. On `req` frames, call `gateway.handle({ id, method, params })` after allowlist check; return `res`.  
5. Optionally push `event` when task updates (poll `events.list` or hook runner) — **P0 minimum:** phone polls `events.list` via req.

- [ ] **Step 1: Unit-test frame request dispatch pure function**

```ts
// apps/desktop/src/main/remote-frame-codec.test.ts
import { describe, expect, it } from "vitest";
import {
  deriveControlKeys,
  generateX25519KeyPair,
  sealFrame,
  openFrame,
  serializeControlPlain,
  parseControlPlain,
  b64uEncode,
} from "@grokdesk/shared";

describe("remote frame roundtrip", () => {
  it("req/res over seal", () => {
    const a = generateX25519KeyPair();
    const b = generateX25519KeyPair();
    const secret = new Uint8Array(32).fill(3);
    const { frameKey } = deriveControlKeys({
      mySecret: a.secretKey,
      theirPublic: b.publicKey,
      pairSecret: secret,
    });
    const sealed = sealFrame(
      frameKey,
      serializeControlPlain({
        t: "req",
        id: "1",
        method: "tasks.list",
        params: {},
      }),
    );
    const plain = parseControlPlain(openFrame(frameKey, sealed));
    expect(plain).toMatchObject({ t: "req", method: "tasks.list" });
  });
});
```

(If desktop vitest cannot import monorepo package easily, put this test in shared instead — already covered. Then only integration logic in remote-session.)

- [ ] **Step 2: Implement `RemoteSessionHost` class**

```ts
// apps/desktop/src/main/remote-session.ts
// Pseudocode structure — implement fully:
// class RemoteSessionHost {
//   constructor(private gateway: Gateway) {}
//   async start(): Promise<void>
//   async stop(): Promise<void>
//   // ws onmessage → pair_offer | encrypted ctrl frame
//   private async onControlFrame(deviceId: string, sealed: Uint8Array)
// }
```

Key loop for control:

```ts
const plain = parseControlPlain(openFrame(frameKey, sealed));
if (plain.t === "req") {
  try {
    this.gateway.remote.assertMethodAllowed(plain.method);
    const result = await this.gateway.handle({
      id: plain.id,
      method: plain.method,
      params: plain.params ?? {},
    } as IpcRequest);
    await this.sendControl(deviceId, {
      t: "res",
      id: plain.id,
      ok: true,
      result,
    });
  } catch (e) {
    await this.sendControl(deviceId, {
      t: "res",
      id: plain.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
```

- [ ] **Step 3: Start/stop with app lifecycle in `index.ts`**

- [ ] **Step 4: Manual test with relay + scripted phone client (Task 7 can help)**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desktop): desk-side remote session over blind relay"
```

---

### Task 7: Desktop Settings → Remote tab (QR + devices)

**Files:**
- Create: `apps/desktop/src/renderer/components/views/settings/remote-tab.tsx`
- Create: `apps/desktop/src/renderer/lib/remote-ui.ts`
- Create: `apps/desktop/src/renderer/lib/remote-ui.test.ts`
- Modify: settings view to include tab
- Modify: i18n `en.json` keys for remote strings

- [ ] **Step 1: Pure UI helpers tests**

```ts
// apps/desktop/src/renderer/lib/remote-ui.test.ts
import { describe, expect, it } from "vitest";
import { formatDeviceLastSeen, isDeviceActive } from "./remote-ui";

describe("remote-ui", () => {
  it("formats missing last seen", () => {
    expect(formatDeviceLastSeen(null)).toMatch(/never/i);
  });
  it("active when not revoked", () => {
    expect(isDeviceActive({ revokedAt: null })).toBe(true);
    expect(isDeviceActive({ revokedAt: "2026-01-01" })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement helpers + Remote tab UI**

UI elements:

- Toggle Enable remote access → `remote.enable` / `remote.disable`  
- Show relay URL input (default `ws://127.0.0.1:8787`)  
- Button “Show pairing QR” → `remote.pairing.start` → render QR via `qrcode` package or pure SVG library  
- Device table: label, last seen, Revoke button  

Add dependency if needed:

```bash
pnpm --filter @grokdesk/desktop add qrcode
pnpm --filter @grokdesk/desktop add -D @types/qrcode
```

- [ ] **Step 3: Manual** — open Settings, enable, show QR, list empty devices

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): remote access settings tab with QR pairing"
```

---

### Task 8: Mobile Expo app scaffold + secure key storage

**Files:**
- Create: `apps/mobile/**` (Expo)
- Modify: root `package.json` scripts optional
- Modify: `pnpm-workspace.yaml` already has `apps/*`

- [ ] **Step 1: Scaffold**

```bash
cd /Users/maceo/blockvantage/grok-desktop/apps
# Use Expo TS template; name @grokdesk/mobile
pnpm create expo-app mobile --template blank-typescript
```

Wire workspace package name `@grokdesk/mobile`. Depend on `@grokdesk/shared` via `workspace:*`.

Note: Expo may need metro config to transpile workspace package:

```js
// metro.config.js — watch monorepo packages/shared
```

- [ ] **Step 2: Install app deps**

```bash
pnpm --filter @grokdesk/mobile add expo-secure-store expo-camera react-native-get-random-values @noble/curves @noble/ciphers @noble/hashes
```

Polyfill at top of `App.tsx`:

```ts
import "react-native-get-random-values";
```

- [ ] **Step 3: Device key storage**

```ts
// apps/mobile/src/storage/device-keys.ts
import * as SecureStore from "expo-secure-store";
import {
  b64uDecode,
  b64uEncode,
  generateX25519KeyPair,
} from "@grokdesk/shared";

const SK = "remote.device.secret";
const PK = "remote.device.public";
const ID = "remote.device.id";

export async function getOrCreateDeviceIdentity(): Promise<{
  deviceId: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}> {
  let deviceId = await SecureStore.getItemAsync(ID);
  let sk = await SecureStore.getItemAsync(SK);
  let pk = await SecureStore.getItemAsync(PK);
  if (!deviceId || !sk || !pk) {
    const kp = generateX25519KeyPair();
    deviceId = crypto.randomUUID();
    sk = b64uEncode(kp.secretKey);
    pk = b64uEncode(kp.publicKey);
    await SecureStore.setItemAsync(ID, deviceId);
    await SecureStore.setItemAsync(SK, sk);
    await SecureStore.setItemAsync(PK, pk);
  }
  return {
    deviceId,
    secretKey: b64uDecode(sk),
    publicKey: b64uDecode(pk),
  };
}
```

- [ ] **Step 4: App boots to Pair or Home based on stored session**

Store after pair: `remote.session` JSON `{ machineId, machinePub, deviceToken, channel, relay, pairSecret }` in SecureStore.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): Expo app scaffold and device key storage"
```

---

### Task 9: Mobile pair flow + control client

**Files:**
- Create: `apps/mobile/src/relay/client.ts`
- Create: `apps/mobile/src/api/gateway.ts`
- Create: `apps/mobile/src/screens/PairScreen.tsx`
- Create: `apps/mobile/src/state/connection.tsx`

- [ ] **Step 1: Relay client**

WebSocket wrapper: connect, hello, send/recv by channel, reconnect with backoff.

- [ ] **Step 2: `gatewayRequest(method, params)`**

```ts
// builds ControlPlain req, seals, waits for res id match, timeout 30s
```

- [ ] **Step 3: PairScreen**

1. Scan QR (expo-camera barcode) or paste string in dev.  
2. `decodePairingQr`.  
3. Connect relay, send pair_offer on `pair:{mid}` (sealed to machine pub if implemented).  
4. Wait for pair_accept (encrypted or clear token once) — **P0:** desk replies on same channel with accept payload encrypted under frame key derived after offer…  

**Concrete P0 pair handshake:**

1. Phone → relay channel `pair:{mid}`: sealed-to-machinePub(JSON offer).  
2. Desk opens, `acceptPairOffer`, derives frameKey, sends on `pair:{mid}` sealed with frameKey: `PairAcceptPlain`.  
3. Phone derives same frameKey via ECDH + pairSecret, opens accept, stores session, switches to `channel` for all further traffic.

- [ ] **Step 4: Integration smoke (local)**

Terminal A: relay  
Terminal B: desktop dev, enable remote, show QR  
Terminal C: mobile simulator / Expo, scan  

Expect: device appears on desk; mobile `tasks.list` returns array.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): QR pairing and E2E gateway request client"
```

---

### Task 10: Mobile Home + Tasks + Approvals + Inbox + Pause

**Files:**
- Create screens listed in file structure
- Create: `apps/mobile/src/navigation.tsx`

- [ ] **Step 1: HomeScreen**

- Call `tray.status` + `tasks.list` + `inbox.list`  
- Quick create: `tasks.create` with goal text, default workspace via `workspace.ensureTemp` **if allowlisted** — add `workspace.ensureTemp` to allowlist in Task 2 if needed for create.  

Update allowlist to include `workspace.ensureTemp` for mobile create flow.

- Pause all button → `tasks.pauseAll`

- [ ] **Step 2: TasksScreen + TaskDetailScreen**

- List tasks  
- Detail: poll `events.list` every 1s while focused (`afterSeq`)  
- Composer: for P0, create follow-up by `tasks.create` with `parentTaskId` if supported — check gateway. If not, only root create + show stream.  

Inspect `tasks.create` for parent — supported in schema. Runner may treat as follow-up; if not wired, show stream read-only + approve only.

**Approvals:** when event kind is approval or task status waiting, show Approve/Reject → `tasks.approve`.

- [ ] **Step 3: InboxScreen**

`inbox.list`, markRead, dismiss, navigate to taskId.

- [ ] **Step 4: Manual QA checklist**

- [ ] Pair  
- [ ] Create task from phone  
- [ ] See events while desk runs  
- [ ] Approve from phone  
- [ ] Pause all  
- [ ] Revoke on desk disconnects phone  

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mobile): home, tasks, inbox, approvals, pause-all"
```

---

### Task 11: End-to-end automated integration test (Node)

**Files:**
- Create: `packages/gateway/src/services/remote.e2e.test.ts`  
  Or `services/remote-relay/src/e2e.pair.test.ts`

Simulate phone and desk without Electron:

1. Start in-process relay store.  
2. Gateway + RemoteService pair.  
3. Derive keys, seal `tasks.list` req, desk proxy handler returns list.  

- [ ] **Step 1: Write e2e test that fails without wiring**

- [ ] **Step 2: Implement until green**

- [ ] **Step 3: Commit**

```bash
git commit -m "test(remote): e2e pairing and encrypted tasks.list proxy"
```

---

### Task 12: Docs + developer README for remote

**Files:**
- Create: `docs/remote-dev.md`
- Modify: root `README.md` with link

Content:

```markdown
# Remote access (dev)

1. `pnpm --filter @grokdesk/remote-relay dev`
2. `pnpm dev` (desktop)
3. Settings → Remote → Enable → Show QR
4. `pnpm --filter @grokdesk/mobile start` → scan QR

Security: relay is blind to control frames; do not log blobs.
```

- [ ] **Step 1: Write docs**  
- [ ] **Step 2: Commit**

```bash
git commit -m "docs: remote access local development guide"
```

---

## P1+ (not in this plan)

Separate plans after P0 merges:

| Plan | Scope |
|------|--------|
| P1 | WebRTC telepresence, capture, input → HostBridge, Desk tab |
| P2 | Schedule + Memory mobile screens |
| P3 | Settings depth, multi-display, offline queue, push |

---

## Spec coverage (P0)

| Spec requirement | Task |
|------------------|------|
| QR pairing | 1, 4, 7, 9 |
| Blind relay | 5 |
| E2E control frames | 1, 2, 6, 9 |
| Personal devices + revoke | 3, 4, 7 |
| Tasks / approvals / inbox / pause | 2 allowlist, 6 proxy, 10 |
| Desktop device list | 7 |
| Anywhere (relay) | 5, 6, 9 |
| Telepresence | **Deferred P1** |
| Schedule/Memory UI | **Deferred P2** |

---

## Execution notes

- Prefer **subagent-driven-development** one task at a time.  
- Keep commits as specified.  
- If `@noble/curves` import paths differ, fix to package’s actual exports before forcing APIs.  
- Expo + monorepo: budget time for Metro `watchFolders` / `nodeModulesPaths`.  
- Default relay `ws://127.0.0.1:8787` is for same-machine simulator; real phone needs LAN IP or deployed relay (`ws://<lan-ip>:8787` or wss production).
