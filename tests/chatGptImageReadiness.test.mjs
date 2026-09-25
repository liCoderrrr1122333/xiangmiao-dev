import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  inspectGeneratedImageBuffer,
  nextGeneratedImageReadinessState
} from '../dist-electron/main/chatGptImageReadiness.js';

function makeGradient(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = (x * 13 + y * 7) % 256;
      pixels[offset + 1] = (x * 5 + y * 17) % 256;
      pixels[offset + 2] = (x * 19 + y * 3) % 256;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function makeWhite(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).png().toBuffer();
}

test('white same-size generation placeholder is rejected while a real image is accepted', async () => {
  const [white, real] = await Promise.all([makeWhite(1024, 1024), makeGradient(1024, 1024)]);
  const whiteReadiness = await inspectGeneratedImageBuffer(white);
  const realReadiness = await inspectGeneratedImageBuffer(real);

  assert.equal(whiteReadiness.ready, false);
  assert.equal(realReadiness.ready, true);
  assert.notEqual(whiteReadiness.contentHash, realReadiness.contentHash);
});

test('same-size canvas replacement must settle on the real pixel content twice', async () => {
  const [white, real] = await Promise.all([makeWhite(1024, 1024), makeGradient(1024, 1024)]);
  const whiteReadiness = await inspectGeneratedImageBuffer(white);
  const realReadiness = await inspectGeneratedImageBuffer(real);

  const placeholderState = nextGeneratedImageReadinessState(undefined, whiteReadiness, true);
  assert.equal(placeholderState.accepted, false);
  const firstRealState = nextGeneratedImageReadinessState(placeholderState, realReadiness, true);
  assert.equal(firstRealState.accepted, false);
  const secondRealState = nextGeneratedImageReadinessState(firstRealState, realReadiness, true);
  assert.equal(secondRealState.accepted, true);
  assert.equal(nextGeneratedImageReadinessState(secondRealState, realReadiness, false).accepted, false);
});
