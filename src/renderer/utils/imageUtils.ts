import { nanoid } from 'nanoid';
import type { FaceOcclusionMask, ImageAsset, MaskCircle } from '../../shared/types';
import { IMAGE_IMPORT_MAX_BYTES, isPotentialImageImport } from '../../shared/imageImportPolicy';

export const FACE_OCCLUSION_COLOR = '#17181d';
export const FACE_OCCLUSION_RGB = [23, 24, 29] as const;

export async function fileToImageAsset(file: File): Promise<ImageAsset> {
  if (!isPotentialImageImport(file.name, file.type)) {
    throw new Error(`${file.name || '所选文件'}：仅支持 JPG、JPEG、PNG、WebP、HEIC 和 HEIF 图片。`);
  }
  if (file.size > IMAGE_IMPORT_MAX_BYTES) {
    throw new Error(`${file.name || '所选图片'}：图片超过 25MB，请先在相册中缩小文件后再导入。`);
  }
  const api = window.xiangmao?.normalizeImageImport;
  if (!api) throw new Error('像锚图片导入服务未就绪，请完全退出软件后重新打开。');
  const result = await api({
    name: file.name,
    mimeType: file.type,
    data: new Uint8Array(await file.arrayBuffer())
  });
  if (!result.ok) throw new Error(result.error);
  return {
    id: nanoid(),
    ...result.image
  };
}

export async function filesToImageAssets(files: FileList | File[]) {
  const settled = await Promise.allSettled([...files].map(fileToImageAsset));
  const assets: ImageAsset[] = [];
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') assets.push(result.value);
    else errors.push(result.reason instanceof Error ? result.reason.message : '图片导入失败。');
  }
  return { assets, errors };
}

export function formatImageImportErrors(errors: string[]) {
  const visible = errors.slice(0, 3);
  const remaining = errors.length - visible.length;
  return `${visible.join('\n')}${remaining > 0 ? `\n另有 ${remaining} 张图片导入失败。` : ''}`;
}

export function readImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('图片加载失败。'));
    image.src = src;
  });
}

function drawContain(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  return { drawX, drawY, drawWidth, drawHeight, scale };
}

export async function createAnalysisImage(imageAsset: ImageAsset, circle?: MaskCircle, maxSide = 560, quality = 0.68) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('主图加载失败，无法进行 AI 分析。'));
    img.src = imageAsset.dataUrl;
  });

  if (circle) {
    const canvas = document.createElement('canvas');
    canvas.width = 1040;
    canvas.height = 640;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('画布不可用。');
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const full = drawContain(ctx, image, 24, 24, 680, 592);
    ctx.save();
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(255,45,45,0.55)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(
      full.drawX + circle.x * full.scale,
      full.drawY + circle.y * full.scale,
      (circle.width * full.scale) / 2,
      (circle.height * full.scale) / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();

    const expand = 1.55;
    const sourceW = Math.min(image.naturalWidth, Math.max(circle.width * expand, 160));
    const sourceH = Math.min(image.naturalHeight, Math.max(circle.height * expand, 160));
    const sourceX = Math.max(0, Math.min(image.naturalWidth - sourceW, circle.x - sourceW / 2));
    const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceH, circle.y - sourceH / 2));
    ctx.save();
    ctx.strokeStyle = 'rgba(255,45,45,0.74)';
    ctx.lineWidth = 2;
    ctx.strokeRect(736, 88, 280, 280);
    ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, 736, 88, 280, 280);
    ctx.strokeRect(736, 88, 280, 280);
    ctx.restore();

    ctx.fillStyle = '#e8eeee';
    ctx.font = '18px Microsoft YaHei, Segoe UI, sans-serif';
    ctx.fillText('全图构图与场景基准', 36, 54);
    ctx.fillText('红圈人脸特写', 736, 64);
    ctx.fillStyle = '#aeb8b7';
    ctx.font = '15px Microsoft YaHei, Segoe UI, sans-serif';
    ctx.fillText('请保持红圈外完全不变', 736, 404);
    ctx.fillText('分析头部角度、眼神、光影与真实肤质', 736, 432);
    return canvas.toDataURL('image/jpeg', quality);
  }

  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('画布不可用。');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function drawFaceOcclusion(
  ctx: CanvasRenderingContext2D,
  circle: MaskCircle,
  mask: FaceOcclusionMask | undefined,
  rasterImage: CanvasImageSource | undefined
) {
  if (!mask?.raster || !rasterImage) return;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(circle.x, circle.y, circle.width / 2, circle.height / 2, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    rasterImage,
    mask.raster.x,
    mask.raster.y,
    mask.raster.width,
    mask.raster.height
  );
  ctx.restore();
}

export async function renderRedCircleImage(mainImage: ImageAsset, circle: MaskCircle, faceOcclusionMask?: FaceOcclusionMask) {
  const loadImage = (src: string, errorMessage: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(errorMessage));
      img.src = src;
    });
  const [image, rasterImage] = await Promise.all([
    loadImage(mainImage.dataUrl, '主图加载失败，无法导出红圈图。'),
    faceOcclusionMask?.raster
      ? loadImage(faceOcclusionMask.raster.dataUrl, '人脸遮挡加载失败，无法导出红圈图。')
      : Promise.resolve(undefined)
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画布不可用。');
  ctx.drawImage(image, 0, 0);
  drawFaceOcclusion(ctx, circle, faceOcclusionMask, rasterImage);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(circle.x, circle.y, circle.width / 2, circle.height / 2, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#ff2d2d';
  ctx.lineWidth = Math.max(3, image.naturalWidth / 320);
  ctx.shadowColor = 'rgba(255,45,45,0.72)';
  ctx.shadowBlur = Math.max(8, image.naturalWidth / 150);
  ctx.stroke();
  ctx.restore();
  return canvas.toDataURL('image/png');
}
