import fs from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';

export interface PixelDimensions {
  width: number;
  height: number;
}

export interface NormalizedJpeg {
  buffer: Buffer;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
  aspectRatioChanged: boolean;
  scaleFactor: number;
}

const jpegQuality = 96;
const maximumEncodedImageBytes = 160 * 1024 * 1024;

function validDimension(value: unknown) {
  const rounded = Math.round(Number(value));
  return Number.isFinite(rounded) && rounded > 0 && rounded <= 32768 ? rounded : 0;
}

function assertDimensions(value: PixelDimensions, context: string) {
  const width = validDimension(value.width);
  const height = validDimension(value.height);
  if (!width || !height) throw new Error(`${context}没有有效的像素尺寸。`);
  return { width, height };
}

function dataUrlToBuffer(dataUrl: string) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(maximumEncodedImageBytes * 4 / 3) + 256) {
    throw new Error('生成图片数据超过安全处理上限。');
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new Error('生成图片不是有效的 base64 图片数据。');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length < 4) throw new Error('生成图片数据为空。');
  if (buffer.length > maximumEncodedImageBytes) throw new Error('生成图片数据超过安全处理上限。');
  return buffer;
}

function flattenToWhite(image: Electron.NativeImage) {
  const size = assertDimensions(image.getSize(), '图片');
  const bitmap = Buffer.from(image.toBitmap());
  if (bitmap.length !== size.width * size.height * 4) return image;
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const alpha = bitmap[offset + 3] / 255;
    if (alpha < 1) {
      bitmap[offset] = Math.round(bitmap[offset] * alpha + 255 * (1 - alpha));
      bitmap[offset + 1] = Math.round(bitmap[offset + 1] * alpha + 255 * (1 - alpha));
      bitmap[offset + 2] = Math.round(bitmap[offset + 2] * alpha + 255 * (1 - alpha));
      bitmap[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height, scaleFactor: 1 });
}

export function assertVerifiedJpeg(buffer: Buffer, target: PixelDimensions, context: string) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) {
    throw new Error(`${context}不是完整的 JPG 文件。`);
  }
  const decoded = nativeImage.createFromBuffer(buffer);
  if (decoded.isEmpty()) throw new Error(`${context}无法由 Electron 解码。`);
  const actual = assertDimensions(decoded.getSize(), context);
  const expected = assertDimensions(target, '目标图片');
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(`${context}尺寸校验失败：实际 ${actual.width}x${actual.height}px，要求 ${expected.width}x${expected.height}px。`);
  }
  return actual;
}

export function normalizeImageDataUrlToJpeg(dataUrl: string, target: PixelDimensions): NormalizedJpeg {
  const expected = assertDimensions(target, '目标图片');
  const decoded = nativeImage.createFromBuffer(dataUrlToBuffer(dataUrl));
  if (decoded.isEmpty()) throw new Error('Electron 无法解码生成图片，不能转换为 JPG。');
  const source = assertDimensions(decoded.getSize(), '生成图片');
  const resized = source.width === expected.width && source.height === expected.height
    ? decoded
    : decoded.resize({ width: expected.width, height: expected.height, quality: 'best' });
  if (resized.isEmpty()) throw new Error(`生成图尺寸校正失败：${source.width}x${source.height} -> ${expected.width}x${expected.height}`);
  const flattened = flattenToWhite(resized);
  const jpeg = flattened.toJPEG(jpegQuality);
  assertVerifiedJpeg(jpeg, expected, '转换后的 JPG');
  return {
    buffer: jpeg,
    width: expected.width,
    height: expected.height,
    originalWidth: source.width,
    originalHeight: source.height,
    resized: source.width !== expected.width || source.height !== expected.height,
    aspectRatioChanged: Math.abs(source.width / source.height - expected.width / expected.height) > 0.002,
    scaleFactor: Math.max(expected.width / source.width, expected.height / source.height)
  };
}

export async function writeVerifiedJpegAtomically(filePath: string, buffer: Buffer, target: PixelDimensions) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    assertVerifiedJpeg(buffer, target, '待写入 JPG');
    await fs.writeFile(temporaryPath, buffer);
    assertVerifiedJpeg(await fs.readFile(temporaryPath), target, '临时 JPG');
    await fs.rename(temporaryPath, filePath);
    assertVerifiedJpeg(await fs.readFile(filePath), target, '最终 JPG');
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export function jpegPreviewDataUrl(buffer: Buffer, width: number, height: number, maximum = 1600) {
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error('无法生成结果预览图。');
  const scale = Math.min(1, maximum / Math.max(width, height));
  const preview = scale < 1
    ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' })
    : image;
  return `data:image/jpeg;base64,${preview.toJPEG(92).toString('base64')}`;
}
