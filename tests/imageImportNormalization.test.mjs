import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';

test('image import policy recognizes supported mobile and browser image formats without relying on MIME alone', async () => {
  const { IMAGE_IMPORT_ACCEPT, detectImageImportFormat, isPotentialImageImport } = await import(
    '../dist-electron/shared/imageImportPolicy.js'
  );

  assert.equal(detectImageImportFormat('portrait.heic', ''), 'heic');
  assert.equal(detectImageImportFormat('portrait.HEIF', 'application/octet-stream'), 'heif');
  assert.equal(detectImageImportFormat('portrait.jpeg', ''), 'jpeg');
  assert.equal(detectImageImportFormat('portrait.webp', 'image/webp'), 'webp');
  assert.equal(detectImageImportFormat('notes.txt', 'text/plain'), undefined);
  assert.equal(isPotentialImageImport('portrait.heic', ''), true);
  assert.equal(isPotentialImageImport('notes.txt', ''), false);
  assert.match(IMAGE_IMPORT_ACCEPT, /image\/heic/);
  assert.match(IMAGE_IMPORT_ACCEPT, /image\/heif/);
  assert.match(IMAGE_IMPORT_ACCEPT, /\.heic/);
  assert.match(IMAGE_IMPORT_ACCEPT, /\.heif/);
});

test('all image entry points use the trusted normalization IPC and expose HEIC/HEIF selection', async () => {
  const [types, preload, main, imageUtils, canvas, faces, wardrobe] = await Promise.all([
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/utils/imageUtils.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/MainImageCanvas.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/ReferenceImagePanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/WardrobeReferencePanel.tsx', import.meta.url), 'utf8')
  ]);

  assert.match(types, /normalizeImageImport:/);
  assert.match(preload, /image:normalize-import/);
  assert.match(main, /registerTrustedIpcHandler\(\s*'image:normalize-import'/);
  assert.match(main, /normalizeImportedImage/);
  assert.match(imageUtils, /window\.masklock\?\.normalizeImageImport/);
  assert.match(imageUtils, /isPotentialImageImport/);
  assert.doesNotMatch(faces, /file\.type\.startsWith\('image\/'\)/);
  assert.doesNotMatch(wardrobe, /file\.type\.startsWith\('image\/'\)/);

  for (const source of [canvas, faces, wardrobe]) {
    assert.match(source, /IMAGE_IMPORT_ACCEPT/);
  }
});

test('standard images preserve their original bytes and dimensions during trusted import', async () => {
  const { normalizeImportedImage } = await import('../dist-electron/main/imageImport.js');
  const source = await sharp({
    create: {
      width: 37,
      height: 29,
      channels: 4,
      background: { r: 41, g: 87, b: 133, alpha: 1 }
    }
  }).png().toBuffer();

  const normalized = await normalizeImportedImage({
    name: '群友自拍原图.png',
    mimeType: 'image/png',
    data: new Uint8Array(source)
  });

  assert.equal(normalized.converted, false);
  assert.equal(normalized.width, 37);
  assert.equal(normalized.height, 29);
  assert.equal(normalized.size, source.byteLength);
  assert.deepEqual(Buffer.from(normalized.dataUrl.split(',')[1], 'base64'), source);
});

test('corrupt files disguised as supported images are rejected before entering the project', async () => {
  const { normalizeImportedImage } = await import('../dist-electron/main/imageImport.js');

  await assert.rejects(
    normalizeImportedImage({
      name: '自拍原图.jpg',
      mimeType: 'image/jpeg',
      data: new Uint8Array([0x6e, 0x6f, 0x74, 0x2d, 0x61, 0x2d, 0x6a, 0x70, 0x65, 0x67])
    }),
    /图片文件已损坏或无法解码/
  );
});
