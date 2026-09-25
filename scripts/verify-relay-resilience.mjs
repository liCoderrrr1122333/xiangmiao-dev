import assert from 'node:assert/strict';
import {
  LIANYILIAN_BANANA_IMAGE_MODEL,
  LIANYILIAN_RELAY_MODEL,
  createLianYiLianRelayTransport
} from '../dist-electron/main/lianyilianRelayTransport.js';
import {
  createRelayBatchJournal,
  relayBatchResumePlan,
  transitionRelayBatchTask
} from '../dist-electron/main/relayBatchJournal.js';

const apiKey = 'release-gate-key-never-log';
const LIANYILIAN_RELAY_BASE_URL = 'https://relay.example.test';
const attachment = { name: 'main.png', mimeType: 'image/png', data: Buffer.from('fixture') };
let scenarioCount = 0;
let paidPostCount = 0;

function request(model, taskId) {
  return {
    taskId,
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model,
    resolution: '1024x1024',
    prompt: '只处理本轮附件',
    attachments: [attachment]
  };
}

function resetResponse(contentType) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.error(Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }));
    }
  }), { status: 200, headers: { 'content-type': contentType } });
}

for (const model of [LIANYILIAN_RELAY_MODEL, LIANYILIAN_BANANA_IMAGE_MODEL]) {
  for (let index = 0; index < 25; index += 1) {
    let calls = 0;
    const transport = createLianYiLianRelayTransport({
      fetchImpl: async () => {
        calls += 1;
        paidPostCount += 1;
        return resetResponse(model === LIANYILIAN_BANANA_IMAGE_MODEL ? 'text/event-stream' : 'application/json');
      }
    });
    await assert.rejects(
      transport.generate(request(model, `reset-${model}-${index}`), new AbortController().signal),
      (error) => error?.code === 'RESULT_UNCERTAIN'
    );
    assert.equal(calls, 1, 'an interrupted paid request must not be repeated');
    scenarioCount += 1;
  }
}

for (const model of [LIANYILIAN_RELAY_MODEL, LIANYILIAN_BANANA_IMAGE_MODEL]) {
  for (let index = 0; index < 10; index += 1) {
    let calls = 0;
    const transport = createLianYiLianRelayTransport({
      waitImpl: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        paidPostCount += 1;
        return new Response(JSON.stringify({ error: { message: 'temporary upstream rejection' } }), {
          status: 406,
          headers: { 'content-type': 'application/json' }
        });
      }
    });
    await assert.rejects(
      transport.generate(request(model, `rejected-${model}-${index}`), new AbortController().signal),
      (error) => error?.code === 'UPSTREAM_REJECTED'
    );
    await assert.rejects(
      transport.generate(request(model, `blocked-${model}-${index}`), new AbortController().signal),
      (error) => error?.code === 'CIRCUIT_OPEN'
    );
    assert.equal(calls, 1, 'one upstream rejection must open the circuit without a second paid request');
    scenarioCount += 1;
  }
}

for (const model of [LIANYILIAN_RELAY_MODEL, LIANYILIAN_BANANA_IMAGE_MODEL]) {
  for (let index = 0; index < 5; index += 1) {
    let calls = 0;
    let now = 1_800_000_000_000;
    const transport = createLianYiLianRelayTransport({
      waitImpl: async () => undefined,
      nowImpl: () => now,
      fetchImpl: async () => {
        calls += 1;
        paidPostCount += 1;
        return new Response(JSON.stringify({ error: { message: 'persistent upstream rejection' } }), {
          status: 406,
          headers: { 'content-type': 'application/json' }
        });
      }
    });
    await assert.rejects(
      transport.generate(request(model, `circuit-open-${model}-${index}`), new AbortController().signal),
      (error) => error?.code === 'UPSTREAM_REJECTED'
    );
    now += 2 * 60_000 + 1;
    await assert.rejects(
      transport.generate(request(model, `circuit-expired-${model}-${index}`), new AbortController().signal),
      (error) => error?.code === 'UPSTREAM_REJECTED'
    );
    assert.equal(calls, 2, 'an expired circuit allows one new paid request without duplicating it');
    scenarioCount += 1;
  }
}

for (let index = 0; index < 20; index += 1) {
  let journal = createRelayBatchJournal({
    jobKey: index.toString(16).padStart(64, 'a').slice(-64),
    total: 3,
    model: LIANYILIAN_RELAY_MODEL,
    resultSequenceStart: 1,
    targetDimensions: { width: 1080, height: 1440 }
  }, 1_800_000_000_000);
  journal = transitionRelayBatchTask(journal, 1, 'saved', { savedPath: 'saved.png', sequence: 1 }, 1_800_000_000_010);
  journal = transitionRelayBatchTask(journal, 2, 'submitting', { requestId: `request-${index}` }, 1_800_000_000_020);
  const plan = relayBatchResumePlan(journal, 1_800_000_000_030);
  assert.deepEqual(plan.completedTaskNumbers, [1]);
  assert.deepEqual(plan.uncertainTaskNumbers, [2]);
  assert.deepEqual(plan.pendingTaskNumbers, [3]);
  scenarioCount += 1;
}

assert.equal(scenarioCount, 100);
process.stdout.write(`${JSON.stringify({
  ok: true,
  scenarios: scenarioCount,
  paidPosts: paidPostCount,
  invariants: [
    'result reset never auto-resubmits',
    'one 406 opens the circuit without a duplicate paid request',
    'open circuit emits zero paid requests',
    'expired circuit allows only one new paid request',
    'crash recovery preserves saved and uncertain tasks'
  ]
}, null, 2)}\n`);
