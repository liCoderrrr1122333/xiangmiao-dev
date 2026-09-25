import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImageAsset, LegacyPostProcessingRecovery } from '../shared/types.js';
import { assertVerifiedJpeg, jpegPreviewDataUrl } from './imagePersistence.js';

const manifestNames = ['manifest.json', 'manifest.backup.json'] as const;
const maximumManifestBytes = 4 * 1024 * 1024;
const maximumImageBytes = 160 * 1024 * 1024;
const maximumItems = 20;

interface LegacyManifestItem {
  id?: unknown;
  batchId?: unknown;
  taskIndex?: unknown;
  sequence?: unknown;
  sourceFile?: unknown;
  name?: unknown;
  width?: unknown;
  height?: unknown;
  size?: unknown;
  promptText?: unknown;
}

interface LegacyManifest {
  version?: unknown;
  batchId?: unknown;
  projectName?: unknown;
  createdAt?: unknown;
  targetDimensions?: { width?: unknown; height?: unknown };
  items?: unknown;
}

function validInteger(value: unknown, maximum: number) {
  const rounded = Math.round(Number(value));
  return Number.isFinite(rounded) && rounded >= 1 && rounded <= maximum ? rounded : 0;
}

function containedPath(root: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('旧版结果路径无效。');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('旧版结果路径超出安全目录。');
  return resolved;
}

function isContained(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function readManifest(root: string) {
  let lastError: unknown;
  for (const manifestName of manifestNames) {
    const filePath = path.join(root, manifestName);
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > maximumManifestBytes) throw new Error('旧版清单大小无效。');
      const value = JSON.parse(await fs.readFile(filePath, 'utf8')) as LegacyManifest;
      if (value.version !== 1 || typeof value.batchId !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(value.batchId)) {
        throw new Error('旧版清单版本或批次标识无效。');
      }
      if (!Array.isArray(value.items) || value.items.length > maximumItems) throw new Error('旧版清单图片数量无效。');
      const width = validInteger(value.targetDimensions?.width, 32768);
      const height = validInteger(value.targetDimensions?.height, 32768);
      if (!width || !height) throw new Error('旧版清单缺少有效图片尺寸。');
      return { manifest: value, manifestName, width, height };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') lastError = error;
    }
  }
  if (lastError) throw lastError;
  return undefined;
}

async function recoverItem(
  root: string,
  realRoot: string,
  batchId: string,
  item: LegacyManifestItem,
  width: number,
  height: number,
  createdAt?: string
): Promise<ImageAsset> {
  const taskIndex = validInteger(item.taskIndex, maximumItems);
  const sequence = validInteger(item.sequence, 100_000) || taskIndex;
  if (!taskIndex || item.batchId !== batchId || typeof item.sourceFile !== 'string' || item.sourceFile.length > 320) {
    throw new Error('旧版图片记录无效。');
  }
  const filePath = containedPath(root, item.sourceFile);
  const stats = await fs.lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > maximumImageBytes) {
    throw new Error('旧版图片不是安全的普通文件。');
  }
  const realFilePath = await fs.realpath(filePath);
  if (!isContained(realRoot, realFilePath)) throw new Error('旧版图片真实路径超出安全目录。');
  const buffer = await fs.readFile(realFilePath);
  assertVerifiedJpeg(buffer, { width, height }, `旧版任务 ${taskIndex} JPG`);
  const manifestName = typeof item.name === 'string' && item.name.trim() ? path.basename(item.name.trim()) : path.basename(realFilePath);
  const name = /\.jpe?g$/i.test(manifestName) ? manifestName : `任务_${String(taskIndex).padStart(3, '0')}_原始.jpg`;
  return {
    id: `legacy-post-${batchId}-${taskIndex}`,
    name,
    type: 'image/jpeg',
    size: buffer.length,
    width,
    height,
    dataUrl: jpegPreviewDataUrl(buffer, width, height, 960),
    path: realFilePath,
    sequence,
    promptText: typeof item.promptText === 'string' ? item.promptText.slice(0, 200_000) : undefined,
    createdAt,
    source: 'legacy-post-processing'
  };
}

export async function recoverLegacyPostProcessingResults(userDataDir: string): Promise<LegacyPostProcessingRecovery> {
  const sourceDir = path.join(userDataDir, 'PostProcessing');
  try {
    const rootStats = await fs.stat(sourceDir);
    if (!rootStats.isDirectory()) return { found: false, sourceDir, recoveredImages: [], skippedCount: 0 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { found: false, sourceDir, recoveredImages: [], skippedCount: 0 };
    return {
      found: true,
      sourceDir,
      recoveredImages: [],
      skippedCount: 0,
      needsAttention: true,
      message: '检测到旧版待处理目录，但暂时无法读取。文件已原样保留，可打开恢复位置手动取回。'
    };
  }

  try {
    const loaded = await readManifest(sourceDir);
    if (!loaded) {
      return {
        found: true,
        sourceDir,
        recoveredImages: [],
        skippedCount: 0,
        needsAttention: true,
        message: '检测到旧版待处理目录，但没有可验证清单。文件已原样保留，可打开恢复位置手动取回。'
      };
    }
    const realRoot = await fs.realpath(sourceDir);
    const createdAt = typeof loaded.manifest.createdAt === 'string' && !Number.isNaN(Date.parse(loaded.manifest.createdAt))
      ? new Date(loaded.manifest.createdAt).toISOString()
      : undefined;
    const recoveredImages: ImageAsset[] = [];
    let skippedCount = 0;
    for (const item of loaded.manifest.items as LegacyManifestItem[]) {
      try {
        recoveredImages.push(await recoverItem(sourceDir, realRoot, loaded.manifest.batchId as string, item, loaded.width, loaded.height, createdAt));
      } catch {
        skippedCount += 1;
      }
    }
    return {
      found: true,
      sourceDir,
      recoveredImages,
      skippedCount,
      needsAttention: skippedCount > 0 || recoveredImages.length === 0,
      message: recoveredImages.length
        ? `已将 ${recoveredImages.length} 张旧版待处理 JPG 加入结果归档；原文件仍安全保留在恢复位置。${skippedCount ? `另有 ${skippedCount} 张未通过校验。` : ''}`
        : '旧版待处理图片未通过完整性校验，原文件已原样保留，可打开恢复位置手动取回。'
    };
  } catch {
    return {
      found: true,
      sourceDir,
      recoveredImages: [],
      skippedCount: 0,
      needsAttention: true,
      message: '旧版待处理清单无法安全解析，原图片和清单均未改动，可打开恢复位置手动取回。'
    };
  }
}
