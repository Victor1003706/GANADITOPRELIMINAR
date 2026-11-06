import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedWebEnvironment } from './environment.mjs';

// Guard before Vite/plugin imports, .env discovery or any build. The API has its
// own independent guard; this process never imports it or connects to a database.
let webEnv;
try { webEnv = isolatedWebEnvironment(process.env); }
catch (error) {
  console.error(error.message);
  process.exit(1);
}

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const webRoot = join(repository, 'apps/web');
let envDirectory;
try {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, webEnv);
  process.chdir(webRoot);
  envDirectory = await mkdtemp(join(tmpdir(), 'ganadito-real-web-env-'));
  const [{ createBuilder }, { default: adapter }, { sveltekit }, { default: tailwindcss }] = await Promise.all([
    import('vite'), import('@sveltejs/adapter-node'), import('@sveltejs/kit/vite'), import('@tailwindcss/vite')
  ]);
  // The normal vite.config.ts explicitly loads the repository .env. Do not
  // evaluate it here. Both Vite and SvelteKit must use the empty environment dir.
  const builder = await createBuilder({
    root: webRoot, configFile: false, envDir: envDirectory,
    plugins: [tailwindcss(), sveltekit({
      adapter: adapter(), env: { dir: envDirectory }, version: { name: webEnv.GANADITO_RELEASE_SHA }
    })]
  });
  // Match Vite 8's CLI: build() handles one environment only. SvelteKit's SSR,
  // prerender and adapter hooks run through buildApp().
  await builder.buildApp();
  const version = JSON.parse(await readFile(join(webRoot, 'build/client/_app/version.json'), 'utf8'));
  if (version.version !== webEnv.GANADITO_RELEASE_SHA) throw new Error('release mismatch');
  const recordDirectory = join(repository, 'test-results/real');
  await mkdir(recordDirectory, { recursive: true });
  // Public build identity only. Never write sessions, credentials or API bodies.
  await writeFile(join(recordDirectory, 'release.json'), JSON.stringify({ release_sha: version.version }) + '\n');
  console.log(`[real E2E] Web adapter-node compilada: ${version.version}`);
} catch {
  console.error('[real E2E] No se pudo construir o verificar la web aislada.');
  process.exitCode = 1;
} finally {
  if (envDirectory) {
    const target = resolve(envDirectory);
    const withinTemporary = relative(resolve(tmpdir()), target);
    if (withinTemporary && withinTemporary !== '..' && !withinTemporary.startsWith(`..${sep}`) &&
        target.startsWith(join(resolve(tmpdir()), 'ganadito-real-web-env-'))) {
      await rm(target, { recursive: true, force: true });
    }
  }
}

if (process.exitCode || process.argv.includes('--build-only')) process.exit(process.exitCode || 0);

const child = spawn(process.execPath, [join(webRoot, 'build/index.js')], {
  cwd: webRoot, env: webEnv, windowsHide: true, stdio: 'inherit'
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', () => {
  console.error('[real E2E] No se pudo iniciar el artefacto web aislado.');
  process.exit(1);
});
child.once('exit', code => process.exit(code ?? 1));
