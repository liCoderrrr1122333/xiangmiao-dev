import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export interface RelayPixelDimensions {
  width: number;
  height: number;
}

export interface RelayCanvasPlan {
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  contentWidth: number;
  contentHeight: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PreparedRelayAttachment {
  buffer: Buffer;
  mimeType: 'image/png';
  plan: RelayCanvasPlan;
}

export interface NormalizedRelayPng {
  buffer: Buffer;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  crop: { left: number; top: number; width: number; height: number };
  usedNonUniformStretch: false;
}

const maximumInputPixels = 32768 * 32768;

function validDimensions(value: RelayPixelDimensions, context: string) {
  const width = Math.round(Number(value.width));
  const height = Math.round(Number(value.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 32768 || height > 32768) {
    throw new Error(`${context}没有有效的像素尺寸。`);
  }
  return { width, height };
}

function centeredPlan(
  source: RelayPixelDimensions,
  canvas: RelayPixelDimensions,
  contentWidth: number,
  contentHeight: number
): RelayCanvasPlan {
  const left = Math.floor((canvas.width - contentWidth) / 2);
  const top = Math.floor((canvas.height - contentHeight) / 2);
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    contentWidth,
    contentHeight,
    left,
    top,
    right: canvas.width - contentWidth - left,
    bottom: canvas.height - contentHeight - top
  };
}

export function parseRelayResolution(value: string): RelayPixelDimensions {
  const match = /^(\d+)x(\d+)$/i.exec(String(value || '').trim());
  if (!match) throw new Error('API 输出分辨率无效。');
  return validDimensions({ width: Number(match[1]), height: Number(match[2]) }, 'API 输出');
}

export function createRelayCanvasPlan(
  rawSource: RelayPixelDimensions,
  rawProviderCanvas: RelayPixelDimensions
): RelayCanvasPlan {
  const source = validDimensions(rawSource, '原图');
  const providerCanvas = validDimensions(rawProviderCanvas, 'API 输出');
  const providerAspectRatio = providerCanvas.width / providerCanvas.height;
  const sourceAspectRatio = source.width / source.height;
  if (sourceAspectRatio >= providerAspectRatio) {
    const canvas = validDimensions({
      width: source.width,
      height: Math.ceil(source.width / providerAspectRatio)
    }, 'API 临时画布');
    return centeredPlan(source, canvas, source.width, source.height);
  }
  const canvas = validDimensions({
    width: Math.ceil(source.height * providerAspectRatio),
    height: source.height
  }, 'API 临时画布');
  return centeredPlan(source, canvas, source.width, source.height);
}

export async function prepareRelayMainAttachment(
  input: Buffer,
  rawSource: RelayPixelDimensions,
  rawCanvas: RelayPixelDimensions
): Promise<PreparedRelayAttachment> {
  const source = validDimensions(rawSource, '原图');
  const providerCanvas = validDimensions(rawCanvas, 'API 输出');
  const plan = createRelayCanvasPlan(source, providerCanvas);
  const metadata = await sharp(input, { limitInputPixels: maximumInputPixels }).metadata();
  if (metadata.width !== source.width || metadata.height !== source.height) {
    throw new Error(`API 主垫图尺寸与原图不一致：附件 ${metadata.width || 0}x${metadata.height || 0}px，原图 ${source.width}x${source.height}px。`);
  }

  if (plan.left < 0 || plan.top < 0 || plan.right < 0 || plan.bottom < 0) {
    throw new Error('API 临时画布无法在不拉伸原图的前提下完成补边。');
  }
  const buffer = await sharp(input, { limitInputPixels: maximumInputPixels })
    .extend({
      top: plan.top,
      bottom: plan.bottom,
      left: plan.left,
      right: plan.right,
      extendWith: 'copy'
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const preparedMetadata = await sharp(buffer, { limitInputPixels: maximumInputPixels }).metadata();
  if (preparedMetadata.format !== 'png' || preparedMetadata.width !== plan.canvasWidth || preparedMetadata.height !== plan.canvasHeight) {
    throw new Error('API 临时补边图校验失败。');
  }
  return { buffer, mimeType: 'image/png', plan };
}

function scaledCrop(plan: RelayCanvasPlan, actual: RelayPixelDimensions) {
  const left = Math.max(0, Math.round(plan.left * actual.width / plan.canvasWidth));
  const top = Math.max(0, Math.round(plan.top * actual.height / plan.canvasHeight));
  const right = Math.max(0, Math.round(plan.right * actual.width / plan.canvasWidth));
  const bottom = Math.max(0, Math.round(plan.bottom * actual.height / plan.canvasHeight));
  const width = actual.width - left - right;
  const height = actual.height - top - bottom;
  if (width < 1 || height < 1) throw new Error('API 结果无法按临时补边映射还原。');
  return { left, top, width, height };
}

export async function normalizeRelayResultToPng(
  input: Buffer,
  plan: RelayCanvasPlan,
  rawTarget: RelayPixelDimensions
): Promise<NormalizedRelayPng> {
  const target = validDimensions(rawTarget, '原图');
  const metadata = await sharp(input, { limitInputPixels: maximumInputPixels }).metadata();
  const actual = validDimensions({ width: metadata.width || 0, height: metadata.height || 0 }, 'API 结果');
  const crop = scaledCrop(plan, actual);
  const buffer = await sharp(input, { limitInputPixels: maximumInputPixels })
    .extract(crop)
    .resize({
      width: target.width,
      height: target.height,
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const output = await sharp(buffer, { limitInputPixels: maximumInputPixels }).metadata();
  if (output.format !== 'png' || output.width !== target.width || output.height !== target.height) {
    throw new Error('API 保真 PNG 尺寸校验失败。');
  }
  return {
    buffer,
    width: target.width,
    height: target.height,
    originalWidth: actual.width,
    originalHeight: actual.height,
    crop,
    usedNonUniformStretch: false
  };
}

export async function relayImageFileExtension(input: Buffer) {
  const format = (await sharp(input, { limitInputPixels: maximumInputPixels }).metadata()).format;
  if (format === 'jpeg') return 'jpg';
  if (format === 'png' || format === 'webp' || format === 'gif' || format === 'tiff') return format;
  return 'bin';
}

export async function writeRelayOriginalAtomically(filePath: string, buffer: Buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, buffer);
    const temporary = await fs.readFile(temporaryPath);
    if (!temporary.equals(buffer)) throw new Error('API 原始结果写入校验失败。');
    await fs.rename(temporaryPath, filePath);
    const written = await fs.readFile(filePath);
    if (!written.equals(buffer)) throw new Error('API 原始结果落盘校验失败。');
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function writeRelayPngAtomically(
  filePath: string,
  buffer: Buffer,
  rawTarget: RelayPixelDimensions
) {
  const target = validDimensions(rawTarget, '原图');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    const before = await sharp(buffer, { limitInputPixels: maximumInputPixels }).metadata();
    if (before.format !== 'png' || before.width !== target.width || before.height !== target.height) {
      throw new Error('待写入的 API 结果不是原图尺寸 PNG。');
    }
    await fs.writeFile(temporaryPath, buffer);
    const temporary = await sharp(await fs.readFile(temporaryPath), { limitInputPixels: maximumInputPixels }).metadata();
    if (temporary.format !== 'png' || temporary.width !== target.width || temporary.height !== target.height) {
      throw new Error('API 临时 PNG 校验失败。');
    }
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function relayPngPreviewDataUrl(buffer: Buffer, maximum = 960) {
  const preview = await sharp(buffer, { limitInputPixels: maximumInputPixels })
    .resize({ width: maximum, height: maximum, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return `data:image/png;base64,${preview.toString('base64')}`;
}
