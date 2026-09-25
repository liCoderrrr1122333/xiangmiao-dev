export type ChatGptNavigationKind =
  | 'google-oauth'
  | 'trusted-chatgpt'
  | 'blank'
  | 'external';

const trustedChatGptHosts = new Set([
  'chatgpt.com',
  'www.chatgpt.com',
  'auth.openai.com',
  'auth0.openai.com',
  'openai.com',
  'www.openai.com'
]);

export function classifyChatGptNavigation(rawUrl: string): ChatGptNavigationKind {
  const value = rawUrl.trim();
  if (!value || value === 'about:blank' || value.startsWith('chrome-error://')) return 'blank';

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      host === 'accounts.google.com' ||
      host.endsWith('.accounts.google.com') ||
      (host.endsWith('.google.com') &&
        (url.pathname.includes('/o/oauth') || url.searchParams.get('connection') === 'google'))
    ) {
      return 'google-oauth';
    }
    if (
      trustedChatGptHosts.has(host) ||
      host.endsWith('.chatgpt.com') ||
      host.endsWith('.openai.com')
    ) {
      return 'trusted-chatgpt';
    }
    return 'external';
  } catch {
    return 'blank';
  }
}

export interface ChatGptPageHealth {
  usable: boolean;
  blank: boolean;
  loginSurface: boolean;
  composerReady: boolean;
  manualIntervention: boolean;
}

export function isChatGptAuthenticationUrl(rawUrl: string) {
  if (classifyChatGptNavigation(rawUrl) === 'google-oauth') return true;
  try {
    const url = new URL(rawUrl);
    return ['auth.openai.com', 'auth0.openai.com'].includes(url.hostname) ||
      (classifyChatGptNavigation(rawUrl) === 'trusted-chatgpt' &&
        /^\/(auth|login|signin|signup|verify|challenge)(\/|$)/i.test(url.pathname));
  } catch { return false; }
}

export type ChatGptModelMode = 'explicit' | 'automatic';
export type ChatGptThinkingMode = 'levels' | 'toggle' | 'none';
export type ChatGptPageState = 'ready' | 'loading' | 'protected' | 'login-required';

export interface ChatGptPageCapabilityInput {
  composerReady: boolean;
  protected: boolean;
  loginRequired: boolean;
  explicitModelPicker: boolean;
  thinkingLevelPicker: boolean;
  thinkingToggle: boolean;
}

export interface ChatGptPageCapabilities {
  pageState: ChatGptPageState;
  modelMode: ChatGptModelMode;
  thinkingMode: ChatGptThinkingMode;
}

export function resolveChatGptModelDiscovery(input: {
  composerReady: boolean;
  explicitModelPicker: boolean;
  modelCount: number;
}) {
  if (input.composerReady && !input.explicitModelPicker) {
    return {
      ok: true,
      modelMode: 'automatic' as const,
      message: '当前账号使用 ChatGPT 自动模型；输入框可用，不需要模型选择器。'
    };
  }
  if (input.composerReady && input.explicitModelPicker && input.modelCount > 0) {
    return {
      ok: true,
      modelMode: 'explicit' as const,
      message: `已读取 ${input.modelCount} 个当前账号可用模型。`
    };
  }
  return {
    ok: false,
    modelMode: input.explicitModelPicker ? 'explicit' as const : 'automatic' as const,
    message: 'ChatGPT 页面仍在加载，请稍后重试。'
  };
}

export function classifyChatGptPageCapabilities(
  input: ChatGptPageCapabilityInput
): ChatGptPageCapabilities {
  const pageState: ChatGptPageState = input.protected
    ? 'protected'
    : input.loginRequired
      ? 'login-required'
      : input.composerReady
        ? 'ready'
        : 'loading';
  return {
    pageState,
    modelMode: input.explicitModelPicker ? 'explicit' : 'automatic',
    thinkingMode: input.thinkingLevelPicker
      ? 'levels'
      : input.thinkingToggle
        ? 'toggle'
        : 'none'
  };
}

export interface ChatGptLoginProbeSummary {
  loginText?: boolean;
  composerReady?: boolean;
  accountReady?: boolean;
  sessionAuthenticated?: boolean;
  sessionUnauthenticated?: boolean;
  authUrl?: boolean;
}

export function isConfirmedChatGptLogin(input?: ChatGptLoginProbeSummary) {
  if (!input) return false;
  if (input.sessionAuthenticated === true) return true;
  return input.composerReady === true && input.accountReady === true && input.loginText !== true;
}

export function isConfirmedChatGptLogout(input?: ChatGptLoginProbeSummary) {
  if (!input || input.sessionAuthenticated === true || input.loginText !== true) return false;
  return input.sessionUnauthenticated === true || input.authUrl === true;
}

export function canUseChatGptComposer(input?: ChatGptLoginProbeSummary) {
  return Boolean(input?.composerReady && !input?.loginText);
}

export function assessChatGptPageHealth(input: {
  url?: string;
  title?: string;
  bodyTextLength?: number;
  htmlLength?: number;
  loginSurface?: boolean;
  composerReady?: boolean;
  challengeVisible?: boolean;
}): ChatGptPageHealth {
  const navigation = classifyChatGptNavigation(input.url || '');
  const composerReady = input.composerReady === true;
  const loginSurface = input.loginSurface === true || navigation === 'google-oauth';
  const browserChallenge = input.challengeVisible === true ||
    (/just a moment|checking your browser|verify you are human|正在进行安全验证|正在验证/i.test(input.title || '') && !composerReady);
  const manualIntervention = browserChallenge || isChatGptAuthenticationUrl(input.url || '') || loginSurface;
  const hasRenderedBody = (input.bodyTextLength || 0) > 8;
  const hasDocument = hasRenderedBody || composerReady || loginSurface;
  const stalledChatGptShell =
    navigation === 'trusted-chatgpt' &&
    !hasRenderedBody &&
    !composerReady &&
    !loginSurface;
  const blank = !manualIntervention && (
    navigation === 'blank' ||
    stalledChatGptShell ||
    (!hasDocument && !composerReady && !loginSurface));
  return {
    usable: !blank && !browserChallenge && (hasDocument || composerReady || loginSurface),
    blank,
    loginSurface,
    composerReady,
    manualIntervention
  };
}
