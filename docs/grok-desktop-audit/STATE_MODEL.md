# State models (skeleton — expand per domain)

Last updated: 2026-07-23

## Entitlement (admission)

```text
uninitialized → loading → inactive | active | expired | device_deactivated | error
                 └─ dev_unlock synthetic active (manager.devUnlock only)
```

- Durable: vault product-key + state store lease (not renderer).
- Gateway: fail-closed deny when JWKS/state incomplete unless unlock.
- Recovery: refresh, re-activate, deactivate clears local key+lease.

## Task / run attempt

```text
queued → running → waiting_approval | waiting_user | blocked → running
                 ↘ done | failed | cancelled
```

- Durable: gateway SQLite.
- Renderer projection via gateway notify + list/get.
- Terminal success must not be inferred from process exit alone (engine event contract).

## Application update

Phases per update coordinator (idle → checking → available → downloading → ready → installing → …).  
Security: never apply without signature verify.

## Remote session

Pairing → connected → active control → revoked/expired.  
Idempotency: remote task submission keys (see remote-idempotency tests).

## Desktop control

Machine settings + global pause + per-task grant TTL.  
Must clear/pause when task ends (verify ongoing).

## Browser capability

Capability probe → session → tools; external allow separate.

---

*Fill transitions/triggers/tests as each domain is deep-audited.*
