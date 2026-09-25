import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  preferredAppDataDirectory,
  browserExecutableCandidates,
  managedDarwinBrowserProcessIds
} from '../dist-electron/main/platformPolicy.js';

test('macOS uses Electron application data unless the caller provides an explicit absolute override', () => {
  assert.equal(preferredAppDataDirectory('darwin', ''), undefined);
  assert.equal(preferredAppDataDirectory('darwin', '/tmp/yaochuang-test'), '/tmp/yaochuang-test');
  assert.equal(preferredAppDataDirectory('win32', ''), 'D:\\Yaochuang-Workshop\\AppData');
});

test('source runs isolate their data while explicit test directories retain priority', () => {
  assert.equal(preferredAppDataDirectory('win32', '', 'D:\\source\\.local-data'), 'D:\\source\\.local-data');
  assert.equal(preferredAppDataDirectory('darwin', '', '/source/.local-data'), '/source/.local-data');
  assert.equal(preferredAppDataDirectory('win32', 'D:\\test-data', 'D:\\source\\.local-data'), 'D:\\test-data');
  assert.throws(() => preferredAppDataDirectory('win32', '', 'relative-folder'));
});

test('macOS cleanup selects only Chrome processes that own the dedicated profile', () => {
  const profile = '/Users/hale/Library/Application Support/耀创工坊/ChatGPT-Chrome';
  const processes = [
    '  101 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/hale/Library/Application Support/耀创工坊/ChatGPT-Chrome --remote-debugging-port=1234',
    '  102 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --profile-directory=Default',
    '  103 /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge --user-data-dir="/Users/hale/Library/Application Support/耀创工坊/ChatGPT-Chrome-Edge"',
    '  104 /usr/bin/something --user-data-dir=/Users/hale/Library/Application Support/耀创工坊/ChatGPT-Chrome'
  ].join('\n');
  assert.deepEqual(managedDarwinBrowserProcessIds(processes, profile), [101]);
});

test('macOS dedicated browser discovery covers system and per-user Chrome and Edge applications', () => {
  assert.deepEqual(browserExecutableCandidates('darwin', '/Users/hale'), [
    { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', label: 'Chrome' },
    { path: '/Users/hale/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', label: 'Chrome' },
    { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', label: 'Edge' },
    { path: '/Users/hale/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', label: 'Edge' }
  ]);
});

test('macOS packaging prepares an ICNS icon and produces a DMG for the current Mac architecture', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const iconScript = await readFile(new URL('../scripts/prepare-macos-icon.mjs', import.meta.url), 'utf8');
  assert.equal(pkg.build.mac.icon, 'build/icon.icns');
  assert.equal(pkg.build.mac.target, 'dmg');
  assert.match(pkg.scripts['dist:mac'], /prepare-macos-icon/);
  assert.match(pkg.scripts['verify:mac-source'], /verify-macos-source/);
  assert.match(pkg.scripts['verify:packaged-mac'], /verify-packaged-macos/);
  assert.match(iconScript, /process\.platform !== 'darwin'/);
  assert.match(iconScript, /iconutil/);
  assert.match(iconScript, /yaochuang-mascot-source\.png/);
});

test('macOS package keeps Windows-only browser and GPU helpers outside the Darwin path', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const chrome = await readFile(new URL('../src/main/chromeChatGpt.ts', import.meta.url), 'utf8');
  assert.match(main, /process\.platform === 'win32'[\s\S]*disable-gpu-sandbox/);
  assert.match(main, /process\.platform === 'win32'[\s\S]*preferredRoot = 'D:\\\\'/);
  assert.match(chrome, /process\.platform === 'darwin'[\s\S]*setWindowState\('minimized'\)/);
  assert.doesNotMatch(chrome, /^\s*'--disable-features=CalculateNativeWinOcclusion',?$/m);
});
