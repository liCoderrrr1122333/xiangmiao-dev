import type { ChatGptModelCatalog, ChatGptModelOption } from './types.js';

export const followCurrentChatGptModel = 'follow-current';

export interface ChatGptModelControlCandidate {
  testId: string;
  ariaLabel: string;
  title: string;
  text: string;
  hasPopup: boolean;
  top: number;
  insideComposer: boolean;
  insideSidebar: boolean;
}

export const chatGptModelDomPolicy = {
  strongMarkerPattern: String.raw`model[-_ ]?(?:switcher|selector|picker)(?:[-_ ]dropdown)?`,
  semanticMarkerPattern: String.raw`(?:current[ -]?model|choose[ -]?model|select[ -]?model|model[ -]?(?:menu|selector|picker)|当前模型|选择模型|模型选择|模型切换)`,
  excludedMarkerPattern: String.raw`(?:accounts[-_ ]profile|profile[-_ ]button|user[-_ ]menu|account[-_ ]menu|avatar|个人资料|账户菜单|账号菜单|用户菜单|头像)`,
  excludedOptionPattern: String.raw`(?:learn more|manage plan|upgrade|subscribe|settings|help|了解详情|管理套餐|升级|订阅|设置|帮助)`,
  genericLabelPattern: String.raw`^(?:model|models|model selector|model picker|choose model|select model|current model|模型|模型选择器|选择模型|当前模型|打开.+菜单|open .+ menu)$`,
  composerModePattern: String.raw`^(?:(?:[\d.]+(?:\s+[a-z][\w.-]*)*\s*)?(?:auto|automatic|smart|fast|instant|thinking|reasoning|low|medium|high|extreme|智能|自动|极速|轻度|标准|扩展|低|中|高|极高)(?:\s*[\d.]+)?)$`,
  advancedMenuPattern: String.raw`^(?:advanced|more|高级|更多)$`,
  modelBranchPattern: String.raw`^(?:model|models|模型|选择模型|select model|choose model)$`,
  modelOptionPattern: String.raw`^(?:最新|latest|(?:chatgpt|gpt)[-\s]?\d[\w.-]*(?:\s+[\w.-]+)*|o\d[\w.-]*(?:\s+[\w.-]+)*)$`
} as const;

export const chatGptReasoningDomPolicy = {
  sliderMarkerPattern: String.raw`(?:reasoning|thinking|effort|intensity|思考|推理|强度)`,
  extremeLabelPattern: String.raw`(?:^|[\s,，:：/|()[\]{}<>_-])(?:extreme|xhigh|x-high|very high|极高|超高|最高)(?=$|[\s,，:：/|()[\]{}<>_-])`,
  highLabelPattern: String.raw`(?:^|[\s,，:：/|()[\]{}<>_-])(?:high|高)(?=$|[\s,，:：/|()[\]{}<>_-])`,
  mediumLabelPattern: String.raw`(?:^|[\s,，:：/|()[\]{}<>_-])(?:medium|standard|balanced|normal|中|标准)(?=$|[\s,，:：/|()[\]{}<>_-])`,
  lowLabelPattern: String.raw`(?:^|[\s,，:：/|()[\]{}<>_-])(?:low|light|低|轻度)(?=$|[\s,，:：/|()[\]{}<>_-])`
} as const;

export type ChatGptReasoningLevel = 'low' | 'medium' | 'high' | 'extreme' | 'unknown';

export function classifyChatGptReasoningLabel(value: string): ChatGptReasoningLevel {
  const normalized = value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (new RegExp(chatGptReasoningDomPolicy.extremeLabelPattern, 'i').test(normalized)) return 'extreme';
  if (new RegExp(chatGptReasoningDomPolicy.highLabelPattern, 'i').test(normalized)) return 'high';
  if (new RegExp(chatGptReasoningDomPolicy.mediumLabelPattern, 'i').test(normalized)) return 'medium';
  if (new RegExp(chatGptReasoningDomPolicy.lowLabelPattern, 'i').test(normalized)) return 'low';
  return 'unknown';
}

export function shouldForceChatGptHighReasoning(modelLabel: string) {
  const normalized = modelLabel.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (/^(?:最新|latest)$/.test(normalized)) return true;
  return /(?:^|(?:chatgpt|gpt)[-\s]?)5[.-](?:5|6)(?=$|[\s-])/.test(normalized);
}

export function scoreChatGptModelControl(candidate: ChatGptModelControlCandidate) {
  const marker = `${candidate.testId} ${candidate.ariaLabel} ${candidate.title} ${candidate.text}`.toLocaleLowerCase();
  const strong = new RegExp(chatGptModelDomPolicy.strongMarkerPattern, 'i').test(marker);
  const semantic = new RegExp(chatGptModelDomPolicy.semanticMarkerPattern, 'i').test(marker);
  const excluded =
    candidate.insideSidebar ||
    new RegExp(chatGptModelDomPolicy.excludedMarkerPattern, 'i').test(marker);
  if (excluded || (!strong && (!semantic || !candidate.hasPopup))) return -1;
  return (strong ? 220 : 100) + (candidate.hasPopup ? 20 : 0) + (candidate.top < 220 ? 10 : 0) -
    (candidate.insideComposer && !strong ? 40 : 0);
}

export function normalizeChatGptModelLabel(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/(?:current model|当前模型|已选择|selected)/gi, '')
    .trim()
    .toLocaleLowerCase();
}

export function isSameChatGptModelLabel(left: string, right: string) {
  const identity = (value: string) => normalizeChatGptModelLabel(value)
    .replace(/^(?:chatgpt|gpt)[-\s]?/i, '')
    .trim();
  const leftIdentity = identity(left);
  const rightIdentity = identity(right);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

export function isChatGptModelOptionLabel(value: string) {
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/(?:current model|当前模型|已选择|selected)/gi, '')
    .trim();
  return new RegExp(chatGptModelDomPolicy.modelOptionPattern, 'i').test(normalized);
}

export function isChatGptComposerModeLabel(value: string) {
  return new RegExp(chatGptModelDomPolicy.composerModePattern, 'i').test(value.replace(/\s+/g, ' ').trim());
}

export function isChatGptAdvancedMenuBranchLabel(value: string) {
  return new RegExp(chatGptModelDomPolicy.advancedMenuPattern, 'i').test(value.replace(/\s+/g, ' ').trim());
}

export function isChatGptModelMenuBranchLabel(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return new RegExp(chatGptModelDomPolicy.modelBranchPattern, 'i').test(normalized) || isChatGptModelOptionLabel(normalized);
}

export function dedupeChatGptModelOptions(options: ChatGptModelOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = normalizeChatGptModelLabel(option.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findRequestedChatGptModel(catalog: ChatGptModelCatalog, requested: string) {
  if (requested === followCurrentChatGptModel) return undefined;
  const normalized = normalizeChatGptModelLabel(requested);
  return catalog.models.find((model) => normalizeChatGptModelLabel(model.label) === normalized);
}
