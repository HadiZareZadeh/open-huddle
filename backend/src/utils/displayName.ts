const MIN_LENGTH = 1;
const MAX_LENGTH = 32;

export function sanitizeDisplayName(raw: string): string {
  return raw
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function parseDisplayName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Display name is required' };
  }

  const trimmed = raw.trim();
  if (trimmed.length < MIN_LENGTH) {
    return { ok: false, error: 'Display name is required' };
  }

  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: `Display name must be at most ${MAX_LENGTH} characters` };
  }

  return { ok: true, value: sanitizeDisplayName(trimmed) };
}
