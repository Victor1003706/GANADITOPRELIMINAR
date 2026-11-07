import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await readFile(join(repository, 'apps/api/package.json'), 'utf8'));

// Execute the published launch arguments against a TypeScript probe, never the API or a database.
// Removing env loading, the tsx loader, the entrypoint or injected-variable precedence breaks these tests.
async function probe(t, script, { envFile = true, injectedPort } = {}) {
  const command = manifest.scripts[script];
  assert.equal(typeof command, 'string', `Falta el script API ${script}.`);
  const [executable, ...args] = command.trim().split(/\s+/);
  assert.equal(executable, 'node', `El script API ${script} debe ejecutar Node.`);
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'ganadito-runtime-'));
  t.after(async () => {
    const target = resolve(fixtureRoot);
    const withinTemporary = relative(resolve(tmpdir()), target);
    assert.ok(withinTemporary && !withinTemporary.startsWith(`..${sep}`) && withinTemporary !== '..');
    assert.ok(target.startsWith(join(resolve(tmpdir()), 'ganadito-runtime-')));
    await rm(target, { recursive: true, force: true });
  });
  const apiRoot = join(fixtureRoot, 'apps/api');
  await mkdir(join(apiRoot, 'src'), { recursive: true });
  await symlink(join(repository, 'node_modules'), join(fixtureRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(apiRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(apiRoot, 'src/server.ts'), `
enum ProbeMarker { Runtime = 'runtime-probe' }
const result: { marker: string; port?: string; fromFile?: string; payments?: string } = {
  marker: ProbeMarker.Runtime, port: process.env.API_PORT,
  fromFile: process.env.GANADITO_RUNTIME_FILE, payments: process.env.PAYMENTS_ENABLED
};
console.log(JSON.stringify(result));
`);
  if (envFile) await writeFile(join(fixtureRoot, '.env'), 'API_PORT=4000\nGANADITO_RUNTIME_FILE=fixture-only\nPAYMENTS_ENABLED=false\n');
  const childEnv = { NODE_ENV: 'test' };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'Path']) {
    if (process.env[key] !== undefined) childEnv[key] = process.env[key];
  }
  if (injectedPort) childEnv.API_PORT = injectedPort;
  const child = spawn(process.execPath, args, { cwd: apiRoot, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    return await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error(`El script ${script} no ejecutó la sonda TypeScript. ${stderr}`)), 10_000);
      const finish = (callback, value) => { clearTimeout(timer); callback(value); };
      child.stdout.on('data', chunk => {
        stdout += chunk;
        let end;
        while ((end = stdout.indexOf('\n')) !== -1) {
          const line = stdout.slice(0, end).trim();
          stdout = stdout.slice(end + 1);
          if (line.startsWith('{"marker":"runtime-probe"')) finish(accept, JSON.parse(line));
        }
      });
      child.once('error', error => finish(reject, error));
      child.once('exit', code => finish(reject, new Error(`El script ${script} terminó sin ejecutar la sonda (${code}). ${stderr}`)));
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
}

for (const script of ['dev', 'start']) {
  test(`API ${script} carga .env de raíz desde apps/api`, async t =>