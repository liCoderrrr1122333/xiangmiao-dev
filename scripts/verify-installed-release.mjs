import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const localAppData = process.env.LOCALAPPDATA || '';
const executablePath = process.env.XIANGMAO_INSTALLED_EXE ||
  path.join(localAppData, 'Programs', 'xiangmao-workshop', '像锚.exe');
const artifactRoot = path.resolve(
  process.env.XIANGMAO_INSTALLED_ARTIFACTS ||
  'D:\\Xiangmao-Workshop\\TestArtifacts\\1.1.4-install-validation\\installed-release'
);
const requestedProvider = process.env.XIANGMAO_INSTALLED_PROVIDER?.trim();

assert.equal(existsSync(executablePath), true, `installed executable is missing: ${executablePath}`);
await mkdir(artifactRoot, { recursive: true });

const electronApp = await electron.launch({ executablePath });
try {
  const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
  assert.equal(appVersion, '1.2.4');

  const page = await electronApp.firstWindow({ timeout: 30_000 });
  const rendererErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  await page.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  const startupNoticeConfirm = page.getByRole('button', { name: '我已确认，进入像锚' });
  const startupNoticeShown = await startupNoticeConfirm.waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (startupNoticeShown) {
    await startupNoticeConfirm.click();
    await startupNoticeConfirm.waitFor({ state: 'detached', timeout: 10_000 });
  }

  const bodyText = await page.locator('body').innerText();
  assert.match(bodyText, /结果归档/);
  assert.doesNotMatch(bodyText, /进入后期处理|Camera 滤镜|同步到所选|全部丢弃/);
  if (requestedProvider) {
    assert.match(requestedProvider, /^(ChatGPT|Gemini)$/);
    await page.getByRole('button', { name: requestedProvider, exact: true }).click();
    await page.waitForFunction(
      (provider) => document.querySelector('.web-ai-provider-selector button.active')?.textContent?.trim() === provider,
      requestedProvider
    );
  }
  const activeProvider = (await page.locator('.web-ai-provider-selector button.active').innerText()).trim();
  assert.match(activeProvider, /^(ChatGPT|Gemini)$/);
  await page.getByLabel(`${activeProvider} 并行通道数`).waitFor({ state: 'visible' });
  await page.getByLabel('刷新可用模型').waitFor({ state: 'visible' });
  const modelSelect = page.locator('.chatgpt-model-control select');
  await modelSelect.waitFor({ state: 'visible' });
  const modelSelectBox = await modelSelect.boundingBox();
  assert.ok(modelSelectBox && modelSelectBox.width >= 150, `installed model selector collapsed to ${modelSelectBox?.width || 0}px`);
  const refreshButton = page.getByLabel('刷新可用模型');
  await refreshButton.waitFor({ state: 'visible' });
  await refreshButton.click();
  await page.waitForFunction(
    () => {
      const refresh = document.querySelector('button[aria-label="刷新可用模型"]');
      const options = document.querySelectorAll('.chatgpt-model-control select option');
      return refresh && !refresh.hasAttribute('disabled') && options.length > 1;
    },
    undefined,
    { timeout: 120_000 }
  );
  const modelOptions = await modelSelect.locator('option').evaluateAll((options) =>
    options.map((option) => ({ value: option.value, label: option.textContent?.trim() || '' }))
  );
  const originalModelValue = await modelSelect.inputValue();
  const selectableModel = modelOptions.find((option) => option.value && option.value !== 'follow-current');
  assert.ok(selectableModel, `${activeProvider} did not expose a selectable account model.`);
  await modelSelect.selectOption(selectableModel.value);
  assert.equal(await modelSelect.inputValue(), selectableModel.value);
  await modelSelect.selectOption(originalModelValue);

  const canvas = page.locator('.main-canvas-panel .canvas-wrap canvas');
  await canvas.waitFor({ state: 'visible' });
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox, 'installed original-image canvas is not measurable');
  const canvasStatusBeforeWheel = await page.locator('.canvas-status-strip').innerText();
  assert.doesNotMatch(canvasStatusBeforeWheel, /尚未上传主图/);
  await page.evaluate(() => {
    const left = document.querySelector('.left-stack');
    if (left) left.scrollTop = 0;
  });
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(150);
  const installedCanvasWheel = await page.evaluate(() => ({
    leftScrollTop: document.querySelector('.left-stack')?.scrollTop || 0,
    status: document.querySelector('.canvas-status-strip')?.textContent?.trim() || ''
  }));
  assert.equal(installedCanvasWheel.leftScrollTop, 0, 'installed canvas wheel must not scroll the left rail');
  assert.notEqual(installedCanvasWheel.status, canvasStatusBeforeWheel, 'installed canvas wheel must zoom the image');

  const loginStrip = page.locator('.chatgpt-login-strip');
  const checkButton = page.getByRole('button', { name: '检查登录' });
  const checkStartedAt = Date.now();
  await checkButton.click();
  await page.getByRole('button', { name: '检查中' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '检查登录' && !button.disabled),
    undefined,
    { timeout: 120_000 }
  );
  const checkElapsedMs = Date.now() - checkStartedAt;
  const focusedAfterCheck = await page.evaluate(() => document.hasFocus());
  const checkStatus = (await loginStrip.innerText()).trim();

  const viewButton = page.getByRole('button', { name: '查看窗口' });
  const viewStartedAt = Date.now();
  await viewButton.click();
  await page.getByRole('button', { name: '打开中' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '查看窗口' && !button.disabled),
    undefined,
    { timeout: 120_000 }
  );
  const viewElapsedMs = Date.now() - viewStartedAt;
  const viewStatus = (await loginStrip.innerText()).trim();

  const combinedStatus = `${checkStatus}\n${viewStatus}`;
  assert.doesNotMatch(
    combinedStatus,
    /ECONNREFUSED|127\.0\.0\.1:\d+|TypeError|ReferenceError|undefined|正在后台重新载入 ChatGPT/i
  );
  assert.deepEqual(rendererErrors, []);

  const screenshotPath = path.join(artifactRoot, 'installed-1.2.4.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    appVersion,
    activeProvider,
    modelSelectWidth: modelSelectBox.width,
    modelOptions,
    selectedModelVerified: selectableModel.value,
    installedCanvasWheel,
    checkElapsedMs,
    focusedAfterCheck,
    checkStatus,
    viewElapsedMs,
    viewStatus,
    rendererErrors,
    screenshotPath
  }, null, 2));
} finally {
  await electronApp.close();
}
