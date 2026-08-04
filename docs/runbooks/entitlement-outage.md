# Runbook: Entitlement service outage — RETIRED (product licensing)

**Status:** Retired for Desk product licensing (2026-07-31). The free desktop app does not require the Desk entitlement API to start or create tasks.

## Still relevant (non-product-license)

- **SuperGrok / xAI account auth** outages still block model work that needs a SuperGrok session.
- **Managed runtime / release-manifest** download issues still block installing the Grok CLI binary; see update/runtime runbooks.
- Update adapters may still call release endpoints historically colocated with entitlement hosts; treat those as **update** failures, not “activate license.”

## Do not

- Ask users for a Grok Desk product key.
- Fail closed the gateway for missing Desk lease state.
- Point users at Desk license recovery portals for free app access.
