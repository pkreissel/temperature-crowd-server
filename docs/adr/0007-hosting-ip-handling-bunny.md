# 0007 — Hosting & IP handling on Bunny Magic Containers

- Status: Accepted
- Date: 2026-06-29

## Context
ADR-0004 makes "no client IP on the ingest path" a hard requirement: a blind-signed
credential is theatre if we log the donor's home IP. We plan to host the ingest API on
**Bunny Magic Containers**. Magic Containers sit behind Bunny's edge proxy — the container's
TCP peer is always a Bunny PoP (tagged `CDN-ServerId`), so the real client IP only reaches the
container via forwarded headers, which Bunny injects (`X-Forwarded-For`, `X-Real-IP`) **by
default**.

## Decision
- Run the ingest API as a Magic Container behind a **Pull Zone**.
- **Strip the IP headers before the container** in an Edge Scripting `onOriginRequest`
  middleware:
  ```js
  export async function onOriginRequest(context) {
    context.request.headers.delete("X-Forwarded-For");
    context.request.headers.delete("X-Real-IP");
    return context.request;
  }
  ```
  No Edge Rule may re-add an IP header (e.g. `X-New-IP: %{User.IP}`). Result: the container is
  genuinely IP-blind — its only peer is the PoP, so the client IP is unrecoverable past the edge.
- **Keep Bunny IP anonymization ON** (default → truncated IPs in Bunny logs).
- **No Permanent Log Storage** for the ingest zone (default logs: 3-day, anonymized).
- **No Edge Scripting that persists `User.IP`** anywhere.
- **Abuse control runs at the edge** (Bunny WAF / rate-limit rules / Edge Scripting) using the
  IP *before* it is stripped — so the container stays IP-blind while we keep IP-based
  rate-limiting. Clean split: edge = IP-based anti-abuse; container = credential verify + store.
- List **Bunny (BunnyWay d.o.o., EU/Slovenia)** as a processor in the DPA / processor register.

## Trust boundary (stated honestly)
Stripping at the container does **not** remove the IP from existence: Bunny's edge terminates
TLS and necessarily sees the client IP and plaintext for the moment it routes the request. We
have blinded *our container*, not *our CDN*. Because issuance (email) happens at the container,
Bunny never sees the email — so even an edge compromise/compulsion cannot link **IP↔email**,
only **IP↔upload-timing** during a brief window. For this project's threat model (evidencing
norm violations, not protecting at-risk persons) that residual is acceptable. Zero-infra-holds-
the-IP is unachievable with any TLS-terminating CDN; it would require a first-hop proxy we operate.

## Open / to verify
- Confirm Edge Scripting middleware binds to the Pull Zone fronting the Magic Container; if not,
  use Edge Rules header-stripping as the fallback.
- Pin the abuse/rate-limit policy at the edge.

## References
- Bunny — end-user IPs in origin (X-Real-IP / X-Forwarded-For).
- Bunny docs — Edge Scripting middleware (`onOriginRequest`); Modify HTTP headers.
- Bunny — IP anonymization (default-on); CDN logging (retention, full-IP requires DPA).
