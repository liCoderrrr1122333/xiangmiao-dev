import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeChatGptWindow } from '../dist-electron/main/chromeChatGpt.js';
import { isConfirmedGeminiLogin, isConfirmedGeminiLogout } from '../dist-electron/main/geminiBrowserPolicy.js';
import { inspectGeminiModels, waitForGeminiPage } from '../dist-electron/main/geminiWebAdapter.js';
import {
  captureGeminiBaseline,
  downloadGeminiImage,
  enableGeminiImageMode,
  resetGeminiComposer,
  sendGeminiPrompt,
  setGeminiPrompt,
  uploadAndConfirmGeminiAttachments,
  uploadGeminiAttachments,
  waitForGeminiAttachments,
  waitForGeminiComposerReady,
  waitForGeminiImageResult,
  waitForGeminiSendAcceptance,
  waitForGeminiTextResult
} from '../dist-electron/main/geminiWebAutomation.js';
import { canSafelyRetryGeminiSend } from '../dist-electron/main/geminiAutomationPolicy.js';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(repoDir, '.tmp');
const suppliedProfileDir = process.env.XIANGMAO_GEMINI_PROFILE_DIR?.trim();
const profileDir = suppliedProfileDir
  ? path.resolve(suppliedProfileDir)
  : path.join(tempRoot, `gemini-live-surface-${process.pid}`);
const ownsProfile = !suppliedProfileDir;
const exerciseModelSelection = process.env.XIANGMAO_TEST_GEMINI_MODEL_SELECTION === '1';
const liveFlow = process.env.XIANGMAO_TEST_GEMINI_FLOW?.trim().toLowerCase();
if (liveFlow && !['analysis', 'generation'].includes(liveFlow)) {
  throw new Error(`Unsupported Gemini live flow: ${liveFlow}`);
}
const exerciseAttachmentUpload = process.env.XIANGMAO_TEST_GEMINI_UPLOAD === '1' || Boolean(liveFlow);
const liveUploadPath = path.join(tempRoot, `gemini-live-upload-${process.pid}.jpg`);
const flowAttachmentPath = path.join(repoDir, 'dist', 'xiangmao-unified-v2.png');
const flowArtifactRoot = 'D:\\Xiangmao-Workshop\\TestArtifacts\\1.1.4-gemini-live';
if (ownsProfile && !profileDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error(`Unsafe live profile: ${profileDir}`);
fs.mkdirSync(tempRoot, { recursive: true });
if (ownsProfile) fs.rmSync(profileDir, { recursive: true, force: true });

let rootWindow;
let window;
try {
  rootWindow = await createChromeChatGptWindow({
    profileDir,
    url: suppliedProfileDir ? 'https://chatgpt.com/' : 'https://gemini.google.com/app',
    mode: 'background'
  });
  window = suppliedProfileDir && rootWindow.createTab
    ? await rootWindow.createTab('about:blank')
    : rootWindow;
  try {
    await window.loadURL('https://gemini.google.com/app');
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (!/ERR_ABORTED|\(-3\)/i.test(error instanceof Error ? error.message : String(error)) ||
        !/^https:\/\/(?:[^/]+\.)?(?:gemini\.google\.com|accounts\.google\.com)\//i.test(window.webContents.getURL())) {
      throw error;
    }
  }
  let probe = await waitForGeminiPage(window.webContents, 45_000);
  if (probe && !probe.composerReady && !probe.loginVisible && !probe.authUrl) {
    await window.loadURL('about:blank');
    try {
      await window.loadURL('https://gemini.google.com/app');
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (!/ERR_ABORTED|\(-3\)/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
    probe = await waitForGeminiPage(window.webContents, 30_000);
  }
  const liveStructure = await window.webContents.executeJavaScript(`(() => {
    const clean = (value) => String(value || '').replace(/[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}/g, '[redacted-email]').replace(/\\s+/g, ' ').trim().slice(0, 120);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const describe = (element) => ({
      tag: element.tagName.toLowerCase(),
      role: clean(element.getAttribute('role')),
      aria: clean(element.getAttribute('aria-label')),
      testId: clean(element.getAttribute('data-test-id')),
      text: clean(element.innerText || element.textContent),
      contenteditable: clean(element.getAttribute('contenteditable'))
    });
    return {
      url: location.href,
      readyState: document.readyState,
      textboxes: [...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')].filter(visible).slice(0, 20).map(describe),
      controls: [...document.querySelectorAll('button,[role="button"],a')].filter(visible).slice(0, 60).map(describe)
    };
  })()`, true).catch(() => undefined);
  assert.ok(probe, 'Gemini official page did not expose a rendered login or composer surface.');
  assert.ok(
    probe.composerReady || probe.loginVisible || probe.authUrl || probe.regionBlocked,
    `Gemini official page structure is not recognized: ${JSON.stringify({
      url: probe.url,
      bodyTextLength: probe.bodyTextLength,
      composerReady: probe.composerReady,
      loginVisible: probe.loginVisible,
      authUrl: probe.authUrl,
      liveStructure
    })}`
  );
  const loggedIn = isConfirmedGeminiLogin(probe);
  let modelCatalog = loggedIn ? await inspectGeminiModels(window.webContents) : undefined;
  let modelSelectionVerification;
  if (loggedIn && exerciseModelSelection && modelCatalog?.ok) {
    const originalModel = modelCatalog.currentModel;
    const alternateModel = modelCatalog.models.find((model) => model.label !== originalModel)?.label;
    assert.ok(originalModel && alternateModel, 'Gemini model selection verification needs two available models.');
    const selected = await inspectGeminiModels(window.webContents, alternateModel);
    assert.equal(selected.ok, true, selected.message);
    assert.equal(selected.currentModel, alternateModel);
    const restored = await inspectGeminiModels(window.webContents, originalModel);
    assert.equal(restored.ok, true, restored.message);
    assert.equal(restored.currentModel, originalModel);
    modelCatalog = restored;
    modelSelectionVerification = { originalModel, alternateModel, restored: true };
  }
  let attachmentUploadVerification;
  if (loggedIn && exerciseAttachmentUpload && !liveFlow) {
    fs.writeFileSync(liveUploadPath, Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64'));
    const receipt = await uploadGeminiAttachments(window.webContents, [liveUploadPath]);
    const confirmation = await waitForGeminiAttachments(window.webContents, [liveUploadPath], 20_000, receipt);
    attachmentUploadVerification = {
      method: receipt.method,
      attachmentCount: confirmation.attachmentCount,
      nameHits: confirmation.nameHits,
      selectedFileCount: confirmation.selectedFileCount,
      inputEventCount: confirmation.inputEventCount
    };
  }
  let fullFlowVerification;
  if (loggedIn && liveFlow) {
    assert.equal(fs.existsSync(flowAttachmentPath), true, `Gemini live fixture is missing: ${flowAttachmentPath}`);
    const clean = await resetGeminiComposer(window.webContents);
    assert.equal(clean.ok, true, `Gemini live composer was not clean: ${JSON.stringify(clean)}`);
    if (liveFlow === 'generation') {
      const imageMode = await enableGeminiImageMode(window.webContents);
      assert.equal(imageMode.ok, true, 'Gemini live page did not expose a stable direct-prompt composer.');
      assert.equal(imageMode.strategy, 'direct-prompt');
    }
    const upload = await uploadAndConfirmGeminiAttachments(window.webContents, [flowAttachmentPath], 45_000);
    const prompt = liveFlow === 'analysis'
      ? '观察附件中的像锚图标。只返回一个 JSON 对象，不要 Markdown，不要解释。字段必须完整：{"sceneDescription":"画面内容","poseDescription":"主体姿态","faceDirectionDescription":"主体朝向","lightingMakeupDescription":"光影和色彩","negativePrompt":"不需要出现的内容"}'
      : '请直接生成一张新图片。根据附件中的像锚图标，生成一张全新的 1:1 极简专业桌面创作工具图标。主体清晰，使用冷中性色背景。请依据附件完成图片生成或编辑，并在当前回复中返回最终图片；不要只提供文字说明。';
    assert.equal(await setGeminiPrompt(window.webContents, prompt), true, 'Gemini live prompt was not written.');
    const ready = await waitForGeminiComposerReady(window.webContents, 1, 60_000);
    assert.equal(ready.ready, true, `Gemini live composer did not pass the final send gate: ${JSON.stringify(ready)}`);
    const baseline = await captureGeminiBaseline(window.webContents);
    let sendAction = await sendGeminiPrompt(window.webContents);
    assert.equal(sendAction.sent, true, `Gemini live send control was not actionable: ${JSON.stringify(sendAction)}`);
    let acceptance = await waitForGeminiSendAcceptance(window.webContents, baseline, 30_000);
    if (!acceptance.accepted && canSafelyRetryGeminiSend(baseline, acceptance.snapshot)) {
      sendAction = await sendGeminiPrompt(window.webContents);
      if (sendAction.sent) acceptance = await waitForGeminiSendAcceptance(window.webContents, baseline, 30_000);
    }
    assert.equal(acceptance.accepted, true, `Gemini live send was not accepted: ${JSON.stringify(acceptance)}`);

    if (liveFlow === 'analysis') {
      const result = await waitForGeminiTextResult(
        window.webContents,
        baseline,
        180_000,
        (text) => ['sceneDescription', 'poseDescription', 'faceDirectionDescription', 'lightingMakeupDescription', 'negativePrompt']
          .every((key) => text.includes(`"${key}"`))
      );
      assert.equal(Boolean(result.failure), false, `Gemini live analysis failed: ${result.text}`);
      fullFlowVerification = {
        mode: liveFlow,
        sendMethod: sendAction.method,
        uploadAttempts: upload.attempts,
        responseLength: result.text.length,
        responsePreview: result.text.slice(0, 500)
      };
    } else {
      const result = await waitForGeminiImageResult(window.webContents, baseline, 300_000);
      assert.equal(Boolean(result.failure), false, `Gemini live generation failed: ${result.failureText || result.failure?.code}`);
      const downloaded = await downloadGeminiImage(window.webContents, result.candidate);
      const match = downloaded.dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/s);
      assert.ok(match, 'Gemini live result was not returned as an image data URL.');
      fs.mkdirSync(flowArtifactRoot, { recursive: true });
      const outputPath = path.join(flowArtifactRoot, `gemini-live-generation-${Date.now()}.png`);
      fs.writeFileSync(outputPath, Buffer.from(match[1], 'base64'));
      fullFlowVerification = {
        mode: liveFlow,
        sendMethod: sendAction.method,
        uploadAttempts: upload.attempts,
        width: downloaded.width || result.candidate.width,
        height: downloaded.height || result.candidate.height,
        bytes: fs.statSync(outputPath).size,
        outputPath
      };
    }
  }
  const modelMenuStructure = loggedIn && suppliedProfileDir
    ? await window.webContents.executeJavaScript(`(async () => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
        };
        const controls = [...document.querySelectorAll('button,[role="button"],[data-test-id]')].filter(visible);
        const trigger = controls.find((element) =>
          /bard-mode-menu-button|model-(?:selector|picker|switcher)/i.test(element.getAttribute('data-test-id') || '')
        ) || controls.find((element) =>
          /^(?:\\d+(?:\\.\\d+)*\\s+)?(?:flash(?:-lite)?|pro|thinking|扩展思考|深度思考|智能|快速)(?:\\s*[⌄▼▾])?$/i.test((element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim())
        );
        const hasVisibleOptions = [...document.querySelectorAll('[data-test-id*="bard-mode-option"],[data-test-id*="model-option"],[data-test-id*="mode-option"]')]
          .some(visible);
        if (!hasVisibleOptions) {
          trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
          trigger?.click();
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 180);
        const items = [...document.querySelectorAll('button,[role="menuitem"],[role="menuitemradio"],[role="option"],[data-test-id]')]
          .filter((element) => visible(element) && (
            /bard-mode-option|model-option|mode-option/i.test(element.getAttribute('data-test-id') || '') ||
            /(?:flash|pro|thinking|扩展思考|深度思考|智能|快速)/i.test(element.innerText || element.textContent || '')
          ));
        const result = items.map((element) => ({
          testId: clean(element.getAttribute('data-test-id')),
          text: clean(element.innerText || element.textContent),
          ariaChecked: clean(element.getAttribute('aria-checked')),
          ariaSelected: clean(element.getAttribute('aria-selected')),
          dataSelected: clean(element.getAttribute('data-selected')),
          dataState: clean(element.getAttribute('data-state')),
          className: clean(element.getAttribute('class')),
          selectedMarkers: [...element.querySelectorAll('[aria-label],[data-state],[data-selected],mat-pseudo-checkbox')]
            .map((child) => clean([child.tagName, child.getAttribute('aria-label'), child.getAttribute('data-state'), child.getAttribute('data-selected'), child.getAttribute('class')].join(' ')))
            .filter((value) => /选中|selected|checked|active|pseudo-checkbox/i.test(value))
            .slice(0, 8)
        }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        return result;
      })()`, true).catch(() => undefined)
    : undefined;
  if (process.env.XIANGMAO_REQUIRE_GEMINI_MODELS === '1') {
    assert.equal(modelCatalog?.ok, true, modelCatalog?.message || 'Gemini model catalog was not available.');
  }
  console.log(JSON.stringify({
    recognized: true,
    loggedIn,
    manualLoginBoundary: isConfirmedGeminiLogout(probe),
    composerReady: probe.composerReady,
    loginVisible: probe.loginVisible,
    authUrl: probe.authUrl,
    regionBlocked: probe.regionBlocked,
    modelCatalog,
    modelSelectionVerification,
    attachmentUploadVerification,
    fullFlowVerification,
    modelMenuStructure,
    liveStructure
  }, null, 2));
} finally {
  if (window && window !== rootWindow && !window.isDestroyed()) window.destroy();
  if (rootWindow && !rootWindow.isDestroyed()) rootWindow.destroy();
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (ownsProfile) fs.rmSync(profileDir, { recursive: true, force: true });
  fs.rmSync(liveUploadPath, { force: true });
}
