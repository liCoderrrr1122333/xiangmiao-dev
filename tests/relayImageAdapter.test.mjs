import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RelayImageAdapter,
  RelayImageAdapterError,
  relayBatchFailurePolicy
} from '../dist-electron/main/relayImageAdapter.js';

const baseRequest = {
  taskId: 'task-1',
  apiKey: 'secret-key',
  baseUrl: 'https://relay.example.test',
  model: 'relay-image',
  resolution: '1024x1024',
  prompt: 'test prompt',
  attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('image') }]
};

test('relay adapter accepts base64 and URL image fixtures through one contract', async () => {
  const base64Adapter = new RelayImageAdapter({
    probe: async () => ({ ok: true }),
    generate: async () => ({ mimeType: 'image/png', base64: Buffer.from('base64-result').toString('base64') }),
    download: async () => Buffer.from('unused')
  });
  const base64Result = await base64Adapter.generate(baseRequest);
  assert.equal(base64Result.bytes.toString(), 'base64-result');
  assert.equal(base64Result.source, 'base64');

  const urlAdapter = new RelayImageAdapter({
    probe: async () => ({ ok: true }),
    generate: async () => ({ mimeType: 'image/jpeg', url: 'https://relay.example.test/result.jpg' }),
    download: async (url) => {
      assert.equal(url, 'https://relay.example.test/result.jpg');
      return Buffer.from('url-result');
    }
  });
  const urlResult = await urlAdapter.generate({ ...baseRequest, taskId: 'task-2' });
  assert.equal(urlResult.bytes.toString(), 'url-result');
  assert.equal(urlResult.source, 'url');
});

test('relay adapter classifies connection failure and supports task cancellation', async () => {
  const adapter = new RelayImageAdapter({
    probe: async () => ({ ok: false, message: 'unauthorized' }),
    generate: async (_request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
    download: async () => Buffer.from('unused')
  });
  const probe = await adapter.testConnection({
    apiKey: baseRequest.apiKey,
    baseUrl: baseRequest.baseUrl,
    model: baseRequest.model
  });
  assert.deepEqual(probe, { ok: false, message: 'unauthorized' });

  const pending = adapter.generate(baseRequest);
  assert.equal(adapter.cancel(baseRequest.taskId), true);
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof RelayImageAdapterError);
    assert.equal(error.code, 'CANCELLED');
    return true;
  });
});

test('relay batch quarantines uncertain results but stops new work after an upstream rejection', () => {
  const uncertain = relayBatchFailurePolicy(
    new RelayImageAdapterError('result connection closed', 'RESULT_UNCERTAIN')
  );
  assert.deepEqual(uncertain, {
    classification: 'manual-review',
    stopNewTasks: false
  });

  const rejected = relayBatchFailurePolicy(
    new RelayImageAdapterError('HTTP 406 openai_error', 'UPSTREAM_REJECTED')
  );
  assert.deepEqual(rejected, {
    classification: 'failed',
    stopNewTasks: true
  });

  const circuitOpen = relayBatchFailurePolicy(
    new RelayImageAdapterError('model circuit open', 'CIRCUIT_OPEN')
  );
  assert.deepEqual(circuitOpen, {
    classification: 'failed',
    stopNewTasks: true
  });
});

test('duplicate active task IDs never submit a second paid generation', async () => {
  let submissions = 0;
  let complete;
  const adapter = new RelayImageAdapter({
    probe: async () => ({ ok: true }),
    generate: async () => { submissions++; return new Promise(resolve => { complete = resolve; }); },
    download: async () => Buffer.from('unused')
  });
  const first = adapter.generate(baseRequest);
  const duplicate = adapter.generate(baseRequest);
  const rejected = assert.rejects(duplicate, error => error.code === 'INVALID_CONFIG');
  // Resolve the transport to keep the failing pre-fix test bounded.
  complete({ base64: Buffer.from('result').toString('base64') });
  await rejected;
  assert.equal(submissions, 1);
  await first;
});

test('cancelled tasks cannot return success when a late transport result ignores abort', async () => {
  for (const stage of ['generation', 'download']) {
    let complete;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const delayed = () => new Promise(resolve => { complete = resolve; started(); });
    const adapter = new RelayImageAdapter({
      probe: async () => ({ ok: true }),
      generate: async () => stage === 'generation' ? delayed() : { url: 'https://example.test/image.png' },
      download: delayed
    });
    const pending = adapter.generate(baseRequest);
    await ready;
    assert.equal(adapter.cancel(baseRequest.taskId), true);
    const rejected = assert.rejects(pending, error => error.code === 'CANCELLED');
    complete(stage === 'generation' ? { base64: Buffer.from('late').toString('base64') } : Buffer.from('late'));
    await rejected;
    assert.equal(adapter.cancel(baseRequest.taskId), false);
  }
});
