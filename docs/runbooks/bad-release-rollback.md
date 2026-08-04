# Runbook: Bad release rollback

## Purpose

Stop customer impact from a bad Desk and/or managed Grok release, restore a
known-good pair, and preserve local user data (conversations, vault, device
identity).

## Scope

- Signed desktop installers (DMG / ZIP / NSIS) for qualified targets:
  `darwin-arm64`, `darwin-x64`, `win32-x64`
- Managed Grok runtime artifacts selected by the compatibility manifest
- Does **not** cover Stripe/commerce refunds (separate commerce runbook)

## Severity triage

| Signal | Severity | First action |
| --- | --- | --- |
| Crash-on-launch > baseline on one target | Sev-1/2 | Pause rollout for that target |
| Broken activation / lease verification | Sev-1 | Pause all targets; check entitlement API |
| Bad runtime only (Desk OK) | Sev-2 | Revoke runtime artifact; keep Desk |
| Signing / notarization failure pre-stable | Sev-3 | Block manifest sign; rebuild |
| win32-arm64 accidentally listed | Sev-1 | Fail release gate; remove target |

## Immediate steps (first 15 minutes)

1. **Declare the incident** in the release channel: tag, targets, channel,
   approximate start time. Do **not** paste product keys, tokens, or device IDs.
2. **Pause rollout** for the affected target(s) in the entitlement release
   service (`rollout pause` with operator identity + reason). Prefer
   target-scoped pause when only one platform regresses.
3. **Stop promoting** the candidate: cancel in-flight GitHub
   `release-desktop` jobs; do not import further catalog rows for the bad
   build.
4. **Identify last-known-good** Desk version + Grok version pair from the
   previous stable manifest sequence.
5. **If artifacts are actively harmful** (malware suspicion, critical RCE):
   proceed to [artifact revocation](./artifact-revocation.md) in parallel.

## Rollback Desk (client)

1. Publish / keep the previous stable installer links for the target.
2. Instruct affected users (support macros) to install the previous signed
   build — never unsigned sideloads.
3. Confirm Keychain / Credential Manager and `userData` survive reinstall
   (repair must not wipe device identity or product key).
4. If a forced migration is required, attach the migration journal recovery
   path from `legacy-license-migration.md` (when relevant).

## Rollback managed Grok runtime

1. Ensure the signed compatibility manifest still lists a prior good pair
   for the target (or publish a new sequence that removes the bad pair and
   restores the good one — two-person approval on stable).
2. Clients should auto-select the restored pair on next resolve; if a bad
   runtime is already `current`, users can use in-app **Repair** / rollback
   control (Settings → Runtime & Updates).
3. Do **not** instruct users to install global `grok` via Homebrew/PATH as a
   production fix.

## Verification

- [ ] Rollout paused (audit row present)
- [ ] Manifest sequence increased; bad pair absent for affected targets
- [ ] SHA-256 of restored artifacts match catalog
- [ ] Smoke: launch → activate (if needed) → one real task on each affected target
- [ ] Crash-free / support volume trending down
- [ ] Incident timeline written (no secrets)

## Communication

- Internal: release + support channels with tag, targets, workaround
- External: only if customers are blocked; use portal status, not raw digests alone

## Exit criteria

Rollout may resume only after:

1. Root cause documented
2. Fix qualified per [qualification template](../releases/qualification-template.md)
3. New signed artifacts + hashes imported
4. Dual approval for stable

## Related

- [Artifact revocation](./artifact-revocation.md)
- [Qualification template](../releases/qualification-template.md)
- `scripts/assert-release-targets.ts` (blocks unqualified `win32-arm64`)
