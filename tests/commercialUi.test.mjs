import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('commercial workbench keeps three columns at the supported 1280px minimum', async () => {
  const css = await readFile(new URL('../src/styles/glass-workbench.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 1180px\)[\s\S]*?grid-template-columns:[\s\S]*?minmax\(520px, 1fr\)/);
  assert.match(css, /clamp\(300px, 22vw, 450px\)/);
  assert.match(css, /clamp\(340px, 24vw, 480px\)/);
  assert.match(css, /@media \(max-width: 1179px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});

test('the Electron window can fit within a 1280x720 desktop work area', async () => {
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(mainSource, /screen\.getDisplayNearestPoint\(screen\.getCursorScreenPoint\(\)\)/);
  assert.match(mainSource, /resolveMainWindowBounds\(activeDisplay\.workArea\)/);
  assert.match(mainSource, /minWidth: Math\.min\(1024, initialBounds\.width\)/);
  assert.match(mainSource, /minHeight: Math\.min\(600, initialBounds\.height\)/);
});

test('the right workflow panel scrolls away instead of covering lower controls', async () => {
  const css = await readFile(new URL('../src/styles/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.workflow-action-panel \{\s*position: relative;\s*z-index: 5;/);
});

test('the minimum-width toolbar fits without scrollbars', async () => {
  const glassCss = await readFile(new URL('../src/styles/glass-workbench.css', import.meta.url), 'utf8');

  assert.match(
    glassCss,
    /@media \(max-width: 1390px\)[\s\S]*\.toolbar-actions button \{[\s\S]*width: 34px[\s\S]*font-size: 0/
  );
  assert.match(
    glassCss,
    /\.toolbar-actions button svg \{[\s\S]*display: block[\s\S]*width: 16px/
  );
});

test('the provider model selector keeps an operable width in the narrow workflow rail', async () => {
  const css = await readFile(new URL('../src/styles/hallmark-workbench.css', import.meta.url), 'utf8');
  assert.match(css, /\.chatgpt-runtime-controls \{[\s\S]*grid-template-areas:/);
  assert.match(css, /\.chatgpt-model-control \{[\s\S]*grid-area: model;/);
  assert.match(css, /\.chatgpt-model-control select \{[\s\S]*min-width: 150px;/);
});

test('the workbench has one authoritative generation state and localized status copy', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const canvasSource = await readFile(new URL('../src/renderer/components/MainImageCanvas.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /ImageReadyCard/);
  assert.match(appSource, /生成中' : canSend \? '可开始' : '待准备'/);
  assert.match(appSource, /role="status" aria-live="polite"/);
  assert.match(canvasSource, /尚未上传主图/);
  assert.match(canvasSource, /红圈已锁定/);
  assert.match(canvasSource, /onKeyDown=\{handleCanvasKeyDown\}/);
  assert.match(canvasSource, /type ToolMode = 'pan' \| 'draw' \| 'circle'/);
  assert.doesNotMatch(canvasSource, /onWheel=/);
  assert.match(canvasSource, /canvasViewport\.addEventListener\('wheel', handleCanvasWheel, \{ passive: false, capture: true \}\)/);
  assert.match(canvasSource, /canvasViewport\.removeEventListener\('wheel', handleCanvasWheel, true\)/);
  assert.match(canvasSource, /event\.preventDefault\(\)/);
  assert.match(canvasSource, /event\.stopPropagation\(\)/);
  const primaryActionIndex = appSource.indexOf('className={`primary-cta prompt-send-cta');
  const generatePromptIndex = appSource.indexOf('className="workflow-generate-btn"');
  assert.ok(primaryActionIndex >= 0 && primaryActionIndex < generatePromptIndex);
});

test('the primary workbench labels stay concise and task-focused', async () => {
  const [appSource, toolbarSource, wardrobeSource] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/ProjectToolbar.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/WardrobeReferencePanel.tsx', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(toolbarSource, /Image 2\.0 区域锁定工作台/);
  assert.match(wardrobeSource, /<b>穿搭参考图<\/b>/);
  assert.doesNotMatch(wardrobeSource, /<b>上传参考图<\/b>/);
  assert.match(appSource, /: '开始做图';/);
  assert.doesNotMatch(appSource, /: `打开 \$\{activeProviderLabel\} 做图`;/);
});

test('settings modal provides dialog semantics, focus containment and Escape close', async () => {
  const source = await readFile(new URL('../src/renderer/components/SettingsModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /关闭设置/);
  assert.match(source, /previousFocus\?\.focus\(\)/);
});

test('release metadata and new project schema identify version 1.2.4', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const projectStore = await readFile(new URL('../src/renderer/state/projectStore.ts', import.meta.url), 'utf8');
  const settingsStore = await readFile(new URL('../src/renderer/state/settingsStore.ts', import.meta.url), 'utf8');
  assert.equal(packageJson.version, '1.2.4');
  assert.match(projectStore, /softwareVersion: '1\.2\.4'/);
  assert.match(projectStore, /outputMode: 'regional'/);
  assert.match(settingsStore, /defaultOutputMode: 'regional'/);
  assert.match(settingsStore, /chatGptBrowserBackend: 'chrome'/);
});
