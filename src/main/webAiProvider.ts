import type {
  ChatGptLoginStatus,
  ChatGptModelCatalog,
  ChatGptWindowActionResult
} from '../shared/types.js';
import type { WebAiProvider } from '../shared/webAiProviderPolicy.js';

export interface WebAiProviderAdapter<
  TConversation = unknown,
  TBaseline = unknown,
  TTextResult = unknown,
  TImageResult = unknown,
  TDownloadedResult = unknown
> {
  readonly provider: WebAiProvider;
  ensureReady(): Promise<unknown>;
  checkLogin(): Promise<ChatGptLoginStatus>;
  showWindow(): Promise<ChatGptWindowActionResult>;
  listModels(): Promise<ChatGptModelCatalog>;
  selectModel(conversation: TConversation, model: string): Promise<ChatGptModelCatalog>;
  createConversation(): Promise<TConversation>;
  uploadAttachments(conversation: TConversation, files: string[]): Promise<unknown>;
  sendPrompt(conversation: TConversation, prompt: string): Promise<unknown>;
  confirmMessageAccepted(conversation: TConversation, baseline: TBaseline): Promise<unknown>;
  waitForTextResult(conversation: TConversation, baseline: TBaseline): Promise<TTextResult>;
  waitForImageResult(conversation: TConversation, baseline: TBaseline): Promise<TImageResult>;
  classifyFailure(message: string): unknown;
  downloadResult(conversation: TConversation, result: TImageResult): Promise<TDownloadedResult>;
  cleanupConversation(conversation: TConversation): Promise<unknown>;
}

export type WebAiControlAdapter = Pick<
  WebAiProviderAdapter,
  'provider' | 'ensureReady' | 'checkLogin' | 'showWindow' | 'listModels'
>;
