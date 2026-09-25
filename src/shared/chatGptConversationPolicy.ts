export const chatGptConversationRotationLimit = 4;

export interface ChatGptLaneConversation {
  laneId: number;
  initialized: boolean;
  completedInConversation: number;
  conversationUrl?: string;
  invalidReason?: string;
}

export type ChatGptLaneConversationPlan =
  | { action: 'reuse'; reason: 'healthy' }
  | { action: 'open-fresh'; reason: 'initial' | 'rotation-limit' | string };

export function createChatGptLaneConversation(laneId: number): ChatGptLaneConversation {
  return {
    laneId: Math.max(1, Math.round(laneId) || 1),
    initialized: false,
    completedInConversation: 0
  };
}

export function planChatGptLaneConversation(
  conversation: ChatGptLaneConversation
): ChatGptLaneConversationPlan {
  if (!conversation.initialized) return { action: 'open-fresh', reason: 'initial' };
  if (conversation.invalidReason) return { action: 'open-fresh', reason: conversation.invalidReason };
  if (conversation.completedInConversation >= chatGptConversationRotationLimit) {
    return { action: 'open-fresh', reason: 'rotation-limit' };
  }
  return { action: 'reuse', reason: 'healthy' };
}

export function openChatGptLaneConversation(
  conversation: ChatGptLaneConversation,
  conversationUrl?: string
): ChatGptLaneConversation {
  return {
    laneId: conversation.laneId,
    initialized: true,
    completedInConversation: 0,
    conversationUrl
  };
}

export function completeChatGptLaneConversation(
  conversation: ChatGptLaneConversation,
  conversationUrl = conversation.conversationUrl
): ChatGptLaneConversation {
  return {
    ...conversation,
    initialized: true,
    completedInConversation: conversation.completedInConversation + 1,
    conversationUrl,
    invalidReason: undefined
  };
}

export function invalidateChatGptLaneConversation(
  conversation: ChatGptLaneConversation,
  reason: string
): ChatGptLaneConversation {
  return {
    ...conversation,
    invalidReason: reason.trim() || 'page-state-unknown'
  };
}

export function buildCurrentTurnChatGptPrompt(fileNames: string[], prompt: string) {
  const attachmentOrder = fileNames.map((fileName, index) => `${index + 1}. ${fileName}`).join('\n');
  return `只处理当前最新一条用户消息中的附件和要求。忽略本对话此前消息里的附件、图片和编辑要求，不得把旧任务素材带入本轮。\n\n本轮附件顺序如下：\n${attachmentOrder}\n\n请完整读取附件文件名和下方提示词中定义的素材职责。\n\n${prompt.trim()}\n\n请务必直接调用 ChatGPT 的创建图片功能，根据本轮全部附件和提示词生成并返回最终图片；不要只回复文字说明。`;
}
