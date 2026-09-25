import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampCanvasOffset,
  clampCanvasZoom,
  fitImageInCanvas,
  zoomCanvasAtPoint
} from '../src/renderer/utils/canvasViewport.ts';

test('canvas viewport preserves the original aspect ratio while fitting', () => {
  const fit = fitImageInCanvas({ width: 800, height: 600 }, { width: 1600, height: 900 }, 1);
  assert.equal(fit.width, 800);
  assert.equal(fit.height, 450);
  assert.equal(fit.x, 0);
  assert.equal(fit.y, 75);
  assert.equal(fit.width / fit.height, 1600 / 900);
});

test('canvas viewport clamps zoom and keeps a visible recovery edge', () => {
  assert.equal(clampCanvasZoom(0.1), 0.5);
  assert.equal(clampCanvasZoom(5), 3);
  assert.deepEqual(
    clampCanvasOffset(
      { x: 5000, y: -5000 },
      { width: 800, height: 600 },
      { width: 1600, height: 900 },
      2
    ),
    { x: 1152, y: -702 }
  );
});

test('pointer anchored zoom keeps the same image point under the cursor', () => {
  const canvas = { width: 800, height: 600 };
  const image = { width: 1600, height: 900 };
  const anchor = { x: 240, y: 190 };
  const before = fitImageInCanvas(canvas, image, 1, { x: 0, y: 0 });
  const ratioBefore = {
    x: (anchor.x - before.x) / before.width,
    y: (anchor.y - before.y) / before.height
  };
  const result = zoomCanvasAtPoint(anchor, canvas, image, 1, 1.4, { x: 0, y: 0 });
  const after = fitImageInCanvas(canvas, image, result.zoom, result.offset);
  assert.ok(Math.abs((anchor.x - after.x) / after.width - ratioBefore.x) < 1e-9);
  assert.ok(Math.abs((anchor.y - after.y) / after.height - ratioBefore.y) < 1e-9);
});
