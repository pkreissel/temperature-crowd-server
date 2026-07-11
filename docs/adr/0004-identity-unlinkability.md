# 0004 — Identity: RFC 9474 Blind RSA (RSASSA-PSS) credential + no precise location

- Status: Accepted
- Date: 2026-07-06
- Supersedes the interim OPRF draft of this ADR (dated 2026-06-29, never implemented). Restores
  and refines the original RFC 9474 direction to mirror the shipped code.

## Context
Donors must authenticate uploads and carry revocable consent, while the operator must be unable
to link a donor's email to their donated data. Our linkability requirement is **asymmetric**:
- **MUST sever:** email / issuance ↔ donated data.
- **MUST preserve:** a single donor's uploads linkable *to each other* over months/years
  (per-room ÜTGS needs a stable pseudonym).

An interim draft switched to a Reusable OPRF (`pyoprf`/`libsodium`) on the belief that it was
easier to distribute than blind RSA. That was wrong for our client: the HACS integration runs on
**HA OS (Alpine/musl, often ARM), installs `requirements` via pip at runtime, and has no
compiler** — so native crypto wheels (`libsodium`/`pyoprf`) fail to install. Blind RSA, by
contrast, needs only big-integer `pow()`, which CPython's stdlib provides natively. So the blind
signature is implemented **without any native dependency**, which OPRF could not achieve here.

## Decision
Use **RFC 9474 RSABSSA (Blind RSA over RSASSA-PSS, SHA-256, 32-byte salt)**. The client is
pure-Python stdlib; the server uses `node:crypto` (OpenSSL).

- **Pseudonym:** the client generates a random account id `X` (`secrets.token_hex(32)`). `X` is
  the stable pseudonym; the signed message is the **UTF-8 bytes of the `X` string**.
- **Issuance (client blinds):** the client `EMSA-PSS-ENCODE`s `X` (hand-rolled `hashlib` MGF1 +
  salt, `blind_rsa.py`), computes `m' = m · rᵉ mod n` with a random blinding factor `r`, and
  sends `m'` to the server alongside proof of phone control (SMS OTP + Turnstile).
- **Signing (server evaluates):** the server raises the blinded element to the private exponent
  — raw modexp via `crypto.privateDecrypt(RSA_NO_PADDING)` — and returns `s' = m'^d mod n`. It
  never sees `X`.
- **Unblind & store:** the client computes `s = s' · r⁻¹ mod n` and stores `(X, s)` locally as
  the credential. The wire/`api_key` form is `"<X>:<signature_hex>"`.
- **Upload auth (server verifies):** every upload carries `X:sig`. The server verifies with
  `crypto.verify('sha256', utf8(X), RSA_PKCS1_PSS_PADDING, saltLength=32, sig)`. Because we
  *want* long-term linkability, **reuse is intended (no double-spend log)**; `X` is the stable
  pseudonymous account id.
- **Key rotation:** rotating the RSA key invalidates all existing credentials.

## Coupled requirement
1. **IP address** — the ingest path **must not log client IP** (see ADR-0007).
2. **Payload** — coarsen location **in the client, before anything leaves the house** (grid cell
   / PLZ + climate region only); precise coordinates never leave (see ADR-0003, hacs ADR-0004).

## Consequences
- The client credential code is stdlib-only (`hashlib`, `secrets`, native `int`/`pow`) → it
  installs on HA OS with no wheels. Correctness is pinned by tests against the **RFC 9474
  published Known-Answer Test vectors** plus a blind→sign→unblind→verify round-trip.
- Verification uses standard RSASSA-PSS, so the server checks the full PSS structure (not a
  truncated-hash compare), closing the earlier textbook-RSA forgery surface.
- Private verifiability: the server holds the RSA private key to *sign*, and uses the public key
  to *verify*. Since we operate the only issuer/verifier this is acceptable; the signing key must
  be treated as the root of the auth system (env-injected, never committed).
