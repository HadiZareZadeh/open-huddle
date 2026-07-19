import crypto from 'crypto';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

function readIceServersOverride(): IceServerConfig[] | null {
  const raw = process.env.ICE_SERVERS?.trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed as IceServerConfig[];
  } catch {
    return null;
  }
}

function readTurnSettings() {
  const secret = process.env.TURN_SECRET?.trim() ?? '';
  return {
    enabled: secret.length > 0,
    host:
      process.env.TURN_HOST?.trim() ||
      process.env.DOMAIN?.trim() ||
      'localhost',
    port: parseInt(process.env.TURN_PORT ?? '3478', 10),
    secret,
    username: process.env.TURN_USERNAME?.trim() ?? 'video-call',
    credentialTtlSec: parseInt(process.env.TURN_CREDENTIAL_TTL_SEC ?? '86400', 10),
  };
}

export function generateTurnCredentials(
  secret: string,
  usernamePrefix: string,
  ttlSeconds: number,
): { username: string; credential: string } {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${usernamePrefix}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

export function getIceServers(): IceServerConfig[] {
  const override = readIceServersOverride();
  if (override) {
    return override;
  }

  const turn = readTurnSettings();
  if (!turn.enabled) {
    return [];
  }

  const { username, credential } = generateTurnCredentials(
    turn.secret,
    turn.username,
    turn.credentialTtlSec,
  );

  const stunUrl = `stun:${turn.host}:${turn.port}`;
  const turnUrl = `turn:${turn.host}:${turn.port}`;

  return [
    { urls: stunUrl },
    { urls: turnUrl, username, credential },
  ];
}
