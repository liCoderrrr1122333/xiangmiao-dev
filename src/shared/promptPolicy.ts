import type { OutputMode, PromptResult, StoredOutputMode } from './types.js';

const currentModes = new Set<OutputMode>(['regional', 'custom']);
const storedModes = new Set<StoredOutputMode>(['regional', 'custom', 'compact', 'standard', 'strict']);

export function normalizeOutputMode(value: unknown): OutputMode {
  return currentModes.has(value as OutputMode) ? (value as OutputMode) : 'regional';
}

export function normalizeStoredOutputMode(value: unknown): StoredOutputMode {
  return storedModes.has(value as StoredOutputMode) ? (value as StoredOutputMode) : 'regional';
}

export function countPromptCharacters(text: string) {
  const zh = text.match(/[\u4e00-\u9fa5]/g)?.length || 0;
  const en = text.match(/[A-Za-z0-9]+/g)?.length || 0;
  return zh + en;
}

export function updatePromptDraftText(draft: PromptResult, promptText: string): PromptResult {
  return {
    ...draft,
    promptText,
    wordCount: countPromptCharacters(promptText),
    usedForSend: false
  };
}

export function createPromptSendSnapshot(draft: PromptResult, id: string, createdAt = new Date().toISOString()): PromptResult {
  return Object.freeze({
    ...draft,
    id,
    promptText: draft.promptText,
    checklist: [...draft.checklist],
    createdAt,
    usedForSend: true
  });
}
