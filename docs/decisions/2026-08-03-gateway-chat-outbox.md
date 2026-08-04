# Decision: Gateway-owned durable chat outbox

**Date:** 2026-08-03  
**Status:** Accepted

## Context

Renderer-local `localStorage` queues lost durability guarantees: follow-ups
only drained while a chat was selected, capacity could silently drop oldest
pending rows in some paths, and Send now could fall back to concurrent
`tasks.create`. The product needs exactly-once, background-deliverable
follow-ups that survive chat switches and restarts.

## Decision

1. **Gateway SQLite outbox** (`conversation_outbox`, schema v12) is the only
   durable follow-up path. `id` equals `clientMutationId`.
2. **Drain** runs globally via `OutboxDrainCoordinator`, FIFO per conversation,
   through the existing crash-atomic `tasks.create` acceptance path — no second
   acceptance kernel.
3. **Capacity** returns structured `full` / `persistence_failed`. Never delete
   older rows to make room.
4. **Send now** attempts ACP interjection only. If unsupported, terminal,
   timeout, or fail, the item stays queued — never concurrent `tasks.create`.
5. **One active run per conversation** via concurrency thread keys; different
   conversations still share the global concurrency cap.
6. **Outbox IPC is local-only** (not on the remote allowlist).
7. **localStorage migration** replays existing `clientMutationId`s into the
   outbox; incomplete migration keeps the local snapshot and a recovery notice.

## Credential storage

Unchanged. Production remains `createSafeStorageCredentialVault` only.
See `docs/decisions/2026-07-24-no-keychain.md`. Do not introduce OS Keychain,
keytar, Electron `safeStorage`, or bootstrap memory vaults.

## Consequences

- Renderer projects gateway outbox/task state; composer clears only after
  durable enqueue acceptance.
- Terminal outbox receipts retain ~7 days for reconciliation; pending / failed /
  blocked rows are never auto-pruned.
- Remote clients cannot mutate the outbox until an explicit remote design lands.
