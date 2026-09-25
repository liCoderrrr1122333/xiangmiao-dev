import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

// UI-only fault injection; browser mutations are covered by the production-function fixtures.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.resolve('D:/Yaochuang-Workshop/TestArtifacts/1.2.4-manual-verification');
const userData = path.join(artifacts, `ui-profile-${Date.now()}`);
await mkdir(userData, { recursive: true });
await writeFile(path.join(userData, 'settings.json'), JSON.stringify({
  generationProvider: 'relay', apiProvider: 'ollama', chatGptKeepAliveEnabled: false
}));
const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [root], cwd: root, env: { ...process.env, YAOCHUANG_USER_DATA_DIR: userData }
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.locator('#root').waitFor();
  const notice = page.getByRole('button', { name: '我已确认，进入耀创工坊' });
  await notice.waitFor({ timeout: 15000 });
  await notice.click();
  await app.evaluate(({ ipcMain }) => {
    globalThis.verificationUiChecks = 0;
    ipcMain.removeHandler('chatgpt:check-protection-recovery');
    ipcMain.handle('chatgpt:check-protection-recovery', () => {
      const ok = ++globalThis.verificationUiChecks > 1;
      return { ok, protectionPaused: !ok, message: ok
        ? '人工检查通过，先以单路继续缺失任务。'
        : 'ChatGPT 仍在等待人工安全验证，软件不会刷新或重复发送。' };
    });
  });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('chatgpt-automation:status', {
      step: 'ChatGPT 等待人工安全验证',
      detail: '自动化已安全暂停，不会刷新或重新打开对话。请点击查看窗口手动完成验证，再点击检查恢复。已发送任务不会自动重发，未发送任务保留在断点。',
      level: 'warning', protectionPaused: true, effectiveParallelism: 0,
      batchTotal: 3, completedCount: 1, pendingCount: 2, failedCount: 0
    });
  });
  const recover = page.getByRole('button', { name: '检查恢复', exact: true });
  await recover.waitFor({ state: 'visible', timeout: 10000 });
  const status = page.locator('.automation-status');
  await recover.scrollIntoViewIfNeeded();
  assert.match(await status.getAttribute('class'), /warning/);
  assert.match(await status.innerText(), /失败 0/);
  await page.screenshot({ path: path.join(artifacts, 'paused-desktop.png'), scale: 'css' });
  await recover.click();
  await page.getByText('ChatGPT 仍在等待人工安全验证，软件不会刷新或重复发送。', { exact: true }).waitFor();
  assert.equal(await recover.isVisible(), true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 780));
  await recover.scrollIntoViewIfNeeded();
  const fit = await status.evaluate(el => ({ width: el.clientWidth, contentWidth: el.scrollWidth }));
  assert.ok(fit.contentWidth <= fit.width + 1, 'long pause copy must not overflow');
  await page.screenshot({ path: path.join(artifacts, 'paused-compact.png'), scale: 'css' });
  await recover.click();
  await page.getByText('人工检查通过，先以单路继续缺失任务。', { exact: true }).waitFor();
  assert.equal(await recover.count(), 0);
  assert.match(await status.getAttribute('class'), /success/);
  assert.equal(await app.evaluate(() => globalThis.verificationUiChecks), 2);
  assert.deepEqual(errors, []);
  const report = { passed: true, checks: ['pause-warning-not-failure', 'no-horizontal-overflow',
    'failed-check-stays-paused', 'explicit-success', 'no-renderer-errors'], realProviderRequests: 0 };
  await writeFile(path.join(artifacts, 'ui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await app.close(); }
