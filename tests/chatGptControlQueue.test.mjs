import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatGptControlQueue } from '../dist-electron/main/chatGptControlQueue.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('repeated control clicks share one in-flight operation', async () => {
  const queue = new ChatGptControlQueue();
  let calls = 0;
  const operation = () => queue.run('show-window', async () => {
    calls += 1;
    await delay(15);
    return 'shown';
  });
  const first = operation();
  const second = operation();
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), ['shown', 'shown']);
  assert.equal(calls, 1);
  assert.equal(queue.pendingCount, 0);
});

test('different control operations are serialized and a failure does not deadlock the queue', async () => {
  const queue = new ChatGptControlQueue();
  const order = [];
  const first = queue.run('check-login', async () => {
    order.push('check-start');
    await delay(12);
    order.push('check-end');
    throw new Error('simulated check failure');
  });
  const second = queue.run('show-window', async () => {
    order.push('show-start');
    await delay(2);
    order.push('show-end');
    return true;
  });
  await assert.rejects(first, /simulated check failure/);
  assert.equal(await second, true);
  assert.deepEqual(order, ['check-start', 'check-end', 'show-start', 'show-end']);
  assert.equal(queue.pendingCount, 0);
});

test('twenty alternating login checks and window views remain ordered', async () => {
  const queue = new ChatGptControlQueue();
  const order = [];
  const operations = [];
  for (let round = 1; round <= 20; round += 1) {
    const kind = round % 2 ? 'check-login' : 'show-window';
    operations.push(queue.run(`${kind}-${round}`, async () => {
      order.push(`${kind}-${round}`);
      await delay(1);
      return round;
    }));
  }
  assert.deepEqual(await Promise.all(operations), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual(order, Array.from({ length: 20 }, (_, index) => `${(index + 1) % 2 ? 'check-login' : 'show-window'}-${index + 1}`));
  assert.equal(queue.pendingCount, 0);
});

test('window viewing can respond while a background login check is still running', async () => {
  const queue = new ChatGptControlQueue();
  const order = [];
  const check = queue.run('check-login', async () => {
    order.push('check-start');
    await delay(30);
    order.push('check-end');
  });
  await delay(2);
  const firstView = queue.runSingleFlight('show-window', async () => {
    order.push('show');
    return 'shown';
  });
  const secondView = queue.runSingleFlight('show-window', async () => 'duplicate');
  assert.equal(firstView, secondView);
  assert.equal(await firstView, 'shown');
  await check;
  assert.deepEqual(order, ['check-start', 'show', 'check-end']);
  assert.equal(queue.pendingCount, 0);
});

test('automation barrier waits for serialized controls but not a visibility-only view', async () => {
  const queue = new ChatGptControlQueue();
  const order = [];
  const check = queue.run('check-login', async () => {
    order.push('check-start');
    await delay(20);
    order.push('check-end');
  });
  const view = queue.runSingleFlight('show-window', async () => {
    await delay(35);
    order.push('show-end');
  });
  await queue.waitForSerializedIdle();
  order.push('barrier');
  await Promise.all([check, view]);
  assert.deepEqual(order, ['check-start', 'check-end', 'barrier', 'show-end']);
});

test('exclusive task acquisition waits for an active visibility single-flight before taking the slot', async () => {
  const queue = new ChatGptControlQueue();
  let releaseView;
  let acquired = false;
  const view = queue.runSingleFlight('show-window', () => new Promise((resolve) => {
    releaseView = resolve;
  }));
  const task = queue.runExclusive(async () => {
    await queue.waitForSingleFlight('show-window');
    acquired = true;
  });

  await delay(20);
  assert.equal(acquired, false);
  releaseView();
  await Promise.all([view, task]);
  assert.equal(acquired, true);
});

test('exclusive task acquisition waits for every provider visibility operation', async () => {
  const queue = new ChatGptControlQueue();
  let releaseChatGpt;
  let releaseGemini;
  const chatGptView = queue.runSingleFlight('show-window', () => new Promise((resolve) => {
    releaseChatGpt = resolve;
  }));
  const geminiView = queue.runSingleFlight('gemini:show-window', () => new Promise((resolve) => {
    releaseGemini = resolve;
  }));
  let acquired = false;
  const task = queue.runExclusive(async () => {
    await queue.waitForSingleFlights(['show-window', 'gemini:show-window']);
    acquired = true;
  });

  await delay(20);
  assert.equal(acquired, false);
  releaseChatGpt();
  await chatGptView;
  await delay(5);
  assert.equal(acquired, false);
  releaseGemini();
  await Promise.all([geminiView, task]);
  assert.equal(acquired, true);
});

test('manual exclusive acquisition holds only until its release callback runs', async () => {
  const queue = new ChatGptControlQueue();
  const firstRelease = await queue.acquireExclusive();
  let secondAcquired = false;
  const second = queue.acquireExclusive().then((release) => {
    secondAcquired = true;
    return release;
  });

  await delay(20);
  assert.equal(secondAcquired, false);
  assert.equal(queue.pendingCount, 2);

  firstRelease();
  firstRelease();
  const secondRelease = await second;
  assert.equal(secondAcquired, true);
  assert.equal(queue.pendingCount, 1);

  secondRelease();
  await queue.waitForSerializedIdle();
  assert.equal(queue.pendingCount, 0);
});
