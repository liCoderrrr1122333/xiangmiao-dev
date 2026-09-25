import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('local analysis setup exposes one-click health, download, and progress controls', async () => {
  const [types, preload, main, description] = await Promise.all([
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/DescriptionPanel.tsx', import.meta.url), 'utf8')
  ]);

  assert.match(types, /LocalAnalysisModelStatus/);
  assert.match(types, /prepareLocalAnalysisModel/);
  assert.match(preload, /local-analysis:get-status/);
  assert.match(preload, /local-analysis:prepare-model/);
  assert.match(preload, /local-analysis:model-progress/);
  assert.match(main, /registerTrustedIpcHandler\(\s*'local-analysis:get-status'/);
  assert.match(main, /registerTrustedIpcHandler\(\s*'local-analysis:prepare-model'/);
  assert.match(main, /\/api\/pull/);
  assert.match(description, /安装本地模型|下载本地模型|本地模型已就绪/);
});

test('runtime layout uses a full-width parallel selector and a compact result toolbar', async () => {
  const [app, css] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/glass-workbench.css', import.meta.url), 'utf8')
  ]);

  assert.match(app, /并行通道/);
  assert.match(app, /\{parallelism\} 路/);
  assert.match(css, /\.chatgpt-parallel-control[\s\S]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.inline-result-actions[\s\S]*grid-template-columns:/);
});
