import { customAlphabet } from 'nanoid';

// URL-safe alphabet, 12 chars = ~71 bits of entropy
const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  12,
);

export function createMeetingId(): string {
  return generateId();
}

export function isValidMeetingId(id: string): boolean {
  return /^[0-9A-Za-z]{12}$/.test(id);
}
