import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = path.join(repoRoot, 'dist');
const chromePath = process.env.YAOCHUANG_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const imagePath = process.env.YAOCHUANG_TEST_IMAGE || path.join(repoRoot, 'public', 'yaochuang-unified-v2.png');
const electronPath = process.env.YAOCHUANG_ELECTRON_PATH;
const electronAppPath = process.env.YAOCHUANG_ELECTRON_APP;
const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm']
]);

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function createStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const requested = path.resolve(distRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
      const filePath = isInside(distRoot, requested) ? requested : path.join(distRoot, 'index.html');
      let content;
      try {
        content = await readFile(filePath);
      } catch {
        content = await readFile(path.join(distRoot, 'index.html'));
      }
      response.writeHead(200, {
        'content-type': mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      response.end(content);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

const staticServer = !electronPath && !process.env.YAOCHUANG_TEST_URL
  ? await createStaticServer()
  : undefined;
const appUrl = process.env.YAOCHUANG_TEST_URL || staticServer?.url;
assert.ok(electronPath || appUrl, 'A packaged Electron path or a local test URL is required.');

const electronApp = electronPath
  ? await electron.launch({
      executablePath: electronPath,
      args: electronAppPath ? [electronAppPath] : undefined,
      env: {
        ...process.env,
        YAOCHUANG_USER_DATA_DIR:
          process.env.YAOCHUANG_USER_DATA_DIR || 'D:\\Yaochuang-Workshop\\TestArtifacts\\1.1.4-stability\\batch-regeneration-user-data'
      }
    })
  : undefined;
const browser = electronApp ? undefined : await chromium.launch({ headless: true, executablePath: chromePath });
try {
  const packagedVersion = electronApp ? await electronApp.evaluate(({ app }) => app.getVersion()) : undefined;
  if (packagedVersion) assert.equal(packagedVersion, packageMetadata.version);
  const page = electronApp
    ? await electronApp.firstWindow()
    : await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  if (!electronApp) await page.goto(appUrl, { waitUntil: 'networkidle' });
  const startupNoticeConfirm = page.getByRole('button', { name: '我已确认，进入耀创工坊' });
  const startupNoticeShown = electronApp
    ? await startupNoticeConfirm.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)
    : false;
  if (startupNoticeShown) {
    await startupNoticeConfirm.click();
    await startupNoticeConfirm.waitFor({ state: 'detached', timeout: 10_000 });
  }
  else await page.waitForLoadState('domcontentloaded');
  await page.locator('#main-upload-input').setInputFiles(imagePath);
  await page.locator('#ref-upload-input').setInputFiles(imagePath);
  assert.equal(await page.locator('#ref-upload-input').inputValue(), '', 'reference input must reset after every selection');

  await page.getByTitle('绘制红圈').click();
  const canvasBox = await page.locator('.canvas-wrap canvas').boundingBox();
  assert.ok(canvasBox, 'main canvas must be visible');
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.35, canvasBox.y + canvasBox.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.68, canvasBox.y + canvasBox.height * 0.72, { steps: 8 });
  await page.mouse.up();

  await page.getByRole('button', { name: '一键生成提示词' }).click();
  for (let index = 0; index < 4; index += 1) await page.getByRole('button', { name: '增加生成张数' }).click();

  const archiveTab = page.getByRole('button', { name: '归档', exact: true });
  await archiveTab.scrollIntoViewIfNeeded();
  const [workflowBox, archiveBox] = await Promise.all([
    page.locator('.workflow-action-panel').boundingBox(),
    archiveTab.boundingBox()
  ]);
  assert.ok(workflowBox && archiveBox, 'workflow panel and archive tab must both be visible');
  const workflowOverlapsArchive =
    workflowBox.x < archiveBox.x + archiveBox.width &&
    workflowBox.x + workflowBox.width > archiveBox.x &&
    workflowBox.y < archiveBox.y + archiveBox.height &&
    workflowBox.y + workflowBox.height > archiveBox.y;
  assert.equal(workflowOverlapsArchive, false, 'workflow panel must not cover the archive tab at 1280x720');
  await archiveTab.click();
  await page.locator('#result-upload-input').setInputFiles(imagePath);

  const regenerate = page.locator('.prompt-send-cta');
  await page.waitForFunction(() => document.querySelector('.prompt-send-cta')?.textContent?.includes('重新生成 5 张'));
  assert.equal(await regenerate.isDisabled(), false);
  assert.equal(await regenerate.getAttribute('data-ready'), 'true');

  await page.locator('.reference-panel').getByRole('button', { name: '批量清空' }).click();
  assert.equal(await regenerate.isDisabled(), false, 'missing prerequisites must remain clickable for feedback');
  assert.equal(await regenerate.getAttribute('data-ready'), 'false');
  await regenerate.click();
  await page.getByRole('status').filter({ hasText: '请重新上传至少一张人脸参考图。若选择同名文件，软件现在也会重新读取。' }).waitFor();

  await page.locator('#ref-upload-input').setInputFiles(imagePath);
  assert.equal(await page.locator('#ref-upload-input').inputValue(), '');
  await page.waitForFunction(() => document.querySelector('.prompt-send-cta')?.getAttribute('data-ready') === 'true');
  assert.equal(await regenerate.isDisabled(), false);

  await page.getByRole('button', { name: '减少生成张数' }).click();
  await page.getByRole('button', { name: '减少生成张数' }).click();
  await page.waitForFunction(() => document.querySelector('.prompt-send-cta')?.textContent?.includes('重新生成 3 张'));

  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({
    ok: true,
    sameFileReselected: true,
    regenerateReady: await regenerate.getAttribute('data-ready'),
    buttonText: (await regenerate.textContent())?.replace(/\s+/g, ' ').trim(),
    packagedVersion,
    consoleErrors
  }));
} finally {
  if (electronApp) await electronApp.close();
  else await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.server.close(resolve));
}
