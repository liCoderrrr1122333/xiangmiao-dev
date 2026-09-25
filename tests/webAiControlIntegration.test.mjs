import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { scoreChatGptPageTarget } from '../dist-electron/main/chromeChatGpt.js';

test('dedicated Chrome selects the requested Gemini tab without weakening ChatGPT scoring', () => {
  assert.ok(
    scoreChatGptPageTarget('https://gemini.google.com/app/abc', 'https://gemini.google.com/app') >
      scoreChatGptPageTarget('https://chatgpt.com/', 'https://gemini.google.com/app')
  );
  assert.ok(
    scoreChatGptPageTarget('https://chatgpt.com/c/abc', 'https://chatgpt.com/') >
      scoreChatGptPageTarget('https://gemini.google.com/app', 'https://chatgpt.com/')
  );
});

test('renderer, preload and main expose provider-scoped window and model controls', async () => {
  const [types, settings, preload, app, description, main] = await Promise.all([
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/state/settingsStore.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/DescriptionPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  ]);

  assert.match(types, /webAiProvider: WebAiProvider/);
  assert.match(types, /provider\?: WebAiProvider/);
  assert.match(types, /geminiUrl: string/);
  assert.match(types, /geminiModel: string/);
  assert.match(settings, /webAiProvider: 'chatgpt'/);
  assert.match(settings, /geminiUrl: 'https:\/\/gemini\.google\.com\/app'/);
  assert.match(preload, /ipcRenderer\.invoke\('web-ai:check-login'/);
  assert.match(preload, /ipcRenderer\.invoke\('web-ai:show-window'/);
  assert.match(preload, /ipcRenderer\.invoke\('web-ai:list-models'/);
  assert.match(main, /registerTrustedIpcHandler\('web-ai:check-login'/);
  assert.match(main, /registerTrustedIpcHandler\('web-ai:show-window'/);
  assert.match(main, /registerTrustedIpcHandler\('web-ai:list-models'/);
  assert.match(description, /\['chatgpt', 'ChatGPT'\][\s\S]*\['gemini', 'Gemini'\][\s\S]*\['relay', 'API'\]/);
  assert.match(description, /\['chatgpt', 'ChatGPT'\][\s\S]*\['ollama', '本地模型'\][\s\S]*\['gemini', 'Gemini'\]/);
  assert.match(description, /production-route-panel/);
  assert.match(app, /provider: webAiProvider/);
});

test('provider switching invalidates stale login and model responses', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(app, /webAiModelRefreshSequenceRef/);
  assert.match(app, /chatGptLoginSequenceRef\.current \+= 1/);
  assert.match(app, /webAiModelRefreshSequenceRef\.current \+= 1/);
  assert.match(app, /sequence !== webAiModelRefreshSequenceRef\.current/);
  assert.match(app, /sequence !== chatGptLoginSequenceRef\.current/);
  assert.match(app, /statusProvider !== webAiProvider/);
});

test('showing Gemini protects the visible browser from concurrent background probes', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const start = main.indexOf('async function showGeminiWindowForInspection(');
  const end = main.indexOf('async function recoverGeminiWindowForInspection(', start);
  const implementation = main.slice(start, end);

  assert.ok(start >= 0 && end > start, 'Gemini window inspection implementation must exist');
  assert.match(
    implementation,
    /chatGptChromeLoginInterventionActive = true;[\s\S]*showAndConfirmChatGptWindow\(win\)/,
    'the user-visible Gemini reveal must win over a concurrent model/login probe that hides the browser'
  );
});

test('web pose analysis is bridged through dedicated web and local-model IPC flows', async () => {
  const [types, preload, main, description] = await Promise.all([
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/DescriptionPanel.tsx', import.meta.url), 'utf8')
  ]);

  assert.match(types, /apiAnalyzeWebPoses/);
  assert.match(types, /onWebPoseAnalysisStatus/);
  assert.match(preload, /ipcRenderer\.invoke\('api:analyze-web-poses'/);
  assert.match(preload, /web-pose-analysis:status/);
  assert.match(main, /registerTrustedIpcHandler\(\s*'api:analyze-web-poses'/);
  assert.match(main, /async function analyzeWebPosesWithOllama\(/);
  assert.match(main, /payload\.provider === 'ollama'[\s\S]*analyzeWebPosesWithOllama/);
  assert.match(main, /waitForStableChatGptComposerReady[\s\S]*web-pose-analysis-pre-send-gate/);
  assert.match(main, /parseWebPoseSuggestions/);
  assert.match(description, /createAnalysisImage\(project\.mainImage, undefined, 1024, 0\.86\)/);
  assert.match(description, /web-pose-disclosure/);
});
