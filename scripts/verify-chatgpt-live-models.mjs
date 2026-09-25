import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const artifactRoot = path.resolve('D:\\Yaochuang-Workshop\\TestArtifacts\\chatgpt-live-models');

if (!existsSync(electronExecutable)) throw new Error(`Electron executable is missing: ${electronExecutable}`);
await mkdir(artifactRoot, { recursive: true });

const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [projectRoot],
  cwd: projectRoot,
  env: { ...process.env }
});

let page;
let originalProvider;
try {
  page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });

  originalProvider = (await page.locator('.web-ai-provider-selector button.active').innerText()).trim();
  if (originalProvider !== 'ChatGPT') {
    await page.locator('.web-ai-provider-selector button', { hasText: 'ChatGPT' }).click();
    await page.waitForFunction(
      () => document.querySelector('.web-ai-provider-selector button.active')?.textContent?.trim() === 'ChatGPT'
    );
  }

  const catalog = await page.evaluate(async () => {
    if (!window.masklock?.listWebAiModels) throw new Error('The web AI model bridge is unavailable.');
    return window.masklock.listWebAiModels({
      provider: 'chatgpt',
      url: 'https://chatgpt.com/',
      backend: 'chrome'
    });
  });

  assert.equal(catalog.provider, 'chatgpt');
  assert.equal(catalog.ok, true, catalog.error || catalog.message);
  assert.ok(catalog.models.length > 0, catalog.message);
  assert.doesNotMatch(catalog.message, /没有显示模型选择器|没有显示可切换模型/);

  await page.locator('.chatgpt-model-refresh').click();
  await page.waitForFunction(
    (expectedModels) => {
      const refreshButton = document.querySelector('.chatgpt-model-refresh');
      const select = document.querySelector('.chatgpt-model-control select');
      if (!(refreshButton instanceof HTMLButtonElement) || refreshButton.disabled) return false;
      if (!(select instanceof HTMLSelectElement)) return false;
      const optionValues = new Set([...select.options].map((option) => option.value));
      return expectedModels.every((model) => optionValues.has(model));
    },
    catalog.models.map((model) => model.label),
    { timeout: 60_000 }
  );
  const uiState = await page.evaluate((liveCatalog) => {
    const select = document.querySelector('.chatgpt-model-control select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('The workbench model selector is missing.');
    const liveLabels = new Set(liveCatalog.models.map((model) => model.label));
    const optionValues = [...select.options].map((option) => option.value);
    for (const model of liveLabels) {
      if (!optionValues.includes(model)) throw new Error(`The workbench is missing model: ${model}`);
    }
    return {
      selectedValue: select.value,
      status: document.querySelector('.chatgpt-model-status')?.textContent?.trim() || '',
      visibleOptions: [...select.options].map((option) => option.textContent?.trim() || '').filter(Boolean)
    };
  }, catalog);
  assert.doesNotMatch(uiState.status, /没有显示模型选择器|没有显示可切换模型/);

  const screenshotPath = path.join(artifactRoot, 'chatgpt-live-models.png');
  await page.screenshot({ path: screenshotPath });
  console.log(JSON.stringify({
    ok: true,
    currentModel: catalog.currentModel,
    models: catalog.models.map(({ label, current }) => ({ label, current })),
    message: catalog.message,
    uiState,
    screenshotPath
  }, null, 2));
} finally {
  if (page && originalProvider && originalProvider !== 'ChatGPT' && !page.isClosed()) {
    await page.locator('.web-ai-provider-selector button', { hasText: originalProvider }).click().catch(() => undefined);
    await page.waitForFunction(
      (provider) => document.querySelector('.web-ai-provider-selector button.active')?.textContent?.trim() === provider,
      originalProvider,
      { timeout: 5_000 }
    ).catch(() => undefined);
  }
  await electronApp.close();
}
