export type GeminiFailureCode =
  | 'login-required'
  | 'region-blocked'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'model-unavailable'
  | 'attachment-missing'
  | 'safety-blocked'
  | 'generation-failed'
  | 'network-failed';

export interface GeminiFailureClassification {
  code: GeminiFailureCode;
  global: boolean;
  retryable: boolean;
}

export function classifyGeminiFailure(message: string): GeminiFailureClassification | undefined {
  const value = message.replace(/\s+/g, ' ').trim();
  if (!value) return undefined;
  if (/(?:需要|请先|重新).{0,12}(?:登录|登入)|sign\s*in|log\s*in|session.{0,8}expired/i.test(value)) {
    return { code: 'login-required', global: true, retryable: false };
  }
  if (/(?:暂不|尚不|不).{0,12}支持.{0,12}(?:地区|区域|国家)|not (?:available|supported).{0,20}(?:region|country)|unsupported region/i.test(value)) {
    return { code: 'region-blocked', global: true, retryable: false };
  }
  if (/(?:达到|超过|已用完).{0,12}(?:使用|生成|账号|账户)?.{0,12}(?:上限|额度)|(?:使用|生成|账号|账户).{0,12}(?:上限|额度).{0,12}(?:达到|不足|用完|耗尽)|quota|usage limit|plan limit|out of credits/i.test(value)) {
    return { code: 'quota-exceeded', global: true, retryable: false };
  }
  if (/请求过于频繁|频率.{0,10}(?:限制|上限)|rate limit|too many requests/i.test(value)) {
    return { code: 'rate-limited', global: false, retryable: true };
  }
  if (/(?:指定|所选|当前).{0,12}模型.{0,16}(?:不可用|不支持|无法使用)|model.{0,20}(?:unavailable|not available|unsupported)/i.test(value)) {
    return { code: 'model-unavailable', global: true, retryable: false };
  }
  if (/(?:没有|未).{0,12}(?:附带|上传|收到).{0,16}(?:图片|图像|照片|附件)|(?:图片|图像|照片|附件).{0,16}(?:没有|未).{0,12}(?:附带|上传|收到)|no (?:image|photo|attachment).{0,20}(?:attached|uploaded|provided)|did not receive.{0,16}(?:image|photo|attachment)/i.test(value)) {
    return { code: 'attachment-missing', global: false, retryable: true };
  }
  if (/(?:只是|仅是).{0,10}(?:语言|文字).{0,8}模型.{0,36}(?:不具备|没有).{0,30}(?:能力|信息).{0,30}(?:没法|无法|不能).{0,12}(?:帮|处理|完成)/i.test(value)) {
    return { code: 'generation-failed', global: false, retryable: false };
  }
  if (/(?:安全|政策|规则|违规).{0,20}(?:限制|无法|拒绝)|safety|policy|not able to help with that/i.test(value)) {
    return { code: 'safety-blocked', global: false, retryable: false };
  }
  if (/(?:无法|未能|不能).{0,20}(?:生成|制作|创建).{0,12}(?:图片|图像)|(?:图片|图像).{0,16}(?:生成失败|制作失败)|unable to.{0,16}(?:generate|create).{0,12}(?:image|picture)|image generation failed/i.test(value)) {
    return { code: 'generation-failed', global: false, retryable: true };
  }
  if (/网络.{0,10}(?:错误|断开|失败)|连接.{0,10}(?:失败|中断)|network error|connection (?:failed|lost)|something went wrong/i.test(value)) {
    return { code: 'network-failed', global: false, retryable: true };
  }
  return undefined;
}

export interface GeminiSendBaseline {
  userMessageCount: number;
  responseCount: number;
  href: string;
}

export interface GeminiSendSnapshot {
  composerTextLength: number;
  attachmentCount: number;
  userMessageCount: number;
  responseCount: number;
  busy: boolean;
  href: string;
}

export function hasGeminiSendBeenAccepted(
  baseline: GeminiSendBaseline,
  snapshot: GeminiSendSnapshot
) {
  const messageProgress =
    snapshot.userMessageCount > baseline.userMessageCount ||
    snapshot.responseCount > baseline.responseCount;
  const routeProgress = snapshot.href !== baseline.href;
  const startsOnFreshGeminiEntry = /^https:\/\/(?:[^/]+\.)?gemini\.google\.com\/app\/?(?:[?#].*)?$/i.test(baseline.href);
  if (startsOnFreshGeminiEntry) {
    return routeProgress && (messageProgress || snapshot.composerTextLength === 0);
  }
  return messageProgress || (routeProgress && snapshot.composerTextLength === 0);
}

export function canSafelyRetryGeminiSend(
  baseline: GeminiSendBaseline,
  snapshot?: GeminiSendSnapshot & { accepted?: boolean }
) {
  return (
    !snapshot?.accepted &&
    Boolean(snapshot?.composerTextLength) &&
    snapshot?.busy !== true &&
    (snapshot?.userMessageCount ?? baseline.userMessageCount) <= baseline.userMessageCount &&
    (snapshot?.responseCount ?? baseline.responseCount) <= baseline.responseCount &&
    (snapshot?.href || baseline.href) === baseline.href
  );
}

export interface GeminiTextCandidate {
  index: number;
  text: string;
  streaming?: boolean;
  userEcho?: boolean;
}

export function selectGeminiTextResult(
  baseline: Pick<GeminiSendBaseline, 'responseCount'>,
  candidates: GeminiTextCandidate[]
) {
  return candidates
    .filter((candidate) => candidate.index >= baseline.responseCount && !candidate.userEcho && candidate.text.trim())
    .sort((left, right) => right.index - left.index || right.text.length - left.text.length)
    .find((candidate) => !candidate.streaming) ||
    candidates
      .filter((candidate) => candidate.index >= baseline.responseCount && !candidate.userEcho && candidate.text.trim())
      .sort((left, right) => right.index - left.index || right.text.length - left.text.length)[0];
}

export function selectGeminiFailureText(
  baseline: Pick<GeminiSendBaseline, 'responseCount'>,
  candidates: GeminiTextCandidate[],
  pageFailureText = ''
) {
  if (classifyGeminiFailure(pageFailureText)) return pageFailureText;
  return selectGeminiTextResult(baseline, candidates)?.text || pageFailureText;
}

export interface GeminiImageCandidateEvidence {
  responseIndex: number;
  imageIndex: number;
  src: string;
  width: number;
  height: number;
  alt: string;
  visible: boolean;
}

export function selectGeminiImageCandidate<T extends GeminiImageCandidateEvidence>(
  knownSources: ReadonlySet<string>,
  candidates: T[]
) {
  return candidates
    .filter((image) => image.src && !knownSources.has(image.src))
    .filter((image) => image.visible && image.width >= 256 && image.height >= 256)
    .sort(
      (left, right) =>
        right.responseIndex - left.responseIndex ||
        right.width * right.height - left.width * left.height ||
        right.imageIndex - left.imageIndex
    )[0];
}
