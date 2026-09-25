import type {
  FaceLandmarker as FaceLandmarkerInstance,
  ImageSegmenter as ImageSegmenterInstance,
  NormalizedLandmark
} from '@mediapipe/tasks-vision';
import {
  buildFaceSkinAlphaMask,
  createFaceSilhouette,
  selectFaceOcclusionMask
} from '../../shared/faceOcclusionPolicy';
import type { FaceOcclusionMask, FaceOcclusionPoint, FaceOcclusionRaster, ImageAsset, MaskCircle } from '../../shared/types';
import { FACE_OCCLUSION_RGB } from './imageUtils';
import { mapFaceMaskToOriginal } from '../../shared/faceNaturalizationPolicy';

interface DetectionCrop {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FaceMaskRuntime {
  faceLandmarker: FaceLandmarkerInstance;
  imageSegmenter: ImageSegmenterInstance;
}

export interface FaceLandmarkMaskResult {
  mask: FaceOcclusionMask;
  detectedFaceCount: number;
  overlapRatio: number;
}

export interface FaceNaturalizationMaskResult {
  raster: FaceOcclusionRaster;
  detectedFaceCount: number;
}

let faceMaskRuntimePromise: Promise<FaceMaskRuntime> | undefined;

const ignoredMediaPipeDiagnostics = [
  'INFO: Created TensorFlow Lite XNNPACK delegate for CPU.',
  'face_landmarker_graph.cc:180',
  'gl_context.cc:1118',
  'inference_feedback_manager.cc:121'
];

function assetUrl(relativePath: string) {
  return new URL(`${import.meta.env.BASE_URL}face-landmarker/${relativePath}`, window.location.href).href;
}

async function withoutKnownMediaPipeDiagnostics<T>(operation: () => T | Promise<T>) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const forwardUnlessKnown =
    (forward: (...data: unknown[]) => void) =>
    (...data: unknown[]) => {
      const message = data.map(String).join(' ');
      if (ignoredMediaPipeDiagnostics.some((diagnostic) => message.includes(diagnostic))) return;
      forward(...data);
    };

  // MediaPipe emits routine CPU startup details through error/warn channels.
  console.error = forwardUnlessKnown(originalError);
  console.warn = forwardUnlessKnown(originalWarn);
  try {
    return await operation();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

async function createFaceMaskRuntime(): Promise<FaceMaskRuntime> {
  const { FaceLandmarker, FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
  const bundledAssets = await window.masklock?.loadFaceLandmarkerAssets();
  const wasmFileset = await FilesetResolver.forVisionTasks(assetUrl('wasm'));
  const faceLandmarker = await FaceLandmarker.createFromOptions(wasmFileset, {
    baseOptions: bundledAssets
      ? { modelAssetBuffer: new Uint8Array(bundledAssets.model), delegate: 'CPU' }
      : { modelAssetPath: assetUrl('face_landmarker.task'), delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 6,
    minFaceDetectionConfidence: 0.35,
    minFacePresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });

  try {
    const imageSegmenter = await ImageSegmenter.createFromOptions(wasmFileset, {
      baseOptions: bundledAssets
        ? { modelAssetBuffer: new Uint8Array(bundledAssets.segmenterModel), delegate: 'CPU' }
        : { modelAssetPath: assetUrl('selfie_multiclass_256x256.tflite'), delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false
    });
    return { faceLandmarker, imageSegmenter };
  } catch (error) {
    faceLandmarker.close();
    throw error;
  }
}

async function getFaceMaskRuntime() {
  if (!faceMaskRuntimePromise) {
    faceMaskRuntimePromise = createFaceMaskRuntime().catch((error) => {
      faceMaskRuntimePromise = undefined;
      console.error('Face occlusion runtime failed to initialize.', error);
      throw new Error('一键蒙脸组件加载失败，请重启软件后重试。');
    });
  }
  return faceMaskRuntimePromise;
}

function loadImage(asset: ImageAsset) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('主图加载失败，无法识别人脸。'));
    image.src = asset.dataUrl;
  });
}

function createDetectionCrop(image: HTMLImageElement, circle: MaskCircle, paddingFactor = 0.55): DetectionCrop {
  const paddingX = circle.width * paddingFactor;
  const paddingY = circle.height * paddingFactor;
  const left = Math.max(0, circle.x - circle.width / 2 - paddingX);
  const top = Math.max(0, circle.y - circle.height / 2 - paddingY);
  const right = Math.min(image.naturalWidth, circle.x + circle.width / 2 + paddingX);
  const bottom = Math.min(image.naturalHeight, circle.y + circle.height / 2 + paddingY);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const longestSide = Math.max(width, height);
  const scale = longestSide < 480 ? Math.min(5, 480 / longestSide) : longestSide > 1280 ? 1280 / longestSide : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('画布不可用，无法识别人脸。');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
  return { canvas, left, top, width, height };
}

function createFullImageDetectionCrop(image: HTMLImageElement): DetectionCrop {
  const width = Math.max(1, image.naturalWidth);
  const height = Math.max(1, image.naturalHeight);
  const longestSide = Math.max(width, height);
  const scale = longestSide < 480 ? Math.min(5, 480 / longestSide) : longestSide > 1280 ? 1280 / longestSide : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('画布不可用，无法识别人脸。');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
  return { canvas, left: 0, top: 0, width, height };
}

function pointsFromLandmarks(
  landmarks: NormalizedLandmark[],
  crop: DetectionCrop,
  image: HTMLImageElement
) {
  return landmarks
    .map((landmark) => ({
      x: Math.max(0, Math.min(image.naturalWidth, crop.left + landmark.x * crop.width)),
      y: Math.max(0, Math.min(image.naturalHeight, crop.top + landmark.y * crop.height))
    }));
}

function createRasterDataUrl(alpha: Uint8Array, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画布不可用，无法生成人脸遮挡。');
  const pixels = ctx.createImageData(width, height);
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] === 0) continue;
    const offset = index * 4;
    pixels.data[offset] = FACE_OCCLUSION_RGB[0];
    pixels.data[offset + 1] = FACE_OCCLUSION_RGB[1];
    pixels.data[offset + 2] = FACE_OCCLUSION_RGB[2];
    pixels.data[offset + 3] = alpha[index];
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function createCircleFallbackContour(circle: MaskCircle, pointCount = 48) {
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / pointCount;
    return {
      x: circle.x + Math.cos(angle) * circle.width * 0.49,
      y: circle.y + Math.sin(angle) * circle.height * 0.49
    };
  });
}

export async function detectFaceLandmarkMask(
  asset: ImageAsset,
  circle: MaskCircle
): Promise<FaceLandmarkMaskResult> {
  const [image, runtime] = await Promise.all([
    loadImage(asset),
    withoutKnownMediaPipeDiagnostics(() => getFaceMaskRuntime())
  ]);
  const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const ovalIndices = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map((connection) => connection.start);
  let crop = createDetectionCrop(image, circle);
  let contours: FaceOcclusionPoint[][] = [];
  let silhouettes: FaceOcclusionPoint[][] = [];
  let selection: ReturnType<typeof selectFaceOcclusionMask>;

  // The tight pass is fast and precise. A wider second pass gives profile,
  // partially circled and very small faces more surrounding context.
  for (const paddingFactor of [0.55, 1]) {
    crop = createDetectionCrop(image, circle, paddingFactor);
    await nextFrame();
    const landmarkResult = await withoutKnownMediaPipeDiagnostics(() => runtime.faceLandmarker.detect(crop.canvas));
    const landmarkPoints = landmarkResult.faceLandmarks.map((landmarks) =>
      pointsFromLandmarks(landmarks, crop, image)
    );
    contours = landmarkPoints.map((points) =>
      ovalIndices.map((index) => points[index]).filter((point): point is FaceOcclusionPoint => Boolean(point))
    );
    silhouettes = landmarkPoints.map(createFaceSilhouette);
    selection = selectFaceOcclusionMask(contours, circle);
    if (selection) break;
  }

  const hasLandmarkSelection = Boolean(selection);
  const selectedContour = hasLandmarkSelection
    ? silhouettes[selection!.selectedIndex]
    : createCircleFallbackContour(circle);
  const selectedFaceOval = hasLandmarkSelection ? contours[selection!.selectedIndex] : [];

  // A semantic-only pass keeps profile and partially hidden faces usable when
  // landmarks are unavailable. The red circle remains the hard boundary.
  if (!hasLandmarkSelection) {
    crop = createDetectionCrop(image, circle, 0.32);
  }

  await nextFrame();
  const segmentationResult = await withoutKnownMediaPipeDiagnostics(() => runtime.imageSegmenter.segment(crop.canvas));
  const categoryMask = segmentationResult.categoryMask;
  if (!categoryMask) {
    segmentationResult.close();
    throw new Error('没有取得可用的面部分割结果，请重新圈选脸部后重试。');
  }

  const maskWidth = categoryMask.width;
  const maskHeight = categoryMask.height;
  const categories = categoryMask.getAsUint8Array();
  const skinMask = buildFaceSkinAlphaMask(
    categories,
    maskWidth,
    maskHeight,
    crop,
    selectedContour,
    circle,
    selectedFaceOval,
    hasLandmarkSelection
  );
  segmentationResult.close();

  const faceCoverage =
    skinMask.eligiblePixelCount > 0 ? skinMask.facePixelCount / skinMask.eligiblePixelCount : 0;
  const minimumCoverage = hasLandmarkSelection ? 0.2 : 0.035;
  if (skinMask.facePixelCount < 48 || skinMask.seedPixelCount < 24 || faceCoverage < minimumCoverage) {
    throw new Error('红圈内未识别到可可靠遮挡的实际面部，请调整红圈后重试。');
  }

  return {
    mask: {
      points: selectedContour,
      raster: {
        dataUrl: createRasterDataUrl(skinMask.alpha, maskWidth, maskHeight),
        x: crop.left,
        y: crop.top,
        width: crop.width,
        height: crop.height
      }
    },
    detectedFaceCount: contours.length,
    overlapRatio: selection?.overlapRatio || 0
  };
}

export async function detectFaceNaturalizationMask(asset: ImageAsset): Promise<FaceNaturalizationMaskResult> {
  const [image, runtime] = await Promise.all([
    loadImage(asset),
    withoutKnownMediaPipeDiagnostics(() => getFaceMaskRuntime())
  ]);
  const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
  let crop = createFullImageDetectionCrop(image);
  await nextFrame();
  let landmarkResult = await withoutKnownMediaPipeDiagnostics(() => runtime.faceLandmarker.detect(crop.canvas));
  // The detector downsamples its input: a full-body face can disappear at that scale.
  // These bounded, overlapping crops retain the same confidence threshold.
  if (!landmarkResult.faceLandmarks.length) {
    for (const [x, y] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
      crop = createDetectionCrop(image, {
        x: image.naturalWidth * x,
        y: image.naturalHeight * y,
        width: image.naturalWidth * 0.6,
        height: image.naturalHeight * 0.6
      }, 0);
      await nextFrame();
      landmarkResult = await withoutKnownMediaPipeDiagnostics(() => runtime.faceLandmarker.detect(crop.canvas));
      if (landmarkResult.faceLandmarks.length) break;
    }
  }
  if (!landmarkResult.faceLandmarks.length) throw new Error('当前结果图没有识别到可处理的人脸。');

  const ovalIndices = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map((connection) => connection.start);
  const landmarkPoints = landmarkResult.faceLandmarks.map((landmarks) => pointsFromLandmarks(landmarks, crop, image));
  const contours = landmarkPoints.map((points) => createFaceSilhouette(points));
  const faceOvals = landmarkPoints.map((points) => ovalIndices.map((index) => points[index]).filter((point): point is FaceOcclusionPoint => Boolean(point)));

  await nextFrame();
  const segmentationResult = await withoutKnownMediaPipeDiagnostics(() => runtime.imageSegmenter.segment(crop.canvas));
  const categoryMask = segmentationResult.categoryMask;
  if (!categoryMask) {
    segmentationResult.close();
    throw new Error('没有取得可用的面部分割结果，请更换结果图后重试。');
  }
  const maskWidth = categoryMask.width;
  const maskHeight = categoryMask.height;
  const categories = new Uint8Array(categoryMask.getAsUint8Array());
  segmentationResult.close();

  const combinedAlpha = new Uint8Array(maskWidth * maskHeight);
  let acceptedFaceCount = 0;
  for (let faceIndex = 0; faceIndex < contours.length; faceIndex += 1) {
    const contour = contours[faceIndex];
    const faceOval = faceOvals[faceIndex];
    if (contour.length < 3 || faceOval.length < 3) continue;
    const minX = Math.min(...faceOval.map((point) => point.x));
    const maxX = Math.max(...faceOval.map((point) => point.x));
    const minY = Math.min(...faceOval.map((point) => point.y));
    const maxY = Math.max(...faceOval.map((point) => point.y));
    const circle = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      width: Math.max(16, (maxX - minX) * 1.12),
      height: Math.max(16, (maxY - minY) * 1.12)
    };
    const faceMask = buildFaceSkinAlphaMask(
      categories,
      maskWidth,
      maskHeight,
      crop,
      contour,
      circle,
      faceOval,
      false
    );
    if (faceMask.facePixelCount < 48 || faceMask.seedPixelCount < 24) continue;
    acceptedFaceCount += 1;
    for (let index = 0; index < combinedAlpha.length; index += 1) {
      if (faceMask.alpha[index] > combinedAlpha[index]) combinedAlpha[index] = faceMask.alpha[index];
    }
  }

  if (!acceptedFaceCount) throw new Error('没有识别到足够清晰的人脸皮肤区域，请更换结果图后重试。');
  return {
    raster: mapFaceMaskToOriginal({
      dataUrl: createRasterDataUrl(combinedAlpha, maskWidth, maskHeight),
      x: crop.left,
      y: crop.top,
      width: crop.width,
      height: crop.height
    }, { width: image.naturalWidth, height: image.naturalHeight }, { width: asset.width || image.naturalWidth, height: asset.height || image.naturalHeight }),
    detectedFaceCount: acceptedFaceCount
  };
}
