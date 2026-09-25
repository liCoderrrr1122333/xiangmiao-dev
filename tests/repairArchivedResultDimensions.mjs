import { app, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const [, , autosavePath] = process.argv;
if (!autosavePath) throw new Error('Usage: electron tests/repairArchivedResultDimensions.mjs <autosave.json>');

const validDimension = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

try {
  const raw = await fs.readFile(autosavePath, 'utf8');
  const project = JSON.parse(raw);
  let targetWidth = validDimension(project.mainImage?.width);
  let targetHeight = validDimension(project.mainImage?.height);
  if ((!targetWidth || !targetHeight) && project.mainImage?.dataUrl) {
    const mainImage = nativeImage.createFromDataURL(project.mainImage.dataUrl);
    const size = mainImage.getSize();
    targetWidth = validDimension(size.width);
    targetHeight = validDimension(size.height);
  }
  if (!targetWidth || !targetHeight) throw new Error('Cannot read the main image dimensions.');

  const backupDir = path.join(path.dirname(autosavePath), 'dimension-backups', timestamp);
  const repaired = [];
  for (const archiveItem of project.resultArchive || []) {
    const image = archiveItem?.image;
    if (!image?.path) continue;
    const source = nativeImage.createFromPath(image.path);
    if (source.isEmpty()) continue;
    const sourceSize = source.getSize();
    if (sourceSize.width === targetWidth && sourceSize.height === targetHeight) {
      image.width = targetWidth;
      image.height = targetHeight;
      image.dimensionWarning = undefined;
      continue;
    }

    const resized = source.resize({ width: targetWidth, height: targetHeight, quality: 'best' });
    const png = resized.toPNG();
    const verified = nativeImage.createFromBuffer(png).getSize();
    if (verified.width !== targetWidth || verified.height !== targetHeight) {
      throw new Error(`Resize verification failed for ${image.path}: ${verified.width}x${verified.height}`);
    }

    await fs.mkdir(backupDir, { recursive: true });
    const extension = path.extname(image.path) || '.png';
    const baseName = path.basename(image.path, extension);
    const backupPath = path.join(backupDir, `${baseName}.source-${sourceSize.width}x${sourceSize.height}${extension}`);
    const temporaryPath = `${image.path}.${process.pid}.dimension-fix.tmp`;
    await fs.copyFile(image.path, backupPath);
    await fs.writeFile(temporaryPath, png);
    try {
      await fs.unlink(image.path);
      await fs.rename(temporaryPath, image.path);
    } catch (error) {
      await fs.copyFile(backupPath, image.path).catch(() => undefined);
      throw error;
    } finally {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }

    image.width = targetWidth;
    image.height = targetHeight;
    image.size = png.length;
    image.dimensionWarning = undefined;
    image.dimensionAdjustment = `历史结果已使用最高质量重采样校正为原图尺寸 ${targetWidth}x${targetHeight}px。`;
    repaired.push({ filePath: image.path, source: sourceSize, target: verified, backupPath });
  }

  if (repaired.length) {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(autosavePath, path.join(backupDir, path.basename(autosavePath)));
    await fs.writeFile(autosavePath, JSON.stringify(project, null, 2), 'utf8');
  }
  process.stdout.write(`${JSON.stringify({ target: { width: targetWidth, height: targetHeight }, repaired, backupDir })}\n`);
} finally {
  app.exit(0);
}
