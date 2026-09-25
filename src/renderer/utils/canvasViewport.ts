export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface CanvasFitRect extends CanvasPoint, CanvasSize {}

export const canvasZoomRange = {
  min: 0.5,
  max: 3
} as const;

export function clampCanvasZoom(value: number) {
  return Math.max(canvasZoomRange.min, Math.min(canvasZoomRange.max, value));
}

export function fitImageInCanvas(
  canvas: CanvasSize,
  image: ImageSize,
  zoom = 1,
  offset: CanvasPoint = { x: 0, y: 0 }
): CanvasFitRect {
  if (canvas.width <= 0 || canvas.height <= 0 || image.width <= 0 || image.height <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const canvasRatio = canvas.width / canvas.height;
  const imageRatio = image.width / image.height;
  let width = canvas.width * zoom;
  let height = canvas.height * zoom;
  if (imageRatio > canvasRatio) {
    height = width / imageRatio;
  } else {
    width = height * imageRatio;
  }
  return {
    x: (canvas.width - width) / 2 + offset.x,
    y: (canvas.height - height) / 2 + offset.y,
    width,
    height
  };
}

export function clampCanvasOffset(
  offset: CanvasPoint,
  canvas: CanvasSize,
  image: ImageSize,
  zoom: number,
  visibleEdge = 48
) {
  const centered = fitImageInCanvas(canvas, image, zoom);
  const requiredX = Math.min(visibleEdge, centered.width / 2);
  const requiredY = Math.min(visibleEdge, centered.height / 2);
  return {
    x: Math.max(
      requiredX - centered.x - centered.width,
      Math.min(canvas.width - requiredX - centered.x, offset.x)
    ),
    y: Math.max(
      requiredY - centered.y - centered.height,
      Math.min(canvas.height - requiredY - centered.y, offset.y)
    )
  };
}

export function zoomCanvasAtPoint(
  anchor: CanvasPoint,
  canvas: CanvasSize,
  image: ImageSize,
  currentZoom: number,
  nextZoomValue: number,
  currentOffset: CanvasPoint
) {
  const nextZoom = clampCanvasZoom(nextZoomValue);
  const currentRect = fitImageInCanvas(canvas, image, currentZoom, currentOffset);
  const anchorRatio = {
    x: (anchor.x - currentRect.x) / currentRect.width,
    y: (anchor.y - currentRect.y) / currentRect.height
  };
  const nextCenteredRect = fitImageInCanvas(canvas, image, nextZoom);
  const offset = clampCanvasOffset(
    {
      x: anchor.x - nextCenteredRect.x - anchorRatio.x * nextCenteredRect.width,
      y: anchor.y - nextCenteredRect.y - anchorRatio.y * nextCenteredRect.height
    },
    canvas,
    image,
    nextZoom
  );
  return { zoom: nextZoom, offset };
}
