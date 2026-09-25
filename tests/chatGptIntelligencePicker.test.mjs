import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { chatGptModelDomPolicy, isSameChatGptModelLabel, shouldForceChatGptHighReasoning } from '../dist-electron/shared/chatGptModelPolicy.js';
import { readChatGptReasoningState } from '../dist-electron/main/chatGptReasoningControl.js';

const compiled = fs.readFileSync(new URL('../dist-electron/main/index.js', import.meta.url), 'utf8');
const start = compiled.indexOf('function chatGptModelMenuScript');
const end = compiled.indexOf('\nconst chatGptTrustedModelMenuProbeScript', start);
assert.ok(start >= 0 && end > start);
const pageScript = (fn, ...args) => `(${fn.toString()})(...${JSON.stringify(args)})`;
const modelScript = new Function('pageScript', 'chatGptModelDomPolicy', `return (${compiled.slice(start, end)});`)(pageScript, chatGptModelDomPolicy);
const fixture = fs.readFileSync(new URL('./fixtures/chatgpt/intelligence-picker.html', import.meta.url), 'utf8');

function extractScript(name, next) {
  const a = compiled.indexOf(`const ${name} =`);
  const b = compiled.indexOf(`\nconst ${next}`, a);
  assert.ok(a >= 0 && b > a);
  const expression = compiled.slice(a, b).trim().replace(/;$/, '').split('=').slice(1).join('=');
  return new Function('pageScript', `return (${expression});`)(pageScript);
}
const baselineScript = extractScript('collectImageBaselineScript', 'generatedImageSnapshotScript');
const resultScript = extractScript('generatedImageSnapshotScript', 'candidateToPngDataUrlScript');
const analysisScript = extractScript('chatGptAssistantTextSnapshotScript', 'collectImageBaselineScript');
const probeStart = compiled.indexOf('const chatGptTrustedModelMenuProbeScript =');
const probeEnd = compiled.indexOf('\nasync function closeChatGptMenusWithTrustedKeyboard', probeStart);
const trustedProbe = new Function('pageScript', 'chatGptModelDomPolicy', `${compiled.slice(probeStart, probeEnd)}; return chatGptTrustedModelMenuProbeScript;`)(pageScript, chatGptModelDomPolicy);
const trustedStart = compiled.indexOf('async function inspectChatGptModelsWithTrustedClicks');
const trustedEnd = compiled.indexOf('\nasync function inspectChatGptModels(', trustedStart);

test('intelligence picker opens the active model view before selecting; Latest is a real choice', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    const catalog = await page.evaluate(modelScript(''));
    assert.equal(await page.evaluate(() => fixtureClicks.branch), 1, 'must expand the aria-labelled branch before reading inert options');
    assert.deepEqual(catalog.options.map(x => x.label), ['最新', 'GPT-5.6 Sol', 'GPT-5.5']);
    assert.equal(catalog.currentModel, '最新');
    const selected = await page.evaluate(modelScript('GPT-5.5'));
    assert.equal(selected.confirmed, true);
    assert.equal(selected.currentModel, 'GPT-5.5');
    assert.equal(await page.evaluate(() => fixtureClicks.hiddenOption), 0);
    const latest = await page.evaluate(modelScript('最新'));
    assert.equal(latest.confirmed, true);
    assert.equal(latest.currentModel, '最新');
  } finally {
    await browser.close();
  }
});

test('trusted model clicks confirm the checked item instead of the abbreviated quality pill', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    const inspect = new Function('closeChatGptMenusWithTrustedKeyboard', 'evalInPageWithTimeout', 'chatGptTrustedModelMenuProbeScript', 'isSameChatGptModelLabel', 'dispatchTrustedChatGptClick', 'sleep', `return (${compiled.slice(trustedStart, trustedEnd)});`)(
      () => page.keyboard.press('Escape'),
      (_wc, script) => page.evaluate(script), trustedProbe, isSameChatGptModelLabel,
      (_wc, target) => page.mouse.click(target.x, target.y), ms => new Promise(r => setTimeout(r, ms))
    );
    const selected = await inspect({ webContents: {} }, 'GPT-5.5');
    assert.equal(selected.confirmed, true);
    assert.equal(selected.currentModel, 'GPT-5.5');
    assert.equal(await page.evaluate(() => fixtureClicks.selection), 1);
    assert.equal(await page.evaluate(() => fixtureClicks.hiddenOption), 0);
  } finally { await browser.close(); }
});

test('Latest keeps the reasoning gate without pretending it is a fixed GPT version', () => {
  assert.equal(shouldForceChatGptHighReasoning('最新'), true);
  assert.equal(shouldForceChatGptHighReasoning('Latest'), true);
  assert.equal(isSameChatGptModelLabel('最新', 'GPT-5.6 Sol'), false);
});

test('new assistant sections advance the response baseline without accepting old or uploaded images', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><section data-testid="conversation-turn-1" data-turn="assistant">Previous response</section><form><div id="prompt-textarea" contenteditable="true">Current test prompt with enough characters for the baseline.</div></form></main>');
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const image = new Image();
      image.src = canvas.toDataURL();
      document.querySelector('section').append(image);
    });
    await page.locator('img').evaluate(x => x.decode());
    const baseline = await page.evaluate(baselineScript);
    assert.equal(baseline.assistantMessageCount, 1, 'section data-turn=assistant must be counted once');
    await page.evaluate(() => {
      const turn = document.createElement('section');
      turn.dataset.testid = 'conversation-turn-2';
      turn.dataset.turn = 'assistant';
      turn.textContent = JSON.stringify({ sceneDescription: 'Indoor room', poseDescription: 'Standing', faceDirectionDescription: 'Forward', lightingMakeupDescription: 'Daylight' });
      document.querySelector('main').append(turn);
    });
    const waiting = await page.evaluate(resultScript(baseline));
    assert.equal(waiting.assistantMessageCount, 2, 'generation waiter must see a new assistant signal');
    assert.equal(waiting.candidates.length, 0);
    const analysis = await page.evaluate(analysisScript(baseline));
    assert.equal(analysis.assistantMessageCount, 2);
    assert.ok(analysis.candidates.some(x => x.isNew && x.assistantAssociated && x.text.includes('Indoor room')));
    await page.evaluate(() => {
      const inner = document.createElement('div');
      inner.dataset.messageAuthorRole = 'assistant';
      document.querySelector('[data-testid="conversation-turn-2"]').append(inner);
    });
    assert.equal((await page.evaluate(resultScript(baseline))).assistantMessageCount, 2, 'nested message marker must not double-count a turn');
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      canvas.getContext('2d').fillRect(0, 0, 512, 512);
      const result = new Image();
      result.src = canvas.toDataURL();
      result.alt = 'Generated result';
      document.querySelector('[data-testid="conversation-turn-2"]').append(result);
      const upload = result.cloneNode();
      document.querySelector('form').append(upload);
    });
    await page.locator('img').evaluateAll(images => Promise.all(images.map(x => x.decode())));
    const generated = await page.evaluate(resultScript(baseline));
    assert.ok(generated.candidates.length > 0);
    assert.ok(generated.candidates.every(x => !baseline.sources.includes(x.src)));
    assert.equal(generated.rootStrategy, 'assistant-role');
  } finally {
    await browser.close();
  }
});

test('reasoning reads the active keyboard announcement, not an inert slider or generic open-menu label', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><button class="__composer-pill" aria-haspopup="menu">思考强度</button></form>
      <div role="menu">
        <div inert><input type="range" aria-label="思考强度" aria-valuetext="低"></div>
        <div role="menuitem" aria-label="能力" aria-describedby="current help" style="width:260px;height:32px">
          <span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="4" aria-valuenow="3" style="display:inline-block;width:28px;height:28px"></span>
        </div>
        <span id="current">极高，第 4 项，共 5 项。</span><span id="help">使用左右箭头键调整能力。</span>
      </div>`);
    const result = await readChatGptReasoningState({ executeJavaScript: script => page.evaluate(script) });
    assert.equal(result.quality, 'extreme');
  } finally { await browser.close(); }
});
