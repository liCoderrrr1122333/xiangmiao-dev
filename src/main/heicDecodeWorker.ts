import { parentPort, workerData } from 'node:worker_threads';
import decodeHeic from 'heic-decode';
import sharp from 'sharp';
import { IMAGE_IMPORT_MAX_PIXELS } from '../shared/imageImportPolicy.js';

interface WorkerInput {
  data: Uint8Array;
}

async function run() {
  const input = workerData as WorkerInput;
  const decoded = await decodeHeic({ buffer: input.data });
  const pixels = decoded.width * decoded.height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > IMAGE_IMPORT_MAX_PIXELS) {
    throw new Error('手机照片像素尺寸超过安全处理上限。');
  }
  const png = await sharp(Buffer.from(decoded.data), {
    raw: { width: decoded.width, height: decoded.height, channels: 4 },
    limitInputPixels: IMAGE_IMPORT_MAX_PIXELS
  })
    .png({ compressionLevel: 7, adaptiveFiltering: true })
    .toBuffer();
  const bytes = new Uint8Array(png);
  parentPort?.postMessage({ ok: true, width: decoded.width, height: decoded.height, data: bytes }, [bytes.buffer]);
}

void run().catch((error) => {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : '手机照片解码失败。'
  });
});

