#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { clearMeta, readMeta } from './lib/coturn-config.mjs';

function main() {
  const meta = readMeta();

  if (!meta) {
    console.log('coturn is not running');
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
  console.log('coturn stopped');
}

main();
