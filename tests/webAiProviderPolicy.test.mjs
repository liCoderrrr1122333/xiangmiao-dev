import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultWebAiUrls,
  normalizeWebAiProvider,
  resolveWebAiProviderModel,
  resolveWebAiProviderUrl,
  webAiProviderLabel
} from '../src/shared/webAiProviderPolicy.ts';

test('web AI provider defaults preserve the stable ChatGPT workflow', () => {
  assert.equal(normalizeWebAiProvider(undefined), 'chatgpt');
  assert.equal(normalizeWebAiProvider('unknown'), 'chatgpt');
  assert.equal(normalizeWebAiProvider('gemini'), 'gemini');
  assert.equal(webAiProviderLabel('chatgpt'), 'ChatGPT');
  assert.equal(webAiProviderLabel('gemini'), 'Gemini');
});

test('provider URL and model resolution stay isolated', () => {
  const settings = {
    chatGptUrl: 'https://chatgpt.com/',
    chatGptModel: 'GPT 5',
    geminiUrl: 'https://gemini.google.com/app',
    geminiModel: '3.1 Pro'
  };
  assert.equal(resolveWebAiProviderUrl('chatgpt', settings), settings.chatGptUrl);
  assert.equal(resolveWebAiProviderUrl('gemini', settings), settings.geminiUrl);
  assert.equal(resolveWebAiProviderModel('chatgpt', settings), settings.chatGptModel);
  assert.equal(resolveWebAiProviderModel('gemini', settings), settings.geminiModel);
  assert.equal(resolveWebAiProviderUrl('gemini', {}), defaultWebAiUrls.gemini);
});
