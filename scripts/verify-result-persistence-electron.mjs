import assert from 'node:assert/strict';
import { app, nativeImage } from 'electron';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertVerifiedJpeg,
  normalizeImageDataUrlToJpeg,
  writeVerifiedJpegAtomically
} from '../dist-electron/main/imagePersistence.js';
import { recoverLegacyPostProcessingResults } from '../dist-electron/main/legacyPostProcessingRecovery.js';

const artifactRoot = path.resolve('D:\\Xiangmao-Workshop\\TestArtifacts\\1.2.4-result-persistence');
const allowedRoot = path.resolve('D:\\Xiangmao-Workshop\\TestArtifacts');
if (!artifactRoot.startsWith(`${allowedRoot}${path.sep}`)) throw new Error('Result test root escaped the approved D: artifact directory.');

function asymmetricPngDataUrl(width, height) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const top = y < height / 2;
      bitmap[offset] = top ? 25 : 230;
      bitmap[offset + 1] = 35;
      bitmap[offset + 2] = top ? 230 : 25;
      bitmap[offset + 3] = 255;
    }
  }
  const image = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
  return `data:image/png;base64,${image.toPNG().toString('base64')}`;
}

function pixelAt(bitmap, width, x, y) {
  const offset = (y * width + x) * 4;
  return { blue: bitmap[offset], green: bitmap[offset + 1], red: bitmap[offset + 2], alpha: bitmap[offset + 3] };
}

function manifest(batchId, sourceFile, width, height, extraItems = []) {
  return {
    version: 1,
    batchId,
    jobKey: 'a'.repeat(64),
    projectName: '旧版恢复验证',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    targetDimensions: { width, height },
    expectedTaskCount: 1 + extraItems.length,
    completedTaskIndices: [1],
    generationComplete: true,
    items: [
      {
        id: `${batchId}_1`,
        batchId,
        taskIndex: 1,
        sequence: 7,
        sourceFile,
        name: '旧版结果_7.jpg',
        width,
        height,
        size: 0,
        promptText: '旧版提示词'
      },
      ...extraItems
    ]
  };
}

async function runVerification() {
  let exitCode = 0;
  try {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });

  const target = { width: 128, height: 96 };
  const normalized = normalizeImageDataUrlToJpeg(asymmetricPngDataUrl(64, 48), target);
  const resultPath = path.join(artifactRoot, 'orientation-result.jpg');
  await writeVerifiedJpegAtomically(resultPath, normalized.buffer, target);
  const written = await readFile(resultPath);
  assertVerifiedJpeg(written, target, '方向验证 JPG');
  const decoded = nativeImage.createFromBuffer(written);
  const bitmap = decoded.toBitmap();
  const top = pixelAt(bitmap, target.width, 24, 20);
  const bottom = pixelAt(bitmap, target.width, 24, 76);
  assert.ok(top.red > top.blue + 100, 'top half must stay red after JPG normalization');
  assert.ok(bottom.blue > bottom.red + 100, 'bottom half must stay blue after JPG normalization');

  const userDataDir = path.join(artifactRoot, 'legacy-user-data');
  const legacyRoot = path.join(userDataDir, 'PostProcessing');
  const batchDir = path.join(legacyRoot, 'batch');
  await mkdir(batchDir, { recursive: true });
  const legacyImagePath = path.join(batchDir, 'task-1.jpg');
  await writeFile(legacyImagePath, written);
  const legacyManifest = manifest('legacy_batch_001', 'batch/task-1.jpg', target.width, target.height);
  const manifestPath = path.join(legacyRoot, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(legacyManifest, null, 2), 'utf8');
  const beforeManifest = await readFile(manifestPath);
  const beforeImage = await readFile(legacyImagePath);
  const recovered = await recoverLegacyPostProcessingResults(userDataDir);
  assert.equal(recovered.recoveredImages.length, 1);
  assert.equal(recovered.skippedCount, 0);
  assert.equal(recovered.needsAttention, false);
  assert.equal(recovered.recoveredImages[0].path, legacyImagePath);
  assert.equal(recovered.recoveredImages[0].source, 'legacy-post-processing');
  assert.equal(recovered.recoveredImages[0].createdAt, legacyManifest.createdAt);
  assert.deepEqual(await readFile(manifestPath), beforeManifest, 'legacy manifest must remain byte-identical');
  assert.deepEqual(await readFile(legacyImagePath), beforeImage, 'legacy JPG must remain byte-identical');

  const guardedUserData = path.join(artifactRoot, 'guarded-user-data');
  const guardedRoot = path.join(guardedUserData, 'PostProcessing');
  const guardedBatch = path.join(guardedRoot, 'batch');
  await mkdir(guardedBatch, { recursive: true });
  await writeFile(path.join(guardedBatch, 'task-1.jpg'), written);
  const traversalItem = {
    id: 'legacy_batch_002_2',
    batchId: 'legacy_batch_002',
    taskIndex: 2,
    sequence: 8,
    sourceFile: '../outside.jpg',
    name: 'outside.jpg',
    width: target.width,
    height: target.height
  };
  await writeFile(
    path.join(guardedRoot, 'manifest.backup.json'),
    JSON.stringify(manifest('legacy_batch_002', 'batch/task-1.jpg', target.width, target.height, [traversalItem]), null, 2),
    'utf8'
  );
  await writeFile(path.join(guardedRoot, 'manifest.json'), '{corrupt', 'utf8');
  const guarded = await recoverLegacyPostProcessingResults(guardedUserData);
  assert.equal(guarded.recoveredImages.length, 1);
  assert.equal(guarded.skippedCount, 1);
  assert.equal(guarded.needsAttention, true);
  assert.equal((await readFile(path.join(guardedRoot, 'manifest.json'), 'utf8')), '{corrupt');

    console.log(JSON.stringify({
      ok: true,
      target,
      orientation: { top, bottom },
      recovered: recovered.recoveredImages.length,
      guardedRecovered: guarded.recoveredImages.length,
      guardedSkipped: guarded.skippedCount,
      artifactRoot
    }, null, 2));
  } catch (error) {
    exitCode = 1;
    console.error(error instanceof Error ? error.stack || error.message : String(error));
  } finally {
    app.exit(exitCode);
  }
}

void app.whenReady().then(runVerification).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  app.exit(1);
});
