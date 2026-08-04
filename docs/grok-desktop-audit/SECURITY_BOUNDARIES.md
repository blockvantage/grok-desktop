# Security boundaries (living document)

Last updated: 2026-07-23

## Trust model (summary)

```text
Untrusted: renderer DOM, loaded pages, MCP tool outputs, remote relay messages,
           model text, user-pasted paths, update download bodies before verify

Semi-trusted: preload (minimal bridge), local gateway after IPC schema parse

Trusted: Electron main process, signed lease/JWKS verify path, release-manifest
         verify path (when keys baked), OS credential material on disk under
         userData (vault) — still protect from renderer
```

## Renderer

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` (main window + browser partitions).
- No raw Node; only `window.grokdesk` from preload.
- Must not receive product keys, lease JWTs, device private keys, Bearer tokens.

## Preload

- Imports sandbox-safe IPC channel leaf (`@grokdesk/shared` channel constants path).
- Exposes invoke/event APIs only; no secret material.

## Main process

- Privileged IPC: `validatePrivilegedIpcSender` (window ownership + origin).
- Entitlement/update registration **requires** assertSender (fail-closed) — F-2026-07-23-002.
- Reveal confined to allowed roots (`reveal.ts` + task workspace roots).
- External open: http(s) only (`security-url.ts`).
- Same-window navigation locked down.

## Gateway child

- Spawned Node/Electron-as-Node with env from `gatewayEnv`.
- Packaged: strips ambient ACP/dev binary overrides unless bake unlock (review only).
- Entitlement fail-closed default `1`; runtime readiness fail-closed `1`.
- Workspace path confine for file reads/artifacts.

## Entitlement unlock (critical)

| Mode | How enabled | Packaged? | Production allowed? |
| --- | --- | --- | --- |
| Runtime dev unlock | `GROKDESK_DEV_UNLOCK=1` + `!isPackaged` | No | Dev only (`make local`) |
| Compile bake unlock | `GROKDESK_BAKE_DEV_UNLOCK=1` at electron-vite build | Yes (review) | **No** — internal/review only |
| Production | neither | Yes | Required |

See F-2026-07-23-001.

## Browser host

- Separate webPreferences sandbox; MCP plane for automation.
- Policy store + approvals for sensitive ops (further review pending).

## Desktop control

- OS permissions (screen recording, accessibility/input).
- Global pause + per-task grants; HUD visibility required.

## Remote / mobile

- Pairing secrets and encrypted session (protocol under `docs/remote/`).
- Relay is untrusted for confidentiality/integrity without client crypto.

## Updates / runtime

- Manifest signature verify with baked release public keys.
- Dev fixture URLs only when `!isPackaged && allowDevFixtureUrls`.
- Managed Grok binary path confined under runtime root.

## Open boundary questions

- ~~`file:` sender URL accepted broadly~~ — **fixed** F-008 (same path/dir as main window).
- ~~Empty sender URL~~ — **fixed** F-003 (non-main requires URL).
- Headless engine tool mediation vs ACP fail-closed matrix residual (docs/evidence SESSION_STATUS).
- Reveal roots include OS Downloads — intentional convenience; any path under Downloads can be revealed if known (document to users).
- Browser/desktop loopback hosts: 127.0.0.1 + random token in process env (local attacker with env access can call). Acceptable for single-user desktop; not multi-tenant.
