export interface MeetingInfo {
  id: string;
  requiresApproval: boolean;
  locked: boolean;
  participantCount: number;
  maxParticipants: number;
}

export interface CreateMeetingResponse {
  id: string;
  url: string;
  requiresApproval: boolean;
}

export interface ParticipantInfo {
  displayName: string;
  isHost: boolean;
}

export interface RemoteParticipant {
  socketId: string;
  displayName: string;
  stream: MediaStream | null;
}

export interface JoinRequest {
  requestId: string;
  socketId: string;
  displayName: string;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
}

export interface JoinMeetingResult {
  success: boolean;
  error?: string;
  pending?: boolean;
  requestId?: string;
  participant?: ParticipantInfo;
  chatHistory?: ChatMessage[];
  pendingRequests?: JoinRequest[];
}

export type MeetingPhase =
  | 'loading'
  | 'prejoin'
  | 'waiting'
  | 'connecting'
  | 'incall'
  | 'ended'
  | 'error';

export interface MediaDevices {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export interface DeviceSelection {
  cameraId: string;
  microphoneId: string;
  speakerId: string;
}

export type BackgroundEffect = 'none' | 'blur';
