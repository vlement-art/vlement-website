import { marked } from 'marked';

const artist = 'Vlement J. Rodrigues';

function artworkKind(data) {
  const category = (data.category || '').trim().toLowerCase();
  if (data.editionType === 'limited' || data.editionType === 'open') return data.editionType;
  if (category === 'print') {
    if (/\blimited edition\b/i.test(data.edition || '')) return 'limited';
    if (/\bopen edition\b/i.test(data.edition || '')) return 'open';
    return null;
  }
  if (data.editionType === 'original' || ['original painting', 'drawing', 'mixed media', 'collage'].includes(category)) {
    return category === 'original painting' ? 'painting' : 'original';
  }
  return null;
}

function nameAndYear(data) {
  return `${data.title}${data.year ? ` (${data.year})` : ''}`;
}

export function artworkTitle(data) {
  const name = nameAndYear(data);
  const fallback = `${name} — ${artist}`;
  const kind = artworkKind(data);
  const label = { painting: 'Original Painting', original: 'Original Artwork', limited: 'Limited Edition Print', open: 'Open Edition Print' }[kind];
  if (!label) return fallback;
  const full = `${name} | ${label} by ${artist}`;
  if (full.length <= 65) return full;
  const short = `${name} | ${label} by Vlement`;
  return short.length <= 65 ? short : fallback;
}

function firstSentence(body) {
  const paragraph = marked.lexer(body || '').find(token => token.type === 'paragraph');
  if (!paragraph) return '';
  const text = paragraph.text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>|[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  return text.match(/^.*?[.!?](?=\s|$)/)?.[0] || text;
}

function truncateWords(text, limit) {
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit + 1);
  const boundary = prefix.search(/\s+\S*$/);
  return (boundary < 0 ? '' : prefix.slice(0, boundary)).replace(/[,\s]+$/, '');
}

export function artworkDescription(data, body) {
  if (data.seoDescription?.trim()) return data.seoDescription.trim();
  const kind = artworkKind(data);
  const category = (data.category || '').trim().toLowerCase();
  let label = category;
  if (kind === 'limited') {
    const size = Number.isInteger(data.editionSize) && data.editionSize > 0
      ? data.editionSize : data.edition?.match(/\bedition\s+of\s+(\d+)\b/i)?.[1];
    label = `limited edition print${size ? ` (edition of ${size})` : ''}`;
  } else if (kind === 'open') label = 'open edition print';
  else if (kind === 'original' && category && !category.startsWith('original')) label = `original ${category}`;

  const name = nameAndYear(data);
  const introduction = [name, label ? `${label} by London artist ${artist}` : `by London artist ${artist}`].filter(Boolean).join(', ');
  let medium = (data.medium || '').trim();
  if (kind === 'limited' || kind === 'open' || category === 'print') medium = medium.replace(/^print\s*-\s*/i, '');
  const dimensions = (data.dimensions || '').trim();
  const cm = dimensions.match(/^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm\b/i);
  const details = [medium, cm ? `${cm[1]} × ${cm[2]} cm` : dimensions].filter(Boolean).join(', ');
  const status = typeof data.available === 'boolean' ? (data.available ? 'Available' : 'Sold') : '';
  const base = [introduction, details, status].filter(Boolean).map(part => part.replace(/[.\s]+$/, '')).join('. ') + '.';
  const sentence = firstSentence(body);
  return truncateWords(sentence && `${base} ${sentence}`.length <= 155 ? `${base} ${sentence}` : base, 155);
}
