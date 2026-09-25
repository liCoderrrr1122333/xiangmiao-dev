import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildRelayBatchJobKey,
  createRelayBatchJournal,
  readRelayBatchJournal,
  relayBatchResumePlan,
  transitionRelayBatchTask,
  writeRelayBatchJournalAtomically
} from '../dist-electron/main/relayBatchJournal.js';

const now = 1_800_000_000_000;
const journalInput = {
  jobKey: 'a'.repeat(64),
  total: 3,
  model: 'gpt-image-2',
  resultSequenceStart: 12,
  targetDimensions: { width: 1080, height: 1440 }
};

test('relay journal recovers an interrupted paid submission without silently resubmitting it', () => {
  let journal = createRelayBatchJournal(journalInput, now);
  journal = transitionRelayBatchTask(journal, 1, 'saved', {
    savedPath: 'D:\\results\\project_12.png',
    sequence: 12
  }, now + 10);
  journal = transitionRelayBatchTask(journal, 2, 'submitting', {
    laneId: 1,
    requestId: 'relay-request-2'
  }, now + 20);

  const recovered = relayBatchResumePlan(journal, now + 30);

  assert.deepEqual(recovered.completedTaskNumbers, [1]);
  assert.deepEqual(recovered.uncertainTaskNumbers, [2]);
  assert.deepEqual(recovered.pendingTaskNumbers, [3]);
  assert.equal(recovered.journal.tasks[1].phase, 'uncertain');
  assert.match(recovered.journal.tasks[1].message, /上次运行在提交后中断/);
});

test('an explicit user retry can include previously uncertain relay tasks without repeating saved tasks', () => {
  let journal = createRelayBatchJournal(journalInput, now);
  journal = transitionRelayBatchTask(journal, 1, 'saved', { savedPath: 'saved.png', sequence: 12 }, now + 10);
  journal = transitionRelayBatchTask(journal, 2, 'uncertain', { message: 'socket reset' }, now + 20);

  const recovered = relayBatchResumePlan(journal, now + 30, { retryUncertain: true });

  assert.deepEqual(recovered.completedTaskNumbers, [1]);
  assert.deepEqual(recovered.uncertainTaskNumbers, [2]);
  assert.deepEqual(recovered.pendingTaskNumbers, [2, 3]);
});

test('an upstream rejection keeps the failed task and every unstarted task resumable', () => {
  let journal = createRelayBatchJournal(journalInput, now);
  journal = transitionRelayBatchTask(journal, 1, 'failed', {
    errorCode: 'UPSTREAM_REJECTED',
    message: 'HTTP 406 upstream rejected'
  }, now + 10);

  const recovered = relayBatchResumePlan(journal, now + 20);

  assert.deepEqual(recovered.completedTaskNumbers, []);
  assert.deepEqual(recovered.uncertainTaskNumbers, []);
  assert.deepEqual(recovered.pendingTaskNumbers, [1, 2, 3]);
  assert.equal(recovered.journal.tasks[0].message, 'HTTP 406 upstream rejected');
});

test('relay journal is written atomically and rejects stale or corrupt data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-journal-'));
  const filePath = path.join(root, 'relay-batch-checkpoint.json');
  const journal = createRelayBatchJournal(journalInput, now);

  await writeRelayBatchJournalAtomically(filePath, journal);
  assert.deepEqual(await readRelayBatchJournal(filePath, now + 100), journal);

  await fs.writeFile(filePath, '{broken', 'utf8');
  assert.equal(await readRelayBatchJournal(filePath, now + 100), undefined);

  await writeRelayBatchJournalAtomically(filePath, journal);
  assert.equal(await readRelayBatchJournal(filePath, now + 25 * 60 * 60 * 1000), undefined);
});

test('relay batch job key changes with the model, prompt or attachment bytes and never needs the API key', () => {
  const base = {
    projectName: '项目',
    prompt: '只处理本轮附件',
    total: 2,
    model: 'gpt-image-2',
    targetDimensions: { width: 1080, height: 1440 },
    attachments: [{ name: 'main.png', data: Buffer.from('main-a') }]
  };
  const first = buildRelayBatchJobKey(base);

  assert.equal(first.length, 64);
  assert.notEqual(first, buildRelayBatchJobKey({ ...base, model: 'gemini-3.1-flash-image-preview' }));
  assert.notEqual(first, buildRelayBatchJobKey({ ...base, prompt: '新的提示词' }));
  assert.notEqual(first, buildRelayBatchJobKey({
    ...base,
    attachments: [{ name: 'main.png', data: Buffer.from('main-b') }]
  }));
});
