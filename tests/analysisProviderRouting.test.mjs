import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('local analysis and generation providers form an explicit production route', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());

  const {
    analysisProviderLabel,
    analysisRouteSummary,
    normalizeAnalysisProvider
  } = await vite.ssrLoadModule('/src/shared/analysisProviderPolicy.ts');

  assert.equal(normalizeAnalysisProvider('ollama'), 'ollama');
  assert.equal(normalizeAnalysisProvider('chatgpt'), 'chatgpt');
  assert.equal(normalizeAnalysisProvider('gemini'), 'gemini');
  assert.equal(normalizeAnalysisProvider('doubao-web'), 'chatgpt');
  assert.equal(normalizeAnalysisProvider('doubao'), 'doubao');
  assert.equal(normalizeAnalysisProvider('openai'), 'chatgpt');
  assert.equal(analysisProviderLabel('doubao'), '豆包');
  assert.equal(analysisRouteSummary('doubao', 'chatgpt'), '豆包分析 → ChatGPT 做图');
  assert.equal(analysisProviderLabel('ollama'), '本地模型');
  assert.equal(analysisRouteSummary('ollama', 'relay'), '本地模型分析 → 自由 API 做图');
});

test('renderer exposes collapsible local-first routing and contains no obsolete web-analysis branding', async () => {
  const [types, description, app, modal, generationPolicy, main] = await Promise.all([
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/DescriptionPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/RelayApiConfigModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/generationProviderPolicy.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  ]);

  assert.match(types, /prepareLocalAnalysisModel/);
  assert.match(description, /制作通道/);
  assert.match(description, /本地模型/);
  assert.match(description, /production-route-disclosure/);
  assert.match(description, /apiAnalyzeWebPoses\(\{[\s\S]*provider: analysisProvider,[\s\S]*DOUBAO_ANALYSIS_MODEL/);
  assert.doesNotMatch(description, /豆包网页|查看豆包/);
  assert.doesNotMatch(types, /'doubao'\s*\|\s*'openai'/);
  assert.match(generationPolicy, /自由 API/);
  assert.doesNotMatch(`${app}\n${modal}`, /连一连|中转站/);
  assert.doesNotMatch(main, /连一连 API 连接成功|中转站未配置|中转站连接失败/);
  assert.match(main, /payload\.provider === 'ollama'[\s\S]*analyzeWebPosesWithOllama/);
  assert.match(main, /provider === 'doubao'[\s\S]*analyzeMainImageWithDoubao/);
  assert.doesNotMatch(main, /豆包网页|查看豆包/);
  assert.doesNotMatch(main, /providerVisionModel\('openai'/);
});
