# Remote protocol v1

Canonical wire contract for Grok Desk Remote. Implementers: desk, relay, mobile.

See also: `docs/superpowers/plans/2026-07-12-mobile-remote-parallel-streams.md` §2.

## QR

`grokdesk://pair/` + base64url(UTF-8 JSON `PairingQrV1`).

## Relay WebSocket

Messages: `hello` | `send` | `ping` (client); `welcome` | `recv` | `err` | `pong` (server).  
`blob` fields are opaque base64url ciphertext — never log decoded content.

## Channels

- `pair:{machineId}` — sealed pair offer/accept  
- `ctrl:{machineId}:{deviceId}` — E2E control frames  

## Crypto

- Pair channel key: HKDF-SHA256(pairSecret, salt=`grokdesk-remote-v1`, info=`pair-frame`)  
- Control key: HKDF-SHA256(ECDH||pairSecret, salt=…, info=`control-frame`)  
- Frame: 24-byte nonce || XChaCha20-Poly1305 ciphertext  

Fixtures: `./fixtures/`.
