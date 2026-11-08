export function formatDimensions(value) {
  if (typeof value !== 'string') return '';
  const match = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm\s*$/i.exec(value);
  if (!match) return value;
  const first = Number(match[1]) / 2.54;
  const second = Number(match[2]) / 2.54;
  if (!Number.isFinite(first) || !Number.isFinite(second) || first >= 1e21 || second >= 1e21) return value;
  return `${match[1]} × ${match[2]} cm / ${first.toFixed(2)} × ${second.toFixed(2)} in`;
}
