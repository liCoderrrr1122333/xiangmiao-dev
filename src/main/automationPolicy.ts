import path from 'node:path';

export interface UploadEvidence {
  evidenceCount: number;
  nameHits: number;
  previewCount: number;
  removeButtonCount: number;
  fileInputCount?: number;
  busyCount?: number;
  expectedCount?: number;
  uploadErrorText?: string;
}

export function observedUploadCount(baseline: UploadEvidence, snapshot?: UploadEvidence) {
  if (!snapshot || snapshot.uploadErrorText) return 0;
  return Math.max(
    0,
    snapshot.evidenceCount - baseline.evidenceCount,
    snapshot.nameHits - baseline.nameHits,
    snapshot.previewCount - baseline.previewCount,
    snapshot.removeButtonCount - baseline.removeButtonCount
  );
}

export function hasCompleteUploadEvidence(baseline: UploadEvidence, snapshot?: UploadEvidence) {
  if (!snapshot || snapshot.uploadErrorText) return false;
  const expected = Math.max(1, snapshot.expectedCount || 1);
  return observedUploadCount(baseline, snapshot) >= expected;
}

export function nextStableUploadPollCount(
  baseline: UploadEvidence,
  snapshot: UploadEvidence | undefined,
  currentCount: number
) {
  return hasCompleteUploadEvidence(baseline, snapshot) && (snapshot?.busyCount || 0) === 0
    ? currentCount + 1
    : 0;
}

export interface ChatGptAnalysisCompletionEvidence {
  hasUsefulText: boolean;
  hasStructuredAnalysis: boolean;
  generationActive: boolean;
  stableForMs: number;
}

export interface ChatGptAnalysisTextCandidate {
  text: string;
  source: string;
  domIndex: number;
  isNew: boolean;
  assistantAssociated: boolean;
  userAssociated: boolean;
  composerAssociated: boolean;
  promptEcho: boolean;
  structuredFieldHits: number;
  pendingOnly: boolean;
}

export function scoreChatGptAnalysisCandidate(candidate: ChatGptAnalysisTextCandidate) {
  if (
    candidate.text.trim().length < 40 ||
    candidate.userAssociated ||
    candidate.composerAssociated ||
    candidate.promptEcho ||
    candidate.pendingOnly
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  const sourceBonus =
    candidate.source === 'conversation-api'
      ? 1000
      : candidate.source === 'conversation-textdoc'
        ? 975
        : candidate.source === 'assistant-role'
          ? 900
      : candidate.source === 'assistant-content'
        ? 875
        : candidate.source === 'assistant-code'
          ? 850
      : candidate.source === 'assistant-testid'
        ? 800
        : candidate.source === 'artifact'
          ? 775
          : candidate.source === 'canvas'
            ? 750
        : candidate.source === 'conversation-turn'
          ? 700
          : candidate.source === 'message-id'
            ? 600
            : candidate.source === 'article'
              ? 500
              : 0;

  return (
    Math.min(candidate.text.length, 2500) +
    candidate.structuredFieldHits * 1800 +
    (candidate.isNew ? 3000 : 0) +
    (candidate.assistantAssociated ? 2500 : 0) +
    sourceBonus
  );
}

export function selectBestChatGptAnalysisCandidate(candidates: ChatGptAnalysisTextCandidate[]) {
  return candidates
    .map((candidate) => ({ candidate, score: scoreChatGptAnalysisCandidate(candidate) }))
    .filter((item) => Number.isFinite(item.score))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.domIndex - left.candidate.domIndex ||
        right.candidate.text.length - left.candidate.text.length
    )[0]?.candidate;
}

export function shouldAcceptChatGptAnalysis(evidence: ChatGptAnalysisCompletionEvidence) {
  if (!evidence.hasUsefulText) return false;
  if (evidence.hasStructuredAnalysis) return true;
  return !evidence.generationActive && evidence.stableForMs >= 1500;
}

export function shouldUseChatGptAnalysisTimeoutFallback(evidence: Pick<ChatGptAnalysisCompletionEvidence, 'hasUsefulText'>) {
  return evidence.hasUsefulText;
}

export function shouldRetryChatGptNoOpSend(
  baseline: { userMessageCount: number; messageNodeCount: number },
  snapshot?: {
    accepted: boolean;
    terminalFailure?: string;
    composerTextLength: number;
    attachmentCount: number;
    userMessageCount: number;
    messageNodeCount: number;
    pageChanged: boolean;
    stopVisible: boolean;
    busyCount: number;
  }
) {
  return Boolean(
    snapshot &&
      !snapshot.accepted &&
      !snapshot.terminalFailure &&
      snapshot.composerTextLength > 0 &&
      snapshot.attachmentCount > 0 &&
      snapshot.userMessageCount === baseline.userMessageCount &&
      snapshot.messageNodeCount === baseline.messageNodeCount &&
      !snapshot.pageChanged &&
      !snapshot.stopVisible &&
      snapshot.busyCount === 0
  );
}

export function shouldRejectSettledStructuredResponse(evidence: {
  hasResponseText: boolean;
  hasStructuredResponse: boolean;
  generationActive: boolean;
  stableForMs: number;
}) {
  return (
    evidence.hasResponseText &&
    !evidence.hasStructuredResponse &&
    !evidence.generationActive &&
    evidence.stableForMs >= 5_000
  );
}

export function sanitizeWindowsFileName(name: string, fallback = '像锚项目') {
  const withoutControlChars = [...name].map((char) => (char.charCodeAt(0) < 32 ? '_' : char)).join('');
  let safe = withoutControlChars
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);

  if (!safe || /^\.+$/.test(safe)) safe = fallback;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  return safe.replace(/[. ]+$/g, '') || fallback;
}

export function resolveContainedChild(root: string, childName: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedChild = path.resolve(resolvedRoot, childName);
  if (path.dirname(resolvedChild) !== resolvedRoot) {
    throw new Error(`不安全的输出名称：${childName}`);
  }
  return resolvedChild;
}

export type ImageNormalizationPlan = 'none' | 'resize-exact';

export const chatGptMaxAttemptsPerImage = 3;

export function planImageNormalization(
  source: { width: number; height: number },
  target?: { width: number; height: number }
): ImageNormalizationPlan {
  if (!target || (source.width === target.width && source.height === target.height)) return 'none';
  return 'resize-exact';
}

export function hasExactImageDimensions(
  actual: { width: number; height: number },
  target: { width: number; height: number }
) {
  return actual.width === target.width && actual.height === target.height;
}

export function shouldRetryChatGptBatchItem(options: {
  attempts: number;
  permanentFailure: boolean;
  pauseRequested: boolean;
}) {
  return (
    !options.permanentFailure &&
    !options.pauseRequested &&
    options.attempts < chatGptMaxAttemptsPerImage
  );
}

export const chatGptMinimumSubmissionIntervalMs = 60_000;
export const chatGptParallelLaneStartupIntervalMs = 10_000;

export function requiredChatGptSubmissionDelay(
  lastSubmittedAt: number,
  now: number,
  minimumIntervalMs = chatGptMinimumSubmissionIntervalMs
) {
  if (!Number.isFinite(lastSubmittedAt) || lastSubmittedAt <= 0) return 0;
  const interval = Math.max(0, Number.isFinite(minimumIntervalMs) ? minimumIntervalMs : 0);
  const elapsed = Number.isFinite(now) ? Math.max(0, now - lastSubmittedAt) : 0;
  return Math.max(0, interval - elapsed);
}
