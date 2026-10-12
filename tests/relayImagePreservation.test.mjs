import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  createRelayCanvasPlan,
  normalizeRelayResultToPng,
  prepareRelayMainAttachment,
  writeRelayOriginalAtomically,
  writeRelayPngAtomically
} from '../dist-electron/main/relayImagePreservation.js';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('relay canvas plan uses reversible padding instead of non-uniform stretching', () => {
  const plan = createRelayCanvasPlan(
    { width: 1279, height: 1706 },
    { width: 1024, height: 1536 }
  );

  assert.equal(plan.contentWidth, 1279);
  assert.equal(plan.contentHeight, 1706);
  assert.equal(plan.canvasWidth, 1279);
  assert.equal(plan.canvasHeight, 1919);
  assert.equal(plan.left, 0);
  assert.equal(plan.right, 0);
  assert.equal(plan.top, 106);
  assert.equal(plan.bottom, 107);
  assert.ok(Math.abs(plan.contentWidth / plan.contentHeight - 1279 / 1706) < 0.001);
});

test('relay preparation preserves source bytes and restoration writes an exact-size lossless PNG', async () => {
  const source = await sharp({
    create: {
      width: 1279,
      height: 1706,
      channels: 4,
      background: { r: 46, g: 91, b: 137, alpha: 1 }
    }
  }).png().toBuffer();
  const sourceHash = sha256(source);

  const prepared = await prepareRelayMainAttachment(
    source,
    { width: 1279, height: 1706 },
    { width: 1024, height: 1536 }
  );

  assert.equal(sha256(source), sourceHash, 'preparing the relay canvas must not mutate the source bytes');
  assert.equal(prepared.mimeType, 'image/png');
  assert.deepEqual(
    await sharp(prepared.buffer).metadata().then(({ width, height, format }) => ({ width, height, format })),
    { width: 1279, height: 1919, format: 'png' }
  );
  const sourcePixels = await sharp(source).raw().toBuffer();
  const recoveredInputPixels = await sharp(prepared.buffer)
    .extract({
      left: prepared.plan.left,
      top: prepared.plan.top,
      width: prepared.plan.contentWidth,
      height: prepared.plan.contentHeight
    })
    .raw()
    .toBuffer();
  assert.equal(sha256(recoveredInputPixels), sha256(sourcePixels), 'temporary padding must preserve every source pixel');

  const restored = await normalizeRelayResultToPng(
    prepared.buffer,
    prepared.plan,
    { width: 1279, height: 1706 }
  );
  assert.deepEqual(
    await sharp(restored.buffer).metadata().then(({ width, height, format }) => ({ width, height, format })),
    { width: 1279, height: 1706, format: 'png' }
  );
  assert.equal(restored.usedNonUniformStretch, false);
  assert.equal(restored.crop.width, prepared.plan.contentWidth);
  assert.equal(restored.crop.height, prepared.plan.contentHeight);

  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xiangmao-relay-preservation-'));
  try {
    const originalPath = path.join(outputRoot, '中转站原始图', 'original.png');
    const normalizedPath = path.join(outputRoot, 'result.png');
    await writeRelayOriginalAtomically(originalPath, prepared.buffer);
    await writeRelayPngAtomically(normalizedPath, restored.buffer, { width: 1279, height: 1706 });
    assert.equal(sha256(await fs.readFile(originalPath)), sha256(prepared.buffer));
    assert.deepEqual(
      await sharp(await fs.readFile(normalizedPath)).metadata().then(({ width, height, format }) => ({ width, height, format })),
      { width: 1279, height: 1706, format: 'png' }
    );
  } finally {
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});
