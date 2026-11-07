import { spawn } from 'node:child_process';

const windows = process.platform === 'win32';
const host = process.env.DEMO_HOST ?? (windows ? '127.0.0.1' : '0.0.0.0');
if (!/^[a-zA-Z0-9.:-]+$/.test(host)) throw new Error('DEMO_HOST contiene caracteres no permitidos.');

const command = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const args = windows
  ? ['/d', '/s', '/c', `npm.cmd run dev --workspace=@ganadito/web -- --host ${host}`]
  : ['run', 'dev', '--workspace=@ganadito/web', '--', '--host', host];
const child = spawn(command, args, {
  stdio: 'inherit',
  env: { ...process.env, PUBLIC_DEMO_ENABLED: 'true' }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error('No se pudo iniciar la demo web:', error.message);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
