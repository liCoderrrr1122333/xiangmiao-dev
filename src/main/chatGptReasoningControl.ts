import {
  chatGptModelDomPolicy,
  chatGptReasoningDomPolicy,
  shouldForceChatGptHighReasoning,
  type ChatGptReasoningLevel
} from '../shared/chatGptModelPolicy.js';
import type { ChatGptWebContentsLike } from './chromeChatGpt.js';

interface ChatGptReasoningProbe {
  composerLabel: string;
  composerTarget?: { x: number; y: number };
  quality: ChatGptReasoningLevel;
  slider?: {
    target: { x: number; y: number };
    track: { left: number; width: number; y: number };
    min: number;
    max: number;
    step: number;
    value: number;
    valueText: string;
  };
}

export interface ChatGptReasoningResult {
  required: boolean;
  confirmed: boolean;
  model: string;
  before: ChatGptReasoningLevel;
  after: ChatGptReasoningLevel;
  steps: number;
}

export type ChatGptHighReasoningResult = ChatGptReasoningResult;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pageScript(fn: (...args: any[]) => any, ...args: any[]) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

const reasoningProbeScript = pageScript((policy: {
  composerModePattern: string;
  sliderMarkerPattern: string;
  extremeLabelPattern: string;
  highLabelPattern: string;
  mediumLabelPattern: string;
  lowLabelPattern: string;
}) => {
  const visible = (element: Element) => {
    if (element.closest('[inert], [data-active="false"]')) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const interactive = (element: Element) => visible(element) && getComputedStyle(element).pointerEvents !== 'none';
  const textOf = (element: Element) => ((element as HTMLElement).innerText || element.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
  const targetOf = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  const classify = (value: string) => {
    const normalized = value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (new RegExp(policy.extremeLabelPattern, 'i').test(normalized)) return 'extreme';
    if (new RegExp(policy.highLabelPattern, 'i').test(normalized)) return 'high';
    if (new RegExp(policy.mediumLabelPattern, 'i').test(normalized)) return 'medium';
    if (new RegExp(policy.lowLabelPattern, 'i').test(normalized)) return 'low';
    return 'unknown';
  };
  const composerModePattern = new RegExp(policy.composerModePattern, 'i');
  const sliderMarkerPattern = new RegExp(policy.sliderMarkerPattern, 'i');
  const composer = [...document.querySelectorAll<HTMLElement>(
    'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]'
  )]
    .filter(visible)
    .filter((element) => Boolean(element.closest('form, [data-testid*="composer"], [class*="composer"]')))
    .map((element) => {
      const label = textOf(element).split('\n')[0] || textOf(element);
      const className = typeof element.className === 'string' ? element.className : '';
      const score = (composerModePattern.test(label) ? 240 : 0) + (/composer-pill/i.test(className) ? 180 : 0) +
        (element.getBoundingClientRect().width <= 220 ? 20 : 0);
      return { element, label, score };
    })
    .filter((candidate) => candidate.score >= 180)
    .sort((left, right) => right.score - left.score)[0];
  const menuRoots = [...document.querySelectorAll<HTMLElement>(
    '[role="menu"], [role="listbox"], [role="dialog"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'
  )].filter(interactive);
  const slider = [...document.querySelectorAll<HTMLElement>('input[type="range"], [role="slider"]')]
    .filter((element) => visible(element) && interactive(element.closest('[role="menuitem"][aria-describedby]') || element))
    .map((element) => {
      // The current picker exposes the level on its keyboard control, not the aria-hidden thumb.
      const keyboardControl = element.closest('[role="menuitem"][aria-describedby]');
      const announcedValue = (keyboardControl?.getAttribute('aria-describedby') || '')
        .split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      const marker = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''}`;
      const insideMenu = menuRoots.some((root) => root === element || root.contains(element));
      const score = (sliderMarkerPattern.test(marker) ? 240 : 0) + (insideMenu ? 160 : 0);
      const input = element instanceof HTMLInputElement ? element : undefined;
      const elementBox = element.getBoundingClientRect();
      let trackElement: HTMLElement = element;
      let ancestor = element.parentElement;
      for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        const box = ancestor.getBoundingClientRect();
        if (box.width >= Math.max(120, elementBox.width * 2) && box.height <= Math.max(72, elementBox.height * 2.5)) {
          trackElement = ancestor;
          break;
        }
      }
      const numberOf = (attribute: string, fallback: number) => {
        const parsed = Number(element.getAttribute(attribute));
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      return {
        element,
        trackElement,
        score,
        valueText: element.getAttribute('aria-valuetext') || announcedValue,
        min: input ? Number(input.min || 0) : numberOf('aria-valuemin', 0),
        max: input ? Number(input.max || 100) : numberOf('aria-valuemax', 100),
        step: input ? Number(input.step || 1) : 1,
        value: input ? Number(input.value) : numberOf('aria-valuenow', 0)
      };
    })
    .filter((candidate) => candidate.score >= 160)
    .sort((left, right) => right.score - left.score)[0];
  const qualitySources = [slider?.valueText || '', composer?.label || ''];
  const quality = qualitySources.map(classify).find((level) => level !== 'unknown') || 'unknown';
  return {
    composerLabel: composer?.label || '',
    composerTarget: composer ? targetOf(composer.element) : undefined,
    quality,
    slider: slider ? {
      target: targetOf(slider.element),
      track: {
        left: slider.trackElement.getBoundingClientRect().left,
        width: slider.trackElement.getBoundingClientRect().width,
        y: targetOf(slider.trackElement).y
      },
      min: Number.isFinite(slider.min) ? slider.min : 0,
      max: Number.isFinite(slider.max) ? slider.max : 100,
      step: Number.isFinite(slider.step) && slider.step > 0 ? slider.step : 1,
      value: Number.isFinite(slider.value) ? slider.value : 0,
      valueText: slider.valueText
    } : undefined
  };
}, {
  composerModePattern: chatGptModelDomPolicy.composerModePattern,
  sliderMarkerPattern: chatGptReasoningDomPolicy.sliderMarkerPattern,
  extremeLabelPattern: chatGptReasoningDomPolicy.extremeLabelPattern,
  highLabelPattern: chatGptReasoningDomPolicy.highLabelPattern,
  mediumLabelPattern: chatGptReasoningDomPolicy.mediumLabelPattern,
  lowLabelPattern: chatGptReasoningDomPolicy.lowLabelPattern
});

async function probeReasoning(webContents: ChatGptWebContentsLike) {
  return webContents.executeJavaScript<ChatGptReasoningProbe>(reasoningProbeScript, true);
}

export async function readChatGptReasoningState(webContents: ChatGptWebContentsLike) {
  const snapshot = await probeReasoning(webContents);
  return { modelLabel: snapshot.composerLabel, quality: snapshot.quality };
}

async function dispatchTrustedClick(webContents: ChatGptWebContentsLike, target: { x: number; y: number }) {
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target });
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...target, button: 'left', clickCount: 1
  });
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...target, button: 'left', clickCount: 1
  });
}

async function confirmCurrentReasoning(
  webContents: ChatGptWebContentsLike,
  model: string,
  before: ChatGptReasoningLevel,
  target: Exclude<ChatGptReasoningLevel, 'unknown'>,
  steps: number
) {
  await closeMenus(webContents);
  const finalSnapshot = await probeReasoning(webContents);
  if (finalSnapshot.quality !== target) throw new Error(`${model} 的${reasoningLabel(target)}强度状态没有稳定保留。`);
  return { required: true, confirmed: true, model, before, after: target, steps };
}

function reasoningLabel(level: Exclude<ChatGptReasoningLevel, 'unknown'>) {
  return level === 'low' ? '低' : level === 'medium' ? '中' : level === 'extreme' ? '极高' : '高';
}

async function dispatchTrustedKey(webContents: ChatGptWebContentsLike, key: 'Home' | 'ArrowLeft' | 'ArrowRight') {
  const windowsVirtualKeyCode = key === 'Home' ? 36 : key === 'ArrowLeft' ? 37 : 39;
  await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code: key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode
  });
  await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code: key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode
  });
}

async function closeMenus(webContents: ChatGptWebContentsLike) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
    });
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
    });
    await wait(120);
  }
}

export async function ensureChatGptReasoning(
  webContents: ChatGptWebContentsLike,
  requestedModel = '',
  target: Exclude<ChatGptReasoningLevel, 'unknown'> = 'high'
): Promise<ChatGptReasoningResult> {
  let snapshot = await probeReasoning(webContents);
  const model = requestedModel.trim() || snapshot.composerLabel;
  const required = shouldForceChatGptHighReasoning(model);
  const before = snapshot.quality;
  if (!required) return { required: false, confirmed: false, model, before, after: before, steps: 0 };
  if (before === target) return { required: true, confirmed: true, model, before, after: before, steps: 0 };

  await closeMenus(webContents);
  snapshot = await probeReasoning(webContents);
  if (!snapshot.composerTarget) {
    throw new Error(`无法找到 ${model} 的思考强度入口。`);
  }

  try {
    for (let openAttempt = 0; openAttempt < 2; openAttempt += 1) {
      if (openAttempt > 0) {
        await closeMenus(webContents);
        snapshot = await probeReasoning(webContents);
        if (!snapshot.composerTarget) throw new Error(`无法找到 ${model} 的思考强度入口。`);
      }
      const composerTarget = snapshot.composerTarget;
      if (!composerTarget) throw new Error(`无法找到 ${model} 的思考强度入口。`);
      await dispatchTrustedClick(webContents, composerTarget);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await wait(120);
        snapshot = await probeReasoning(webContents);
        if (snapshot.quality === target) {
          await closeMenus(webContents);
          return { required: true, confirmed: true, model, before, after: target, steps: 0 };
        }
        if (snapshot.slider) break;
      }
      if (snapshot.slider) break;
    }
    if (!snapshot.slider) throw new Error(`没有找到 ${model} 的思考强度滑块。`);

    const slider = snapshot.slider;
    await dispatchTrustedClick(webContents, slider.target);
    await dispatchTrustedKey(webContents, 'Home');
    await wait(220);
    const positions = Math.max(2, Math.round(
      (slider.max - slider.min) / slider.step
    ) + 1);
    snapshot = await probeReasoning(webContents);
    if (snapshot.quality === target) {
      return confirmCurrentReasoning(webContents, model, before, target, 0);
    }
    if (slider.track.width > 0) {
      const track = slider.track;
      const targetFractions = target === 'low'
        ? [0, 0.08, 0.16, 0.25]
        : target === 'medium'
          ? [0.35, 0.45, 0.5, 0.55, 0.6]
          : target === 'extreme'
            ? [1, 0.92, 0.84]
            : [0.6, 2 / 3, 0.7, 0.75, 0.8];
      for (const fraction of targetFractions) {
        await dispatchTrustedClick(webContents, {
          x: track.left + track.width * fraction,
          y: track.y
        });
        await wait(220);
        snapshot = await probeReasoning(webContents);
        if (snapshot.quality === target) {
          return confirmCurrentReasoning(webContents, model, before, target, Math.round(fraction * (positions - 1)));
        }
      }
      if (positions <= 12) {
        for (let step = 0; step < positions; step += 1) {
          await dispatchTrustedKey(webContents, 'ArrowLeft');
          await wait(80);
        }
      } else {
        await dispatchTrustedKey(webContents, 'Home');
        await wait(220);
      }
    }
    const boundedPositions = Math.min(120, positions);
    const stepWaitMs = positions > 12 ? 80 : 220;
    for (let step = 0; step < boundedPositions; step += 1) {
      snapshot = await probeReasoning(webContents);
      if (snapshot.quality === target) {
        return confirmCurrentReasoning(webContents, model, before, target, step);
      }
      if (step < boundedPositions - 1) {
        await dispatchTrustedKey(webContents, 'ArrowRight');
        await wait(stepWaitMs);
      }
    }
    throw new Error(`${model} 的思考强度滑块遍历完成后仍未确认“${reasoningLabel(target)}”。`);
  } catch (error) {
    await closeMenus(webContents).catch(() => undefined);
    throw error;
  }
}

export async function ensureChatGptHighReasoning(
  webContents: ChatGptWebContentsLike,
  requestedModel = ''
): Promise<ChatGptHighReasoningResult> {
  return ensureChatGptReasoning(webContents, requestedModel, 'high');
}
