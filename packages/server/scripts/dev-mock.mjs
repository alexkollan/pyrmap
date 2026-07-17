import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cross-platform equivalent of `mkdir -p ../../data && FIRMS_MOCK=1 DB_PATH=... node --env-file-if-exists=... dist/index.js`
// Plain shell syntax (POSIX env-var prefixes, `mkdir -p`) doesn't run under Windows cmd.exe, which is what
// pnpm scripts execute under on Windows.
const isWindows = process.platform === 'win32';
const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.join(serverDir, '..', '..');
const dataDir = path.join(repoRoot, 'data');
const envFile = path.join(repoRoot, '.env');

mkdirSync(dataDir, { recursive: true });

const build = spawnSync('pnpm', ['run', 'build'], { cwd: serverDir, stdio: 'inherit', shell: isWindows });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const run = spawnSync(
  process.execPath,
  [`--env-file-if-exists=${envFile}`, path.join(serverDir, 'dist', 'index.js')],
  {
    cwd: serverDir,
    stdio: 'inherit',
    env: { ...process.env, FIRMS_MOCK: '1', DB_PATH: path.join(dataDir, 'dev.db') },
  },
);
process.exit(run.status ?? 0);
