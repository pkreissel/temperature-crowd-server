import { FastifyPluginAsync } from 'fastify';
import { verifyTurnstile } from './helpers/authHelpers';

// The operator's identifying details (name + address) required by § 5 DDG. They are served ONLY
// after a successful Cloudflare Turnstile pass, so automated scrapers/harvesters cannot collect
// them while any human can still view them. All values come from environment variables — nothing
// is hardcoded here, and they never appear in the static HTML in ./public.
//
// IMPRESSUM_ADDRESS is a pipe-separated list of address lines, e.g.
//   IMPRESSUM_ADDRESS="Musterstraße 1|12345 Musterstadt|Deutschland"
const IMPRESSUM_IDENTITY = {
  name: process.env.IMPRESSUM_NAME || '',
  address: (process.env.IMPRESSUM_ADDRESS || '').split('|').map((s) => s.trim()).filter(Boolean),
  email: process.env.IMPRESSUM_EMAIL || '',
  phone: process.env.IMPRESSUM_PHONE || '',
};

// Static legal pages required for German-hosted services: Impressum (§ 5 DDG) and the
// Datenschutzerklärung (GDPR). The pages themselves are cacheable — a CDN TTL offloads the origin.
const legalRoutes: FastifyPluginAsync = async (server) => {
  server.get('/impressum', async (request, reply) => {
    return reply.sendFile('impressum.html', { maxAge: 3_600_000 });
  });

  server.get('/datenschutz', async (request, reply) => {
    return reply.sendFile('datenschutz.html', { maxAge: 3_600_000 });
  });

  // Reveals the operator identity only after a valid Turnstile token. Never cache this.
  server.post('/v1/impressum-details', async (request, reply) => {
    const token = (request.body as any)?.['cf-turnstile-response'];
    if (!token || !(await verifyTurnstile(token))) {
      reply.code(403).send({ error: 'CAPTCHA validation failed' });
      return;
    }
    reply.header('Cache-Control', 'no-store').send(IMPRESSUM_IDENTITY);
  });
};

export default legalRoutes;
