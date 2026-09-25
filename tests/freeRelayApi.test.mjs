import assert from 'node:assert/strict';
import test from 'node:test';
import { createLianYiLianRelayTransport } from '../dist-electron/main/lianyilianRelayTransport.js';
import { normalizeRelayApiConfig, relayApiEndpoint } from '../dist-electron/shared/relayApiConfig.js';
import { buildRelayBatchJobKey } from '../dist-electron/main/relayBatchJournal.js';

test('custom paths and local ports are supported without allowing credentials in URLs', () => {
  assert.equal(normalizeRelayApiConfig({ baseUrl: 'http://127.0.0.1:8888/v1/' }).baseUrl, 'http://127.0.0.1:8888');
  const config = normalizeRelayApiConfig({ baseUrl: 'https://relay.test/prefix', protocol: 'gemini', model: 'custom-banana' });
  assert.equal(relayApiEndpoint(config, 'image'), 'https://relay.test/prefix/v1beta/models/custom-banana:streamGenerateContent?alt=sse');
  for (const baseUrl of ['http://remote.test', 'https://key@relay.test', 'https://relay.test?key=secret', 'file:///C:/', 'https://relay.test/#key']) {
    assert.throws(() => normalizeRelayApiConfig({ baseUrl }));
  }
  for (const imagePath of ['//other.test/send', '/../../send', '/%2e%2e/send', 'https://other.test/send', '/send?key=secret']) {
    assert.throws(() => normalizeRelayApiConfig({ baseUrl: 'https://relay.test', imagePath }));
  }
});

test('different relay endpoints do not resume each others batch records', () => {
  const base = { projectName: 'fixture', prompt: 'fixture', total: 2, model: 'gpt-image-2', targetDimensions: {width: 32, height: 32}, attachments: [] };
  assert.notEqual(buildRelayBatchJobKey({ ...base, endpointIdentity: 'https://one.test' }), buildRelayBatchJobKey({ ...base, endpointIdentity: 'https://two.test' }));
});

test('custom banana protocol does not depend on a hardcoded model name', async () => {
  let calls = 0;
  const transport = createLianYiLianRelayTransport({ fetchImpl: async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://relay.test/image/custom-model:streamGenerateContent?alt=sse');
    assert.equal(JSON.parse(init.body).contents[0].parts.length, 2);
    return new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await transport.generate({ baseUrl: 'https://relay.test', model: 'custom-model', apiKey: 'fake-only', protocol: 'gemini', imagePath: '/image/{model}:streamGenerateContent', taskId: 'one', resolution: '1024x1024', prompt: 'test', attachments: [{name:'one.png', mimeType:'image/png', data:Buffer.from('one')}] }, new AbortController().signal);
  assert.equal(result.base64, 'aW1hZ2U=');
  assert.equal(calls, 1);
});

test('custom relay uses the supplied origin and path for probe and paid submission', async () => {
  const calls = [];
  const transport = createLianYiLianRelayTransport({ fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(init.method === 'GET'
      ? { data: [{ id: 'custom-image' }] }
      : { data: [{ b64_json: 'aW1hZ2U=' }] });
  } });
  const config = {
    baseUrl: 'https://images.example.test:8443/gateway/v1/',
    apiKey: 'fixture-only-key', model: 'custom-image',
    protocol: 'openai-images', imagePath: '/v1/custom/edits', modelsPath: '/v1/models'
  };
  await transport.probe(config, new AbortController().signal);
  await transport.generate({ ...config, taskId: 'one', resolution: '1024x1024',
    prompt: 'fixture', attachments: [{ name: 'input.png', mimeType: 'image/png', data: Buffer.from('image') }]
  }, new AbortController().signal);
  assert.deepEqual(calls.map(c => c.url), [
    'https://images.example.test:8443/gateway/v1/models',
    'https://images.example.test:8443/gateway/v1/custom/edits'
  ]);
  assert.equal(calls[1].init.body.get('model'), 'custom-image');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer fixture-only-key');
  assert.equal(calls[0].init.redirect, 'error', 'credentials cannot follow a service redirect');
  assert.equal(calls[1].init.redirect, 'error', 'paid submissions cannot be replayed by HTTP 307');
});
