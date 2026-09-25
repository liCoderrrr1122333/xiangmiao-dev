import type { WebAiProvider } from './webAiProviderPolicy.js';

export type GenerationProvider = WebAiProvider | 'relay';

export function normalizeGenerationProvider(
  value: unknown,
  webProvider: WebAiProvider = 'chatgpt'
): GenerationProvider {
  if (value === 'relay' || value === 'gemini' || value === 'chatgpt') return value;
  return webProvider;
}

export function generationProviderLabel(provider: GenerationProvider) {
  if (provider === 'relay') return '自由 API';
  return provider === 'gemini' ? 'Gemini' : 'ChatGPT';
}

export function isWebGenerationProvider(provider: GenerationProvider): provider is WebAiProvider {
  return provider !== 'relay';
}
