import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

if (process.platform !== 'darwin') throw new Error('此验证必须在 macOS 上运行。');

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const artifactRoot = path.join(os.tmpdir(), `xiangmao-mac-source-${process.pid}`);
const userDataDir = path.join(artifactRoot, 'user-data');

assert.equal(existsSync(electronExecutable), true, `Electron 不存在：${electronExecutable}`);
await rm(artifactRoot, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });

const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [projectRoot],
  cwd: projectRoot,
  env: { ...process.env, XIANGMAO_USER_DATA_DIR: userDataDir }
});

try {
  const runtime = await electronApp.evaluate(({ app }) => ({
    version: app.getVersion(),
    platform: process.platform,
    gpuSandboxDisabled: app.commandLine.hasSwitch('disable-gpu-sandbox')
  }));
  assert.deepEqual(runtime, {
    version: packageMetadata.version,
    platform: 'darwin',
    gpuSandboxDisabled: false
  });

  const page = await electronApp.firstWindow({ timeout: 30_000 });
  const rendererErrors = [];
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  await page.locator('.levitated-workbench').waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await page.title(), '像锚');
  assert.equal(await page.evaluate(() => Boolean(window.xiangmao)), true);
  assert.deepEqual(rendererErrors, []);
  console.log(JSON.stringify({ ok: true, runtime, rendererErrors }, null, 2));
} finally {
  await electronApp.close().catch(() => undefined);
  await rm(artifactRoot, { recursive: true, force: true });
}
