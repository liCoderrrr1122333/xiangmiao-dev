export type ImageImportFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'heif';

export const IMAGE_IMPORT_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif';
export const IMAGE_IMPORT_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_IMPORT_MAX_PIXELS = 120_000_000;

const mimeFormats: Record<string, ImageImportFormat> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/heic-sequence': 'heic',
  'image/heif-sequence': 'heif'
};

const extensionFormats: Record<string, ImageImportFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  heic: 'heic',
  heif: 'heif'
};

export function detectImageImportFormat(name: string, mimeType: string): ImageImportFormat | undefined {
  const normalizedMime = String(mimeType || '').trim().toLowerCase().split(';')[0];
  const mimeFormat = mimeFormats[normalizedMime];
  if (mimeFormat) return mimeFormat;
  const extension = String(name || '').trim().toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
  return extensionFormats[extension];
}

export function isPotentialImageImport(name: string, mimeType: string) {
  return Boolean(detectImageImportFormat(name, mimeType));
}

export function imageImportMimeType(format: ImageImportFormat) {
  if (format === 'jpeg') return 'image/jpeg';
  return `image/${format}`;
}

