# Commerce, Fulfillment, Recovery, and Customer Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Stripe purchase to durable entitlement fulfillment, secure key recovery, protected architecture downloads, and a passwordless self-service portal in `grok-landing`.

**Architecture:** Next.js remains the public customer-facing adapter and never holds signing keys. It verifies Stripe, calls the entitlement API through service-authenticated server-only code, exchanges checkout and magic-link tokens for secure sessions, and renders localized pages. Email delivery is driven by the entitlement service outbox so Stripe acknowledgement is independent of Resend.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, Zod 4, Stripe 22, Resend 6, Vitest, server-only fetch client, HttpOnly cookies.

**Design:** `../grok-desktop/docs/superpowers/specs/2026-07-16-commerce-entitlements-runtime-updates-design.md`

---

## Required reading and ownership

Before changing Next.js code, read:

- `AGENTS.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md`
- `node_modules/next/dist/docs/01-app/02-guides/redirecting.md`

This lane owns `src/app/**`, `src/components/**`, `src/lib/**`, `src/i18n/**`, and root `tests/**` in `grok-landing`. The entitlement-service lane owns `services/entitlement-api/**` and entitlement migrations. Coordinate the one `docker-compose.yml` edit through the program integration lane.

## File responsibility map

- `src/lib/entitlement-client.ts`: server-only typed HTTP client, service authentication, timeouts, response validation, and safe error mapping.
- `src/lib/portal-session.ts`: encrypted/opaque cookie names, CSRF double-submit helpers, and redirects.
- `src/lib/fulfillment.ts`: pure webhook-to-command mapping; no email sending or Stripe metadata persistence.
- `src/app/api/webhooks/stripe/route.ts`: Stripe signature verification and idempotent event forwarding.
- `src/app/api/checkout/route.ts`: one-time payment session with fulfillment schema metadata.
- `src/app/api/checkout/exchange/route.ts`: verified paid-session exchange for short-lived fulfillment cookie.
- `src/app/[lang]/success/page.tsx`: authenticated fulfillment view.
- `src/components/fulfillment-card.tsx`: explicit key reveal/copy and architecture selector.
- `src/app/[lang]/account/page.tsx`: generic magic-link request page or authenticated portal dashboard.
- `src/app/api/account/magic-link/route.ts`: generic request response.
- `src/app/api/account/exchange/route.ts`: single-use token exchange and secure cookie creation.
- `src/app/api/account/actions/[action]/route.ts`: CSRF-protected portal mutations.
- `src/app/api/downloads/[artifactId]/route.ts`: grant request and redirect without leaking bearer material.
- `src/lib/resend.ts`: outbox-worker email rendering/sending adapter; no product key in provider metadata.
- `src/i18n/dictionaries/*.ts` and `src/lib/copy.ts`: seven-locale commerce, portal, privacy, and support copy.

### Task 1: Add the server-only entitlement client

**Files:**
- Create: `src/lib/entitlement-contract.ts`
- Create: `src/lib/entitlement-client.ts`
- Create: `tests/entitlement-client.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing tests for authentication, timeout, and redaction**

  ```ts
  it("authenticates internal commands without logging secrets", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ accepted: true }));
    const client = createEntitlementClient({
      baseUrl: "http://entitlement-api:8080",
      serviceToken: "service-secret",
      fetch,
    });
    await client.acceptStripeEvent(stripeEventCommand);
    expect(fetch).toHaveBeenCalledWith(
      "http://entitlement-api:8080/internal/v1/stripe/events",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer service-secret" }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.stringify(await client.diagnostics())).not.toContain("service-secret");
  });
  ```

- [ ] **Step 2: Verify the tests fail**

  Run: `pnpm test -- tests/entitlement-client.test.ts`

  Expected: FAIL because `createEntitlementClient` does not exist.

- [ ] **Step 3: Implement the narrow client**

  ```ts
  import "server-only";
  import { z } from "zod";

  const serviceError = z.object({ code: z.string(), requestId: z.string().optional() });

  export function createEntitlementClient(input: {
    baseUrl: string;
    serviceToken: string;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
  }) {
    const request = async <T>(path: string, init: RequestInit, schema: z.ZodType<T>) => {
      const response = await (input.fetch ?? fetch)(`${input.baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(input.timeoutMs ?? 8_000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.serviceToken}`,
          "x-request-id": crypto.randomUUID(),
          ...init.headers,
        },
      });
      const body: unknown = await response.json();
      if (!response.ok) throw serviceError.parse(body);
      return schema.parse(body);
    };
    return {
      acceptStripeEvent: (command: unknown) => request(
        "/internal/v1/stripe/events",
        { method: "POST", body: JSON.stringify(command) },
        z.object({ accepted: z.boolean() }),
      ),
      diagnostics: async () => ({ baseUrl: input.baseUrl, timeoutMs: input.timeoutMs ?? 8_000 }),
    };
  }
  ```

  Extend this same closure with methods matching the generated contract: `exchangeCheckout`, `requestMagicLink`, `exchangeMagicLink`, `getPortal`, `mutatePortal`, and `requestDownloadGrant`. Each method must parse its response through the generated Zod schema and accept only the minimum bearer/session data required. Email delivery flows in the opposite direction: the entitlement worker calls the authenticated landing email route.

- [ ] **Step 4: Add required environment names**

  Add `ENTITLEMENT_API_URL`, `ENTITLEMENT_WEB_SERVICE_TOKEN`, `ENTITLEMENT_OUTBOX_SERVICE_TOKEN`, and `PORTAL_COOKIE_SECURE=true`. Do not add any product-key or signing private key environment variable to the web app.

- [ ] **Step 5: Run and commit**

  Run: `pnpm test -- tests/entitlement-client.test.ts && pnpm lint`

  Expected: PASS and no secret appears in snapshots.

  ```bash
  git add .env.example src/lib/entitlement-contract.ts src/lib/entitlement-client.ts tests/entitlement-client.test.ts
  git commit -m "feat: add entitlement service client"
  ```

### Task 2: Make Stripe fulfillment durable and idempotent

**Files:**
- Modify: `src/app/api/checkout/route.ts`
- Modify: `src/app/api/webhooks/stripe/route.ts`
- Modify: `src/lib/fulfillment.ts`
- Delete: `src/lib/fulfillment-store.ts`
- Modify: `tests/fulfillment.test.ts`
- Create: `tests/stripe-webhook.test.ts`

- [ ] **Step 1: Write failing mapping and webhook tests**

  ```ts
  expect(toStripeEventCommand(event)).toEqual({
    eventId: "evt_paid",
    eventType: "checkout.session.completed",
    checkoutSessionId: "cs_paid",
    paymentIntentId: "pi_paid",
    stripeCustomerId: "cus_paid",
    normalizedEmail: "buyer@example.com",
    displayEmail: "Buyer@Example.com",
    amountTotal: 4900,
    currency: "usd",
    locale: "en",
    productId: "grok-desk",
    fulfillmentSchemaVersion: 1,
    paymentStatus: "paid",
    occurredAt: expect.any(String),
  });
  expect(await postWebhook(sameEventTwice)).toMatchObject({ status: 200 });
  expect(acceptStripeEvent).toHaveBeenCalledTimes(2);
  ```

  The entitlement API, not the web route, deduplicates repeated delivery by Stripe event ID. Also test `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, and out-of-order events.

- [ ] **Step 2: Verify failure**

  Run: `pnpm test -- tests/fulfillment.test.ts tests/stripe-webhook.test.ts`

  Expected: FAIL because fulfillment still sends email and marks Stripe metadata.

- [ ] **Step 3: Replace fulfillment side effects with a pure command**

  ```ts
  export type StripeEventCommand = {
    eventId: string;
    eventType: string;
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
    stripeCustomerId: string | null;
    normalizedEmail: string | null;
    displayEmail: string | null;
    amountTotal: number | null;
    currency: string | null;
    locale: Locale;
    productId: "grok-desk";
    fulfillmentSchemaVersion: 1;
    paymentStatus: string | null;
    occurredAt: string;
  };
  ```

  `POST /api/webhooks/stripe` must construct the Stripe event from the raw body, map supported events, call `acceptStripeEvent`, return 200 only after durable acceptance, and return 503 for retryable entitlement-service failure. It must never call Resend and must never print the event body.

- [ ] **Step 4: Stamp checkout policy metadata**

  Set Checkout metadata exactly to:

  ```ts
  metadata: {
    product: "grok-desk",
    locale,
    fulfillment_schema_version: "1",
    seat_limit: "3",
    update_policy: "lifetime_stable",
  }
  ```

  Preserve `mode: "payment"`, add `customer_creation: "always"`, and remove the obsolete `platforms` claim.

- [ ] **Step 5: Remove Stripe fulfillment metadata storage and verify**

  Run: `pnpm test -- tests/fulfillment.test.ts tests/stripe-webhook.test.ts && pnpm build`

  Expected: PASS; `rg 'fulfilled|markFulfilled|hasFulfilled' src tests` returns no persistence implementation.

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/api/checkout/route.ts src/app/api/webhooks/stripe/route.ts src/lib/fulfillment.ts tests/fulfillment.test.ts tests/stripe-webhook.test.ts
  git rm src/lib/fulfillment-store.ts
  git commit -m "feat: forward durable Stripe fulfillment"
  ```

### Task 3: Exchange paid checkout for a safe fulfillment session

**Files:**
- Create: `src/app/api/checkout/exchange/route.ts`
- Create: `src/lib/portal-session.ts`
- Modify: `src/app/[lang]/success/page.tsx`
- Create: `src/components/fulfillment-card.tsx`
- Create: `tests/checkout-exchange.test.ts`
- Create: `tests/success-page.test.tsx`

- [ ] **Step 1: Write failing tests**

  Test an unpaid session, a session for another product, a reused exchange, a locale mismatch, and a paid session. The successful response must set an opaque cookie and redirect to a URL without `session_id`.

  ```ts
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://grokdesk.app/en/success");
  expect(response.headers.get("set-cookie")).toContain("gd_fulfillment=");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
  ```

- [ ] **Step 2: Verify failure**

  Run: `pnpm test -- tests/checkout-exchange.test.ts tests/success-page.test.tsx`

  Expected: FAIL because the exchange route and authenticated card do not exist.

- [ ] **Step 3: Implement the exchange route**

  Validate `session_id` with Zod, retrieve it from Stripe with expanded payment intent, confirm `paid` and `product=grok-desk`, and call `exchangeCheckout`. Set the returned opaque session as:

  ```ts
  response.cookies.set("gd_fulfillment", exchange.sessionToken, {
    httpOnly: true,
    secure: process.env.PORTAL_COOKIE_SECURE !== "false",
    sameSite: "strict",
    path: "/",
    maxAge: 10 * 60,
  });
  ```

  Redirect with status 303 to the localized success path without query parameters. Add `Referrer-Policy: no-referrer` and `Cache-Control: no-store, private`.

- [ ] **Step 4: Render key reveal and qualified downloads**

  The server component loads fulfillment data with the cookie. The client card receives a masked key plus a one-time reveal capability, not the raw key in initial HTML. Its controls are `Reveal`, `Copy`, `macOS Apple silicon`, `macOS Intel`, and `Windows x64`; Windows ARM64 is absent until qualification.

  ```tsx
  <button type="button" onClick={revealKey}>Reveal key</button>
  <button type="button" disabled={!revealedKey} onClick={() => navigator.clipboard.writeText(revealedKey!)}>
    Copy key
  </button>
  ```

  Clear `revealedKey` when the component unmounts and after 60 seconds. Set page metadata to prevent indexing and referrer leakage.

- [ ] **Step 5: Verify and commit**

  Run: `pnpm test -- tests/checkout-exchange.test.ts tests/success-page.test.tsx && pnpm build`

  Expected: PASS; rendered HTML and URLs contain no `GD3.` token.

  ```bash
  git add src/app/api/checkout/exchange/route.ts src/lib/portal-session.ts src/app/[lang]/success/page.tsx src/components/fulfillment-card.tsx tests/checkout-exchange.test.ts tests/success-page.test.tsx
  git commit -m "feat: add secure post-checkout fulfillment"
  ```

### Task 4: Deliver localized purchase and magic-link email from the outbox

**Files:**
- Modify: `src/lib/resend.ts`
- Create: `src/app/api/internal/email-outbox/route.ts`
- Create: `tests/email-outbox.test.ts`
- Modify: `src/lib/copy.ts`
- Modify: `tests/copy.test.ts`

- [ ] **Step 1: Write failing tests for logical idempotency and secret absence**

  ```ts
  expect(message.headers?.["Idempotency-Key"]).toBe("email_outbox:mail_123");
  expect(JSON.stringify(message)).not.toContain("GD3.");
  expect(JSON.stringify(message)).not.toContain("magic-token");
  expect(message.html).toContain("https://grokdesk.app/en/account/exchange#token=");
  ```

  The bearer token is placed in the URL fragment so it is not sent in HTTP access logs; a tiny client exchange component posts it once and immediately replaces browser history.

- [ ] **Step 2: Verify failure**

  Run: `pnpm test -- tests/email-outbox.test.ts tests/copy.test.ts`

- [ ] **Step 3: Implement authenticated outbox delivery**

  The internal route requires `ENTITLEMENT_OUTBOX_SERVICE_TOKEN`, accepts the outbox ID, recipient, locale, template kind, safe order reference, and fragment exchange token, calls Resend with a logical idempotency header, then returns provider ID or a retryable safe code. It must not acknowledge success when Resend fails.

  Purchase email content includes: portal key recovery, architecture selector, three-device allowance, lifetime stable updates, separate SuperGrok requirement, order reference, and support. Magic-link email includes expiry and one-use language.

- [ ] **Step 4: Verify seven locales and commit**

  Run: `pnpm test -- tests/email-outbox.test.ts tests/copy.test.ts && pnpm lint`

  Expected: PASS for `en`, `es`, `de`, `fr`, `pt`, `ja`, and `zh`; snapshots contain no product key or raw database ID.

  ```bash
  git add src/lib/resend.ts src/app/api/internal/email-outbox/route.ts src/lib/copy.ts tests/email-outbox.test.ts tests/copy.test.ts
  git commit -m "feat: deliver entitlement email outbox"
  ```

### Task 5: Build passwordless account authentication

**Files:**
- Create: `src/app/[lang]/account/page.tsx`
- Create: `src/components/account-access-form.tsx`
- Create: `src/components/magic-link-exchange.tsx`
- Create: `src/app/api/account/magic-link/route.ts`
- Create: `src/app/api/account/exchange/route.ts`
- Create: `src/app/api/account/logout/route.ts`
- Create: `tests/account-auth.test.ts`

- [ ] **Step 1: Write enumeration, expiry, reuse, and cookie tests**

  Submit existing and nonexistent email addresses and assert identical status/body shape. Assert the service receives the normalized email hash dimension and request IP. Test expired and reused tokens return the same customer-facing result.

  ```ts
  expect(existing.status).toBe(202);
  expect(await existing.json()).toEqual(await missing.json());
  expect((await existing.json()).message).toBe("If that email has a purchase, a sign-in link is on its way.");
  ```

- [ ] **Step 2: Verify failure**

  Run: `pnpm test -- tests/account-auth.test.ts`

- [ ] **Step 3: Implement request and exchange**

  Validate `z.email().trim().toLowerCase()`, call `requestMagicLink`, and always return 202 with the generic message. The exchange component reads the token fragment, posts it to `/api/account/exchange`, calls `history.replaceState` immediately, and never renders the token.

  Set `gd_portal` as HttpOnly, Secure, SameSite Strict, path `/`, max age 8 hours. The entitlement API enforces 30-minute inactivity and 8-hour absolute expiry. Set a separate readable `gd_csrf` random cookie for double-submit CSRF, also Secure and SameSite Strict.

- [ ] **Step 4: Implement logout and verify**

  Logout revokes the server session, expires both cookies, and redirects with 303.

  Run: `pnpm test -- tests/account-auth.test.ts && pnpm build`

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/[lang]/account/page.tsx src/components/account-access-form.tsx src/components/magic-link-exchange.tsx src/app/api/account tests/account-auth.test.ts
  git commit -m "feat: add passwordless customer access"
  ```

### Task 6: Build the self-service entitlement portal

**Files:**
- Create: `src/components/account-dashboard.tsx`
- Create: `src/components/device-list.tsx`
- Create: `src/components/key-manager.tsx`
- Create: `src/components/download-selector.tsx`
- Create: `src/app/api/account/actions/[action]/route.ts`
- Create: `tests/account-portal.test.tsx`
- Create: `tests/account-actions.test.ts`

- [ ] **Step 1: Write failing capability and CSRF tests**

  Cover purchase state; masked/reveal/copy/resend/rotate key; three device slots; rename/deactivate; qualified downloads; lifetime stable policy; order reference; refund/revocation state; support link. Mutation tests must reject missing, mismatched, and replayed CSRF values.

  ```ts
  expect(screen.getByText("2 of 3 devices active")).toBeVisible();
  expect(screen.getByRole("button", { name: "Deactivate Studio Mac" })).toBeVisible();
  expect(await mutate({ csrfCookie: "a", csrfHeader: "b" })).toMatchObject({ status: 403 });
  ```

- [ ] **Step 2: Verify failure**

  Run: `pnpm test -- tests/account-portal.test.tsx tests/account-actions.test.ts`

- [ ] **Step 3: Implement explicit action allowlist**

  ```ts
  const actionSchema = z.enum([
    "reveal-key",
    "resend-key",
    "rotate-key",
    "rename-device",
    "deactivate-device",
    "download-grant",
  ]);
  ```

  The action route validates portal cookie, CSRF cookie/header, content type, body size, action-specific schema, and service response. Key rotation requires a typed confirmation phrase and explains that old keys cannot activate new devices while recognized device-key refresh remains valid.

- [ ] **Step 4: Render safe device information**

  Show customer-selected name, platform, architecture, Desk version, activation time, and last seen. Do not show device public key, thumbprint, IP, raw activation ID, or private metadata.

- [ ] **Step 5: Verify and commit**

  Run: `pnpm test -- tests/account-portal.test.tsx tests/account-actions.test.ts && pnpm build`

  ```bash
  git add src/components/account-dashboard.tsx src/components/device-list.tsx src/components/key-manager.tsx src/components/download-selector.tsx src/app/api/account/actions tests/account-portal.test.tsx tests/account-actions.test.ts
  git commit -m "feat: add self-service license portal"
  ```

### Task 7: Replace permanent downloads with single-use grants

**Files:**
- Create: `src/app/api/downloads/[artifactId]/route.ts`
- Delete: `src/lib/downloads.ts`
- Modify: `src/components/download-selector.tsx`
- Modify: `tests/fulfillment.test.ts`
- Create: `tests/protected-downloads.test.ts`

- [ ] **Step 1: Write expiry, one-use, binding, and leakage tests**

  ```ts
  expect(grantRequest).toMatchObject({ artifactId: "desk-0.2.0-darwin-arm64" });
  expect(first.status).toBe(303);
  expect(second.status).toBe(410);
  expect(first.headers.get("location")).not.toContain("GD3.");
  expect(first.headers.get("referrer-policy")).toBe("no-referrer");
  ```

- [ ] **Step 2: Verify failure**

  Run: `pnpm test -- tests/protected-downloads.test.ts tests/fulfillment.test.ts`

- [ ] **Step 3: Implement server-side grant exchange**

  Accept only a known artifact ID from the authenticated fulfillment or portal session, request a grant, then redirect to the returned short-lived private storage URL. Set `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, and `Content-Security-Policy: default-src 'none'`. Never render or log the grant token.

- [ ] **Step 4: Remove permanent URL configuration**

  Remove `DOWNLOAD_URL_MAC` and `DOWNLOAD_URL_WIN` from code, environment samples, tests, and deployment configuration. Keep historical URLs only in the separately controlled migration runbook, never in new customer pages or mail.

- [ ] **Step 5: Verify and commit**

  Run: `pnpm test -- tests/protected-downloads.test.ts tests/fulfillment.test.ts && rg 'DOWNLOAD_URL_(MAC|WIN)' . --glob '!node_modules/**'`

  Expected: tests PASS and ripgrep returns no active configuration reference.

  ```bash
  git add src/app/api/downloads src/components/download-selector.tsx tests/protected-downloads.test.ts tests/fulfillment.test.ts .env.example
  git rm src/lib/downloads.ts
  git commit -m "feat: protect paid installer downloads"
  ```

### Task 8: Update commercial, legal, privacy, and support copy

**Files:**
- Modify: `src/lib/copy.ts`
- Modify: `src/components/sections/pricing.tsx`
- Modify: `src/components/sections/faq.tsx`
- Modify: `src/app/[lang]/privacy/page.tsx`
- Modify: `src/app/[lang]/terms/page.tsx`
- Modify: `src/app/[lang]/support/page.tsx`
- Modify: `tests/copy.test.ts`
- Modify: `tests/design-contract.test.ts`

- [ ] **Step 1: Write failing copy-contract assertions**

  For every locale, assert purchase-before-download, no trial, three active devices, self-service transfer, lifetime stable updates, beta opt-in, and separate SuperGrok billing. Privacy must name Stripe, Resend, device metadata, entitlement/update checks, artifact downloads, support/audit retention, and deletion contact.

- [ ] **Step 2: Verify failure**

  Run: `pnpm test -- tests/copy.test.ts tests/design-contract.test.ts`

- [ ] **Step 3: Update the seven locale dictionaries and pages**

  Remove any promise limited to “laptop + desktop” or “v1 updates.” Do not claim Windows ARM64 availability. Keep support language clear that local work remains viewable/exportable after licensing loss.

- [ ] **Step 4: Run full web verification**

  Run: `pnpm lint && pnpm test && pnpm build`

  Expected: all commands exit 0, all localized static routes build, and no key/session/grant value appears in generated HTML snapshots.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/copy.ts src/components/sections src/app/[lang]/privacy src/app/[lang]/terms src/app/[lang]/support tests/copy.test.ts tests/design-contract.test.ts
  git commit -m "docs: align commerce and privacy promises"
  ```

## Lane acceptance

The web lane is ready for integration when duplicate Stripe delivery is safely forwarded, email failure cannot fail fulfillment, paid checkout exchanges to a query-free secure session, keys are recoverable but absent from URLs and initial HTML, portal enumeration/CSRF tests pass, three devices are self-service visible, all downloads require one-use grants, and every locale states the approved commercial model.
