import { describe, it, expect } from 'vitest';
import { buildCohortsForSeason, EnrichedTier1 } from '../src/jobs/helpers/cohorts';

describe('Cohorts Aggregation', () => {
  it('aggregates metrics using median instead of mean', () => {
    // K_THRESHOLD is 10, so we need at least 10 distinct donors to form a cohort.
    const mockEntries: EnrichedTier1[] = [];
    
    // Create 9 normal donors
    for (let i = 1; i <= 9; i++) {
      mockEntries.push({
        metric: {
          donor_id: `d${i}`,
          device_id: `dev${i}`,
          room_ref: `r${i}`,
          season: '2026-summer',
          region: 'A',
          utgs_kh: 10,
          utgs_kh_peak: 10,
          hours_above_26: 5,
          hours_above_28: 2,
          hours_above_30: 0,
          max_temp: 30,
          tropical_nights: 1,
          coverage_pct: 100,
        },
        cells: {
          de: 'de:DE',
          plz1: 'plz1:6',
          plz3: 'plz3:603',
          plz5: 'plz5:60385'
        }
      });
    }

    // Add 1 extreme outlier to prove median is used (mean would be heavily skewed)
    // Add two more normal ones to make the array size 11, so the median is clearly 10 (the 6th element)
    mockEntries.push({
      metric: {
        donor_id: 'd10',
        device_id: 'dev10',
        room_ref: 'r10',
        season: '2026-summer',
        region: 'A',
        utgs_kh: 1000,
        utgs_kh_peak: 1000,
        hours_above_26: 500,
        hours_above_28: 200,
        hours_above_30: 100,
        max_temp: 50,
        tropical_nights: 100,
        coverage_pct: 100,
      },
      cells: { de: 'de:DE', plz1: 'plz1:6', plz3: 'plz3:603', plz5: 'plz5:60385' }
    });
    mockEntries.push({
      metric: {
        donor_id: 'd11',
        device_id: 'dev11',
        room_ref: 'r11',
        season: '2026-summer',
        region: 'A',
        utgs_kh: 20,
        utgs_kh_peak: 20,
        hours_above_26: 10,
        hours_above_28: 4,
        hours_above_30: 1,
        max_temp: 32,
        tropical_nights: 2,
        coverage_pct: 100,
      },
      cells: { de: 'de:DE', plz1: 'plz1:6', plz3: 'plz3:603', plz5: 'plz5:60385' }
    });

    const cohorts = buildCohortsForSeason('2026-summer', mockEntries);
    
    // Should create a cohort at plz5 level
    const result = cohorts.find(c => c.grid_level === 'plz5');
    expect(result).toBeDefined();

    // Values: 9x 10, 1x 20, 1x 1000
    // Sorted: 10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 1000
    // Median is the 6th element which is 10.
    expect(result!.avg_utgs_kh).toBe(10);
    expect(result!.avg_utgs_kh_peak).toBe(10);
    expect(result!.avg_hours_above_26).toBe(5);
    expect(result!.avg_hours_above_28).toBe(2);
    expect(result!.avg_hours_above_30).toBe(0);
    expect(result!.avg_max_temp).toBe(30);
    expect(result!.avg_tropical_nights).toBe(1);
    
    expect(result!.k_size).toBe(11);
    expect(result!.room_count).toBe(11);
    expect(result!.region).toBe('A');
  });

  it('calculates median correctly for an even number of entries', () => {
    const mockEntries: EnrichedTier1[] = [];
    
    // Create 9 donors with value 10
    for (let i = 1; i <= 9; i++) {
      mockEntries.push({
        metric: {
          donor_id: `d${i}`, device_id: `dev${i}`, room_ref: `r${i}`, season: '2026-summer', region: 'A',
          utgs_kh: 10, utgs_kh_peak: 10, hours_above_26: 5, hours_above_28: 2, hours_above_30: 0,
          max_temp: 30, tropical_nights: 1, coverage_pct: 100,
        },
        cells: { de: 'de:DE', plz1: 'plz1:6', plz3: 'plz3:603', plz5: 'plz5:60385' }
      });
    }

    // Add 1 donor with value 20 to make 10 total entries (even number)
    mockEntries.push({
      metric: {
        donor_id: 'd10', device_id: 'dev10', room_ref: 'r10', season: '2026-summer', region: 'A',
        utgs_kh: 20, utgs_kh_peak: 20, hours_above_26: 10, hours_above_28: 4, hours_above_30: 1,
        max_temp: 32, tropical_nights: 2, coverage_pct: 100,
      },
      cells: { de: 'de:DE', plz1: 'plz1:6', plz3: 'plz3:603', plz5: 'plz5:60385' }
    });

    const cohorts = buildCohortsForSeason('2026-summer', mockEntries);
    const result = cohorts.find(c => c.grid_level === 'plz5');

    // Values: 9x 10, 1x 20. Total 10.
    // Sorted: 10, 10, 10, 10, 10, 10, 10, 10, 10, 20
    // Middle two are 10 and 10, so average is 10.
    expect(result!.avg_utgs_kh).toBe(10);
    expect(result!.avg_max_temp).toBe(30);
  });
});
