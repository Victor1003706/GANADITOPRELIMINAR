import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'apps/web');
const require = createRequire(resolve(web, 'package.json'));
const vitePackage = require.resolve('vite/package.json');
const viteCli = resolve(dirname(vitePackage), 'bin/vite.js');

// Remove any Node adapter output so Cloudflare receives only static demo assets.
await rm(resolve(web, 'build'), { recursive: true, force: true });

const child = spawn(process.execPath, [viteCli, 'build', '--mode', 'cloudflare-demo'], {
  cwd: web,
  stdio: 'inherit',
  env: {
    ...process.env,
    PUBLIC_DEMO_ENABLED: 'true',
    PUBLIC_API_URL: '',
    PUBLIC_WS_URL: '',
    PUBLIC_LIVE_AUCTIONS_ENABLED: 'false'
  }
});

child.on('error', (error) => {
  console.error('No se pudo compilar la demo estática:', error.message);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
