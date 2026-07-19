import { io, Socket } from 'socket.io-client';
import type { ChatMessage, JoinMeetingResult, JoinRequest } from '@/types';

export type SocketConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface MeetingSession {
  meetingId: string;
  displayName: string;
}

let socket: Socket | null = null;
let meetingSession: MeetingSession | null = null;
let hasActiveMeeting = false;
let isIntentionalDisconnect = false;
let reconnectAttempt = 0;

const connectionListeners = new Set<(state: SocketConnectionState) => void>();
const rejoinListeners = new Set<(result: JoinMeetingResult) => void>();

function notifyConnection(state: SocketConnectionState): void {
  connectionListeners.forEach((listener) => listener(state));
}

function notifyRejoin(result: JoinMeetingResult): void {
  rejoinListeners.forEach((listener) => listener(result));
}

async function attemptMeetingRejoin(): Promise<void> {
  if (!meetingSession || !hasActiveMeeting || !socket?.connected) return;

  notifyConnection('reconnecting');

  const result = await new Promise<JoinMeetingResult>((resolve) => {
    socket!.emit(
      'join-meeting',
      {
        meetingId: meetingSession!.meetingId,
        displayName: meetingSession!.displayName,
      },
      resolve,
    );
  });

  if (result.success && !result.pending) {
    reconnectAttempt = 0;
    notifyConnection('connected');
  } else if (!result.success) {
    notifyConnection('disconnected');
  }

  notifyRejoin(result);
}

function attachSocketHandlers(instance: Socket): void {
  instance.io.on('reconnect_attempt', (attempt) => {
    reconnectAttempt = attempt;
    notifyConnection('reconnecting');
  });

  instance.io.on('reconnect_failed', () => {
    notifyConnection('disconnected');
  });

  instance.on('connect', () => {
    if (hasActiveMeeting && reconnectAttempt > 0) {
      void attemptMeetingRejoin();
      return;
    }
    notifyConnection('connected');
  });

  instance.on('disconnect', (reason) => {
    if (isIntentionalDisconnect) return;

    if (reason === 'io server disconnect') {
      instance.connect();
    }

    if (hasActiveMeeting) {
      notifyConnection('reconnecting');
    } else {
      notifyConnection('disconnected');
    }
  });
}

function getSocketUrl(): string | undefined {
  const configured = import.meta.env.VITE_SOCKET_URL;
  if (configured) return configured;

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const { hostname } = window.location;
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLoopback) {
      const backendPort = import.meta.env.VITE_BACKEND_PORT ?? '3001';
      return `http://${hostname}:${backendPort}`;
    }
  }

  return undefined;
}

export function getSocket(): Socket {
  if (!socket) {
    const url = getSocketUrl();
    socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      withCredentials: true,
    });
    attachSocketHandlers(socket);
  }
  return socket;
}

export function setMeetingSession(session: MeetingSession | null, active = false): void {
  meetingSession = session;
  hasActiveMeeting = active;
}

export function clearMeetingSession(): void {
  meetingSession = null;
  hasActiveMeeting = false;
  reconnectAttempt = 0;
}

export function disconnectSocket(): void {
  if (socket) {
    isIntentionalDisconnect = true;
    socket.disconnect();
    socket = null;
    isIntentionalDisconnect = false;
  }
  clearMeetingSession();
  notifyConnection('disconnected');
}

export function onConnectionStateChange(
  callback: (state: SocketConnectionState) => void,
): () => void {
  connectionListeners.add(callback);
  return () => connectionListeners.delete(callback);
}

export function onMeetingRejoin(callback: (result: JoinMeetingResult) => void): () => void {
  rejoinListeners.add(callback);
  return () => rejoinListeners.delete(callback);
}

export function joinMeeting(
  meetingId: string,
  options: { displayName: string },
): Promise<JoinMeetingResult> {
  setMeetingSession({ meetingId, displayName: options.displayName }, false);

  return new Promise((resolve) => {
    const s = getSocket();
    s.emit(
      'join-meeting',
      {
        meetingId,
        displayName: options.displayName,
      },
      (result: JoinMeetingResult) => {
        if (result.success && !result.pending) {
          setMeetingSession({ meetingId, displayName: options.displayName }, true);
          notifyConnection('connected');
        }
        resolve(result);
      },
    );
  });
}

export function leaveMeeting(meetingId: string): void {
  getSocket().emit('leave-meeting', { meetingId });
  clearMeetingSession();
}

export function respondToJoinRequest(
  meetingId: string,
  requestId: string,
  approved: boolean,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    getSocket().emit(
      'respond-join-request',
      { meetingId, requestId, approved },
      resolve,
    );
  });
}

export function onJoinRequest(callback: (request: JoinRequest) => void): () => void {
  const s = getSocket();
  s.on('join-request', callback);
  return () => s.off('join-request', callback);
}

export function onJoinRequestCancelled(
  callback: (data: { requestId: string }) => void,
): () => void {
  const s = getSocket();
  s.on('join-request-cancelled', callback);
  return () => s.off('join-request-cancelled', callback);
}

export function onJoinRequestResolved(
  callback: (data: { requestId: string; approved: boolean }) => void,
): () => void {
  const s = getSocket();
  s.on('join-request-resolved', callback);
  return () => s.off('join-request-resolved', callback);
}

export function onJoinApproved(
  callback: (result: JoinMeetingResult) => void,
): () => void {
  const s = getSocket();
  s.on('join-approved', (result: JoinMeetingResult) => {
    if (meetingSession) {
      setMeetingSession(meetingSession, true);
      notifyConnection('connected');
    }
    callback(result);
  });
  return () => s.off('join-approved', callback);
}

export function onJoinDenied(
  callback: (data: { reason?: string }) => void,
): () => void {
  const s = getSocket();
  s.on('join-denied', callback);
  return () => s.off('join-denied', callback);
}

export function sendSignal(meetingId: string, signal: unknown, to: string): void {
  getSocket().emit('signal', { meetingId, signal, to });
}

export function onSignal(callback: (data: { from: string; signal: unknown }) => void): () => void {
  const s = getSocket();
  s.on('signal', callback);
  return () => s.off('signal', callback);
}

export function onParticipantJoined(
  callback: (data: { socketId: string; displayName: string }) => void,
): () => void {
  const s = getSocket();
  s.on('participant-joined', callback);
  return () => s.off('participant-joined', callback);
}

export function onExistingParticipants(
  callback: (data: { participants: { socketId: string; displayName: string }[] }) => void,
): () => void {
  const s = getSocket();
  s.on('existing-participants', callback);
  return () => s.off('existing-participants', callback);
}

export function onParticipantLeft(
  callback: (data: { socketId: string; displayName: string }) => void,
): () => void {
  const s = getSocket();
  s.on('participant-left', callback);
  return () => s.off('participant-left', callback);
}

export function sendChatMessage(
  meetingId: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    getSocket().emit('chat-message', { meetingId, text }, resolve);
  });
}

export function onChatMessage(callback: (message: ChatMessage) => void): () => void {
  const s = getSocket();
  s.on('chat-message', callback);
  return () => s.off('chat-message', callback);
}

export function setMeetingLocked(
  meetingId: string,
  locked: boolean,
): Promise<{ success: boolean; error?: string; locked?: boolean }> {
  return new Promise((resolve) => {
    getSocket().emit('lock-meeting', { meetingId, locked }, resolve);
  });
}

export function onMeetingLocked(callback: (data: { locked: boolean }) => void): () => void {
  const s = getSocket();
  s.on('meeting-locked', callback);
  return () => s.off('meeting-locked', callback);
}

export function sendMediaState(
  meetingId: string,
  audio: boolean,
  video: boolean,
): void {
  getSocket().emit('media-state', { meetingId, audio, video });
}

export function onMediaState(
  callback: (data: { from: string; audio: boolean; video: boolean }) => void,
): () => void {
  const s = getSocket();
  s.on('media-state', callback);
  return () => s.off('media-state', callback);
}

export function onSocketConnect(callback: () => void): () => void {
  const s = getSocket();
  s.on('connect', callback);
  return () => s.off('connect', callback);
}

export function onSocketDisconnect(callback: (reason: string) => void): () => void {
  const s = getSocket();
  s.on('disconnect', callback);
  return () => s.off('disconnect', callback);
}
