import type { ChatGptModelCatalog } from '../shared/types.js';
import { followCurrentWebAiModel } from '../shared/webAiProviderPolicy.js';
import type { ChatGptWebContentsLike } from './chromeChatGpt.js';
import {
  dedupeGeminiModelOptions,
  geminiDomPolicy,
  isConfirmedGeminiLogin,
  isSameGeminiModel,
  normalizeGeminiModelLabel,
  parseGeminiModelOptionLabel,
  type GeminiLoginProbeSummary
} from './geminiBrowserPolicy.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pageScript<TArgs extends unknown[]>(fn: (...args: TArgs) => unknown, ...args: TArgs) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

export interface GeminiPageProbe extends GeminiLoginProbeSummary {
  url: string;
  title: string;
  bodyTextLength: number;
  composerReady: boolean;
  accountReady: boolean;
  loginVisible: boolean;
  authUrl: boolean;
  busy: boolean;
  regionBlocked: boolean;
}

function geminiProbeScript() {
  return pageScript((policy: typeof geminiDomPolicy): GeminiPageProbe => {
    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const normalized = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
    const composerPattern = new RegExp(policy.composerAriaPattern, 'i');
    const loginPattern = new RegExp(policy.loginPattern, 'i');
    const bodyText = normalized(document.body?.innerText);
    const regionBlocked = /(?:暂不|尚不|不).{0,12}支持.{0,12}(?:地区|区域|国家)|not (?:available|supported).{0,20}(?:region|country)|unsupported region/i.test(bodyText);
    const composerReady = !regionBlocked && [...document.querySelectorAll('[role="textbox"],[contenteditable="true"],textarea')]
      .some((element) => visible(element) && composerPattern.test(normalized(element.getAttribute('aria-label'))));
    const loginVisible = [...document.querySelectorAll('button,a,[role="button"]')]
      .some((element) => visible(element) && loginPattern.test(normalized(element.textContent || element.getAttribute('aria-label'))));
    const accountReady = [...document.querySelectorAll('a,button,[role="button"]')].some((element) => {
      if (!visible(element)) return false;
      const marker = normalized(`${element.getAttribute('aria-label')} ${element.getAttribute('data-ogsr-up')} ${element.getAttribute('data-test-id')}`);
      return /(?:google account|google 账号|google 帳戶|管理您的 google|manage your google)/i.test(marker);
    });
    const busy = [...document.querySelectorAll('button,[role="button"]')].some((element) => {
      if (!visible(element)) return false;
      const marker = normalized(`${element.getAttribute('aria-label')} ${element.textContent}`);
      return /(?:停止回答|停止生成|stop response|stop generating)/i.test(marker);
    });
    return {
      url: location.href,
      title: document.title,
      bodyTextLength: bodyText.length,
      composerReady,
      accountReady,
      loginVisible,
      authUrl: location.hostname === 'accounts.google.com' || location.hostname.endsWith('.accounts.google.com'),
      busy,
      regionBlocked
    };
  }, geminiDomPolicy);
}

export async function probeGeminiPage(webContents: ChatGptWebContentsLike) {
  return webContents.executeJavaScript<GeminiPageProbe>(geminiProbeScript(), true);
}

export async function waitForGeminiPage(
  webContents: ChatGptWebContentsLike,
  timeoutMs = 20_000
) {
  const startedAt = Date.now();
  let last: GeminiPageProbe | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      last = await probeGeminiPage(webContents);
      if (last.authUrl || last.loginVisible || last.regionBlocked || (last.composerReady && last.accountReady)) return last;
    } catch {
      // Gemini can replace its Angular shell while hydrating; retry within the bounded window.
    }
    await wait(500);
  }
  return last;
}

function geminiModelMenuScript(requestedModel = '') {
  return pageScript(async (
    requested: string,
    followCurrent: string,
    policy: typeof geminiDomPolicy
  ) => {
    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return !html.hasAttribute('disabled') && html.getAttribute('aria-disabled') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
    const composerPattern = new RegExp(policy.composerAriaPattern, 'i');
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => visible(element) && composerPattern.test(normalize(element.getAttribute('aria-label'))));
    const sharesComposerSurface = (element: Element) => {
      let ancestor = composer?.parentElement;
      for (let depth = 0; ancestor && ancestor !== document.body && depth < 6; depth += 1) {
        if (ancestor.contains(element)) return true;
        ancestor = ancestor.parentElement;
      }
      if (!composer) return false;
      const composerRect = composer.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      return elementRect.bottom >= composerRect.top - 24 && elementRect.top <= composerRect.bottom + 24;
    };
    const textPattern = new RegExp(policy.modelButtonTextPattern, 'i');
    const excludedTrigger = /(?:上传|附件|发送|麦克风|语音|账号|账户|升级|upload|attach|send|microphone|voice|account|upgrade)/i;
    const trigger = [...document.querySelectorAll('button,[role="button"],[data-test-id]')]
      .filter(visible)
      .map((element) => {
      const testId = normalize(element.getAttribute('data-test-id'));
      const marker = normalize(`${element.getAttribute('aria-label')} ${element.textContent}`);
        const text = normalize(element.textContent);
        const score =
          (new RegExp(policy.modelButtonTestIdPattern, 'i').test(testId) ? 120 : 0) +
          (new RegExp(policy.modelButtonAriaPattern, 'i').test(marker) ? 100 : 0) +
          (textPattern.test(text) ? 55 : 0) +
          (sharesComposerSurface(element) ? 45 : 0) -
          (excludedTrigger.test(marker) ? 180 : 0);
        return { element: element as HTMLElement, score };
      })
      .filter((candidate) => candidate.score >= 90)
      .sort((left, right) => right.score - left.score)[0]?.element;
    if (!trigger) return { triggerFound: false, currentModel: '', options: [], selected: false };
    const triggerText = normalize(trigger.textContent).replace(/[⌄▼▾]\s*$/, '').trim();
    const triggerAria = normalize(trigger.getAttribute('aria-label'));
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    const excluded = new RegExp(policy.excludedModelOptionPattern, 'i');
    const controlledId = trigger.getAttribute('aria-controls');
    const controlledRoot = controlledId ? document.getElementById(controlledId) : null;
    const optionSelector = [
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="option"]',
      '[data-model]',
      'button[mat-menu-item]',
      'button.mat-mdc-menu-item',
      'button[class*="model-option"]',
      '[data-test-id*="model-option"]',
      '[data-test-id*="mode-option"]'
    ].join(',');
    const overlayRoots = controlledRoot
      ? [controlledRoot]
      : [...document.querySelectorAll<HTMLElement>(
          '[role="menu"],[role="listbox"],.cdk-overlay-pane,.mat-mdc-menu-panel,.mat-mdc-menu-content,[class*="model-menu"],[class*="mode-menu"]'
        )].filter(visible);
    const candidates = [...new Set(
      (overlayRoots.length ? overlayRoots : [document.body])
        .flatMap((root) => [...root.querySelectorAll(optionSelector)])
    )];
    const menuItems = candidates
      .filter(visible)
      .map((element, index) => {
        const renderedLines = ((element as HTMLElement).innerText || element.textContent || '')
          .split(/\r?\n/)
          .map(normalize)
          .filter(Boolean);
        const leafLines = [...element.querySelectorAll<HTMLElement>('*')]
          .filter((child) => child.children.length === 0)
          .map((child) => normalize(child.innerText || child.textContent))
          .filter((value, childIndex, values) => Boolean(value) && values.indexOf(value) === childIndex);
        const dataModel = normalize(element.getAttribute('data-model'));
        const text = dataModel
          ? [dataModel, ...leafLines.filter((value) => value !== dataModel)]
          : renderedLines.length > 1
            ? renderedLines
            : leafLines.length > 1
              ? leafLines
              : renderedLines;
        return {
          element: element as HTMLElement,
          id: element.getAttribute('data-test-id') || element.id || `gemini-model-${index + 1}`,
          text,
          marker: normalize(`${element.getAttribute('aria-label')} ${element.textContent}`),
          current:
            element.getAttribute('aria-checked') === 'true' ||
            element.getAttribute('aria-selected') === 'true' ||
            element.getAttribute('data-selected') === 'true' ||
            element.getAttribute('data-state') === 'checked' ||
            /(?:^|\s)(?:selected|checked)(?:\s|$)/i.test(element.getAttribute('class') || '') ||
            Boolean(element.querySelector('[aria-label="已选中"],[aria-label="selected"],[data-state="checked"],[data-selected="true"],mat-pseudo-checkbox[class*="checked"]'))
        };
      })
      .filter((item) => item.text[0] && !excluded.test(item.marker));
    let selected = false;
    if (requested && requested !== followCurrent) {
      const requestedKey = normalize(requested).toLocaleLowerCase();
      const match = menuItems.find((item) => normalize(item.text[0]).toLocaleLowerCase() === requestedKey);
      if (match) {
        match.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        match.element.click();
        selected = true;
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    return {
      triggerFound: true,
      currentModel: triggerText || triggerAria.replace(/^.*?[“"]([^”"]+)[”"].*$/, '$1'),
      options: menuItems.map((item) => ({ id: item.id, text: item.text.join('\n'), current: item.current })),
      selected
    };
  }, requestedModel, followCurrentWebAiModel, geminiDomPolicy);
}

export async function inspectGeminiModels(
  webContents: ChatGptWebContentsLike,
  requestedModel = '',
  verifySelection = true
): Promise<ChatGptModelCatalog> {
  type GeminiModelMenuState = {
    triggerFound: boolean;
    currentModel: string;
    options: Array<{ id: string; text: string; current?: boolean }>;
    selected: boolean;
  };
  const startedAt = Date.now();
  let state: GeminiModelMenuState | undefined;
  do {
    state = await webContents.executeJavaScript<GeminiModelMenuState>(geminiModelMenuScript(requestedModel), true);
    if (state?.triggerFound && state.options.length > 0) break;
    if (Date.now() - startedAt >= 10_000) break;
    await wait(400);
  } while (true);
  if (!state?.triggerFound) {
    return {
      ok: false,
      models: [],
      refreshedAt: new Date().toISOString(),
      message: 'Gemini 页面尚未显示模型选择器。',
      error: 'gemini-model-trigger-not-found',
      provider: 'gemini'
    };
  }
  const discoveredModels = dedupeGeminiModelOptions(
    state.options.flatMap((option) => {
      const parsed = parseGeminiModelOptionLabel(option.text);
      return parsed
        ? [{ id: option.id, label: parsed.label, current: option.current === true }]
        : [];
    })
  );
  const explicitlySelectedModels = discoveredModels.filter((model) => model.current);
  const triggerMatchedModel = discoveredModels.find((model) => isSameGeminiModel(model.label, state.currentModel));
  const selectedModel =
    explicitlySelectedModels.find((model) => isSameGeminiModel(model.label, state.currentModel)) ||
    explicitlySelectedModels[0] ||
    triggerMatchedModel;
  const currentModel = selectedModel?.label || state.currentModel || undefined;
  const models = discoveredModels.map((model) => ({
    ...model,
    current: Boolean(selectedModel && normalizeGeminiModelLabel(model.label) === normalizeGeminiModelLabel(selectedModel.label))
  }));
  if (requestedModel && requestedModel !== followCurrentWebAiModel && !state.selected) {
    return {
      ok: false,
      currentModel,
      models,
      refreshedAt: new Date().toISOString(),
      message: `当前 Gemini 账号不可用模型：${requestedModel}。`,
      error: 'gemini-requested-model-unavailable',
      provider: 'gemini'
    };
  }
  if (requestedModel && requestedModel !== followCurrentWebAiModel && state.selected && verifySelection) {
    await wait(500);
    const verified = await inspectGeminiModels(webContents, '', false);
    if (!verified.ok || !isSameGeminiModel(verified.currentModel || '', requestedModel)) {
      return {
        ...verified,
        ok: false,
        message: `Gemini 未确认切换到指定模型：${requestedModel}。本轮尚未上传附件。`,
        error: 'gemini-model-selection-not-confirmed',
        provider: 'gemini'
      };
    }
    return verified;
  }
  return {
    ok: models.length > 0,
    currentModel,
    models,
    refreshedAt: new Date().toISOString(),
    message: models.length > 0 ? `已读取 ${models.length} 个 Gemini 可用模型。` : 'Gemini 模型菜单没有可用模型。',
    error: models.length > 0 ? undefined : 'gemini-model-list-empty',
    provider: 'gemini'
  };
}

export function canUseGeminiForAutomation(probe?: GeminiPageProbe) {
  return isConfirmedGeminiLogin(probe) && probe?.busy !== true;
}
