import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { OperationTimeoutError, withTimeout } from '../src/shared/asyncTimeout.ts';

test('withTimeout returns a completed operation and clears its timer', async () => {
  const value = await withTimeout(Promise.resolve('ready'), 100, 'should not time out');
  assert.equal(value, 'ready');
});

test('withTimeout rejects an operation that never settles', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    withTimeout(new Promise(() => undefined), 30, 'login probe timed out'),
    (error) => error instanceof OperationTimeoutError && error.message === 'login probe timed out'
  );
  assert.ok(Date.now() - startedAt < 500);
});

test('explicit ChatGPT login checks have bounded navigation, storage and renderer waits', async () => {
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(mainSource, /withTimeout\(\s*win\.loadURL\(targetUrl\)/);
  assert.match(mainSource, /evalInPageWithTimeout\(\s*webContents,[\s\S]*chatGptStorageTimeoutMs/);
  assert.match(mainSource, /withTimeout\(\s*chatGptSession\.cookies\.flushStore\(\)/);
  assert.match(appSource, /chatGptLoginRequestRef/);
  assert.match(appSource, /chatGptLoginSequenceRef/);
  assert.match(appSource, /requestChatGptLoginStatus\(url, backend, provider, showToast && provider === 'chatgpt'\)/);
  assert.match(appSource, /reconcileProtection = false/);
  assert.match(appSource, /!result\.protectionPaused/);
  assert.match(appSource, /onChatGptLoginStatusChanged/);
  assert.match(appSource, /chatGptLoginCheckTimeoutMs = 100_000/);
  assert.match(appSource, /正在启动或恢复像锚专属 Chrome/);
  assert.match(appSource, /Web providers initialize on explicit use/);
});
