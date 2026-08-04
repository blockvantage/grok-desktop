# Runbook: Legacy license migration (GD2 → GD3) — RETIRED

**Status:** Retired (2026-07-31). Grok Desk is free; product-license activation and GD2→GD3 migration are no longer part of the desktop runtime path.

## What changed

- Desktop main no longer runs product-key activation, entitlement lease refresh, or legacy license migration at startup.
- Gateway no longer fail-closes Grok admission when Desk product entitlement state is missing.
- Stale license files / vault material under `userData` are **ignored** and must not crash startup.
- SuperGrok account sign-in and usage are unchanged.

## Historical reference only

Older design notes lived under `docs/superpowers/plans/*entitlement*` and the former migration journal under `apps/desktop/src/main/entitlements/`. Those modules may remain in the tree for tests or non-gating crypto but are **not** production gates.

Do not re-enable product-key enforcement for free Desk builds.

## Support

Users who still have old license files need no action. Fresh installs and upgraded installs run without a Desk product key.
