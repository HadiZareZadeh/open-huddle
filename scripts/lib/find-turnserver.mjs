import { spawnSync } from 'child_process';

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function wslTurnserverExists() {
  const result = spawnSync('wsl', ['sh', '-lc', 'command -v turnserver'], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

export function findTurnserver() {
  if (commandExists('turnserver')) {
    return { mode: 'native', command: 'turnserver' };
  }

  if (process.platform === 'win32' && wslTurnserverExists()) {
    return { mode: 'wsl', command: 'turnserver' };
  }

  return null;
}

export function installHelp() {
  const lines = [
    'coturn (turnserver) was not found.',
    '',
    'Install it once, then rerun this command:',
    '  Ubuntu/Debian/WSL: sudo apt update && sudo apt install -y coturn',
    '  macOS:            brew install coturn',
    '',
    'On Windows, install coturn inside WSL and keep Docker optional/unused.',
  ];

  return lines.join('\n');
}

export function toWslPath(windowsPath) {
  const result = spawnSync('wsl', ['wslpath', '-a', windowsPath], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to convert path for WSL: ${windowsPath}`);
  }

  return result.stdout.trim();
}
