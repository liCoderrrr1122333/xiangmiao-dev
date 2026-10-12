import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const unpackedRoot = path.join(repoRoot, 'release', 'win-unpacked');
const resourcesRoot = path.join(unpackedRoot, 'resources');
const packagedAppRoot = path.join(resourcesRoot, 'app');
const executablePath = path.join(unpackedRoot, '像锚.exe');
const artifactRoot = 'D:\\Xiangmao-Workshop\\TestArtifacts\\1.2.4-packaged-windows-compatibility';
const userDataDir = path.join(artifactRoot, 'user-data');

assert.equal(existsSync(path.join(resourcesRoot, 'app.asar')), false, 'packaged release must not contain app.asar');
assert.equal(existsSync(packagedAppRoot), true, 'packaged release must contain resources/app');
assert.equal(existsSync(path.join(packagedAppRoot, 'dist', 'index.html')), true);
assert.equal(existsSync(path.join(packagedAppRoot, 'dist-electron', 'main', 'index.js')), true);
assert.equal(existsSync(executablePath), true);

const packageMetadata = JSON.parse(await readFile(path.join(packagedAppRoot, 'package.json'), 'utf8'));
assert.equal(packageMetadata.version, '1.2.4');

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });

const electronApp = await electron.launch({
  executablePath,
  cwd: unpackedRoot,
  env: {
    ...process.env,
    XIANGMAO_USER_DATA_DIR: userDataDir
  }
});

try {
  const runtime = await electronApp.evaluate(({ app }) => ({
    version: app.getVersion(),
    gpuSandboxDisabled: app.commandLine.hasSwitch('disable-gpu-sandbox'),
    rendererSandboxDisabled: app.commandLine.hasSwitch('no-sandbox')
  }));
  assert.deepEqual(runtime, {
    version: '1.2.4',
    gpuSandboxDisabled: true,
    rendererSandboxDisabled: false
  });

  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForSelector('.levitated-workbench', { timeout: 30_000 });
  assert.equal(await page.title(), '像锚');
  const logoSource = await page.locator('.logo-mark').getAttribute('src');
  assert.match(logoSource || '', /xiangmao-tray\.png/);
  const screenshotPath = path.join(artifactRoot, 'packaged-startup.png');
  await page.screenshot({ path: screenshotPath });

  console.log(JSON.stringify({ ok: true, runtime, screenshotPath }, null, 2));
} finally {
  await electronApp.close().catch(() => undefined);
}
