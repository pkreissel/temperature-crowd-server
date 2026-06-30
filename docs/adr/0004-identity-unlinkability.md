# 0004 — Identity: Reusable OPRF (Oblivious Pseudorandom Function) + no precise location

- Status: Accepted
- Date: 2026-06-29
- Supersedes the earlier Proposed draft of this ADR (which used RFC 9474).

## Context
Donors must authenticate uploads and carry revocable consent, while the operator must be unable to link a donor's email to their donated data. Our linkability requirement is **asymmetric**:
- **MUST sever:** email / issuance ↔ donated data.
- **MUST preserve:** a single donor's uploads linkable *to each other* over months/years (per-room ÜTGS needs a stable pseudonym).

Earlier, we proposed RFC 9474 (Blind RSA). However, implementing raw RSA blinding securely in Python (for the HACS client) is fraught with risk, and standard libraries are lacking. We need a simpler, battle-tested primitive available in both Node.js and Python.

## Decision
Use **Reusable OPRF (Oblivious PRF)** using `libsodium` (e.g., via `pyoprf` and standard Node crypto bindings).

- **Issuance (Blinding):** The client generates a random nonce `x` (pseudonym). It blinds `x` to `B(x)` and sends `B(x)` to the server alongside proof of email control (magic link).
- **Signing (Evaluation):** The server maintains a secret key `k`. It evaluates the blinded input to produce `B(OPRF(k, x))` and returns it. The server never learns `x`.
- **Unblinding & Storage:** The client unblinds to retrieve `OPRF(k, x)`. It stores `(x, OPRF(k, x))` locally as the `api_key`.
- **Upload auth (Verification):** On every upload, the client sends `(x, OPRF(k, x))`. Because we *want* long-term linkability, **reuse is intended (no double-spend log)**. The server simply recomputes `OPRF(k, x)` using its secret key `k` and verifies it matches the provided value. `x` serves as the stable pseudonymous account ID.
- **Key rotation:** If `k` is rotated, all existing tokens invalidate.

## Coupled requirement
1. **IP address** — The ingest path **must not log client IP**.
2. **Payload** — Coarsen location at the edge.

## Consequences
- The client library (`pyoprf` / `libsodium`) is highly secure and easy to distribute.
- Private verifiability: the server must hold the secret key `k` to verify uploads (unlike RSA which is publicly verifiable). Since we operate the only server, this is completely acceptable.
