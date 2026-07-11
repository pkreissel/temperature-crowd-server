import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index';
import contractSchema from '@temperaturcrowd/contract/schema.json';
import { clientRateLimitKey } from './helpers/rateLimit';

async function insertReadings(payload: any, donorId: string) {
  if (!payload.readings || payload.readings.length === 0) return;
  const values = payload.readings.map((r: any) => ({
    device_id: payload.device_id,
    donor_id: donorId,
    ts: r.ts,
    temp_c: r.temp_c,
    temp_c_min: r.temp_c_min ?? null,
    temp_c_max: r.temp_c_max ?? null,
    room_ref: r.room_ref ?? null,
    postal_code: payload.postal_code ?? null
  }));

  // The unique key is (device_id, ts) only, so a reading can collide with a row owned by a
  // *different* donor (device_id is a client-supplied UUID). Guard the upsert with a WHERE so
  // it only overwrites a row that already belongs to the same donor; a cross-donor collision
  // becomes a no-op instead of silently tampering with another donor's readings. donor_id is
  // never updated, so ownership of an existing row can't be reassigned either.
  await db.insertInto('readings')
    .values(values)
    .onConflict((oc) => oc
      .columns(['device_id', 'ts'])
      .doUpdateSet({
        temp_c: (eb) => eb.ref('excluded.temp_c'),
        temp_c_min: (eb) => eb.ref('excluded.temp_c_min'),
        temp_c_max: (eb) => eb.ref('excluded.temp_c_max'),
        room_ref: (eb) => eb.ref('excluded.room_ref')
      })
      .where('readings.donor_id', '=', (eb) => eb.ref('excluded.donor_id'))
    )
    .execute();
}

async function insertDonorMetadata(payload: any, donorId: string) {
  if (!payload.building_age && !payload.floor_level && !payload.orientation && !payload.insulation_status) return;
  
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sql } = require('kysely');
  await db.insertInto('donor_metadata')
    .values({
      donor_id: donorId,
      building_age: payload.building_age ?? null,
      floor_level: payload.floor_level ?? null,
      orientation: payload.orientation ?? null,
      insulation_status: payload.insulation_status ?? null
    })
    .onConflict((oc) => oc
      .column('donor_id')
      .doUpdateSet({
        building_age: (eb) => eb.ref('excluded.building_age'),
        floor_level: (eb) => eb.ref('excluded.floor_level'),
        orientation: (eb) => eb.ref('excluded.orientation'),
        insulation_status: (eb) => eb.ref('excluded.insulation_status'),
        updated_at: sql`CURRENT_TIMESTAMP`
      })
    )
    .execute();
}

// The server's current view of what it holds for this donor+device. Returned on every ingest so
// a client (which retains its full local history) can detect a server-side gap and self-heal:
// after an accidental wipe the server's min_ts jumps forward and count drops below what the client
// knows it uploaded, which is the client's cue to re-send the missing readings. Backfill is safe
// and needs no special path — ingest upserts idempotently on (device_id, ts), so re-sending rows
// the server already has is a no-op. Scoped to donor_id so it never reflects another donor's data.
async function deviceCoverage(donorId: string, deviceId: string) {
  const row = await db.selectFrom('readings')
    .where('donor_id', '=', donorId)
    .where('device_id', '=', deviceId)
    .select((eb) => [
      eb.fn.count<number>('id').as('count'),
      eb.fn.min<string | null>('ts').as('min_ts'),
      eb.fn.max<string | null>('ts').as('max_ts'),
    ])
    .executeTakeFirst();
  return {
    device_id: deviceId,
    count: Number(row?.count ?? 0),
    min_ts: row?.min_ts ?? null,
    max_ts: row?.max_ts ?? null,
  };
}

const ingestRoutes: FastifyPluginAsync = async (server) => {
  server.post('/v1/ingest', { 
    schema: { body: contractSchema },
    config: {
      rateLimit: {
        max: 30, // 30 requests per minute per client
        timeWindow: '1 minute',
        // donor id isn't set until the preHandler (after the rate-limit hook), so key on the
        // Bunny edge IP hash instead of the shared edge IP.
        keyGenerator: clientRateLimitKey
      }
    }
  }, async (request, reply) => {
    const payload = request.body as any;
    const donorId = request.donor?.id || 'unknown';
    
    await insertReadings(payload, donorId);
    await insertDonorMetadata(payload, donorId);

    reply.send({
      status: 'ok',
      received_readings: payload.readings?.length || 0,
      donor_id: donorId,
      // Lets a client compare against its local history and backfill anything the server is missing.
      coverage: await deviceCoverage(donorId, payload.device_id)
    });
  });
};

export default ingestRoutes;
