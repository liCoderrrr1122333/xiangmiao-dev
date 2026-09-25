import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('the public typecheck command detects main-process errors, not just renderer errors', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'yaochuang-typecheck-'));
  try {
    await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ scripts: { typecheck: pkg.scripts.typecheck } }));
    const config = file => JSON.stringify({ compilerOptions: { noEmit: true, skipLibCheck: true, types: [] }, files: [file] });
    await writeFile(path.join(fixture, 'tsconfig.json'), config('renderer.ts'));
    await writeFile(path.join(fixture, 'tsconfig.electron.json'), config('main.ts'));
    await writeFile(path.join(fixture, 'renderer.ts'), 'export const value: number = 1;');
    await writeFile(path.join(fixture, 'main.ts'), 'export const value: number = "wrong";');
    const result = spawnSync('npm run typecheck', {
      shell: true, cwd: fixture, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}` }
    });
    assert.notEqual(result.status, 0, 'main-process type errors must fail typecheck');
    assert.match(result.stdout + result.stderr, /main\.ts.*TS2322/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('source development builds Electron before starting the workspace', () => {
  assert.match(pkg.scripts.dev, /^npm run build && /);
});
