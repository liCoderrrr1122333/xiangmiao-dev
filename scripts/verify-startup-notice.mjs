import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const electronExecutable = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const artifactRoot = path.resolve('D:\\Yaochuang-Workshop\\TestArtifacts\\1.2.4-startup-notice');
const allowedArtifactRoot = path.resolve('D:\\Yaochuang-Workshop\\TestArtifacts');
if (!artifactRoot.startsWith(`${allowedArtifactRoot}${path.sep}`)) {
  throw new Error('Startup notice test root escaped the approved D: artifact directory.');
}
if (!existsSync(electronExecutable)) throw new Error(`Electron executable is missing: ${electronExecutable}`);

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });

async function launchApp(userDataDir, viewport) {
  await mkdir(userDataDir, { recursive: true });
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [repoRoot],
    cwd: repoRoot,
    env: { ...process.env, YAOCHUANG_USER_DATA_DIR: userDataDir }
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  if (viewport) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      window?.setContentSize(size.width, size.height);
      window?.center();
    }, viewport);
  }
  await page.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  return { app, page, errors };
}

async function readSettings(userDataDir) {
  return JSON.parse(await readFile(path.join(userDataDir, 'settings.json'), 'utf8'));
}

async function inspectNoticeLayout(page) {
  return page.evaluate(() => {
    const modal = document.querySelector('.startup-notice-modal');
    const content = document.querySelector('.startup-notice-content');
    const button = document.querySelector('.startup-notice-confirm');
    if (!(modal instanceof HTMLElement) || !(content instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      throw new Error('Startup notice layout is incomplete.');
    }
    const modalRect = modal.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      modal: { x: modalRect.x, y: modalRect.y, width: modalRect.width, height: modalRect.height },
      button: { x: buttonRect.x, y: buttonRect.y, width: buttonRect.width, height: buttonRect.height },
      contentScrollsInternally: content.scrollHeight > content.clientHeight,
      documentWidth: document.documentElement.scrollWidth
    };
  });
}

const firstUserData = path.join(artifactRoot, 'first-and-second-launch-user-data');
const first = await launchApp(firstUserData, { width: 1440, height: 900 });
let firstLayout;
try {
  const dialog = first.page.getByRole('dialog', { name: '使用前必看｜先选择制作路线' });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const settingsBeforeConfirm = await readSettings(firstUserData);
  assert.equal(settingsBeforeConfirm.acknowledgedNoticeVersion, 0);
  assert.equal(await first.page.locator('.app').getAttribute('inert'), '');
  assert.equal(await first.page.locator('.app').getAttribute('aria-hidden'), 'true');
  assert.equal(await dialog.getByRole('button').count(), 1);
  assert.equal(await dialog.locator('button[aria-label*="关闭"]').count(), 0);
  const confirmButton = dialog.getByRole('button', { name: '我已确认，进入耀创工坊' });
  assert.equal(await confirmButton.evaluate((button) => button === document.activeElement), true);

  await first.page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true, 'Escape must not dismiss the mandatory notice.');
  await first.page.locator('.startup-notice-backdrop').click({ position: { x: 4, y: 4 } });
  assert.equal(await dialog.isVisible(), true, 'Backdrop click must not dismiss the mandatory notice.');
  await first.page.keyboard.press('Control+n');
  assert.equal(await dialog.isVisible(), true, 'Workbench shortcuts must not bypass the notice.');

  await first.page.waitForTimeout(250);
  firstLayout = await inspectNoticeLayout(first.page);
  assert.ok(firstLayout.modal.width <= 621);
  assert.ok(firstLayout.modal.x >= 0 && firstLayout.modal.y >= 0);
  assert.ok(firstLayout.modal.x + firstLayout.modal.width <= firstLayout.viewport.width + 1);
  assert.ok(firstLayout.modal.y + firstLayout.modal.height <= firstLayout.viewport.height + 1);
  assert.ok(firstLayout.button.height >= 44, `Primary button is too short: ${JSON.stringify(firstLayout)}`);
  assert.ok(firstLayout.documentWidth <= firstLayout.viewport.width + 1);
  await first.page.screenshot({ path: path.join(artifactRoot, '01-first-launch-dark.png') });

  await confirmButton.click();
  await dialog.waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await first.page.locator('.app').getAttribute('inert'), null);
  const settingsAfterConfirm = await readSettings(firstUserData);
  const { acknowledgedNoticeVersion: beforeVersion, ...beforeOtherSettings } = settingsBeforeConfirm;
  const { acknowledgedNoticeVersion: afterVersion, ...afterOtherSettings } = settingsAfterConfirm;
  assert.equal(beforeVersion, 0);
  assert.equal(afterVersion, 1);
  assert.deepEqual(afterOtherSettings, beforeOtherSettings, 'Confirmation must preserve every unrelated setting.');
  assert.deepEqual(first.errors, []);
} finally {
  await first.app.close();
}

const second = await launchApp(firstUserData);
try {
  await second.page.waitForTimeout(400);
  assert.equal(await second.page.getByRole('dialog', { name: '使用前必看｜先选择制作路线' }).count(), 0);
  assert.equal(await second.page.locator('.app').getAttribute('inert'), null);
  assert.deepEqual(second.errors, []);
} finally {
  await second.app.close();
}

const olderSettings = await readSettings(firstUserData);
olderSettings.acknowledgedNoticeVersion = 0;
await writeFile(path.join(firstUserData, 'settings.json'), JSON.stringify(olderSettings, null, 2), 'utf8');
const olderVersion = await launchApp(firstUserData);
try {
  await olderVersion.page.getByRole('dialog', { name: '使用前必看｜先选择制作路线' }).waitFor();
  assert.deepEqual(olderVersion.errors, []);
} finally {
  await olderVersion.app.close();
}

const failureUserData = path.join(artifactRoot, 'write-failure-user-data');
await mkdir(path.join(failureUserData, 'settings.json'), { recursive: true });
const failure = await launchApp(failureUserData);
try {
  const dialog = failure.page.getByRole('dialog', { name: '使用前必看｜先选择制作路线' });
  await dialog.waitFor();
  const button = dialog.getByRole('button', { name: '我已确认，进入耀创工坊' });
  await button.click();
  await dialog.getByText('保存失败，请重试', { exact: true }).waitFor();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await button.isEnabled(), true);
} finally {
  await failure.app.close();
}

const lightUserData = path.join(artifactRoot, 'light-compact-user-data');
await mkdir(lightUserData, { recursive: true });
await writeFile(
  path.join(lightUserData, 'settings.json'),
  JSON.stringify({ theme: 'light', acknowledgedNoticeVersion: 0 }, null, 2),
  'utf8'
);
const light = await launchApp(lightUserData, { width: 1024, height: 600 });
let compactLayout;
try {
  await light.page.getByRole('dialog', { name: '使用前必看｜先选择制作路线' }).waitFor();
  await light.page.waitForTimeout(250);
  compactLayout = await inspectNoticeLayout(light.page);
  assert.ok(compactLayout.modal.x >= 0 && compactLayout.modal.y >= 0);
  assert.ok(compactLayout.modal.x + compactLayout.modal.width <= compactLayout.viewport.width + 1);
  assert.ok(compactLayout.modal.y + compactLayout.modal.height <= compactLayout.viewport.height + 1);
  assert.ok(compactLayout.button.y + compactLayout.button.height <= compactLayout.viewport.height);
  assert.ok(compactLayout.documentWidth <= compactLayout.viewport.width + 1);
  assert.equal(await light.page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await light.page.screenshot({ path: path.join(artifactRoot, '02-first-launch-light-1024x600.png') });
  assert.deepEqual(light.errors, []);
} finally {
  await light.app.close();
}

console.log(JSON.stringify({
  ok: true,
  artifactRoot,
  firstLaunch: firstLayout,
  secondLaunchHidden: true,
  olderVersionShown: true,
  writeFailureRetained: true,
  lightCompact: compactLayout
}, null, 2));
