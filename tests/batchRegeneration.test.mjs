import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isNewerAutomationLifecycleSequence,
  shouldDisableGenerationAction
} from '../dist-electron/shared/generationSessionPolicy.js';

test('a completed batch always releases the generation action', () => {
  assert.equal(shouldDisableGenerationAction(true, true), true);
  assert.equal(shouldDisableGenerationAction(true, false), false);
  assert.equal(shouldDisableGenerationAction(false, false), false);
  assert.equal(shouldDisableGenerationAction(false, true), false);
});

test('automation lifecycle ignores stale events and accepts the latest idle state', () => {
  assert.equal(isNewerAutomationLifecycleSequence(8, 9), true);
  assert.equal(isNewerAutomationLifecycleSequence(9, 9), false);
  assert.equal(isNewerAutomationLifecycleSequence(10, 9), false);
  assert.equal(isNewerAutomationLifecycleSequence(10, Number.NaN), false);
});

test('face reference upload can select the same file again after a completed batch', async () => {
  const source = await readFile(new URL('../src/renderer/components/ReferenceImagePanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /const files = \[\.\.\.\(event\.currentTarget\.files \|\| \[\]\)\]/);
  assert.match(source, /event\.currentTarget\.value = ''/);
  assert.match(source, /if \(files\.length\) void addFiles\(files\)/);
  assert.match(source, /onChange=\{selectFiles\}/);
});

test('regenerate stays interactive and explains unmet prerequisites', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /disabled=\{shouldDisableGenerationAction\(isGeneratingImage, isPauseRequested\)\}/);
  assert.match(source, /refs: '请重新上传至少一张人脸参考图。若选择同名文件，软件现在也会重新读取。'/);
  assert.doesNotMatch(source, /disabled=\{isGeneratingImage \? isPauseRequested : !canSend\}/);
});

test('main process emits a bounded lifecycle around every accepted batch', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(source, /emitAutomationLifecycle\(event, true\)/);
  assert.match(source, /chatGptAutomationRunning = false;\s+emitAutomationLifecycle\(event, false\)/);
  assert.match(source, /sequence: \+\+chatGptAutomationLifecycleSequence/);
  assert.match(source, /hash\.update\(await fs\.readFile\(file\)\)/);
  assert.match(source, /previousCheckpoint\?\.jobKey === jobKey/);
});

test('preload exposes the lifecycle fallback without changing send IPC', async () => {
  const source = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
  assert.match(source, /ipcRenderer\.on\('chatgpt-automation:lifecycle'/);
  assert.match(source, /ipcRenderer\.invoke\('send:create-package', payload, settings\)/);
});
