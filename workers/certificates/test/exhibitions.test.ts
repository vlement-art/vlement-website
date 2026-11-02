import { describe, expect, it } from 'vitest';
import {
  formatExhibitionDates,
  getExhibitionGroups,
  getExhibitionStatus,
  validateExhibition,
} from '../../../src/data/exhibitions';

const exhibition = {
  title: 'The Artists Among Us',
  venue: "Sotheby's, London",
  startDate: '2026-08-17',
  endDate: '2026-08-28',
  url: 'https://example.com/exhibition',
};

describe('exhibition dates', () => {
  it('classifies exhibitions before, during, and after their date range', () => {
    expect(getExhibitionStatus(exhibition, '2026-08-16')).toBe('upcoming');
    expect(getExhibitionStatus(exhibition, '2026-08-17')).toBe('current');
    expect(getExhibitionStatus(exhibition, '2026-08-28')).toBe('current');
    expect(getExhibitionStatus(exhibition, '2026-08-29')).toBe('past');
  });

  it('sorts upcoming exhibitions earliest first and past exhibitions most recent first', () => {
    const groups = getExhibitionGroups([
      { ...exhibition, title: 'Later', startDate: '2027-01-01', endDate: '2027-01-02' },
      { ...exhibition, title: 'Older past', startDate: '2025-01-01', endDate: '2025-01-02' },
      { ...exhibition, title: 'Sooner', startDate: '2026-12-01', endDate: '2026-12-02' },
      { ...exhibition, title: 'Recent past', startDate: '2026-01-01', endDate: '2026-01-02' },
      exhibition,
    ], '2026-11-02');

    expect(groups.upcoming.map(item => item.title)).toEqual(['Sooner', 'Later']);
    expect(groups.current).toEqual([]);
    expect(groups.past.map(item => item.title)).toEqual(['The Artists Among Us', 'Recent past', 'Older past']);
  });

  it('formats a single date and a date range clearly', () => {
    expect(formatExhibitionDates({
      ...exhibition,
      startDate: '2026-08-17',
      endDate: '2026-08-17',
    })).toBe('17 August 2026');
    expect(formatExhibitionDates(exhibition)).toBe('17 August 2026–28 August 2026');
  });

  it('rejects invalid dates, reversed ranges, and non-web URLs', () => {
    expect(() => validateExhibition({ ...exhibition, startDate: '2026-02-30' }))
      .toThrow('valid calendar dates');
    expect(() => validateExhibition({
      ...exhibition,
      startDate: '2026-08-29',
      endDate: '2026-08-28',
    })).toThrow('end date cannot be before');
    expect(() => validateExhibition({ ...exhibition, url: 'javascript:alert(1)' }))
      .toThrow('HTTP or HTTPS');
  });
});
