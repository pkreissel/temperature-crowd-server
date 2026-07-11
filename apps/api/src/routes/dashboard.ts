import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index';

const dashboardRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', async (request, reply) => {
    // @fastify/static owns the Cache-Control header, so set the TTL via its maxAge option
    // (a manual reply.header is overwritten by sendFile).
    return reply.sendFile('index.html', { maxAge: 60_000 });
  });

  server.get('/v1/dashboard/public', async (request, reply) => {
    try {
      const cohorts = await db.selectFrom('tier2_public_cohorts')
        .selectAll()
        .execute();

      // "Active Donors" = people who actually contributed data, i.e. distinct donor_id in
      // readings. NOT registered_phones: that's a per-phone anti-Sybil registry, and by the
      // blind-signature design (RFC 9474) donor_id is cryptographically decoupled from
      // phone_hmac, so a phone count neither equals nor maps to the donor count.
      const stats = await db.selectFrom('readings')
        .select((eb) => [
          eb.fn.count<number>('donor_id').distinct().as('total_donors'),
          eb.fn.count<number>('id').as('total_readings'),
        ])
        .executeTakeFirst();

      // KPIs only change when the hourly recompute job runs, so a short CDN
      // TTL is safe and offloads most reads from the origin. Set only on
      // success so error responses are never cached.
      reply.header('Cache-Control', 'public, max-age=60').send({
        cohorts,
        stats: {
          total_donors: stats?.total_donors || 0,
          total_readings: stats?.total_readings || 0
        }
      });
    } catch (e) {
      server.log.error(e, 'Failed to fetch dashboard data');
      reply.code(500).send({ error: 'Failed to fetch dashboard data' });
    }
  });
};

export default dashboardRoutes;
