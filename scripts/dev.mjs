import { execSync, spawn } from 'node:child_process';

// Cross-platform replacement for shell job control (`trap ... ; cmd & cmd & wait`), which only
// works under POSIX shells. pnpm runs scripts under cmd.exe on Windows, where that syntax fails outright.
const isWindows = process.platform === 'win32';

function run(args) {
  return spawn('pnpm', args, {
    stdio: 'inherit',
    shell: isWindows,
    detached: !isWindows, // POSIX: own process group, so we can kill the whole subtree together
  });
}

const children = [run(['--filter', '@pyrmap/server', 'dev:mock']), run(['--filter', '@pyrmap/web', 'dev'])];

let shuttingDown = false;

function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    // shell:true spawns cmd.exe as a wrapper; killing just that PID leaves node/vite orphaned underneath it.
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // already exited
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already exited
    }
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killChild(child);
}

process.on('SIGINT', () => {
  shutdown();
  process.exitCode = 0;
});
process.on('SIGTERM', () => {
  shutdown();
  process.exitCode = 0;
});

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0 && code !== null) {
      process.exitCode = code;
    }
    shutdown();
  });
}
