import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = path.join(repoRoot, 'dist');
const imagePath = process.env.YAOCHUANG_TEST_IMAGE || path.join(repoRoot, 'public', 'yaochuang-unified-v2.png');
const chromePath = process.env.YAOCHUANG_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactRoot =
  process.env.YAOCHUANG_TEST_ARTIFACTS || 'D:\\Yaochuang-Workshop\\TestArtifacts\\1.2.4-adaptive-canvas';
const viewports = [
  { width: 1024, height: 600 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }
];
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm']
]);

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function installImageImportFixture(page) {
  await page.evaluate(() => {
    window.masklock = {
      normalizeImageImport: async (payload) => {
        const type = payload.mimeType || 'image/png';
        const blob = new Blob([payload.data], { type });
        const bitmap = await createImageBitmap(blob);
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('Fixture image read failed.'));
          reader.readAsDataURL(blob);
        });
        return {
          ok: true,
          image: {
            name: payload.name,
            type,
            size: payload.data.byteLength,
            width: bitmap.width,
            height: bitmap.height,
            dataUrl,
            sourceFormat: 'png',
            converted: false
          }
        };
      },
      writeRecentAutoSave: async () => true,
      writeSettings: async () => true
    };
  });
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

async function measure(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`缺少元素：${selector}`);
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    };
    const canvas = document.querySelector('.canvas-wrap canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('缺少原图画布。');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      workbench: rect('.workbench'),
      left: rect('.left-stack'),
      center: rect('.center-stack'),
      right: rect('.right-stack'),
      panel: rect('.main-canvas-panel'),
      wrap: rect('.main-canvas-panel .canvas-wrap'),
      canvas: rect('.main-canvas-panel .canvas-wrap canvas'),
      intrinsic: { width: canvas.width, height: canvas.height }
    };
  });
}

await mkdir(artifactRoot, { recursive: true });
const { server, url } = await createStaticServer();
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await installImageImportFixture(page);
    await page.locator('#main-upload-input').setInputFiles(imagePath);
    await page.waitForFunction(() => !document.querySelector('.canvas-status-strip')?.textContent?.includes('尚未上传主图'));
    await page.waitForTimeout(150);
    const layout = await measure(page);

    assert.ok(layout.documentWidth <= viewport.width + 1, `${viewport.width}x${viewport.height} 不应产生页面级横向溢出`);
    assert.ok(layout.canvas.width >= 480, `${viewport.width}x${viewport.height} 画布宽度过小`);
    assert.ok(layout.canvas.height >= 300, `${viewport.width}x${viewport.height} 画布高度过小`);
    assert.ok(layout.canvas.x >= layout.wrap.x - 1 && layout.canvas.right <= layout.wrap.right + 1);
    assert.ok(layout.canvas.y >= layout.wrap.y - 1 && layout.canvas.bottom <= layout.wrap.bottom + 1);
    assert.ok(Math.abs(layout.intrinsic.width - Math.round(layout.canvas.width)) <= 3, '画布像素宽度必须跟随实际显示宽度');
    assert.ok(Math.abs(layout.intrinsic.height - Math.round(layout.canvas.height)) <= 3, '画布像素高度必须跟随实际显示高度');
    if (viewport.width >= 1180) {
      assert.ok(layout.left.width / layout.workbench.width >= 0.4, `${viewport.width}px 桌面原图列占比不足`);
      assert.ok(layout.left.right <= layout.center.x + 1, '原图列与原图理解列发生重叠');
      assert.ok(layout.center.right <= layout.right.x + 1, '原图理解列与工作流列发生重叠');
    }
    assert.deepEqual(consoleErrors, []);
    await page.screenshot({ path: path.join(artifactRoot, `adaptive-${viewport.width}x${viewport.height}.png`) });
    results.push({ viewport, layout });
    await context.close();
  }

  const desktopResults = results.filter(({ viewport }) => viewport.width >= 1280);
  for (let index = 1; index < desktopResults.length; index += 1) {
    assert.ok(
      desktopResults[index].layout.canvas.width > desktopResults[index - 1].layout.canvas.width,
      '更宽的桌面必须获得更宽的原图画布'
    );
    assert.ok(
      desktopResults[index].layout.canvas.height >= desktopResults[index - 1].layout.canvas.height,
      '更高的桌面不能缩小原图画布高度'
    );
  }

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await installImageImportFixture(page);
  await page.locator('#main-upload-input').setInputFiles(imagePath);
  const canvasLocator = page.locator('.canvas-wrap canvas');
  await page.evaluate(() => {
    const left = document.querySelector('.left-stack');
    if (left) left.scrollTop = 0;
  });
  const canvasBeforeWheel = await canvasLocator.boundingBox();
  assert.ok(canvasBeforeWheel);
  const zoomBeforeWheel = await page.locator('.canvas-status-strip').textContent();
  await page.mouse.move(
    canvasBeforeWheel.x + canvasBeforeWheel.width / 2,
    canvasBeforeWheel.y + canvasBeforeWheel.height / 2
  );
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(100);
  const wheelResult = await page.evaluate(() => ({
    leftScrollTop: document.querySelector('.left-stack')?.scrollTop || 0,
    status: document.querySelector('.canvas-status-strip')?.textContent || ''
  }));
  assert.equal(wheelResult.leftScrollTop, 0, '画布滚轮缩放不得带动左栏滚动');
  assert.notEqual(wheelResult.status, zoomBeforeWheel, '画布滚轮应改变缩放状态');

  const overlayBox = await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    if (!(wrap instanceof HTMLElement)) return undefined;
    const overlay = document.createElement('div');
    overlay.dataset.canvasWheelOverlayFixture = 'true';
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '24px',
      zIndex: '20',
      pointerEvents: 'auto',
      background: 'transparent'
    });
    wrap.append(overlay);
    const box = overlay.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  assert.ok(overlayBox && overlayBox.width > 0 && overlayBox.height > 0);
  const zoomBeforeOverlayWheel = await page.locator('.canvas-status-strip').textContent();
  await page.mouse.move(overlayBox.x + overlayBox.width / 2, overlayBox.y + overlayBox.height / 2);
  await page.mouse.wheel(0, -160);
  await page.waitForTimeout(100);
  const overlayWheelResult = await page.evaluate(() => ({
    leftScrollTop: document.querySelector('.left-stack')?.scrollTop || 0,
    status: document.querySelector('.canvas-status-strip')?.textContent || ''
  }));
  assert.equal(overlayWheelResult.leftScrollTop, 0, '画布覆盖层接收滚轮时也不得带动左栏滚动');
  assert.notEqual(overlayWheelResult.status, zoomBeforeOverlayWheel, '画布覆盖层上的滚轮仍应缩放图片');
  await page.evaluate(() => document.querySelector('[data-canvas-wheel-overlay-fixture]')?.remove());

  const leftStackBox = await page.locator('.left-stack').boundingBox();
  assert.ok(leftStackBox);
  await page.mouse.move(leftStackBox.x + 2, leftStackBox.y + 80);
  await page.mouse.wheel(0, 420);
  await page.waitForTimeout(100);
  assert.ok(
    await page.evaluate(() => document.querySelector('.left-stack')?.scrollTop || 0) > 0,
    '鼠标位于画布外时左栏必须保持正常滚动'
  );
  await page.evaluate(() => {
    const left = document.querySelector('.left-stack');
    if (left) left.scrollTop = 0;
  });
  const canvasBeforeCollapse = await canvasLocator.boundingBox();
  assert.ok(canvasBeforeCollapse);
  await page.getByTitle('收起原图理解').click();
  await page.getByTitle('收起制作流程').click();
  await page.waitForTimeout(120);
  const canvasAfterCollapse = await canvasLocator.boundingBox();
  assert.ok(canvasAfterCollapse);
  assert.ok(canvasAfterCollapse.width > canvasBeforeCollapse.width * 1.4, '收起辅助面板后原图画布应明显扩展');
  assert.equal(await page.locator('.center-stack').isVisible(), false, '原图理解面板应可收起');
  assert.equal(await page.locator('.right-stack').isVisible(), false, '制作流程面板应可收起');
  await page.getByTitle('展开原图理解').click();
  await page.getByTitle('展开制作流程').click();
  await page.waitForTimeout(120);
  await page.getByTitle('绘制红圈').click();
  const beforeResize = await page.locator('.canvas-wrap canvas').boundingBox();
  assert.ok(beforeResize);
  await page.mouse.move(beforeResize.x + beforeResize.width * 0.35, beforeResize.y + beforeResize.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(beforeResize.x + beforeResize.width * 0.68, beforeResize.y + beforeResize.height * 0.72, { steps: 8 });
  await page.mouse.up();
  await page.getByText('红圈已锁定', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(200);
  await page.getByText('红圈已锁定', { exact: true }).waitFor();
  const afterResize = await measure(page);
  assert.ok(afterResize.canvas.width > beforeResize.width, '窗口放大后画布应立即扩展');
  assert.ok(Math.abs(afterResize.intrinsic.width - Math.round(afterResize.canvas.width)) <= 3);
  await context.close();

  console.log(
    JSON.stringify({
      ok: true,
      artifactRoot,
      canvasSizes: results.map(({ viewport, layout }) => ({ viewport, canvas: layout.canvas, panel: layout.panel }))
    })
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

const electronUserData = path.join(artifactRoot, `electron-user-data-${process.pid}`);
const packagedElectronPath = process.env.YAOCHUANG_ELECTRON_PATH?.trim();
const electronApp = await electron.launch({
  executablePath: packagedElectronPath || undefined,
  args: packagedElectronPath ? [] : [repoRoot],
  cwd: repoRoot,
  env: { ...process.env, YAOCHUANG_USER_DATA_DIR: electronUserData }
});
try {
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
  assert.equal(appVersion, '1.2.4');
  const nativeLayout = await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window) throw new Error('未找到耀创工坊主窗口。');
    const bounds = window.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    return { bounds, workArea };
  });
  assert.ok(nativeLayout.bounds.width / nativeLayout.workArea.width >= 0.9, '原生窗口没有充分利用显示器宽度');
  assert.ok(nativeLayout.bounds.height / nativeLayout.workArea.height >= 0.9, '原生窗口没有充分利用显示器高度');
  assert.ok(nativeLayout.bounds.x >= nativeLayout.workArea.x);
  assert.ok(nativeLayout.bounds.y >= nativeLayout.workArea.y);
  assert.ok(nativeLayout.bounds.x + nativeLayout.bounds.width <= nativeLayout.workArea.x + nativeLayout.workArea.width);
  assert.ok(nativeLayout.bounds.y + nativeLayout.bounds.height <= nativeLayout.workArea.y + nativeLayout.workArea.height);
  await page.screenshot({ path: path.join(artifactRoot, 'adaptive-electron-native.png') });
  console.log(JSON.stringify({ ok: true, appVersion, packagedElectronPath, nativeLayout, electronUserData }));
} finally {
  await electronApp.close();
}
