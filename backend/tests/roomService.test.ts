import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase, resetDatabase } from '../src/db/index.js';
import { roomService } from '../src/services/roomService.js';

describe('RoomService', () => {
  beforeEach(() => {
    resetDatabase();
    roomService.clearActiveSessions();
  });

  it('creates a room with unique id', async () => {
    const room1 = roomService.createRoom();
    const room2 = roomService.createRoom();
    expect(room1.id).not.toBe(room2.id);
    expect(room1.id).toMatch(/^[0-9A-Za-z]{12}$/);
  });

  it('stores requireApproval on create', () => {
    const room = roomService.createRoom({ requireApproval: true });
    expect(room.requireApproval).toBe(true);
  });

  it('allows joining when room is not locked', () => {
    const room = roomService.createRoom();
    const result = roomService.canJoin(room.id, 'socket-1');
    expect(result.success).toBe(true);
  });

  it('prevents joining when room is locked', () => {
    const room = roomService.createRoom();
    roomService.addParticipant(room.id, 'host-socket', 'Host');
    roomService.setLocked(room.id, true, 'host-socket');

    const result = roomService.canJoin(room.id, 'new-socket');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Meeting is locked');
  });

  it('prevents joining when room is full', () => {
    const room = roomService.createRoom();
    for (let i = 1; i <= 8; i++) {
      roomService.addParticipant(room.id, `socket-${i}`, `User ${i}`);
    }

    const result = roomService.canJoin(room.id, 'socket-9');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Meeting is full');
  });

  it('only host can lock meeting', () => {
    const room = roomService.createRoom();
    roomService.addParticipant(room.id, 'host-socket', 'Host');
    roomService.addParticipant(room.id, 'guest-socket', 'Guest');

    const hostLock = roomService.setLocked(room.id, true, 'host-socket');
    expect(hostLock).toBe(true);

    roomService.setLocked(room.id, false, 'host-socket');

    const guestLock = roomService.setLocked(room.id, true, 'guest-socket');
    expect(guestLock).toBe(false);
  });

  it('assigns display names and host to first joiner', () => {
    const room = roomService.createRoom();
    const p1 = roomService.addParticipant(room.id, 'socket-1', 'Alice');
    const p2 = roomService.addParticipant(room.id, 'socket-2', 'Bob');
    const p3 = roomService.addParticipant(room.id, 'socket-3', 'Carol');

    expect(p1?.displayName).toBe('Alice');
    expect(p1?.isHost).toBe(true);
    expect(p2?.displayName).toBe('Bob');
    expect(p2?.isHost).toBe(false);
    expect(p3?.displayName).toBe('Carol');
    expect(p3?.isHost).toBe(false);
  });

  it('requires approval when enabled and host is present', () => {
    const room = roomService.createRoom({ requireApproval: true });
    roomService.addParticipant(room.id, 'host-socket', 'Host');

    expect(roomService.needsApproval(room.id, 'Guest')).toBe(true);
  });

  it('does not require approval for first joiner', () => {
    const room = roomService.createRoom({ requireApproval: true });
    expect(roomService.needsApproval(room.id, 'Host')).toBe(false);
  });

  it('creates and resolves join requests', () => {
    const room = roomService.createRoom({ requireApproval: true });
    roomService.addParticipant(room.id, 'host-socket', 'Host');

    const request = roomService.createJoinRequest(room.id, 'guest-socket', 'Guest');
    expect(request?.displayName).toBe('Guest');

    const approved = roomService.approveJoinRequest(room.id, request!.requestId, 'host-socket');
    expect(approved.success).toBe(true);
    expect(approved.participant?.displayName).toBe('Guest');
  });

  it('rejects join requests', () => {
    const room = roomService.createRoom({ requireApproval: true });
    roomService.addParticipant(room.id, 'host-socket', 'Host');

    const request = roomService.createJoinRequest(room.id, 'guest-socket', 'Guest');
    const rejected = roomService.rejectJoinRequest(room.id, request!.requestId, 'host-socket');

    expect(rejected.success).toBe(true);
    expect(rejected.removedRequest?.socketId).toBe('guest-socket');
    expect(roomService.getPendingJoinRequests(room.id)).toHaveLength(0);
  });

  it('keeps meeting link after all participants leave', () => {
    const room = roomService.createRoom();
    roomService.addParticipant(room.id, 'socket-1', 'One');
    roomService.addParticipant(room.id, 'socket-2', 'Two');
    roomService.removeParticipant(room.id, 'socket-1');
    roomService.removeParticipant(room.id, 'socket-2');
    roomService.evictActiveSession(room.id);

    const info = roomService.getPublicInfo(room.id);
    expect(info).not.toBeNull();
    expect(info?.participantCount).toBe(0);
    expect(info?.expiresAt).toBeTruthy();
  });

  it('restores meeting from database when link is reused', () => {
    const room = roomService.createRoom({ requireApproval: true });
    roomService.evictActiveSession(room.id);

    const joinResult = roomService.canJoin(room.id, 'socket-new');
    expect(joinResult.success).toBe(true);
    expect(roomService.getRoom(room.id)?.requireApproval).toBe(true);
  });

  it('expires links 7 days after last use', () => {
    const room = roomService.createRoom();
    roomService.evictActiveSession(room.id);

    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    getDatabase()
      .prepare('UPDATE meetings SET last_used_at = ? WHERE id = ?')
      .run(eightDaysAgo, room.id);

    expect(roomService.getPublicInfo(room.id)).toBeNull();
  });

  it('extends link expiry when the meeting is accessed', () => {
    const room = roomService.createRoom();
    roomService.evictActiveSession(room.id);

    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
    getDatabase()
      .prepare('UPDATE meetings SET last_used_at = ? WHERE id = ?')
      .run(sixDaysAgo, room.id);

    const info = roomService.getPublicInfo(room.id);
    expect(info).not.toBeNull();

    const expiresAt = new Date(info!.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  });
});
