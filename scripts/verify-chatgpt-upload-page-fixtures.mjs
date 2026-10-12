import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeChatGptWindow } from '../dist-electron/main/chromeChatGpt.js';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoDir, 'tests', 'fixtures', 'chatgpt', 'attachment-composer.html');
const tempRoot = path.resolve('D:\\Xiangmao-Workshop\\TestArtifacts\\1.1.4-attachment-fixture');
const profileDir = path.join(tempRoot, `profile-${process.pid}`);
const compiledMain = fs.readFileSync(path.join(repoDir, 'dist-electron', 'main', 'index.js'), 'utf8');

const pageScript = (fn, ...args) => `(${fn.toString()})(...${JSON.stringify(args)})`;
function extractFactory(name, nextName) {
  const start = compiledMain.indexOf(`const ${name} =`);
  const end = [
    compiledMain.indexOf(`\nconst ${nextName}`, start),
    compiledMain.indexOf(`\nfunction ${nextName}`, start)
  ].filter((value) => value >= 0).sort((left, right) => left - right)[0] ?? -1;
  if (start < 0 || end < 0) throw new Error(`Unable to locate ${name} in compiled main process.`);
  const declaration = compiledMain.slice(start, end).trim().replace(/;$/, '');
  const expression = declaration.slice(declaration.indexOf('=') + 1).trim();
  return new Function('pageScript', `return (${expression});`)(pageScript);
}

const uploadReadyScript = extractFactory('uploadReadyScript', 'uploadAttachmentSnapshotScript');
const uploadAttachmentSnapshotScript = extractFactory('uploadAttachmentSnapshotScript', 'clickSendScript');
const sendButtonTargetScript = extractFactory('sendButtonTargetScript', 'fallbackClickSendScript');
const markComposerFileInputScript = extractFactory('markComposerFileInputScript', 'dismissOpenMenusScript');
const chatGptConversationAccessRecoveryScript = extractFactory(
  'chatGptConversationAccessRecoveryScript',
  'chatGptRuntimeStatePath'
);

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(fs.readFileSync(fixturePath));
});

fs.mkdirSync(tempRoot, { recursive: true });
fs.rmSync(profileDir, { recursive: true, force: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/attachment-composer.html`;

let window;
try {
  window = await createChromeChatGptWindow({ profileDir, url: fixtureUrl, mode: 'background' });
  await window.loadURL(fixtureUrl);
  const webContents = window.webContents;

  const marker = `fixture-${Date.now()}`;
  const marked = await webContents.executeJavaScript(markComposerFileInputScript(marker), true);
  assert.equal(marked.inputCount, 2);
  assert.equal(marked.scopedCount, 1);
  assert.equal(marked.selected, true);
  assert.equal(
    await webContents.executeJavaScript(`document.querySelector('[data-xiangmao-upload-target="${marker}"]')?.id`, true),
    'file-input',
    'the upload target must belong to the active ChatGPT composer'
  );
  await webContents.executeJavaScript(`document.querySelector('#file-input').remove();`, true);
  const outsideOnly = await webContents.executeJavaScript(markComposerFileInputScript(`${marker}-outside`), true);
  assert.equal(outsideOnly.inputCount, 1);
  assert.equal(outsideOnly.scopedCount, 0);
  assert.equal(outsideOnly.selected, false, 'an unrelated page-level file input must never be selected');
  await webContents.executeJavaScript(`document.querySelector('form').prepend(Object.assign(document.createElement('input'), { id: 'file-input', type: 'file', accept: 'image/*', multiple: true }));`, true);

  await webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#file-input');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['main'], '01_main.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  const inputOnly = await webContents.executeJavaScript(uploadAttachmentSnapshotScript(['01_main.png']), true);
  assert.equal(inputOnly.fileInputCount, 1);
  assert.equal(inputOnly.evidenceCount, 0, 'file input state alone must never count as an uploaded attachment');

  await webContents.executeJavaScript("fixture.addAttachment('01_main.png'); fixture.addAttachment('02_circle.png'); fixture.setPrompt('fixture prompt'); fixture.setBusy(true);", true);
  const nestedPreviews = await webContents.executeJavaScript(uploadAttachmentSnapshotScript(['01_main.png', '02_circle.png']), true);
  assert.equal(nestedPreviews.previewCount, 2, 'nested attachment wrappers and images must not be double-counted');
  assert.equal(nestedPreviews.evidenceCount, 2);
  const busy = await webContents.executeJavaScript(uploadReadyScript(2), true);
  assert.equal(busy.ready, false);
  assert.equal(busy.busyCount, 1);

  await webContents.executeJavaScript('fixture.setBusy(false)', true);
  const ready = await webContents.executeJavaScript(uploadReadyScript(2), true);
  assert.equal(ready.ready, true);
  assert.equal(ready.attachmentCount, 2);
  const sendTarget = await webContents.executeJavaScript(sendButtonTargetScript, true);
  assert.equal(sendTarget.found, true);
  assert.equal(sendTarget.enabled, true);
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sendTarget.x, y: sendTarget.y });
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: sendTarget.x, y: sendTarget.y, button: 'left', clickCount: 1 });
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sendTarget.x, y: sendTarget.y, button: 'left', clickCount: 1 });
  assert.equal(await webContents.executeJavaScript('window.__fixtureSent || 0', true), 1);

  await webContents.executeJavaScript(`(() => {
    const dialog = document.createElement('div');
    dialog.id = 'conversation-access-limit';
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<h2>请求过于频繁</h2><p>请稍等几分钟后再重试。</p><button type="button">明白了</button>';
    dialog.querySelector('button').addEventListener('click', () => {
      window.__fixtureAcknowledged = (window.__fixtureAcknowledged || 0) + 1;
      dialog.remove();
    });
    document.body.append(dialog);
  })()`, true);
  const protection = await webContents.executeJavaScript(chatGptConversationAccessRecoveryScript(false), true);
  assert.equal(protection.pageLimited, true);
  assert.equal(protection.acknowledgementAvailable, true);
  assert.equal(protection.acknowledged, false);
  const acknowledged = await webContents.executeJavaScript(chatGptConversationAccessRecoveryScript(true), true);
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(await webContents.executeJavaScript('window.__fixtureAcknowledged || 0', true), 1);
  const cleared = await webContents.executeJavaScript(chatGptConversationAccessRecoveryScript(false), true);
  assert.equal(cleared.pageLimited, false, 'the recovery check must not recreate a dismissed restriction');

  console.log(JSON.stringify({
    ok: true,
    marked,
    outsideOnly,
    inputOnly,
    nestedPreviews,
    ready,
    trustedSendClicks: 1,
    cooldownAcknowledgementClicks: 1,
    cooldownCleared: !cleared.pageLimited
  }, null, 2));
} finally {
  if (window && !window.isDestroyed()) window.destroy();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 400));
  fs.rmSync(profileDir, { recursive: true, force: true });
}
