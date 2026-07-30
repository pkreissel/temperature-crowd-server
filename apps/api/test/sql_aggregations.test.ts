import { describe, it, expect, beforeAll } from 'vitest';
import { db, initDb } from '../src/db';
import { processYear } from '../src/jobs/helpers/sql_aggregations';
import { EnrichedTier1 } from '../src/jobs/helpers/cohorts';

describe('processYear', () => {
  beforeAll(async () => {
    await initDb();
    await db.deleteFrom('readings').execute();
  });

  it('keeps multiple rooms on the same device as separate room-seasons', async () => {
    const donorId = 'test-donor-multiroom';
    const deviceId = 'test-device-multiroom';
    const year = 2025;

    // Two distinct rooms on the same device, same hours, deliberately different temperatures
    // so a collapsed (donor_id, device_id)-only aggregation would be visibly wrong either way.
    const hours = [0, 1, 2];
    const values = hours.flatMap((h) => [
      {
        device_id: deviceId,
        donor_id: donorId,
        ts: new Date(Date.UTC(year, 6, 15, h)).toISOString(), // July 15th, room A: hot
        temp_c: 30,
        temp_c_min: 29,
        temp_c_max: 31,
        room_ref: 'room-a',
        postal_code: '10115'
      },
      {
        device_id: deviceId,
        donor_id: donorId,
        ts: new Date(Date.UTC(year, 6, 15, h)).toISOString(), // same hours, room B: mild
        temp_c: 22,
        temp_c_min: 21,
        temp_c_max: 23,
        room_ref: 'room-b',
        postal_code: '10115'
      }
    ]);

    await db.insertInto('readings').values(values).execute();

    const rawMetricsByRoom = new Map<string, EnrichedTier1[]>();
    await processYear(year, new Date(Date.UTC(year, 9, 2)), rawMetricsByRoom);

    const keysForDevice = [...rawMetricsByRoom.keys()].filter((k) => k.includes(deviceId));
    expect(keysForDevice).toHaveLength(2);

    const roomA = rawMetricsByRoom.get(`${donorId} ${deviceId} room-a`);
    const roomB = rawMetricsByRoom.get(`${donorId} ${deviceId} room-b`);
    expect(roomA).toBeDefined();
    expect(roomB).toBeDefined();

    // Room A stayed above 26°C every hour → should register overheating hours; room B never did.
    expect(roomA![0].metric.hours_above_26).toBe(hours.length);
    expect(roomB![0].metric.hours_above_26).toBe(0);
    expect(roomA![0].metric.room_ref).toBe('room-a');
    expect(roomB![0].metric.room_ref).toBe('room-b');
  });
});
