import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  appendChatGptRuntimeSample,
  chatGptAdaptiveBaseIntervalMs,
  chatGptAdaptiveRecoveryIntervalMs,
  chatGptAutomationMaxBatchCount,
  chatGptReasoningTargetForWorkMode,
  planChatGptConfigurationSync,
  createChatGptTaskRuntimeRecords,
  createChatGptProtectionState,
  nextChatGptCooldownDeadline,
  planChatGptGenerationWait,
  planChatGptCooldownRecovery,
  planChatGptProtectionEscalation,
  planChatGptAdaptivePacing,
  shouldReconcileChatGptProtectionFromLoginCheck,
  transitionChatGptProtectionState,
  updateChatGptTaskRuntimeRecord
} from '../dist-electron/shared/chatGptAutomationRuntimePolicy.js';

test('work modes change reasoning without binding automation to a model name', () => {
  assert.equal(chatGptReasoningTargetForWorkMode('quality'), 'high');
  assert.equal(chatGptReasoningTargetForWorkMode('balanced'), 'medium');
  assert.equal(chatGptReasoningTargetForWorkMode('fast'), 'low');
  assert.equal(chatGptReasoningTargetForWorkMode('direct'), undefined);
  assert.equal(chatGptReasoningTargetForWorkMode(undefined), 'high');
});

test('direct mode performs zero model and reasoning inspection', () => {
  assert.deepEqual(planChatGptConfigurationSync('direct'), {
    inspectModel: false,
    inspectThinking: false,
    modelLogLabel: '沿用网页当前设置（未探测）'
  });
  assert.deepEqual(planChatGptConfigurationSync('quality'), {
    inspectModel: true,
    inspectThinking: true,
    modelLogLabel: undefined
  });
});

test('a clean install follows the live ChatGPT model and work modes never overwrite it', async () => {
  const [settingsStore, app] = await Promise.all([
    readFile(new URL('../src/renderer/state/settingsStore.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  ]);
  assert.match(settingsStore, /chatGptModel: 'follow-current'/);
  assert.match(settingsStore, /chatGptWorkMode: 'quality'/);
  const workModeUpdater = app.slice(
    app.indexOf('function updateChatGptWorkMode'),
    app.indexOf('async function refreshChatGptModels')
  );
  assert.match(workModeUpdater, /const patch = \{ chatGptWorkMode \}/);
  assert.doesNotMatch(workModeUpdater, /chatGptModel|GPT-5\.5/);
  assert.doesNotMatch(app, /GPT-5\.5 \/ (?:低|中|高)/);
  assert.match(app, /\['direct', '极简直传'/);
  assert.match(app, /settings\.chatGptWorkMode === 'direct'/);
  assert.match(app, /沿用 ChatGPT 网页当前模型与思考设置/);
});

test('ChatGPT batch runtime supports one hundred persisted task records', () => {
  assert.equal(chatGptAutomationMaxBatchCount, 100);
  const records = createChatGptTaskRuntimeRecords(100, [2, 100], 1000);
  assert.equal(records.length, 100);
  assert.equal(records[0].status, 'WAITING');
  assert.equal(records[1].status, 'SUCCESS');
  assert.equal(records[99].status, 'SUCCESS');

  const processing = updateChatGptTaskRuntimeRecord(records, 1, 'PROCESSING', {
    attempts: 1,
    startedAt: 1500,
    updatedAt: 1500
  });
  assert.equal(processing[0].status, 'PROCESSING');
  assert.equal(processing[0].attempts, 1);
  assert.equal(records[0].status, 'WAITING', 'checkpoint updates must be immutable');
  const manualReview = updateChatGptTaskRuntimeRecord(processing, 1, 'MANUAL_REVIEW', {
    attempts: 1,
    error: '已发送但结果需要人工确认',
    updatedAt: 2000
  });
  assert.equal(manualReview[0].status, 'MANUAL_REVIEW');

  const protectionPaused = updateChatGptTaskRuntimeRecord(processing, 1, 'PROTECTION_PAUSED', {
    attempts: 0,
    error: 'ChatGPT 访问保护，任务已安全暂停',
    updatedAt: 2100
  });
  assert.equal(protectionPaused[0].status, 'PROTECTION_PAUSED');
});

test('access protection pauses independently and restores one lane before parallel work', () => {
  const idle = createChatGptProtectionState();
  assert.equal(idle.phase, 'IDLE');

  const paused = transitionChatGptProtectionState(idle, 'detected', 3);
  assert.equal(paused.state.phase, 'PROTECTION_PAUSED');
  assert.equal(paused.activeParallelism, 0);

  const oneLane = transitionChatGptProtectionState(paused.state, 'page-recovered', 3);
  assert.equal(oneLane.state.phase, 'RECOVERING_ONE_LANE');
  assert.equal(oneLane.activeParallelism, 1);

  const oneLaneSecond = transitionChatGptProtectionState(oneLane.state, 'task-success', 3);
  assert.equal(oneLaneSecond.state.phase, 'RECOVERING_ONE_LANE');
  assert.equal(oneLaneSecond.activeParallelism, 1);

  const oneLaneThird = transitionChatGptProtectionState(oneLaneSecond.state, 'task-success', 3);
  assert.equal(oneLaneThird.state.phase, 'RECOVERING_ONE_LANE');
  assert.equal(oneLaneThird.activeParallelism, 1);

  const twoLanes = transitionChatGptProtectionState(oneLaneThird.state, 'task-success', 3);
  assert.equal(twoLanes.state.phase, 'RECOVERING_TWO_LANES');
  assert.equal(twoLanes.activeParallelism, 2);

  const stillTwoLanes = transitionChatGptProtectionState(twoLanes.state, 'task-success', 3);
  assert.equal(stillTwoLanes.state.phase, 'RECOVERING_TWO_LANES');
  assert.equal(stillTwoLanes.activeParallelism, 2);

  const finalTwoLanes = transitionChatGptProtectionState(stillTwoLanes.state, 'task-success', 3);
  assert.equal(finalTwoLanes.state.phase, 'RECOVERING_TWO_LANES');
  assert.equal(finalTwoLanes.activeParallelism, 2);

  const restored = transitionChatGptProtectionState(finalTwoLanes.state, 'task-success', 3);
  assert.equal(restored.state.phase, 'IDLE');
  assert.equal(restored.activeParallelism, 3);
});

test('a failed recovery check stays protection-paused without starting a rolling timer', () => {
  const paused = transitionChatGptProtectionState(createChatGptProtectionState(), 'detected', 3);
  const manual = transitionChatGptProtectionState(paused.state, 'page-still-limited', 3);
  assert.equal(manual.state.phase, 'PROTECTION_PAUSED');
  assert.equal(manual.state.manualCheckRequired, true);
  assert.equal(manual.state.recoveryChecked, true);
  assert.equal(manual.activeParallelism, 0);

  const repeated = transitionChatGptProtectionState(manual.state, 'page-still-limited', 3);
  assert.deepEqual(repeated, manual, 'the same protection event must remain inert until an explicit check');
});

test('protection escalates within one hour without creating another automatic recovery loop', () => {
  const hour = 60 * 60 * 1000;
  const now = 10 * hour;
  const first = planChatGptProtectionEscalation([], now);
  assert.equal(first.cooldownMs, 5 * 60 * 1000);
  assert.equal(first.manualOnly, false);
  assert.deepEqual(first.detectionTimestamps, [now]);

  const second = planChatGptProtectionEscalation(first.detectionTimestamps, now + 20 * 60 * 1000);
  assert.equal(second.cooldownMs, 15 * 60 * 1000);
  assert.equal(second.manualOnly, false);

  const third = planChatGptProtectionEscalation(second.detectionTimestamps, now + 40 * 60 * 1000);
  assert.equal(third.cooldownMs, 0);
  assert.equal(third.manualOnly, true);

  const expiredAt = now + 40 * 60 * 1000 + hour + 1;
  const expired = planChatGptProtectionEscalation(third.detectionTimestamps, expiredAt);
  assert.equal(expired.cooldownMs, 5 * 60 * 1000);
  assert.equal(expired.manualOnly, false);
  assert.deepEqual(expired.detectionTimestamps, [expiredAt]);
});

test('normal submissions keep sixty seconds and recovery submissions keep two minutes', () => {
  assert.equal(chatGptAdaptiveBaseIntervalMs, 60_000);
  assert.equal(chatGptAdaptiveRecoveryIntervalMs, 120_000);
  const normal = planChatGptAdaptivePacing({ recentSamples: [], completedSinceRest: 0, cooldownUntil: 0 }, 10_000);
  assert.equal(normal.mode, 'normal');
  assert.equal(normal.minimumSubmissionIntervalMs, 60_000);
  assert.equal(normal.waitMs, 0);

  const degradedSamples = Array.from({ length: 10 }, (_, index) => ({
    durationMs: index < 4 ? 360_000 : 180_000,
    responseMs: index < 4 ? 90_000 : 40_000,
    success: index >= 4,
    rateLimited: false,
    completedAt: index
  }));
  const degraded = planChatGptAdaptivePacing(
    { recentSamples: degradedSamples, completedSinceRest: 4, cooldownUntil: 0 },
    10_000
  );
  assert.equal(degraded.mode, 'slow');
  assert.equal(degraded.minimumSubmissionIntervalMs, 120_000);
});

test('rate-limit cooldown and ten-task rest stop new submissions without busy retrying', () => {
  const cooling = planChatGptAdaptivePacing(
    { recentSamples: [], completedSinceRest: 0, cooldownUntil: 310_000 },
    10_000
  );
  assert.equal(cooling.mode, 'cooldown');
  assert.equal(cooling.waitMs, 300_000);

  const resting = planChatGptAdaptivePacing(
    { recentSamples: [], completedSinceRest: 10, cooldownUntil: 0 },
    10_000
  );
  assert.equal(resting.mode, 'rest');
  assert.equal(resting.waitMs, 120_000);
});

test('an expired cooldown never resumes or dismisses without an explicit stable manual check', () => {
  const waiting = planChatGptCooldownRecovery({
    cooldownUntil: 310_000,
    now: 10_000,
    pageLimited: true,
    acknowledgementAvailable: true
  });
  assert.equal(waiting.action, 'wait');
  assert.equal(waiting.waitMs, 300_000);

  const stillProtected = planChatGptCooldownRecovery({
    cooldownUntil: 310_000,
    now: 310_000,
    pageLimited: true,
    acknowledgementAvailable: true,
    manualCheckRequested: true,
    composerReady: true,
    pageStable: true
  });
  assert.equal(stillProtected.action, 'manual-check');
  assert.equal(stillProtected.waitMs, 0);

  const stillLimited = planChatGptCooldownRecovery({
    cooldownUntil: 310_000,
    now: 310_000,
    pageLimited: true,
    acknowledgementAvailable: false
  });
  assert.equal(stillLimited.action, 'manual-check');
  assert.equal(stillLimited.waitMs, 0, 'the same stale warning must not create a rolling cooldown');

  const recovered = planChatGptCooldownRecovery({
    cooldownUntil: 310_000,
    now: 310_000,
    pageLimited: false,
    acknowledgementAvailable: false,
    manualCheckRequested: false,
    composerReady: true,
    pageStable: true
  });
  assert.equal(recovered.action, 'manual-check');

  const manuallyRecovered = planChatGptCooldownRecovery({
    cooldownUntil: 310_000,
    now: 310_000,
    pageLimited: false,
    acknowledgementAvailable: false,
    manualCheckRequested: true,
    composerReady: true,
    pageStable: true
  });
  assert.equal(manuallyRecovered.action, 'resume');
});

test('an explicit healthy login check can reconcile a stale protection pause', () => {
  assert.equal(shouldReconcileChatGptProtectionFromLoginCheck({
    phase: 'PROTECTION_PAUSED',
    loginUsable: true,
    cooldownUntil: 0,
    now: 500_000
  }), true);
  assert.equal(shouldReconcileChatGptProtectionFromLoginCheck({
    phase: 'PROTECTION_PAUSED',
    loginUsable: true,
    cooldownUntil: 510_000,
    now: 500_000
  }), false);
  assert.equal(shouldReconcileChatGptProtectionFromLoginCheck({
    phase: 'PROTECTION_PAUSED',
    loginUsable: false,
    cooldownUntil: 0,
    now: 500_000
  }), false);
  assert.equal(shouldReconcileChatGptProtectionFromLoginCheck({
    phase: 'IDLE',
    loginUsable: true,
    cooldownUntil: 0,
    now: 500_000
  }), false);
});

test('repeated protection signals reuse one cooldown deadline instead of extending it', () => {
  assert.equal(nextChatGptCooldownDeadline(0, 10_000, 300_000), 310_000);
  assert.equal(
    nextChatGptCooldownDeadline(310_000, 20_000, 300_000),
    310_000,
    'another lane seeing the same protection must not move the deadline'
  );
  assert.equal(
    nextChatGptCooldownDeadline(310_000, 320_000, 300_000),
    620_000,
    'a later, genuinely new protection event starts a new fixed cooldown'
  );
});

test('generation waiting exits early when progress stops and has one immutable three-minute ceiling', () => {
  const idle = {
    assistantAdvanced: false,
    busy: false,
    stopVisible: false,
    candidateCount: 0,
    settledWithoutImageMs: 0
  };
  assert.equal(planChatGptGenerationWait({ ...idle, elapsedMs: 59_999 }).action, 'continue');
  assert.equal(planChatGptGenerationWait({ ...idle, elapsedMs: 60_000 }).action, 'no-signal');

  const settledReply = {
    elapsedMs: 30_000,
    assistantAdvanced: true,
    busy: false,
    stopVisible: false,
    candidateCount: 0
  };
  assert.equal(
    planChatGptGenerationWait({ ...settledReply, settledWithoutImageMs: 14_999 }).action,
    'continue'
  );
  assert.equal(
    planChatGptGenerationWait({ ...settledReply, settledWithoutImageMs: 15_000 }).action,
    'settled-without-image'
  );

  assert.equal(
    planChatGptGenerationWait({
      elapsedMs: 180_000,
      assistantAdvanced: true,
      busy: true,
      stopVisible: true,
      candidateCount: 0,
      settledWithoutImageMs: 0
    }).action,
    'hard-timeout'
  );
});

test('the live ChatGPT result loop uses the shared progress plan instead of a renewable five-minute wait', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const waitStart = main.indexOf('async function waitForStableGeneratedImage');
  const waitEnd = main.indexOf('async function setChatGptFileInputFiles', waitStart);
  const resultLoop = main.slice(waitStart, waitEnd);
  assert.match(resultLoop, /planChatGptGenerationWait\(\{/);
  assert.match(resultLoop, /settledWithoutImageSince/);
  assert.doesNotMatch(resultLoop, /timeoutMs = 300000|timeoutMs = 300_000/);
});

test('the batch worker never performs automatic cooldown recovery before dequeuing another task', async () => {
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const workerStart = mainSource.indexOf('const worker = async (laneId: number');
  const workerEnd = mainSource.indexOf('await Promise.all(laneWindows.map', workerStart);
  const workerSource = mainSource.slice(workerStart, workerEnd);

  assert.doesNotMatch(workerSource, /recoverChatGptConversationAccessAfterCooldown/);
  assert.match(workerSource, /ChatGPT 访问保护等待人工检查恢复/);
});

test('submission pacing stops immediately in protection state instead of sleeping then auto continuing', async () => {
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const start = mainSource.indexOf('async function waitForChatGptSubmissionTurn');
  const end = mainSource.indexOf('async function triggerPacedChatGptSend', start);
  const submissionTurn = mainSource.slice(start, end);
  const protectionGate = submissionTurn.indexOf("chatGptProtectionState.phase === 'PROTECTION_PAUSED'");
  const pacingPlan = submissionTurn.indexOf('planChatGptAdaptivePacing');
  assert.ok(protectionGate >= 0 && protectionGate < pacingPlan);
  assert.doesNotMatch(submissionTurn, /冷却结束后自动从断点继续/);
});

test('protection gates page work, preserves in-flight result polling, and exposes manual recovery', async () => {
  const [mainSource, preloadSource, appSource, typesSource] = await Promise.all([
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8')
  ]);

  assert.match(mainSource, /assertChatGptAutomationStartAllowed/);
  assert.match(mainSource, /protectionSeenAfterSend/);
  assert.match(mainSource, /protectionPaused:\s*true/);
  assert.match(mainSource, /chatgpt:check-protection-recovery/);
  assert.match(mainSource, /checkChatGptLoginAndProtection/);
  assert.match(preloadSource, /checkChatGptProtectionRecovery/);
  assert.match(appSource, /ChatGPT 访问保护，任务已安全暂停/);
  assert.match(appSource, /检查恢复/);
  assert.match(typesSource, /protectionPaused\?: boolean/);
});

test('same-page ChatGPT config is reused without reopening the model picker', async () => {
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const start = mainSource.indexOf('async function ensureChatGptModelForSend');
  const end = mainSource.indexOf('async function ensureChatGptHighReasoningForSend', start);
  const ensureSource = mainSource.slice(start, end);
  assert.doesNotMatch(ensureSource, /requested !== followCurrentChatGptModel\s*&&/);
  assert.match(ensureSource, /chatgpt-config-reused/);
  assert.match(ensureSource, /chatGptVerifiedConfigByPage\.set/);
});

test('composer recovery and CDP menu dismissal have hard time bounds', async () => {
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const dismissStart = mainSource.indexOf('async function dismissOpenMenus');
  const dismissEnd = mainSource.indexOf('async function triggerChatGptSend', dismissStart);
  const recoveryStart = mainSource.indexOf('async function recoverChatGptComposerInBackground');
  const recoveryEnd = mainSource.indexOf('function freshGeminiConversationUrl', recoveryStart);
  assert.match(mainSource.slice(dismissStart, dismissEnd), /withTimeout\([\s\S]*debugger\.sendCommand/);
  assert.match(mainSource.slice(recoveryStart, recoveryEnd), /chatGptComposerRecoveryHardTimeoutMs/);
});

test('every accepted submission shares the same rest budget', async () => {
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const sendStart = mainSource.indexOf('async function triggerPacedChatGptSend');
  const sendEnd = mainSource.indexOf('interface ChatGptAssistantTextSnapshot', sendStart);
  const successStart = mainSource.indexOf('if (result.savedImage)');
  const successEnd = mainSource.indexOf('failedAttempts += 1', successStart);
  assert.match(mainSource.slice(sendStart, sendEnd), /chatGptSubmissionsSinceRest \+= 1/);
  assert.doesNotMatch(mainSource.slice(successStart, successEnd), /chatGptCompletedSinceRest \+= 1/);
});

test('runtime history retains only the latest ten observable task samples', () => {
  let samples = [];
  for (let index = 1; index <= 12; index += 1) {
    samples = appendChatGptRuntimeSample(samples, {
      durationMs: index * 1000,
      responseMs: index * 500,
      success: true,
      rateLimited: false,
      completedAt: index
    });
  }
  assert.equal(samples.length, 10);
  assert.equal(samples[0].completedAt, 3);
  assert.equal(samples[9].completedAt, 12);
});
