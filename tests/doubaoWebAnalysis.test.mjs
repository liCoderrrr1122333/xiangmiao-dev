import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('obsolete Doubao web analysis is retired from the renderer and IPC contract', async () => {
  const [policy, types, preload, description, main] = await Promise.all([
    readFile(new URL('../src/shared/analysisProviderPolicy.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/DescriptionPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(policy, /'doubao-web'/);
  assert.doesNotMatch(types, /showAnalysisWebWindow/);
  assert.doesNotMatch(preload, /analysis-web:show-window/);
  assert.doesNotMatch(description, /豆包网页|查看豆包/);
  assert.doesNotMatch(main, /provider === 'doubao-web'/);
  assert.doesNotMatch(main, /registerTrustedIpcHandler\(\s*'analysis-web:show-window'/);
});

test('Gemini production and analysis choices remain visibly disabled while adaptation is paused', async () => {
  const description = await readFile(new URL('../src/renderer/components/DescriptionPanel.tsx', import.meta.url), 'utf8');

  assert.match(description, /const unavailable = provider === 'gemini'/);
  assert.match(description, /disabled=\{isGenerating \|\| unavailable\}/);
  assert.match(description, /disabled=\{isGenerating \|\| isAnalyzing \|\| isPoseAnalyzing \|\| unavailable\}/);
  assert.match(description, /Gemini 适配中，暂不可用/);
});
