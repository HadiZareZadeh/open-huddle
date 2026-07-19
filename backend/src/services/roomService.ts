import { nanoid } from 'nanoid';
import { config } from '../config/index.js';
import * as meetingRepository from '../db/meetingRepository.js';
import { createMeetingId } from '../utils/meetingId.js';
import { logger } from '../utils/logger.js';
import type {
  AdmitResult,
  CreateMeetingOptions,
  JoinResult,
  MeetingRoom,
  PendingJoinRequest,
  PublicMeetingInfo,
  Participant,
} from '../types/meeting.js';

const REJOIN_GRACE_KEY = (displayName: string) => displayName.trim().toLowerCase();

class RoomService {
  private rooms = new Map<string, MeetingRoom>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveRooms();
    }, config.roomCleanupIntervalMs);
  }

  private cleanupInactiveRooms(): void {
    const now = Date.now();
    let removed = 0;

    for (const [id, room] of this.rooms) {
      this.expirePendingRequests(room, now);
      const inactive = now - room.lastActivity.getTime() > config.roomTtlMs;
      const empty = room.participants.size === 0 && room.pendingJoinRequests.size === 0;

      if (inactive || empty) {
        this.rooms.delete(id);
        removed++;
        logger.info({ roomId: id, inactive, empty }, 'Active session removed');
      }
    }

    const expired = meetingRepository.deleteExpiredMeetings(config.meetingLinkTtlMs);

    if (removed > 0 || expired > 0) {
      logger.info(
        { sessionsRemoved: removed, activeSessions: this.rooms.size, expiredLinks: expired },
        'Room cleanup completed',
      );
    }
  }

  private expirePendingRequests(room: MeetingRoom, now: number): void {
    for (const [requestId, request] of room.pendingJoinRequests) {
      if (now - request.requestedAt.getTime() > config.joinRequestTimeoutMs) {
        room.pendingJoinRequests.delete(requestId);
        room.pendingSocketIds.delete(request.socketId);
      }
    }
  }

  private toPublicInfo(
    stored: meetingRepository.StoredMeeting,
    participantCount: number,
    locked: boolean,
  ): PublicMeetingInfo {
    return {
      id: stored.id,
      requiresApproval: stored.requireApproval,
      locked,
      participantCount,
      maxParticipants: config.maxParticipants,
      expiresAt: meetingRepository
        .computeExpiresAt(stored.lastUsedAt, config.meetingLinkTtlMs)
        .toISOString(),
    };
  }

  private touchMeetingLink(id: string): meetingRepository.StoredMeeting | null {
    const stored = meetingRepository.getMeeting(id, config.meetingLinkTtlMs);
    if (!stored) {
      return null;
    }

    meetingRepository.touchMeeting(id);
    return {
      ...stored,
      lastUsedAt: new Date(),
    };
  }

  private createActiveSession(stored: meetingRepository.StoredMeeting): MeetingRoom {
    return {
      id: stored.id,
      requireApproval: stored.requireApproval,
      locked: false,
      participants: new Map(),
      pendingJoinRequests: new Map(),
      pendingSocketIds: new Map(),
      rejoinGraceUntil: new Map(),
      createdAt: stored.createdAt,
      lastActivity: new Date(),
      chatMessages: [],
    };
  }

  private getOrLoadRoom(id: string): MeetingRoom | undefined {
    const existing = this.rooms.get(id);
    if (existing) {
      return existing;
    }

    const stored = meetingRepository.getMeeting(id, config.meetingLinkTtlMs);
    if (!stored) {
      return undefined;
    }

    const room = this.createActiveSession(stored);
    this.rooms.set(id, room);
    logger.info({ roomId: id }, 'Meeting link restored from database');
    return room;
  }

  createRoom(options: CreateMeetingOptions = {}): MeetingRoom {
    const id = createMeetingId();
    const requireApproval = options.requireApproval ?? false;
    const now = new Date();

    meetingRepository.insertMeeting({
      id,
      requireApproval,
      createdAt: now,
      lastUsedAt: now,
    });

    const room = this.createActiveSession({
      id,
      requireApproval,
      createdAt: now,
      lastUsedAt: now,
    });

    this.rooms.set(id, room);
    logger.info({ roomId: id, requireApproval }, 'Room created');
    return room;
  }

  getRoom(id: string): MeetingRoom | undefined {
    return this.getOrLoadRoom(id);
  }

  getPublicInfo(id: string): PublicMeetingInfo | null {
    const activeRoom = this.rooms.get(id);
    const stored = this.touchMeetingLink(id);
    if (!stored) {
      return null;
    }

    return this.toPublicInfo(
      stored,
      activeRoom?.participants.size ?? 0,
      activeRoom?.locked ?? false,
    );
  }

  touchRoom(id: string): void {
    const room = this.getOrLoadRoom(id);
    if (room) {
      room.lastActivity = new Date();
      meetingRepository.touchMeeting(id);
    }
  }

  needsApproval(roomId: string, displayName: string): boolean {
    const room = this.getOrLoadRoom(roomId);
    if (!room?.requireApproval || room.participants.size === 0) {
      return false;
    }

    const graceUntil = room.rejoinGraceUntil.get(REJOIN_GRACE_KEY(displayName));
    return !(graceUntil && graceUntil > Date.now());
  }

  canJoin(roomId: string, socketId: string): JoinResult {
    const room = this.getOrLoadRoom(roomId);
    if (!room) {
      return { success: false, error: 'Meeting not found' };
    }

    if (room.participants.has(socketId)) {
      return { success: true };
    }

    if (room.locked) {
      return { success: false, error: 'Meeting is locked' };
    }

    if (room.participants.size + room.pendingJoinRequests.size >= config.maxParticipants) {
      return { success: false, error: 'Meeting is full' };
    }

    if (room.pendingSocketIds.has(socketId)) {
      const requestId = room.pendingSocketIds.get(socketId)!;
      return { success: true, pending: true, requestId };
    }

    return { success: true };
  }

  createJoinRequest(
    roomId: string,
    socketId: string,
    displayName: string,
  ): PendingJoinRequest | null {
    const room = this.getOrLoadRoom(roomId);
    if (!room) return null;

    const existingRequestId = room.pendingSocketIds.get(socketId);
    if (existingRequestId) {
      return room.pendingJoinRequests.get(existingRequestId) ?? null;
    }

    const request: PendingJoinRequest = {
      requestId: nanoid(12),
      socketId,
      displayName,
      requestedAt: new Date(),
    };

    room.pendingJoinRequests.set(request.requestId, request);
    room.pendingSocketIds.set(socketId, request.requestId);
    room.lastActivity = new Date();
    meetingRepository.touchMeeting(roomId);

    logger.info({ roomId, socketId, requestId: request.requestId, displayName }, 'Join request created');
    return request;
  }

  getPendingJoinRequests(roomId: string): PendingJoinRequest[] {
    const room = this.getOrLoadRoom(roomId);
    if (!room) return [];

    this.expirePendingRequests(room, Date.now());
    return [...room.pendingJoinRequests.values()];
  }

  removeJoinRequest(roomId: string, requestId: string): PendingJoinRequest | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const request = room.pendingJoinRequests.get(requestId);
    if (!request) return null;

    room.pendingJoinRequests.delete(requestId);
    room.pendingSocketIds.delete(request.socketId);
    room.lastActivity = new Date();
    return request;
  }

  removeJoinRequestBySocket(roomId: string, socketId: string): PendingJoinRequest | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const requestId = room.pendingSocketIds.get(socketId);
    if (!requestId) return null;

    return this.removeJoinRequest(roomId, requestId);
  }

  approveJoinRequest(roomId: string, requestId: string, hostSocketId: string): AdmitResult {
    const room = this.getOrLoadRoom(roomId);
    if (!room) {
      return { success: false, error: 'Meeting not found' };
    }

    if (!room.participants.get(hostSocketId)?.isHost) {
      return { success: false, error: 'Only host can approve join requests' };
    }

    const request = room.pendingJoinRequests.get(requestId);
    if (!request) {
      return { success: false, error: 'Join request not found' };
    }

    if (room.locked) {
      return { success: false, error: 'Meeting is locked' };
    }

    if (room.participants.size >= config.maxParticipants) {
      return { success: false, error: 'Meeting is full' };
    }

    this.removeJoinRequest(roomId, requestId);

    const participant = this.addParticipant(roomId, request.socketId, request.displayName);
    if (!participant) {
      return { success: false, error: 'Failed to admit participant' };
    }

    return { success: true, participant };
  }

  rejectJoinRequest(roomId: string, requestId: string, hostSocketId: string): AdmitResult {
    const room = this.getOrLoadRoom(roomId);
    if (!room) {
      return { success: false, error: 'Meeting not found' };
    }

    if (!room.participants.get(hostSocketId)?.isHost) {
      return { success: false, error: 'Only host can reject join requests' };
    }

    const request = this.removeJoinRequest(roomId, requestId);
    if (!request) {
      return { success: false, error: 'Join request not found' };
    }

    return { success: true, removedRequest: request };
  }

  addParticipant(roomId: string, socketId: string, displayName: string): Participant | null {
    const room = this.getOrLoadRoom(roomId);
    if (!room) return null;

    if (room.participants.has(socketId)) {
      return room.participants.get(socketId)!;
    }

    const isHost = room.participants.size === 0;

    const participant: Participant = {
      socketId,
      displayName,
      isHost,
      joinedAt: new Date(),
    };

    room.participants.set(socketId, participant);
    room.rejoinGraceUntil.delete(REJOIN_GRACE_KEY(displayName));
    room.lastActivity = new Date();
    meetingRepository.touchMeeting(roomId);

    logger.info({ roomId, socketId, displayName, isHost }, 'Participant joined');
    return participant;
  }

  removeParticipant(roomId: string, socketId: string): Participant | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const participant = room.participants.get(socketId);
    if (participant) {
      room.participants.delete(socketId);
      room.rejoinGraceUntil.set(
        REJOIN_GRACE_KEY(participant.displayName),
        Date.now() + config.rejoinGraceMs,
      );
      room.lastActivity = new Date();
      logger.info({ roomId, socketId }, 'Participant left');
    }

    return participant ?? null;
  }

  setLocked(roomId: string, locked: boolean, socketId: string): boolean {
    const room = this.getOrLoadRoom(roomId);
    if (!room) return false;

    const participant = room.participants.get(socketId);
    if (!participant?.isHost) {
      return false;
    }

    room.locked = locked;
    room.lastActivity = new Date();
    meetingRepository.touchMeeting(roomId);
    logger.info({ roomId, locked }, 'Room lock state changed');
    return true;
  }

  isHost(roomId: string, socketId: string): boolean {
    const room = this.getOrLoadRoom(roomId);
    if (!room) return false;
    return room.participants.get(socketId)?.isHost ?? false;
  }

  getHostSocketIds(roomId: string): string[] {
    const room = this.getOrLoadRoom(roomId);
    if (!room) return [];

    const hosts: string[] = [];
    for (const [socketId, participant] of room.participants) {
      if (participant.isHost) {
        hosts.push(socketId);
      }
    }
    return hosts;
  }

  getOtherParticipants(roomId: string, socketId: string): Participant[] {
    const room = this.getOrLoadRoom(roomId);
    if (!room) return [];

    const others: Participant[] = [];
    for (const [id, participant] of room.participants) {
      if (id !== socketId) others.push(participant);
    }
    return others;
  }

  findPendingMeetingForSocket(socketId: string): string | null {
    for (const [roomId, room] of this.rooms) {
      if (room.pendingSocketIds.has(socketId)) {
        return roomId;
      }
    }
    return null;
  }

  clearActiveSessions(): void {
    this.rooms.clear();
  }

  evictActiveSession(roomId: string): void {
    this.rooms.delete(roomId);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

export const roomService = new RoomService();
