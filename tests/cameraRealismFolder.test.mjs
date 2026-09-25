import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function populateFolder(root, count) {
  const { default: sharp } = await import('sharp');
  const fixture = path.join(root, 'fixture.png');
  await sharp({
    create: { width: 48, height: 32, channels: 3, background: '#6750a4' }
  }).png().toFile(fixture);
  await Promise.all(Array.from({ length: count }, (_, index) =>
    copyFile(fixture, path.join(root, `photo-${String(index + 1).padStart(3, '0')}.png`))
  ));
  await rm(fixture);
}

for (const count of [1, 20]) {
  test(`folder scan keeps ${count} valid images selectable`, async () => {
    const { scanCameraRealismFolder } = await import('../dist-electron/main/cameraRealismFolder.js');
    const root = await mkdtemp(path.join(tmpdir(), `yaochuang-camera-folder-${count}-`));
    try {
      await populateFolder(root, count);
      const scan = await scanCameraRealismFolder(root);
      assert.equal(scan.items.length, count);
      assert.equal(scan.items.every((item) => item.status === 'ready'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('folder scan supports one hundred images and keeps corrupt files isolated', async () => {
  const { scanCameraRealismFolder } = await import('../dist-electron/main/cameraRealismFolder.js');
  const root = await mkdtemp(path.join(tmpdir(), 'yaochuang-camera-folder-'));
  try {
    await populateFolder(root, 100);
    await writeFile(path.join(root, 'broken.jpg'), 'not-an-image', 'utf8');
    await writeFile(path.join(root, 'notes.txt'), 'ignore me', 'utf8');

    const scan = await scanCameraRealismFolder(root);
    assert.equal(scan.items.length, 101);
    assert.equal(scan.items.filter((item) => item.status === 'ready').length, 100);
    assert.equal(scan.items.filter((item) => item.status === 'error').length, 1);
    assert.equal(scan.items.find((item) => item.fileName === 'photo-001.png')?.width, 48);
    assert.equal(scan.items.find((item) => item.fileName === 'photo-001.png')?.height, 32);
    assert.match(scan.items.find((item) => item.fileName === 'broken.jpg')?.error || '', /解码|损坏/);
    assert.equal(scan.items.some((item) => item.fileName === 'notes.txt'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('HEIC is only selectable after a real HEIF decode', async () => {
  const { default: sharp } = await import('sharp');
  const { scanCameraRealismFolder } = await import('../dist-electron/main/cameraRealismFolder.js');
  const root = await mkdtemp(path.join(tmpdir(), 'yaochuang-camera-heic-'));
  try {
    await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#222222' }
    }).png().toFile(path.join(root, 'fake.heic'));
    const scan = await scanCameraRealismFolder(root);
    assert.equal(scan.items.length, 1);
    assert.equal(scan.items[0].status, 'error');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('folder outputs stay inside a new timestamped directory and never overwrite', async () => {
  const {
    createCameraRealismFolderOutputDirectory,
    nextCameraRealismFolderOutputPath
  } = await import('../dist-electron/main/cameraRealismFolder.js');
  const root = await mkdtemp(path.join(tmpdir(), 'yaochuang-camera-output-'));
  try {
    const outputDir = await createCameraRealismFolderOutputDirectory(root, new Date('2026-08-23T12:34:56'));
    assert.equal(path.dirname(outputDir), root);
    assert.match(path.basename(outputDir), /^耀创工坊_降AI感_20260823_123456/);

    const first = await nextCameraRealismFolderOutputPath(outputDir, 'portrait.png');
    await writeFile(first, 'existing', 'utf8');
    const second = await nextCameraRealismFolderOutputPath(outputDir, 'portrait.png');
    assert.notEqual(first, second);
    assert.equal(path.dirname(second), outputDir);
    assert.match(path.basename(second), /^portrait_降AI感_2\.jpg$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('folder processing can give identical inputs independent noise seeds', async () => {
  const { default: sharp } = await import('sharp');
  const { applyCameraRealism } = await import('../dist-electron/main/cameraRealism.js');
  const source = await sharp({
    create: { width: 48, height: 32, channels: 3, background: '#6750a4' }
  }).png().toBuffer();
  const first = await applyCameraRealism(source, { preset: 'natural', seed: 101 });
  const second = await applyCameraRealism(source, { preset: 'natural', seed: 202 });
  assert.equal(first.width, second.width);
  assert.equal(first.height, second.height);
  assert.notEqual(first.seed, second.seed);
  assert.notDeepEqual(first.buffer, second.buffer);
});

test('folder processing strength is normalized to the supported 10-100 range', async () => {
  const { normalizeCameraRealismStrength } = await import('../dist-electron/main/cameraRealism.js');
  assert.equal(normalizeCameraRealismStrength(undefined), 50);
  assert.equal(normalizeCameraRealismStrength(-5), 10);
  assert.equal(normalizeCameraRealismStrength(67.6), 68);
  assert.equal(normalizeCameraRealismStrength(500), 100);
});
