# Mobile Remote — Parallel Streams Plan

> **For agentic workers:** Three independent workstreams + one frozen contract. Use separate git worktrees/branches. Merge via integration PR after each stream hits its demo gate.

**Goal:** Build Grok Desk Remote as three parallel deliverables that meet at a frozen protocol, not one serial megapr.

**Parent spec:** `docs/superpowers/specs/2026-07-12-mobile-remote-design.md`  
**Detailed P0 task breakdown (serial reference):** `docs/superpowers/plans/2026-07-12-mobile-remote-p0.md`

---

## 1. Why three streams

| Stream | What | Where | Why separate |
|--------|------|--------|--------------|
| **A · Desk counterpart** | Pairing, devices, E2E control proxy, Settings QR UI | `~/blockvantage/grok-desktop` worktree | Touches gateway + Electron; product source of truth |
| **B · Relay backend** | Blind connection router (WS + auth tokens + channels) | same monorepo `services/remote-relay` **or** deployable service repo | Ops/deploy surface; no product plaintext |
| **C · Mobile app** | End-user iOS/Android product | `apps/mobile` in monorepo (preferred) or sibling repo | Different release cycle, store tooling |

They only share the **wire contract** below. They must **not** edit each other’s ownership paths in the same PR.

---

## 2. Frozen contract (the only shared dependency)

**Document of record:** this section + fixtures under `docs/remote/protocol-v1/` (created in Contract Boot).

### 2.1 Roles

```
Phone  ──ciphertext──►  Relay  ──ciphertext──►  Desk gateway
         (blind)                  (blind)
```

### 2.2 QR (`PairingQrV1`)

String form: `grokdesk://pair/` + base64url(UTF-8 JSON)

```json
{
  "v": 1,
  "mid": "machine-uuid",
  "mpk": "<base64url 32-byte X25519 public>",
  "secret": "<base64url 32-byte one-time pair secret>",
  "relay": "wss://relay.example.com/v1",
  "exp": 1710000000000
}
```

### 2.3 Relay WebSocket (cleartext JSON envelope only — **payload blobs are opaque**)

**Client → relay**

```ts
{ "type": "hello", "role": "desk" | "phone", "machineId": string, "deviceId"?: string, "token": string }
{ "type": "send", "channel": string, "blob": string }  // blob = base64url ciphertext OR sealed pair blob
{ "type": "ping" }
```

**Relay → client**

```ts
{ "type": "welcome", "connectionId": string }
{ "type": "recv", "channel": string, "blob": string, "from": "desk" | "phone" }
{ "type": "err", "code": string, "message": string }
{ "type": "pong" }
```

**Channels**

| Channel | Purpose |
|---------|---------|
| `pair:{machineId}` | Pairing handshake blobs (short-lived) |
| `ctrl:{machineId}:{deviceId}` | E2E control frames after pair |

**Auth (routing only, not content keys)**

- Desk `hello`: `token` = desk relay token (created when remote is enabled on machine).  
- Phone `hello`: `token` = `deviceToken` issued at pair accept (desk registers token with relay **or** phone presents token desk also knows — P0: desk registers on pair accept via control to relay `type: register_device` optional; simpler P0: relay accepts any token on first hello for that deviceId and binds it — **prefer desk-minted tokens verified by desk only for product auth; relay only checks non-empty token match on reconnect**).  

**P0 relay auth algorithm (simple, deployable):**

1. Desk hello with `role=desk`, `machineId`, `token=deskToken` → relay stores `deskTokens[machineId]=token` (first writer or constant refresh from desk).  
2. Phone hello with `role=phone`, `machineId`, `deviceId`, `token=deviceToken` → if channel not revoked, accept and bind.  
3. `send` allowed only if hello succeeded and channel prefix matches `machineId` / `deviceId`.  
4. Relay **never** inspects `blob`.

### 2.4 Pairing plaintext (inside sealed blob on `pair:{mid}`)

**Phone → Desk (`pair_offer`)** — seal to machine public key when possible; P0 may use AEAD keyed by `pairSecret` alone for the offer body after QR scan (both know secret).

```json
{
  "v": 1,
  "kind": "pair_offer",
  "deviceId": "uuid",
  "deviceLabel": "Maceo’s iPhone",
  "devicePub": "<base64url X25519 pub>",
  "pairSecret": "<same as QR secret>"
}
```

**Desk → Phone (`pair_accept`)**

```json
{
  "v": 1,
  "kind": "pair_accept",
  "machineId": "…",
  "machinePub": "…",
  "deviceId": "…",
  "deviceToken": "…",
  "channel": "ctrl:{machineId}:{deviceId}"
}
```

### 2.5 Control plaintext (E2E on `ctrl:…`, XChaCha20-Poly1305 frame = nonce24||ct)

```ts
{ "t": "req", "id": string, "method": string, "params": unknown }
{ "t": "res", "id": string, "ok": true, "result": unknown }
{ "t": "res", "id": string, "ok": false, "error": string }
{ "t": "hello", "role": "desk" | "phone", "deviceId": string, "protocol": 1 }
```

**Key derivation**

```
shared = X25519(mySecret, theirPublic)
frameKey = HKDF-SHA256(
  ikm = shared || pairSecret,
  salt = "grokdesk-remote-v1",
  info = "control-frame",
  len = 32
)
```

### 2.6 Mobile method allowlist (desk must enforce)

Allowed:  
`tasks.create|list|get|cancel|setTitle|delete|approve|pauseAll|resumeAll`,  
`events.list`, `inbox.list|markRead|dismiss`, `artifacts.list`, `tray.status`,  
`rolePacks.list`, `models.list`, `settings.get`, `workspace.ensureTemp`,  
`remote.status`, `remote.devices.list`

Denied examples: `auth.*`, `license.*`, `connectors.*`, `settings.set` (P0), shell-ish host methods not in list.

### 2.7 Demo fixtures (Contract Boot must add)

`docs/remote/protocol-v1/fixtures/`:

- `qr-valid.json` + `qr-string.txt`  
- `pair-offer.json` / `pair-accept.json`  
- `control-req-tasks-list.json`  
- `vectors.json` — fixed keypairs + expected `frameKey` hex for cross-implementation tests  

Any stream may implement against fixtures without waiting for another stream’s code.

---

## 3. Stream A — Desk counterpart (worktree)

### Ownership (only these paths)

```
packages/shared/src/remote-*.ts     # crypto, protocol, allowlist (canonical impl)
packages/gateway/src/db.ts          # remote tables
packages/gateway/src/services/remote.ts
packages/gateway/src/index.ts       # IPC wire-up
apps/desktop/src/main/remote-session.ts
apps/desktop/src/renderer/.../remote-tab.tsx
docs/remote/                        # may update fixtures if vectors change (coordinate)
```

**Must not touch:** `services/remote-relay/**`, `apps/mobile/**`

### Worktree

```bash
# from grok-desktop main
git worktree add .worktrees/remote-desk -b feat/remote-desk
cd .worktrees/remote-desk && pnpm install
```

### Deliverables (demo gate A)

1. Settings → Remote: enable, show QR (protocol-valid string), device list, revoke  
2. Desk process connects to relay as `role=desk`  
3. Accepts pair_offer, persists device, derives frameKey  
4. Proxies allowlisted `IpcRequest` on control channel; denies others  
5. Unit tests: crypto vectors match fixtures; remote service tests green  

### Internal task order (A)

1. Contract fixtures (if not already on branch) + `remote-crypto` / protocol / allowlist in shared  
2. DB + RemoteService + IPC  
3. `remote-session` main client  
4. Settings QR UI  
5. Scripted self-test: fake phone Node script in `packages/gateway` or `scripts/remote-fake-phone.mjs` that pairs and calls `tasks.list`  

### Definition of done (A)

`pnpm --filter @grokdesk/shared test` and gateway remote tests pass; fake-phone script succeeds against local relay + running desk **or** gateway-only harness.

---

## 4. Stream B — Relay backend (server)

### Ownership

```
services/remote-relay/**
# optional later: Dockerfile, fly.toml / deploy manifests under services/remote-relay/deploy/
```

**Must not touch:** `packages/gateway/**`, `apps/**` product UI (may read protocol docs only)

### Worktree

```bash
git worktree add .worktrees/remote-relay -b feat/remote-relay
cd .worktrees/remote-relay && pnpm install
```

### Deliverables (demo gate B)

1. Process listens on `PORT` (default `8787`)  
2. `GET /health` → `{ ok: true }`  
3. WebSocket `/v1` (or root) implements hello/send/recv/err/ping per §2.3  
4. Two clients can exchange opaque blobs on a channel without the server logging blob contents  
5. Basic rate limit / max blob size (e.g. 256KB)  
6. README: local run + env vars (`PORT`, `HOST`)  
7. Deploy notes: single Fly/Railway/VM instance is enough for personal scale  

### Out of scope for B

- E2E crypto  
- Task/business logic  
- Storing pair secrets or frame keys  
- TURN/WebRTC (P1)  

### Definition of done (B)

Automated test: two mock sockets hello + send/recv round-trip; `pnpm --filter @grokdesk/remote-relay test` green; `dev` runs cleanly.

### Production shape (plan, implement when demo works)

| Item | Choice |
|------|--------|
| Runtime | Node 20+ TypeScript |
| State | In-memory first; sticky single instance |
| TLS | Terminate at reverse proxy (`wss://`) |
| Logs | connectionId, machineId, channel, byte length — **never blob** |

---

## 5. Stream C — Mobile app (end product)

### Ownership

```
apps/mobile/**
```

**Must not touch:** gateway internals, relay server code (consume public WS URL only)

### Worktree

```bash
git worktree add .worktrees/remote-mobile -b feat/remote-mobile
cd .worktrees/remote-mobile && pnpm install
# Expo may need: pnpm --filter @grokdesk/mobile ... after scaffold
```

### Dependency on shared

- **Preferred:** depend on `@grokdesk/shared` workspace package once Stream A lands crypto on a mergeable branch.  
- **Parallel-safe path:** until A merges, implement against **fixtures** with a thin local `src/protocol/` copy of types; replace with `@grokdesk/shared` import in integration week.  
- Do **not** reimplement divergent QR/version fields — run fixture vectors in mobile unit tests (pure JS).

### Deliverables (demo gate C)

1. Expo app boots on iOS sim and/or Android emulator  
2. Pair screen: paste QR string (camera optional v1)  
3. SecureStore device keys + session  
4. Relay client + E2E `gatewayRequest(method, params)`  
5. Screens: Home (status, pause all, quick task), Tasks list/detail (poll events), Inbox, Approvals  
6. Unpair wipes local session  

### Out of scope for C (this phase)

- Telepresence / WebRTC (P1)  
- Full settings/memory/schedule parity (P2)  
- App Store submission polish  

### Definition of done (C)

Against **mock desk** (Node fake implementing pair_accept + tasks.list) **or** real desk when available: pair → list tasks → pause all. UI navigable offline with connection error states.

---

## 6. Parallel execution rules

### Do

- Implement only your ownership paths  
- Treat §2 as law; open a short RFC comment in PR if you must change the contract  
- Use fixtures for unit tests immediately  
- Run your stream’s tests in isolation  

### Don’t

- Change QR field names without bumping `v` and updating all three streams  
- Log ciphertext blobs on the relay  
- Have mobile call non-allowlisted methods expecting success  
- Merge stream branches into main without integration smoke  

### Shared package merge order

```
1) Contract Boot (fixtures + protocol doc)     → main or feat/remote-contract
2) Stream A shared crypto (packages/shared)    → merge early if possible
3) Streams B + C continue in parallel
4) Integration: A+B+C on one machine
```

If A’s shared crypto is delayed, B is unaffected; C uses fixture-local crypto matching vectors.

---

## 7. Integration plan (after parallel demo gates)

**Owner:** orchestrator (human or lead agent), not a fourth feature stream.

| Step | Action |
|------|--------|
| I1 | Merge B (relay) first — no product deps |
| I2 | Merge A (desk) — depends on relay URL default |
| I3 | Merge C (mobile) — point at shared package |
| I4 | Smoke: relay up → desk enable QR → phone pair → create task → approve → pause → revoke |
| I5 | Point QR `relay` at hosted `wss://` for off-LAN test |

**Conflict hotspots:** only `pnpm-workspace.yaml`, root `package.json`, `pnpm-lock.yaml`. Resolve carefully; prefer A owns workspace entries for `apps/mobile` if C added them, B owns `services/*` entry — do in Contract Boot:

```yaml
# pnpm-workspace.yaml (land once in Contract Boot)
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"
```

---

## 8. Contract Boot (serial, ~30–60 min, before or as first parallel hour)

Single small PR/branch `feat/remote-contract`:

- [ ] Add `docs/remote/protocol-v1/README.md` (copy of §2)  
- [ ] Add fixtures + `vectors.json` with fixed keys  
- [ ] Add `services/*` to `pnpm-workspace.yaml`  
- [ ] Add placeholder `services/remote-relay/package.json` name only **or** leave empty dir with `.gitkeep`  
- [ ] Add `apps/mobile/.gitkeep` optional  

Then open three worktrees and run A/B/C agents.

---

## 9. Agent dispatch template

### Agent A — Desk

```
Repo worktree: .worktrees/remote-desk (branch feat/remote-desk)
Read: docs/superpowers/plans/2026-07-12-mobile-remote-parallel-streams.md §2–3
      docs/superpowers/specs/2026-07-12-mobile-remote-design.md
Implement Stream A only. Do not edit services/remote-relay or apps/mobile.
Match protocol v1 fixtures. TDD for crypto and RemoteService.
Stop at demo gate A; return summary + how to run fake-phone test.
```

### Agent B — Relay

```
Repo worktree: .worktrees/remote-relay (branch feat/remote-relay)
Read: parallel-streams plan §2.3 and §4
Implement blind WS relay only. No product crypto. Never log blobs.
Tests for two-client round-trip. README for deploy.
Stop at demo gate B; return port, health URL, how to run.
```

### Agent C — Mobile

```
Repo worktree: .worktrees/remote-mobile (branch feat/remote-mobile)
Read: parallel-streams plan §2 and §5
Scaffold Expo app under apps/mobile. Pair + control client + Home/Tasks/Inbox/Approvals/Pause.
Use protocol fixtures; import @grokdesk/shared if available on branch, else local protocol copy matching vectors.
Do not edit gateway or relay server.
Stop at demo gate C; return Expo start command + limitations.
```

---

## 10. Timeline (indicative)

| Day | A Desk | B Relay | C Mobile |
|-----|--------|---------|----------|
| 0 | Contract boot (shared) | Contract boot | Contract boot |
| 1 | Crypto + RemoteService | WS core + tests | Expo scaffold + keys |
| 2 | remote-session + QR UI | Health, limits, README | Pair + gatewayRequest |
| 3 | Fake-phone e2e | Deploy staging wss | Home/Tasks/Inbox UI |
| 4 | Integration smoke with B+C | Integration support | Integration smoke |

---

## 11. Success criteria (all streams)

- [ ] Phone pairs via QR through **hosted or local** relay  
- [ ] Control traffic is E2E encrypted (relay operator cannot read task text)  
- [ ] Desk shows device and can revoke  
- [ ] Phone: list/create task, see stream (poll), approve, pause all  
- [ ] Three PRs mergeable with path discipline  

---

## 12. Mapping from serial P0 plan

| Serial P0 task | Stream |
|----------------|--------|
| 1–2 shared crypto/protocol | A (+ Contract Boot fixtures) |
| 3–4 gateway remote | A |
| 5 relay | B |
| 6–7 desk session + UI | A |
| 8–10 mobile | C |
| 11 e2e | Integration (I4) |
| 12 docs | Each stream’s README + Contract Boot |
