const STORAGE_KEY = 'video-call:last-display-name';

export function getStoredDisplayName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setStoredDisplayName(displayName: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, displayName.trim());
  } catch {
    // Ignore quota or privacy mode errors
  }
}
