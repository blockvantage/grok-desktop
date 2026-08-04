# Runbook: Email outage (fulfillment and magic links)

## Purpose

Recover delivery of product-key / download fulfillment mail and portal magic
links when the email outbox worker or provider (e.g. Resend) is degraded.

Related alert: `EntitlementEmailBacklogHigh`
(`entitlement_api_email_outbox_pending`).

## Symptoms

- `entitlement_api_email_outbox_pending` growing.
- `entitlement_api_email_outbox_events_total{outcome="retry"}` elevated.
- Customers report missing magic links or purchase emails.
- Provider dashboard shows rate limits, auth failures, or regional outage.

## Safe handling

- Never log raw magic tokens, session tokens, product keys, or full email
  bodies with secrets.
- Support replies use **generic** copy: “Request a new magic link from the
  portal” — do not paste links from operator tools into public tickets if the
  tool shows the raw token (prefer customer self-serve resend).

## Immediate actions

1. Confirm API and DB are healthy ([entitlement-outage.md](./entitlement-outage.md)).
   Outbox rows only drain if the worker can write provider API successes.
2. Check worker process (`entitlement-api` worker entrypoint) is running.
3. Check provider status and API key validity (secret store).
4. Inspect outbox metrics only — outcomes and template names, not recipients:

   - `email_outbox_events_total{outcome="sent|retry|dead", template="..."}`
   - `email_outbox_pending`

## Outbox model (conceptual)

```
pending → sending → sent
                 ↘ retry (backoff) → dead (manual)
```

Templates are bounded labels (e.g. `magic_link`, `fulfillment`) — never
customer identifiers as metric labels.

## Mitigation

| Cause | Action |
| --- | --- |
| Provider outage | Wait / failover domain if configured; keep accepting outbox writes |
| Invalid API key | Rotate provider key in secret store; restart worker |
| Rate limit | Reduce worker concurrency; extend backoff; request limit increase |
| Bad template / content rejection | Fix template; requeue dead letters carefully |
| Worker crash loop | Fix deploy; ensure DB connectivity |

### Requeue (operator)

Prefer audited operator commands if available. Manual SQL is break-glass only:

- Reset `dead` → `pending` for a **bounded** set of ids after root cause is fixed.
- Never SELECT token plaintext into logs or chat.

## Customer workaround

1. Portal: request a new magic link (rate limited).
2. If purchase email missing but payment succeeded: wait for webhook + outbox
   drain, or support verifies order by Stripe id only (no key in chat).
3. Stripe path recovery: [stripe-replay.md](./stripe-replay.md) if events were
   never processed.

## Recovery verification

1. Pending gauge returns below alert threshold and trends down.
2. Canary magic-link to an internal allowlisted address delivers.
3. No growth in `outcome="dead"` after fix.
4. Close alert; note provider incident id if any.

## PATH notes

Server outbox lives in PostgreSQL (hashed / tokenized columns per schema).
Desktop does not store magic-link secrets on disk; portal session cookies are
browser-only.
