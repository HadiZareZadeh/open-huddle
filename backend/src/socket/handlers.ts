import type { Server, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { roomService } from '../services/roomService.js';
import { chatMessageSchema } from '../middleware/schemas.js';
import { logger } from '../utils/logger.js';
import { isValidMeetingId } from '../utils/meetingId.js';
import { parseDisplayName } from '../utils/displayName.js';
import type { ChatMessage, Participant } from '../types/meeting.js';

interface JoinMeetingPayload {
  meetingId: string;
  displayName?: string;
}

interface SignalPayload {
  meetingId: string;
  to: string;
  signal: unknown;
}

interface RespondJoinRequestPayload {
  meetingId: string;
  requestId: string;
  approved: boolean;
}

const socketRooms = new Map<string, string>();

function sanitizeChatText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function participantPayload(participant: Participant) {
  return {
    displayName: participant.displayName,
    isHost: participant.isHost,
  };
}

async function admitParticipant(
  io: Server,
  socket: Socket,
  meetingId: string,
  participant: Participant,
) {
  socketRooms.set(socket.id, meetingId);
  await socket.join(meetingId);

  const room = roomService.getRoom(meetingId)!;
  const chatHistory = room.chatMessages.map((m) => ({
    ...m,
    timestamp: m.timestamp.toISOString(),
  }));

  socket.to(meetingId).emit('participant-joined', {
    socketId: socket.id,
    displayName: participant.displayName,
  });

  const others = roomService.getOtherParticipants(meetingId, socket.id);
  if (others.length > 0) {
    socket.emit('existing-participants', {
      participants: others.map((other) => ({
        socketId: other.socketId,
        displayName: other.displayName,
      })),
    });
  }

  return {
    participant: participantPayload(participant),
    chatHistory,
  };
}

export function setupSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, 'Socket connected');

    socket.on('join-meeting', async (payload: JoinMeetingPayload, callback) => {
      try {
        const { meetingId, displayName: rawDisplayName } = payload;

        if (!meetingId || !isValidMeetingId(meetingId)) {
          callback?.({ success: false, error: 'Invalid meeting ID' });
          return;
        }

        const displayNameResult = parseDisplayName(rawDisplayName);
        if (!displayNameResult.ok) {
          callback?.({ success: false, error: displayNameResult.error });
          return;
        }

        const joinResult = roomService.canJoin(meetingId, socket.id);
        if (!joinResult.success) {
          callback?.({ success: false, error: joinResult.error });
          return;
        }

        if (joinResult.pending) {
          callback?.({
            success: true,
            pending: true,
            requestId: joinResult.requestId,
          });
          return;
        }

        const room = roomService.getRoom(meetingId);
        if (room?.participants.has(socket.id)) {
          const participant = room.participants.get(socket.id)!;
          const admission = await admitParticipant(io, socket, meetingId, participant);
          callback?.({
            success: true,
            ...admission,
            pendingRequests: participant.isHost
              ? roomService.getPendingJoinRequests(meetingId).map((request) => ({
                  requestId: request.requestId,
                  socketId: request.socketId,
                  displayName: request.displayName,
                }))
              : undefined,
          });
          return;
        }

        if (roomService.needsApproval(meetingId, displayNameResult.value)) {
          const request = roomService.createJoinRequest(
            meetingId,
            socket.id,
            displayNameResult.value,
          );
          if (!request) {
            callback?.({ success: false, error: 'Failed to request join' });
            return;
          }

          for (const hostSocketId of roomService.getHostSocketIds(meetingId)) {
            io.to(hostSocketId).emit('join-request', {
              requestId: request.requestId,
              socketId: socket.id,
              displayName: request.displayName,
            });
          }

          callback?.({
            success: true,
            pending: true,
            requestId: request.requestId,
          });
          return;
        }

        const participant = roomService.addParticipant(
          meetingId,
          socket.id,
          displayNameResult.value,
        );
        if (!participant) {
          callback?.({ success: false, error: 'Failed to join meeting' });
          return;
        }

        const admission = await admitParticipant(io, socket, meetingId, participant);
        callback?.({
          success: true,
          ...admission,
          pendingRequests: participant.isHost
            ? roomService.getPendingJoinRequests(meetingId).map((request) => ({
                requestId: request.requestId,
                socketId: request.socketId,
                displayName: request.displayName,
              }))
            : undefined,
        });

        logger.info({ meetingId, socketId: socket.id }, 'Joined meeting via socket');
      } catch (err) {
        logger.error({ err, socketId: socket.id }, 'Join meeting error');
        callback?.({ success: false, error: 'Internal server error' });
      }
    });

    socket.on('respond-join-request', async (payload: RespondJoinRequestPayload, callback) => {
      try {
        const { meetingId, requestId, approved } = payload;
        if (!meetingId || !isValidMeetingId(meetingId) || !requestId) {
          callback?.({ success: false, error: 'Invalid request' });
          return;
        }

        const roomId = socketRooms.get(socket.id);
        if (roomId !== meetingId) {
          callback?.({ success: false, error: 'Not in meeting' });
          return;
        }

        if (approved) {
          const result = roomService.approveJoinRequest(meetingId, requestId, socket.id);
          if (!result.success || !result.participant) {
            callback?.({ success: false, error: result.error ?? 'Failed to approve request' });
            return;
          }

          const guestSocket = io.sockets.sockets.get(result.participant.socketId);
          if (!guestSocket) {
            roomService.removeParticipant(meetingId, result.participant.socketId);
            callback?.({ success: false, error: 'Guest is no longer connected' });
            return;
          }

          const admission = await admitParticipant(
            io,
            guestSocket,
            meetingId,
            result.participant,
          );

          guestSocket.emit('join-approved', { success: true, ...admission });
          io.to(meetingId).emit('join-request-resolved', { requestId, approved: true });
          callback?.({ success: true });
          return;
        }

        const result = roomService.rejectJoinRequest(meetingId, requestId, socket.id);
        if (!result.success) {
          callback?.({ success: false, error: result.error ?? 'Failed to reject request' });
          return;
        }

        if (result.removedRequest) {
          io.to(result.removedRequest.socketId).emit('join-denied', {
            reason: 'The host declined your request to join.',
          });
        }

        io.to(meetingId).emit('join-request-resolved', { requestId, approved: false });
        callback?.({ success: true });
      } catch (err) {
        logger.error({ err, socketId: socket.id }, 'Respond join request error');
        callback?.({ success: false, error: 'Internal server error' });
      }
    });

    socket.on('signal', (payload: SignalPayload) => {
      const { meetingId, to, signal } = payload;
      if (!meetingId || !isValidMeetingId(meetingId) || !to) return;

      const roomId = socketRooms.get(socket.id);
      if (roomId !== meetingId) return;

      const room = roomService.getRoom(meetingId);
      if (!room?.participants.has(socket.id) || !room.participants.has(to)) return;

      io.to(to).emit('signal', {
        from: socket.id,
        signal,
      });

      roomService.touchRoom(meetingId);
    });

    socket.on('chat-message', (payload: { meetingId: string; text: string }, callback) => {
      const roomId = socketRooms.get(socket.id);
      if (roomId !== payload.meetingId) {
        callback?.({ success: false, error: 'Not in meeting' });
        return;
      }

      const parsed = chatMessageSchema.safeParse({ text: payload.text });
      if (!parsed.success) {
        callback?.({ success: false, error: 'Invalid message' });
        return;
      }

      const room = roomService.getRoom(payload.meetingId);
      const participant = room?.participants.get(socket.id);
      if (!room || !participant) {
        callback?.({ success: false, error: 'Not in meeting' });
        return;
      }

      const message: ChatMessage = {
        id: nanoid(10),
        sender: participant.displayName,
        text: sanitizeChatText(parsed.data.text),
        timestamp: new Date(),
      };

      room.chatMessages.push(message);
      if (room.chatMessages.length > 200) {
        room.chatMessages.shift();
      }

      roomService.touchRoom(payload.meetingId);

      io.to(payload.meetingId).emit('chat-message', {
        ...message,
        timestamp: message.timestamp.toISOString(),
      });

      callback?.({ success: true });
    });

    socket.on('lock-meeting', (payload: { meetingId: string; locked: boolean }, callback) => {
      const roomId = socketRooms.get(socket.id);
      if (roomId !== payload.meetingId) {
        callback?.({ success: false, error: 'Not in meeting' });
        return;
      }

      if (!roomService.isHost(payload.meetingId, socket.id)) {
        callback?.({ success: false, error: 'Only host can lock meeting' });
        return;
      }

      const success = roomService.setLocked(payload.meetingId, payload.locked, socket.id);
      if (!success) {
        callback?.({ success: false, error: 'Failed to update lock state' });
        return;
      }

      io.to(payload.meetingId).emit('meeting-locked', { locked: payload.locked });
      callback?.({ success: true, locked: payload.locked });
    });

    socket.on('media-state', (payload: { meetingId: string; audio: boolean; video: boolean }) => {
      const roomId = socketRooms.get(socket.id);
      if (roomId !== payload.meetingId) return;

      const room = roomService.getRoom(payload.meetingId);
      if (!room?.participants.has(socket.id)) return;

      socket.to(payload.meetingId).emit('media-state', {
        from: socket.id,
        audio: payload.audio,
        video: payload.video,
      });
    });

    socket.on('leave-meeting', (payload: { meetingId: string }) => {
      handleDisconnect(io, socket, payload.meetingId);
    });

    socket.on('disconnect', () => {
      const meetingId = socketRooms.get(socket.id);
      if (meetingId) {
        handleDisconnect(io, socket, meetingId);
      } else {
        handlePendingDisconnect(io, socket);
      }
      logger.info({ socketId: socket.id }, 'Socket disconnected');
    });
  });
}

function handlePendingDisconnect(io: Server, socket: Socket): void {
  const meetingId = roomService.findPendingMeetingForSocket(socket.id);
  if (!meetingId) return;

  const request = roomService.removeJoinRequestBySocket(meetingId, socket.id);
  if (request) {
    io.to(meetingId).emit('join-request-cancelled', { requestId: request.requestId });
  }
}

function handleDisconnect(io: Server, socket: Socket, meetingId: string): void {
  const pending = roomService.removeJoinRequestBySocket(meetingId, socket.id);
  if (pending) {
    io.to(meetingId).emit('join-request-cancelled', { requestId: pending.requestId });
  }

  const participant = roomService.removeParticipant(meetingId, socket.id);
  socketRooms.delete(socket.id);
  socket.leave(meetingId);

  if (participant) {
    socket.to(meetingId).emit('participant-left', {
      socketId: socket.id,
      displayName: participant.displayName,
    });
  }
}
