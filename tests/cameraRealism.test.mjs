import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function createSvg(width, height, offset = 0) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g"><stop stop-color="rgb(${20 + offset},80,150)"/><stop offset="1" stop-color="rgb(220,${160 + offset},60)"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="42" cy="24" r="13" fill="rgb(170,115,95)"/>
    </svg>
  `);
}

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('camera realism creates a reproducible full-frame JPEG copy without mutating the source', async () => {
  const { applyCameraRealism } = await import('../dist-electron/main/cameraRealism.js');
  const source = createSvg(64, 48);
  const before = hash(source);

  const first = await applyCameraRealism(source, { preset: 'natural' });
  const second = await applyCameraRealism(source, { preset: 'natural' });
  const differentInput = await applyCameraRealism(createSvg(64, 48, 5), { preset: 'natural' });

  assert.equal(hash(source), before);
  assert.equal(first.width, 64);
  assert.equal(first.height, 48);
  assert.equal(first.buffer[0], 0xff);
  assert.equal(first.buffer[1], 0xd8);
  assert.equal(first.buffer.at(-2), 0xff);
  assert.equal(first.buffer.at(-1), 0xd9);
  assert.deepEqual(first.buffer, second.buffer);
  assert.notEqual(hash(first.buffer), before);
  assert.notEqual(first.seed, differentInput.seed);
  assert.notDeepEqual(first.buffer, differentInput.buffer);
});

test('camera realism strength keeps 50 as the default and exposes the full camera finish range', async () => {
  const { applyCameraRealism } = await import('../dist-electron/main/cameraRealism.js');
  const source = createSvg(96, 72, 4);
  const seed = 0x12345678;

  const defaultFinish = await applyCameraRealism(source, { seed });
  const subtle = await applyCameraRealism(source, { seed, strength: 10 });
  const natural = await applyCameraRealism(source, { seed, strength: 50 });
  const strong = await applyCameraRealism(source, { seed, strength: 100 });

  assert.equal(defaultFinish.strength, 50);
  assert.equal(subtle.strength, 10);
  assert.equal(natural.strength, 50);
  assert.equal(strong.strength, 100);
  assert.deepEqual(defaultFinish.buffer, natural.buffer);
  assert.notDeepEqual(subtle.buffer, natural.buffer);
  assert.notDeepEqual(strong.buffer, natural.buffer);
  assert.equal(subtle.width, 96);
  assert.equal(strong.height, 72);
});

test('camera realism ports the complete ZIP finish without its fixed batch noise seed', async () => {
  const implementation = await readFile(new URL('../src/main/cameraRealism.ts', import.meta.url), 'utf8');
  for (const feature of [
    'shadowTint',
    'highlightTint',
    'broadDetail',
    'fineDetail',
    'bloom',
    'edgeBlur',
    'edgeSoftness',
    'localVariance'
  ]) {
    assert.match(implementation, new RegExp(feature));
  }
  assert.doesNotMatch(implementation, /1785267794547/);
});

test('camera realism writes a verified copy to a new JPEG path', async () => {
  const { writeCameraRealismCopy } = await import('../dist-electron/main/cameraRealism.js');
  const root = await mkdtemp(path.join(tmpdir(), 'xiangmao-camera-'));
  const outputPath = path.join(root, 'result_camera.jpg');
  try {
    const result = await writeCameraRealismCopy(createSvg(80, 60, 7), outputPath);
    const saved = await readFile(outputPath);
    assert.equal(result.filePath, outputPath);
    assert.equal(result.width, 80);
    assert.equal(result.height, 60);
    assert.deepEqual(saved, result.buffer);
    await assert.rejects(
      () => writeCameraRealismCopy(createSvg(80, 60), path.join(root, 'invalid.png')),
      /JPG/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('face naturalization only creates a new PNG copy from a supplied face mask', async () => {
  const { default: sharp } = await import('sharp');
  const { applyFaceNaturalization, writeFaceNaturalizationCopy } = await import('../dist-electron/main/cameraRealism.js');
  const source = createSvg(80, 60, 9);
  const mask = await sharp({
    create: {
      width: 40,
      height: 30,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).png().toBuffer();
  const first = await applyFaceNaturalization(source, { data: mask, x: 0, y: 0, width: 80, height: 60 });
  const second = await applyFaceNaturalization(source, { data: mask, x: 0, y: 0, width: 80, height: 60 });
  assert.equal(first.width, 80);
  assert.equal(first.height, 60);
  assert.deepEqual(first.buffer, second.buffer);
  assert.notDeepEqual(first.buffer, source);

  const root = await mkdtemp(path.join(tmpdir(), 'xiangmao-face-naturalization-'));
  const outputPath = path.join(root, 'result_face.png');
  try {
    const saved = await writeFaceNaturalizationCopy(source, outputPath, { data: mask, x: 0, y: 0, width: 80, height: 60 });
    assert.deepEqual(await readFile(outputPath), saved.buffer);
    await assert.rejects(
      () => writeFaceNaturalizationCopy(source, path.join(root, 'invalid.jpg'), { data: mask, x: 0, y: 0, width: 80, height: 60 }),
      /PNG/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('result preview header opens a selectable gold camera realism batch before view all', async () => {
  const [types, preload, main, app, archive, batchModal, styles] = await Promise.all([
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/ResultArchivePanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/CameraRealismBatchModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/glass-workbench.css', import.meta.url), 'utf8')
  ]);
  assert.match(types, /applyCameraRealism/);
  assert.match(types, /strength\??: number/);
  assert.match(types, /chooseCameraRealismFolder/);
  assert.match(types, /processCameraRealismFolderItem/);
  assert.match(types, /applyFaceNaturalization/);
  assert.match(preload, /result:camera-realism/);
  assert.match(preload, /camera-realism:choose-folder/);
  assert.match(preload, /camera-realism:process-folder-item/);
  assert.match(preload, /camera-realism:close-folder-session/);
  assert.match(preload, /result:face-naturalization/);
  assert.match(main, /registerTrustedIpcHandler\('result:camera-realism'/);
  assert.match(main, /registerTrustedIpcHandler\('camera-realism:choose-folder'/);
  assert.match(main, /scanCameraRealismFolder/);
  assert.match(main, /randomBytes\(4\)/);
  assert.match(main, /registerTrustedIpcHandler\('result:face-naturalization'/);
  assert.match(main, /writeCameraRealismCopy/);
  assert.match(main, /writeFaceNaturalizationCopy/);
  assert.match(app, /className="inline-result-camera-action/);
  assert.match(app, /批量降 AI 感/);
  assert.match(app, /批量面部自然化/);
  assert.match(app, /detectFaceNaturalizationMask/);
  assert.match(app, /setCameraRealismBatchCandidates\(project\.resultArchive\.slice\(\)\)/);
  assert.match(app, /for \(const item of selectedResults\)/);
  assert.match(app, /addResult\(result\.image\)/);
  assert.doesNotMatch(app, /const latestResult = project\.resultArchive\[0\]/);
  assert.ok(app.indexOf('inline-result-camera-action') < app.indexOf('查看全部'));
  assert.ok(app.indexOf('inline-result-camera-action') < app.indexOf('inline-result-face-action'));
  assert.doesNotMatch(archive, /一键降 AI 感/);
  assert.match(batchModal, /type="checkbox"/);
  assert.match(batchModal, /全选/);
  assert.match(batchModal, /清空/);
  assert.match(batchModal, /批量处理/);
  assert.match(batchModal, /type="range"/);
  assert.match(batchModal, /处理强度/);
  assert.match(batchModal, /轻微/);
  assert.match(batchModal, /强烈/);
  assert.match(batchModal, /结果归档/);
  assert.match(batchModal, /导入文件夹/);
  assert.match(batchModal, /停止/);
  assert.match(app, /cameraRealismCancelRef/);
  assert.match(app, /cameraRealismCancelRef\.current = true/);
  assert.match(app, /if \(cameraRealismCancelRef\.current\) break/);
  assert.match(app, /catch \(error\)[\s\S]*failures\.push[\s\S]*finally[\s\S]*completed: current\.completed \+ 1/);
  assert.match(app, /chooseCameraRealismFolder/);
  assert.match(app, /processCameraRealismFolderItem/);
  assert.match(app, /processCameraRealismFolderItem\(\{[\s\S]*strength/);
  assert.match(app, /applyCameraRealism\(\{[\s\S]*strength/);
  assert.match(styles, /\.inline-result-camera-action[\s\S]*var\(--prompt-customize-border\)/);
  assert.match(styles, /\.inline-result-camera-primary[\s\S]*var\(--prompt-customize-foreground\)/);
  assert.match(styles, /\.inline-result-face-action[\s\S]*var\(--text-secondary\)/);
  assert.match(styles, /\.camera-realism-batch-modal[\s\S]*var\(--prompt-customize-border\)/);
});
