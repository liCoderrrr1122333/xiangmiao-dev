import type { WebPoseSuggestion } from './types.js';

function compactText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeWebPoseSuggestion(value: unknown): WebPoseSuggestion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { id?: unknown; title?: unknown; description?: unknown };
  const id = Number(candidate.id);
  const title = compactText(candidate.title, 40);
  const description = compactText(candidate.description, 320);
  if (!Number.isInteger(id) || id < 1 || id > 8 || title.length < 2 || description.length < 12) return undefined;
  return { id, title, description };
}

export function normalizeWebPoseSuggestions(value: unknown): WebPoseSuggestion[] | null {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { poses?: unknown }).poses)
      ? (value as { poses: unknown[] }).poses
      : null;
  if (!source || source.length !== 8) return null;

  const suggestions = source.map(normalizeWebPoseSuggestion);
  if (suggestions.some((item) => !item)) return null;

  const normalized = suggestions as WebPoseSuggestion[];
  if (new Set(normalized.map((item) => item.id)).size !== 8) return null;
  if (new Set(normalized.map((item) => `${item.title}\n${item.description}`)).size !== 8) return null;
  return normalized.sort((left, right) => left.id - right.id);
}

export function parseWebPoseSuggestions(text: string): WebPoseSuggestion[] | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  const candidate = firstObject >= 0 && lastObject > firstObject ? trimmed.slice(firstObject, lastObject + 1) : trimmed;
  try {
    return normalizeWebPoseSuggestions(JSON.parse(candidate));
  } catch {
    return null;
  }
}

export function webPoseSelectionSignature(suggestion?: WebPoseSuggestion) {
  if (!suggestion) return '';
  return JSON.stringify({ id: suggestion.id, title: suggestion.title.trim(), description: suggestion.description.trim() });
}
