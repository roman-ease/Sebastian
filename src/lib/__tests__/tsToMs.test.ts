import { describe, it, expect } from 'vitest';
import { tsToMs } from '../supabase';

// ローカル updated_at（SQLite CURRENT_TIMESTAMP: UTC・タイムゾーン記号なし）と
// リモート updated_at（toISOString: Z付き）が同じ時間軸で比較できることの検証。
// このズレが原因で「直近9時間のローカル編集がリモートに負ける」バグがあった（2026-07-15 修正）。
describe('tsToMs', () => {
  it('素の「YYYY-MM-DD HH:MM:SS」を UTC として解釈する', () => {
    expect(tsToMs('2026-07-15 03:00:00')).toBe(Date.parse('2026-07-15T03:00:00Z'));
  });

  it('同時刻なら naive(UTC) と ISO(Z付き) が同値になる', () => {
    expect(tsToMs('2026-07-15 03:00:00')).toBe(tsToMs('2026-07-15T03:00:00.000Z'));
  });

  it('新しいローカル編集(naive)が古いリモート(ISO)より大きい', () => {
    const local = tsToMs('2026-07-15 03:00:05');
    const remote = tsToMs('2026-07-15T03:00:00.000Z');
    expect(local).toBeGreaterThan(remote);
  });

  it('ISO 文字列はそのまま解釈する（pull でローカル列に書き戻された値）', () => {
    expect(tsToMs('2026-07-15T12:34:56.789Z')).toBe(Date.parse('2026-07-15T12:34:56.789Z'));
  });

  it('小数秒付きの naive 形式も扱える', () => {
    expect(tsToMs('2026-07-15 03:00:00.500')).toBe(Date.parse('2026-07-15T03:00:00.500Z'));
  });

  it('null / undefined / 空文字 / 不正値は 0 を返す', () => {
    expect(tsToMs(null)).toBe(0);
    expect(tsToMs(undefined)).toBe(0);
    expect(tsToMs('')).toBe(0);
    expect(tsToMs('not-a-date')).toBe(0);
  });
});
