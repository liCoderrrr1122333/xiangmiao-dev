import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const artifactRoot = process.env.YAOCHUANG_TEST_ARTIFACTS || 'D:\\Yaochuang-Workshop\\TestArtifacts\\1.2.4-web-pose-ui';
const userDataDir = path.join(artifactRoot, 'AppData');
const sourceImagePath = path.join(repoRoot, 'public', 'yaochuang-unified-v2.png');
const executablePath = process.env.YAOCHUANG_TEST_EXE?.trim();

await fs.mkdir(artifactRoot, { recursive: true });
await fs.rm(userDataDir, { recursive: true, force: true });

const imageDataUrl = `data:image/png;base64,${(await fs.readFile(sourceImagePath)).toString('base64')}`;
const descriptions = [
  '身体轻微侧向镜头，重心放在后腿，前肩自然下沉，手臂放松垂落，头部回望镜头。',
  '上身向环境边缘轻靠，双肩形成自然高低差，一只手放松贴近身体，视线偏离镜头。',
  '身体保持当前站位，一只手抬到耳侧整理头发，另一只手自然下垂，肩颈松弛。',
  '双腿形成前后重心，上身轻微扭转，手臂在腰前自然交叠，头部微偏并看向镜头。',
  '身体稍向镜头前倾，肩颈放松，一只手靠近衣领，另一只手留在画幅内，眼神直接。',
  '身体侧转并把一只手自然放入口袋，另一只手沿身体垂下，重心落在支撑腿。',
  '在当前站位做小幅转身抓拍，肩膀带动上身，双手顺势摆动，头部回看镜头。',
  '身体在当前画幅内做缓慢行走感，重心前移，双臂自然错位摆动，头部略低并侧看。'
];
const titles = ['松弛回望', '轻靠侧身', '抬手整理', '交叉重心', '肩颈前倾', '自然插袋', '转身抓拍', '低头行走'];
const suggestions = titles.map((title, index) => ({ id: index + 1, title, description: descriptions[index] }));
const asset = {
  id: 'qa-main',
  name: '网感姿势测试原图.png',
  type: 'image/png',
  size: 1,
  width: 1080,
  height: 1440,
  dataUrl: imageDataUrl
};
const project = {
  softwareVersion: '1.2.4',
  projectName: '网感姿势视觉验收',
  mainImage: asset,
  maskCircle: { x: 540, y: 350, width: 230, height: 230 },
  faceOcclusionEnabled: false,
  faceOcclusionMask: undefined,
  referenceImages: [{ ...asset, id: 'qa-face', name: '主参考图.png', tags: ['主参考图'], note: '', isPrimary: true }],
  wardrobeReferences: [],
  webPoseSuggestions: suggestions,
  selectedWebPose: suggestions[3],
  sceneDescription: '室内窗边的普通手机生活照，背景和构图保持不变。',
  poseDescription: '原图姿态唯一标记：人物双手抱臂站立。',
  faceDirectionDescription: '面部略向左，视线看向镜头。',
  lightingMakeupDescription: '右侧柔和自然光，保留真实肤质、轻微噪点和普通手机清晰度。',
  lockedElements: [
    '不改变红圈外背景', '不改变衣服', '不改变身体姿势', '不改变手部', '不改变道具', '不改变构图',
    '不改变镜头焦距', '不改变图片比例', '不改变整体画质', '不改变原图光影环境', '不改变红圈外任何人物或物体'
  ],
  customLockedElements: [],
  sliders: { identitySimilarity: 8, blendNaturalness: 9, originalPreservation: 10, skinRealism: 9, makeupRestoration: 8, outsideProtection: 10 },
  consentConfirmed: true,
  outputMode: 'regional',
  language: 'zh',
  sendMode: 'standard-upload',
  promptHistory: [],
  sendHistory: [],
  resultArchive: []
};

const errors = [];
let app;
try {
  app = await electron.launch(
    executablePath
      ? { executablePath, env: { ...process.env, YAOCHUANG_USER_DATA_DIR: userDataDir } }
      : { args: ['.'], cwd: repoRoot, env: { ...process.env, YAOCHUANG_USER_DATA_DIR: userDataDir } }
  );
  const appVersion = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  assert.equal(appVersion, '1.2.4', 'Electron runtime must report version 1.2.4');
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.evaluate(async (value) => {
    const settings = await window.masklock.readSettings();
    await window.masklock.writeSettings({
      ...settings,
      generationProvider: 'chatgpt',
      apiProvider: 'chatgpt'
    });
    await window.masklock.writeRecentAutoSave(value);
  }, project);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.project-name')?.value === '网感姿势视觉验收');
  const startupNotice = page.locator('.startup-notice-backdrop');
  if (await startupNotice.count()) {
    await page.locator('.startup-notice-confirm').click();
    await startupNotice.waitFor({ state: 'hidden' });
  }

  assert.equal(await page.getByText('耀创工坊', { exact: true }).count(), 1, '打包应用必须保留唯一产品名称');
  assert.equal(
    await page.getByText('Image 2.0 区域锁定工作台', { exact: true }).count(),
    0,
    '打包应用不应继续显示旧副标题'
  );
  assert.equal(await page.getByText('穿搭参考图', { exact: true }).count(), 1, '打包应用必须显示穿搭参考图标题');

  const aiButton = page.locator('.analysis-button-gold').first();
  const poseButton = page.locator('.web-pose-button');
  const disclosure = page.locator('.web-pose-disclosure');
  assert.equal(await aiButton.count(), 1, 'AI 分析按钮必须使用金色样式');
  assert.equal(await poseButton.count(), 1, '网感姿势按钮必须可见');
  assert.equal(await disclosure.count(), 1, '8 个姿势准备好后必须显示下方箭头');

  const colors = await page.evaluate(() => {
    const ai = getComputedStyle(document.querySelector('.analysis-button-gold'));
    const pose = getComputedStyle(document.querySelector('.web-pose-button'));
    return { aiBorder: ai.borderColor, aiColor: ai.color, poseBorder: pose.borderColor, poseColor: pose.color };
  });
  assert.equal(colors.aiBorder, colors.poseBorder, 'AI 分析和网感姿势按钮应使用同一金色边框');
  assert.notEqual(colors.aiBorder, 'rgba(0, 0, 0, 0)');

  await page.locator('.workflow-generate-btn').click();
  await page.waitForFunction(() => document.querySelector('.prompt-output')?.value.includes('网感姿势 4：交叉重心'));
  assert.equal(await page.getByRole('button', { name: '开始做图' }).count(), 1, '打包应用必须显示简洁的开始做图主操作');
  assert.equal(
    await page.locator('.prompt-send-cta').getAttribute('data-ready'),
    'true',
    '只画红圈、未启用一键蒙脸时也必须可以开始做图'
  );
  await page.getByRole('button', { name: '进入微调' }).click();
  await page.getByLabel('微调后的提示词').fill('用户自定义提示词，等待切换网感姿势后重新生成。');
  await page.getByRole('button', { name: '保存修改' }).click();
  assert.equal(await page.locator('.prompt-editor-top em').textContent(), '自定义');
  await disclosure.click();
  assert.equal(await page.locator('.web-pose-option').count(), 8, '姿势列表必须恰好显示 8 条');
  assert.equal(await page.locator('.web-pose-option[aria-checked="true"]').count(), 1, '当前姿势必须有唯一选中态');
  await page.locator('.web-pose-option').nth(6).click();
  await page.waitForFunction(() => document.querySelector('.web-pose-selected-id')?.textContent?.trim() === '7');
  await page.locator('.workflow-generate-btn').click();
  await page.waitForFunction(() => document.querySelector('.prompt-output')?.value.includes('网感姿势 7：转身抓拍'));
  assert.equal(await page.locator('.prompt-editor-top em').textContent(), '区域编辑定制版', '一键重新生成必须退出旧的自定义模式');
  assert.equal(await page.getByText('生成与导出选项', { exact: true }).count(), 0, '不再显示冗余的生成与导出折叠行');
  const promptText = await page.locator('.prompt-output').inputValue();
  assert.doesNotMatch(promptText, /原图姿态唯一标记|人物姿态按原图延续|不改变身体姿势|不改变手部/);
  assert.match(promptText, /最终图片中的目标人物必须是人脸参考图中的目标男生/);
  assert.match(promptText, /本轮没有穿搭参考图/);
  assert.match(promptText, /【姿势规则】[\s\S]*网感姿势 7：转身抓拍/);
  assert.match(promptText, /原图姿态描述不作为本轮依据/);
  assert.match(promptText, /背景、其他人物、未指定服饰配饰、道具、构图、镜头、画幅、环境光、画质和最终像素尺寸保持主垫图不变/);
  assert.doesNotMatch(promptText, /穿搭参考图是对应服饰外观的唯一基准|最高优先级|Image 2\.0/);
  assert.equal((promptText.match(/【姿势规则】/g) || []).length, 1, '姿势规则不得重复');

  await disclosure.click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1580, 1000));
  await page.waitForTimeout(250);
  await page.locator('.description-panel').scrollIntoViewIfNeeded();
  const fit1580 = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    picker: document.querySelector('.web-pose-picker')?.getBoundingClientRect().toJSON()
  }));
  assert.equal(fit1580.canScrollX, false, '1580 宽度不应出现页面级横向溢出');
  assert.ok(fit1580.picker && fit1580.picker.left >= 0 && fit1580.picker.right <= fit1580.width, '姿势列表必须完整落在窗口内');
  await page.screenshot({ path: path.join(artifactRoot, 'web-pose-dark-1580x1000.png') });

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.screenshot({ path: path.join(artifactRoot, 'web-pose-light-1580x1000.png') });

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1024, 768));
  await page.waitForTimeout(250);
  await page.locator('.description-panel').scrollIntoViewIfNeeded();
  const fit1024 = await page.evaluate(() => ({
    width: innerWidth,
    canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    panel: document.querySelector('.description-panel')?.getBoundingClientRect().toJSON(),
    picker: document.querySelector('.web-pose-picker')?.getBoundingClientRect().toJSON()
  }));
  assert.equal(fit1024.canScrollX, false, '1024 宽度不应出现页面级横向溢出');
  assert.ok(fit1024.panel && fit1024.panel.width <= fit1024.width, '1024 宽度下原图理解面板必须完整适配');
  assert.ok(fit1024.picker && fit1024.picker.left >= 0 && fit1024.picker.right <= fit1024.width, '1024 宽度下姿势列表不得被水平截断');
  await page.locator('.description-panel').screenshot({ path: path.join(artifactRoot, 'web-pose-light-1024-panel.png') });

  assert.deepEqual(errors, [], `Electron 页面不应出现新增控制台错误：${errors.join(' | ')}`);
  console.log(JSON.stringify({ ok: true, appVersion, runtime: executablePath || 'source-electron', colors, fit1580, fit1024, screenshots: artifactRoot }, null, 2));
} finally {
  await app?.close().catch(() => undefined);
  await fs.rm(userDataDir, { recursive: true, force: true });
}
