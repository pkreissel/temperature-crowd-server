import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index';
import contractSchema from '@temperaturcrowd/contract/schema.json';

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

const ingestRoutes: FastifyPluginAsync = async (server) => {
  server.post('/v1/ingest', { 
    schema: { body: contractSchema },
    config: {
      rateLimit: {
        max: 30, // 30 requests per minute per donor
        timeWindow: '1 minute',
        keyGenerator: (request) => (request as any).donor?.id || request.ip
      }
    }
  }, async (request, reply) => {
    const payload = request.body as any;
    const donorId = request.donor?.id || 'unknown';
    
    await insertReadings(payload, donorId);
    await insertDonorMetadata(payload, donorId);
    
    reply.send({ status: 'ok', received_readings: payload.readings?.length || 0, donor_id: donorId });
  });
};

export default ingestRoutes;
