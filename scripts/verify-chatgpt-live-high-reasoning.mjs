import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeChatGptWindow } from '../dist-electron/main/chromeChatGpt.js';
import { ensureChatGptHighReasoning } from '../dist-electron/main/chatGptReasoningControl.js';
import { chatGptModelDomPolicy } from '../dist-electron/shared/chatGptModelPolicy.js';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileDir = path.resolve(process.env.XIANGMAO_LIVE_CHROME_PROFILE || 'D:\\Xiangmao-Workshop\\AppData\\ChatGPT-Chrome');
const artifactRoot = path.resolve('D:\\Xiangmao-Workshop\\TestArtifacts\\1.1.4-chatgpt-high-reasoning');
const targetUrl = 'https://chatgpt.com/';
const requestedTarget = process.env.XIANGMAO_LIVE_REASONING_TARGET?.trim() || '';
const expectedBefore = process.env.XIANGMAO_LIVE_REASONING_EXPECTED_BEFORE?.trim() || '';
const presetExtreme = process.env.XIANGMAO_LIVE_REASONING_PRESET_EXTREME === '1';

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clickTarget = async (webContents, target) => {
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target });
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...target, button: 'left', clickCount: 1
  });
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...target, button: 'left', clickCount: 1
  });
};
const closeMenus = async (webContents) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
    });
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
    });
    await wait(120);
  }
};

async function inspectModels(webContents, requestedModel = '') {
  let snapshot;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    snapshot = await webContents.executeJavaScript(chatGptModelMenuScript(requestedModel), true);
    if (snapshot.triggerFound && (!requestedModel || snapshot.confirmed)) return snapshot;
    if (snapshot.trustedClickTarget) {
      await clickTarget(webContents, snapshot.trustedClickTarget);
      await wait(650);
    } else {
      await wait(Math.min(800 + attempt * 300, 2400));
    }
  }
  return snapshot;
}

async function presetExtremeReasoning(webContents) {
  let slider;
  for (let openAttempt = 0; openAttempt < 3 && !slider; openAttempt += 1) {
    await closeMenus(webContents);
    const trigger = await webContents.executeJavaScript(`(() => {
      const visible = (element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const element = [...document.querySelectorAll('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')]
        .filter(visible)
        .filter((candidate) => candidate.closest('form, [data-testid*="composer"], [class*="composer"]'))
        .map((candidate) => {
          const text = candidate.innerText || candidate.textContent || '';
          const className = typeof candidate.className === 'string' ? candidate.className : '';
          return {
            candidate,
            text,
            score: (/5[.-]5/i.test(text) ? 240 : 0) + (/composer-pill/i.test(className) ? 180 : 0) +
              (candidate.getBoundingClientRect().width <= 220 ? 20 : 0)
          };
        })
        .filter(({ score }) => score >= 240)
        .sort((left, right) => right.score - left.score)[0]?.candidate;
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`, true);
    assert.ok(trigger, 'The real GPT-5.5 reasoning trigger was not found for the extreme preset.');
    await clickTarget(webContents, trigger);
    for (let attempt = 0; attempt < 12 && !slider; attempt += 1) {
      await wait(150);
      slider = await webContents.executeJavaScript(`(() => {
      const element = [...document.querySelectorAll('input[type="range"], [role="slider"]')]
      .find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(candidate).pointerEvents !== 'none';
      });
    if (!element) return null;
    const thumb = element.getBoundingClientRect();
    let track = element;
    for (let ancestor = element.parentElement, depth = 0; ancestor && depth < 4; ancestor = ancestor.parentElement, depth += 1) {
      const box = ancestor.getBoundingClientRect();
      if (box.width >= Math.max(120, thumb.width * 2) && box.height <= Math.max(72, thumb.height * 2.5)) {
        track = ancestor;
        break;
      }
    }
    const box = track.getBoundingClientRect();
    return { x: box.left + box.width * 0.75, y: box.top + box.height / 2 };
      })()`, true);
    }
  }
  assert.ok(slider, 'The real GPT-5.5 reasoning slider was not interactive for the extreme preset.');
  await clickTarget(webContents, slider);
  await wait(350);
  const label = await webContents.executeJavaScript(`(() => [...document.querySelectorAll('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')]
    .map((element) => (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim())
    .find((text) => /5[.-]5/i.test(text)) || '')()`, true);
  assert.match(label, /(?:极高|extreme)/i, 'The live prerequisite did not reach extreme reasoning.');
}

await mkdir(artifactRoot, { recursive: true });
let window;
try {
  window = await createChromeChatGptWindow({ profileDir, url: targetUrl, mode: 'background' });
  await window.loadURL(targetUrl);
  const initial = await inspectModels(window.webContents);
  assert.equal(initial?.triggerFound, true, 'The real ChatGPT model control was not found.');
  const available = initial.options.map((option) => option.label);
  const originalModel = initial.currentModel || initial.options.find((option) => option.current)?.label;
  assert.ok(originalModel, 'The current real ChatGPT model was not identified.');
  const targets = requestedTarget ? [requestedTarget] : ['GPT-5.6 Sol', 'GPT-5.5'];
  for (const target of targets) assert.ok(available.includes(target), `The real account does not expose ${target}.`);

  const verified = [];
  for (const target of targets) {
    const selected = await inspectModels(window.webContents, target);
    assert.equal(selected?.confirmed, true, `The real page did not confirm ${target}.`);
    if (presetExtreme) await presetExtremeReasoning(window.webContents);
    const reasoning = await ensureChatGptHighReasoning(window.webContents, target);
    if (expectedBefore) {
      assert.equal(reasoning.before, expectedBefore, `The real ${target} reasoning state did not start at ${expectedBefore}.`);
    }
    assert.equal(reasoning.required, true);
    assert.equal(reasoning.confirmed, true, `The real page did not confirm high reasoning for ${target}.`);
    assert.equal(reasoning.after, 'high');
    verified.push({ target, reasoning });
  }

  const savedSettings = await readFile(path.join(path.dirname(profileDir), 'settings.json'), 'utf8')
    .then((value) => JSON.parse(value))
    .catch(() => ({}));
  const configuredModel = available.includes(savedSettings.chatGptModel) ? savedSettings.chatGptModel : originalModel;
  const lastVerifiedModel = targets.at(-1);
  if (configuredModel !== lastVerifiedModel) {
    const restored = await inspectModels(window.webContents, configuredModel);
    assert.equal(restored?.confirmed, true, `The configured model ${configuredModel} was not restored.`);
  }
  const finalReasoning = await ensureChatGptHighReasoning(window.webContents, configuredModel);
  if (/5[.-](?:5|6)/.test(configuredModel)) {
    assert.equal(finalReasoning.confirmed, true, 'The configured 5.5/5.6 model did not retain high reasoning.');
  }

  const report = {
    ok: true,
    originalModel,
    available,
    verified,
    configuredModel,
    finalReasoning
  };
  await writeFile(path.join(artifactRoot, 'live-high-reasoning.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (window && !window.isDestroyed()) window.destroy();
  await wait(500);
}
