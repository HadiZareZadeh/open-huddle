export interface Participant {
  socketId: string;
  displayName: string;
  isHost: boolean;
  joinedAt: Date;
}

export interface PendingJoinRequest {
  requestId: string;
  socketId: string;
  displayName: string;
  requestedAt: Date;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
}

export interface MeetingRoom {
  id: string;
  requireApproval: boolean;
  locked: boolean;
  participants: Map<string, Participant>;
  pendingJoinRequests: Map<string, PendingJoinRequest>;
  pendingSocketIds: Map<string, string>;
  rejoinGraceUntil: Map<string, number>;
  createdAt: Date;
  lastActivity: Date;
  chatMessages: ChatMessage[];
}

export interface PublicMeetingInfo {
  id: string;
  requiresApproval: boolean;
  locked: boolean;
  participantCount: number;
  maxParticipants: number;
  expiresAt: string;
}

export interface CreateMeetingOptions {
  requireApproval?: boolean;
}

export interface JoinResult {
  success: boolean;
  error?: string;
  pending?: boolean;
  requestId?: string;
}

export interface AdmitResult {
  success: boolean;
  error?: string;
  participant?: Participant;
  removedRequest?: PendingJoinRequest;
}
