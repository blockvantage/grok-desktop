# Runbook: Stripe webhook replay and backfill

## Purpose

Recover missed or stuck Stripe events so paid checkouts still create
entitlements, fulfill email, and stay consistent with the commerce ledger.

Related alert: `EntitlementWebhookAgeHigh`
(`entitlement_api_webhook_oldest_age_seconds`).

## Principles

- **Idempotent processing** — replaying an event must not double-issue seats or
  product keys.
- **Ordered by business effect** — prefer Stripe’s event id dedupe table over
  ad-hoc order reconstruction.
- **No secrets in evidence** — record event ids, types, and counts only. Never
  paste signing secrets, raw bodies with PII, or product keys.

## Symptoms

- Webhook age gauge rising while API is up.
- Customers paid; no entitlement / email.
- `webhook_events_total{outcome="failed"}` increasing.
- Stripe Dashboard shows delivery failures (4xx/5xx) to the entitlement endpoint.

## Immediate actions

1. Confirm entitlement-api `/readyz` is healthy. If not, fix
   [entitlement-outage.md](./entitlement-outage.md) first — replay will not help.
2. Confirm internal HMAC / Stripe signature verification configuration:
   - Endpoint URL matches the currently deployed public/internal route.
   - Webhook signing secret in the secret store matches the Stripe endpoint.
3. Inspect Stripe Dashboard → Developers → Webhooks → recent deliveries.
4. Check metric `entitlement_api_webhook_oldest_age_seconds` and
   `entitlement_api_webhook_events_total`.

## Replay options (prefer in order)

### 1. Stripe Dashboard resend

For a small set of failed deliveries, use **Resend** on the event in Stripe
Dashboard. The API must return 2xx only after durable idempotent commit.

### 2. Stripe CLI (staging / lab)

```bash
# Example — point at staging, never paste secrets into shell history tools.
stripe events resend evt_...
# or
stripe trigger checkout.session.completed
```

### 3. Operator / internal backfill

If an operator command exists for commerce backfill, use it with:

- Stripe event id or checkout session id
- Operator identity + reason (audit required)
- Dry-run first when available

### 4. Bounded time-range backfill

1. List events from Stripe API for the outage window (`created` filter).
2. Submit each event through the **same** processing path as live webhooks.
3. Skip ids already marked processed in the events ledger.
4. Record: window start/end, attempted count, succeeded, already-present,
   failed ids (event id only).

## Verification

For each recovered purchase (support case or canary):

1. Entitlement row exists and is active (status only — no key in ticket).
2. Email outbox eventually `sent` or customer can use portal recovery
   ([email-outage.md](./email-outage.md)).
3. Webhook age gauge < 60s steady state.
4. No duplicate seat grants (activation seat counts still enforce limit).

## Failure modes

| Issue | Action |
| --- | --- |
| Signature verification failures | Rotate/fix webhook secret; do not disable verify |
| Duplicate fulfillment attempts | Confirm ledger unique constraints; investigate only if seats > limit |
| Refunds/chargebacks during backfill | Process lifecycle events in timestamp order |
| Partial outage (only some event types) | Filter backfill to `checkout.session.completed`, `charge.refunded`, etc. |

## Evidence template (safe)

```
Date (UTC):
Operator:
Outage window:
Backup/API version:
Events attempted:
Succeeded / already-present / failed:
Webhook age before → after:
Runbook: docs/runbooks/stripe-replay.md
```

## PATH notes

Stripe secrets: platform secret store only.
Landing may proxy webhooks; entitlement-api owns durable commerce transitions.
Desktop clients never see Stripe webhook payloads.
