import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('automation composer probing never waits on the session endpoint', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(source, /const composerProbeScript = \(probeSession = true\)/);
  assert.match(source, /composerProbeScript\(!requireComposer\)/);
  assert.match(source, /const chatGptSessionProbeTimeoutMs = 1800/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), sessionProbeTimeoutMs\)/);
  assert.match(source, /__yaochuangSessionProbe/);
  assert.match(source, /cached\?\.error \|\| cached\?\.unauthenticated/);
});

test('localized ChatGPT composer labels and recovery completion are recognized', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(source, /textboxText\.includes\('\\u95ee\\u95ee chatgpt'\)/);
  assert.match(source, /message\|ask\|chatgpt\|\\u6d88\\u606f\|\\u8be2\\u95ee\|\\u95ee\\u95ee/);
  assert.match(source, /composer-background-recovery-started/);
  assert.match(source, /composer-background-recovery-finished/);
  assert.match(source, /step: 'ChatGPT 页面已恢复'/);
  assert.match(appSource, /current\.level === 'success' \|\| current\.level === 'error'/);
  assert.match(appSource, /return null/);
});

test('generated-image reads stay bounded without private conversation-history requests', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /backend-api\/conversation|chatGptConversationSnapshotScript/);
  assert.match(source, /const fetchBlobWithDeadline = async/);
  assert.match(source, /'generated-image-read'\)/);
  assert.match(source, /createImageBitmap\(blob\), 4000, 'image-decode', \(lateBitmap\) => lateBitmap\.close\(\)/);
  assert.match(source, /disposeLateValue\?\.\(value\)/);
  assert.match(source, /bitmap\.close\(\)/);
});
