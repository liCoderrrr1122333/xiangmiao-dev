import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIANYILIAN_BANANA_IMAGE_MODEL,
  LIANYILIAN_RELAY_MODEL,
  createLianYiLianRelayTransport,
  relayResolutionForDimensions
} from '../dist-electron/main/lianyilianRelayTransport.js';

const apiKey = 'test-relay-key-never-log';
const LIANYILIAN_RELAY_BASE_URL = 'https://www.lianyilian.top';

test('relay preset only needs a key and probes the fixed service without spending image quota', async () => {
  const calls = [];
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const result = await transport.probe({
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_RELAY_MODEL
  }, new AbortController().signal);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'https://www.lianyilian.top/v1/models');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${apiKey}`);
});

test('relay probe prefers direct network and does not touch the proxy path when direct succeeds', async () => {
  const calls = [];
  const transport = createLianYiLianRelayTransport({
    fetchCandidates: [
      {
        id: 'direct',
        fetchImpl: async (input) => {
          calls.push(`direct:${String(input)}`);
          return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
      },
      {
        id: 'electron-system',
        fetchImpl: async (input) => {
          calls.push(`electron:${String(input)}`);
          throw new Error('proxy path should not be used');
        }
      }
    ]
  });

  await transport.probe({
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_RELAY_MODEL
  }, new AbortController().signal);

  assert.deepEqual(calls, ['direct:https://www.lianyilian.top/v1/models']);
});

test('relay probe falls back from direct network to the Electron proxy path and keeps generation on the verified path', async () => {
  const calls = [];
  const resetError = () => {
    const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    return new TypeError('fetch failed', { cause });
  };
  const transport = createLianYiLianRelayTransport({
    waitImpl: async () => undefined,
    fetchCandidates: [
      {
        id: 'direct',
        fetchImpl: async (input) => {
          calls.push(`direct:${String(input)}`);
          throw resetError();
        }
      },
      {
        id: 'electron-system',
        fetchImpl: async (input) => {
          calls.push(`electron:${String(input)}`);
          if (String(input).endsWith('/v1/models')) {
            return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            });
          }
          return new Response(JSON.stringify({
            data: [{ url: 'https://cdn.example.test/generated-image.png' }]
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
      }
    ]
  });

  await transport.probe({
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_RELAY_MODEL
  }, new AbortController().signal);

  await transport.generate({
    taskId: 'relay-network-route-1',
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_RELAY_MODEL,
    resolution: '1024x1024',
    prompt: '只处理本轮附件',
    attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
  }, new AbortController().signal);

  assert.equal(calls.filter((call) => call.startsWith('direct:') && call.includes('/v1/models')).length, 1);
  assert.equal(calls.filter((call) => call.includes('/v1/images/edits')).length, 1);
  assert.match(calls.at(-1), /^electron:/);
});

test('relay reuses a successful capability check for the same key during the current session', async () => {
  let calls = 0;
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const request = {
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_RELAY_MODEL
  };

  await transport.probe(request, new AbortController().signal);
  await transport.probe(request, new AbortController().signal);

  assert.equal(calls, 1);
});

test('relay connection check rejects a key group that does not expose the image model', async () => {
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5.5' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });

  await assert.rejects(
    transport.probe({
      apiKey,
      baseUrl: LIANYILIAN_RELAY_BASE_URL,
      model: LIANYILIAN_RELAY_MODEL
    }, new AbortController().signal),
    (error) => {
      assert.equal(error?.code, 'AUTH_FAILED');
      assert.match(String(error?.message), /当前分组.*gpt-image-2/);
      return true;
    }
  );
});

test('banana connection check accepts the dedicated Gemini image model', async () => {
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async () => new Response(JSON.stringify({
      data: [
        { id: 'gemini-3-pro-image-preview' },
        { id: LIANYILIAN_BANANA_IMAGE_MODEL }
      ]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });

  const result = await transport.probe({
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_BANANA_IMAGE_MODEL
  }, new AbortController().signal);

  assert.equal(result.ok, true);
  assert.match(result.message, /香蕉生图/);
});

test('relay edit uses the supported endpoint once and requests a compact URL result', async () => {
  const calls = [];
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({
        data: [{ url: 'https://cdn.example.test/generated-image.png' }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const result = await transport.generate({
    taskId: 'relay-task-1',
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_RELAY_MODEL,
    resolution: '1024x1536',
    prompt: '只处理本轮附件',
    attachments: [
      { name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') },
      { name: 'face.jpg', mimeType: 'image/jpeg', data: Buffer.from('face') }
    ]
  }, new AbortController().signal);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'https://www.lianyilian.top/v1/images/edits');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${apiKey}`);
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal(calls[0].init.body.get('model'), 'gpt-image-2');
  assert.equal(calls[0].init.body.get('size'), '1024x1536');
  assert.equal(calls[0].init.body.get('input_fidelity'), 'high');
  assert.equal(calls[0].init.body.get('response_format'), 'url');
  assert.equal(calls[0].init.body.getAll('image').length, 2);
  assert.equal(result.url, 'https://cdn.example.test/generated-image.png');
});

test('banana edit uses Gemini streaming once with every attachment and returns inline image data', async () => {
  const calls = [];
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      const event = {
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: Buffer.from('banana-result').toString('base64')
              }
            }]
          }
        }]
      };
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }
  });

  const result = await transport.generate({
    taskId: 'banana-task-1',
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_BANANA_IMAGE_MODEL,
    resolution: '1024x1536',
    prompt: '只处理本轮附件',
    attachments: [
      { name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') },
      { name: 'face.jpg', mimeType: 'image/jpeg', data: Buffer.from('face') }
    ]
  }, new AbortController().signal);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].input,
    `https://www.lianyilian.top/v1beta/models/${LIANYILIAN_BANANA_IMAGE_MODEL}:streamGenerateContent?alt=sse`
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${apiKey}`);
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.contents[0].role, 'user');
  assert.equal(body.contents[0].parts[0].text, '只处理本轮附件');
  assert.equal(body.contents[0].parts.filter((part) => part.inlineData).length, 2);
  assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, '2:3');
  assert.equal(body.generationConfig.imageConfig.imageSize, '1K');
  assert.equal(result.base64, Buffer.from('banana-result').toString('base64'));
  assert.equal(result.mimeType, 'image/png');
});

test('banana streaming keeps an image received before the connection closes', async () => {
  const calls = [];
  let pullCount = 0;
  const imageBase64 = Buffer.from('banana-stream-result').toString('base64');
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(new ReadableStream({
        pull(controller) {
          if (pullCount === 0) {
            pullCount += 1;
            controller.enqueue(new TextEncoder().encode(
              `data: ${JSON.stringify({
                candidates: [{
                  content: {
                    parts: [{ inlineData: { mimeType: 'image/png', data: imageBase64 } }]
                  }
                }]
              })}\n\n`
            ));
            return;
          }
          controller.error(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
        }
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }
  });

  const result = await transport.generate({
    taskId: 'banana-stream-interrupted-1',
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_BANANA_IMAGE_MODEL,
    resolution: '1024x1024',
    prompt: '只处理本轮附件',
    attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
  }, new AbortController().signal);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].input,
    `https://www.lianyilian.top/v1beta/models/${LIANYILIAN_BANANA_IMAGE_MODEL}:streamGenerateContent?alt=sse`
  );
  assert.equal(result.base64, imageBase64);
  assert.equal(result.mimeType, 'image/png');
});

test('banana connection reset changes the network path for the next task without repeating the failed task', async () => {
  const calls = [];
  const imageBase64 = Buffer.from('banana-proxy-result').toString('base64');
  const transport = createLianYiLianRelayTransport({
    fetchCandidates: [
      {
        id: 'direct',
        fetchImpl: async (input, init) => {
          calls.push({ route: 'direct', input: String(input), method: init?.method });
          if (String(input).endsWith('/v1/models')) {
            return new Response(JSON.stringify({ data: [{ id: LIANYILIAN_BANANA_IMAGE_MODEL }] }), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            });
          }
          return new Response(new ReadableStream({
            start(controller) {
              controller.error(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
            }
          }), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          });
        }
      },
      {
        id: 'electron-system',
        fetchImpl: async (input, init) => {
          calls.push({ route: 'electron-system', input: String(input), method: init?.method });
          const event = {
            candidates: [{
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: imageBase64 } }]
              }
            }]
          };
          return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          });
        }
      }
    ]
  });
  const connectionRequest = {
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_BANANA_IMAGE_MODEL
  };
  const generationRequest = {
    taskId: 'banana-route-reset-1',
    ...connectionRequest,
    resolution: '1024x1024',
    prompt: '只处理本轮附件',
    attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
  };

  await transport.probe(connectionRequest, new AbortController().signal);
  await assert.rejects(
    transport.generate(generationRequest, new AbortController().signal),
    (error) => error?.code === 'RESULT_UNCERTAIN' && /不会自动重复提交/.test(String(error?.message))
  );
  const result = await transport.generate({ ...generationRequest, taskId: 'banana-route-reset-2' }, new AbortController().signal);

  assert.equal(result.base64, imageBase64);
  const paidPosts = calls.filter((call) => call.method === 'POST');
  assert.deepEqual(paidPosts.map((call) => call.route), ['direct', 'electron-system']);
});

test('banana HTTP 406 stops after one paid request and preserves sanitized provider diagnostics', async () => {
  const calls = [];
  const waits = [];
  const transport = createLianYiLianRelayTransport({
    waitImpl: async (durationMs) => waits.push(durationMs),
    fetchCandidates: [
      {
        id: 'direct',
        fetchImpl: async (input, init) => {
          calls.push({ route: 'direct', input: String(input), method: init?.method });
          return new Response(JSON.stringify({
            error: {
              message: `openai_error ${apiKey}`,
              type: 'upstream_rejected',
              code: 'banana_route_unavailable'
            }
          }), {
            status: 406,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'req-banana-406'
            }
          });
        }
      },
      {
        id: 'electron-system',
        fetchImpl: async (input, init) => {
          calls.push({ route: 'electron-system', input: String(input), method: init?.method });
          throw new Error('proxy path should not be used for an HTTP rejection');
        }
      }
    ]
  });
  const request = {
    taskId: 'banana-upstream-rejected-1',
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_BANANA_IMAGE_MODEL,
    resolution: '1024x1024',
    prompt: '只处理本轮附件',
    attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
  };

  await assert.rejects(
    transport.generate(request, new AbortController().signal),
    (error) => {
      assert.equal(error?.code, 'UPSTREAM_REJECTED');
      assert.match(String(error?.message), /HTTP 406/);
      assert.match(String(error?.message), /openai_error/);
      assert.match(String(error?.message), /type=upstream_rejected/);
      assert.match(String(error?.message), /code=banana_route_unavailable/);
      assert.match(String(error?.message), /request-id=req-banana-406/);
      assert.match(String(error?.message), /未自动重复提交/);
      assert.doesNotMatch(String(error?.message), new RegExp(apiKey));
      return true;
    }
  );

  assert.deepEqual(calls.map((call) => call.route), ['direct']);
  assert.deepEqual(waits, []);
});

test('banana opens a short model circuit after the first HTTP 406 and blocks another paid request', async () => {
  let calls = 0;
  let now = 1_800_000_000_000;
  const transport = createLianYiLianRelayTransport({
    waitImpl: async () => {},
    nowImpl: () => now,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'openai_error' } }), {
        status: 406,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  await assert.rejects(
    transport.generate({
      taskId: 'banana-repeated-rejection',
      apiKey,
      baseUrl: LIANYILIAN_RELAY_BASE_URL,
      model: LIANYILIAN_BANANA_IMAGE_MODEL,
      resolution: '1024x1024',
      prompt: '只处理本轮附件',
      attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
    }, new AbortController().signal),
    (error) => error?.code === 'UPSTREAM_REJECTED' && /未自动重复提交/.test(String(error?.message))
  );
  assert.equal(calls, 1);

  await assert.rejects(
    transport.generate({
      taskId: 'banana-circuit-blocked',
      apiKey,
      baseUrl: LIANYILIAN_RELAY_BASE_URL,
      model: LIANYILIAN_BANANA_IMAGE_MODEL,
      resolution: '1024x1024',
      prompt: '只处理本轮附件',
      attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
    }, new AbortController().signal),
    (error) => error?.code === 'CIRCUIT_OPEN' && /刚刚被上游拒绝/.test(String(error?.message))
  );
  assert.equal(calls, 1);

  now += 2 * 60_000 + 1;
  await assert.rejects(
    transport.generate({
      taskId: 'banana-circuit-half-open',
      apiKey,
      baseUrl: LIANYILIAN_RELAY_BASE_URL,
      model: LIANYILIAN_BANANA_IMAGE_MODEL,
      resolution: '1024x1024',
      prompt: '只处理本轮附件',
      attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
    }, new AbortController().signal),
    (error) => error?.code === 'UPSTREAM_REJECTED'
  );
  assert.equal(calls, 2);
});

test('standard image HTTP 406 also stops after one paid request', async () => {
  let calls = 0;
  const transport = createLianYiLianRelayTransport({
    waitImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), {
        status: 406,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  await assert.rejects(
    transport.generate({
      taskId: 'standard-repeated-rejection',
      apiKey,
      baseUrl: LIANYILIAN_RELAY_BASE_URL,
      model: LIANYILIAN_RELAY_MODEL,
      resolution: '1024x1024',
      prompt: '只处理本轮附件',
      attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
    }, new AbortController().signal),
    (error) => error?.code === 'UPSTREAM_REJECTED' && /未自动重复提交/.test(String(error?.message))
  );
  assert.equal(calls, 1);
});

test('standard image result reset marks the task uncertain and changes the network path for the next task', async () => {
  const calls = [];
  const transport = createLianYiLianRelayTransport({
    fetchCandidates: [
      {
        id: 'direct',
        fetchImpl: async (input, init) => {
          calls.push({ route: 'direct', input: String(input), method: init?.method });
          return new Response(new ReadableStream({
            start(controller) {
              controller.error(Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }));
            }
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
      },
      {
        id: 'electron-system',
        fetchImpl: async (input, init) => {
          calls.push({ route: 'electron-system', input: String(input), method: init?.method });
          return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/recovered.png' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
      }
    ]
  });
  const request = {
    taskId: 'standard-route-reset-1',
    apiKey,
    baseUrl: LIANYILIAN_RELAY_BASE_URL,
    model: LIANYILIAN_RELAY_MODEL,
    resolution: '1024x1024',
    prompt: '只处理本轮附件',
    attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
  };

  await assert.rejects(
    transport.generate(request, new AbortController().signal),
    (error) => error?.code === 'RESULT_UNCERTAIN' && /不会自动重复提交/.test(String(error?.message))
  );
  const result = await transport.generate(
    { ...request, taskId: 'standard-route-reset-2' },
    new AbortController().signal
  );

  assert.equal(result.url, 'https://cdn.example.test/recovered.png');
  const paidPosts = calls.filter((call) => call.method === 'POST');
  assert.deepEqual(paidPosts.map((call) => call.route), ['direct', 'electron-system']);
});

test('relay edit reports the network stage and nested reset code instead of bare fetch failed', async () => {
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async () => {
      const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      throw new TypeError('fetch failed', { cause });
    }
  });

  await assert.rejects(
    transport.generate({
      taskId: 'relay-network-error-1',
      apiKey,
      baseUrl: LIANYILIAN_RELAY_BASE_URL,
      model: LIANYILIAN_RELAY_MODEL,
      resolution: '1024x1024',
      prompt: '只处理本轮附件',
      attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
    }, new AbortController().signal),
    (error) => {
      assert.equal(error?.code, 'RESULT_UNCERTAIN');
      assert.match(String(error?.message), /接收同步生成结果.*连接被重置.*ECONNRESET/);
      assert.doesNotMatch(String(error?.message), /fetch failed/i);
      return true;
    }
  );
});

test('relay generation never repeats a paid POST when the result response is interrupted', async () => {
  let attempts = 0;
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async () => {
      attempts += 1;
      return new Response(new ReadableStream({
        start(controller) {
          controller.error(new TypeError('terminated'));
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  await assert.rejects(
    transport.generate({
      taskId: 'relay-interrupted-post-1',
      apiKey,
      baseUrl: LIANYILIAN_RELAY_BASE_URL,
      model: LIANYILIAN_RELAY_MODEL,
      resolution: '1024x1024',
      prompt: '只处理本轮附件',
      attachments: [{ name: 'main.png', mimeType: 'image/png', data: Buffer.from('main') }]
    }, new AbortController().signal),
    (error) => {
      assert.equal(error?.code, 'RESULT_UNCERTAIN');
      assert.match(String(error?.message), /接收同步生成结果.*连接被重置/);
      return true;
    }
  );
  assert.equal(attempts, 1);
});

test('relay result download retries one terminated image stream without regenerating', async () => {
  let attempts = 0;
  const transport = createLianYiLianRelayTransport({
    waitImpl: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'));
          }
        }), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        });
      }
      return new Response(Buffer.from('downloaded-image'), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      });
    }
  });

  const bytes = await transport.download('https://cdn.example.test/result.png', new AbortController().signal);
  assert.equal(bytes.toString(), 'downloaded-image');
  assert.equal(attempts, 2);
});

test('relay errors never expose the API key and target dimensions choose a supported edit size', async () => {
  const transport = createLianYiLianRelayTransport({
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `invalid ${apiKey}` } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })
  });

  await assert.rejects(
    transport.probe({ apiKey, baseUrl: LIANYILIAN_RELAY_BASE_URL, model: LIANYILIAN_RELAY_MODEL }, new AbortController().signal),
    (error) => {
      assert.doesNotMatch(String(error?.message), new RegExp(apiKey));
      assert.equal(error?.code, 'AUTH_FAILED');
      return true;
    }
  );
  assert.equal(relayResolutionForDimensions({ width: 1080, height: 1920 }), '1024x1536');
  assert.equal(relayResolutionForDimensions({ width: 1920, height: 1080 }), '1536x1024');
  assert.equal(relayResolutionForDimensions({ width: 1200, height: 1200 }), '1024x1024');
});
