import type { ChatGptModelOption } from '../shared/types.js';

export type GeminiNavigationKind =
  | 'google-oauth'
  | 'trusted-gemini'
  | 'blank'
  | 'external';

export const geminiDomPolicy = {
  composerAriaPattern: String.raw`(?:为\s*Gemini\s*输入提示|向\s*Gemini\s*提问|问问\s*Gemini|enter a prompt|ask gemini|prompt gemini)` ,
  uploadAriaPattern: String.raw`(?:上传和工具|添加文件|打开上传菜单|添加附件|upload and tools|add files|upload files?|open upload|add attachment)`,
  uploadButtonTestIdPattern: String.raw`(?:upload-(?:button|menu|trigger)|attachment-(?:button|menu|trigger)|add-file)`,
  uploadMenuTestIdPattern: String.raw`(?:local-images-files-uploader-button|uploader-local|file-uploader|upload-from-device)`,
  modelButtonTestIdPattern: String.raw`(?:bard-mode-menu-button|model-(?:selector|picker|switcher))`,
  modelButtonAriaPattern: String.raw`(?:打开模式选择器|当前模式|选择模型|mode selector|current mode|choose model|select model)`,
  modelButtonTextPattern: String.raw`^(?:\d+(?:\.\d+)*\s+)?(?:flash(?:-lite)?|pro|thinking|扩展思考|深度思考|智能|快速)(?:\s*[⌄▼▾])?$`,
  excludedModelOptionPattern: String.raw`(?:登录即可|sign in|upgrade|订阅|subscription|learn more|了解详情)`,
  loginPattern: String.raw`^(?:登录|sign in|log in)$`,
  newChatPattern: String.raw`(?:发起新对话|新对话|new chat)`
} as const;

export function classifyGeminiNavigation(rawUrl: string): GeminiNavigationKind {
  const value = rawUrl.trim();
  if (!value || value === 'about:blank' || value.startsWith('chrome-error://')) return 'blank';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === 'accounts.google.com' || host.endsWith('.accounts.google.com')) return 'google-oauth';
    if (host === 'gemini.google.com' || host.endsWith('.gemini.google.com')) return 'trusted-gemini';
    return 'external';
  } catch {
    return 'blank';
  }
}

export interface GeminiLoginProbeSummary {
  composerReady?: boolean;
  accountReady?: boolean;
  loginVisible?: boolean;
  authUrl?: boolean;
  regionBlocked?: boolean;
}

export function isConfirmedGeminiLogin(input?: GeminiLoginProbeSummary) {
  return Boolean(input?.composerReady && input.accountReady && !input.loginVisible && !input.authUrl && !input.regionBlocked);
}

export function isConfirmedGeminiLogout(input?: GeminiLoginProbeSummary) {
  if (!input || input.accountReady) return false;
  return input.authUrl === true || input.loginVisible === true;
}

export function assessGeminiPageHealth(input: {
  url?: string;
  title?: string;
  bodyTextLength?: number;
  composerReady?: boolean;
  loginVisible?: boolean;
  regionBlocked?: boolean;
}) {
  const navigation = classifyGeminiNavigation(input.url || '');
  const composerReady = input.composerReady === true;
  const loginSurface = navigation === 'google-oauth' || input.loginVisible === true;
  const serviceBlocked = input.regionBlocked === true;
  const browserChallenge =
    /just a moment|checking your browser|please wait|请稍候|正在验证/i.test(input.title || '') &&
    !composerReady &&
    !loginSurface;
  const hasRenderedBody = (input.bodyTextLength || 0) > 8;
  const blank =
    navigation === 'blank' ||
    browserChallenge ||
    (navigation === 'trusted-gemini' && !hasRenderedBody && !composerReady && !loginSurface);
  return {
    usable: !blank && !serviceBlocked && (hasRenderedBody || composerReady || loginSurface),
    blank,
    loginSurface,
    serviceBlocked,
    composerReady
  };
}

export function parseGeminiModelOptionLabel(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^(?:已选中|selected)$/i.test(line));
  if (!lines[0] || new RegExp(geminiDomPolicy.excludedModelOptionPattern, 'i').test(lines.join(' '))) {
    return undefined;
  }
  return {
    label: lines[0],
    description: lines.slice(1).join(' ')
  };
}

export function normalizeGeminiModelLabel(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function normalizeGeminiModelIdentity(value: string) {
  return normalizeGeminiModelLabel(value).replace(/^\d+(?:\.\d+)*\s+/, '');
}

export function isSameGeminiModel(left: string, right: string) {
  const normalizedLeftLabel = normalizeGeminiModelLabel(left);
  const normalizedRightLabel = normalizeGeminiModelLabel(right);
  if (normalizedLeftLabel === normalizedRightLabel) return Boolean(normalizedLeftLabel);
  const leftHasVersion = /^\d+(?:\.\d+)*\s+/.test(normalizedLeftLabel);
  const rightHasVersion = /^\d+(?:\.\d+)*\s+/.test(normalizedRightLabel);
  if (leftHasVersion && rightHasVersion) return false;
  const normalizedLeft = normalizeGeminiModelIdentity(left);
  const normalizedRight = normalizeGeminiModelIdentity(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function dedupeGeminiModelOptions(options: ChatGptModelOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = normalizeGeminiModelLabel(option.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
