import type { ChatGptParallelism } from './types.js';

export function normalizeChatGptParallelism(value: unknown): ChatGptParallelism {
  const numeric = Math.round(Number(value) || 1);
  return (numeric >= 3 ? 3 : numeric >= 2 ? 2 : 1) as ChatGptParallelism;
}

export function normalizeCompletedTaskIndices(indices: unknown, total: number, legacyCompletedCount = 0) {
  const source = Array.isArray(indices)
    ? indices
    : Array.from({ length: Math.max(0, Math.min(total, Math.round(legacyCompletedCount))) }, (_, index) => index + 1);
  return [...new Set(source.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= total))].sort(
    (left, right) => left - right
  );
}

export function missingChatGptTaskIndices(total: number, completedTaskIndices: number[]) {
  const completed = new Set(completedTaskIndices);
  return Array.from({ length: total }, (_, index) => index + 1).filter((taskIndex) => !completed.has(taskIndex));
}

export function formatChatGptTaskIndices(indices: number[]) {
  const normalized = [...new Set(indices.filter((value) => Number.isInteger(value) && value >= 1))].sort(
    (left, right) => left - right
  );
  const ranges: string[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const start = normalized[index];
    let end = start;
    while (index + 1 < normalized.length && normalized[index + 1] === end + 1) {
      index += 1;
      end = normalized[index];
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return ranges.join('、');
}

export function buildChatGptBatchIncompleteMessage(input: {
  completedCount: number;
  total: number;
  missingTaskIndices: number[];
  failedTasks: Array<{ taskIndex: number; reason: string }>;
}) {
  const firstFailure = input.failedTasks[0];
  const firstFailureText = firstFailure
    ? `首个未完成原因（任务 ${firstFailure.taskIndex}）：${firstFailure.reason}；`
    : '';
  return `${firstFailureText}已保存 ${input.completedCount}/${input.total} 张；未完成任务：${formatChatGptTaskIndices(input.missingTaskIndices)}。再次点击只继续缺失任务。`;
}

export interface ChatGptQueuedTask {
  taskIndex: number;
  notBefore: number;
}

export function takeReadyChatGptTask(queue: ChatGptQueuedTask[], now = Date.now()) {
  const readyIndex = queue.findIndex((task) => task.notBefore <= now);
  if (readyIndex >= 0) {
    return {
      task: queue.splice(readyIndex, 1)[0],
      waitMs: 0
    };
  }
  if (queue.length === 0) return { task: undefined, waitMs: undefined };
  return {
    task: undefined,
    waitMs: Math.max(1, Math.min(...queue.map((task) => task.notBefore)) - now)
  };
}

export function reduceChatGptParallelism(value: unknown): ChatGptParallelism {
  const current = normalizeChatGptParallelism(value);
  return Math.max(1, current - 1) as ChatGptParallelism;
}

export function planChatGptRateLimitRecovery(taskParallelism: unknown, activeParallelism: unknown) {
  const active = normalizeChatGptParallelism(activeParallelism);
  if (normalizeChatGptParallelism(taskParallelism) > 1) {
    return {
      action: 'retry' as const,
      parallelism: reduceChatGptParallelism(active)
    };
  }
  return { action: 'stop' as const, parallelism: active };
}

export function canAssignChatGptTask(input: {
  pauseRequested: boolean;
  hasGlobalFailure: boolean;
  laneId: number;
  activeParallelism: number;
}) {
  return !input.pauseRequested && !input.hasGlobalFailure && input.laneId <= input.activeParallelism;
}

export function isChatGptRateLimitMessage(message: string) {
  return /频率.{0,16}(?:限制|上限)|rate limit|too many requests|请求过于频繁/i.test(message);
}

export function isChatGptConversationAccessLimitedMessage(message: string) {
  return /(?:请求过于频繁[ \s\S]{0,120}(?:对话记录|稍等几分钟)|暂时限制.{0,30}(?:访问)?对话记录|too many requests.{0,80}conversation history)/i.test(
    message
  );
}

export function isChatGptGlobalFailureMessage(message: string) {
  return /需要重新登录|登录页|验证码|captcha|额度.{0,16}(?:不足|用完|耗尽)|usage limit|plan limit|not enough credits|out of credits|指定模型.{0,20}(?:不可用|未能确认)|没有静默切换|没有使用未知强度继续做图|思考强度.{0,32}(?:未确认|没有确认|仍未确认)|上一次发送结果无法确认|(?:暂不|尚不|不).{0,12}支持.{0,12}(?:所在地区|当前地区|区域|国家)|not (?:available|supported).{0,20}(?:region|country)|unsupported region/i.test(
    message
  );
}
