import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildCurrentTurnChatGptPrompt,
  completeChatGptLaneConversation,
  createChatGptLaneConversation,
  invalidateChatGptLaneConversation,
  openChatGptLaneConversation,
  planChatGptLaneConversation
} from '../dist-electron/shared/chatGptConversationPolicy.js';

test('ten tasks across three lanes create only three initial conversations', () => {
  const lanes = [1, 2, 3].map(createChatGptLaneConversation);
  let freshConversationCount = 0;

  for (let taskIndex = 0; taskIndex < 10; taskIndex += 1) {
    const laneIndex = taskIndex % lanes.length;
    const plan = planChatGptLaneConversation(lanes[laneIndex]);
    if (plan.action === 'open-fresh') {
      freshConversationCount += 1;
      lanes[laneIndex] = openChatGptLaneConversation(lanes[laneIndex], `https://chatgpt.com/c/lane-${laneIndex + 1}`);
    }
    lanes[laneIndex] = completeChatGptLaneConversation(lanes[laneIndex]);
  }

  assert.equal(freshConversationCount, 3);
});

test('a lane rotates after four saved tasks and immediately after contamination', () => {
  let lane = createChatGptLaneConversation(1);
  assert.equal(planChatGptLaneConversation(lane).action, 'open-fresh');
  lane = openChatGptLaneConversation(lane, 'https://chatgpt.com/c/one');

  for (let index = 0; index < 3; index += 1) {
    lane = completeChatGptLaneConversation(lane);
    assert.equal(planChatGptLaneConversation(lane).action, 'reuse');
  }
  lane = completeChatGptLaneConversation(lane);
  assert.deepEqual(planChatGptLaneConversation(lane), {
    action: 'open-fresh',
    reason: 'rotation-limit'
  });

  lane = openChatGptLaneConversation(lane, 'https://chatgpt.com/c/two');
  lane = invalidateChatGptLaneConversation(lane, 'attachment-residue');
  assert.deepEqual(planChatGptLaneConversation(lane), {
    action: 'open-fresh',
    reason: 'attachment-residue'
  });
});

test('the reused conversation prompt scopes the model to only the latest attachments', () => {
  const prompt = buildCurrentTurnChatGptPrompt(['01-main.jpg', '02-face.jpg'], '只修改红圈内的人脸。');
  assert.match(prompt, /只处理当前最新一条用户消息中的附件/);
  assert.match(prompt, /忽略本对话此前消息里的附件、图片和编辑要求/);
  assert.match(prompt, /1\. 01-main\.jpg/);
  assert.match(prompt, /2\. 02-face\.jpg/);
});

test('the batch integration keeps one mutable conversation lease per lane', async () => {
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(main, /const laneConversations = new Map/);
  assert.match(main, /conversation: laneConversations\.get\(laneId\)!/);
  assert.match(main, /prepareChatGptComposerForLane/);
  assert.match(main, /completeChatGptLaneConversation/);
  assert.match(main, /invalidateChatGptLaneConversation/);
});
