import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

function parseIceServersOverride(): IceServerConfig[] | null {
  const raw = process.env.ICE_SERVERS?.trim();
  if (!raw) {
    return null;
  }
  try {
    return z.array(iceServerSchema).parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function resolveTurnHost(): string {
  return (
    process.env.TURN_HOST?.trim() ||
    process.env.DOMAIN?.trim() ||
    'localhost'
  );
}

const turnSecret = process.env.TURN_SECRET?.trim() ?? '';

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10),
  rateLimitMax: parseInt(
    process.env.RATE_LIMIT_MAX ??
      (process.env.NODE_ENV === 'production' ? '100' : '0'),
    10,
  ),
  roomTtlMs: parseInt(process.env.ROOM_TTL_MS ?? '3600000', 10),
  roomCleanupIntervalMs: parseInt(process.env.ROOM_CLEANUP_INTERVAL_MS ?? '300000', 10),
  meetingLinkTtlMs: parseInt(
    process.env.MEETING_LINK_TTL_MS ?? String(7 * 24 * 60 * 60 * 1000),
    10,
  ),
  joinRequestTimeoutMs: parseInt(process.env.JOIN_REQUEST_TIMEOUT_MS ?? '120000', 10),
  rejoinGraceMs: parseInt(process.env.REJOIN_GRACE_MS ?? '30000', 10),
  databasePath: process.env.DATABASE_PATH ?? './data/meetings.db',
  maxParticipants: parseInt(process.env.MAX_PARTICIPANTS ?? '8', 10),
  requireHostApproval: ['1', 'true', 'yes'].includes(
    (process.env.REQUIRE_HOST_APPROVAL ?? '').trim().toLowerCase(),
  ),
  iceServersOverride: parseIceServersOverride(),
  turn: {
    enabled: turnSecret.length > 0,
    host: resolveTurnHost(),
    port: parseInt(process.env.TURN_PORT ?? '3478', 10),
    tlsPort: parseInt(process.env.TURN_TLS_PORT ?? '5349', 10),
    secret: turnSecret,
    realm: process.env.TURN_REALM?.trim() ?? 'video-call.local',
    username: process.env.TURN_USERNAME?.trim() ?? 'video-call',
    credentialTtlSec: parseInt(process.env.TURN_CREDENTIAL_TTL_SEC ?? '86400', 10),
    externalIp: process.env.TURN_EXTERNAL_IP?.trim() || undefined,
  },
  logLevel: process.env.LOG_LEVEL ?? 'info',
  frontendDist: process.env.FRONTEND_DIST ?? '../frontend/dist',
  isProduction: process.env.NODE_ENV === 'production',
} as const;

export type AppConfig = typeof config;
