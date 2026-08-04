# Grok Desk Mobile Remote — Design Spec

**Date:** 2026-07-12  
**Status:** Draft for review  
**Working name:** Grok Desk Remote (iOS + Android)  
**Companion to:** `docs/superpowers/specs/2026-07-10-grok-desk-design.md`

## 1. Summary

Grok Desk Remote is a **personal mobile client** for a paired Grok Desk machine. Users scan a QR code on the desktop app, then control the coworker and the host machine from anywhere on the internet: tasks, approvals, inbox, and full telepresence (live screen + input).

The agent, memory, policy, and tools stay **local on the desk**. A small cloud service provides pairing rendezvous, signaling, and optional media relay only. All product traffic is **end-to-end encrypted** so the relay operator cannot read goals, messages, screen content, or keystrokes.

### One-liner

> Pair with a QR, run Grok Desk from your phone — tasks and the machine, anywhere, with a blind relay.

## 2. Goals and non-goals

### Goals

| Goal | Detail |
|------|--------|
| Anywhere access | Phone works off the desk LAN via internet |
| Full telepresence | Live display stream + remote mouse/keyboard-class input in the product |
| Coworker control | Tasks, live streams, create/stop, approvals, inbox, pause-all |
| Whole-app IA | One app surface that grows to desk parity (Home, Tasks, Desk, Schedule, Memory, Settings) |
| Personal devices only | Owner’s phones/tablets; no guest/team sharing in v1 |
| QR pairing | Scan-to-bind; pairing-token trust (no SuperGrok login on phone in v1) |
| Blind cloud | Hosted relay cannot decrypt product content |
| Reuse desk brain | Extend local gateway + HostBridge + existing `IpcRequest` surface |
| iOS + Android | Single cross-platform client (Expo / React Native) |

### Non-goals (initial product)

- Cloud-hosted agent or moving gateway state off-machine
- Multi-user / guest / role-based sharing
- Face ID / SuperGrok re-auth on phone (explicitly deferred; pairing token only)
- Pixel-identical clone of every desktop settings screen on day one
- Slack/Telegram/email as the remote channel
- Public multi-tenant “remote desktop SaaS” positioning beyond personal Desk owners

## 3. Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Connectivity | Anywhere on the internet |
| Architecture | Remote Access Plane (Approach A) |
| Trust | Personal devices only |
| Phone auth | Pairing token only |
| Privacy | E2E encryption; cloud is blind plumbing |
| Scope shape | Full app design now; ship in phases P0→P3 |
| Telepresence | In scope for early product (P1), not “maybe later forever” |

## 4. User surfaces

### 4.1 Mobile root navigation

Four primary tabs:

| Tab | Purpose |
|-----|---------|
| **Home** | Machine status, needs-you, active work, quick capture, pause-all |
| **Tasks** | Task list + task workspace (stream, composer, artifacts, approvals) |
| **Desk** | Telepresence: live screen, control modes, quality, disconnect |
| **More** | Inbox, Schedule, Memory, Machine, Settings |

Global chrome:

- Connection state: Online · Reconnecting · Offline · Desk asleep  
- Indicator when a telepresence session is active  
- Easy access to **Pause all** (Home, Desk, and optionally a system notification action)

### 4.2 Onboarding

1. Splash: value prop (“Control your desk from anywhere”)  
2. Scan QR from Grok Desk → Remote access  
3. Optional device label (“iPhone”, “Pixel”)  
4. Land on Home bound to that machine  

Re-pair: Settings → Unpair, or desk revokes device → phone returns to scan flow.

### 4.3 Home

- Machine display name + online/remote-session state  
- Needs-you summary → Inbox  
- Active tasks strip → Task detail  
- Quick task field → `tasks.create`  
- Shortcuts: Open Desk tab, Pause all  

### 4.4 Tasks

**List:** status chips, basic filter/search, new task.

**Workspace:**

- Live event stream (messages, steps, tools)  
- Approval cards inline or as sheet  
- Artifacts list (metadata + open/download when gateway supports mobile-safe delivery)  
- Composer for follow-up messages  
- Actions: stop/cancel, rename where API allows  

### 4.5 Approvals

Modal/sheet aligned with desktop semantics:

- Tool / action summary and risk context  
- Approve / Reject  
- Maps to gateway methods (`tasks.approve`, browser host approval paths as exposed)

### 4.6 Inbox

- Needs-you items, automation suggestions, system notices  
- Deep link into task or schedule flow  

### 4.7 Desk (telepresence)

- Full-bleed stream of the selected display  
- Input modes: Touch (tap/drag/scroll), trackpad-like pointer, software keyboard  
- Quality presets: Auto / Smooth / Crisp  
- Controls: disconnect, pause-all, optional keep-awake  
- Optional picture-in-picture when leaving the tab (phase polish)  
- Multi-display picker: phase after single-display solid  

### 4.8 Schedule / Memory / Machine / Settings

| Screen | Intent |
|--------|--------|
| **Schedule** | List upcoming/past; create/edit rules via existing scheduler APIs |
| **Memory** | View (then edit) profile/projects/preferences the gateway already exposes |
| **Machine** | Bound machine identity, session status, disconnect; revoke is desk-side |
| **Settings** | Stream defaults, notifications, haptics/keep-awake, diagnostics (opaque ids), unpair |

### 4.9 Desktop (Grok Desk) additions

| Surface | Purpose |
|---------|---------|
| Settings → Remote access | Enable remote, show QR, rotation of pairing secret, device list, revoke, last seen |
| In-app + tray banner | “{device} connected” / “controlling desktop” |
| Tray actions | Open remote settings, pause remote input, disable remote |
| Policy | Remote sessions obey same approval modes as local; no bypass of host policy |

## 5. Architecture

### 5.1 High-level

```
┌──────────────────────┐         E2E ciphertext          ┌─────────────────────────────┐
│  iOS / Android app   │◄──────────────────────────────►│  Grok Desk (local gateway)  │
│  Expo / React Native │     via blind cloud relay       │  tasks · memory · policy    │
│  device key in KS    │                                 │  HostBridge desktop/browser │
└──────────┬───────────┘                                 └──────────────▲──────────────┘
           │                                                            │
           │  pairing rendezvous · WS route · WebRTC signal · TURN      │
           ▼                                                            │
┌──────────────────────────────────────────────────────────────────────┴──────┐
│  Blind cloud (no product plaintext)                                          │
│  opaque IDs · public keys · sealed blobs · routing tokens                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Components

| Component | Responsibility |
|-----------|----------------|
| **Mobile app** | UI, local device key, QR scan, control client, WebRTC consumer, notifications |
| **Desk remote module** | Pairing ceremony, session keys, method allowlist, event fan-out, capture publisher, input injection |
| **Gateway (existing)** | Source of truth for tasks, schedule, memory, inbox, policy, auth to SuperGrok |
| **HostBridge (existing)** | Desktop/browser execution; telepresence input maps into desktop path |
| **Shared package** | Zod IPC schemas, remote protocol envelopes, capability flags |
| **Blind cloud** | Pairing rendezvous, authenticated routing, WebRTC signaling transport, optional TURN |

### 5.3 Why this shape

- Matches local-first gateway already shipping in Desk  
- Reuses typed `IpcRequest` instead of inventing a second product API  
- WebRTC is the right primitive for screen + low-latency input  
- Cloud stays small and non-authoritative for user content  

### 5.4 Repository / delivery layout (target)

```
grok-desktop/                 # existing monorepo
  packages/gateway/           # + remote session service
  packages/shared/            # + remote protocol types
  apps/desktop/               # + QR UI, device list, capture bridge
  apps/mobile/                # NEW Expo app (or sibling repo if packaging requires)
  services/remote-relay/      # NEW small cloud service
```

Monorepo preferred for shared types; mobile may split packaging later without splitting the protocol.

## 6. Pairing and cryptography

### 6.1 Trust model

- One SuperGrok/Desk owner; many personal devices optional  
- Each device holds a long-term keypair; private key never leaves OS Keychain / Keystore  
- Desk holds machine key material in OS credential store alongside existing secrets  
- Cloud stores **public keys and opaque identifiers only** — never private keys, never plaintext goals/messages/frames  

### 6.2 QR ceremony

QR payload (short-lived, single-use or short TTL) includes:

- Pairing secret (high entropy)  
- Machine public identity  
- Relay base URL / environment  
- Protocol version  

Flow:

1. Desk enables remote access and displays QR; rotates secret on refresh/timeout.  
2. Phone scans, generates device keypair if new.  
3. Phone completes mutual authentication using the pairing secret such that **only the desk** can finalize trust (ECDH + authenticated confirmation).  
4. Both derive a device↔machine long-term trust root.  
5. Cloud records: `deviceId`, `machineId`, public keys, paired-at, revoked flag — no content keys that decrypt product traffic without device or desk.  

### 6.3 Channels after pairing

| Channel | Payload | Encryption |
|---------|---------|------------|
| **Control** | IPC requests/responses, task event streams, inbox, settings subset | E2E session keys (Noise-style or equivalent AEAD over X25519); relay sees ciphertext frames only |
| **Telepresence** | Video (and optional audio later), input events | WebRTC DTLS-SRTP peer-to-peer when possible; TURN when required (still media-encrypted) |
| **Signaling** | SDP/ICE | Prefer sealed signaling blobs so relay operators do not need readable SDP |

### 6.4 Pairing-token-only implications

Chosen auth: no Face ID / no SuperGrok on phone.

Required mitigations on desk:

- Device list with last-seen and revoke  
- Visible “remote session active” banner  
- Ability to disable remote access entirely  
- Optional session TTL / idle disconnect (recommended default: enabled)  
- Pause-all remains available locally and remotely  

Stolen unlocked phone ≈ full machine control until revoke. Document clearly in UI.

### 6.5 What the host operator can and cannot see

**Cannot (by design):** task text, chat, memory bodies, screen pixels, keystrokes, file contents, private keys.

**May (metadata):** that device D is online to machine M, approximate connect times, byte volume, edge IP addresses for abuse control. Minimize logging; short retention; no payload logs.

## 7. Control protocol

### 7.1 Principle

The mobile control channel carries the **same conceptual API** as desktop IPC (`packages/shared` `IpcRequest`), wrapped in remote envelopes (request id, auth, compression optional).

### 7.2 Capability handshake

On connect, desk sends:

- Protocol version  
- Enabled method list / feature flags  
- Machine display name  
- Telepresence availability (permissions, display list summary)  

Mobile hides or degrades UI for missing capabilities.

### 7.3 Method surface (target whole app)

Include (as already implemented on gateway, plus remote-specific):

- Tasks: create, list, get, cancel, delete, setTitle, approve, pauseAll, resumeAll  
- Events: list / subscribe stream  
- Inbox, schedule, memory, settings subsets as existing methods allow  
- Desktop task grant/status methods where relevant  
- Remote-specific: `remote.session.ping`, `remote.devices.self`, `remote.telepresence.*` capability/status  

Exact method names for remote-only ops live in `@grokdesk/shared` with Zod schemas.

### 7.4 Event delivery

- Subscribe to task events and inbox-style push over the control channel  
- At-least-once delivery with client-side dedupe by event id  
- Reconnect: resume from last event cursor where gateway supports it  

### 7.5 Allowlist and abuse

Desk enforces:

- Only paired, non-revoked devices  
- Rate limits on control messages  
- Optional stricter allowlist for destructive methods (deletions, settings writes) if needed later — default is full owner power matching phone-as-owner  

## 8. Telepresence

### 8.1 Capture

- Desk captures selected display using platform-appropriate APIs (building on computer-use / desktop control work)  
- Encode efficiently for mobile (H.264/VP8 via WebRTC stack)  
- Permission failures surface as clear mobile + desktop errors  

### 8.2 Input

Phone gestures map to desktop input injection via HostBridge desktop path:

| Gesture / control | Desktop effect |
|-------------------|----------------|
| Tap | Click |
| Long-press | Right-click (configurable) |
| Drag | Mouse drag |
| Two-finger scroll | Scroll |
| Pinch (optional) | Magnify UX only or desktop zoom if supported |
| Software keyboard | Key events |
| Hardware keyboard (iPad/keyboard cases) | Key events when available |

Coordinate mapping must account for stream letterboxing and display scale (reuse desk coordinate helpers where possible).

### 8.3 Quality

Presets trade resolution/fps/bitrate. Auto uses network estimates. Prefer responsiveness for control over 4K fidelity.

### 8.4 Safety UX

- Desk always shows when remote control is active  
- Mobile disconnect ends input immediately  
- Desk revoke / disable remote ends all channels  
- Local user can pause remote input without unpairing  

## 9. Blind cloud service

### 9.1 Responsibilities

| Feature | Behavior |
|---------|----------|
| Pairing rendezvous | Exchange sealed pairing messages; store public pairing records |
| Presence / routing | Help phone find an online desk endpoint for the control channel |
| WebSocket/TCP pipe | Forward opaque encrypted frames |
| WebRTC signaling | Forward sealed signaling messages |
| TURN | Provide relay candidates when P2P fails |

### 9.2 Non-responsibilities

- Task storage  
- SuperGrok OAuth  
- Content moderation of goals  
- Decrypting or inspecting product payloads  

### 9.3 Deployment

- Small TypeScript service suitable for Cloudflare Workers, Fly.io, or a single region Node host  
- Managed TURN preferred over self-built media infra  
- Environments: dev / staging / prod with separate relay URLs embedded in desk config  

### 9.4 Auth to the cloud (routing only)

Cloud authenticates **routing claims** (device/machine tokens derived such that the cloud can verify “this is device D for machine M” without holding content keys). Implementation options (pick in plan):

- Short-lived relay JWTs minted by desk after pairing, presented by phone; or  
- Mutual proof using public keys registered at pair time  

Either way, successful cloud auth does **not** grant the cloud plaintext access.

## 10. Failure modes and offline

| Situation | UX / behavior |
|-----------|----------------|
| Desk offline | Home shows offline; no telepresence; messaging may queue later (P2+) or fail clearly in P0 |
| Relay unreachable | Explicit error; retry; no infinite spinner |
| Pairing QR expired | Prompt to refresh QR on desk and rescan |
| Device revoked | Hard disconnect; return to pair screen |
| Network flaky | Control reconnect with exponential backoff; stream may degrade or pause |
| Permission missing on desk | Telepresence tab explains grant steps on the Mac/PC |
| Concurrent local + remote input | Allowed; last interaction wins; both UIs show multi-controller risk banner when both active |

## 11. Security and privacy checklist

- [ ] E2E control channel; no product plaintext on relay  
- [ ] WebRTC media encrypted (DTLS-SRTP)  
- [ ] Device private keys in OS secure storage  
- [ ] Short-lived QR secrets  
- [ ] Desk-side revoke is authoritative  
- [ ] Remote session visibility on desk  
- [ ] Minimal metadata logging  
- [ ] Transport TLS to relay in addition to E2E  
- [ ] Clear user-facing warning: unpaired phone = full access until revoke  
- [ ] Dependency and supply-chain review before store submission  

## 12. Ship phasing

One app binary; features unlock as backend and UI land.

| Phase | Deliverable | User value |
|-------|-------------|------------|
| **P0** | QR pair, E2E control channel, Home, Tasks, Approvals, Inbox, Pause all, desk device list + revoke | Run coworker from phone anywhere |
| **P1** | Telepresence (screen + input), desk session banner, quality presets | Control the machine |
| **P2** | Schedule + Memory surfaces, reconnect resume polish, optional message queue when offline | Fuller desk parity |
| **P3** | Settings depth, multi-display, attachments/voice parity, PiP, notification actions | Polish and power-user |
| **P4** | Trust & hardening: revoke→re-pair, biometric lock, keep-awake, error classification, device list diagnostics | Production readiness |

P0 is valuable alone; P1 is required for the telepresence promise in this spec.

## 13. Tech stack

| Layer | Choice |
|-------|--------|
| Mobile | Expo (React Native), TypeScript |
| Shared contracts | `@grokdesk/shared` Zod schemas |
| Desk | Existing Electron + gateway monorepo |
| Crypto | libsodium / WebCrypto (X25519 + AEAD); Noise-like session framing |
| Media | WebRTC |
| Cloud | Small TS service + managed TURN |
| Tests | Vitest for protocol/crypto pure logic; Detox/Maestro or Expo E2E later; gateway integration tests for remote module |

## 14. Testing strategy

| Layer | What |
|-------|------|
| Unit | Envelope encode/decode, coordinate mapping, method allowlist, QR payload parse |
| Integration | Fake relay + paired fake device drives real gateway handlers |
| Crypto | Vectors for pair → session → message round-trip; revoke invalidates |
| Manual | Real NAT/TURN paths; iOS + Android store permission flows |
| Security | Threat model review: stolen phone, malicious relay, QR shoulder-surf, replay |

## 15. Open implementation choices (plan-time, not product-open)

These do not change product intent; resolve during implementation planning:

1. Exact Noise vs custom X25519+AEAD session framing library  
2. Relay hosting vendor (Workers vs Fly vs other)  
3. Whether `apps/mobile` lives in-monorepo or adjacent repo for store CI  
4. Capture backend: extend existing desktop capture vs OS screencapture APIs  
5. Push notifications: native APNs/FCM via encrypted wake only (payload empty or sealed)  

## 16. Success criteria

- User pairs with QR in under one minute  
- From a non-LAN network, user can create a task, watch stream, approve a tool, and pause all  
- User can view the desk screen and click/type to operate the host  
- Relay operator with DB + logs access cannot read task text or screen content  
- Revoking a device on desk disconnects it within seconds  
- iOS and Android both support the P0+P1 path  

## 17. Out of scope reminders

- Redesigning SuperGrok auth on desk  
- Replacing the local gateway with a cloud control plane  
- Team multi-seat remote administration  

---

## Appendix A — Decision log

| Date | Decision | Notes |
|------|----------|-------|
| 2026-07-12 | Connectivity = anywhere | Implies blind cloud relay |
| 2026-07-12 | Architecture = Remote Access Plane | Not WebView-shell-first, not pure mesh overlay product |
| 2026-07-12 | Phased UI + full telepresence early | P0 coworker, P1 machine control |
| 2026-07-12 | Personal devices only | No guests |
| 2026-07-12 | Pairing token only | No Face ID / SuperGrok on phone v1 |
| 2026-07-12 | Cloud must not read content | E2E + sealed signaling |

## Appendix B — Relationship to original Desk non-goals

The 2026-07-10 Desk spec listed “cloud-hosted agent control plane” and multi-channel messaging as non-goals. This design **does not** host the agent in the cloud. It adds a **transport and pairing plane** only, preserving local gateway authority.
