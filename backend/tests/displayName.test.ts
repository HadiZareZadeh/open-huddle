import { describe, it, expect } from 'vitest';
import { parseDisplayName, sanitizeDisplayName } from '../src/utils/displayName.js';

describe('displayName utils', () => {
  it('sanitizes HTML characters', () => {
    expect(sanitizeDisplayName('<script>')).toBe('&lt;script&gt;');
  });

  it('accepts valid display names', () => {
    const result = parseDisplayName('  Alice  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('Alice');
    }
  });

  it('rejects empty names', () => {
    const result = parseDisplayName('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects names that are too long', () => {
    const result = parseDisplayName('a'.repeat(33));
    expect(result.ok).toBe(false);
  });
});
