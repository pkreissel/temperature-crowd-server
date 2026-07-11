/**
 * Bunny Edge Script — IP → hash middleware.
 *
 * Runs at the Bunny edge in front of the TemperaturCrowd origin container. For every request that
 * reaches the origin it:
 *   1. reads the real visitor IP (X-Real-IP, or the first X-Forwarded-For hop),
 *   2. replaces it with a salted SHA-256 hash in the `X-Client-IP-Hash` header, and
 *   3. strips every raw-IP header so the origin (and its logs) never see a real client IP.
 *
 * The origin rate-limiter keys on `X-Client-IP-Hash` (see apps/api/src/routes/helpers/rateLimit.ts),
 * so per-client limiting still works — but on an opaque, unlinkable token, never a raw IP and never
 * Bunny's shared edge IP. This keeps the privacy posture of the project (no raw IPs at the origin).
 *
 * Deploy: create an Edge Script of type "Middleware", attach it to the Pull Zone in front of the
 * container, and set the IP_HASH_SALT environment variable to a long random secret. Rotating the
 * salt rotates all hashes (rate-limit buckets reset), which is fine.
 */
import * as BunnySDK from "@bunny.net/edgescript-sdk";

// Headers that may carry a raw client IP. All are removed before the request hits the origin.
const RAW_IP_HEADERS = [
  "x-real-ip",
  "x-forwarded-for",
  "forwarded",
  "x-client-ip",
  "true-client-ip",
  "cf-connecting-ip",
];

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractClientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

BunnySDK.net.http
  // `url` is only used for local development; in production Bunny uses the Pull Zone origin.
  .servePullZone({ url: "http://localhost:3000" })
  .onOriginRequest(async (ctx: { request: Request }): Promise<Request> => {
    const req = ctx.request;

    const salt = (globalThis as any).Deno?.env.get("IP_HASH_SALT") ?? "";
    const hash = await sha256Hex(salt + "|" + extractClientIp(req.headers));

    const headers = new Headers(req.headers);
    for (const h of RAW_IP_HEADERS) headers.delete(h);
    headers.set("X-Client-IP-Hash", hash);

    return new Request(req, { headers });
  });
