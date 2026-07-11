import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index';
import { clientRateLimitKey } from './helpers/rateLimit';

const donorRoutes: FastifyPluginAsync = async (server) => {
  server.delete('/v1/donor', {
    // Rate-limit this authenticated, destructive route (clears the preHandler's
    // "authorization without rate limiting" exposure; /v1/ingest is already limited).
    // Keyed on the Bunny edge IP hash, not the shared edge IP.
    config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: clientRateLimitKey } }
  }, async (request, reply) => {
    const donorId = request.donor?.id;
    if (!donorId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    try {
      const deletedReadings = await db.deleteFrom('readings').where('donor_id', '=', donorId).executeTakeFirst();
      const deletedMetrics = await db.deleteFrom('tier1_room_metrics').where('donor_id', '=', donorId).executeTakeFirst();
      const deletedMetadata = await db.deleteFrom('donor_metadata').where('donor_id', '=', donorId).executeTakeFirst();
      
      reply.send({ 
        status: 'ok', 
        message: 'Donor data deleted successfully',
        deleted_readings: Number(deletedReadings.numDeletedRows),
        deleted_metrics: Number(deletedMetrics.numDeletedRows),
        deleted_metadata: Number(deletedMetadata.numDeletedRows)
      });
    } catch (err) {
      server.log.error(err, 'Failed to delete donor data');
      reply.code(500).send({ error: 'Failed to delete donor data' });
    }
  });
};

export default donorRoutes;
