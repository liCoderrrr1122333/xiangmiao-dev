import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export type CameraRealismFolderItemStatus = 'ready' | 'error';

export interface CameraRealismFolderItem {
  id: string;
  fileName: string;
  size: number;
  width?: number;
  height?: number;
  previewDataUrl?: string;
  status: CameraRealismFolderItemStatus;
  error?: string;
  sourcePath: string;
}

export interface CameraRealismFolderScan {
  sourceDir: string;
  items: CameraRealismFolderItem[];
}

const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
const maximumInputBytes = 160 * 1024 * 1024;
const maximumPixels = 80_000_000;

function itemId(sourcePath: string) {
  return createHash('sha256').update(sourcePath).digest('hex').slice(0, 24);
}

function safeStem(fileName: string) {
  return path.parse(fileName).name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || '图片';
}

function timestampLabel(now: Date) {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}_${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
}

async function inspectFolderImage(sourcePath: string, fileName: string): Promise<CameraRealismFolderItem> {
  const base = {
    id: itemId(sourcePath),
    fileName,
    size: 0,
    sourcePath
  };
  try {
    const stats = await fs.stat(sourcePath);
    if (!stats.isFile() || stats.size < 4 || stats.size > maximumInputBytes) {
      throw new Error('图片大小无效或超过处理上限。');
    }
    const image = sharp(sourcePath, { limitInputPixels: maximumPixels });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > maximumPixels) {
      throw new Error('图片尺寸无效或超过处理上限。');
    }
    if (path.extname(fileName).toLowerCase() === '.heic' && metadata.format !== 'heif') {
      throw new Error('当前环境无法真实解码此 HEIC 图片。');
    }
    const preview = await sharp(sourcePath, { limitInputPixels: maximumPixels })
      .rotate()
      .resize({ width: 240, height: 180, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    return {
      ...base,
      size: stats.size,
      width: metadata.width,
      height: metadata.height,
      previewDataUrl: `data:image/jpeg;base64,${preview.toString('base64')}`,
      status: 'ready'
    };
  } catch {
    const stats = await fs.stat(sourcePath).catch(() => undefined);
    return {
      ...base,
      size: stats?.size || 0,
      status: 'error',
      error: '图片损坏或当前环境无法解码。'
    };
  }
}

export async function scanCameraRealismFolder(folderPath: string): Promise<CameraRealismFolderScan> {
  const sourceDir = await fs.realpath(folderPath);
  const sourceStats = await fs.lstat(sourceDir);
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
    throw new Error('请选择真实的本地图片文件夹。');
  }
  const entries = (await fs.readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  const items: CameraRealismFolderItem[] = [];
  for (const entry of entries) {
    items.push(await inspectFolderImage(path.join(sourceDir, entry.name), entry.name));
  }
  return { sourceDir, items };
}

export async function createCameraRealismFolderOutputDirectory(
  sourceDir: string,
  now = new Date()
) {
  const realSourceDir = await fs.realpath(sourceDir);
  const baseName = `耀创工坊_降AI感_${timestampLabel(now)}`;
  for (let copy = 1; copy <= 9999; copy += 1) {
    const outputDir = path.join(realSourceDir, copy === 1 ? baseName : `${baseName}_${copy}`);
    try {
      await fs.mkdir(outputDir);
      return outputDir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('当前文件夹中的降 AI 感输出目录过多。');
}

export async function nextCameraRealismFolderOutputPath(outputDir: string, sourceName: string) {
  const realOutputDir = await fs.realpath(outputDir);
  const stem = safeStem(sourceName);
  for (let copy = 1; copy <= 9999; copy += 1) {
    const suffix = copy === 1 ? '' : `_${copy}`;
    const outputPath = path.join(realOutputDir, `${stem}_降AI感${suffix}.jpg`);
    try {
      await fs.access(outputPath);
    } catch {
      return outputPath;
    }
  }
  throw new Error('同名降 AI 感副本过多，请整理输出目录后重试。');
}
