import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'test', '--config', 'tests/e2e/playwright.config.ts', '--grep', 'HTTP polling', ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, E2E_HTTP_POLLING: 'true' },
  stdio: 'inherit'
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
