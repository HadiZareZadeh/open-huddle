import fs from 'fs';
import path from 'path';
import { projectRoot } from './load-env.mjs';

export const coturnDir = path.join(projectRoot, '.coturn');
export const configPath = path.join(coturnDir, 'turnserver.conf');
export const pidPath = path.join(coturnDir, 'turnserver.pid');
export const metaPath = path.join(coturnDir, 'turnserver.meta.json');

export function generateCoturnConfig({ secret, realm, port, externalIp }) {
  const lines = [
    `listening-port=${port}`,
    'listening-ip=0.0.0.0',
    'relay-ip=0.0.0.0',
    'fingerprint',
    'lt-cred-mech',
    'use-auth-secret',
    `static-auth-secret=${secret}`,
    `realm=${realm}`,
    'min-port=49152',
    'max-port=49252',
    'no-cli',
    'no-tls',
    'no-dtls',
    'log-file=stdout',
    'verbose',
  ];

  if (externalIp) {
    lines.push(`external-ip=${externalIp}`);
  }

  return `${lines.join('\n')}\n`;
}

export function writeCoturnConfig(settings) {
  fs.mkdirSync(coturnDir, { recursive: true });
  fs.writeFileSync(configPath, generateCoturnConfig(settings), 'utf8');
  return configPath;
}

export function readMeta() {
  if (!fs.existsSync(metaPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

export function writeMeta(meta) {
  fs.mkdirSync(coturnDir, { recursive: true });
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

export function clearMeta() {
  for (const file of [pidPath, metaPath]) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}
