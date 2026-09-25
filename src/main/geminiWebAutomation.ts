import fs from 'node:fs/promises';
import path from 'node:path';
import { withTimeout } from '../shared/asyncTimeout.js';
import type { ChatGptWebContentsLike } from './chromeChatGpt.js';
import {
  classifyGeminiFailure,
  hasGeminiSendBeenAccepted,
  selectGeminiFailureText,
  selectGeminiImageCandidate,
  selectGeminiTextResult,
  type GeminiFailureClassification,
  type GeminiSendBaseline,
  type GeminiSendSnapshot,
  type GeminiTextCandidate
} from './geminiAutomationPolicy.js';
import { geminiDomPolicy } from './geminiBrowserPolicy.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pageScript<TArgs extends unknown[]>(fn: (...args: TArgs) => unknown, ...args: TArgs) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

async function evaluate<T>(webContents: ChatGptWebContentsLike, script: string, timeoutMs = 6000) {
  return withTimeout(
    webContents.executeJavaScript<T>(script, true),
    timeoutMs,
    `Gemini 页面脚本执行超时（${timeoutMs}ms）`
  );
}

const commonDomScript = (mode: 'baseline' | 'snapshot') =>
  pageScript((requestedMode: 'baseline' | 'snapshot') => {
    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const textOf = (element: Element | null | undefined) => {
      const inputValue = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
        ? element.value
        : '';
      return (inputValue || (element as HTMLElement | undefined)?.innerText || element?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const unique = <T extends Element>(elements: T[]) => [...new Set(elements)];
    const topLevel = <T extends HTMLElement>(elements: T[]) => {
      const candidates = unique(elements);
      return candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));
    };
    const explicitAssistantRoots = topLevel([
      ...document.querySelectorAll<HTMLElement>('model-response'),
      ...document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]')
    ]).filter((element) => !element.closest('[data-test-id*="user"],user-query,[class*="user-query"]'));
    const responseSelectionPanels = topLevel([
      ...document.querySelectorAll<HTMLElement>('response-selection-panel')
    ]).filter((element) => !element.closest('user-query,[data-message-author-role="user"]'));
    const messageContentRoots = unique([
      ...document.querySelectorAll<HTMLElement>('model-response message-content'),
      ...document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"] message-content')
    ]).filter((element) => !element.closest('[data-test-id*="user"],user-query,[class*="user-query"]'));
    const structuredContentRoots = unique([
      ...document.querySelectorAll<HTMLElement>('model-response structured-content-container'),
      ...document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"] structured-content-container')
    ]).filter((element) => !element.closest('[data-test-id*="user"],user-query,[class*="user-query"]'));
    const responseRoots = explicitAssistantRoots.length > 0
      ? explicitAssistantRoots
      : responseSelectionPanels.length > 0
        ? responseSelectionPanels
      : messageContentRoots.length > 0
        ? messageContentRoots
        : structuredContentRoots.length > 0
          ? structuredContentRoots
          : [];
    const explicitUserRoots = topLevel([
      ...document.querySelectorAll<HTMLElement>('user-query'),
      ...document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')
    ]);
    const userRoots = explicitUserRoots.length > 0
      ? explicitUserRoots
      : topLevel([...document.querySelectorAll<HTMLElement>('[data-test-id*="user-query"]')]);
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => visible(element) && /gemini/i.test(element.getAttribute('aria-label') || ''));
    const busy = [...document.querySelectorAll<HTMLElement>('button,[role="button"]')].some((element) => {
      if (!visible(element)) return false;
      return /停止回答|停止生成|stop response|stop generating/i.test(
        `${element.getAttribute('aria-label') || ''} ${textOf(element)}`
      );
    });
    const composerSurface = (() => {
      let current = composer?.parentElement;
      let best = current;
      for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
        const rect = current.getBoundingClientRect();
        if (rect.height <= Math.max(520, window.innerHeight * 0.65)) best = current;
        current = current.parentElement;
      }
      return best || composer?.parentElement;
    })();
    const attachmentElements = composerSurface
      ? [...composerSurface.querySelectorAll<HTMLElement>(
          '[data-test-id*="attachment"],[data-test-id*="file-chip"],[data-test-id*="uploaded-file"],[data-test-id*="uploaded-img"],[class*="attachment"],[class*="file-preview"],[class*="file-chip"],[aria-label*="移除附件"],[aria-label*="删除附件"],[aria-label*="移除已上传"],[aria-label*="删除已上传"],[aria-label*="remove attachment"],[aria-label*="remove uploaded"],[aria-label*="已上传图片"],[aria-label*="uploaded image"]'
        )].filter(visible)
      : [];
    const imageRoots = responseRoots;
    const images = imageRoots.flatMap((root, responseIndex) =>
      [...root.querySelectorAll<HTMLImageElement>('img')].map((image, imageIndex) => {
        const link = image.closest<HTMLAnchorElement>('a[href]');
        const imageSource = image.currentSrc || image.src || '';
        const linkedSource = link?.href || '';
        const source = imageSource || (/\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(linkedSource) ? linkedSource : '');
        return {
          responseIndex,
          imageIndex,
          src: source,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
          alt: `${image.alt || ''} ${image.getAttribute('aria-label') || ''}`.trim(),
          visible: visible(image)
        };
      })
    );
    const textCandidates = responseRoots.map((root, index) => ({
      index,
      text: textOf(root),
      streaming: busy && index === responseRoots.length - 1,
      userEcho: Boolean(root.closest('user-query,[data-test-id*="user-query"],[data-message-author-role="user"]'))
    }));
    const pageFailureText = [...document.querySelectorAll<HTMLElement>(
      '[role="alert"],[aria-live="assertive"],[class*="error"],[class*="snackbar"]'
    )]
      .filter(visible)
      .map(textOf)
      .find((text) => /登录|额度|上限|频率|安全|政策|生成失败|网络|错误|sign in|quota|limit|safety|policy|failed|network|error/i.test(text)) ||
      (/(?:暂不|尚不|不).{0,12}支持.{0,12}(?:地区|区域|国家)|not (?:available|supported).{0,20}(?:region|country)|unsupported region/i.test(textOf(document.body))
        ? 'Gemini 暂不支持当前地区。'
        : '');
    return {
      mode: requestedMode,
      href: location.href,
      userMessageCount: userRoots.length,
      responseCount: responseRoots.length,
      composerTextLength: textOf(composer).length,
      attachmentCount: attachmentElements.length,
      busy,
      images,
      textCandidates,
      latestResponseText: textCandidates.at(-1)?.text || '',
      pageFailureText
    };
  }, mode);

export interface GeminiImageCandidate {
  responseIndex: number;
  imageIndex: number;
  src: string;
  width: number;
  height: number;
  alt: string;
  visible: boolean;
}

export interface GeminiPageSnapshot extends GeminiSendSnapshot {
  mode: 'baseline' | 'snapshot';
  images: GeminiImageCandidate[];
  textCandidates: GeminiTextCandidate[];
  latestResponseText: string;
  pageFailureText: string;
}

export interface GeminiAutomationBaseline extends GeminiSendBaseline {
  imageSources: string[];
  capturedAt: number;
}

export interface GeminiAttachmentUploadReceipt {
  method: 'file-input' | 'cdp-drag-drop';
  errors: string[];
  marker: string;
  baselineAttachmentCount: number;
}

export interface GeminiConfirmedAttachmentUpload {
  receipt: GeminiAttachmentUploadReceipt;
  confirmation: Awaited<ReturnType<typeof waitForGeminiAttachments>>;
  attempts: Array<'file-input' | 'cdp-drag-drop'>;
}

export interface GeminiComposerReadySnapshot {
  ready: boolean;
  hasPrompt: boolean;
  composerTextLength: number;
  attachmentCount: number;
  sendEnabled: boolean;
  busyCount: number;
  uploadErrorText: string;
  sendButtonLabel: string;
}

export interface GeminiDomDiagnostics {
  pagePath: string;
  readyState: string;
  titleLength: number;
  composerCount: number;
  responseCount: number;
  fileInputCount: number;
  modelButtonCount: number;
  dataTestIds: string[];
}

export async function captureGeminiDomDiagnostics(
  webContents: ChatGptWebContentsLike
): Promise<GeminiDomDiagnostics> {
  return evaluate<GeminiDomDiagnostics>(webContents, pageScript(() => {
    const pageUrl = new URL(location.href);
    const dataTestIds = [...document.querySelectorAll<HTMLElement>('[data-test-id]')]
      .map((element) => element.getAttribute('data-test-id') || '')
      .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
      .slice(0, 40);
    return {
      pagePath: `${pageUrl.origin}${pageUrl.pathname}`,
      readyState: document.readyState,
      titleLength: document.title.length,
      composerCount: document.querySelectorAll('[role="textbox"],[contenteditable="true"],textarea').length,
      responseCount: document.querySelectorAll('model-response,response-selection-panel,[data-test-id*="response"],[class*="model-response"],[data-message-author-role="assistant"]').length,
      fileInputCount: document.querySelectorAll('input[type="file"]').length,
      modelButtonCount: document.querySelectorAll('[data-test-id="bard-mode-menu-button"],[data-test-id*="model-selector"],[data-test-id*="model-picker"],[aria-label*="模式选择器"],[aria-label*="选择模型"],[aria-label*="mode picker"],[aria-label*="select model"]').length,
      dataTestIds
    };
  }), 4000);
}

export async function captureGeminiBaseline(webContents: ChatGptWebContentsLike): Promise<GeminiAutomationBaseline> {
  const snapshot = await evaluate<GeminiPageSnapshot>(webContents, commonDomScript('baseline'));
  return {
    userMessageCount: snapshot.userMessageCount,
    responseCount: snapshot.responseCount,
    href: snapshot.href,
    imageSources: snapshot.images.map((image) => image.src).filter(Boolean),
    capturedAt: Date.now()
  };
}

export async function resetGeminiComposer(webContents: ChatGptWebContentsLike) {
  const state = await evaluate<{
    ok: boolean;
    hasComposer: boolean;
    textLength: number;
    attachmentCount: number;
  }>(webContents, pageScript((policy: typeof geminiDomPolicy) => {
    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const composerPattern = new RegExp(policy.composerAriaPattern, 'i');
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => visible(element) && composerPattern.test(element.getAttribute('aria-label') || ''));
    if (!composer) return { ok: false, hasComposer: false, textLength: 0, attachmentCount: 0 };
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value')?.set;
      setter?.call(composer, '');
    } else {
      composer.replaceChildren();
    }
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    const composerSurface = (() => {
      let current = composer.parentElement;
      let best = current;
      for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
        const rect = current.getBoundingClientRect();
        if (rect.height <= Math.max(520, window.innerHeight * 0.65)) best = current;
        current = current.parentElement;
      }
      return best || composer.parentElement;
    })();
    const attachmentElements = composerSurface
      ? [...composerSurface.querySelectorAll<HTMLElement>(
          '[data-test-id*="attachment"],[data-test-id*="file-chip"],[data-test-id*="uploaded-file"],[data-test-id*="uploaded-img"],[class*="attachment-preview"],[class*="file-preview"],[class*="file-chip"],[aria-label*="移除附件"],[aria-label*="删除附件"],[aria-label*="移除已上传"],[aria-label*="删除已上传"],[aria-label*="remove attachment"],[aria-label*="remove uploaded"],[aria-label*="已上传图片"],[aria-label*="uploaded image"]'
        )].filter(visible)
      : [];
    const attachmentCount = attachmentElements.filter((element) =>
      !attachmentElements.some((other) => other !== element && other.contains(element))
    ).length;
    const textLength = (
      composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
        ? composer.value
        : ((composer as HTMLElement).innerText || composer.textContent || '')
    ).trim().length;
    return { ok: textLength === 0 && attachmentCount === 0, hasComposer: true, textLength, attachmentCount };
  }, geminiDomPolicy), 6000);
  return state;
}

export async function enableGeminiImageMode(webContents: ChatGptWebContentsLike) {
  return evaluate<{
    ok: boolean;
    alreadyEnabled: boolean;
    label: string;
    strategy: 'direct-prompt';
  }>(webContents, pageScript((policy: typeof geminiDomPolicy) => {
    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const composerPattern = new RegExp(policy.composerAriaPattern, 'i');
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => visible(element) && composerPattern.test(element.getAttribute('aria-label') || ''));
    return {
      ok: Boolean(composer),
      alreadyEnabled: Boolean(composer),
      label: composer ? 'Gemini direct image prompt' : '',
      strategy: 'direct-prompt'
    };
  }, geminiDomPolicy), 6000);
}

async function markGeminiFileInput(webContents: ChatGptWebContentsLike, marker: string, expectedCount: number) {
  return evaluate<{ selected: boolean; inputCount: number; baselineAttachmentCount: number }>(webContents, pageScript(async (
    token: string,
    expectedFiles: number,
    policy: typeof geminiDomPolicy
  ) => {
    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
    const composerPattern = new RegExp(policy.composerAriaPattern, 'i');
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => visible(element) && composerPattern.test(normalize(element.getAttribute('aria-label'))));
    const composerSurface = (() => {
      let current = composer?.parentElement;
      let best = current;
      for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
        const rect = current.getBoundingClientRect();
        if (rect.height <= Math.max(520, window.innerHeight * 0.65)) best = current;
        current = current.parentElement;
      }
      return best || composer?.parentElement || document.body;
    })();
    const attachmentSelector = [
      '[data-test-id*="attachment"]',
      '[data-test-id*="file-chip"]',
      '[data-test-id*="uploaded-file"]',
      '[data-test-id*="uploaded-img"]',
      '[class*="attachment"]',
      '[class*="file-preview"]',
      '[class*="file-chip"]',
      '[aria-label*="移除附件"]',
      '[aria-label*="删除附件"]',
      '[aria-label*="移除已上传"]',
      '[aria-label*="删除已上传"]',
      '[aria-label*="remove attachment"]',
      '[aria-label*="remove uploaded"]',
      '[aria-label*="已上传图片"]',
      '[aria-label*="uploaded image"]'
    ].join(',');
    const countAttachmentEvidence = () => {
      const explicit = [...composerSurface.querySelectorAll<HTMLElement>(attachmentSelector)].filter(visible);
      const explicitRoots = explicit.filter((element) => !explicit.some((other) => other !== element && other.contains(element)));
      return explicitRoots.length;
    };
    const baselineAttachmentCount = countAttachmentEvidence();
    const sharesComposerSurface = (element: Element) => composerSurface.contains(element);
    const uploadPattern = new RegExp(policy.uploadAriaPattern, 'i');
    const uploadTestIdPattern = new RegExp(policy.uploadButtonTestIdPattern, 'i');
    const uploadButton = [...document.querySelectorAll<HTMLElement>('button,[role="button"]')]
      .filter(visible)
      .map((element) => {
        const markerText = normalize(`${element.getAttribute('aria-label')} ${element.textContent}`);
        const text = normalize(element.textContent);
        const score =
          (uploadTestIdPattern.test(element.getAttribute('data-test-id') || '') ? 120 : 0) +
          (uploadPattern.test(markerText) ? 100 : 0) +
          (/^[+＋]$/.test(text) ? 55 : 0) +
          (sharesComposerSurface(element) ? 45 : 0) -
          (/(?:发送|模型|麦克风|语音|账号|send|model|microphone|voice|account)/i.test(markerText) ? 180 : 0);
        return { element, score };
      })
      .filter((candidate) => candidate.score >= 90)
      .sort((left, right) => right.score - left.score)[0]?.element;
    const initialInputs = new Set(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    uploadButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const localPattern = new RegExp(policy.uploadMenuTestIdPattern, 'i');
    const localItem = [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"],[role="option"],label')]
      .find((element) => {
        if (!visible(element)) return false;
        const testId = normalize(element.getAttribute('data-test-id'));
        const label = normalize(`${element.getAttribute('aria-label')} ${element.textContent}`);
        return localPattern.test(testId) || /上传文件|从设备上传|upload files?|from (?:your )?device/i.test(label);
      });
    localItem?.click();
    let inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    for (let attempt = 0; attempt < 8 && inputs.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    }
    const selected = inputs
      .map((input) => ({
        input,
        score:
          (!initialInputs.has(input) ? 8 : 0) +
          (/image/i.test(input.accept || '') ? 4 : 0) +
          (input.multiple ? 2 : 0) +
          (composerSurface.contains(input) ? 2 : 0) +
          (input.closest('form') ? 1 : 0)
      }))
      .sort((left, right) => right.score - left.score)[0]?.input;
    if (selected) {
      selected.setAttribute('data-yaochuang-gemini-upload-target', token);
      selected.setAttribute('data-yaochuang-gemini-expected-files', String(expectedFiles));
      const recordSelectionEvent = () => {
        selected.setAttribute('data-yaochuang-gemini-upload-events', String(selected.files?.length || 0));
      };
      selected.addEventListener('input', recordSelectionEvent);
      selected.addEventListener('change', recordSelectionEvent);
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { selected: Boolean(selected), inputCount: inputs.length, baselineAttachmentCount };
  }, marker, expectedCount, geminiDomPolicy), 8000);
}

async function dispatchGeminiFileDrop(webContents: ChatGptWebContentsLike, files: string[]) {
  const point = await evaluate<{ ok: boolean; x: number; y: number }>(webContents, pageScript((policy: typeof geminiDomPolicy) => {
    const pattern = new RegExp(policy.composerAriaPattern, 'i');
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => pattern.test(element.getAttribute('aria-label') || ''));
    const rect = composer?.getBoundingClientRect();
    return rect && rect.width > 1 && rect.height > 1
      ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { ok: false, x: 0, y: 0 };
  }, geminiDomPolicy), 4000);
  if (!point.ok) throw new Error('没有找到 Gemini 可接收拖放上传的输入区。');
  const debuggerApi = webContents.debugger;
  let attachedHere = false;
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach('1.3');
    attachedHere = true;
  }
  try {
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await debuggerApi.sendCommand('Input.dispatchDragEvent', { type, x: point.x, y: point.y, data });
      await sleep(type === 'drop' ? 180 : 80);
    }
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
}

export async function uploadGeminiAttachments(
  webContents: ChatGptWebContentsLike,
  files: string[]
): Promise<GeminiAttachmentUploadReceipt> {
  for (const file of files) {
    await fs.access(file).catch(() => {
      throw new Error(`待上传图片不存在：${file}`);
    });
  }
  if (files.length > 1) {
    const receipts: GeminiAttachmentUploadReceipt[] = [];
    for (const file of files) {
      const receipt = await uploadGeminiAttachments(webContents, [file]);
      receipts.push(receipt);
      await waitForGeminiAttachments(webContents, [file], 45_000, receipt);
    }
    return {
      method: receipts.some((receipt) => receipt.method === 'cdp-drag-drop') ? 'cdp-drag-drop' : 'file-input',
      errors: receipts.flatMap((receipt) => receipt.errors),
      marker: '',
      baselineAttachmentCount: receipts[0]?.baselineAttachmentCount || 0
    };
  }
  const marker = `yaochuang-gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const errors: string[] = [];
  let baselineAttachmentCount = 0;
  const debuggerApi = webContents.debugger;
  let attachedHere = false;
  let chooserIntercepted = false;
  try {
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach('1.3');
      attachedHere = true;
    }
    try {
      await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      chooserIntercepted = true;
    } catch (error) {
      throw new Error(`Chrome 无法拦截 Gemini 文件选择器：${error instanceof Error ? error.message : String(error)}`);
    }
    const marked = await markGeminiFileInput(webContents, marker, files.length);
    baselineAttachmentCount = marked.baselineAttachmentCount;
    if (!marked.selected) throw new Error(`Gemini 页面没有可用文件入口（检测到 ${marked.inputCount} 个 file input）。`);
    const { root } = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true }) as { root: { nodeId: number } };
    const { nodeId } = await debuggerApi.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `input[data-yaochuang-gemini-upload-target="${marker}"]`
    }) as { nodeId: number };
    if (!nodeId) throw new Error('已经定位 Gemini 上传入口，但 CDP 无法取得对应节点。');
    await debuggerApi.sendCommand('DOM.setFileInputFiles', { nodeId, files });
    return { method: 'file-input', errors, marker, baselineAttachmentCount };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    await evaluate<boolean>(webContents, pageScript((token: string) => {
      const input = document.querySelector(`input[data-yaochuang-gemini-upload-target="${token}"]`);
      input?.removeAttribute('data-yaochuang-gemini-upload-target');
      input?.removeAttribute('data-yaochuang-gemini-expected-files');
      input?.removeAttribute('data-yaochuang-gemini-upload-events');
      return true;
    }, marker), 1500).catch(() => false);
  } finally {
    if (chooserIntercepted) {
      await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined);
    }
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
  try {
    await dispatchGeminiFileDrop(webContents, files);
    return { method: 'cdp-drag-drop', errors, marker: '', baselineAttachmentCount };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  throw new Error(`Gemini 图片上传入口不可用。${errors.join('；')}`);
}

export async function waitForGeminiAttachments(
  webContents: ChatGptWebContentsLike,
  files: string[],
  timeoutMs = 45_000,
  receipt?: GeminiAttachmentUploadReceipt
) {
  const expectedNames = files.map((file) => path.basename(file).toLocaleLowerCase());
  const startedAt = Date.now();
  let stableAttachmentPolls = 0;
  let last = {
    attachmentCount: 0,
    readyAttachmentCount: 0,
    nameHits: 0,
    errorText: '',
    selectedFileCount: 0,
    inputEventCount: 0,
    busyCount: 0
  };
  const marker = receipt?.marker || '';
  const baselineAttachmentCount = receipt?.baselineAttachmentCount || 0;
  const cleanupMarker = async () => {
    if (!marker) return;
    await evaluate<boolean>(webContents, pageScript((token: string) => {
      const input = document.querySelector(`input[data-yaochuang-gemini-upload-target="${token}"]`);
      input?.removeAttribute('data-yaochuang-gemini-upload-target');
      input?.removeAttribute('data-yaochuang-gemini-expected-files');
      input?.removeAttribute('data-yaochuang-gemini-upload-events');
      return true;
    }, marker), 1500).catch(() => false);
  };
  try {
    while (Date.now() - startedAt < timeoutMs) {
      last = await evaluate<typeof last>(webContents, pageScript((names: string[], token: string) => {
      const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
        .find((element) => /gemini/i.test(element.getAttribute('aria-label') || ''));
      const visible = (element: Element) => {
        const html = element as HTMLElement;
        const style = getComputedStyle(html);
        const rect = html.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
      };
      const scope = (() => {
        let current = composer?.parentElement;
        let best = current;
        for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
          const rect = current.getBoundingClientRect();
          if (rect.height <= Math.max(520, window.innerHeight * 0.65)) best = current;
          current = current.parentElement;
        }
        return best || composer?.parentElement || document.body;
      })();
      const attachmentSelector = [
        '[data-test-id*="attachment"]',
        '[data-test-id*="file-chip"]',
        '[data-test-id*="uploaded-file"]',
        '[data-test-id*="uploaded-img"]',
        '[class*="attachment"]',
        '[class*="file-preview"]',
        '[class*="file-chip"]',
        '[aria-label*="移除附件"]',
        '[aria-label*="删除附件"]',
        '[aria-label*="移除已上传"]',
        '[aria-label*="删除已上传"]',
        '[aria-label*="remove attachment"]',
        '[aria-label*="remove uploaded"]',
        '[aria-label*="已上传图片"]',
        '[aria-label*="uploaded image"]'
      ].join(',');
      const text = normalize((scope as HTMLElement).innerText || scope.textContent);
      const explicitElements = [...scope.querySelectorAll<HTMLElement>(attachmentSelector)].filter(visible);
      const explicitRoots = explicitElements.filter((element) =>
        !explicitElements.some((other) => other !== element && other.contains(element))
      );
      const readyAttachmentRoots = explicitRoots.filter((element) => {
        const markerText = normalize(`${element.getAttribute('aria-label') || ''} ${element.innerText || element.textContent || ''}`);
        const isLoadedImage = element instanceof HTMLImageElement &&
          element.complete && Math.min(element.naturalWidth, element.naturalHeight) >= 24;
        const isLoadedCanvas = element instanceof HTMLCanvasElement &&
          Math.min(element.width, element.height) >= 24;
        const hasLoadedImage = [...element.querySelectorAll<HTMLImageElement>('img')]
          .some((image) => image.complete && Math.min(image.naturalWidth, image.naturalHeight) >= 24);
        const hasLoadedCanvas = [...element.querySelectorAll<HTMLCanvasElement>('canvas')]
          .some((canvas) => Math.min(canvas.width, canvas.height) >= 24);
        const hasRemoveControl = [...element.querySelectorAll<HTMLElement>('button,[role="button"],gem-icon-button')]
          .some((control) => /关闭附件|移除附件|删除附件|remove attachment|remove uploaded/i.test(
            `${control.getAttribute('aria-label') || ''} ${control.getAttribute('arialabel') || ''} ${control.textContent || ''}`
          ));
        return isLoadedImage || isLoadedCanvas || hasLoadedImage || hasLoadedCanvas || hasRemoveControl ||
          /已上传|uploaded|图片预览|image preview/i.test(markerText) ||
          names.some((name) => markerText.includes(name));
      });
      const markedInput = token
        ? document.querySelector<HTMLInputElement>(`input[data-yaochuang-gemini-upload-target="${token}"]`)
        : null;
      const nameHits = names.filter((name) => text.includes(name)).length;
      const errorText = [...document.querySelectorAll<HTMLElement>('[role="alert"],[class*="error"]')]
        .map((element) => normalize(element.innerText || element.textContent))
        .find((value) => /上传|upload|文件|file/.test(value) && /失败|错误|failed|error/.test(value)) || '';
      const busyCount = [...scope.querySelectorAll<HTMLElement>(
        '[aria-busy="true"],[role="progressbar"],mat-progress-spinner,[class*="uploading"],[class*="upload-progress"]'
      )].filter(visible).length;
      return {
        attachmentCount: explicitRoots.length,
        readyAttachmentCount: readyAttachmentRoots.length,
        nameHits,
        errorText,
        selectedFileCount: markedInput?.files?.length || 0,
        inputEventCount: Number(markedInput?.getAttribute('data-yaochuang-gemini-upload-events') || 0),
        busyCount
      };
    }, expectedNames, marker), 5000).catch(() => last);
      if (last.errorText) throw new Error(`Gemini 页面提示附件上传失败：${last.errorText}`);
      const newAttachmentCount = Math.max(0, last.attachmentCount - baselineAttachmentCount);
      const readyAttachmentCount = Math.min(newAttachmentCount, last.readyAttachmentCount);
      if (readyAttachmentCount >= files.length && last.busyCount === 0) {
        stableAttachmentPolls += 1;
        if (stableAttachmentPolls >= 6) return last;
      } else {
        stableAttachmentPolls = 0;
      }
      await sleep(500);
    }
    throw new Error(
      `Gemini 未确认完整接收 ${files.length} 个附件（文件名命中 ${last.nameHits}，附件证据 ${last.attachmentCount}，就绪附件 ${last.readyAttachmentCount}，文件输入 ${last.selectedFileCount}，上传事件 ${last.inputEventCount}）。`
    );
  } finally {
    await cleanupMarker();
  }
}

export async function uploadAndConfirmGeminiAttachments(
  webContents: ChatGptWebContentsLike,
  files: string[],
  timeoutMs = 45_000
): Promise<GeminiConfirmedAttachmentUpload> {
  if (files.length === 0) throw new Error('Gemini 上传任务没有可用附件。');
  if (files.length > 1) {
    const confirmed: GeminiConfirmedAttachmentUpload[] = [];
    for (const file of files) {
      confirmed.push(await uploadAndConfirmGeminiAttachments(webContents, [file], timeoutMs));
    }
    const receipt: GeminiAttachmentUploadReceipt = {
      method: confirmed.some((item) => item.receipt.method === 'cdp-drag-drop') ? 'cdp-drag-drop' : 'file-input',
      errors: confirmed.flatMap((item) => item.receipt.errors),
      marker: '',
      baselineAttachmentCount: confirmed[0]?.receipt.baselineAttachmentCount || 0
    };
    const confirmation = await waitForGeminiAttachments(webContents, files, timeoutMs, receipt);
    return {
      receipt,
      confirmation,
      attempts: confirmed.flatMap((item) => item.attempts)
    };
  }

  const primary = await uploadGeminiAttachments(webContents, files);
  try {
    const confirmation = await waitForGeminiAttachments(webContents, files, timeoutMs, primary);
    return { receipt: primary, confirmation, attempts: [primary.method] };
  } catch (primaryError) {
    if (primary.method !== 'file-input') throw primaryError;
    await dispatchGeminiFileDrop(webContents, files);
    const fallback: GeminiAttachmentUploadReceipt = {
      method: 'cdp-drag-drop',
      errors: [...primary.errors, primaryError instanceof Error ? primaryError.message : String(primaryError)],
      marker: '',
      baselineAttachmentCount: primary.baselineAttachmentCount
    };
    const confirmation = await waitForGeminiAttachments(webContents, files, timeoutMs, fallback);
    return { receipt: fallback, confirmation, attempts: ['file-input', 'cdp-drag-drop'] };
  }
}

const geminiComposerReadyScript = (expectedAttachments: number) =>
  pageScript((minimumAttachments: number, policy: typeof geminiDomPolicy) => {
    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
    const labelOf = (element: Element) => normalize(
      `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.textContent || ''}`
    );
    const composerPattern = new RegExp(policy.composerAriaPattern, 'i');
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => visible(element) && composerPattern.test(element.getAttribute('aria-label') || ''));
    const composerText = composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
      ? composer.value.trim()
      : normalize(composer?.innerText || composer?.textContent);
    const attachmentSelector = [
      '[data-test-id*="attachment"]',
      '[data-test-id*="file-chip"]',
      '[data-test-id*="uploaded-file"]',
      '[data-test-id*="uploaded-img"]',
      '[class*="attachment-preview"]',
      '[class*="file-preview"]',
      '[class*="file-chip"]',
      '[aria-label*="移除附件"]',
      '[aria-label*="删除附件"]',
      '[aria-label*="remove attachment"]',
      '[aria-label*="remove uploaded"]',
      '[aria-label*="已上传图片"]',
      '[aria-label*="uploaded image"]'
    ].join(',');
    const composerSurface = (() => {
      let current = composer?.parentElement;
      let best = current;
      for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
        const rect = current.getBoundingClientRect();
        if (rect.height <= Math.max(520, window.innerHeight * 0.65)) best = current;
        current = current.parentElement;
      }
      return best || composer?.parentElement;
    })();
    const attachmentElements = composerSurface
      ? [...composerSurface.querySelectorAll<HTMLElement>(attachmentSelector)].filter(visible)
      : [];
    const attachmentRoots = attachmentElements.filter((element) =>
      !attachmentElements.some((other) => other !== element && other.contains(element))
    );
    const sendPattern = /^(?:发送|发送消息|提交|send|send message|submit)$/i;
    const explicitSend = [...document.querySelectorAll<HTMLElement>(
      '[data-test-id="send-button-container"] button,[data-test-id="send-button-container"] [role="button"]'
    )].find(visible);
    const semanticSend = [...document.querySelectorAll<HTMLElement>('button,[role="button"]')]
      .find((element) => visible(element) && sendPattern.test(labelOf(element)));
    const sendButton = explicitSend || semanticSend;
    const sendEnabled = Boolean(
      sendButton && !sendButton.hasAttribute('disabled') && sendButton.getAttribute('aria-disabled') !== 'true'
    );
    const busyCount = [...document.querySelectorAll<HTMLElement>(
      '[aria-busy="true"],[role="progressbar"],mat-progress-spinner,[class*="uploading"],[class*="upload-progress"]'
    )].filter(visible).length;
    const uploadErrorText = [...document.querySelectorAll<HTMLElement>('[role="alert"],[class*="error"]')]
      .filter(visible)
      .map((element) => normalize(element.innerText || element.textContent))
      .find((value) => /上传|upload|文件|file/.test(value) && /失败|错误|failed|error/.test(value)) || '';
    const hasPrompt = composerText.length > 0;
    return {
      ready: Boolean(
        composer && hasPrompt && attachmentRoots.length >= minimumAttachments && sendEnabled && busyCount === 0 && !uploadErrorText
      ),
      hasPrompt,
      composerTextLength: composerText.length,
      attachmentCount: attachmentRoots.length,
      sendEnabled,
      busyCount,
      uploadErrorText,
      sendButtonLabel: sendButton ? labelOf(sendButton).slice(0, 120) : ''
    };
  }, Math.max(0, expectedAttachments), geminiDomPolicy);

export async function waitForGeminiComposerReady(
  webContents: ChatGptWebContentsLike,
  expectedAttachments: number,
  timeoutMs = 60_000
): Promise<GeminiComposerReadySnapshot> {
  const startedAt = Date.now();
  let stablePolls = 0;
  let last: GeminiComposerReadySnapshot = {
    ready: false,
    hasPrompt: false,
    composerTextLength: 0,
    attachmentCount: 0,
    sendEnabled: false,
    busyCount: 0,
    uploadErrorText: '',
    sendButtonLabel: ''
  };
  while (Date.now() - startedAt < timeoutMs) {
    last = await evaluate<GeminiComposerReadySnapshot>(
      webContents,
      geminiComposerReadyScript(expectedAttachments),
      5000
    ).catch(() => last);
    if (last.uploadErrorText) return last;
    if (last.ready) {
      stablePolls += 1;
      if (stablePolls >= 3) return last;
    } else {
      stablePolls = 0;
    }
    await sleep(500);
  }
  return { ...last, ready: false };
}

export async function setGeminiPrompt(webContents: ChatGptWebContentsLike, prompt: string) {
  return evaluate<boolean>(webContents, pageScript((value: string, policy: typeof geminiDomPolicy) => {
    const pattern = new RegExp(policy.composerAriaPattern, 'i');
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => pattern.test(element.getAttribute('aria-label') || ''));
    if (!composer) return false;
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value')?.set;
      setter?.call(composer, value);
    } else {
      composer.replaceChildren(document.createTextNode(value));
    }
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    const writtenValue = composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
      ? composer.value
      : ((composer as HTMLElement).innerText || composer.textContent || '');
    return writtenValue.trim().length >= Math.min(20, value.trim().length);
  }, prompt, geminiDomPolicy), 6000);
}

export async function sendGeminiPrompt(webContents: ChatGptWebContentsLike) {
  const target = await evaluate<{
    composerFound: boolean;
    buttonFound: boolean;
    x?: number;
    y?: number;
    label: string;
  }>(webContents, pageScript((policy: typeof geminiDomPolicy) => {
    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return !html.hasAttribute('disabled') && html.getAttribute('aria-disabled') !== 'true' &&
        style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const sendLabelPattern = /^(?:发送|发送消息|提交|send|send message|submit)$/i;
    const labelOf = (element: Element) =>
      `${element.getAttribute('aria-label') || ''} ${(element.textContent || '').trim()}`.replace(/\s+/g, ' ').trim();
    const explicitSendButton = [...document.querySelectorAll<HTMLElement>(
      '[data-test-id="send-button-container"] button, [data-test-id="send-button-container"] [role="button"]'
    )].find(visible);
    const button = explicitSendButton || [...document.querySelectorAll<HTMLElement>('button,[role="button"]')]
      .find((element) => visible(element) && sendLabelPattern.test(labelOf(element)));
    if (button) {
      const rect = button.getBoundingClientRect();
      return {
        composerFound: true,
        buttonFound: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        label: labelOf(button).slice(0, 120)
      };
    }
    const pattern = new RegExp(policy.composerAriaPattern, 'i');
    const composer = [...document.querySelectorAll<HTMLElement>('[role="textbox"],[contenteditable="true"],textarea')]
      .find((element) => pattern.test(element.getAttribute('aria-label') || ''));
    if (!composer) return { composerFound: false, buttonFound: false, label: 'composer-not-found' };
    composer.focus();
    return { composerFound: true, buttonFound: false, label: 'composer-focused' };
  }, geminiDomPolicy), 6000);
  if (!target.composerFound) return { sent: false, method: 'none', label: target.label };
  const debuggerApi = webContents.debugger;
  let attachedHere = false;
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach('1.3');
    attachedHere = true;
  }
  try {
    if (target.buttonFound && Number.isFinite(target.x) && Number.isFinite(target.y)) {
      const x = target.x as number;
      const y = target.y as number;
      await debuggerApi.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', clickCount: 1
      });
      await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', clickCount: 1
      });
      return { sent: true, method: 'cdp-button', label: target.label };
    }
    await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    return { sent: true, method: 'cdp-enter', label: target.label };
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
}

export async function waitForGeminiSendAcceptance(
  webContents: ChatGptWebContentsLike,
  baseline: GeminiAutomationBaseline,
  timeoutMs = 30_000
) {
  const startedAt = Date.now();
  let last: GeminiPageSnapshot | undefined;
  let stableKey = '';
  let stablePolls = 0;
  while (Date.now() - startedAt < timeoutMs) {
    last = await evaluate<GeminiPageSnapshot>(webContents, commonDomScript('snapshot'), 5000).catch(() => last);
    if (last && hasGeminiSendBeenAccepted(baseline, last)) {
      const key = `${last.href}:${last.userMessageCount}:${last.responseCount}`;
      if (key === stableKey) stablePolls += 1;
      else {
        stableKey = key;
        stablePolls = 1;
      }
      if (stablePolls >= 2) return { accepted: true, snapshot: last };
    } else {
      stableKey = '';
      stablePolls = 0;
    }
    await sleep(600);
  }
  return { accepted: false, snapshot: last };
}

export interface GeminiTextResult {
  text: string;
  failure?: GeminiFailureClassification;
}

export async function waitForGeminiTextResult(
  webContents: ChatGptWebContentsLike,
  baseline: GeminiAutomationBaseline,
  timeoutMs = 300_000,
  acceptsText?: (text: string) => boolean
): Promise<GeminiTextResult> {
  const startedAt = Date.now();
  let stableText = '';
  let stablePolls = 0;
  let lastSnapshot: GeminiPageSnapshot | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate<GeminiPageSnapshot>(webContents, commonDomScript('snapshot'), 6000).catch(() => undefined);
    if (snapshot) {
      lastSnapshot = snapshot;
      const candidate = selectGeminiTextResult(baseline, snapshot.textCandidates);
      const failureText = selectGeminiFailureText(baseline, snapshot.textCandidates, snapshot.pageFailureText);
      const failure = classifyGeminiFailure(failureText);
      if (failure && !snapshot.busy) return { text: failureText, failure };
      if (candidate?.text) {
        if (candidate.text === stableText) stablePolls += 1;
        else {
          stableText = candidate.text;
          stablePolls = 1;
        }
        const accepted = !acceptsText || acceptsText(stableText);
        if (!snapshot.busy && stablePolls >= 3 && accepted) return { text: stableText };
      }
    }
    await sleep(1200);
  }
  throw new Error(
    `Gemini 已接收分析任务，但没有在安全时限内返回完整稳定正文（回复节点 ${lastSnapshot?.responseCount ?? 0}，` +
    `最新候选 ${lastSnapshot?.latestResponseText.length ?? 0} 字，生成中=${lastSnapshot?.busy ? '是' : '否'}）。`
  );
}

export type GeminiImageWaitResult =
  | { candidate: GeminiImageCandidate; failure?: undefined; failureText?: undefined }
  | { candidate?: undefined; failure: GeminiFailureClassification; failureText: string };

export async function waitForGeminiImageResult(
  webContents: ChatGptWebContentsLike,
  baseline: GeminiAutomationBaseline,
  timeoutMs = 300_000,
  onProgress?: (detail: { elapsedSeconds: number; candidate?: GeminiImageCandidate; busy: boolean }) => void
): Promise<GeminiImageWaitResult> {
  const known = new Set(baseline.imageSources);
  const startedAt = Date.now();
  let stableKey = '';
  let stablePolls = 0;
  let stableSince = 0;
  let lastProgressAt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate<GeminiPageSnapshot>(webContents, commonDomScript('snapshot'), 6000).catch(() => undefined);
    if (snapshot) {
      const failureText = selectGeminiFailureText(baseline, snapshot.textCandidates, snapshot.pageFailureText);
      const failure = classifyGeminiFailure(failureText);
      if (failure && !snapshot.busy) {
        return { failure, failureText };
      }
      const candidate = selectGeminiImageCandidate(known, snapshot.images);
      if (Date.now() - lastProgressAt >= 7000) {
        onProgress?.({ elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), candidate, busy: snapshot.busy });
        lastProgressAt = Date.now();
      }
      if (candidate) {
        const key = `${candidate.responseIndex}:${candidate.src}:${candidate.width}x${candidate.height}`;
        if (key === stableKey) stablePolls += 1;
        else {
          stableKey = key;
          stablePolls = 1;
          stableSince = Date.now();
        }
        if (!snapshot.busy && stablePolls >= 3 && Date.now() - stableSince >= 3000) return { candidate };
      } else {
        stableKey = '';
        stablePolls = 0;
      }
    }
    await sleep(1800);
  }
  throw new Error('Gemini 已接收任务，但没有在安全时限内返回可下载的结果图。');
}

const readGeminiImageScript = (candidate: GeminiImageCandidate) => pageScript(async (item: GeminiImageCandidate) => {
  const toPngDataUrl = (source: CanvasImageSource, width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas-unavailable');
    context.drawImage(source, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length < 1024) throw new Error('rendered-image-data-too-small');
    return { dataUrl, width, height };
  };
  const generatedImages = [...document.querySelectorAll<HTMLImageElement>(
    'model-response generated-image img,model-response single-image img,model-response img,[data-message-author-role="assistant"] img'
  )].filter((image) => image.complete && image.naturalWidth >= 256 && image.naturalHeight >= 256);
  const renderedImage = generatedImages.find((image) => (image.currentSrc || image.src) === item.src) ||
    [...generatedImages].reverse().find((image) =>
      image.naturalWidth === item.width &&
      image.naturalHeight === item.height &&
      (!item.alt || `${image.alt || ''} ${image.getAttribute('aria-label') || ''}`.includes(item.alt))
    );
  if (renderedImage) {
    try {
      return toPngDataUrl(renderedImage, renderedImage.naturalWidth, renderedImage.naturalHeight);
    } catch {
      // Cross-origin images may taint a canvas; the authenticated fetch fallbacks below still apply.
    }
  }
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(item.src, { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      return toPngDataUrl(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
}, candidate);

export async function downloadGeminiImage(
  webContents: ChatGptWebContentsLike,
  candidate: GeminiImageCandidate
) {
  try {
    return await evaluate<{ dataUrl: string; width: number; height: number }>(
      webContents,
      readGeminiImageScript(candidate),
      24_000
    );
  } catch (pageError) {
    if (!/^https?:\/\//i.test(candidate.src)) throw pageError;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 24_000);
    try {
      const response = await webContents.session.fetch(candidate.src, {
        credentials: 'include',
        referrer: webContents.getURL() || 'https://gemini.google.com/app',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Gemini 原图下载失败：HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) throw new Error(`Gemini 结果资源不是图片：${contentType || 'unknown'}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1024) throw new Error(`Gemini 结果图数据过小：${buffer.length} bytes`);
      return { dataUrl: `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`, width: candidate.width, height: candidate.height };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
