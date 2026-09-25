import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('relay is an independent generation provider with encrypted user-owned credentials', async () => {
  const [types, settings, app, description, modal, policy, main, preload] = await Promise.all([
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/state/settingsStore.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/DescriptionPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/RelayApiConfigModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/generationProviderPolicy.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
  ]);

  assert.match(types, /generationProvider: GenerationProvider/);
  assert.match(settings, /generationProvider: 'relay'/);
  assert.doesNotMatch(types, /relayApiKey|relayKeySessionOnly/);
  assert.doesNotMatch(settings, /relayApiKey|relayKeySessionOnly/);
  assert.match(description, /\['relay', 'API'\]/);
  assert.match(description, /配置 API/);
  assert.equal((description.match(/'配置 API'/g) || []).length, 1);
  assert.doesNotMatch(app, /className="relay-provider-control"/);
  assert.doesNotMatch(app, /relay-api-strip[\s\S]{0,500}setRelayConfigOpen/);
  assert.match(policy, /自由 API/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /safeStorage\.decryptString/);
  assert.doesNotMatch(main, /protocolReady: false/);
  assert.doesNotMatch(main, /中转站接口协议尚未配置/);
  assert.match(main, /createLianYiLianRelayTransport/);
  assert.match(modal, /自由 API/);
  assert.match(modal, /标准图片/);
  assert.match(modal, /香蕉生图/);
  assert.match(modal, /selectedModel/);
  assert.match(modal, /testRelayApiConnection\(\{ model: selectedModel \}\)/);
  assert.doesNotMatch(`${app}\n${description}\n${modal}`, /连一连|中转站/);
  assert.match(main, /API Key 已配置，可使用 API 做图。/);
  assert.doesNotMatch(main, /可使用连一连 API 做图/);
  assert.doesNotMatch(app, /settings\.relayBaseUrl/);
  assert.doesNotMatch(app, /settings\.relayModel/);
  assert.doesNotMatch(app, /settings\.relayResolution/);
  assert.match(preload, /relay:get-status/);
  assert.match(preload, /relay:configure-key/);
  assert.match(preload, /relay:clear-key/);
  assert.match(preload, /relay:test-connection/);
  assert.match(types, /relayOriginalUnderstandingEnabled:\s*boolean/);
  assert.match(settings, /relayOriginalUnderstandingEnabled:\s*false/);
  assert.match(app, /includeOriginalUnderstanding/);
  assert.match(description, /使用原图理解/);
  assert.match(description, /analysisDetailsOpen/);
  assert.match(app, /selectedModel=\{settings\.apiModel\}/);
  assert.doesNotMatch(app, /const relayModel = 'gpt-image-2'/);
});

test('relay selection does not overwrite the browser provider used by analysis and pose', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const updater = app.slice(
    app.indexOf('function updateGenerationProvider'),
    app.indexOf('function updateChatGptModel')
  );
  assert.match(updater, /generationProvider: provider/);
  assert.match(updater, /if \(provider !== 'relay'\)/);
  assert.match(updater, /patch\.webAiProvider = provider/);
  assert.match(app, /generationProvider === 'relay'/);
  assert.match(app, /generationProvider !== 'relay'/);
});

test('relay shares one verified adapter, prefers direct network, and falls back to the system proxy', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(main, /session\.defaultSession\.fetch/);
  assert.match(main, /fetchCandidates:\s*\[/);
  assert.match(main, /id:\s*'electron-system-proxy'/);
  assert.match(main, /id:\s*'node-direct'/);
  assert.ok(main.indexOf("id: 'node-direct'") < main.indexOf("id: 'electron-system-proxy'"));
  assert.match(main, /relayConfiguredAdapter/);
  assert.match(main, /resetRelayConfiguredAdapter/);
  assert.match(main, /configuredRelayAdapter\(\)/);
});
