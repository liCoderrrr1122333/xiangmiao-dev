export const RELAY_STANDARD_IMAGE_MODEL = 'gpt-image-2';
export const RELAY_BANANA_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

export type RelayImageModel =
  | typeof RELAY_STANDARD_IMAGE_MODEL
  | typeof RELAY_BANANA_IMAGE_MODEL;

export function normalizeRelayImageModel(value: string | undefined): RelayImageModel {
  return value === RELAY_BANANA_IMAGE_MODEL
    ? RELAY_BANANA_IMAGE_MODEL
    : RELAY_STANDARD_IMAGE_MODEL;
}

export function relayImageModelLabel(model: string) {
  return model === RELAY_BANANA_IMAGE_MODEL ? '香蕉生图' : model === RELAY_STANDARD_IMAGE_MODEL ? '标准图片' : model;
}
