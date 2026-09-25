import type { FaceNaturalizationRaster } from './types.js';

export function mapFaceMaskToOriginal(
  raster: FaceNaturalizationRaster,
  preview: { width: number; height: number },
  original: { width: number; height: number }
): FaceNaturalizationRaster {
  if (![preview.width, preview.height, original.width, original.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('面部自然化的图片尺寸无效。');
  }
  const scaleX = original.width / preview.width;
  const scaleY = original.height / preview.height;
  if (Math.abs(scaleX / scaleY - 1) > 0.005) throw new Error('预览与原图比例不一致，已停止处理以免修错位置。');
  return { ...raster, x: raster.x * scaleX, y: raster.y * scaleY, width: raster.width * scaleX, height: raster.height * scaleY };
}
