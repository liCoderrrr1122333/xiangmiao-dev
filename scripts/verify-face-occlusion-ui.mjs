import assert from 'node:assert/strict';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const artifactRoot =
  process.env.YAOCHUANG_TEST_ARTIFACTS || 'D:\\Yaochuang-Workshop\\TestArtifacts\\face-occlusion-runtime';
const userDataDir = path.join(artifactRoot, `user-data-${process.pid}`);
const projectFixture = process.env.YAOCHUANG_FACE_TEST_PROJECT?.trim();
const packagedElectronPath = process.env.YAOCHUANG_ELECTRON_PATH?.trim();

await mkdir(userDataDir, { recursive: true });
if (projectFixture) {
  assert.ok((await stat(projectFixture)).isFile(), `找不到人脸测试项目：${projectFixture}`);
  await copyFile(projectFixture, path.join(userDataDir, 'autosave.masklock.json'));
}

const app = await electron.launch({
  executablePath: packagedElectronPath || undefined,
  args: packagedElectronPath ? [] : [repoRoot],
  cwd: repoRoot,
  env: { ...process.env, YAOCHUANG_USER_DATA_DIR: userDataDir }
});

try {
  const page = await app.firstWindow();
  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
  await page.waitForLoadState('domcontentloaded');
  const startupNoticeConfirm = page.getByRole('button', { name: '我已确认，进入耀创工坊' });
  const startupNoticeShown = await startupNoticeConfirm.waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (startupNoticeShown) {
    await startupNoticeConfirm.click();
    await startupNoticeConfirm.waitFor({ state: 'detached', timeout: 10_000 });
  }

  if (projectFixture) {
    await page.getByText('红圈已锁定', { exact: true }).waitFor();
  } else {
    const imagePath = path.join(repoRoot, 'public', 'yaochuang-unified-v2.png');
    await page.locator('#main-upload-input').setInputFiles(imagePath);
    await page.getByTitle('绘制红圈').click();
    const canvas = await page.locator('.canvas-wrap canvas').boundingBox();
    assert.ok(canvas, '没有找到原图画布。');
    await page.mouse.move(canvas.x + canvas.width * 0.25, canvas.y + canvas.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.75, canvas.y + canvas.height * 0.8, { steps: 8 });
    await page.mouse.up();
    await page.getByText('红圈已锁定', { exact: true }).waitFor();
  }

  const button = page.getByRole('button', { name: '一键蒙脸' });
  assert.equal(await button.isDisabled(), false, '主图和红圈就绪后，一键蒙脸按钮不应被禁用。');
  await button.click();
  await page.waitForFunction(() => {
    const action = document.querySelector('button[aria-label="一键蒙脸"]');
    const feedback = document.querySelector('.canvas-feedback')?.textContent || '';
    return action?.getAttribute('aria-busy') === 'false' && !feedback.includes('正在识别');
  }, undefined, { timeout: 45_000 });

  const result = {
    pressed: await button.getAttribute('aria-pressed'),
    feedback: await page.locator('.canvas-feedback').allInnerTexts(),
    consoleMessages,
    pageErrors
  };
  assert.ok(
    !consoleMessages.some((message) => message.includes('violates the following Content Security Policy')),
    'MediaPipe 启动脚本被内容安全策略阻止。'
  );
  assert.ok(
    !result.feedback.some((message) => message.includes('一键蒙脸组件加载失败')),
    `一键蒙脸运行组件没有成功启动：${result.feedback.join('；')}`
  );
  assert.deepEqual(pageErrors, []);
  if (projectFixture) {
    assert.equal(result.pressed, 'true', `真实人脸没有成功蒙脸：${result.feedback.join('；')}`);
  }

  await mkdir(artifactRoot, { recursive: true });
  await page.screenshot({ path: path.join(artifactRoot, projectFixture ? 'face-success.png' : 'runtime-ready.png') });
  console.log(JSON.stringify({ ok: true, packagedElectronPath, projectFixture, userDataDir, result }));
} finally {
  await app.close();
}
