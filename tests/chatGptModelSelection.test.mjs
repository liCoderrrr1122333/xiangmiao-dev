import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyChatGptReasoningLabel,
  dedupeChatGptModelOptions,
  findRequestedChatGptModel,
  followCurrentChatGptModel,
  isChatGptAdvancedMenuBranchLabel,
  isChatGptComposerModeLabel,
  isChatGptModelMenuBranchLabel,
  isChatGptModelOptionLabel,
  isSameChatGptModelLabel,
  normalizeChatGptModelLabel,
  scoreChatGptModelControl,
  shouldForceChatGptHighReasoning
} from '../dist-electron/shared/chatGptModelPolicy.js';

test('model policy preserves follow-current and resolves only exact live labels', () => {
  const catalog = {
    ok: true,
    currentModel: 'GPT 5 Thinking',
    refreshedAt: new Date().toISOString(),
    message: 'ok',
    models: [
      { id: 'thinking', label: 'GPT 5 Thinking', current: true },
      { id: 'instant', label: 'GPT 5 Instant', current: false }
    ]
  };
  assert.equal(findRequestedChatGptModel(catalog, followCurrentChatGptModel), undefined);
  assert.equal(findRequestedChatGptModel(catalog, 'GPT 5 Instant')?.id, 'instant');
  assert.equal(findRequestedChatGptModel(catalog, 'GPT 5')?.id, undefined);
  assert.equal(normalizeChatGptModelLabel('当前模型 GPT 5 Thinking'), 'gpt 5 thinking');
});

test('live model options are deduplicated without a hardcoded model list', () => {
  const options = dedupeChatGptModelOptions([
    { id: 'one', label: 'GPT 5 Thinking', current: true },
    { id: 'two', label: '  GPT 5 Thinking  ', current: false },
    { id: 'three', label: 'GPT 5 Instant', current: false }
  ]);
  assert.deepEqual(options.map((option) => option.id), ['one', 'three']);
});

test('nested composer model entries are accepted while thinking modes are rejected', () => {
  assert.equal(isChatGptModelOptionLabel('GPT-5.6 Sol'), true);
  assert.equal(isChatGptModelOptionLabel('GPT-5.5'), true);
  assert.equal(isChatGptModelOptionLabel('GPT-5.3'), true);
  assert.equal(isChatGptModelOptionLabel('o3'), true);
  assert.equal(isChatGptModelOptionLabel('高'), false);
  assert.equal(isChatGptModelOptionLabel('极速 5.5'), false);
  assert.equal(isChatGptModelOptionLabel('yyy hale Plus'), false);
});

test('composer shorthand and full ChatGPT model labels identify the same requested model', () => {
  assert.equal(isSameChatGptModelLabel('5.5', 'GPT-5.5'), true);
  assert.equal(isSameChatGptModelLabel('5.6 Sol', 'GPT-5.6 Sol'), true);
  assert.equal(isSameChatGptModelLabel('5.6 Sol', 'GPT-5.6 Terra'), false);
  assert.equal(isSameChatGptModelLabel('轻度', 'GPT-5.5'), false);
});

test('current ChatGPT composer quality and nested menu branch labels are classified separately', () => {
  assert.equal(isChatGptComposerModeLabel('高'), true);
  assert.equal(isChatGptComposerModeLabel('5.5 高'), true);
  assert.equal(isChatGptComposerModeLabel('GPT-5.5'), false);
  assert.equal(isChatGptAdvancedMenuBranchLabel('高级'), true);
  assert.equal(isChatGptAdvancedMenuBranchLabel('Advanced'), true);
  assert.equal(isChatGptAdvancedMenuBranchLabel('思考强度'), false);
  assert.equal(isChatGptModelMenuBranchLabel('模型'), true);
  assert.equal(isChatGptModelMenuBranchLabel('Model'), true);
  assert.equal(isChatGptModelMenuBranchLabel('GPT-5.6 Sol'), true);
  assert.equal(isChatGptModelMenuBranchLabel('高级'), false);
});

test('GPT-5.5 and every GPT-5.6 variant require an exact high reasoning gate', () => {
  assert.equal(shouldForceChatGptHighReasoning('GPT-5.5'), true);
  assert.equal(shouldForceChatGptHighReasoning('5.5 标准'), true);
  assert.equal(shouldForceChatGptHighReasoning('GPT-5.6 Sol'), true);
  assert.equal(shouldForceChatGptHighReasoning('5.6 Terra 低'), true);
  assert.equal(shouldForceChatGptHighReasoning('o3'), false);
  assert.equal(shouldForceChatGptHighReasoning('GPT-5.3'), false);
  assert.equal(classifyChatGptReasoningLabel('5.6 Sol 标准'), 'medium');
  assert.equal(classifyChatGptReasoningLabel('5.5 高'), 'high');
  assert.equal(classifyChatGptReasoningLabel('5.6 Sol 极高'), 'extreme');
  assert.equal(classifyChatGptReasoningLabel('高级'), 'unknown');
});

test('profile and account menus can never be mistaken for the ChatGPT model selector', () => {
  assert.equal(scoreChatGptModelControl({
    testId: 'accounts-profile-button',
    ariaLabel: 'yyy hale Plus，打开“个人资料”菜单',
    title: '',
    text: 'yyy hale Plus',
    hasPopup: true,
    top: 756,
    insideComposer: false,
    insideSidebar: true
  }), -1);
  assert.equal(scoreChatGptModelControl({
    testId: '',
    ariaLabel: 'Open profile menu',
    title: '',
    text: 'ChatGPT Pro',
    hasPopup: true,
    top: 12,
    insideComposer: false,
    insideSidebar: false
  }), -1);
});

test('model selector ranking requires a structural or explicit semantic marker', () => {
  assert.ok(scoreChatGptModelControl({
    testId: 'model-switcher-dropdown-button',
    ariaLabel: 'Model selector, current model is GPT 5 Thinking',
    title: '',
    text: 'GPT 5 Thinking',
    hasPopup: true,
    top: 12,
    insideComposer: false,
    insideSidebar: false
  }) >= 200);
  assert.ok(scoreChatGptModelControl({
    testId: '',
    ariaLabel: '选择模型，当前模型为 GPT 5 Instant',
    title: '',
    text: 'GPT 5 Instant',
    hasPopup: true,
    top: 12,
    insideComposer: false,
    insideSidebar: false
  }) >= 100);
  assert.equal(scoreChatGptModelControl({
    testId: '',
    ariaLabel: '',
    title: '',
    text: 'GPT 5.6 Pro',
    hasPopup: false,
    top: 12,
    insideComposer: false,
    insideSidebar: false
  }), -1);
});

test('automation validates the requested model before revealing the upload input', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const validationIndex = main.indexOf('await ensureChatGptModelForSend(event, win, settings.chatGptModel, settings.chatGptWorkMode)');
  const uploadIndex = main.indexOf("emitAutomationStatus(event, { step: '正在后台准备文件上传入口'", validationIndex);
  assert.ok(validationIndex > 0);
  assert.ok(uploadIndex > validationIndex);
  assert.match(main, /本轮已在上传附件前停止，没有静默切换到其他模型/);
  assert.match(main, /await ensureChatGptHighReasoningForSend\(event, win,/);
  assert.match(main, /function registerTrustedIpcHandler\(channel: string, listener: TrustedIpcHandler\)/);
  assert.match(main, /registerTrustedIpcHandler\('chatgpt:list-models'/);
  assert.match(main, /const coldStart = !hasRecentConfirmedChatGptLogin\(backend\);[\s\S]*?if \(coldStart\) \{[\s\S]*?await checkChatGptLogin\(targetUrl, false, undefined, false, backend\)/);
  assert.match(main, /chatGptModelDomPolicy/);
  assert.match(main, /composerModePattern/);
  assert.match(main, /advancedMenuPattern/);
  assert.match(main, /modelBranchPattern/);
  assert.match(main, /modelOptionPattern/);
  assert.match(main, /PointerEvent\('pointerdown'/);
  assert.match(main, /PointerEvent\('pointerover'/);
  assert.match(main, /inspectChatGptModelsWithTrustedClicks/);
  assert.match(main, /Input\.dispatchMouseEvent/);
  assert.match(main, /Input\.dispatchKeyEvent/);
  assert.match(main, /for \(let attempt = 1; attempt < Math\.max\(1, maxProbes\) && !snapshot\.triggerFound; attempt \+= 1\) \{[\s\S]*?await sleep\(Math\.min\(1200 \* attempt, 3600\)\);[\s\S]*?chatGptModelMenuScript\(requestedModel\)/);
  assert.match(main, /inspectChatGptModels\(win, '', coldStart \? 10 : 3\)/);
  assert.doesNotMatch(main, /\/gpt\|chatgpt\|thinking\|instant\|pro\/\.test\(marker\)/);
  assert.match(preload, /ipcRenderer\.invoke\('chatgpt:list-models'/);
  assert.match(app, /跟随当前模型/);
  assert.match(app, /chatGptModelCatalog\?\.models\.map/);
  assert.match(app, /读取 \$\{webAiProviderLabel\(provider\)\} 模型超过 60 秒/);
});

test('an already verified per-page model and reasoning configuration skips repeated picker input', async () => {
  const [main, reasoning] = await Promise.all([
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/chatGptReasoningControl.ts', import.meta.url), 'utf8')
  ]);
  assert.match(main, /const chatGptVerifiedConfigByPage = new WeakMap/);
  assert.match(main, /chatgpt-config-reused/);
  assert.match(main, /readChatGptReasoningState/);
  assert.match(reasoning, /export async function readChatGptReasoningState/);
  assert.match(
    reasoning,
    /let snapshot = await probeReasoning\(webContents\);[\s\S]{0,320}if \(before === target\)[\s\S]{0,180}steps: 0/,
    'the passive exact-match path must return before closing menus or sending keys'
  );
});

test('prompt panel omits redundant protection status chips without weakening prompt rules', async () => {
  const panel = await readFile(new URL('../src/renderer/components/PromptOutputPanel.tsx', import.meta.url), 'utf8');
  const promptRules = await readFile(new URL('../src/renderer/prompt/PromptBuilder.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /只编辑红圈内|红圈外锁定|保持原图光影|提示词已就绪/);
  assert.match(promptRules, /【保护边界】/);
  assert.match(promptRules, /只允许编辑/);
  assert.match(promptRules, /环境光、画质和最终像素尺寸保持主垫图不变/);
});
