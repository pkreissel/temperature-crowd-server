import type { FastifyRequest } from 'fastify';

// Rate-limit key generator. Prefers the privacy-preserving per-client hash that the Bunny edge
// script sets (X-Client-IP-Hash): the origin never sees a raw client IP and never keys on Bunny's
// shared edge IP, so donors are never throttled collectively. Falls back to request.ip for local
// or direct-origin use where the edge script isn't in front.
export function clientRateLimitKey(request: FastifyRequest): string {
  const hashed = request.headers['x-client-ip-hash'];
  if (typeof hashed === 'string' && hashed.length > 0) return hashed;
  return request.ip;
}
