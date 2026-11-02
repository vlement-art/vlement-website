export interface Exhibition {
  title: string;
  venue: string;
  startDate: string;
  endDate: string;
  url?: string;
}

export type ExhibitionStatus = 'upcoming' | 'current' | 'past';

export interface ExhibitionGroups {
  upcoming: Exhibition[];
  current: Exhibition[];
  past: Exhibition[];
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateExhibition(exhibition: Exhibition): void {
  if (!exhibition.title.trim()) throw new Error('Exhibition title is required.');
  if (!exhibition.venue.trim()) throw new Error('Exhibition venue is required.');
  if (!isCalendarDate(exhibition.startDate) || !isCalendarDate(exhibition.endDate)) {
    throw new Error('Exhibition dates must be valid calendar dates.');
  }
  if (exhibition.endDate < exhibition.startDate) {
    throw new Error('The exhibition end date cannot be before its start date.');
  }
  if (exhibition.url) {
    let url: URL;
    try {
      url = new URL(exhibition.url);
    } catch {
      throw new Error('Exhibition link must be a valid HTTP or HTTPS URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Exhibition link must be a valid HTTP or HTTPS URL.');
    }
  }
}

export function getExhibitionStatus(
  exhibition: Exhibition,
  today = new Date().toISOString().slice(0, 10),
): ExhibitionStatus {
  if (exhibition.startDate > today) return 'upcoming';
  if (exhibition.endDate < today) return 'past';
  return 'current';
}

export function getExhibitionGroups(
  exhibitions: Exhibition[],
  today = new Date().toISOString().slice(0, 10),
): ExhibitionGroups {
  const groups: ExhibitionGroups = { upcoming: [], current: [], past: [] };
  for (const exhibition of exhibitions) {
    validateExhibition(exhibition);
    groups[getExhibitionStatus(exhibition, today)].push(exhibition);
  }
  groups.upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  groups.current.sort((a, b) => a.startDate.localeCompare(b.startDate));
  groups.past.sort((a, b) => b.endDate.localeCompare(a.endDate));
  return groups;
}

export function formatExhibitionDates(exhibition: Exhibition): string {
  const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));
  const start = formatDate(exhibition.startDate);
  return exhibition.startDate === exhibition.endDate
    ? start
    : `${start}–${formatDate(exhibition.endDate)}`;
}
