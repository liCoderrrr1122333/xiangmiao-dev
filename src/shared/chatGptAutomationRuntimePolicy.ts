export const chatGptAutomationMaxBatchCount = 100;
export const chatGptAdaptiveBaseIntervalMs = 60_000;
export const chatGptAdaptiveSlowIntervalMs = 90_000;
export const chatGptAdaptiveRecoveryIntervalMs = 120_000;
export const chatGptBatchRestEvery = 10;
export const chatGptBatchRestMs = 120_000;
export const chatGptGenerationNoSignalTimeoutMs = 60_000;
export const chatGptGenerationSettledNoImageGraceMs = 15_000;
export const chatGptGenerationHardTimeoutMs = 180_000;
export const chatGptProtectionWindowMs = 60 * 60 * 1000;
export const chatGptProtectionInitialCooldownMs = 5 * 60 * 1000;
export const chatGptProtectionRepeatedCooldownMs = 15 * 60 * 1000;

export type ChatGptWorkMode = 'quality' | 'balanced' | 'fast' | 'direct';

export function chatGptReasoningTargetForWorkMode(mode: ChatGptWorkMode | undefined) {
  if (mode === 'direct') return undefined;
  return mode === 'fast' ? 'low' as const : mode === 'balanced' ? 'medium' as const : 'high' as const;
}

export function planChatGptConfigurationSync(mode: ChatGptWorkMode | undefined) {
  if (mode === 'direct') {
    return {
      inspectModel: false,
      inspectThinking: false,
      modelLogLabel: '沿用网页当前设置（未探测）'
    } as const;
  }
  return {
    inspectModel: true,
    inspectThinking: true,
    modelLogLabel: undefined
  } as const;
}

export type ChatGptTaskRuntimeStatus =
  | 'WAITING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'PAUSED'
  | 'PROTECTION_PAUSED'
  | 'MANUAL_REVIEW';

export type ChatGptProtectionPhase =
  | 'IDLE'
  | 'PROTECTION_PAUSED'
  | 'RECOVERING_ONE_LANE'
  | 'RECOVERING_TWO_LANES';

export interface ChatGptProtectionState {
  phase: ChatGptProtectionPhase;
  recoveryChecked: boolean;
  manualCheckRequired: boolean;
  healthyCompletions: number;
}

export type ChatGptProtectionEvent =
  | 'detected'
  | 'page-recovered'
  | 'page-still-limited'
  | 'task-success'
  | 'task-failure';

export interface ChatGptTaskRuntimeRecord {
  taskIndex: number;
  status: ChatGptTaskRuntimeStatus;
  attempts: number;
  startedAt?: number;
  updatedAt: number;
  resultPath?: string;
  error?: string;
}

export interface ChatGptRuntimeSample {
  durationMs: number;
  responseMs: number;
  success: boolean;
  rateLimited: boolean;
  completedAt: number;
}

export interface ChatGptAdaptivePacingInput {
  recentSamples: ChatGptRuntimeSample[];
  completedSinceRest: number;
  cooldownUntil: number;
}

export interface ChatGptAdaptivePacingPlan {
  mode: 'normal' | 'balanced' | 'slow' | 'rest' | 'cooldown';
  minimumSubmissionIntervalMs: number;
  waitMs: number;
  averageDurationMs: number;
  averageResponseMs: number;
  failureRate: number;
}

export interface ChatGptCooldownRecoveryInput {
  cooldownUntil: number;
  now: number;
  pageLimited: boolean;
  acknowledgementAvailable: boolean;
  manualCheckRequested?: boolean;
  composerReady?: boolean;
  pageStable?: boolean;
}

export type ChatGptCooldownRecoveryAction = 'wait' | 'resume' | 'manual-check';

export interface ChatGptProtectionEscalationPlan {
  cooldownMs: number;
  manualOnly: boolean;
  detectionTimestamps: number[];
}

export interface ChatGptGenerationWaitInput {
  elapsedMs: number;
  assistantAdvanced: boolean;
  busy: boolean;
  stopVisible: boolean;
  candidateCount: number;
  settledWithoutImageMs: number;
}

export type ChatGptGenerationWaitAction =
  | 'continue'
  | 'no-signal'
  | 'settled-without-image'
  | 'hard-timeout';

function finiteDuration(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function createChatGptProtectionState(value?: Partial<ChatGptProtectionState>): ChatGptProtectionState {
  const phases = new Set<ChatGptProtectionPhase>([
    'IDLE',
    'PROTECTION_PAUSED',
    'RECOVERING_ONE_LANE',
    'RECOVERING_TWO_LANES'
  ]);
  return {
    phase: phases.has(value?.phase as ChatGptProtectionPhase)
      ? value?.phase as ChatGptProtectionPhase
      : 'IDLE',
    recoveryChecked: value?.recoveryChecked === true,
    manualCheckRequired: value?.manualCheckRequired === true,
    healthyCompletions: Math.max(0, Math.min(3, Math.round(Number(value?.healthyCompletions) || 0)))
  };
}

export function shouldReconcileChatGptProtectionFromLoginCheck(input: {
  phase: ChatGptProtectionPhase;
  loginUsable: boolean;
  cooldownUntil: number;
  now?: number;
}) {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  return input.phase === 'PROTECTION_PAUSED'
    && input.loginUsable
    && finiteDuration(input.cooldownUntil) <= now;
}

export function transitionChatGptProtectionState(
  current: ChatGptProtectionState,
  event: ChatGptProtectionEvent,
  requestedParallelism: number
) {
  const state = createChatGptProtectionState(current);
  const requested = Math.max(1, Math.min(3, Math.round(requestedParallelism) || 1));
  if (event === 'detected') {
    const next = createChatGptProtectionState({ phase: 'PROTECTION_PAUSED' });
    return { state: next, activeParallelism: 0 };
  }
  if (event === 'page-still-limited') {
    if (state.phase === 'PROTECTION_PAUSED' && state.recoveryChecked && state.manualCheckRequired) {
      return { state, activeParallelism: 0 };
    }
    const next = createChatGptProtectionState({
      phase: 'PROTECTION_PAUSED',
      recoveryChecked: true,
      manualCheckRequired: true
    });
    return { state: next, activeParallelism: 0 };
  }
  if (event === 'page-recovered') {
    const next = createChatGptProtectionState({
      phase: requested > 1 ? 'RECOVERING_ONE_LANE' : 'IDLE',
      recoveryChecked: true
    });
    return { state: next, activeParallelism: 1 };
  }
  if (event === 'task-failure') {
    if (state.phase === 'RECOVERING_ONE_LANE' || state.phase === 'RECOVERING_TWO_LANES') {
      const next = createChatGptProtectionState({ phase: 'RECOVERING_ONE_LANE', recoveryChecked: true });
      return { state: next, activeParallelism: 1 };
    }
    return { state, activeParallelism: requested };
  }
  if (event === 'task-success' && state.phase === 'RECOVERING_ONE_LANE') {
    const healthyCompletions = state.healthyCompletions + 1;
    if (healthyCompletions < 3) {
      const next = createChatGptProtectionState({ ...state, healthyCompletions });
      return { state: next, activeParallelism: 1 };
    }
    const next = createChatGptProtectionState({
      phase: requested > 2 ? 'RECOVERING_TWO_LANES' : 'IDLE',
      recoveryChecked: true,
      healthyCompletions: 0
    });
    return { state: next, activeParallelism: Math.min(2, requested) };
  }
  if (event === 'task-success' && state.phase === 'RECOVERING_TWO_LANES') {
    const healthyCompletions = state.healthyCompletions + 1;
    if (healthyCompletions >= 3) {
      return { state: createChatGptProtectionState(), activeParallelism: requested };
    }
    const next = createChatGptProtectionState({ ...state, healthyCompletions });
    return { state: next, activeParallelism: Math.min(2, requested) };
  }
  return { state, activeParallelism: requested };
}

export function nextChatGptCooldownDeadline(currentDeadline: number, now: number, durationMs: number) {
  const current = finiteDuration(currentDeadline);
  const timestamp = finiteDuration(now);
  if (current > timestamp) return current;
  return timestamp + finiteDuration(durationMs);
}

export function planChatGptProtectionEscalation(
  detectionTimestamps: readonly number[],
  now: number
): ChatGptProtectionEscalationPlan {
  const timestamp = finiteDuration(now);
  const recent = detectionTimestamps
    .map(finiteDuration)
    .filter((detectedAt) => detectedAt > timestamp - chatGptProtectionWindowMs && detectedAt <= timestamp)
    .sort((left, right) => left - right);
  const nextTimestamps = [...recent, timestamp];
  if (nextTimestamps.length >= 3) {
    return { cooldownMs: 0, manualOnly: true, detectionTimestamps: nextTimestamps };
  }
  return {
    cooldownMs: nextTimestamps.length === 2
      ? chatGptProtectionRepeatedCooldownMs
      : chatGptProtectionInitialCooldownMs,
    manualOnly: false,
    detectionTimestamps: nextTimestamps
  };
}

export function planChatGptGenerationWait(
  input: ChatGptGenerationWaitInput
): { action: ChatGptGenerationWaitAction } {
  const elapsedMs = finiteDuration(input.elapsedMs);
  if (elapsedMs >= chatGptGenerationHardTimeoutMs) return { action: 'hard-timeout' };
  const generating = input.busy || input.stopVisible;
  if (
    input.assistantAdvanced &&
    !generating &&
    input.candidateCount === 0 &&
    finiteDuration(input.settledWithoutImageMs) >= chatGptGenerationSettledNoImageGraceMs
  ) {
    return { action: 'settled-without-image' };
  }
  if (
    !input.assistantAdvanced &&
    !generating &&
    input.candidateCount === 0 &&
    elapsedMs >= chatGptGenerationNoSignalTimeoutMs
  ) {
    return { action: 'no-signal' };
  }
  return { action: 'continue' };
}

export function planChatGptCooldownRecovery(
  input: ChatGptCooldownRecoveryInput
): { action: ChatGptCooldownRecoveryAction; waitMs: number } {
  const waitMs = Math.max(0, finiteDuration(input.cooldownUntil) - finiteDuration(input.now));
  if (waitMs > 0) return { action: 'wait', waitMs };
  const manuallyVerified = input.manualCheckRequested === true &&
    input.pageLimited === false &&
    input.composerReady === true &&
    input.pageStable === true;
  return { action: manuallyVerified ? 'resume' : 'manual-check', waitMs: 0 };
}

export function normalizeChatGptRuntimeSamples(value: unknown): ChatGptRuntimeSample[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Partial<ChatGptRuntimeSample> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      durationMs: finiteDuration(Number(item.durationMs)),
      responseMs: finiteDuration(Number(item.responseMs)),
      success: item.success === true,
      rateLimited: item.rateLimited === true,
      completedAt: finiteDuration(Number(item.completedAt))
    }))
    .filter((item) => item.completedAt > 0)
    .slice(-10);
}

export function appendChatGptRuntimeSample(
  current: ChatGptRuntimeSample[],
  sample: ChatGptRuntimeSample
) {
  return normalizeChatGptRuntimeSamples([...current, sample]).slice(-10);
}

export function createChatGptTaskRuntimeRecords(
  total: number,
  completedTaskIndices: number[] = [],
  now = Date.now()
): ChatGptTaskRuntimeRecord[] {
  const normalizedTotal = Math.max(1, Math.min(chatGptAutomationMaxBatchCount, Math.round(total) || 1));
  const completed = new Set(completedTaskIndices);
  return Array.from({ length: normalizedTotal }, (_, index) => ({
    taskIndex: index + 1,
    status: completed.has(index + 1) ? 'SUCCESS' : 'WAITING',
    attempts: 0,
    updatedAt: now
  }));
}

export function normalizeChatGptTaskRuntimeRecords(
  value: unknown,
  total: number,
  completedTaskIndices: number[] = [],
  now = Date.now()
) {
  const baseline = createChatGptTaskRuntimeRecords(total, completedTaskIndices, now);
  if (!Array.isArray(value)) return baseline;
  const allowed = new Set<ChatGptTaskRuntimeStatus>([
    'WAITING',
    'PROCESSING',
    'SUCCESS',
    'FAILED',
    'PAUSED',
    'PROTECTION_PAUSED',
    'MANUAL_REVIEW'
  ]);
  const byIndex = new Map<number, ChatGptTaskRuntimeRecord>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const source = candidate as Partial<ChatGptTaskRuntimeRecord>;
    const taskIndex = Math.round(Number(source.taskIndex));
    if (taskIndex < 1 || taskIndex > baseline.length || !allowed.has(source.status as ChatGptTaskRuntimeStatus)) continue;
    byIndex.set(taskIndex, {
      taskIndex,
      status: source.status === 'PROCESSING' ? 'WAITING' : source.status as ChatGptTaskRuntimeStatus,
      attempts: Math.max(0, Math.round(Number(source.attempts) || 0)),
      startedAt: source.startedAt ? finiteDuration(Number(source.startedAt)) : undefined,
      updatedAt: finiteDuration(Number(source.updatedAt)) || now,
      resultPath: typeof source.resultPath === 'string' ? source.resultPath : undefined,
      error: typeof source.error === 'string' ? source.error.slice(0, 1000) : undefined
    });
  }
  return baseline.map((record) => {
    const stored = byIndex.get(record.taskIndex);
    if (!stored) return record;
    if (completedTaskIndices.includes(record.taskIndex)) return { ...stored, status: 'SUCCESS' as const };
    return stored;
  });
}

export function updateChatGptTaskRuntimeRecord(
  records: ChatGptTaskRuntimeRecord[],
  taskIndex: number,
  status: ChatGptTaskRuntimeStatus,
  patch: Partial<Omit<ChatGptTaskRuntimeRecord, 'taskIndex' | 'status'>> = {}
) {
  const now = Date.now();
  return records.map((record) => record.taskIndex === taskIndex
    ? {
        ...record,
        ...patch,
        taskIndex,
        status,
        updatedAt: patch.updatedAt ?? now
      }
    : record);
}

export function planChatGptAdaptivePacing(
  input: ChatGptAdaptivePacingInput,
  now = Date.now()
): ChatGptAdaptivePacingPlan {
  const samples = normalizeChatGptRuntimeSamples(input.recentSamples);
  const divisor = Math.max(1, samples.length);
  const averageDurationMs = Math.round(samples.reduce((sum, sample) => sum + sample.durationMs, 0) / divisor);
  const averageResponseMs = Math.round(samples.reduce((sum, sample) => sum + sample.responseMs, 0) / divisor);
  const failureRate = samples.filter((sample) => !sample.success).length / divisor;
  const cooldownWaitMs = Math.max(0, finiteDuration(input.cooldownUntil) - finiteDuration(now));

  if (cooldownWaitMs > 0) {
    return {
      mode: 'cooldown',
      minimumSubmissionIntervalMs: chatGptAdaptiveRecoveryIntervalMs,
      waitMs: cooldownWaitMs,
      averageDurationMs,
      averageResponseMs,
      failureRate
    };
  }

  if (input.completedSinceRest >= chatGptBatchRestEvery) {
    return {
      mode: 'rest',
      minimumSubmissionIntervalMs: chatGptAdaptiveBaseIntervalMs,
      waitMs: chatGptBatchRestMs,
      averageDurationMs,
      averageResponseMs,
      failureRate
    };
  }

  const severeDegradation = failureRate >= 0.3 || averageResponseMs >= 60_000 || averageDurationMs >= 300_000;
  const moderateDegradation = failureRate >= 0.1 || averageResponseMs >= 30_000 || averageDurationMs >= 180_000;
  return {
    mode: severeDegradation ? 'slow' : moderateDegradation ? 'balanced' : 'normal',
    minimumSubmissionIntervalMs: severeDegradation
      ? chatGptAdaptiveRecoveryIntervalMs
      : moderateDegradation
        ? chatGptAdaptiveSlowIntervalMs
        : chatGptAdaptiveBaseIntervalMs,
    waitMs: 0,
    averageDurationMs,
    averageResponseMs,
    failureRate
  };
}
