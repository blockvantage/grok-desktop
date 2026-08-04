# Runbook: Signing key rotation (product keys, leases, manifests)

## Purpose

Rotate Ed25519 signing keys used by entitlement-api without stranding clients.
Overlapping verification windows keep old signatures valid until expiry.

Related alert: `EntitlementSigningFailure`.

## Key classes

| Class | Signs | Verifiers |
| --- | --- | --- |
| Product key | GD3 product keys | Desktop / server reconstruct+verify |
| Device lease | Lease JWS | Desktop main (offline verify) |
| Release manifest | Update manifests | Desktop updater |

Private keys never load into the public API process for release manifests when
publication is isolated (publisher role). API process still needs lease/product
signing material from KMS/secret store.

## Symptoms

- `entitlement_api_signing_failures_total` increasing.
- Activations or lease refresh fail with stable signing error codes.
- Manifest publish pipeline fails at sign step.

## Rotation procedure (high level)

1. **Generate** new keypair in KMS / offline ceremony; record `kid`.
2. **Publish** new public JWK to the well-known / key-ring endpoint **before**
   switching signers (overlapping accept).
3. **Dual-sign or switch signer** per key class policy; keep prior `kid` in the
   verification set until max lease/manifest lifetime elapses.
4. **Retire** old public key only after:
   - no in-field signatures still require it, and
   - metrics show negligible verify traffic for that `kid`.
5. **Two-person approval** for production release-signing and product-root keys.

## Emergency

1. If private material is suspected compromised: immediately add a replacement
   `kid`, disable the compromised kid for **new** signatures, force lease
   refresh where possible, and revoke product keys only with audited process.
2. Customer key compromise is not solved by server key rotation alone — use
   portal deactivation / support runbooks and seat transfer flows.

## Verification

1. `/.well-known` (or internal key set) lists old+new kids during overlap.
2. Lab device activates and refreshes lease under new signer.
3. Signing failure counter stops increasing.
4. Audit log shows rotation event with operator ids (no private key material).

## See also

- [entitlement-outage.md](./entitlement-outage.md)
- [bad-release-rollback.md](./bad-release-rollback.md)
- [artifact-revocation.md](./artifact-revocation.md)
