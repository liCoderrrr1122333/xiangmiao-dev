import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildFaceSkinAlphaMask,
  createFaceSilhouette,
  FACE_SKIN_CATEGORY_INDEX,
  selectFaceOcclusionMask
} from '../src/shared/faceOcclusionPolicy.ts';

test('one-click face occlusion selects a face and masks only segmented face skin', async () => {
  const canvasSource = await readFile(new URL('../src/renderer/components/MainImageCanvas.tsx', import.meta.url), 'utf8');
  const imageUtilsSource = await readFile(new URL('../src/renderer/utils/imageUtils.ts', import.meta.url), 'utf8');
  const detectorSource = await readFile(new URL('../src/renderer/utils/faceLandmarkMask.ts', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const analysisSource = await readFile(new URL('../src/renderer/components/DescriptionPanel.tsx', import.meta.url), 'utf8');
  const promptSource = await readFile(new URL('../src/renderer/prompt/PromptBuilder.ts', import.meta.url), 'utf8');

  assert.match(canvasSource, /detectFaceLandmarkMask\(sourceImage, sourceCircle\)/);
  assert.match(canvasSource, /红圈用于选脸，仅用纯色遮挡识别出的实际面部/);
  assert.match(canvasSource, /drawFaceOcclusion/);
  assert.match(detectorSource, /FACE_LANDMARKS_FACE_OVAL/);
  assert.match(detectorSource, /createFaceSilhouette/);
  assert.match(detectorSource, /ImageSegmenter\.createFromOptions/);
  assert.match(detectorSource, /selfie_multiclass_256x256\.tflite/);
  assert.match(detectorSource, /FilesetResolver\.forVisionTasks\(assetUrl\('wasm'\)\)/);
  assert.doesNotMatch(detectorSource, /createObjectURL\([\s\S]*wasmLoader/);
  assert.doesNotMatch(detectorSource, /bundledAssets\.wasmLoader|bundledAssets\.wasmBinary/);
  const assetHandlerSource = mainSource.match(
    /registerTrustedIpcHandler\('face-landmarker:load-assets'[\s\S]*?registerTrustedIpcHandler\('settings:read'/
  )?.[0];
  assert.ok(assetHandlerSource);
  assert.doesNotMatch(assetHandlerSource, /readFile\([^\n]*vision_wasm_internal/);
  assert.match(detectorSource, /selectFaceOcclusionMask\(contours, circle\)/);
  assert.match(detectorSource, /buildFaceSkinAlphaMask/);
  assert.match(detectorSource, /for \(const paddingFactor of \[0\.55, 1\]\)/);
  assert.match(detectorSource, /createCircleFallbackContour/);
  assert.match(detectorSource, /const minimumCoverage = hasLandmarkSelection \? 0\.2 : 0\.035/);
  assert.match(detectorSource, /contours\[selection!\.selectedIndex\]/);
  assert.match(imageUtilsSource, /FACE_OCCLUSION_COLOR = '#17181d'/);
  assert.match(imageUtilsSource, /ctx\.clip\(\)[\s\S]*ctx\.drawImage\(/);
  assert.doesNotMatch(imageUtilsSource, /traceSmoothClosedPath/);
  assert.match(analysisSource, /createAnalysisImage\(project\.mainImage, project\.maskCircle/);
  assert.doesNotMatch(analysisSource, /faceOcclusionEnabled/);
  assert.match(promptSource, /红圈主垫图/);
  assert.match(promptSource, /没有红圈、纯色蒙脸遮挡、红色描边或其他标记/);
});

test('face silhouette includes a profile nose outside the front-face oval', () => {
  const silhouette = createFaceSilhouette([
    { x: 40, y: 10 },
    { x: 58, y: 25 },
    { x: 55, y: 55 },
    { x: 35, y: 68 },
    { x: 20, y: 54 },
    { x: 8, y: 38 },
    { x: 2, y: 31 },
    { x: 12, y: 24 },
    { x: 32, y: 32 },
    { x: 40, y: 42 }
  ]);

  assert.ok(silhouette.some((point) => point.x === 2 && point.y === 31));
  assert.equal(Math.min(...silhouette.map((point) => point.x)), 2);
  assert.ok(silhouette.length >= 6);
});

test('face selection chooses the contour that belongs to the red circle', () => {
  const contour = (centerX, centerY, radiusX, radiusY) =>
    Array.from({ length: 16 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 16;
      return { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY };
    });
  const selection = selectFaceOcclusionMask(
    [contour(180, 180, 25, 32), contour(60, 55, 24, 30)],
    { x: 60, y: 60, width: 90, height: 100 }
  );

  assert.equal(selection?.selectedIndex, 1);
  assert.ok((selection?.overlapRatio || 0) > 0.8);
});

test('face mask fills facial features while excluding hair, clothes and other pixels', () => {
  const width = 6;
  const height = 6;
  const categories = new Uint8Array(width * height);
  const faceIndex = 2 * width + 2;
  const faceIndex2 = 2 * width + 1;
  const faceIndex3 = 3 * width + 2;
  const hairIndex = 2 * width + 3;
  const clothesIndex = 3 * width + 1;
  const accessoryIndex = 3 * width + 3;
  const isolatedFalsePositiveIndex = 4 * width + 4;
  const eyeGapIndex = 1 * width + 1;
  categories[faceIndex] = FACE_SKIN_CATEGORY_INDEX;
  categories[faceIndex2] = FACE_SKIN_CATEGORY_INDEX;
  categories[faceIndex3] = FACE_SKIN_CATEGORY_INDEX;
  categories[hairIndex] = 1;
  categories[clothesIndex] = 4;
  categories[accessoryIndex] = 5;
  categories[isolatedFalsePositiveIndex] = FACE_SKIN_CATEGORY_INDEX;

  const result = buildFaceSkinAlphaMask(
    categories,
    width,
    height,
    { left: 0, top: 0, width: 60, height: 60 },
    [
      { x: 5, y: 5 },
      { x: 55, y: 5 },
      { x: 55, y: 55 },
      { x: 5, y: 55 }
    ],
    { x: 30, y: 30, width: 58, height: 58 },
    [
      { x: 8, y: 8 },
      { x: 38, y: 8 },
      { x: 38, y: 38 },
      { x: 8, y: 38 }
    ]
  );

  assert.equal(result.alpha[faceIndex], 255);
  assert.equal(result.alpha[faceIndex2], 255);
  assert.equal(result.alpha[faceIndex3], 255);
  assert.equal(result.alpha[eyeGapIndex], 255);
  assert.equal(result.alpha[hairIndex], 0);
  assert.equal(result.alpha[clothesIndex], 0);
  assert.equal(result.alpha[accessoryIndex], 0);
  assert.equal(result.alpha[isolatedFalsePositiveIndex], 0);
  assert.equal(result.seedPixelCount, 4);
  assert.ok(result.facePixelCount > result.seedPixelCount);
  assert.ok(result.eligiblePixelCount > result.facePixelCount);
});

test('semantic-only fallback excludes body skin when landmarks are unavailable', () => {
  const width = 6;
  const height = 6;
  const categories = new Uint8Array(width * height);
  const faceIndex = 2 * width + 2;
  const faceIndex2 = 2 * width + 3;
  const bodyIndex = 3 * width + 2;
  categories[faceIndex] = FACE_SKIN_CATEGORY_INDEX;
  categories[faceIndex2] = FACE_SKIN_CATEGORY_INDEX;
  categories[bodyIndex] = 2;

  const result = buildFaceSkinAlphaMask(
    categories,
    width,
    height,
    { left: 0, top: 0, width: 60, height: 60 },
    [
      { x: 1, y: 1 },
      { x: 59, y: 1 },
      { x: 59, y: 59 },
      { x: 1, y: 59 }
    ],
    { x: 30, y: 30, width: 58, height: 58 },
    [],
    false
  );

  assert.equal(result.alpha[faceIndex], 255);
  assert.equal(result.alpha[faceIndex2], 255);
  assert.equal(result.alpha[bodyIndex], 0);
});

test('wardrobe panel exposes one upload entry and keeps per-item clothing/accessory classification', async () => {
  const source = await readFile(new URL('../src/renderer/components/WardrobeReferencePanel.tsx', import.meta.url), 'utf8');

  assert.match(source, /id="wardrobe-upload-input"/);
  assert.match(source, /上传参考图/);
  assert.doesNotMatch(source, /clothing-upload-input|accessory-upload-input|添加衣物|添加配饰/);
  assert.match(source, /setKind\(reference\.id, 'clothing'\)/);
  assert.match(source, /setKind\(reference\.id, 'accessory'\)/);
});
