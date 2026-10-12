import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export type CameraRealismPreset = 'natural' | 'aggressive';

export interface CameraRealismResult {
  buffer: Buffer;
  width: number;
  height: number;
  seed: number;
  strength: number;
}

export interface CameraRealismFileResult extends CameraRealismResult {
  filePath: string;
}

export interface FaceNaturalizationMaskInput {
  data: Buffer;
  x: number;
  y: number;
  width: number;
  height: number;
  source?: Buffer;
}

export interface FaceNaturalizationFileResult {
  buffer: Buffer;
  width: number;
  height: number;
  filePath: string;
}

interface CameraRealismConfig {
  barrel: number;
  gain: readonly [number, number, number];
  shadowTint: readonly [number, number, number];
  highlightTint: readonly [number, number, number];
  contrast: number;
  broadDetail: number;
  fineDetail: number;
  bloom: number;
  vignette: number;
  chromaticShift: number;
  edgeBlur: number;
  edgeSoftness: number;
  monoGrain: number;
  colourGrain: number;
  jpegQuality: number;
}

const maximumPixels = 80_000_000;

const presets: Record<CameraRealismPreset, CameraRealismConfig> = {
  natural: {
    barrel: 0.026,
    gain: [1.008, 1, 0.997],
    shadowTint: [-0.002, 0, 0.002],
    highlightTint: [0.002, 0.001, -0.001],
    contrast: 0.16,
    broadDetail: 0.24,
    fineDetail: 0.4,
    bloom: 0.018,
    vignette: 0.065,
    chromaticShift: 0.65,
    edgeBlur: 0.5,
    edgeSoftness: 0.1,
    monoGrain: 0.85,
    colourGrain: 0.25,
    jpegQuality: 48
  },
  aggressive: {
    barrel: 0.026,
    gain: [1.12, 1.016, 0.885],
    shadowTint: [-0.024, 0.008, 0.048],
    highlightTint: [0.025, 0.008, -0.022],
    contrast: 0.54,
    broadDetail: 0.78,
    fineDetail: 1.16,
    bloom: 0.088,
    vignette: 0.305,
    chromaticShift: 3.05,
    edgeBlur: 1.85,
    edgeSoftness: 0.58,
    monoGrain: 4.1,
    colourGrain: 1.8,
    jpegQuality: 28
  }
};

const neutralConfig: CameraRealismConfig = {
  barrel: 0,
  gain: [1, 1, 1],
  shadowTint: [0, 0, 0],
  highlightTint: [0, 0, 0],
  contrast: 0,
  broadDetail: 0,
  fineDetail: 0,
  bloom: 0,
  vignette: 0,
  chromaticShift: 0,
  edgeBlur: 0.3,
  edgeSoftness: 0,
  monoGrain: 0,
  colourGrain: 0,
  jpegQuality: 92
};

export function normalizeCameraRealismStrength(value?: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(10, Math.min(100, Math.round(value as number)));
}

function interpolate(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function interpolateTuple(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  amount: number
): readonly [number, number, number] {
  return [
    interpolate(from[0], to[0], amount),
    interpolate(from[1], to[1], amount),
    interpolate(from[2], to[2], amount)
  ];
}

function interpolateConfig(from: CameraRealismConfig, to: CameraRealismConfig, amount: number): CameraRealismConfig {
  return {
    barrel: interpolate(from.barrel, to.barrel, amount),
    gain: interpolateTuple(from.gain, to.gain, amount),
    shadowTint: interpolateTuple(from.shadowTint, to.shadowTint, amount),
    highlightTint: interpolateTuple(from.highlightTint, to.highlightTint, amount),
    contrast: interpolate(from.contrast, to.contrast, amount),
    broadDetail: interpolate(from.broadDetail, to.broadDetail, amount),
    fineDetail: interpolate(from.fineDetail, to.fineDetail, amount),
    bloom: interpolate(from.bloom, to.bloom, amount),
    vignette: interpolate(from.vignette, to.vignette, amount),
    chromaticShift: interpolate(from.chromaticShift, to.chromaticShift, amount),
    edgeBlur: interpolate(from.edgeBlur, to.edgeBlur, amount),
    edgeSoftness: interpolate(from.edgeSoftness, to.edgeSoftness, amount),
    monoGrain: interpolate(from.monoGrain, to.monoGrain, amount),
    colourGrain: interpolate(from.colourGrain, to.colourGrain, amount),
    jpegQuality: Math.round(interpolate(from.jpegQuality, to.jpegQuality, amount))
  };
}

function configForStrength(strength: number) {
  if (strength <= 50) return interpolateConfig(neutralConfig, presets.natural, strength / 50);
  return interpolateConfig(presets.natural, presets.aggressive, (strength - 50) / 50);
}

function deriveSeed(input: Buffer) {
  const seed = createHash('sha256').update(input).digest().readUInt32LE(0);
  return seed || 0x6d2b79f5;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function centeredNoise(random: () => number) {
  return (random() + random() + random() + random() - 2) * 1.2247448714;
}

function sample(buffer: Buffer, width: number, height: number, x: number, y: number, channel: number) {
  const clampedX = Math.max(0, Math.min(width - 1.001, x));
  const clampedY = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const wx = clampedX - x0;
  const wy = clampedY - y0;
  const top = buffer[(y0 * width + x0) * 3 + channel] * (1 - wx)
    + buffer[(y0 * width + x1) * 3 + channel] * wx;
  const bottom = buffer[(y1 * width + x0) * 3 + channel] * (1 - wx)
    + buffer[(y1 * width + x1) * 3 + channel] * wx;
  return top * (1 - wy) + bottom * wy;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function createLumaBuffer(source: Buffer, width: number, height: number) {
  const output = Buffer.allocUnsafe(width * height);
  for (let index = 0, pixel = 0; index < source.length; index += 3, pixel += 1) {
    output[pixel] = clampByte(
      source[index] * 0.2126 + source[index + 1] * 0.7152 + source[index + 2] * 0.0722
    );
  }
  return output;
}

async function blurMono(source: Buffer, width: number, height: number, sigma: number) {
  return sharp(source, { raw: { width, height, channels: 1 } })
    .blur(sigma)
    .raw()
    .toBuffer();
}

async function blurRgb(source: Buffer, width: number, height: number, sigma: number) {
  return sharp(source, { raw: { width, height, channels: 3 } })
    .blur(sigma)
    .raw()
    .toBuffer();
}

function applyLensAndTone(source: Buffer, width: number, height: number, config: CameraRealismConfig) {
  const output = Buffer.allocUnsafe(width * height * 3);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;

  for (let y = 0; y < height; y += 1) {
    const ny = (y - centerY) / halfHeight;
    for (let x = 0; x < width; x += 1) {
      const nx = (x - centerX) / halfWidth;
      const radius = Math.sqrt(nx * nx + ny * ny);
      const barrel = 1 + config.barrel * radius * radius;
      const sampleX = centerX + nx * halfWidth * barrel;
      const sampleY = centerY + ny * halfHeight * barrel;
      const red = sample(source, width, height, sampleX, sampleY, 0);
      const green = sample(source, width, height, sampleX, sampleY, 1);
      const blue = sample(source, width, height, sampleX, sampleY, 2);
      const initialLuma = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
      const shadows = clampUnit((0.52 - initialLuma) / 0.52);
      const highlights = clampUnit((initialLuma - 0.48) / 0.52);
      const channels = [red, green, blue].map((value, channel) => (
        value * config.gain[channel]
        + 255 * shadows * config.shadowTint[channel]
        + 255 * highlights * config.highlightTint[channel]
      ));
      const luma = (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722) / 255;
      const midtoneWeight = 1 - 0.57 * Math.abs(2 * Math.max(0, Math.min(1, luma)) - 1);
      const targetLuma = Math.max(0, Math.min(1, luma + config.contrast * (luma - 0.47) * midtoneWeight));
      const lumaScale = targetLuma / Math.max(luma, 0.0001);
      const index = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        output[index + channel] = clampByte(channels[channel] * lumaScale);
      }
    }
  }
  return output;
}

async function applyLocalDetail(source: Buffer, width: number, height: number, config: CameraRealismConfig) {
  const luma = createLumaBuffer(source, width, height);
  const [broadBlur, fineBlur] = await Promise.all([
    blurMono(luma, width, height, 21),
    blurMono(luma, width, height, 1.05)
  ]);
  const output = Buffer.allocUnsafe(source.length);
  for (let pixel = 0; pixel < luma.length; pixel += 1) {
    const broad = Math.max(-0.16, Math.min(0.16, (luma[pixel] - broadBlur[pixel]) / 255));
    const fine = Math.max(-0.06, Math.min(0.06, (luma[pixel] - fineBlur[pixel]) / 255));
    const detail = 255 * (config.broadDetail * broad + config.fineDetail * fine);
    const index = pixel * 3;
    output[index] = clampByte(source[index] + detail);
    output[index + 1] = clampByte(source[index + 1] + detail);
    output[index + 2] = clampByte(source[index + 2] + detail);
  }
  return output;
}

async function applyBloomAndVignette(source: Buffer, width: number, height: number, config: CameraRealismConfig) {
  const luma = createLumaBuffer(source, width, height);
  const bloomSource = Buffer.allocUnsafe(luma.length);
  for (let pixel = 0; pixel < luma.length; pixel += 1) {
    bloomSource[pixel] = clampByte(clampUnit((luma[pixel] / 255 - 0.72) / 0.28) * 255);
  }
  const bloom = await blurMono(bloomSource, width, height, 7);
  const output = Buffer.allocUnsafe(source.length);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    const ny = (y - centerY) / halfHeight;
    for (let x = 0; x < width; x += 1) {
      const nx = (x - centerX) / halfWidth;
      const radius = Math.sqrt(nx * nx + ny * ny);
      const edge = clampUnit((radius - 0.34) / 1.06);
      const vignette = 1 - config.vignette * edge ** 1.65;
      const pixel = y * width + x;
      const index = pixel * 3;
      const bloomLift = config.bloom * bloom[pixel];
      output[index] = clampByte((source[index] + bloomLift) * vignette);
      output[index + 1] = clampByte((source[index + 1] + bloomLift) * vignette);
      output[index + 2] = clampByte((source[index + 2] + bloomLift) * vignette);
    }
  }
  return output;
}

async function applyLensEdges(source: Buffer, width: number, height: number, config: CameraRealismConfig) {
  const shifted = Buffer.allocUnsafe(source.length);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    const ny = (y - centerY) / halfHeight;
    for (let x = 0; x < width; x += 1) {
      const nx = (x - centerX) / halfWidth;
      const radius = Math.sqrt(nx * nx + ny * ny);
      const edge = clampUnit((radius - 0.34) / 1.06);
      const shift = config.chromaticShift * edge * edge;
      const index = (y * width + x) * 3;
      shifted[index] = clampByte(sample(source, width, height, x + nx * shift, y + ny * shift, 0));
      shifted[index + 1] = source[index + 1];
      shifted[index + 2] = clampByte(sample(source, width, height, x - nx * shift, y - ny * shift, 2));
    }
  }
  const blurred = await blurRgb(shifted, width, height, config.edgeBlur);
  const output = Buffer.allocUnsafe(source.length);
  for (let y = 0; y < height; y += 1) {
    const ny = (y - centerY) / halfHeight;
    for (let x = 0; x < width; x += 1) {
      const nx = (x - centerX) / halfWidth;
      const radius = Math.sqrt(nx * nx + ny * ny);
      const softness = clampUnit((radius - 0.7) / 0.7) * config.edgeSoftness;
      const index = (y * width + x) * 3;
      output[index] = clampByte(shifted[index] * (1 - softness) + blurred[index] * softness);
      output[index + 1] = clampByte(shifted[index + 1] * (1 - softness) + blurred[index + 1] * softness);
      output[index + 2] = clampByte(shifted[index + 2] * (1 - softness) + blurred[index + 2] * softness);
    }
  }
  return output;
}

async function applyTextureAwareNoise(
  source: Buffer,
  width: number,
  height: number,
  config: CameraRealismConfig,
  seed: number
) {
  const luma = createLumaBuffer(source, width, height);
  const squaredLuma = Buffer.allocUnsafe(luma.length);
  for (let pixel = 0; pixel < luma.length; pixel += 1) {
    squaredLuma[pixel] = clampByte((luma[pixel] / 255) ** 2 * 255);
  }
  const [localMean, localMeanSquare] = await Promise.all([
    blurMono(luma, width, height, 6),
    blurMono(squaredLuma, width, height, 6)
  ]);
  const output = Buffer.allocUnsafe(source.length);
  const random = mulberry32(seed);
  for (let pixel = 0; pixel < luma.length; pixel += 1) {
    const normalizedLuma = luma[pixel] / 255;
    const normalizedMean = localMean[pixel] / 255;
    const localVariance = Math.max(0, localMeanSquare[pixel] / 255 - normalizedMean * normalizedMean);
    const flatRegionWeight = Math.max(0.3, Math.min(1, 1 - localVariance / 0.0038));
    const shadowNoise = 0.55 + 1.22 * (1 - normalizedLuma);
    const monoNoise = centeredNoise(random) * config.monoGrain * flatRegionWeight * shadowNoise;
    const index = pixel * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const colourNoise = centeredNoise(random) * config.colourGrain * flatRegionWeight * shadowNoise;
      output[index + channel] = clampByte(source[index + channel] + monoNoise + colourNoise);
    }
  }
  return output;
}

async function applyPixelFinish(
  source: Buffer,
  width: number,
  height: number,
  config: CameraRealismConfig,
  seed: number
) {
  const toned = applyLensAndTone(source, width, height, config);
  const detailed = await applyLocalDetail(toned, width, height, config);
  const bloomed = await applyBloomAndVignette(detailed, width, height, config);
  const edged = await applyLensEdges(bloomed, width, height, config);
  return applyTextureAwareNoise(edged, width, height, config, seed);
}

export async function applyCameraRealism(
  input: Buffer,
  options: { preset?: CameraRealismPreset; seed?: number; strength?: number } = {}
): Promise<CameraRealismResult> {
  if (!Buffer.isBuffer(input) || input.length < 4) throw new Error('相机质感处理没有收到有效图片。');
  const strength = normalizeCameraRealismStrength(
    options.strength ?? (options.preset === 'aggressive' ? 100 : undefined)
  );
  const config = configForStrength(strength);

  const decoded = await sharp(input, { limitInputPixels: maximumPixels })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (!width || !height || channels !== 3 || width * height > maximumPixels) {
    throw new Error('图片尺寸超出相机质感处理范围。');
  }

  const seed = Number.isFinite(options.seed)
    ? (Math.round(options.seed as number) >>> 0) || 0x6d2b79f5
    : deriveSeed(input);
  const pixels = await applyPixelFinish(decoded.data, width, height, config, seed);
  const buffer = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({
      quality: config.jpegQuality,
      chromaSubsampling: '4:2:0',
      progressive: false,
      optimiseCoding: false
    })
    .toBuffer();

  return { buffer, width, height, seed, strength };
}

export async function writeCameraRealismCopy(
  input: Buffer,
  filePath: string,
  options: { preset?: CameraRealismPreset; seed?: number; strength?: number } = {}
): Promise<CameraRealismFileResult> {
  if (!/\.jpe?g$/i.test(filePath)) throw new Error('相机质感副本必须使用 JPG 扩展名。');
  const result = await applyCameraRealism(input, options);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, result.buffer);
    const metadata = await sharp(await fs.readFile(temporaryPath)).metadata();
    if (metadata.format !== 'jpeg' || metadata.width !== result.width || metadata.height !== result.height) {
      throw new Error('相机质感副本保存后尺寸校验失败。');
    }
    await fs.rename(temporaryPath, filePath);
    return { ...result, filePath };
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

function sampleMaskAlpha(
  mask: Buffer,
  maskWidth: number,
  maskHeight: number,
  channels: number,
  x: number,
  y: number
) {
  const clampedX = Math.max(0, Math.min(maskWidth - 1, x));
  const clampedY = Math.max(0, Math.min(maskHeight - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(maskWidth - 1, x0 + 1);
  const y1 = Math.min(maskHeight - 1, y0 + 1);
  const wx = clampedX - x0;
  const wy = clampedY - y0;
  const alphaAt = (sampleX: number, sampleY: number) => mask[(sampleY * maskWidth + sampleX) * channels + (channels - 1)];
  const top = alphaAt(x0, y0) * (1 - wx) + alphaAt(x1, y0) * wx;
  const bottom = alphaAt(x0, y1) * (1 - wx) + alphaAt(x1, y1) * wx;
  return (top * (1 - wy) + bottom * wy) / 255;
}

export async function applyFaceNaturalization(
  input: Buffer,
  maskInput: FaceNaturalizationMaskInput
): Promise<Omit<FaceNaturalizationFileResult, 'filePath'>> {
  if (!Buffer.isBuffer(input) || input.length < 4) throw new Error('面部自然化没有收到有效图片。');
  if (!Buffer.isBuffer(maskInput.data) || maskInput.data.length < 4) throw new Error('没有收到可用的人脸处理区域。');
  if (![maskInput.x, maskInput.y, maskInput.width, maskInput.height].every(Number.isFinite) || maskInput.width <= 0 || maskInput.height <= 0) {
    throw new Error('人脸处理区域尺寸无效。');
  }

  const decoded = await sharp(input, { limitInputPixels: maximumPixels })
    .rotate()
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const maskDecoded = await sharp(maskInput.data, { limitInputPixels: maximumPixels })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  const { width: maskWidth, height: maskHeight, channels: maskChannels } = maskDecoded.info;
  if (!width || !height || channels !== 4 || width * height > maximumPixels) {
    throw new Error('图片尺寸超出面部自然化处理范围。');
  }
  if (!maskWidth || !maskHeight || maskChannels < 2) throw new Error('人脸处理区域解码失败。');
  if (maskInput.x < 0 || maskInput.y < 0 || maskInput.x + maskInput.width > width + 0.01 || maskInput.y + maskInput.height > height + 0.01) {
    throw new Error('人脸处理区域超出原图，请重新导入完整原图后重试。');
  }

  const resultRgb = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
    .removeAlpha()
    .raw()
    .toBuffer();
  const blurRgb = (pixels: Buffer) => sharp(pixels, { raw: { width, height, channels: 3 } }).blur(1.15).raw().toBuffer();
  const resultBlur = await blurRgb(resultRgb);
  let sourceRgb = resultRgb;
  let sourceBlur = resultBlur;
  let usingSource = false;
  if (maskInput.source && Buffer.isBuffer(maskInput.source) && maskInput.source.length > 4) {
    try {
      const sourceDecoded = await sharp(maskInput.source, { limitInputPixels: maximumPixels })
        .rotate()
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (sourceDecoded.info.width === width && sourceDecoded.info.height === height && sourceDecoded.info.channels === 3) {
        sourceRgb = sourceDecoded.data;
        sourceBlur = await blurRgb(sourceRgb);
        usingSource = true;
      }
    } catch {
      usingSource = false;
    }
  }
  const output = Buffer.from(decoded.data);
  const left = Math.max(0, Math.floor(maskInput.x));
  const top = Math.max(0, Math.floor(maskInput.y));
  const right = Math.min(width, Math.ceil(maskInput.x + maskInput.width));
  const bottom = Math.min(height, Math.ceil(maskInput.y + maskInput.height));
  let processedPixels = 0;

  for (let y = top; y < bottom; y += 1) {
    const maskY = ((y + 0.5 - maskInput.y) / maskInput.height) * maskHeight - 0.5;
    for (let x = left; x < right; x += 1) {
      const alpha = sampleMaskAlpha(
        maskDecoded.data,
        maskWidth,
        maskHeight,
        maskChannels,
        ((x + 0.5 - maskInput.x) / maskInput.width) * maskWidth - 0.5,
        maskY
      );
      if (alpha <= 0.01) continue;
      processedPixels += 1;
      const strength = usingSource ? Math.min(0.82, alpha * 0.82) : Math.min(0.55, alpha * 0.55);
      const highGain = usingSource ? 1 : 1.55;
      const index = (y * width + x) * 4;
      const softIndex = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = decoded.data[index + channel];
        const low = resultBlur[softIndex + channel];
        const high = Math.max(-28, Math.min(28, sourceRgb[softIndex + channel] - sourceBlur[softIndex + channel]));
        const textured = clampByte(low + high * highGain);
        output[index + channel] = clampByte(base + (textured - base) * strength);
      }
    }
  }

  if (!processedPixels) throw new Error('没有有效的人脸处理区域，本轮未保存副本。');
  const buffer = await sharp(output, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return { buffer, width, height };
}

export async function writeFaceNaturalizationCopy(
  input: Buffer,
  filePath: string,
  maskInput: FaceNaturalizationMaskInput
): Promise<FaceNaturalizationFileResult> {
  if (!/\.png$/i.test(filePath)) throw new Error('面部自然化副本必须使用 PNG 扩展名。');
  const result = await applyFaceNaturalization(input, maskInput);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, result.buffer);
    const metadata = await sharp(await fs.readFile(temporaryPath)).metadata();
    if (metadata.format !== 'png' || metadata.width !== result.width || metadata.height !== result.height) {
      throw new Error('面部自然化副本保存后尺寸校验失败。');
    }
    await fs.rename(temporaryPath, filePath);
    return { ...result, filePath };
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}
