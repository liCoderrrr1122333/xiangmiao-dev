import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveMainWindowBounds } from '../dist-electron/main/windowLayoutPolicy.js';

test('main window fills the active display work area without crossing its bounds', () => {
  const cases = [
    { workArea: { x: 0, y: 0, width: 1024, height: 600 }, minimumRatio: 1 },
    { workArea: { x: 0, y: 0, width: 1366, height: 728 }, minimumRatio: 0.94 },
    { workArea: { x: 1920, y: 0, width: 2560, height: 1400 }, minimumRatio: 0.9 },
    { workArea: { x: -3840, y: 0, width: 3840, height: 2080 }, minimumRatio: 0.9 }
  ];

  for (const { workArea, minimumRatio } of cases) {
    const bounds = resolveMainWindowBounds(workArea);
    assert.ok(bounds.width / workArea.width >= minimumRatio);
    assert.ok(bounds.height / workArea.height >= minimumRatio);
    assert.ok(bounds.x >= workArea.x);
    assert.ok(bounds.y >= workArea.y);
    assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
    assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
  }
});

test('main image canvas follows its rendered wrapper instead of a fixed panel subtraction', async () => {
  const source = await readFile(new URL('../src/renderer/components/MainImageCanvas.tsx', import.meta.url), 'utf8');
  assert.match(source, /new ResizeObserver\(scheduleMeasure\)/);
  assert.match(source, /canvasWrap\.clientWidth - horizontalPadding/);
  assert.match(source, /canvasWrap\.clientHeight - verticalPadding/);
  assert.doesNotMatch(source, /box\.height - 104/);
  assert.match(source, /ref=\{canvasWrapRef\}/);
});

test('adaptive desktop columns reserve the expanding remainder for the original canvas', async () => {
  const css = await readFile(new URL('../src/styles/hallmark-workbench.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /grid-template-columns: minmax\(500px, 1fr\) clamp\(330px, 23vw, 500px\) clamp\(360px, 25vw, 540px\)/
  );
  assert.match(css, /min-height: clamp\(510px, 66dvh, 1180px\)/);
  assert.match(css, /@media \(min-width: 1180px\) and \(max-height: 760px\)[\s\S]*grid-template-columns: repeat\(11, 28px\)/);
  assert.match(css, /@media \(min-width: 1180px\) and \(max-height: 760px\)[\s\S]*margin-left: 10px/);
  assert.match(css, /@media \(max-width: 1179px\)[\s\S]*min-height: clamp\(450px, 72dvh, 800px\)/);
});
