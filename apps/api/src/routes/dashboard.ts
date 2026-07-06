import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index';
import fs from 'fs';
import path from 'path';

// Load HTML once
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');

const dashboardRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60').type('text/html').send(indexHtml);
  });

  server.get('/v1/dashboard/public', async (request, reply) => {
    try {
      const cohorts = await db.selectFrom('tier2_public_cohorts')
        .selectAll()
        .execute();

      const stats = await db.selectFrom('registered_phones')
        .select(db.fn.count<number>('phone_hmac').as('total_donors'))
        .executeTakeFirst();
        
      const readingsStats = await db.selectFrom('readings')
        .select(db.fn.count<number>('id').as('total_readings'))
        .executeTakeFirst();
        
      // KPIs only change when the hourly recompute job runs, so a short CDN
      // TTL is safe and offloads most reads from the origin. Set only on
      // success so error responses are never cached.
      reply.header('Cache-Control', 'public, max-age=60').send({
        cohorts,
        stats: {
          total_donors: stats?.total_donors || 0,
          total_readings: readingsStats?.total_readings || 0
        }
      });
    } catch (e) {
      server.log.error(e, 'Failed to fetch dashboard data');
      reply.code(500).send({ error: 'Failed to fetch dashboard data' });
    }
  });
};

export default dashboardRoutes;
