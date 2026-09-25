import path from 'node:path';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import {
  detectImageImportFormat,
  IMAGE_IMPORT_MAX_BYTES,
  IMAGE_IMPORT_MAX_PIXELS,
  imageImportMimeType,
  type ImageImportFormat
} from '../shared/imageImportPolicy.js';
import type { ImageImportRequest, NormalizedImageImport } from '../shared/types.js';

interface HeicWorkerResult {
  ok: boolean;
  width?: number;
  height?: number;
  data?: Uint8Array;
  error?: string;
}

const heicDecodeTimeoutMs = 60_000;

function normalizedName(name: string, extension: string) {
  const parsed = path.parse(String(name || '手机照片'));
  return `${parsed.name || '手机照片'}.${extension}`;
}

function standardFormat(format: string | undefined): ImageImportFormat | undefined {
  if (format === 'jpg' || format === 'jpeg') return 'jpeg';
  if (format === 'png' || format === 'webp') return format;
  return undefined;
}

async function decodeHeicInWorker(data: Uint8Array) {
  return new Promise<{ width: number; height: number; data: Uint8Array }>((resolve, reject) => {
    const worker = new Worker(new URL('./heicDecodeWorker.js', import.meta.url), {
      workerData: { data },
      resourceLimits: { maxOldGenerationSizeMb: 384 }
    });
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error('手机照片解析超过 60 秒，已安全停止。'));
    }, heicDecodeTimeoutMs);
    const finish = () => clearTimeout(timeout);
    worker.once('message', (message: HeicWorkerResult) => {
      finish();
      void worker.terminate();
      if (!message.ok || !message.data || !message.width || !message.height) {
        reject(new Error(message.error || '手机照片解码失败。'));
        return;
      }
      resolve({ width: message.width, height: message.height, data: message.data });
    });
    worker.once('error', (error) => {
      finish();
      reject(error);
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish();
        reject(new Error(`手机照片解码进程异常退出（${code}）。`));
      }
    });
  });
}

export async function normalizeImportedImage(payload: ImageImportRequest): Promise<NormalizedImageImport> {
  const name = String(payload?.name || '').trim();
  const mimeType = String(payload?.mimeType || '').trim();
  const data = payload?.data instanceof Uint8Array ? payload.data : new Uint8Array(payload?.data || []);
  if (!data.byteLength) throw new Error('图片文件为空，无法导入。');
  if (data.byteLength > IMAGE_IMPORT_MAX_BYTES) throw new Error('图片超过 25MB，请先在相册中缩小文件后再导入。');

  const declaredFormat = detectImageImportFormat(name, mimeType);
  if (!declaredFormat) throw new Error('仅支持 JPG、JPEG、PNG、WebP、HEIC 和 HEIF 图片。');

  if (declaredFormat === 'heic' || declaredFormat === 'heif') {
    try {
      const decoded = await decodeHeicInWorker(data);
      return {
        name: normalizedName(name, 'png'),
        type: 'image/png',
        size: decoded.data.byteLength,
        width: decoded.width,
        height: decoded.height,
        dataUrl: `data:image/png;base64,${Buffer.from(decoded.data).toString('base64')}`,
        sourceFormat: declaredFormat,
        converted: true
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`这张 HEIC/HEIF 手机照片无法解码：${detail}`);
    }
  }

  try {
    const buffer = Buffer.from(data);
    const metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: IMAGE_IMPORT_MAX_PIXELS
    }).metadata();
    const actualFormat = standardFormat(metadata.format);
    if (!actualFormat) throw new Error('图片编码不是受支持的 JPG、PNG 或 WebP。');
    const width = metadata.autoOrient?.width || metadata.width;
    const height = metadata.autoOrient?.height || metadata.height;
    if (!width || !height) throw new Error('无法读取图片像素尺寸。');
    return {
      name: name || normalizedName('图片', actualFormat === 'jpeg' ? 'jpg' : actualFormat),
      type: imageImportMimeType(actualFormat),
      size: buffer.byteLength,
      width,
      height,
      dataUrl: `data:${imageImportMimeType(actualFormat)};base64,${buffer.toString('base64')}`,
      sourceFormat: actualFormat,
      converted: false
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`图片文件已损坏或无法解码：${detail}`);
  }
}

