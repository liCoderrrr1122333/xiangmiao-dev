import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('web AI provider contract covers the complete browser automation lifecycle', async () => {
  const source = await readFile(new URL('../src/main/webAiProvider.ts', import.meta.url), 'utf8');
  for (const method of [
    'ensureReady',
    'checkLogin',
    'showWindow',
    'listModels',
    'selectModel',
    'createConversation',
    'uploadAttachments',
    'sendPrompt',
    'confirmMessageAccepted',
    'waitForTextResult',
    'waitForImageResult',
    'classifyFailure',
    'downloadResult',
    'cleanupConversation'
  ]) {
    assert.match(source, new RegExp(`\\b${method}\\b`));
  }
});
