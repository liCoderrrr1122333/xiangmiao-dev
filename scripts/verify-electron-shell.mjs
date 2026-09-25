import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const artifactRoot = path.resolve('D:\\Yaochuang-Workshop\\TestArtifacts\\1.2.4-stability\\electron-shell');
const allowedArtifactRoot = path.resolve('D:\\Yaochuang-Workshop\\TestArtifacts');
if (!artifactRoot.startsWith(`${allowedArtifactRoot}${path.sep}`)) {
  throw new Error('Electron shell test root escaped the approved D: artifact directory.');
}

const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!existsSync(electronExecutable)) throw new Error(`Electron executable is missing: ${electronExecutable}`);
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const userDataDir = path.join(artifactRoot, 'user-data');
await rm(artifactRoot, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });
const untrustedRendererPath = path.join(artifactRoot, 'untrusted-renderer.html');
await writeFile(untrustedRendererPath, '<!doctype html><title>untrusted renderer</title>', 'utf8');
await writeFile(
  path.join(userDataDir, 'settings.json'),
  JSON.stringify({ apiProvider: 'doubao' }, null, 2),
  'utf8'
);

const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [projectRoot],
  cwd: projectRoot,
  env: {
    ...process.env,
    YAOCHUANG_USER_DATA_DIR: userDataDir
  }
});

try {
  const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
  assert.equal(appVersion, packageMetadata.version);

  const page = await electronApp.firstWindow({ timeout: 30_000 });
  const rendererErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  const startupNoticeConfirm = page.getByRole('button', { name: '我已确认，进入耀创工坊' });
  const startupNoticeShown = await startupNoticeConfirm.waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (startupNoticeShown) {
    await startupNoticeConfirm.click();
    await startupNoticeConfirm.waitFor({ state: 'detached', timeout: 10_000 });
  }

  const shellState = await page.evaluate(async () => {
    const bridge = window.masklock;
    return {
      title: document.title,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '',
      hasBridge: Boolean(bridge),
      bridgeMethods: bridge ? [
        'readSettings',
        'readRecentAutoSave',
        'recoverLegacyPostProcessingResults',
        'getRelayApiStatus',
        'configureRelayApiKey',
        'clearRelayApiKey'
      ].filter((name) => typeof bridge[name] === 'function') : [],
      settingsReadable: bridge ? Boolean(await bridge.readSettings()) : false,
      autosaveStatus: bridge ? (await bridge.readRecentAutoSave()).status : 'missing'
    };
  });

  assert.equal(shellState.title, '耀创工坊');
  assert.equal(shellState.hasBridge, true, 'sandboxed preload bridge must be available');
  assert.deepEqual(shellState.bridgeMethods, [
    'readSettings',
    'readRecentAutoSave',
    'recoverLegacyPostProcessingResults',
    'getRelayApiStatus',
    'configureRelayApiKey',
    'clearRelayApiKey'
  ]);
  assert.equal(shellState.settingsReadable, true);
  assert.match(shellState.autosaveStatus, /^(empty|loaded|recovered-backup|corrupt)$/);
  assert.match(shellState.csp, /default-src 'self'/);
  assert.match(shellState.csp, /worker-src 'self' blob:/);
  const normalizedSettings = await page.evaluate(async () => window.masklock?.readSettings());
  assert.equal(normalizedSettings?.apiProvider, 'chatgpt', 'obsolete analysis sources must normalize to the visible ChatGPT route');
  assert.equal(normalizedSettings?.generationProvider, 'relay', 'fresh users must start on the local-analysis and API route');

  const routeDisclosure = page.getByRole('button', { name: /制作通道/ });
  if (await routeDisclosure.getAttribute('aria-expanded') === 'false') await routeDisclosure.click();
  await page.getByRole('group', { name: '最终做图通道' }).getByRole('button', { name: 'ChatGPT', exact: true }).click();

  const modelSelect = page.locator('.chatgpt-model-control select');
  await modelSelect.waitFor({ state: 'visible', timeout: 10_000 });
  const modelSelectBox = await modelSelect.boundingBox();
  assert.ok(modelSelectBox && modelSelectBox.width >= 150, `model selector collapsed to ${modelSelectBox?.width || 0}px`);
  await modelSelect.evaluate((select) => {
    const option = document.createElement('option');
    option.value = 'UI fixture model';
    option.textContent = 'UI fixture model';
    select.append(option);
  });
  await modelSelect.selectOption('UI fixture model');
  await page.waitForTimeout(150);
  const selectedModel = await page.evaluate(async () => (await window.masklock?.readSettings())?.chatGptModel);
  assert.equal(selectedModel, 'UI fixture model', 'model selection must persist through the renderer settings path');

  await page.getByRole('button', { name: '极简直传' }).click();
  const directModeNote = page.locator('.chatgpt-direct-mode-note');
  await directModeNote.waitFor({ state: 'visible', timeout: 10_000 });
  await expectText(directModeNote, '沿用网页当前设置（未探测）');
  assert.equal(await page.locator('.chatgpt-model-refresh').count(), 0, 'direct mode must hide model refresh');

  if (await routeDisclosure.getAttribute('aria-expanded') === 'false') await routeDisclosure.click();
  await page.getByRole('group', { name: '最终做图通道' }).getByRole('button', { name: 'API', exact: true }).click();
  await page.locator('.relay-provider-summary').waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await page.locator('.chatgpt-work-mode').count(), 0, 'relay must hide browser thinking controls');
  assert.equal(await page.locator('.chatgpt-model-control').count(), 0, 'relay must hide browser model controls');
  assert.equal(await page.locator('.chatgpt-login-strip').count(), 0, 'relay must hide browser login controls');
  assert.equal(await page.locator('.chatgpt-model-refresh').count(), 0, 'relay must not refresh browser models');
  const originalUnderstandingDisclosure = page.getByRole('button', { name: /^原图理解/ });
  assert.equal(await originalUnderstandingDisclosure.getAttribute('aria-expanded'), 'false', 'API original understanding must start collapsed');
  const originalUnderstandingToggle = page.getByRole('checkbox', { name: '使用原图理解' });
  assert.equal(await originalUnderstandingToggle.isChecked(), false, 'API original understanding must be opt-in');
  await originalUnderstandingDisclosure.click();
  await page.locator('#api-original-understanding-details').waitFor({ state: 'visible' });
  await originalUnderstandingToggle.check();
  assert.equal(await originalUnderstandingToggle.isChecked(), true, 'API original understanding toggle must be interactive');
  await originalUnderstandingToggle.uncheck();
  await originalUnderstandingDisclosure.click();
  const relayAnalysisScreenshotPath = path.join(artifactRoot, 'relay-original-understanding-collapsed.png');
  await page.screenshot({ path: relayAnalysisScreenshotPath });
  if (await routeDisclosure.getAttribute('aria-expanded') === 'false') await routeDisclosure.click();
  await page.getByRole('button', { name: /^(配置 API|API 已配置)$/ }).click();
  const relayDialog = page.getByRole('dialog', { name: '配置自由 API' });
  await relayDialog.waitFor({ state: 'visible', timeout: 10_000 });
  await relayDialog.getByLabel('API Key').fill('fixture-relay-key-8f2a');
  await relayDialog.getByRole('button', { name: '保存并测试' }).waitFor({ state: 'visible' });
  await page.evaluate(async () => window.masklock?.configureRelayApiKey({
    apiKey: 'fixture-relay-key-8f2a',
    remember: false,
    config: { baseUrl: 'https://relay.example.test', model: 'gpt-image-2', protocol: 'openai-images', imagePath: '/v1/images/edits', modelsPath: '/v1/models' }
  }));
  await relayDialog.getByRole('button', { name: '关闭 API 配置' }).click();
  await page.getByRole('button', { name: '配置 API', exact: true }).click();
  await relayDialog.locator('.relay-config-status strong').filter({ hasText: '已配置' }).waitFor({ state: 'visible' });
  await expectText(relayDialog.locator('.relay-config-status'), '已配置');
  const relaySettings = await page.evaluate(async () => window.masklock?.readSettings());
  assert.equal('relayApiKey' in relaySettings, false, 'relay key must never enter settings');
  assert.equal('relayKeySessionOnly' in relaySettings, false, 'relay session key must never enter settings');
  const relayConfigScreenshotPath = path.join(artifactRoot, 'relay-provider-config.png');
  await page.screenshot({ path: relayConfigScreenshotPath });
  await relayDialog.getByRole('button', { name: '清除密钥' }).click();
  await relayDialog.getByRole('button', { name: '关闭 API 配置' }).click();

  await page.getByRole('button', { name: '批量降 AI 感' }).click();
  const cameraDialog = page.getByRole('dialog', { name: '批量降 AI 感' });
  await cameraDialog.waitFor({ state: 'visible', timeout: 10_000 });
  await cameraDialog.getByRole('button', { name: '结果归档' }).waitFor({ state: 'visible' });
  await cameraDialog.getByRole('button', { name: '导入文件夹' }).waitFor({ state: 'visible' });
  const strengthSlider = cameraDialog.getByLabel('处理强度');
  assert.equal(await strengthSlider.inputValue(), '50', 'camera realism must default to the natural strength');
  await strengthSlider.fill('75');
  assert.equal(await strengthSlider.inputValue(), '75', 'camera realism strength must remain directly adjustable');
  await expectText(cameraDialog.locator('.camera-realism-strength-heading output'), '75');
  const cameraDialogBox = await cameraDialog.boundingBox();
  assert.ok(cameraDialogBox && cameraDialogBox.width >= 720, 'folder batch dialog must remain readable');
  const cameraDialogScreenshotPath = path.join(artifactRoot, 'camera-realism-folder-entry.png');
  await page.screenshot({ path: cameraDialogScreenshotPath });
  await cameraDialog.getByRole('button', { name: '关闭批量降 AI 感' }).click();

  const trustedRendererUrl = page.url();
  await page.evaluate((targetUrl) => {
    window.location.href = targetUrl;
  }, pathToFileURL(untrustedRendererPath).toString());
  await page.waitForTimeout(300);
  const navigationBlocked = page.url() === trustedRendererUrl;
  assert.equal(navigationBlocked, true, 'the privileged workbench renderer must reject untrusted navigation');
  assert.deepEqual(rendererErrors, []);

  const screenshotPath = path.join(artifactRoot, 'electron-shell.png');
  await page.screenshot({ path: screenshotPath });
  console.log(JSON.stringify({
    ok: true,
    appVersion,
    shellState,
    modelSelectWidth: modelSelectBox.width,
    selectedModel,
    navigationBlocked,
    rendererErrors,
    screenshotPath,
    cameraDialogScreenshotPath,
    relayConfigScreenshotPath,
    relayAnalysisScreenshotPath
  }, null, 2));
} finally {
  await electronApp.close();
}

async function expectText(locator, expected) {
  const text = (await locator.textContent()) || '';
  assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
