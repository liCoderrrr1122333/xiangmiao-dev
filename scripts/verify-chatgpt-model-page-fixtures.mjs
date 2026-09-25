import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeChatGptWindow } from '../dist-electron/main/chromeChatGpt.js';
import { ensureChatGptHighReasoning } from '../dist-electron/main/chatGptReasoningControl.js';
import { chatGptModelDomPolicy } from '../dist-electron/shared/chatGptModelPolicy.js';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoDir, 'tests', 'fixtures', 'chatgpt', 'nested-model-menu.html');
const tempRoot = path.resolve('D:\\Yaochuang-Workshop\\TestArtifacts\\1.1.4-stability');
const profileDir = path.join(tempRoot, `chatgpt-model-fixture-${process.pid}`);
if (!profileDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error(`Unsafe fixture profile: ${profileDir}`);

const compiledMain = fs.readFileSync(path.join(repoDir, 'dist-electron', 'main', 'index.js'), 'utf8');
const functionStart = compiledMain.indexOf('function chatGptModelMenuScript');
const functionEnd = compiledMain.indexOf('\nconst chatGptTrustedModelMenuProbeScript', functionStart);
if (functionStart < 0 || functionEnd < 0) throw new Error('Unable to locate the compiled ChatGPT model page script.');
const functionSource = compiledMain.slice(functionStart, functionEnd).trim();
const pageScript = (fn, ...args) => `(${fn.toString()})(...${JSON.stringify(args)})`;
const chatGptModelMenuScript = new Function(
  'pageScript',
  'chatGptModelDomPolicy',
  `return (${functionSource});`
)(pageScript, chatGptModelDomPolicy);

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(fs.readFileSync(fixturePath));
});

fs.mkdirSync(tempRoot, { recursive: true });
fs.rmSync(profileDir, { recursive: true, force: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const fixtureUrl = `http://127.0.0.1:${port}/nested-model-menu.html`;

let window;
try {
  window = await createChromeChatGptWindow({ profileDir, url: fixtureUrl, mode: 'background' });
  await window.loadURL(fixtureUrl);

  const initial = await window.webContents.executeJavaScript(chatGptModelMenuScript(''), true);
  assert.equal(initial.triggerFound, true);
  assert.equal(initial.currentModel, 'GPT-5.6 Sol');
  assert.deepEqual(initial.options.map((option) => option.label), ['GPT-5.6 Sol', 'GPT-5.5', 'o3']);

  const high56 = await ensureChatGptHighReasoning(window.webContents, 'GPT-5.6 Sol');
  assert.equal(high56.required, true);
  assert.equal(high56.confirmed, true);
  assert.equal(high56.before, 'medium');
  assert.equal(high56.after, 'high');
  const high56State = await window.webContents.executeJavaScript(`({
    value: document.querySelector('#reasoning-slider').value,
    valueText: document.querySelector('#reasoning-slider').getAttribute('aria-valuetext'),
    composer: document.querySelector('#quality-label').textContent.trim()
  })`, true);
  assert.deepEqual(high56State, { value: '2', valueText: '高', composer: '5.6 Sol 高' });

  await window.webContents.executeJavaScript(`(() => {
    const slider = document.querySelector('#reasoning-slider');
    slider.value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);

  const selected = await window.webContents.executeJavaScript(chatGptModelMenuScript('GPT-5.5'), true);
  assert.equal(selected.requestedAvailable, true);
  assert.equal(selected.confirmed, true);
  assert.equal(selected.currentModel, 'GPT-5.5');
  const preHigh55 = await window.webContents.executeJavaScript("document.querySelector('#quality-label').textContent.trim()", true);
  assert.equal(preHigh55, '5.5 标准');
  const high55 = await ensureChatGptHighReasoning(window.webContents, 'GPT-5.5');
  assert.equal(high55.required, true);
  assert.equal(high55.confirmed, true);
  assert.equal(high55.after, 'high');

  await window.webContents.executeJavaScript('window.configureFineGrainedReasoning()', true);
  const fineGrainedHigh55 = await ensureChatGptHighReasoning(window.webContents, 'GPT-5.5');
  assert.equal(fineGrainedHigh55.required, true);
  assert.equal(fineGrainedHigh55.confirmed, true);
  assert.equal(fineGrainedHigh55.before, 'low');
  assert.equal(fineGrainedHigh55.after, 'high');

  await window.webContents.executeJavaScript('window.configureHomeIgnoringReasoning()', true);
  const homeIgnoringHigh55 = await ensureChatGptHighReasoning(window.webContents, 'GPT-5.5');
  assert.equal(homeIgnoringHigh55.required, true);
  assert.equal(homeIgnoringHigh55.confirmed, true);
  assert.equal(homeIgnoringHigh55.before, 'extreme');
  assert.equal(homeIgnoringHigh55.after, 'high');

  const postHomeIgnoringState = await window.webContents.executeJavaScript(`({
    model: document.querySelector('#current-model').textContent.trim(),
    quality: document.querySelector('#quality-label').textContent.trim(),
    openMenus: [...document.querySelectorAll('[role=menu]')].filter((element) => !element.hidden).length
  })`, true);
  assert.deepEqual(postHomeIgnoringState, { model: 'GPT-5.5', quality: '5.5 高', openMenus: 0 });

  await window.webContents.executeJavaScript('window.configureLayeredMenuExitReasoning()', true);
  const layeredExitHigh55 = await ensureChatGptHighReasoning(window.webContents, 'GPT-5.5');
  assert.equal(layeredExitHigh55.required, true);
  assert.equal(layeredExitHigh55.confirmed, true);
  assert.equal(layeredExitHigh55.before, 'extreme');
  assert.equal(layeredExitHigh55.after, 'high');

  await window.webContents.executeJavaScript(`(() => {
    window.configureHomeIgnoringReasoning();
    window.ignoreNextQualityClick();
  })()`, true);
  const ignoredFirstClickHigh55 = await ensureChatGptHighReasoning(window.webContents, 'GPT-5.5');
  assert.equal(ignoredFirstClickHigh55.required, true);
  assert.equal(ignoredFirstClickHigh55.confirmed, true);
  assert.equal(ignoredFirstClickHigh55.before, 'extreme');
  assert.equal(ignoredFirstClickHigh55.after, 'high');

  await window.webContents.executeJavaScript('window.configureStandardReasoning()', true);

  for (let cycle = 0; cycle < 20; cycle += 1) {
    const snapshot = await window.webContents.executeJavaScript(chatGptModelMenuScript(''), true);
    assert.equal(snapshot.triggerFound, true, `cycle ${cycle + 1} did not find the nested model control`);
    assert.equal(snapshot.currentModel, 'GPT-5.5', `cycle ${cycle + 1} lost the selected model`);
    const openMenus = await window.webContents.executeJavaScript(
      "[...document.querySelectorAll('[role=menu]')].filter((element) => !element.hidden).length",
      true
    );
    assert.equal(openMenus, 0, `cycle ${cycle + 1} left a menu open`);
    const quality = await window.webContents.executeJavaScript("document.querySelector('#quality-label').textContent.trim()", true);
    assert.equal(quality, '5.5 高', `cycle ${cycle + 1} lost high reasoning`);
  }

  console.log(JSON.stringify({
    ok: true,
    initialModels: initial.options.map((option) => option.label),
    selectedModel: selected.currentModel,
    high56,
    high55,
    fineGrainedHigh55,
    homeIgnoringHigh55,
    layeredExitHigh55,
    ignoredFirstClickHigh55,
    repeatedCycles: 20
  }, null, 2));
} finally {
  if (window && !window.isDestroyed()) window.destroy();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 400));
  fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}
