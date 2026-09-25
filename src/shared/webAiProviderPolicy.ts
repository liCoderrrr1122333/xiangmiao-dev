export type WebAiProvider = 'chatgpt' | 'gemini';

export const defaultWebAiUrls = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app'
} as const satisfies Record<WebAiProvider, string>;

export const followCurrentWebAiModel = 'follow-current';

export function normalizeWebAiProvider(value: unknown): WebAiProvider {
  return value === 'gemini' ? 'gemini' : 'chatgpt';
}

export function webAiProviderLabel(provider: WebAiProvider) {
  return provider === 'gemini' ? 'Gemini' : 'ChatGPT';
}

export function resolveWebAiProviderUrl(
  provider: WebAiProvider,
  settings: Partial<{
    chatGptUrl: string;
    geminiUrl: string;
  }>
) {
  const configured = provider === 'gemini' ? settings.geminiUrl : settings.chatGptUrl;
  return configured?.trim() || defaultWebAiUrls[provider];
}

export function resolveWebAiProviderModel(
  provider: WebAiProvider,
  settings: Partial<{
    chatGptModel: string;
    geminiModel: string;
  }>
) {
  const configured = provider === 'gemini' ? settings.geminiModel : settings.chatGptModel;
  return configured?.trim() || followCurrentWebAiModel;
}
