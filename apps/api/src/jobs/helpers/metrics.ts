// Tier-1 per-room seasonal metric computation (ADR-0002).

// ÜTGS accrues in summer; default reporting window is Jun–Sep (ADR-0002). Months are 1-based.
export const SEASON_START_MONTH = 6; // June
export const SEASON_END_MONTH = 9; // September (inclusive)

export function seasonLabel(year: number): string {
  return `${year}-summer`;
}

// UTC [start, end) bounds of a season's summer window.
export function seasonWindow(year: number): { start: number; end: number } {
  return {
    start: Date.UTC(year, SEASON_START_MONTH - 1, 1, 0, 0, 0),
    end: Date.UTC(year, SEASON_END_MONTH, 1, 0, 0, 0), // first instant of October
  };
}
