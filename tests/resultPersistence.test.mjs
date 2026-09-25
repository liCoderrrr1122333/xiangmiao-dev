import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const removedProductionFiles = [
  '../src/main/postProcessingStore.ts',
  '../src/shared/postProcessingEngine.ts',
  '../src/shared/postProcessingPolicy.ts',
  '../src/renderer/components/PostProcessingWorkspace.tsx',
  '../src/renderer/postProcessing/renderClient.ts',
  '../src/renderer/postProcessing/postProcessing.worker.ts',
  '../src/styles/post-processing.css'
];

test('the unusable post-processing editor is absent from the production graph', async () => {
  for (const relativePath of removedProductionFiles) {
    assert.equal(existsSync(new URL(relativePath, import.meta.url)), false, `${relativePath} must remain removed`);
  }
  const [app, preload, types, main] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(app, /post-processing-toggle|PostProcessingWorkspace|readPostProcessingSession/);
  assert.doesNotMatch(preload, /post-processing:(?:read|update|discard|export)/);
  assert.doesNotMatch(types, /PostProcessingParameters|postProcessingEnabled/);
  assert.doesNotMatch(main, /startPostProcessingBatch|discardPostProcessingSession|reservePostProcessingResultFiles/);
});

test('direct result persistence keeps exact dimensions and verifies every atomic stage', async () => {
  const [persistence, main] = await Promise.all([
    readFile(new URL('../src/main/imagePersistence.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  ]);
  assert.match(persistence, /jpegQuality = 96/);
  assert.match(persistence, /flattenToWhite/);
  assert.match(persistence, /assertVerifiedJpeg\(await fs\.readFile\(temporaryPath\), target/);
  assert.match(persistence, /assertVerifiedJpeg\(await fs\.readFile\(filePath\), target/);
  assert.match(main, /const localSaveAttempts = 3/);
  assert.match(main, /只重试本地保存，不会重新发送提示词/);
  assert.match(main, /version: 5/);
});

test('legacy staged JPG recovery is bounded, path-contained, and read-only', async () => {
  const recovery = await readFile(new URL('../src/main/legacyPostProcessingRecovery.ts', import.meta.url), 'utf8');
  assert.match(recovery, /maximumManifestBytes = 4 \* 1024 \* 1024/);
  assert.match(recovery, /maximumImageBytes = 160 \* 1024 \* 1024/);
  assert.match(recovery, /items\.length > maximumItems/);
  assert.match(recovery, /stats\.isSymbolicLink\(\)/);
  assert.match(recovery, /isContained\(realRoot, realFilePath\)/);
  assert.doesNotMatch(recovery, /fs\.(?:rm|unlink|rename)\(/);
});

test('legacy settings and checkpoints are retired without deleting user image data', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(main, /sanitizeStoredSettings/);
  assert.match(main, /postProcessingEnabled: _removedPostProcessingSetting/);
  assert.match(main, /legacy-post-processing/);
  assert.match(main, /archiveChatGptBatchCheckpoint/);
  assert.doesNotMatch(main, /fs\.rm\([^\n]*PostProcessing|fs\.unlink\([^\n]*PostProcessing/);
});
