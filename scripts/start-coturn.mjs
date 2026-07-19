#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import { findTurnserver, installHelp, toWslPath } from './lib/find-turnserver.mjs';
import {
  clearMeta,
  configPath,
  pidPath,
  readMeta,
  writeCoturnConfig,
  writeMeta,
} from './lib/coturn-config.mjs';
import { getTurnSettings, loadEnvFile } from './lib/load-env.mjs';

function isRunning(meta) {
  if (!meta?.pid) {
    return false;
  }

  try {
    process.kill(meta.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopExisting() {
  const meta = readMeta();
  if (!meta) {
    return;
  }

  if (meta.mode === 'wsl') {
    spawnSync('wsl', ['sh', '-lc', `pkill -f "turnserver -c ${meta.configPath}" || true`], {
      stdio: 'ignore',
    });
  } else if (meta.pid) {
    try {
      process.kill(meta.pid);
    } catch {
      // already stopped
    }
  }

  clearMeta();
}

function startNative(settings, resolvedConfigPath) {
  const child = spawn('turnserver', ['-c', resolvedConfigPath], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
  writeMeta({
    mode: 'native',
    pid: child.pid,
    configPath: resolvedConfigPath,
    port: settings.port,
  });
  fs.writeFileSync(pidPath, `${child.pid}\n`, 'utf8');

  return child.pid;
}

function startWsl(settings, resolvedConfigPath) {
  const wslConfigPath = toWslPath(resolvedConfigPath);
  const child = spawn('wsl', ['turnserver', '-c', wslConfigPath], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
  writeMeta({
    mode: 'wsl',
    pid: child.pid,
    configPath: wslConfigPath,
    port: settings.port,
  });
  fs.writeFileSync(pidPath, `${child.pid}\n`, 'utf8');

  return child.pid;
}

function main() {
  const env = loadEnvFile();
  const settings = getTurnSettings(env);
  const runner = findTurnserver();

  if (!runner) {
    console.error(installHelp());
    process.exit(1);
  }

  const existing = readMeta();
  if (existing && isRunning(existing)) {
    console.log(`coturn already running (${runner.mode}) on port ${settings.port}`);
    return;
  }

  stopExisting();
  const resolvedConfigPath = writeCoturnConfig(settings);
  const pid =
    runner.mode === 'wsl'
      ? startWsl(settings, resolvedConfigPath)
      : startNative(settings, resolvedConfigPath);

  console.log(`coturn started (${runner.mode}) on port ${settings.port} (pid ${pid})`);
  console.log(`config: ${resolvedConfigPath}`);
}

main();
