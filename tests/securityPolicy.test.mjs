import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const preloadPackage = JSON.parse(await readFile(new URL('../src/preload/package.json', import.meta.url), 'utf8'));

test('the main renderer is isolated, sandboxed and denies new renderer windows', () => {
  assert.match(mainSource, /preload:[\s\S]*contextIsolation: true,[\s\S]*nodeIntegration: false,[\s\S]*sandbox: true/);
  assert.match(mainSource, /win\.webContents\.setWindowOpenHandler[\s\S]*action: 'deny'/);
  assert.equal(preloadPackage.type, 'commonjs', 'sandboxed Electron preload must compile to CommonJS');
});

test('all privileged IPC is limited to the trusted top-level workbench renderer', () => {
  assert.match(mainSource, /function assertTrustedIpcSender\(event: IpcMainInvokeEvent\)/);
  assert.match(mainSource, /event\.sender\.id !== mainWindow\.webContents\.id/);
  assert.match(mainSource, /Boolean\(senderFrame\?\.parent\)/);
  assert.match(mainSource, /!isTrustedMainRendererUrl\(senderUrl\)/);
  assert.doesNotMatch(mainSource, /\n\s+ipcMain\.handle\('/);
  assert.match(mainSource, /webContents\.on\('will-navigate',[\s\S]*event\.preventDefault\(\)/);
});

test('embedded ChatGPT cannot silently obtain device permissions', () => {
  assert.match(mainSource, /setPermissionRequestHandler\(\(webContents, permission, callback\)/);
  assert.match(mainSource, /permission === 'clipboard-sanitized-write'/);
  assert.doesNotMatch(mainSource, /callback\(allowed\)/);
});

test('external navigation and path opening are constrained before reaching the OS shell', () => {
  assert.match(mainSource, /function validatedExternalUrl/);
  assert.match(mainSource, /target\.protocol !== 'https:'/);
  assert.match(mainSource, /stats\?\.isDirectory\(\)/);
  assert.doesNotMatch(mainSource, /ipcMain\.handle\('shell:open-external'[\s\S]{0,180}shell\.openExternal\(url\)/);
  assert.doesNotMatch(mainSource, /ipcMain\.handle\('shell:open-path'[\s\S]{0,180}shell\.openPath\(folderPath\)/);
});

test('the application shell has a restrictive CSP with explicit WASM and worker allowances', () => {
  assert.match(htmlSource, /Content-Security-Policy/);
  assert.match(htmlSource, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(htmlSource, /worker-src 'self' blob:/);
  assert.match(htmlSource, /object-src 'none'/);
  assert.doesNotMatch(htmlSource, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(htmlSource, /script-src[^;]*'unsafe-eval'/);
});
