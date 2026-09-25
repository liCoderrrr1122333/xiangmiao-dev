import type { GenerationProvider } from './generationProviderPolicy.js';

export type AnalysisProvider = 'chatgpt' | 'gemini' | 'ollama';

export function normalizeAnalysisProvider(value: unknown): AnalysisProvider {
  if (value === 'gemini' || value === 'ollama') {
    return value;
  }
  if (value === 'chatgpt') return value;
  return 'chatgpt';
}

export function analysisProviderLabel(provider: AnalysisProvider) {
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'ollama') return '本地模型';
  return 'ChatGPT';
}

export function analysisRouteSummary(analysisProvider: AnalysisProvider, generationProvider: GenerationProvider) {
  const generationLabel = generationProvider === 'relay'
    ? '自由 API'
    : generationProvider === 'gemini' ? 'Gemini' : 'ChatGPT';
  return `${analysisProviderLabel(analysisProvider)}分析 → ${generationLabel} 做图`;
}
