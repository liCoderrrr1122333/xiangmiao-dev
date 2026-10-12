import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { applyFaceNaturalization } from '../dist-electron/main/cameraRealism.js';

test('face mask coordinates scale from a preview to original pixels without moving the face', async () => {
  const { mapFaceMaskToOriginal } = await import('../dist-electron/shared/faceNaturalizationPolicy.js');
  const mapped = mapFaceMaskToOriginal({ dataUrl: 'fixture', x: 50, y: 80, width: 100, height: 120 },
    { width: 400, height: 600 }, { width: 2000, height: 3000 });
  assert.deepEqual(mapped, { dataUrl: 'fixture', x: 250, y: 400, width: 500, height: 600 });
  assert.throws(() => mapFaceMaskToOriginal(mapped, { width: 400, height: 600 }, { width: 600, height: 400 }), /比例/);
});

test('face-only processing preserves every background pixel and transparency in a lossless copy', async () => {
  const width = 64, height = 48;
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 7) % 251;
    pixels[i + 1] = (i * 11) % 253;
    pixels[i + 2] = (i * 13) % 255;
    pixels[i + 3] = i % 12 ? 255 : 100;
  }
  const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const mask = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ffffffff' } }).png().toBuffer();
  const result = await applyFaceNaturalization(input, { data: mask, x: 24, y: 16, width: 16, height: 16 });
  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.format, 'png');
  const actual = await sharp(result.buffer).ensureAlpha().raw().toBuffer();
  let changed = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    assert.equal(actual[i + 3], pixels[i + 3]);
    if (x < 24 || x >= 40 || y < 16 || y >= 32) assert.deepEqual(actual.subarray(i, i + 4), pixels.subarray(i, i + 4));
    else if (!actual.subarray(i, i + 3).equals(pixels.subarray(i, i + 3))) changed++;
  }
  assert.ok(changed > 0);
});

test('same-size source texture is copied only inside the face mask', async () => {
  const width = 48;
  const height = 36;
  const flat = Buffer.alloc(width * height * 4, 180);
  for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
  const input = await sharp(flat, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const noisy = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noisy.length; i += 1) noisy[i] = 120 + ((i * 17) % 40);
  const source = await sharp(noisy, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const mask = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ffffffff' } }).png().toBuffer();
  const result = await applyFaceNaturalization(input, { data: mask, x: 8, y: 8, width: 16, height: 16, source });
  const actual = await sharp(result.buffer).ensureAlpha().raw().toBuffer();
  let changed = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    if (x < 8 || x >= 24 || y < 8 || y >= 24) assert.deepEqual(actual.subarray(i, i + 4), flat.subarray(i, i + 4));
    else if (actual[i] !== 180 || actual[i + 1] !== 180 || actual[i + 2] !== 180) changed += 1;
  }
  assert.ok(changed > 0);
  const wrongSize = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#111111' } }).png().toBuffer();
  const ignored = await applyFaceNaturalization(input, { data: mask, x: 8, y: 8, width: 16, height: 16, source: wrongSize });
  assert.equal(ignored.width, width);
  assert.equal(ignored.height, height);
});

test('empty and out-of-image face masks fail instead of saving a fake repaired result', async () => {
  const input = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#abcdef' } }).png().toBuffer();
  const empty = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#00000000' } }).png().toBuffer();
  await assert.rejects(() => applyFaceNaturalization(input, { data: empty, x: 0, y: 0, width: 32, height: 32 }), /有效.*区域/);
  await assert.rejects(() => applyFaceNaturalization(input, { data: empty, x: 100, y: 100, width: 32, height: 32 }), /超出/);
});
