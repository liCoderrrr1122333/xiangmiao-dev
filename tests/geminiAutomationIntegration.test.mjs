import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Gemini generation is isolated behind provider dispatch and shares verified result persistence', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(main, /async function automateGeminiSend\(/);
  assert.match(main, /normalizeWebAiProvider\(settings\.webAiProvider\) === 'gemini'/);
  assert.match(main, /return automateGeminiSend\(/);
  assert.match(main, /async function prepareGeminiTaskWindows\(/);
  assert.match(main, /hash\.update\(JSON\.stringify\(\{ projectName, prompt, total, targetDimensions, provider \}\)\)/);
  assert.match(main, /async function saveGeneratedImageFromGemini\(/);
  assert.match(main, /writeVerifiedJpegAtomically\(/);
});

test('Gemini analysis has a separate pending recovery record and provider dispatch', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(main, /async function analyzeMainImageWithGemini\(/);
  assert.match(main, /gemini-analysis-pending\.json/);
  assert.match(main, /if \(provider === 'gemini'\) \{\s*return analyzeMainImageWithGemini\(/);
  assert.match(main, /cleanupGeminiAnalysisConversation\(/);
});

test('Gemini failure diagnostics contain structural evidence without page body or title text', async () => {
  const source = await readFile(new URL('../src/main/geminiWebAutomation.ts', import.meta.url), 'utf8');

  assert.match(source, /export async function captureGeminiDomDiagnostics\(/);
  assert.match(source, /pagePath:/);
  assert.match(source, /readyState:/);
  assert.match(source, /composerCount:/);
  assert.match(source, /modelButtonCount:/);
  assert.doesNotMatch(source, /bodyText:/);
  assert.doesNotMatch(source, /titleText:/);
});

test('Gemini send fallback uses the dedicated Chrome input channel and still requires acceptance evidence', async () => {
  const source = await readFile(new URL('../src/main/geminiWebAutomation.ts', import.meta.url), 'utf8');

  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.match(source, /method: 'cdp-button'/);
  assert.match(source, /Input\.dispatchKeyEvent/);
  assert.match(source, /method: 'cdp-enter'/);
  assert.match(source, /hasGeminiSendBeenAccepted\(baseline, last\)/);
});

test('Gemini image generation follows the current official direct-prompt flow', async () => {
  const source = await readFile(new URL('../src/main/geminiWebAutomation.ts', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(source, /strategy: 'direct-prompt'/);
  assert.match(source, /export async function enableGeminiImageMode/);
  assert.match(main, /并直接生成一张新图片/);
  assert.doesNotMatch(main, /请务必直接使用 Gemini 的制作图片功能/);
});

test('Gemini snapshots count top-level messages instead of nested response shells', async () => {
  const source = await readFile(new URL('../src/main/geminiWebAutomation.ts', import.meta.url), 'utf8');

  assert.match(source, /document\.querySelectorAll<HTMLElement>\('model-response'\)/);
  assert.doesNotMatch(source, /\.\.\.document\.querySelectorAll<HTMLElement>\('\[class\*="user-query"\]'\)/);
  assert.doesNotMatch(source, /const responseRoots = responseSelectionPanels\.length > 0/);
});

test('Gemini generation mirrors the mature ChatGPT readiness and safe retry gates', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(main, /uploadAndConfirmGeminiAttachments\(/);
  assert.match(main, /waitForGeminiComposerReady\(/);
  assert.match(main, /canSafelyRetryGeminiSend\(baseline, acceptance\.snapshot\)/);
  assert.match(main, /const localSaveAttempts = 3;/);
  assert.match(main, /只重试本地保存，不会重新发送提示词/);
});

test('Gemini upload intercepts native file choosers and recognizes current uploaded image chips', async () => {
  const source = await readFile(new URL('../src/main/geminiWebAutomation.ts', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(source, /Page\.setInterceptFileChooserDialog/);
  assert.match(source, /DOM\.setFileInputFiles/);
  assert.match(source, /data-test-id\*="uploaded-img"/);
  assert.match(main, /async function loadFreshGeminiConversation\(/);
  assert.match(main, /win\.loadURL\('about:blank'\)/);
  assert.match(main, /await loadFreshGeminiConversation\(win, automationUrl, 'Gemini 新对话'\)/);
});

test('Gemini waiters classify visible terminal alerts instead of waiting only on response cards', async () => {
  const source = await readFile(new URL('../src/main/geminiWebAutomation.ts', import.meta.url), 'utf8');

  assert.match(source, /pageFailureText/);
  assert.match(source, /\[role="alert"\]/);
  assert.match(source, /selectGeminiFailureText\(baseline, snapshot\.textCandidates, snapshot\.pageFailureText\)/);
});

test('Gemini composer verification supports textarea and contenteditable variants', async () => {
  const source = await readFile(new URL('../src/main/geminiWebAutomation.ts', import.meta.url), 'utf8');

  assert.match(source, /composer instanceof HTMLTextAreaElement \|\| composer instanceof HTMLInputElement/);
  assert.match(source, /const writtenValue =/);
});

test('Gemini navigation treats redirect aborts as recovered only on trusted provider or OAuth pages', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(main, /function isRecoveredGeminiNavigationAbort\(/);
  assert.match(main, /navigation === 'trusted-gemini' \|\| navigation === 'google-oauth'/);
  assert.match(main, /gemini-navigation-abort-recovered/);
  assert.match(main, /loadGeminiUrlRecoverably\(taskWindow, automationUrl/);
});

test('Gemini blank surfaces get one bounded background recovery without touching Google OAuth', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(main, /async function recoverGeminiSurfaceInBackground\(/);
  assert.match(main, /=== 'google-oauth'\) \{\s*return waitForGeminiPage/);
  assert.match(main, /win\.loadURL\('about:blank'\)/);
  assert.match(main, /gemini-surface-recovery-started/);
  assert.match(main, /gemini-surface-recovery-finished/);
  assert.doesNotMatch(main, /while \([^)]*recoverGeminiSurfaceInBackground/);
});
