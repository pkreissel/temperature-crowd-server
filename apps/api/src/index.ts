import 'dotenv/config';
import fastify from 'fastify';
import { initDb } from './db/index';
import { blindRsaAuth } from './blind_rsa';
import { runRecomputeJob } from './jobs/recompute';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import dashboardRoutes from './routes/dashboard';
import authRoutes from './routes/auth';
import ingestRoutes from './routes/ingest';
import donorRoutes from './routes/donor';

export const server = fastify({ 
  logger: {
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          hostname: request.hostname,
        };
      }
    }
  },
  trustProxy: true
});

server.register(cors, {
  origin: '*'
});

server.register(rateLimit, {
  max: 100, // default limit
  timeWindow: '1 minute'
});

async function verifyApiKey(payloadApiKey: any, authHeader: string | undefined): Promise<string | null> {
  let key = payloadApiKey;
  if (!key && authHeader && authHeader.startsWith('Bearer ')) {
    key = authHeader.substring(7);
  }
  if (!key || typeof key !== 'string') return null;

  const parts = key.split(':');
  if (parts.length !== 2) return null;

  const [xHex, tokenHex] = parts;
  const isValid = await blindRsaAuth.verifyToken(xHex, tokenHex);
  return isValid ? xHex : null;
}

server.decorateRequest('donor', null as any);

server.addHook('preHandler', async (request, reply) => {
  const path = request.routeOptions.url;
  if (path === '/v1/ingest' || path === '/v1/donor') {
    const donorId = await verifyApiKey((request.body as any)?.api_key, request.headers.authorization);
    if (!donorId) {
      reply.code(401).send({ error: 'Missing or invalid api_key' });
      return;
    }
    request.donor = { id: donorId };
  }
});

// Register routes
server.register(dashboardRoutes);
server.register(authRoutes);
server.register(ingestRoutes);
server.register(donorRoutes);

export const start = async () => {
  try {
    await initDb();
    server.log.info('Database initialized');
    await blindRsaAuth.init();
    server.log.info('RSA Key loaded from ENV');
    const port = parseInt(process.env.PORT || '3000', 10);
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info(`Server listening on ${port}`);
    
    setInterval(() => {
      runRecomputeJob().catch(err => server.log.error(err, 'Recompute job failed'));
    }, 60 * 60 * 1000);
  } catch (err) {
    server.log.error(err, 'Failed to start server');
    process.exit(1);
  }
};

if (require.main === module || process.argv[1]?.includes('src/index.ts')) {
  start();
}
