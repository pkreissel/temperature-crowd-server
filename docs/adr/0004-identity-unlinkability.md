# 0004 — Identity: blind-signed long-lived credential (RFC 9474) + no precise location

- Status: Accepted
- Date: 2026-06-29
- Supersedes the earlier Proposed draft of this ADR.

## Context
Donors must authenticate uploads and carry revocable consent, while the operator must be
unable to link a donor's email to their donated data. Our linkability requirement is
**asymmetric**:
- **MUST sever:** email / issuance ↔ donated data.
- **MUST preserve:** a single donor's uploads linkable *to each other* over months/years
  (per-room ÜTGS needs a stable pseudonym).

This rules out Privacy Pass / VOPRF / BBS-style schemes, which are built to make *every*
show mutually unlinkable — the opposite of what we need. The right primitive is the weakest
one that breaks only the issuance link: a single blind signature yielding one long-lived,
reusable credential.

## Options considered
| Scheme | Verdict |
|---|---|
| **RFC 9474 RSA blind signatures**, single long-lived credential | **Chosen.** Publicly verifiable (RSA-PSS verify, no key at verifier); standardized; in production as Apple Private Access Tokens Type 2 and Privacy Pass publicly-verifiable issuance. |
| VOPRF / Privacy Pass privately verifiable (RFC 9497/9578) | Rejected — single-use, needs verifier key or double-spend log, mutually-unlinkable redemptions (wrong grain). |
| Privacy Pass publicly verifiable (RFC 9578 Type 2) | Rejected — built on RFC 9474 but framed single-use; inherits double-spend machinery we don't want. Use the primitive directly. |
| Blind Schnorr / blind BLS | Rejected — ROS attack (Benhamouda et al. 2020) breaks naive concurrent signing; concurrently-secure variants too research-fresh. |
| Anonymous credentials (BBS+/U-Prove/Idemix) | Rejected — selective disclosure + multi-show unlinkability; overkill and wrong unlinkability shape. |

## Decision
Use **RFC 9474 RSA blind signatures**, one issuance → one reusable credential.

- **Issuance:** donor proves email control (magic link); server returns one blind-signed
  credential. Issuance log stores `email → issued` (Sybil resistance) but **never the token** —
  the signed message is blinded, so the operator cannot record what it signed.
- **Upload auth:** donor presents `(msg, sig)`; server verifies as an RSA-PSS signature under
  the issuer public key. `hash(msg)` is the **pseudonymous account id** grouping the donor's
  devices/rooms over time. Reuse is intended — **no double-spend log**.
- **Erasure:** bearer-driven — donor presents the credential to delete everything under
  `hash(msg)` (consistent with ADR-0001/0003). Document "keep this credential" up front.
- **Key rotation:** one issuer key = one anonymity set. Rotate on slow epochs only;
  over-rotation shrinks the set and leaks issuance timing. Verifier keeps recent public keys.

## Coupled requirement — the crypto is necessary but NOT sufficient
Two non-crypto channels dominate de-anonymization and would make the scheme theatre if ignored:
1. **IP address** — uploads originate from the donor's home IP. The ingest path **must not log
   client IP** (or must terminate behind a proxy that strips it). Hard requirement.
2. **Payload** — precise location re-identifies regardless of token; coarsen at the edge
   (client ADR-0004). If the stored payload is genuinely non-identifying, the dataset may fall
   *outside* "personal data" scope — a DSGVO simplification.

## Open implementation details
- Issuer key size (RSA 2048 vs 4096) and rotation epoch length.
- Library: reference implementations exist for RFC 9474 (e.g. `blind-rsa-signatures`); pick
  one with a maintained, audited track record; pin and test against RFC test vectors.
- `device_id` stays client-generated, random, rotatable (grouping key within an account).
- Token loss UX (intentionally limited recovery, by design).

## Consequences
- Structural email↔data unlinkability; lighter DSGVO footprint *iff* payload + IP are handled.
- No double-spend store, no per-upload issuance — simple verify on the hot path.
- Forces "no IP logging on ingest" and edge location-coarsening as hard requirements.
- The ingest contract's auth field carries this credential, not a plain API key (ADR-0006).

## References
- RFC 9474 — RSA Blind Signatures.
- RFC 9578 — Privacy Pass Issuance Protocols (publicly-verifiable variant uses BLINDRSA).
- IACR ePrint 2020/945 — On the (in)security of ROS (blind Schnorr concurrency attack).
- Apple Private Access Tokens — Token Type 2 uses Blind RSA (RFC 9474).
