# Remote access — local development

## Production relay (default)

Production lives in the **grok-landing** compose stack (same deploy as the marketing site).  
Desk/mobile **default** Settings URL is production:

| | |
|--|--|
| Settings URL (default) | `wss://grokdesk.app/relay` |
| Health | `https://grokdesk.app/relay/health` |
| WebSocket | `wss://grokdesk.app/relay/v1` |

Source of truth for the hosted image: `grok-landing/services/remote-relay`.  
This package (`services/remote-relay`) remains for local dev and e2e tests — set Settings → Remote to `ws://127.0.0.1:8787` (or another local port) when testing against a local relay.

## 1. Start the blind relay (local override)

```bash
pnpm install
pnpm --filter @grokdesk/remote-relay dev
# or: pnpm relay:dev
```

Default:

- Health: `http://127.0.0.1:8787/health` → JSON like `{ ok: true, peers, channels, machines }`
- WebSocket: `ws://127.0.0.1:8787/v1`

Env: `PORT`, `HOST` (default `0.0.0.0` so phones on the LAN can connect; use `HOST=127.0.0.1` only for desk-only tests).

If **8787 is already taken** by another local service (common), start on another port:

```bash
PORT=8788 HOST=0.0.0.0 pnpm relay:dev
```

Then set the desk Settings → Remote URL to `ws://127.0.0.1:8788` (desk can use loopback). The desk auto-probes health and will switch to a working port when the default is not a Grok Desk relay.

**Phone pairing:** the desk rewrites loopback to your LAN IPv4 when encoding the QR, so the phone gets `ws://<mac-lan-ip>:8788`. The relay must listen on `0.0.0.0` (not only `127.0.0.1`) or the phone cannot connect. Mac firewall may prompt once for Node.

## 2. Desktop

```bash
pnpm dev
```

Settings → Remote → Enable → Show pairing QR.  
While enabled, status shows **relay connected/connecting**. When a phone starts **Desk** telepresence, a **Remote control live** banner appears.

Desktop computer-use permissions (Screen Recording / Accessibility on macOS) must be granted for telepresence capture and input.

## 3. Mobile

Requires **Expo SDK 54** (matches App Store Expo Go on iOS as of mid‑2026). From the monorepo root:

```bash
pnpm --filter @grokdesk/shared build   # once after pull / shared changes
pnpm mobile:start
# or: pnpm --filter @grokdesk/mobile start
# clear Metro cache if you just switched SDKs:
# pnpm --filter @grokdesk/mobile exec expo start -c
```

On your phone: **Expo Go** from the App Store (must report **SDK 54**), same Wi‑Fi as the Mac, then scan the Expo QR.

> iOS App Store only ships one Expo Go. If Apple updates it to a newer SDK later, pin this app to that SDK — not “latest” on npm.

**Languages** (same set as desktop): English, Español, Français, Deutsch, Português, 日本語, 简体中文. Defaults to system locale; change under **Settings → Language**.

**UI:** dark mineral shell, amber accent, bottom tabs (Home / Tasks / Desk / Inbox / Settings), connection pill, springy buttons, polished PiP chip. Schedule & Memory live under Settings’s chip row.

1. **Pair** — scan the desk QR with the camera (native) or paste `grokdesk://pair/…`  
2. App **auto-reconnects** on launch if a session is stored (chrome: Online / Reconnecting / Offline)  
3. **Home** — tasks / pause; optional voice transcript + attachment notes fold into the goal  
4. **Schedule** — list rules, create (desk temp workspace via `workspace.ensureTemp`), enable/disable  
5. **Memory** — list/filter by kind, create/edit/delete  
6. **Desk** — Connect stream, multi-display picker (`remote.telepresence.listDisplays`), quality, gestures, type  
7. **Settings** — default quality, PiP, keep-awake, inbox/approval alerts, biometric lock, diagnostics, desk device list, unpair  
8. **PiP** — floating live preview when leaving Desk while stream is active (toggle in Settings)  

Offline-safe mutations (`memory.upsert` / `memory.delete` / `schedule.setEnabled`) are durable-queued and flush FIFO on reconnect. Telepresence and pair are never pretend-success offline.

**P4 trust:** desk revoke (or invalid token) classifies as fatal → wipe local session **and** offline queue, return to Pair. Optional biometric lock holds the session until unlock (tabs/RPC only after unlock). Keep-awake uses `expo-keep-awake` while Desk stream is live when enabled. `settings.get` is **not** allowlisted (license/MCP secrets). Remote control RPCs are Zod-validated like desktop dispatch.

Desk tray: **Remote access…** opens Settings → Remote; tooltip shows remote status. 

## 4. Automated tests

```bash
# Full remote suite (shared crypto/allowlist/queue/errors + gateway e2e P0–P2 + relay + mobile)
pnpm test:remote

# Focused slices:
pnpm --filter @grokdesk/shared test -- src/telepresence src/remote
pnpm --filter @grokdesk/gateway test -- src/services/telepresence src/telepresence-e2e src/remote-p2-e2e
pnpm --filter @grokdesk/mobile test
```

## Security note

The relay routes **opaque** blobs only (control + telepresence frames are E2E sealed). Do not log `blob` contents in production.
