import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceProfile = path.resolve(process.env.XIANGMAO_LIVE_CHROME_PROFILE_CLONE || '');
const artifactRoot = path.resolve('D:\\Xiangmao-Workshop\\TestArtifacts\\1.1.4-chatgpt-live-analysis');
const userDataDir = path.join(artifactRoot, 'user-data');
const profileLink = path.join(userDataDir, 'ChatGPT-Chrome');
const imagePath = path.join(repoDir, 'docs', '0.2.2-face-occlusion-evidence', 'front-face.png');
const electronExecutable = path.join(repoDir, 'node_modules', 'electron', 'dist', 'electron.exe');

assert.ok(sourceProfile, 'XIANGMAO_LIVE_CHROME_PROFILE_CLONE is required.');
assert.ok(sourceProfile.startsWith(path.resolve('D:\\Xiangmao-Workshop\\TestArtifacts') + path.sep));
assert.equal(fs.existsSync(path.join(sourceProfile, 'Default')), true, 'The isolated ChatGPT profile clone is incomplete.');
assert.equal(fs.existsSync(imagePath), true, `Missing analysis fixture: ${imagePath}`);

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });
await symlink(sourceProfile, profileLink, 'junction');
await writeFile(
  path.join(userDataDir, 'settings.json'),
  `${JSON.stringify({
    acknowledgedNoticeVersion: 1,
    apiProvider: 'chatgpt',
    webAiProvider: 'chatgpt',
    chatGptUrl: 'https://chatgpt.com/',
    chatGptBrowserBackend: 'chrome',
    chatGptOpenMode: 'auto',
    chatGptKeepAliveEnabled: false
  }, null, 2)}\n`,
  'utf8'
);

const statusTimeline = [];
const rendererErrors = [];
const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [repoDir],
  cwd: repoDir,
  env: {
    ...process.env,
    XIANGMAO_USER_DATA_DIR: userDataDir
  }
});

try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  await page.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  const notice = page.getByRole('button', { name: '我已确认，进入像锚' });
  if (await notice.isVisible().catch(() => false)) await notice.click();

  await page.locator('#main-upload-input').setInputFiles(imagePath);
  await page.locator('.main-canvas-panel.has-main-image').waitFor({ state: 'visible', timeout: 15_000 });
  const button = page.locator('.analysis-button');
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await button.isEnabled(), true, 'AI analysis button did not enable after importing the main image.');
  await button.click();

  const startedAt = Date.now();
  let lastStatus = '';
  while (Date.now() - startedAt < 8 * 60_000) {
    const status = await page.locator('.analysis-status').textContent().catch(() => '') || '';
    if (status && status !== lastStatus) {
      statusTimeline.push({ elapsedMs: Date.now() - startedAt, status: status.replace(/\s+/g, ' ').trim() });
      lastStatus = status;
    }
    const values = await page.locator('.description-sections textarea').evaluateAll((areas) =>
      areas.slice(0, 4).map((area) => area.value.trim())
    );
    if (values.length === 4 && values.every(Boolean)) break;
    if ((await button.textContent() || '').includes('AI 分析') && /未完成|失败|不可继续/.test(status)) break;
    await page.waitForTimeout(1000);
  }

  const fields = await page.locator('.description-sections textarea').evaluateAll((areas) =>
    areas.slice(0, 4).map((area) => area.value.trim())
  );
  const finalStatus = (await page.locator('.analysis-status').textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
  const buttonEnabled = await button.isEnabled();
  const buttonText = (await button.textContent() || '').replace(/\s+/g, ' ').trim();
  const screenshotPath = path.join(artifactRoot, 'analysis-completed.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const report = {
    ok: fields.length === 4 && fields.every(Boolean) && buttonEnabled,
    sent: true,
    filledFieldLengths: fields.map((value) => value.length),
    finalStatus,
    buttonEnabled,
    buttonText,
    statusTimeline,
    rendererErrors,
    screenshotPath
  };
  await writeFile(path.join(artifactRoot, 'analysis-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  assert.equal(report.ok, true, `AI analysis did not complete: ${JSON.stringify(report)}`);
  assert.match(finalStatus, /分析完成|兼容模式完成/);
  assert.match(buttonText, /AI 分析/);
  assert.deepEqual(rendererErrors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await electronApp.close().catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 800));
}
