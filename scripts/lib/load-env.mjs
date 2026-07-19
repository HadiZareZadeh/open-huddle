import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptsDir, '..');

export function loadEnvFile(envPath = path.join(projectRoot, '.env')) {
  const env = { ...process.env };

  if (!fs.existsSync(envPath)) {
    return env;
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

export function getTurnSettings(env = loadEnvFile()) {
  const secret = env.TURN_SECRET?.trim() ?? '';
  if (!secret) {
    throw new Error('TURN_SECRET is required in .env');
  }

  return {
    secret,
    realm: env.TURN_REALM?.trim() || 'video-call.local',
    port: parseInt(env.TURN_PORT ?? '3478', 10),
    externalIp: env.TURN_EXTERNAL_IP?.trim() || undefined,
  };
}
