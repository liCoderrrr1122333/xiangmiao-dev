import type { GenerationProvider } from './generationProviderPolicy.js';

export const DOUBAO_ANALYSIS_MODELS = [
  { id: 'doubao-seed-2-1-pro-260915', label: 'Seed 2.1 Pro' },
  { id: 'doubao-seed-2-1-turbo-260628', label: 'Seed 2.1 Turbo' },
  { id: 'doubao-seed-2-1-lite-260915', label: 'Seed 2.1 Lite' },
  { id: 'doubao-seed-2-0-lite-260428', label: 'Seed 2.0 Lite' },
  { id: 'doubao-seed-2-0-mini-260428', label: 'Seed 2.0 Mini' }
] as const;

export type DoubaoAnalysisModel = (typeof DOUBAO_ANALYSIS_MODELS)[number]['id'];

export const DOUBAO_ANALYSIS_MODEL: DoubaoAnalysisModel = 'doubao-seed-2-1-pro-260915';
export const DOUBAO_ANALYSIS_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export function normalizeDoubaoAnalysisModel(value: unknown): DoubaoAnalysisModel {
  return DOUBAO_ANALYSIS_MODELS.some((item) => item.id === value)
    ? value as DoubaoAnalysisModel
    : DOUBAO_ANALYSIS_MODEL;
}

export type AnalysisProvider = 'chatgpt' | 'gemini' | 'ollama' | 'doubao';

export function normalizeAnalysisProvider(value: unknown): AnalysisProvider {
  if (value === 'gemini' || value === 'ollama' || value === 'doubao') {
    return value;
  }
  if (value === 'chatgpt') return value;
  return 'chatgpt';
}

export function analysisProviderLabel(provider: AnalysisProvider) {
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'ollama') return '本地模型';
  if (provider === 'doubao') return '豆包';
  return 'ChatGPT';
}

export function analysisRouteSummary(analysisProvider: AnalysisProvider, generationProvider: GenerationProvider) {
  const generationLabel = generationProvider === 'relay'
    ? '自由 API'
    : generationProvider === 'gemini' ? 'Gemini' : 'ChatGPT';
  return `${analysisProviderLabel(analysisProvider)}分析 → ${generationLabel} 做图`;
}
