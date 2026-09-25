import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeChatGptWindow } from '../dist-electron/main/chromeChatGpt.js';
import { isConfirmedGeminiLogin, isConfirmedGeminiLogout } from '../dist-electron/main/geminiBrowserPolicy.js';
import { inspectGeminiModels, probeGeminiPage, waitForGeminiPage } from '../dist-electron/main/geminiWebAdapter.js';
import {
  captureGeminiBaseline,
  captureGeminiDomDiagnostics,
  downloadGeminiImage,
  enableGeminiImageMode,
  resetGeminiComposer,
  sendGeminiPrompt,
  setGeminiPrompt,
  uploadAndConfirmGeminiAttachments,
  uploadGeminiAttachments,
  waitForGeminiComposerReady,
  waitForGeminiAttachments,
  waitForGeminiSendAcceptance,
  waitForGeminiTextResult
} from '../dist-electron/main/geminiWebAutomation.js';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoDir, 'tests', 'fixtures', 'gemini');
const tempRoot = path.join(repoDir, '.tmp');
const profileDir = path.join(tempRoot, `gemini-fixture-${process.pid}`);
const fixtureImagePath = path.join(tempRoot, `gemini-fixture-${process.pid}.jpg`);
const secondFixtureImagePath = path.join(tempRoot, `gemini-fixture-${process.pid}-second.jpg`);
if (!profileDir.startsWith(`${tempRoot}${path.sep}`)) throw new Error(`Unsafe fixture profile: ${profileDir}`);

const server = http.createServer((request, response) => {
  const name = path.basename(new URL(request.url || '/', 'http://127.0.0.1').pathname) || 'ready.html';
  const allowed = new Set(['ready.html', 'current-composer.html', 'current-response.html', 'dual-response.html', 'blob-image-result.html', 'region-blocked.html', 'signed-out.html', 'terminal-failure.html']);
  if (!allowed.has(name)) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(fs.readFileSync(path.join(fixtureRoot, name)));
});

fs.mkdirSync(tempRoot, { recursive: true });
fs.rmSync(profileDir, { recursive: true, force: true });
fs.writeFileSync(fixtureImagePath, Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64'));
fs.copyFileSync(fixtureImagePath, secondFixtureImagePath);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const fixtureUrl = (name) => `http://127.0.0.1:${port}/${name}`;

let window;
const childWindows = [];
try {
  window = await createChromeChatGptWindow({ profileDir, url: fixtureUrl('ready.html'), mode: 'background' });
  await window.loadURL(fixtureUrl('ready.html'));
  const readyProbe = await waitForGeminiPage(window.webContents, 5000);
  assert.equal(isConfirmedGeminiLogin(readyProbe), true, `Ready fixture probe: ${JSON.stringify(readyProbe)}`);

  const models = await inspectGeminiModels(window.webContents);
  assert.equal(models.ok, true);
  assert.deepEqual(models.models.map((model) => model.label), ['3.5 Flash-Lite', '3.1 Pro']);
  const selected = await inspectGeminiModels(window.webContents, '3.1 Pro');
  assert.equal(selected.ok, true);
  assert.equal(selected.currentModel, '3.1 Pro');

  const clean = await resetGeminiComposer(window.webContents);
  assert.equal(clean.ok, true);
  assert.equal(await setGeminiPrompt(window.webContents, 'fixture prompt that verifies the Gemini textarea writer'), true);
  const baseline = await captureGeminiBaseline(window.webContents);
  const sendAction = await sendGeminiPrompt(window.webContents);
  assert.equal(sendAction.sent, true);
  assert.equal(sendAction.method, 'cdp-button', 'Gemini must use a trusted button click before keyboard fallback.');
  assert.equal((await waitForGeminiSendAcceptance(window.webContents, baseline, 5000)).accepted, true);

  await window.loadURL(fixtureUrl('ready.html'));
  assert.equal((await enableGeminiImageMode(window.webContents)).ok, true);
  const upload = await uploadGeminiAttachments(window.webContents, [fixtureImagePath]);
  const attachment = await waitForGeminiAttachments(window.webContents, [fixtureImagePath], 5000, upload);
  assert.equal(upload.method, 'file-input');
  assert.equal(attachment.nameHits, 1);
  assert.equal(await setGeminiPrompt(window.webContents, 'fixture prompt with a confirmed attachment'), true);
  const composerReady = await waitForGeminiComposerReady(window.webContents, 1, 5000);
  assert.equal(composerReady.ready, true);
  assert.equal(composerReady.hasPrompt, true);
  assert.equal(composerReady.attachmentCount >= 1, true);
  assert.equal(composerReady.sendEnabled, true);
  assert.equal(composerReady.busyCount, 0);

  await window.loadURL(fixtureUrl('current-composer.html'));
  const currentModels = await inspectGeminiModels(window.webContents);
  assert.equal(currentModels.ok, true, `Current Gemini model surface: ${JSON.stringify(currentModels)}`);
  assert.deepEqual(
    currentModels.models.map((model) => model.label),
    ['3.5 Flash-Lite', '3.6 Flash', '3.1 Pro', '扩展思考']
  );
  assert.equal(currentModels.currentModel, '3.6 Flash', 'The selected marker, not the active focus class, identifies the current model.');
  assert.equal(currentModels.models.filter((model) => model.current).length, 1, 'Exactly one Gemini model may be current.');
  const currentSelected = await inspectGeminiModels(window.webContents, '3.1 Pro');
  assert.equal(currentSelected.ok, true, `Current Gemini model selection: ${JSON.stringify(currentSelected)}`);
  assert.equal(currentSelected.currentModel, '3.1 Pro');

  await window.loadURL(`${fixtureUrl('current-composer.html')}?stale-upload=1`);
  const staleComposer = await resetGeminiComposer(window.webContents);
  assert.equal(staleComposer.ok, false, 'Gemini uploaded-img remnants must prevent a supposedly clean composer.');
  assert.equal(staleComposer.attachmentCount, 1);

  await window.loadURL(fixtureUrl('current-composer.html'));
  const currentUpload = await uploadGeminiAttachments(window.webContents, [fixtureImagePath]);
  const currentAttachment = await waitForGeminiAttachments(window.webContents, [fixtureImagePath], 5000, currentUpload);
  assert.equal(currentUpload.method, 'file-input');
  assert.equal(currentAttachment.nameHits, 0, 'The current Gemini chip intentionally hides the local file name.');
  assert.equal(currentAttachment.attachmentCount, 1, 'The form-external Gemini file chip must be accepted as upload evidence.');

  await window.loadURL(fixtureUrl('current-composer.html'));
  const sequentialUpload = await uploadGeminiAttachments(window.webContents, [fixtureImagePath, secondFixtureImagePath]);
  const sequentialAttachments = await waitForGeminiAttachments(
    window.webContents,
    [fixtureImagePath, secondFixtureImagePath],
    5000,
    sequentialUpload
  );
  assert.equal(sequentialAttachments.readyAttachmentCount, 2, 'Gemini multi-file upload must add and verify one ready preview at a time.');

  await window.loadURL(`${fixtureUrl('current-composer.html')}?no-preview=1`);
  const eventOnlyUpload = await uploadGeminiAttachments(window.webContents, [fixtureImagePath]);
  await assert.rejects(
    waitForGeminiAttachments(window.webContents, [fixtureImagePath], 1800, eventOnlyUpload),
    /未确认完整接收 1 个附件/,
    'A file-input event without a rendered ready preview must not be treated as an uploaded attachment.'
  );

  await window.loadURL(`${fixtureUrl('current-composer.html')}?no-preview=1&drop-preview=1`);
  const fallbackUpload = await uploadAndConfirmGeminiAttachments(window.webContents, [fixtureImagePath], 5000);
  assert.deepEqual(fallbackUpload.attempts, ['file-input', 'cdp-drag-drop']);
  assert.equal(fallbackUpload.confirmation.readyAttachmentCount >= 1, true);

  await window.loadURL(`${fixtureUrl('current-composer.html')}?delayed-account=1`);
  const delayedLoginStartedAt = Date.now();
  const delayedLoginProbe = await waitForGeminiPage(window.webContents, 5000);
  assert.equal(isConfirmedGeminiLogin(delayedLoginProbe), true, 'A composer must not end login detection before account evidence mounts.');
  assert.ok(Date.now() - delayedLoginStartedAt >= 700, 'The login probe must wait for delayed account evidence.');

  await window.loadURL(`${fixtureUrl('current-composer.html')}?delayed-model=1`);
  const delayedModels = await inspectGeminiModels(window.webContents);
  assert.equal(delayedModels.ok, true, `Delayed Gemini model surface: ${JSON.stringify(delayedModels)}`);
  assert.deepEqual(delayedModels.models.map((model) => model.label), ['3.5 Flash-Lite', '3.6 Flash', '3.1 Pro', '扩展思考']);

  await window.loadURL(fixtureUrl('dual-response.html'));
  const dualResponse = await waitForGeminiTextResult(window.webContents, {
    userMessageCount: 0,
    responseCount: 0,
    href: fixtureUrl('dual-response.html'),
    imageSources: [],
    capturedAt: Date.now()
  }, 5000, (text) => [
    'sceneDescription',
    'poseDescription',
    'faceDirectionDescription',
    'lightingMakeupDescription'
  ].every((key) => text.includes(`"${key}"`)));
  assert.match(dualResponse.text, /"sceneDescription"\s*:\s*"选项 B 场景"/);
  assert.doesNotMatch(dualResponse.text, /"sceneDescription"\s*:\s*"选项 A 场景"/);

  await window.loadURL(fixtureUrl('current-response.html'));
  const currentResponse = await waitForGeminiTextResult(window.webContents, {
    userMessageCount: 0,
    responseCount: 0,
    href: fixtureUrl('current-response.html'),
    imageSources: [],
    capturedAt: Date.now()
  }, 5000, (text) => [
    'sceneDescription',
    'poseDescription',
    'faceDirectionDescription',
    'lightingMakeupDescription'
  ].every((key) => text.includes(`"${key}"`)));
  assert.match(currentResponse.text, /"sceneDescription"\s*:\s*"真实室内场景"/);
  assert.doesNotMatch(currentResponse.text, /用户提示里的空模板/);

  await window.loadURL(fixtureUrl('blob-image-result.html'));
  let blobImageCandidate;
  for (let attempt = 0; attempt < 20 && !blobImageCandidate; attempt += 1) {
    blobImageCandidate = await window.webContents.executeJavaScript(`(() => {
      const image = document.querySelector('model-response img');
      if (!image?.complete || image.naturalWidth < 256 || image.naturalHeight < 256) return undefined;
      return {
        responseIndex: 0,
        imageIndex: 0,
        src: image.currentSrc || image.src,
        width: image.naturalWidth,
        height: image.naturalHeight,
        alt: image.alt || '',
        visible: true
      };
    })()`, true);
    if (!blobImageCandidate) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(blobImageCandidate?.src.startsWith('blob:'), 'The revoked blob fixture must expose a rendered blob image.');
  const blobImageDownload = await downloadGeminiImage(window.webContents, blobImageCandidate);
  assert.match(blobImageDownload.dataUrl, /^data:image\/png;base64,/);
  assert.deepEqual([blobImageDownload.width, blobImageDownload.height], [512, 512]);

  await window.loadURL(fixtureUrl('region-blocked.html'));
  const regionProbe = await waitForGeminiPage(window.webContents, 5000);
  assert.equal(regionProbe?.regionBlocked, true);
  assert.equal(isConfirmedGeminiLogin(regionProbe), false);
  const regionFailure = await waitForGeminiTextResult(window.webContents, {
    userMessageCount: 0,
    responseCount: 0,
    href: fixtureUrl('region-blocked.html'),
    imageSources: [],
    capturedAt: Date.now()
  }, 5000);
  assert.equal(regionFailure.failure?.code, 'region-blocked');

  await window.loadURL(fixtureUrl('signed-out.html'));
  assert.equal(isConfirmedGeminiLogout(await probeGeminiPage(window.webContents)), true);

  await window.loadURL(fixtureUrl('terminal-failure.html'));
  const failure = await waitForGeminiTextResult(window.webContents, {
    userMessageCount: 0,
    responseCount: 0,
    href: fixtureUrl('terminal-failure.html'),
    imageSources: [],
    capturedAt: Date.now()
  }, 5000);
  assert.equal(failure.failure?.code, 'quota-exceeded');

  const diagnostics = await captureGeminiDomDiagnostics(window.webContents);
  assert.equal(diagnostics.composerCount, 1);
  assert.equal('bodyText' in diagnostics, false);
  assert.equal('titleText' in diagnostics, false);

  assert.equal(typeof window.createTab, 'function', 'Dedicated Chrome must expose independent task tabs.');
  const lanePrompts = ['gemini lane 1', 'gemini lane 2', 'gemini lane 3'];
  const laneWindows = [window];
  for (let index = 1; index < lanePrompts.length; index += 1) {
    const child = await window.createTab(fixtureUrl('ready.html'));
    childWindows.push(child);
    laneWindows.push(child);
  }
  await Promise.all(laneWindows.map(async (laneWindow, index) => {
    assert.equal(await setGeminiPrompt(laneWindow.webContents, lanePrompts[index]), true);
  }));
  const isolatedPrompts = await Promise.all(laneWindows.map((laneWindow) =>
    laneWindow.webContents.executeJavaScript("document.querySelector('textarea')?.value || ''", true)
  ));
  assert.deepEqual(isolatedPrompts, lanePrompts, 'Parallel Gemini tabs must not share composer state.');

  console.log(JSON.stringify({
    readyLogin: true,
    signedOutDetected: true,
    models: models.models.map((model) => model.label),
    currentSurfaceModels: currentModels.models.map((model) => model.label),
    sendAccepted: true,
    attachmentAccepted: true,
    dualResponseAccepted: true,
    regionBlockedDetected: true,
    terminalFailure: failure.failure?.code,
    diagnosticsRedacted: true,
    isolatedParallelTabs: laneWindows.length
  }, null, 2));
} finally {
  await Promise.all(childWindows.map(async (child) => {
    if (!child.isDestroyed()) child.destroy();
  }));
  if (window && !window.isDestroyed()) window.destroy();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 400));
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.rmSync(fixtureImagePath, { force: true });
  fs.rmSync(secondFixtureImagePath, { force: true });
}
