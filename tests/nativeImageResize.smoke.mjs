import { app, nativeImage } from 'electron';

const [, , sourcePath, widthText, heightText] = process.argv;
const targetWidth = Number(widthText);
const targetHeight = Number(heightText);

if (!sourcePath || !Number.isInteger(targetWidth) || !Number.isInteger(targetHeight)) {
  throw new Error('Usage: electron tests/nativeImageResize.smoke.mjs <source> <width> <height>');
}

try {
  const source = nativeImage.createFromPath(sourcePath);
  if (source.isEmpty()) throw new Error(`Cannot decode source image: ${sourcePath}`);
  const sourceSize = source.getSize();
  const resized = source.resize({ width: targetWidth, height: targetHeight, quality: 'best' });
  const png = resized.toPNG();
  const verified = nativeImage.createFromBuffer(png);
  if (verified.isEmpty()) throw new Error('Cannot decode resized PNG.');
  const savedSize = verified.getSize();
  if (savedSize.width !== targetWidth || savedSize.height !== targetHeight) {
    throw new Error(`Dimension mismatch: ${savedSize.width}x${savedSize.height}`);
  }
  process.stdout.write(
    `${JSON.stringify({ source: sourceSize, target: { width: targetWidth, height: targetHeight }, verified: savedSize, pngBytes: png.length })}\n`
  );
} finally {
  app.exit(0);
}
