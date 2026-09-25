import { createHash } from 'node:crypto';
import sharp from 'sharp';

export interface GeneratedImageReadiness {
  contentHash: string;
  width: number;
  height: number;
  activePixelRatio: number;
  lumaStdDev: number;
  edgeRatio: number;
  ready: boolean;
  reason: string;
}

export interface GeneratedImageReadinessState {
  contentHash: string;
  stablePolls: number;
  accepted: boolean;
}

export const minimumStableGeneratedImagePolls = 2;

export async function inspectGeneratedImageBuffer(buffer: Buffer): Promise<GeneratedImageReadiness> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .resize({ width: 64, height: 64, fit: 'fill', kernel: 'nearest' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixelCount = info.width * info.height;
  let activePixels = 0;
  let lumaSum = 0;
  let lumaSquareSum = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let edgeCount = 0;
  let edgeComparisons = 0;
  const lumaAt = (offset: number) => 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * channels;
      const alpha = data[offset + 3] / 255;
      const luma = lumaAt(offset);
      if (alpha >= 0.06) {
        activePixels += 1;
        lumaSum += luma;
        lumaSquareSum += luma * luma;
        minLuma = Math.min(minLuma, luma);
        maxLuma = Math.max(maxLuma, luma);
      }
      if (x + 1 < info.width) {
        const rightOffset = offset + channels;
        if (alpha >= 0.06 && data[rightOffset + 3] / 255 >= 0.06) {
          edgeComparisons += 1;
          if (Math.abs(luma - lumaAt(rightOffset)) >= 8) edgeCount += 1;
        }
      }
      if (y + 1 < info.height) {
        const belowOffset = offset + info.width * channels;
        if (alpha >= 0.06 && data[belowOffset + 3] / 255 >= 0.06) {
          edgeComparisons += 1;
          if (Math.abs(luma - lumaAt(belowOffset)) >= 8) edgeCount += 1;
        }
      }
    }
  }

  const activePixelRatio = activePixels / Math.max(1, pixelCount);
  const meanLuma = activePixels ? lumaSum / activePixels : 0;
  const lumaVariance = activePixels ? Math.max(0, lumaSquareSum / activePixels - meanLuma * meanLuma) : 0;
  const lumaStdDev = Math.sqrt(lumaVariance);
  const edgeRatio = edgeCount / Math.max(1, edgeComparisons);
  const nearUniform = lumaStdDev < 2.2 && maxLuma - minLuma < 12 && edgeRatio < 0.005;
  const ready = activePixelRatio >= 0.02 && !nearUniform && (lumaStdDev >= 3 || maxLuma - minLuma >= 16 || edgeRatio >= 0.01);

  return {
    contentHash: createHash('sha256').update(data).digest('hex'),
    width: info.width,
    height: info.height,
    activePixelRatio,
    lumaStdDev,
    edgeRatio,
    ready,
    reason: ready ? 'content-ready' : activePixelRatio < 0.02 ? 'transparent-or-empty' : 'uniform-placeholder'
  };
}

export function nextGeneratedImageReadinessState(
  previous: GeneratedImageReadinessState | undefined,
  current: GeneratedImageReadiness,
  pageSettled: boolean
): GeneratedImageReadinessState {
  const stablePolls = pageSettled && current.ready && previous?.contentHash === current.contentHash
    ? previous.stablePolls + 1
    : pageSettled && current.ready
      ? 1
      : 0;
  return {
    contentHash: current.contentHash,
    stablePolls,
    accepted: pageSettled && current.ready && stablePolls >= minimumStableGeneratedImagePolls
  };
}
