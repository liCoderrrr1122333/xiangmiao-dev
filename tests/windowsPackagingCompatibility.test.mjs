import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows release avoids ASAR loading failures and applies the narrow GPU compatibility switch', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.equal(pkg.build.asar, false, 'release files must be installed under resources/app instead of app.asar');
  assert.match(main, /app\.commandLine\.appendSwitch\('disable-gpu-sandbox'\)/);
  assert.doesNotMatch(main, /app\.commandLine\.appendSwitch\('no-sandbox'\)/);
  assert.match(main, /sandbox: true/);
});

test('main renderer failures are visible and diagnosed instead of leaving a black window', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const createWindow = main.slice(main.indexOf('async function createWindow()'), main.indexOf('function registerIpc()'));

  assert.match(createWindow, /show: false/);
  assert.match(createWindow, /ready-to-show/);
  assert.match(createWindow, /did-fail-load/);
  assert.match(createWindow, /render-process-gone/);
  assert.match(createWindow, /showMainWindowLoadFailure/);
  assert.match(main, /app\.on\('child-process-gone'/);
  assert.match(main, /electron-runtime\.ndjson/);
});

test('application, installer, tray, and renderer all use the same maintained icon chain', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const toolbar = await readFile(new URL('../src/renderer/components/ProjectToolbar.tsx', import.meta.url), 'utf8');

  assert.equal(pkg.build.icon, 'build/icon.ico');
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.deepEqual(pkg.build.extraResources, [
    { from: 'build/icon.ico', to: 'icon.ico' },
    { from: 'public/yaochuang-tray.png', to: 'yaochuang-tray.png' }
  ]);
  assert.match(toolbar, /src="\.\/yaochuang-tray\.png"/);
});

test('maintained icon assets preserve transparency and the Windows ICO size ladder', async () => {
  const master = await readFile(new URL('../build/yaochuang-mascot-source.png', import.meta.url));
  const renderer = await readFile(new URL('../public/yaochuang-unified-v2.png', import.meta.url));
  const tray = await readFile(new URL('../public/yaochuang-tray.png', import.meta.url));
  const buildIcon = await readFile(new URL('../build/icon.ico', import.meta.url));
  const extraIcon = await readFile(new URL('../build/yaochuang-unified-v2.ico', import.meta.url));
  const rendererIcon = await readFile(new URL('../public/yaochuang.ico', import.meta.url));

  assert.deepEqual(master, renderer, 'renderer master must match the maintained transparent source');
  assert.equal(master[25], 6, 'master PNG must use RGBA color type');
  assert.equal(tray[25], 6, 'tray PNG must use RGBA color type');
  assert.deepEqual(buildIcon, extraIcon);
  assert.deepEqual(buildIcon, rendererIcon);
  assert.equal(buildIcon.readUInt16LE(4), 7, 'ICO must contain seven image sizes');
  assert.deepEqual(
    Array.from({ length: 7 }, (_, index) => buildIcon[6 + index * 16] || 256),
    [16, 24, 32, 48, 64, 128, 256]
  );
});
