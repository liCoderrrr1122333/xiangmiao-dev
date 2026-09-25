import type { FaceOcclusionMask, FaceOcclusionPoint, MaskCircle } from './types.js';

export const FACE_SKIN_CATEGORY_INDEX = 3;
const BODY_SKIN_CATEGORY_INDEX = 2;
const HAIR_CATEGORY_INDEX = 1;
const CLOTHES_CATEGORY_INDEX = 4;
const OTHER_CATEGORY_INDEX = 5;

export interface FaceOcclusionSelection {
  mask: FaceOcclusionMask;
  selectedIndex: number;
  overlapRatio: number;
}

export interface FaceSegmentationCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FaceSkinAlphaMask {
  alpha: Uint8Array;
  eligiblePixelCount: number;
  facePixelCount: number;
  seedPixelCount: number;
}

function isFinitePoint(point: FaceOcclusionPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function cross(origin: FaceOcclusionPoint, left: FaceOcclusionPoint, right: FaceOcclusionPoint) {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

export function createFaceSilhouette(points: FaceOcclusionPoint[]) {
  const sorted = points
    .filter(isFinitePoint)
    .map((point) => ({ x: point.x, y: point.y }))
    .sort((left, right) => left.x - right.x || left.y - right.y)
    .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
  if (sorted.length <= 3) return sorted;

  const lower: FaceOcclusionPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: FaceOcclusionPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function isPointInsideMaskCircle(point: FaceOcclusionPoint, circle: MaskCircle) {
  if (circle.width <= 0 || circle.height <= 0) return false;
  const dx = (point.x - circle.x) / (circle.width / 2);
  const dy = (point.y - circle.y) / (circle.height / 2);
  return dx * dx + dy * dy <= 1;
}

function polygonArea(points: FaceOcclusionPoint[]) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

function isPointInsidePolygon(point: FaceOcclusionPoint, polygon: FaceOcclusionPoint[]) {
  let inside = false;
  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex++) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const crossesScanline = current.y > point.y !== previous.y > point.y;
    const intersectionX =
      ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || Number.EPSILON) +
      current.x;
    if (crossesScanline && point.x < intersectionX) inside = !inside;
  }
  return inside;
}

function keepLargestConnectedRegion(alpha: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(alpha.length);
  const queue = new Int32Array(alpha.length);
  let nextLabel = 1;
  let largestLabel = 0;
  let largestSize = 0;

  for (let start = 0; start < alpha.length; start += 1) {
    if (alpha[start] === 0 || labels[start] !== 0) continue;
    const label = nextLabel;
    nextLabel += 1;
    labels[start] = label;
    queue[0] = start;
    let readIndex = 0;
    let writeIndex = 1;

    while (readIndex < writeIndex) {
      const index = queue[readIndex];
      readIndex += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
          const neighborIndex = neighborY * width + neighborX;
          if (alpha[neighborIndex] === 0 || labels[neighborIndex] !== 0) continue;
          labels[neighborIndex] = label;
          queue[writeIndex] = neighborIndex;
          writeIndex += 1;
        }
      }
    }

    if (writeIndex > largestSize) {
      largestSize = writeIndex;
      largestLabel = label;
    }
  }

  for (let index = 0; index < alpha.length; index += 1) {
    if (labels[index] !== largestLabel) alpha[index] = 0;
  }
  return largestSize;
}

export function buildFaceSkinAlphaMask(
  categories: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  crop: FaceSegmentationCrop,
  contour: FaceOcclusionPoint[],
  circle: MaskCircle,
  faceOval: FaceOcclusionPoint[] = contour,
  allowBodySkinSeeds = true
): FaceSkinAlphaMask {
  if (
    maskWidth <= 0 ||
    maskHeight <= 0 ||
    categories.length < maskWidth * maskHeight ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    contour.length < 3
  ) {
    return { alpha: new Uint8Array(0), eligiblePixelCount: 0, facePixelCount: 0, seedPixelCount: 0 };
  }

  const alpha = new Uint8Array(maskWidth * maskHeight);
  const toMaskX = (x: number) => ((x - crop.left) / crop.width) * maskWidth;
  const toMaskY = (y: number) => ((y - crop.top) / crop.height) * maskHeight;
  const contourXs = contour.map((point) => toMaskX(point.x));
  const contourYs = contour.map((point) => toMaskY(point.y));
  const minX = Math.max(0, Math.floor(Math.min(...contourXs)));
  const maxX = Math.min(maskWidth - 1, Math.ceil(Math.max(...contourXs)));
  const minY = Math.max(0, Math.floor(Math.min(...contourYs)));
  const maxY = Math.min(maskHeight - 1, Math.ceil(Math.max(...contourYs)));
  let eligiblePixelCount = 0;
  let seedPixelCount = 0;

  for (let y = minY; y <= maxY; y += 1) {
    const imageY = crop.top + ((y + 0.5) / maskHeight) * crop.height;
    for (let x = minX; x <= maxX; x += 1) {
      const imagePoint = {
        x: crop.left + ((x + 0.5) / maskWidth) * crop.width,
        y: imageY
      };
      if (!isPointInsideMaskCircle(imagePoint, circle) || !isPointInsidePolygon(imagePoint, contour)) continue;

      const index = y * maskWidth + x;
      eligiblePixelCount += 1;
      const category = categories[index];
      const isBlockedCategory =
        category === HAIR_CATEGORY_INDEX ||
        category === CLOTHES_CATEGORY_INDEX ||
        category === OTHER_CATEGORY_INDEX;
      const isFaceSeed =
        category === FACE_SKIN_CATEGORY_INDEX ||
        (allowBodySkinSeeds && category === BODY_SKIN_CATEGORY_INDEX);

      if (isFaceSeed) seedPixelCount += 1;

      // The face oval is more reliable than coarse semantic segmentation for
      // eyes, eyebrows, lips, deep shadows and profile features. Keep those
      // facial details covered while still carving out detected hair/clothes.
      if (
        !isBlockedCategory &&
        (isFaceSeed || isPointInsidePolygon(imagePoint, faceOval))
      ) {
        alpha[index] = 255;
      }
    }
  }

  const facePixelCount = keepLargestConnectedRegion(alpha, maskWidth, maskHeight);
  return { alpha, eligiblePixelCount, facePixelCount, seedPixelCount };
}

export function selectFaceOcclusionMask(contours: FaceOcclusionPoint[][], circle: MaskCircle): FaceOcclusionSelection | undefined {
  if (circle.width <= 0 || circle.height <= 0) return undefined;
  const circleArea = Math.PI * (circle.width / 2) * (circle.height / 2);
  let best: (FaceOcclusionSelection & { score: number }) | undefined;

  contours.forEach((candidate, selectedIndex) => {
    const points = candidate.filter(isFinitePoint);
    if (points.length < 12) return;

    const center = points.reduce(
      (total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length }),
      { x: 0, y: 0 }
    );
    const centerDx = (center.x - circle.x) / (circle.width / 2);
    const centerDy = (center.y - circle.y) / (circle.height / 2);
    const centerDistance = Math.sqrt(centerDx * centerDx + centerDy * centerDy);
    const overlapRatio = points.filter((point) => isPointInsideMaskCircle(point, circle)).length / points.length;

    if (centerDistance > 1.2 && overlapRatio < 0.35) return;

    const areaRatio = Math.min(1.5, polygonArea(points) / Math.max(1, circleArea));
    const score = overlapRatio * 5 + Math.max(0, 1.5 - centerDistance) * 2 + areaRatio;
    if (!best || score > best.score) {
      best = {
        mask: { points },
        selectedIndex,
        overlapRatio,
        score
      };
    }
  });

  if (!best) return undefined;
  return {
    mask: best.mask,
    selectedIndex: best.selectedIndex,
    overlapRatio: best.overlapRatio
  };
}
