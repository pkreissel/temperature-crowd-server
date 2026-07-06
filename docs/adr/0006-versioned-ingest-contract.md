# 0006 — Versioned, additive-only ingest contract

- Status: Accepted
- Date: 2026-06-29

## Context
Clients (the HACS integration, Ecowitt gateways, DIY devices) are installed on machines we do
not control and update on their own schedule. The server is redeployed at will. The two must
tolerate version skew indefinitely.

## Decision
- The canonical ingest schema lives in `server/packages/contract` as the single source of
  truth (OpenAPI / JSON Schema), published as a versioned artifact.
- The endpoint path is versioned: **`/v1/ingest`**. Within a major version, changes are
  **additive-only** (new optional fields; never remove/repurpose/tighten existing ones).
- Breaking changes require a new major path (`/v2/...`) served **alongside** the old one until
  old clients age out.
- **Contract tests in CI** on both sides; the client repo pins a contract version.

## Canonical reading
Normalize to **UTC + °C** at the edge; batch; idempotent on `(device_id, ts)`; accept JSON
and form-encoded (Ecowitt) at the edge.

```json
{ "device_id": "shelly-ht-3c61", "api_key": "donor-scoped-secret",
  "readings": [ { "ts": "2026-06-28T12:00:00Z", "temp_c": 27.4,
                  "temp_c_min": 27.1, "temp_c_max": 30.4,
                  "room_ref": "schlafzimmer" } ] }
```

## Consequences
- Old integrations in the wild keep working; no forced-update treadmill.
- The contract is the clean boundary that lets the two repos evolve independently (HACS
  ADR-0003).
- Note: the `api_key` field carries the ADR-0004 blind-signed credential, not a plain API key.
  Its value is the string `"<X>:<signature_hex>"` — the pseudonym `X` and its unblinded RFC 9474
  (RSASSA-PSS) signature. The server splits on `:`, verifies the signature over `utf8(X)`, and
  uses `X` as the donor id. The contract field is still named `api_key`; rename/retype it to a
  `credential` shape in a future additive contract revision.
