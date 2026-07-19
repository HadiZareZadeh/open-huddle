import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import express from 'express';
import { resetDatabase } from '../src/db/index.js';
import { roomService } from '../src/services/roomService.js';
import { setupSocketHandlers } from '../src/socket/handlers.js';

describe('Socket.IO handlers', () => {
  let httpServer: HttpServer;
  let io: Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    httpServer = createServer(app);
    io = new Server(httpServer, { cors: { origin: '*' } });
    setupSocketHandlers(io);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  beforeEach(() => {
    resetDatabase();
    roomService.clearActiveSessions();
  });

  function connectClient(): ClientSocket {
    return ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    });
  }

  it('allows a participant to join a meeting', async () => {
    const room = roomService.createRoom();
    const client = connectClient();

    await new Promise<void>((resolve) => {
      client.on('connect', resolve);
    });

    const result = await new Promise<{ success: boolean; participant?: { displayName: string } }>(
      (resolve) => {
        client.emit('join-meeting', { meetingId: room.id, displayName: 'Tester' }, resolve);
      },
    );

    expect(result.success).toBe(true);
    expect(result.participant?.displayName).toBe('Tester');
    client.disconnect();
  });

  it('rejects join when meeting is locked', async () => {
    const room = roomService.createRoom();
    const host = connectClient();
    await new Promise<void>((resolve) => host.on('connect', resolve));

    await new Promise<void>((resolve) => {
      host.emit('join-meeting', { meetingId: room.id, displayName: 'Host' }, () => resolve());
    });

    await new Promise<void>((resolve) => {
      host.emit('lock-meeting', { meetingId: room.id, locked: true }, () => resolve());
    });

    const guest = connectClient();
    await new Promise<void>((resolve) => guest.on('connect', resolve));

    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      guest.emit('join-meeting', { meetingId: room.id, displayName: 'Guest' }, resolve);
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Meeting is locked');

    host.disconnect();
    guest.disconnect();
  });

  it('requires host approval when enabled', async () => {
    const room = roomService.createRoom({ requireApproval: true });
    const host = connectClient();
    const guest = connectClient();

    await Promise.all([
      new Promise<void>((resolve) => host.on('connect', resolve)),
      new Promise<void>((resolve) => guest.on('connect', resolve)),
    ]);

    await new Promise<void>((resolve) => {
      host.emit('join-meeting', { meetingId: room.id, displayName: 'Host' }, () => resolve());
    });

    const joinRequestPromise = new Promise<{ requestId: string; displayName: string }>((resolve) => {
      host.on('join-request', resolve);
    });

    const guestResult = await new Promise<{ success: boolean; pending?: boolean; requestId?: string }>(
      (resolve) => {
        guest.emit('join-meeting', { meetingId: room.id, displayName: 'Guest' }, resolve);
      },
    );

    expect(guestResult.success).toBe(true);
    expect(guestResult.pending).toBe(true);

    const joinRequest = await joinRequestPromise;
    expect(joinRequest.displayName).toBe('Guest');

    const approvedPromise = new Promise<{ success: boolean; participant?: { displayName: string } }>(
      (resolve) => {
        guest.on('join-approved', resolve);
      },
    );

    await new Promise<void>((resolve) => {
      host.emit(
        'respond-join-request',
        { meetingId: room.id, requestId: joinRequest.requestId, approved: true },
        () => resolve(),
      );
    });

    const approved = await approvedPromise;
    expect(approved.success).toBe(true);
    expect(approved.participant?.displayName).toBe('Guest');

    host.disconnect();
    guest.disconnect();
  });

  it('broadcasts chat messages to room', async () => {
    const room = roomService.createRoom();
    const client = connectClient();
    await new Promise<void>((resolve) => client.on('connect', resolve));

    await new Promise<void>((resolve) => {
      client.emit('join-meeting', { meetingId: room.id, displayName: 'Chatter' }, () => resolve());
    });

    const received = new Promise<{ text: string }>((resolve) => {
      client.on('chat-message', resolve);
    });

    await new Promise<{ success: boolean }>((resolve) => {
      client.emit('chat-message', { meetingId: room.id, text: 'Hello!' }, resolve);
    });

    const message = await received;
    expect(message.text).toBe('Hello!');

    client.disconnect();
  });
});
