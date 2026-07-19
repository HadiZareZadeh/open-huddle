import { getDatabase } from './index.js';

export interface StoredMeeting {
  id: string;
  requireApproval: boolean;
  createdAt: Date;
  lastUsedAt: Date;
}

interface MeetingRow {
  id: string;
  require_approval: number;
  created_at: number;
  last_used_at: number;
}

function mapRow(row: MeetingRow): StoredMeeting {
  return {
    id: row.id,
    requireApproval: row.require_approval === 1,
    createdAt: new Date(row.created_at),
    lastUsedAt: new Date(row.last_used_at),
  };
}

export function computeExpiresAt(lastUsedAt: Date, ttlMs: number): Date {
  return new Date(lastUsedAt.getTime() + ttlMs);
}

export function insertMeeting(meeting: StoredMeeting): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO meetings (id, require_approval, created_at, last_used_at)
     VALUES (@id, @requireApproval, @createdAt, @lastUsedAt)`,
  ).run({
    id: meeting.id,
    requireApproval: meeting.requireApproval ? 1 : 0,
    createdAt: meeting.createdAt.getTime(),
    lastUsedAt: meeting.lastUsedAt.getTime(),
  });
}

export function getMeeting(id: string, ttlMs: number): StoredMeeting | null {
  const db = getDatabase();
  const cutoff = Date.now() - ttlMs;
  const row = db
    .prepare(
      `SELECT id, require_approval, created_at, last_used_at
       FROM meetings
       WHERE id = ? AND last_used_at > ?`,
    )
    .get(id, cutoff) as MeetingRow | undefined;

  return row ? mapRow(row) : null;
}

export function touchMeeting(id: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare('UPDATE meetings SET last_used_at = ? WHERE id = ?')
    .run(Date.now(), id);

  return result.changes > 0;
}

export function deleteExpiredMeetings(ttlMs: number): number {
  const db = getDatabase();
  const cutoff = Date.now() - ttlMs;
  const result = db
    .prepare('DELETE FROM meetings WHERE last_used_at <= ?')
    .run(cutoff);

  return result.changes;
}
