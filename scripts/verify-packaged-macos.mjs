import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

if (process.platform !== 'darwin') throw new Error('此验证必须在 macOS 上运行。');

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const releaseRoot = path.join(projectRoot, 'release');
const releaseEntries = await readdir(releaseRoot, { withFileTypes: true });
const unpackedDirectory = releaseEntries.find((entry) => entry.isDirectory() && /^mac(?:-|$)/.test(entry.name));
assert.ok(unpackedDirectory, '未找到 electron-builder 生成的 mac 或 mac-* 目录。');

const appRoot = path.join(releaseRoot, unpackedDirectory.name, `${packageMetadata.build?.productName || '耀创工坊'}.app`);
const executablePath = path.join(appRoot, 'Contents', 'MacOS', packageMetadata.build?.productName || '耀创工坊');
const dmgName = `Yaochuang-Workshop-${packageMetadata.version}-${process.arch}.dmg`;
const dmgPath = path.join(releaseRoot, dmgName);
assert.equal(existsSync(executablePath), true, `应用可执行文件不存在：${executablePath}`);
assert.equal(existsSync(dmgPath), true, `DMG 不存在：${dmgPath}`);

const artifactRoot = path.join(os.tmpdir(), `yaochuang-packaged-mac-${process.pid}`);
const userDataDir = path.join(artifactRoot, 'user-data');
await rm(artifactRoot, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });

const electronApp = await electron.launch({
  executablePath,
  cwd: path.dirname(appRoot),
  env: { ...process.env, YAOCHUANG_USER_DATA_DIR: userDataDir }
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
  await page.locator('.levitated-workbench').waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await page.title(), '耀创工坊');
  console.log(JSON.stringify({ ok: true, runtime, dmgPath }, null, 2));
} finally {
  await electronApp.close().catch(() => undefined);
  await rm(artifactRoot, { recursive: true, force: true });
}
