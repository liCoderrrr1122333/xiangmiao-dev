import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CURRENT_NOTICE_VERSION,
  normalizeAcknowledgedNoticeVersion,
  shouldShowStartupNotice
} from '../src/shared/startupNoticePolicy.ts';

test('startup notice versions normalize old and malformed settings safely', () => {
  assert.equal(CURRENT_NOTICE_VERSION, 1);
  assert.equal(normalizeAcknowledgedNoticeVersion(undefined), 0);
  assert.equal(normalizeAcknowledgedNoticeVersion('1'), 0);
  assert.equal(normalizeAcknowledgedNoticeVersion(-1), 0);
  assert.equal(normalizeAcknowledgedNoticeVersion(1.5), 0);
  assert.equal(normalizeAcknowledgedNoticeVersion(1), 1);
});

test('startup notice appears only when the acknowledged version is older', () => {
  assert.equal(shouldShowStartupNotice(undefined), true);
  assert.equal(shouldShowStartupNotice(0), true);
  assert.equal(shouldShowStartupNotice(1), false);
  assert.equal(shouldShowStartupNotice(2), false);
  assert.equal(shouldShowStartupNotice(1, 2), true);
  assert.equal(shouldShowStartupNotice(2, 2), false);
});

test('startup notice implementation keeps one mandatory accessible action', async () => {
  const [component, app, settingsStore] = await Promise.all([
    readFile(new URL('../src/renderer/components/StartupNoticeModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/state/settingsStore.ts', import.meta.url), 'utf8')
  ]);

  assert.match(settingsStore, /acknowledgedNoticeVersion: 0/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /我已确认，进入耀创工坊/);
  assert.match(component, /event\.key === 'Escape'/);
  assert.match(component, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(component, /以后再说|跳过|modal-close|关闭公告/);
  assert.match(app, /inert=\{startupNoticeState !== 'dismissed'/);
  assert.match(app, /await bridge\.writeSettings\(nextSettings\)/);
  assert.match(app, /setStartupNoticeState\('dismissed'\)/);
  assert.doesNotMatch(component + app, /localStorage/);
});

test('startup does not open a web provider before a first-time user chooses that route', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const initialization = app.slice(
    app.indexOf('const nextSettings = startupSettingsRef.current;'),
    app.indexOf("if (!settings.autoSave || projectHydration !== 'ready')")
  );
  assert.match(initialization, /apiWarmVisionModel/);
  assert.doesNotMatch(initialization, /checkChatGptLogin/);
  assert.doesNotMatch(initialization, /resolveWebAiProviderUrl/);
});

test('first-run notice explains API, local analysis, web login, and supported image imports', async () => {
  const component = await readFile(new URL('../src/renderer/components/StartupNoticeModal.tsx', import.meta.url), 'utf8');
  assert.match(component, /自由 API/);
  assert.match(component, /本地模型/);
  assert.match(component, /ChatGPT 网页/);
  assert.match(component, /JPG、PNG、WebP、HEIC/);
});

test('a fresh installation starts on local analysis plus API without warming ChatGPT in the background', async () => {
  const [settingsStore, main] = await Promise.all([
    readFile(new URL('../src/renderer/state/settingsStore.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  ]);
  assert.match(settingsStore, /generationProvider: 'relay'/);
  assert.match(settingsStore, /apiProvider: 'ollama'/);
  assert.match(main, /configureChatGptPersistence\(safeSettings, false\)/);
  assert.match(main, /configureChatGptPersistence\(startupSettings, false\)/);
});
