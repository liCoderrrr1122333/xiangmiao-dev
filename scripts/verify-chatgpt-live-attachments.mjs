import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeChatGptWindow } from '../dist-electron/main/chromeChatGpt.js';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileDir = path.resolve(process.env.YAOCHUANG_LIVE_CHROME_PROFILE_CLONE || '');
const artifactRoot = path.resolve('D:\\Yaochuang-Workshop\\TestArtifacts\\1.1.4-chatgpt-live-attachments');
const compiledMain = fs.readFileSync(path.join(repoDir, 'dist-electron', 'main', 'index.js'), 'utf8');
const files = [
  path.join(repoDir, 'public', 'yaochuang-unified-v2.png'),
  path.join(repoDir, 'docs', '0.2.2-face-occlusion-evidence', 'front-face.png'),
  path.join(repoDir, 'docs', '0.2.2-face-occlusion-evidence', 'profile-face.png')
];

assert.ok(profileDir, 'YAOCHUANG_LIVE_CHROME_PROFILE_CLONE is required.');
assert.ok(profileDir.startsWith(path.resolve('D:\\Yaochuang-Workshop\\TestArtifacts') + path.sep), 'Live verification must use a D: test profile clone.');
for (const file of files) assert.equal(fs.existsSync(file), true, `Missing fixture image: ${file}`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pageScript = (fn, ...args) => `(${fn.toString()})(...${JSON.stringify(args)})`;
function extractFactory(name, nextName) {
  const start = compiledMain.indexOf(`const ${name} =`);
  const end = compiledMain.indexOf(`\nconst ${nextName}`, start);
  if (start < 0 || end < 0) throw new Error(`Unable to locate ${name} in compiled main process.`);
  const declaration = compiledMain.slice(start, end).trim().replace(/;$/, '');
  const expression = declaration.slice(declaration.indexOf('=') + 1).trim();
  return new Function('pageScript', `return (${expression});`)(pageScript);
}

const revealFileInputScript = extractFactory('revealFileInputScript', 'markComposerFileInputScript');
const markComposerFileInputScript = extractFactory('markComposerFileInputScript', 'dismissOpenMenusScript');
const setPromptScript = extractFactory('setPromptScript', 'uploadReadyScript');
const uploadReadyScript = extractFactory('uploadReadyScript', 'uploadAttachmentSnapshotScript');
const uploadAttachmentSnapshotScript = extractFactory('uploadAttachmentSnapshotScript', 'clickSendScript');
const sendButtonTargetScript = extractFactory('sendButtonTargetScript', 'fallbackClickSendScript');
const composerDropPointScript = extractFactory('composerDropPointScript', 'setPromptScript');

async function dragFile(webContents, file) {
  const dropPoint = await webContents.executeJavaScript(composerDropPointScript, true);
  assert.equal(dropPoint.ok, true, 'ChatGPT composer did not expose a drag/drop target.');
  const data = { items: [], files: [file], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await webContents.debugger.sendCommand('Input.dispatchDragEvent', {
      type,
      x: dropPoint.x,
      y: dropPoint.y,
      data
    });
    await wait(type === 'drop' ? 150 : 80);
  }
}

async function setFile(webContents, file) {
  await webContents.executeJavaScript(revealFileInputScript, true);
  await wait(700);
  const marker = `live-attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const marked = await webContents.executeJavaScript(markComposerFileInputScript(marker), true);
  assert.equal(marked.selected, true, `ChatGPT did not expose a composer file input for ${path.basename(file)}.`);
  const { root } = await webContents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await webContents.debugger.sendCommand('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: `input[data-yaochuang-upload-target="${marker}"]`
  });
  assert.ok(nodeId, 'CDP did not resolve the marked ChatGPT file input.');
  await webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [file] });
  await webContents.executeJavaScript(`document.querySelector('input[data-yaochuang-upload-target="${marker}"]')?.removeAttribute('data-yaochuang-upload-target')`, true);
  return marked;
}

async function waitForSnapshot(webContents, names, expected, timeoutMs = 45_000) {
  const startedAt = Date.now();
  let stable = 0;
  let last;
  while (Date.now() - startedAt < timeoutMs) {
    last = await webContents.executeJavaScript(uploadAttachmentSnapshotScript(names), true);
    stable = !last.uploadErrorText && last.evidenceCount >= expected && last.busyCount === 0 ? stable + 1 : 0;
    if (stable >= 4) return last;
    await wait(700);
  }
  return last;
}

await mkdir(artifactRoot, { recursive: true });
let window;
try {
  window = await createChromeChatGptWindow({ profileDir, url: 'https://chatgpt.com/', mode: 'background' });
  await window.loadURL('https://chatgpt.com/');
  const webContents = window.webContents;
  let composerReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    composerReady = await webContents.executeJavaScript("Boolean(document.querySelector('#prompt-textarea, textarea, [contenteditable=true][role=textbox]'))", true).catch(() => false);
    if (composerReady) break;
    await wait(1000);
  }
  assert.equal(composerReady, true, 'The cloned real profile did not reach a ChatGPT composer.');

  const names = [];
  const perFile = [];
  for (const file of files) {
    let inputMarker;
    let inputError = '';
    try {
      inputMarker = await setFile(webContents, file);
    } catch (error) {
      inputError = error instanceof Error ? error.message : String(error);
    }
    names.push(path.basename(file));
    let snapshot = inputMarker ? await waitForSnapshot(webContents, names, names.length, 12_000) : undefined;
    let method = inputMarker ? 'file-input' : 'cdp-drag-drop';
    if (!snapshot || snapshot.uploadErrorText || snapshot.evidenceCount < names.length) {
      await dragFile(webContents, file);
      method = 'cdp-drag-drop';
      snapshot = await waitForSnapshot(webContents, names, names.length);
    }
    assert.ok(snapshot && !snapshot.uploadErrorText, snapshot?.uploadErrorText || 'Attachment verification timed out.');
    assert.ok(snapshot.evidenceCount >= names.length, `Only ${snapshot.evidenceCount}/${names.length} real attachments rendered.`);
    perFile.push({ file: path.basename(file), method, inputMarker, inputError, snapshot });
  }

  const prompt = '耀创工坊 1.1.4 附件完整性验证，仅检查发送按钮，不发送此消息。';
  assert.equal(await webContents.executeJavaScript(setPromptScript(prompt), true), true);
  let ready;
  let stableReady = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ready = await webContents.executeJavaScript(uploadReadyScript(files.length), true);
    stableReady = ready.ready ? stableReady + 1 : 0;
    if (stableReady >= 3) break;
    await wait(700);
  }
  assert.equal(ready?.ready, true, `Real composer was not ready: ${JSON.stringify(ready)}`);
  const sendTarget = await webContents.executeJavaScript(sendButtonTargetScript, true);
  assert.equal(sendTarget?.found, true);
  assert.equal(sendTarget?.enabled, true);
  assert.equal(await webContents.executeJavaScript('window.__fixtureSent || 0', true), 0);

  const report = {
    ok: true,
    sent: false,
    profileClone: profileDir,
    files: names,
    perFile,
    finalReady: ready,
    sendTarget: { found: sendTarget.found, enabled: sendTarget.enabled, label: sendTarget.label },
    url: webContents.getURL()
  };
  await webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    .then(({ data }) => fs.writeFileSync(path.join(artifactRoot, 'real-chatgpt-attachments-before-send.png'), Buffer.from(data, 'base64')));
  await writeFile(path.join(artifactRoot, 'real-chatgpt-attachments.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (window && !window.isDestroyed()) window.destroy();
  await wait(500);
}
