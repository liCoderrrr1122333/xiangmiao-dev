import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = path.join(repoRoot, 'dist');
const imagePath = process.env.YAOCHUANG_TEST_IMAGE || path.join(repoRoot, 'public', 'yaochuang-unified-v2.png');
const artifactRoot =
  process.env.YAOCHUANG_TEST_ARTIFACTS || 'D:\\Yaochuang-Workshop\\TestArtifacts\\1.2.4-local-analysis-ui';
const chromePath = process.env.YAOCHUANG_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.wasm', 'application/wasm']
]);

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function createStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const requested = path.resolve(distRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
      const filePath = inside(distRoot, requested) ? requested : path.join(distRoot, 'index.html');
      const content = await readFile(filePath).catch(() => readFile(path.join(distRoot, 'index.html')));
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

async function assertLayout(page, minimumCanvasWidth) {
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('.canvas-wrap canvas');
    const visibleToolbarButtons = [...document.querySelectorAll('.toolbar-actions button')].filter(
      (element) => element instanceof HTMLElement && element.offsetParent !== null
    );
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      canvasWidth: canvas?.getBoundingClientRect().width || 0,
      toolbarButtonCount: visibleToolbarButtons.length,
      toolbarButtonsNamed: visibleToolbarButtons.every((element) => Boolean(element.getAttribute('aria-label'))),
      theme: document.documentElement.dataset.theme,
      background: getComputedStyle(document.documentElement).getPropertyValue('--app-background').trim()
    };
  });
  assert.ok(result.documentWidth <= result.viewportWidth + 1, '页面不应产生横向溢出');
  assert.ok(result.canvasWidth >= minimumCanvasWidth, '主画布宽度不足');
  assert.equal(result.toolbarButtonCount, 9, '顶栏核心操作不得在窄窗口中消失');
  assert.equal(result.toolbarButtonsNamed, true, '顶栏图标操作必须拥有可访问名称');
  return result;
}

function attachConsoleAudit(page, errors) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
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

await mkdir(artifactRoot, { recursive: true });
const { server, url } = await createStaticServer();
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const consoleErrors = [];

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  attachConsoleAudit(page, consoleErrors);
  await page.goto(url, { waitUntil: 'networkidle' });
  await assertLayout(page, 620);
  assert.equal(await page.getByText('耀创工坊', { exact: true }).count(), 1, '顶栏必须保留唯一产品名称');
  assert.equal(
    await page.getByText('Image 2.0 区域锁定工作台', { exact: true }).count(),
    0,
    '顶栏不应继续显示旧副标题'
  );
  assert.equal(await page.getByText('穿搭参考图', { exact: true }).count(), 1, '穿搭素材区标题必须清晰命名');
  assert.equal(
    await page.getByRole('button', { name: '进入微调' }).isDisabled(),
    true,
    '没有已生成提示词时不应允许进入微调'
  );
  const routeDisclosure = page.getByRole('button', { name: /制作通道/ });
  if (await routeDisclosure.getAttribute('aria-expanded') === 'false') await routeDisclosure.click();
  const generationGemini = page.getByRole('group', { name: '最终做图通道' }).getByRole('button').filter({ hasText: 'Gemini' });
  const analysisGemini = page.getByRole('group', { name: 'AI 分析来源' }).getByRole('button').filter({ hasText: 'Gemini' });
  assert.equal(await generationGemini.isDisabled(), true, 'Gemini 做图入口在适配完成前必须灰显禁用');
  assert.equal(await analysisGemini.isDisabled(), true, 'Gemini 分析入口在适配完成前必须灰显禁用');
  assert.match(await generationGemini.getAttribute('title') || '', /适配中，暂不可用/);
  await page.getByRole('group', { name: '最终做图通道' }).getByRole('button', { name: 'API', exact: true }).click();
  await page.getByRole('button', { name: '配置 API', exact: true }).first().click();
  const relayDialog = page.getByRole('dialog', { name: '配置自由 API' });
  await relayDialog.waitFor({ state: 'visible' });
  assert.equal(await relayDialog.getByLabel('服务地址（Base URL）').inputValue(), '', '新安装不能内置服务商地址');
  await relayDialog.locator('summary').click();
  const standardRelayModel = relayDialog.getByRole('radio', { name: /标准图片/ });
  const bananaRelayModel = relayDialog.getByRole('radio', { name: /香蕉生图/ });
  assert.equal(await standardRelayModel.count(), 1, 'API 必须保留 gpt-image-2 标准图片选项');
  assert.equal(await bananaRelayModel.count(), 1, 'API 必须提供香蕉生图选项');
  assert.equal(await standardRelayModel.getAttribute('aria-checked'), 'true', '新项目应默认使用标准图片');
  await bananaRelayModel.click();
  assert.equal(await bananaRelayModel.getAttribute('aria-checked'), 'true', '香蕉生图选项必须可以选中');
  assert.equal(await relayDialog.getByText('Gemini 图片', { exact: true }).count(), 1, '配置摘要必须同步显示协议');
  assert.equal(await relayDialog.getByText('自动匹配原图', { exact: true }).count(), 1, 'API 输出尺寸必须自动匹配原图');
  assert.equal(await relayDialog.getByLabel('图片编辑接口路径', { exact: true }).count(), 1, '用户可以手工填写接口路径');
  assert.equal(await relayDialog.getByLabel('API Key').count(), 1, '配置窗口只要求用户粘贴自己的 API Key');
  await page.screenshot({ path: path.join(artifactRoot, 'relay-key-only-dark-1440x900.png') });
  await page.getByLabel('关闭 API 配置').click();
  await page.getByRole('group', { name: 'AI 分析来源' }).getByRole('button', { name: '本地模型', exact: true }).click();
  assert.equal(
    await page.getByText('本地模型分析 → 自由 API 做图', { exact: true }).count(),
    1,
    '制作通道必须在分析前明确显示本地模型分析与 API 做图的组合'
  );
  await page.locator('.local-analysis-setup').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(artifactRoot, 'provider-route-local-api-dark-1440x900.png') });
  await page.getByRole('group', { name: 'AI 分析来源' }).getByRole('button', { name: 'ChatGPT', exact: true }).click();
  await page.getByRole('group', { name: '最终做图通道' }).getByRole('button', { name: 'ChatGPT', exact: true }).click();
  await page.screenshot({ path: path.join(artifactRoot, 'workbench-dark-empty-1440x900.png') });

  await page.getByTitle('示例项目').click();
  await installImageImportFixture(page);
  await page.locator('#main-upload-input').setInputFiles(imagePath);
  await page.locator('#ref-upload-input').setInputFiles(imagePath);
  await page.locator('#wardrobe-upload-input').setInputFiles(imagePath);
  await page.locator('.scene-card textarea').fill('场景界面标记：原图人物站在旧衣柜旁。');
  await page.locator('.pose-card textarea').fill('姿态界面标记：原图人物双手交叉。');
  await page.locator('.face-card textarea').fill('面部界面标记：原图人物侧脸朝左。');
  await page.locator('.light-card textarea').fill('光影界面标记：柔和侧光、自然淡妆、保留手机画质。');
  await page.getByTitle('绘制红圈').click();
  const canvasBox = await page.locator('.canvas-wrap canvas').boundingBox();
  assert.ok(canvasBox, '主画布必须可用于穿搭提示词验证');
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.3, canvasBox.y + canvasBox.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.7, canvasBox.y + canvasBox.height * 0.75, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: '一键生成提示词' }).click();
  assert.equal(await page.getByRole('button', { name: '开始做图' }).count(), 1, '单张做图主操作必须使用简洁文案');
  assert.equal(
    await page.getByRole('button', { name: '开始做图' }).getAttribute('data-ready'),
    'true',
    '主图、红圈、参考图和提示词就绪后，未执行可选蒙脸也必须允许开始做图'
  );
  const wardrobePrompt = await page.locator('.prompt-output').inputValue();
  assert.doesNotMatch(wardrobePrompt, /场景界面标记|姿态界面标记|面部界面标记/);
  assert.match(wardrobePrompt, /光影界面标记/);
  assert.match(wardrobePrompt, /最终图片中的目标人物必须是人脸参考图中的目标男生/);
  assert.match(wardrobePrompt, /【穿搭规则】/);
  assert.match(wardrobePrompt, /穿搭参考图是对应服饰外观的唯一基准/);
  assert.match(wardrobePrompt, /本轮只继承原图分析中的光影、妆容与画质/);
  assert.doesNotMatch(wardrobePrompt, /本轮没有穿搭参考图|【姿势规则】|最高优先级|Image 2\.0/);
  assert.equal((wardrobePrompt.match(/【穿搭规则】/g) || []).length, 1, '穿搭规则不得重复');
  const adjustmentButton = page.getByRole('button', { name: '进入微调' });
  assert.equal(await adjustmentButton.isEnabled(), true, '生成提示词后应允许进入微调');
  await adjustmentButton.click();
  const adjustmentDialog = page.getByRole('dialog', { name: '提示词自定义微调' });
  await adjustmentDialog.waitFor({ state: 'visible' });
  const adjustmentEditor = page.getByLabel('微调后的提示词');
  assert.equal(await adjustmentEditor.inputValue(), wardrobePrompt, '微调必须继承当前已生成提示词');
  await adjustmentEditor.fill(`${wardrobePrompt}\n取消验证标记`);
  await adjustmentDialog.getByRole('button', { name: '取消' }).click();
  assert.equal(await page.locator('.prompt-output').inputValue(), wardrobePrompt, '取消微调不得改变原提示词');

  await adjustmentButton.click();
  const adjustedPrompt = `${wardrobePrompt}\n微调保存验证标记`;
  await page.getByLabel('微调后的提示词').fill(adjustedPrompt);
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(artifactRoot, 'prompt-adjustment-dark-1440x900.png') });
  await page.getByRole('button', { name: '保存修改' }).click();
  assert.equal(await page.locator('.prompt-output').inputValue(), adjustedPrompt, '保存后必须一次性回写微调内容');
  assert.equal(await page.locator('.prompt-editor-top em').textContent(), '自定义');
  await page.waitForTimeout(180);
  await assertLayout(page, 620);
  await page.screenshot({ path: path.join(artifactRoot, 'workbench-dark-populated-1440x900.png') });

  await page.getByRole('button', { name: '进入微调' }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(220);
  const compactDialogBox = await page.getByRole('dialog', { name: '提示词自定义微调' }).boundingBox();
  assert.ok(compactDialogBox, '1280x720 下微调窗口必须可见');
  assert.ok(compactDialogBox.width >= 1000 && compactDialogBox.height >= 520, '微调窗口必须提供足够的编辑面积');
  assert.ok(compactDialogBox.x >= 16 && compactDialogBox.y >= 16, '微调窗口不得越出左上边界');
  assert.ok(compactDialogBox.x + compactDialogBox.width <= 1264, '微调窗口不得越出右边界');
  assert.ok(compactDialogBox.y + compactDialogBox.height <= 704, '微调窗口不得越出下边界');
  await page.screenshot({ path: path.join(artifactRoot, 'prompt-adjustment-dark-1280x720.png') });
  await page.getByLabel('关闭提示词微调').click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(120);

  const originalCanvasWidth = await page.locator('.canvas-wrap canvas').evaluate((element) => element.getBoundingClientRect().width);
  await page.getByTitle('收起原图理解').click();
  await page.getByTitle('收起制作流程').click();
  await page.waitForTimeout(120);
  const expandedCanvasWidth = await page.locator('.canvas-wrap canvas').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(expandedCanvasWidth > originalCanvasWidth * 1.4, '面板收起后画布必须扩展');
  await page.screenshot({ path: path.join(artifactRoot, 'workbench-dark-canvas-focus-1440x900.png') });
  await page.getByTitle('展开原图理解').click();
  await page.getByTitle('展开制作流程').click();

  await page.getByRole('button', { name: '打开设置' }).click();
  await page.screenshot({ path: path.join(artifactRoot, 'workbench-dark-settings-1440x900.png') });
  await page.locator('label').filter({ hasText: '主题' }).locator('select').selectOption('light');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(artifactRoot, 'workbench-light-settings-1440x900.png') });
  await page.getByLabel('关闭设置').click();
  await page.waitForTimeout(100);
  const lightLayout = await assertLayout(page, 620);
  assert.equal(lightLayout.theme, 'light');
  assert.equal(lightLayout.background.toLowerCase(), '#f1f1f3');
  await page.screenshot({ path: path.join(artifactRoot, 'workbench-light-populated-1440x900.png') });
  await page.getByRole('button', { name: '进入微调' }).click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(artifactRoot, 'prompt-adjustment-light-1440x900.png') });
  await page.getByLabel('关闭提示词微调').click();
  await desktop.close();

  const compact = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const compactPage = await compact.newPage();
  attachConsoleAudit(compactPage, consoleErrors);
  await compactPage.goto(url, { waitUntil: 'networkidle' });
  await compactPage.getByTitle('示例项目').click();
  await installImageImportFixture(compactPage);
  await compactPage.locator('#main-upload-input').setInputFiles(imagePath);
  await compactPage.locator('#ref-upload-input').setInputFiles(imagePath);
  await compactPage.waitForTimeout(150);
  await assertLayout(compactPage, 540);
  await compactPage.screenshot({ path: path.join(artifactRoot, 'workbench-dark-compact-1280x720.png') });

  await compactPage.evaluate(() => {
    const panel = document.querySelector('.workflow-action-buttons');
    if (!panel) return;
    const status = document.createElement('div');
    status.className = 'automation-status warning visual-audit-state';
    status.setAttribute('role', 'status');
    status.innerHTML = [
      '<strong>ChatGPT 自动冷却中</strong>',
      '<span>页面已要求降低频率，当前保持零点击，冷却结束后自动续做。</span>',
      '<div class="automation-runtime-metrics" aria-label="批量运行监控">',
      '<span>任务 7/20</span><span>待执行 13</span><span>待确认 1</span>',
      '<span>完成 6</span><span>失败 0</span>',
      '<span>总耗时 18分32秒</span><span>均耗时 2分41秒</span><span>节奏 冷却</span><span>恢复 19:08</span>',
      '</div>'
    ].join('');
    panel.append(status);
    status.scrollIntoView({ block: 'center' });
  });
  await compactPage.screenshot({ path: path.join(artifactRoot, 'workbench-state-generating-1280x720.png') });

  await compactPage.evaluate(() => {
    const status = document.querySelector('.visual-audit-state');
    if (!status) return;
    status.className = 'automation-status error visual-audit-state';
    status.innerHTML = '<strong>生成失败</strong><span>网页没有接收附件，请检查窗口后重试。</span>';
  });
  await compactPage.screenshot({ path: path.join(artifactRoot, 'workbench-state-error-1280x720.png') });

  await compactPage.evaluate(() => {
    const status = document.querySelector('.visual-audit-state');
    if (!status) return;
    status.className = 'automation-status success visual-audit-state';
    status.innerHTML = '<strong>生成完成</strong><span>5 张结果已按任务顺序保存。</span>';
  });
  await compactPage.screenshot({ path: path.join(artifactRoot, 'workbench-state-complete-1280x720.png') });
  await compact.close();

  const highDpi = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const highDpiPage = await highDpi.newPage();
  attachConsoleAudit(highDpiPage, consoleErrors);
  await highDpiPage.goto(url, { waitUntil: 'networkidle' });
  await highDpiPage.getByTitle('示例项目').click();
  await installImageImportFixture(highDpiPage);
  await highDpiPage.locator('#main-upload-input').setInputFiles(imagePath);
  await highDpiPage.locator('#ref-upload-input').setInputFiles(imagePath);
  await highDpiPage.waitForTimeout(150);
  await assertLayout(highDpiPage, 620);
  await highDpiPage.screenshot({ path: path.join(artifactRoot, 'workbench-dark-high-dpi-1440x900.png') });
  await highDpi.close();

  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({ ok: true, artifactRoot, screenshots: 14 }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
