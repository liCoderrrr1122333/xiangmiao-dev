import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildChatGptBatchIncompleteMessage,
  canAssignChatGptTask,
  formatChatGptTaskIndices,
  isChatGptConversationAccessLimitedMessage,
  isChatGptGlobalFailureMessage,
  isChatGptRateLimitMessage,
  missingChatGptTaskIndices,
  normalizeChatGptParallelism,
  normalizeCompletedTaskIndices,
  planChatGptRateLimitRecovery,
  reduceChatGptParallelism,
  takeReadyChatGptTask
} from '../dist-electron/shared/chatGptParallelPolicy.js';

test('parallelism is bounded to one, two, or three lanes', () => {
  assert.equal(normalizeChatGptParallelism(undefined), 1);
  assert.equal(normalizeChatGptParallelism(2), 2);
  assert.equal(normalizeChatGptParallelism(9), 3);
  assert.equal(reduceChatGptParallelism(3), 2);
  assert.equal(reduceChatGptParallelism(2), 1);
  assert.equal(reduceChatGptParallelism(1), 1);
});

test('v1 completed counts migrate to exact v2 task indices', () => {
  assert.deepEqual(normalizeCompletedTaskIndices(undefined, 5, 3), [1, 2, 3]);
  assert.deepEqual(normalizeCompletedTaskIndices([5, 2, 2, 9, -1], 5), [2, 5]);
  assert.deepEqual(missingChatGptTaskIndices(5, [2, 5]), [1, 3, 4]);
});

test('pause, global failure, and lane downgrade stop new task assignment', () => {
  assert.equal(
    canAssignChatGptTask({ pauseRequested: false, hasGlobalFailure: false, laneId: 2, activeParallelism: 3 }),
    true
  );
  assert.equal(
    canAssignChatGptTask({ pauseRequested: true, hasGlobalFailure: false, laneId: 1, activeParallelism: 3 }),
    false
  );
  assert.equal(
    canAssignChatGptTask({ pauseRequested: false, hasGlobalFailure: true, laneId: 1, activeParallelism: 3 }),
    false
  );
  assert.equal(
    canAssignChatGptTask({ pauseRequested: false, hasGlobalFailure: false, laneId: 3, activeParallelism: 2 }),
    false
  );
});

test('rate limits are separated from account-wide failures', () => {
  assert.equal(isChatGptRateLimitMessage('Too many requests. Rate limit reached.'), true);
  assert.equal(
    isChatGptConversationAccessLimitedMessage(
      '你的请求过于频繁。为保障数据安全，我们已暂时限制你访问对话记录。请稍等几分钟后再重试。'
    ),
    true
  );
  assert.equal(isChatGptConversationAccessLimitedMessage('Too many requests to access conversation history.'), true);
  assert.equal(isChatGptConversationAccessLimitedMessage('生成图片暂时失败。'), false);
  assert.equal(isChatGptGlobalFailureMessage('指定模型不可用，本轮没有静默切换'), true);
  assert.equal(isChatGptGlobalFailureMessage('ChatGPT 自动窗口需要重新登录'), true);
  assert.equal(isChatGptGlobalFailureMessage('Google 当前提示 Gemini 暂不支持所在地区。'), true);
  assert.equal(
    isChatGptGlobalFailureMessage('GPT-5.5 的思考强度滑块遍历完成后仍未确认“高”。本轮已在上传附件前停止'),
    true
  );
  assert.equal(
    isChatGptGlobalFailureMessage('无法找到 GPT-5.5 的思考强度入口。本轮已在上传附件前停止，没有使用未知强度继续做图。'),
    true
  );
  assert.equal(isChatGptGlobalFailureMessage('图片没有完整上传到 ChatGPT'), false);
});

test('concurrent rate limits finish the downgrade before stopping the batch', () => {
  assert.deepEqual(planChatGptRateLimitRecovery(2, 2), { action: 'retry', parallelism: 1 });
  assert.deepEqual(
    planChatGptRateLimitRecovery(2, 1),
    { action: 'retry', parallelism: 1 },
    'a second lane that started before the downgrade must not masquerade as a single-lane failure'
  );
  assert.deepEqual(planChatGptRateLimitRecovery(1, 1), { action: 'stop', parallelism: 1 });
});

test('batch incomplete summaries preserve the first cause and compress missing task ranges', () => {
  const missing = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.equal(formatChatGptTaskIndices(missing), '1-20');
  assert.equal(formatChatGptTaskIndices([1, 2, 3, 5, 7, 8, 9]), '1-3、5、7-9');
  assert.equal(
    buildChatGptBatchIncompleteMessage({
      completedCount: 0,
      total: 20,
      missingTaskIndices: missing,
      failedTasks: [
        { taskIndex: 2, reason: '第二个任务失败' },
        { taskIndex: 1, reason: '附件没有完整上传到 ChatGPT' }
      ]
    }),
    '首个未完成原因（任务 2）：第二个任务失败；已保存 0/20 张；未完成任务：1-20。再次点击只继续缺失任务。'
  );
});

test('delayed retries cannot be claimed by another lane before their backoff expires', () => {
  const queue = [
    { taskIndex: 2, notBefore: 2000 },
    { taskIndex: 3, notBefore: 1000 }
  ];
  assert.deepEqual(takeReadyChatGptTask(queue, 500), { task: undefined, waitMs: 500 });
  assert.deepEqual(takeReadyChatGptTask(queue, 1000), {
    task: { taskIndex: 3, notBefore: 1000 },
    waitMs: 0
  });
  assert.deepEqual(queue, [{ taskIndex: 2, notBefore: 2000 }]);
});

test('one, three, and twenty tasks stay schedulable across one, two, and three lanes', () => {
  for (const total of [1, 3, 20, 100]) {
    for (const requestedLanes of [1, 2, 3]) {
      const activeParallelism = Math.min(total, requestedLanes);
      const queue = Array.from({ length: total }, (_, index) => ({ taskIndex: index + 1, notBefore: 0 }));
      const assigned = [];
      while (queue.length > 0) {
        for (let laneId = 1; laneId <= activeParallelism; laneId += 1) {
          assert.equal(
            canAssignChatGptTask({ pauseRequested: false, hasGlobalFailure: false, laneId, activeParallelism }),
            true
          );
          const { task } = takeReadyChatGptTask(queue, 0);
          if (task) assigned.push(task.taskIndex);
        }
      }
      assert.deepEqual(assigned.sort((left, right) => left - right), Array.from({ length: total }, (_, index) => index + 1));
    }
  }
});

test('checkpoint stores task lifecycle, adaptive samples, and a restart-safe cooldown', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(main, /version: 5/);
  assert.match(main, /tasks: ChatGptTaskRuntimeRecord\[\]/);
  assert.match(main, /recentSamples: ChatGptRuntimeSample\[\]/);
  assert.match(main, /cooldownUntil: number/);
  assert.match(main, /chatgpt-automation-runtime\.json/);
  assert.match(main, /updateChatGptTaskRuntimeRecord\([^;]+, 'PROCESSING'/s);
  assert.match(main, /updateChatGptTaskRuntimeRecord\([^;]+, 'SUCCESS'/s);
  assert.match(main, /updateChatGptTaskRuntimeRecord\([^;]+, 'FAILED'/s);
  assert.match(main, /updateChatGptTaskRuntimeRecord\([^;]+, 'PAUSED'/s);
});

test('a delayed first task does not block tasks two through twenty and resumes exactly once', () => {
  const queue = Array.from({ length: 20 }, (_, index) => ({ taskIndex: index + 1, notBefore: 0 }));
  assert.equal(takeReadyChatGptTask(queue, 0).task?.taskIndex, 1);
  queue.push({ taskIndex: 1, notBefore: 5000 });

  const assignedWhileFirstWaits = [];
  while (true) {
    const { task } = takeReadyChatGptTask(queue, 0);
    if (!task) break;
    assignedWhileFirstWaits.push(task.taskIndex);
  }
  assert.deepEqual(assignedWhileFirstWaits, Array.from({ length: 19 }, (_, index) => index + 2));
  assert.equal(takeReadyChatGptTask(queue, 5000).task?.taskIndex, 1);
  assert.equal(queue.length, 0);
});

test('checkpoint resume keeps completed tasks and reports only compressed missing ranges', () => {
  const completed = normalizeCompletedTaskIndices([2, 4, 5, 20], 20);
  const missing = missingChatGptTaskIndices(20, completed);
  assert.deepEqual(completed, [2, 4, 5, 20]);
  assert.equal(formatChatGptTaskIndices(missing), '1、3、6-19');
});

test('parallel automation uses one persistent Chrome context with isolated task state', async () => {
  const chrome = await readFile(new URL('../src/main/chromeChatGpt.ts', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(chrome, /const childPage = await context\.newPage\(\)/);
  assert.match(chrome, /const childTarget = await CDP\.New/);
  assert.match(chrome, /createTab\?: \(url: string\) => Promise<ChatGptWindowLike>/);
  assert.match(main, /completedTaskIndices: number\[\]/);
  assert.match(main, /version: 5/);
  assert.match(main, /reserveResultFiles\(projectName, total, resultSequenceStart\)/);
  assert.doesNotMatch(main, /reservePostProcessingResultFiles|startPostProcessingBatch/);
  assert.match(main, /legacy-post-processing/);
  assert.match(main, /taskScopedAutomationEvent/);
  assert.match(main, /resultFile: reservations\[taskIndex - 1\]/);
  assert.match(main, /pendingTasks\.push\(\{ taskIndex, notBefore: Date\.now\(\) \+ retryDelayMs \}\)/);
  assert.match(main, /inFlightTaskCount > 0/);
  assert.match(main, /planChatGptRateLimitRecovery\(taskParallelism, activeParallelism\)/);
  assert.match(
    main,
    /result\.protectionPaused \|\| isChatGptConversationAccessLimitedMessage\(reason\)[\s\S]{0,1800}'PROTECTION_PAUSED'[\s\S]{0,1000}classification: 'conversation-access-rate-limit'/
  );
  assert.match(main, /decision: result\.sent \? 'preserve-sent-page' : 'pause-for-manual-recovery'/);
  const frozenGlobalFailures = [...main.matchAll(/globalFailure \|\|= \{[\s\S]{0,220}?taskIndex,[\s\S]{0,80}?laneId/g)];
  assert.equal(
    frozenGlobalFailures.length,
    2,
    'only account-wide and checkpoint-integrity failures stop all workers; protection pauses and uncertain results stay separate'
  );
  assert.doesNotMatch(main, /cooldownRecoveryPromise/);
  assert.match(
    main,
    /if \(provider === 'chatgpt' && chatGptProtectionState\.phase === 'PROTECTION_PAUSED'\)[\s\S]{0,1000}protectionPauseResult \|\|= \{/
  );
  assert.match(main, /ChatGPT 访问保护等待人工检查恢复，软件不会自动重新打开对话、上传或发送/);
  assert.match(
    main,
    /formatChatGptTaskIndices\(missingChatGptTaskIndices\(total, \[\.\.\.completedTaskIndices\]\)\)/
  );
  const permanentFailureStart = main.indexOf('if (permanentFailure) {');
  const taskRetryStart = main.indexOf('const shouldRetry = shouldRetryChatGptBatchItem', permanentFailureStart);
  const permanentFailureBranch = main.slice(permanentFailureStart, taskRetryStart);
  assert.match(permanentFailureBranch, /failedTaskReasons\.set\(taskIndex, reason\)/);
  assert.doesNotMatch(permanentFailureBranch, /globalFailure/);
  assert.match(
    permanentFailureBranch,
    /continue;/,
    'a permanent file or storage failure must stop only its task, not the whole batch'
  );
  assert.match(main, /同一个专属 Chrome 中已建立/);
  assert.match(main, /const chatGptSubmissionQueue = new ChatGptControlQueue\(\)/);
  assert.match(main, /chatGptSubmissionQueue\.acquireExclusive\(\)/);
  assert.match(
    main,
    /releaseSubmissionSlot\?\.\(\);[\s\S]{0,300}waitForStableGeneratedImage/,
    'the submission gate must be released before waiting for image generation'
  );
  assert.match(main, /chatGptParallelLaneStartupIntervalMs[\s\S]{0,500}rootWindow\.createTab\(automationUrl\)/);
  assert.match(main, /waitForChatGptSubmissionTurn/);
  assert.doesNotMatch(main, /post-acceptance trusted retry result/);
  const uncertainResultStart = main.indexOf('if (result.sent && !result.savedImage)');
  const accountFailureStart = main.indexOf('const accountWideFailure', uncertainResultStart);
  const uncertainResultBranch = main.slice(uncertainResultStart, accountFailureStart);
  assert.match(uncertainResultBranch, /'MANUAL_REVIEW'/);
  assert.match(uncertainResultBranch, /manualReviewTaskReasons\.set\(taskIndex, reason\)/);
  assert.match(uncertainResultBranch, /classification: 'ambiguous-submission'/);
  assert.match(uncertainResultBranch, /decision: 'quarantine-lane'/);
  assert.doesNotMatch(uncertainResultBranch, /globalFailure/);
  assert.doesNotMatch(
    main,
    /if \(sent && taskContext && !quotaExceeded\) \{\s*rememberUncertainChatGptSubmission/,
    'an uncertain batch result must not install a global submission cooldown that stalls healthy lanes'
  );
  assert.match(
    uncertainResultBranch,
    /return;/,
    'the uncertain page is quarantined while other healthy workers keep taking queued tasks'
  );
  assert.match(
    main,
    /let protectionPaused = chatGptManualVerificationRequired \|\| error instanceof ChatGptProtectionPausedError \|\| isChatGptConversationAccessLimitedMessage\(message\);[\s\S]{0,100}if \(protectionPaused\) rememberChatGptConversationAccessLimit\(message\);/
  );
  assert.match(main, /if \(!protectionPaused && activeWindow && !activeWindow\.isDestroyed\(\)\) \{[\s\S]{0,500}resetComposerScript/);
  assert.match(app, /activeProviderLabel\} 并行通道数/);
  assert.match(app, /setCompletedGenerationCount\(completedCount\)/);
});

test('an explicit rate-limit response enters cooldown before ambiguous-send handling', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const workerStart = main.indexOf('const worker = async');
  const rateLimitBranch = main.indexOf('if (result.protectionPaused || isChatGptConversationAccessLimitedMessage(reason))', workerStart);
  const ambiguousSendBranch = main.indexOf('if (result.sent && !result.savedImage)', workerStart);
  assert.ok(rateLimitBranch > workerStart);
  assert.ok(ambiguousSendBranch > workerStart);
  assert.ok(
    rateLimitBranch < ambiguousSendBranch,
    'a definite page rate-limit is a rejected submission and must cool down instead of freezing the entire batch'
  );
});

test('revealing a ChatGPT automation page invalidates its cached web configuration', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const inspectionStart = main.indexOf('async function showChatGptWindowForInspection');
  const inspectionEnd = main.indexOf('async function recoverChatGptWindowForInspection', inspectionStart);
  const inspection = main.slice(inspectionStart, inspectionEnd);
  assert.match(inspection, /chatGptVerifiedConfigByPage\.delete/);
});

test('batch monitor separates pending, manual-review and failed tasks', async () => {
  const [main, app, types] = await Promise.all([
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8')
  ]);
  assert.match(types, /elapsedMs\?: number/);
  assert.match(types, /manualReviewCount\?: number/);
  assert.match(types, /pendingCount\?: number/);
  assert.match(main, /chatGptBatchStartedAt/);
  assert.match(main, /elapsedMs: Math\.max\(0, Date\.now\(\) - chatGptBatchStartedAt\)/);
  assert.match(app, /总耗时/);
  assert.match(app, /均耗时/);
  assert.match(app, /待执行/);
  assert.match(app, /待确认/);
});
