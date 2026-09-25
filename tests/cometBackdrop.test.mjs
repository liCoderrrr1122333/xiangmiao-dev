import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production workbench omits continuous decorative background animation', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const cssSource = await readFile(new URL('../src/styles/glass-workbench.css', import.meta.url), 'utf8');

  assert.doesNotMatch(appSource, /CometBackdrop/);
  assert.doesNotMatch(cssSource, /two-axis grid|background-size:\s*48px 48px/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(cssSource, /:root\[data-motion="off"\]/);
});
