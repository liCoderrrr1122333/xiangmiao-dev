import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appUrl = new URL('../src/App.tsx', import.meta.url);
const styleUrl = new URL('../src/styles/levitated-workbench.css', import.meta.url);

test('the 2.5D workbench visual layer is isolated and loaded after the base styles', async () => {
  const appSource = await readFile(appUrl, 'utf8');

  assert.match(
    appSource,
    /import '\.\/styles\/globals\.css';\s*import '\.\/styles\/levitated-workbench\.css';/
  );
  assert.match(appSource, /className="app levitated-workbench"/);
});

test('the levitated workbench keeps stable depth, responsive fit and motion fallback rules', async () => {
  const css = await readFile(styleUrl, 'utf8');

  assert.match(css, /--lift-shadow-panel:/);
  assert.match(css, /\.levitated-workbench \.panel \{[\s\S]*?box-shadow:/);
  assert.match(css, /@media \(min-width: 1180px\) and \(max-width: 1380px\)/);
  assert.match(css, /\.description-panel \.section-copy small \{[\s\S]*?text-overflow: ellipsis/);
  assert.match(css, /\.analysis-button \{[\s\S]*?flex: 0 0 auto/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:root\[data-motion="off"\][\s\S]*?animation: none/);
});

test('light surfaces preserve semantic actions and compact controls', async () => {
  const css = await readFile(styleUrl, 'utf8');

  assert.match(css, /button\.toolbar-primary/);
  assert.match(css, /button\.analysis-button/);
  assert.match(css, /\.batch-count-stepper input \{[\s\S]*?background: transparent/);
  assert.match(css, /:root\[data-theme="light"\] \.levitated-workbench \.modal \{/);
  assert.match(css, /:root\[data-theme="light"\] \.levitated-workbench \.settings-grid section \{/);
});

test('the new layer avoids unstable typography and oversized rounding', async () => {
  const css = await readFile(styleUrl, 'utf8');

  assert.doesNotMatch(css, /font-size:[^;]*(?:vw|clamp\()/);
  assert.doesNotMatch(css, /letter-spacing:\s*-/);
  assert.doesNotMatch(css, /border-radius:\s*(?:[1-9]\d+|\d{3,})px/);
  assert.doesNotMatch(css, /radial-gradient/);
  assert.doesNotMatch(css, /backdrop-filter:\s*blur/);
});
