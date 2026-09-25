import { createHash } from 'node:crypto';
import {
  RelayImageAdapterError,
  type RelayConnectionRequest,
  type RelayImageRequest,
  type RelayImageTransport,
  type RelayTransportResult
} from './relayImageAdapter.js';
import {
  RELAY_BANANA_IMAGE_MODEL,
  RELAY_STANDARD_IMAGE_MODEL,
  relayImageModelLabel,
  type RelayImageModel
} from '../shared/relayImageModels.js';
import { normalizeRelayApiConfig, relayApiEndpoint } from '../shared/relayApiConfig.js';

export const LIANYILIAN_RELAY_MODEL = RELAY_STANDARD_IMAGE_MODEL;
export const LIANYILIAN_BANANA_IMAGE_MODEL = RELAY_BANANA_IMAGE_MODEL;

const relayProbeTimeoutMs = 20_000;
const relayGenerationTimeoutMs = 15 * 60_000;
const relayDownloadTimeoutMs = 120_000;
const relayMaxResponseBytes = 160 * 1024 * 1024;
const relayMaxAttachmentBytes = 160 * 1024 * 1024;
const relayUpstreamCircuitMs = 2 * 60_000;

interface RelayTransportOptions {
  fetchImpl?: typeof fetch;
  fetchCandidates?: Array<{
    id: string;
    fetchImpl: typeof fetch;
  }>;
  waitImpl?: (durationMs: number) => Promise<void>;
  nowImpl?: () => number;
}

interface RelayJsonResponse {
  message?: string;
  type?: string;
  code?: string | number;
  image_url?: string;
  data?: Array<{
    id?: string;
    b64_json?: string;
    url?: string;
    image_url?: string;
    mime_type?: string;
  }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
  response?: RelayJsonResponse;
  error?: string | {
    message?: string;
    type?: string;
    code?: string | number;
  };
}

function relayConfig(request: RelayConnectionRequest) {
  try {
    return normalizeRelayApiConfig({ ...request, protocol: request.protocol || (request.model === RELAY_BANANA_IMAGE_MODEL ? 'gemini' : 'openai-images') });
  } catch (error) {
    throw new RelayImageAdapterError(error instanceof Error ? error.message : 'API 配置无效。', 'INVALID_CONFIG');
  }
}

function sanitizeRelayMessage(value: unknown, apiKey: string) {
  const message = value instanceof Error ? value.message : String(value || 'API 请求失败。');
  return message
    .replaceAll(apiKey, '****')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '****')
    .slice(0, 600);
}

function relayNetworkFailureMessage(value: unknown, apiKey: string, stage: string, timedOut = false) {
  const chain: unknown[] = [];
  let current: unknown = value;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    chain.push(current);
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  const code = chain
    .map((item) => typeof item === 'object' && item !== null && 'code' in item
      ? String((item as { code?: unknown }).code || '').trim().toUpperCase()
      : '')
    .find(Boolean);
  const detail = chain.map((item) => sanitizeRelayMessage(item, apiKey)).filter(Boolean).join(' · ');
  const suffix = code ? `（${code}）` : '';

  if (timedOut || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code || '')) {
    return `API 在${stage}时连接超时${suffix}。`;
  }
  if (['ECONNRESET', 'UND_ERR_SOCKET'].includes(code || '') || /terminated|socket hang up|other side closed|premature/i.test(detail)) {
    return `API 在${stage}时连接被重置${suffix}。`;
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code || '')) {
    return `API 在${stage}时无法解析服务地址${suffix}，请检查 DNS 或代理。`;
  }
  if (code === 'ECONNREFUSED') {
    return `API 在${stage}时连接被拒绝${suffix}。`;
  }
  if (/certificate|cert_|tls|ssl/i.test(`${code || ''} ${detail}`)) {
    return `API 在${stage}时 TLS 连接失败${suffix}，请检查代理或系统证书。`;
  }
  if (/fetch failed/i.test(detail)) {
    return `API 在${stage}时网络请求失败（未收到 HTTP 响应）${suffix}。`;
  }
  return `API 在${stage}时请求失败：${sanitizeRelayMessage(value, apiKey)}`;
}

function relayUncertainResultError(error: RelayImageAdapterError) {
  return new RelayImageAdapterError(
    `${error.message} 本次请求可能已被服务端接收，当前任务不会自动重复提交；下一任务将切换备用网络通道。`,
    'RESULT_UNCERTAIN',
    error
  );
}

function relayRequestSignal(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parent.removeEventListener('abort', abort);
    }
  };
}

async function readRelayJson(response: Response, apiKey: string): Promise<RelayJsonResponse> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > relayMaxResponseBytes) {
    throw new RelayImageAdapterError('API 响应超过安全处理上限。', 'INVALID_RESPONSE');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > relayMaxResponseBytes) {
    throw new RelayImageAdapterError('API 响应超过安全处理上限。', 'INVALID_RESPONSE');
  }
  try {
    return JSON.parse(bytes.toString('utf8')) as RelayJsonResponse;
  } catch {
    if (!response.ok) return {};
    throw new RelayImageAdapterError(
      'API 返回了无法解析的响应。',
      'INVALID_RESPONSE'
    );
  }
}

function relayHttpErrorDetail(response: Response, json: RelayJsonResponse, apiKey: string) {
  const error = typeof json.error === 'object' && json.error !== null ? json.error : undefined;
  const rawMessage = error?.message || (typeof json.error === 'string' ? json.error : '') || json.message || '';
  const rawType = error?.type || json.type || '';
  const rawCode = error?.code ?? json.code ?? '';
  const parts: string[] = [];
  const message = rawMessage ? sanitizeRelayMessage(rawMessage, apiKey) : '';
  const type = rawType ? sanitizeRelayMessage(rawType, apiKey) : '';
  const code = rawCode !== '' ? sanitizeRelayMessage(rawCode, apiKey) : '';
  if (message) parts.push(message);
  if (type && type !== message) parts.push(`type=${type}`);
  if (code && code !== message && code !== type) parts.push(`code=${code}`);
  const requestId = ['x-request-id', 'request-id', 'x-trace-id', 'cf-ray']
    .map((name) => response.headers.get(name)?.trim())
    .find(Boolean);
  if (requestId) parts.push(`request-id=${sanitizeRelayMessage(requestId, apiKey)}`);
  return parts.join('；') || '服务端未返回详细原因';
}

function relayHttpError(response: Response, json: RelayJsonResponse, apiKey: string) {
  const detail = relayHttpErrorDetail(response, json, apiKey);
  const suffix = `：${detail}`;
  if (response.status === 401 || response.status === 403) {
    return new RelayImageAdapterError(`API Key 无效或没有图片接口权限${suffix}`, 'AUTH_FAILED');
  }
  if (response.status === 429) {
    return new RelayImageAdapterError(`API 当前请求过多，请稍后重试${suffix}`, 'RATE_LIMITED');
  }
  if (response.status === 406) {
    return new RelayImageAdapterError(`API 上游拒绝本次请求（HTTP 406）${suffix}`, 'UPSTREAM_REJECTED');
  }
  return new RelayImageAdapterError(`API 请求失败（HTTP ${response.status}）${suffix}`, 'CONNECTION_FAILED');
}

async function relayFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  timeoutMs: number,
  apiKey: string
) {
  const request = relayRequestSignal(parentSignal, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, redirect: 'error', signal: request.signal });
  } catch (error) {
    if (parentSignal.aborted) throw new DOMException('aborted', 'AbortError');
    throw new RelayImageAdapterError(
      relayNetworkFailureMessage(error, apiKey, '检查连接', request.signal.aborted),
      'CONNECTION_FAILED',
      error
    );
  } finally {
    request.cleanup();
  }
}

async function relayJsonFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  timeoutMs: number,
  apiKey: string,
  stage: string
) {
  const request = relayRequestSignal(parentSignal, timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: request.signal });
    const json = await readRelayJson(response, apiKey);
    return { response, json };
  } catch (error) {
    if (parentSignal.aborted) throw new DOMException('aborted', 'AbortError');
    if (error instanceof RelayImageAdapterError) throw error;
    throw new RelayImageAdapterError(
      relayNetworkFailureMessage(error, apiKey, stage, request.signal.aborted),
      'CONNECTION_FAILED',
      error
    );
  } finally {
    request.cleanup();
  }
}

async function relayImageFetch(
  fetchImpl: typeof fetch,
  url: string,
  parentSignal: AbortSignal
) {
  const request = relayRequestSignal(parentSignal, relayDownloadTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'image/*' },
      signal: request.signal
    });
    if (!response.ok) {
      throw new RelayImageAdapterError(`下载 API 图片失败（HTTP ${response.status}）。`, 'DOWNLOAD_FAILED');
    }
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!mimeType.startsWith('image/')) {
      throw new RelayImageAdapterError('API 下载地址返回的不是图片。', 'DOWNLOAD_FAILED');
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > relayMaxResponseBytes) {
      throw new RelayImageAdapterError('API 图片超过安全处理上限。', 'DOWNLOAD_FAILED');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > relayMaxResponseBytes) {
      throw new RelayImageAdapterError('API 图片为空或超过安全处理上限。', 'DOWNLOAD_FAILED');
    }
    return bytes;
  } catch (error) {
    if (parentSignal.aborted) throw new DOMException('aborted', 'AbortError');
    if (error instanceof RelayImageAdapterError) throw error;
    throw new RelayImageAdapterError('API 在下载结果图片时连接中断。', 'DOWNLOAD_FAILED', error);
  } finally {
    request.cleanup();
  }
}

export function relayResolutionForDimensions(dimensions: { width: number; height: number }) {
  const ratio = dimensions.width / dimensions.height;
  if (ratio > 1.08) return '1536x1024';
  if (ratio < 0.92) return '1024x1536';
  return '1024x1024';
}

function buildRelayEditForm(request: RelayImageRequest) {
  validateRelayAttachments(request);
  const form = new FormData();
  form.set('model', request.model);
  form.set('prompt', request.prompt);
  form.set('size', request.resolution);
  form.set('quality', 'high');
  form.set('input_fidelity', 'high');
  form.set('output_format', 'png');
  form.set('response_format', 'url');
  for (const attachment of request.attachments) {
    const blob = new Blob([new Uint8Array(attachment.data)], { type: attachment.mimeType || 'image/png' });
    form.append('image', blob, attachment.name);
  }
  return form;
}

function validateRelayAttachments(request: RelayImageRequest) {
  if (!request.attachments.length) {
    throw new RelayImageAdapterError('API 图片编辑缺少附件。', 'INVALID_CONFIG');
  }
  const totalBytes = request.attachments.reduce((sum, attachment) => sum + attachment.data.length, 0);
  if (!totalBytes || totalBytes > relayMaxAttachmentBytes) {
    throw new RelayImageAdapterError('API 附件为空或超过安全处理上限。', 'INVALID_CONFIG');
  }
}

function bananaAspectRatio(resolution: string) {
  if (resolution === '1024x1536') return '2:3';
  if (resolution === '1536x1024') return '3:2';
  return '1:1';
}

function buildBananaImageBody(request: RelayImageRequest) {
  validateRelayAttachments(request);
  return JSON.stringify({
    contents: [{
      role: 'user',
      parts: [
        { text: request.prompt },
        ...request.attachments.map((attachment) => ({
          inlineData: {
            mimeType: attachment.mimeType || 'image/png',
            data: attachment.data.toString('base64')
          }
        }))
      ]
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: bananaAspectRatio(request.resolution),
        imageSize: '1K'
      }
    }
  });
}

function parseRelayImage(json: RelayJsonResponse): RelayTransportResult {
  const item = json.data?.[0];
  const base64 = item?.b64_json?.trim();
  if (base64) return { base64, mimeType: item?.mime_type || 'image/png' };
  const url = item?.url?.trim() || item?.image_url?.trim() || json.image_url?.trim();
  if (url) return { url, mimeType: item?.mime_type };
  throw new RelayImageAdapterError('API 响应没有返回图片。', 'INVALID_RESPONSE');
}

function parseBananaImage(json: RelayJsonResponse): RelayTransportResult {
  const result = tryParseBananaImage(json);
  if (result) return result;
  throw new RelayImageAdapterError('香蕉生图响应没有返回图片。', 'INVALID_RESPONSE');
}

function tryParseBananaImage(json: RelayJsonResponse): RelayTransportResult | undefined {
  for (const candidate of json.candidates || json.response?.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      const base64 = part.inlineData?.data?.trim();
      if (base64) {
        return {
          base64,
          mimeType: part.inlineData?.mimeType?.trim() || 'image/png'
        };
      }
    }
  }
  return undefined;
}

function parseBananaSseEvent(eventText: string) {
  const data = eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return undefined;
  try {
    return tryParseBananaImage(JSON.parse(data) as RelayJsonResponse);
  } catch {
    throw new RelayImageAdapterError('香蕉生图返回了无法解析的流式结果。', 'INVALID_RESPONSE');
  }
}

async function readBananaSse(response: Response): Promise<RelayTransportResult> {
  if (!response.body) {
    throw new RelayImageAdapterError('香蕉生图没有返回结果流。', 'INVALID_RESPONSE');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let receivedBytes = 0;
  let image: RelayTransportResult | undefined;

  const drainEvents = () => {
    while (true) {
      const boundary = buffered.match(/\r?\n\r?\n/);
      if (!boundary || boundary.index === undefined) return;
      const eventText = buffered.slice(0, boundary.index);
      buffered = buffered.slice(boundary.index + boundary[0].length);
      image ||= parseBananaSseEvent(eventText);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > relayMaxResponseBytes) {
        throw new RelayImageAdapterError('香蕉生图响应超过安全处理上限。', 'INVALID_RESPONSE');
      }
      buffered += decoder.decode(value, { stream: true });
      drainEvents();
    }
    buffered += decoder.decode();
    drainEvents();
    if (buffered.trim()) image ||= parseBananaSseEvent(buffered);
  } catch (error) {
    if (image) return image;
    throw error;
  } finally {
    reader.releaseLock();
  }

  return image || parseBananaImage({});
}

async function relayBananaStreamFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  apiKey: string
) {
  const request = relayRequestSignal(parentSignal, relayGenerationTimeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: request.signal });
    if (!response.ok) {
      const json = await readRelayJson(response, apiKey);
      throw relayHttpError(response, json, apiKey);
    }
    return await readBananaSse(response);
  } catch (error) {
    if (parentSignal.aborted) throw new DOMException('aborted', 'AbortError');
    if (error instanceof RelayImageAdapterError) throw error;
    throw new RelayImageAdapterError(
      relayNetworkFailureMessage(error, apiKey, '接收香蕉生图流式结果', request.signal.aborted),
      'CONNECTION_FAILED',
      error
    );
  } finally {
    request.cleanup();
  }
}

export function createLianYiLianRelayTransport(options: RelayTransportOptions = {}): RelayImageTransport {
  const waitImpl = options.waitImpl || ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const nowImpl = options.nowImpl || Date.now;
  const fetchCandidates = options.fetchCandidates?.length
    ? options.fetchCandidates
    : [{ id: 'default', fetchImpl: options.fetchImpl || fetch }];
  let activeFetchCandidate = fetchCandidates[0];
  let verifiedConnectionSignature = '';
  const upstreamCircuitUntil = new Map<string, number>();

  const runWithUpstreamCircuit = async <T>(model: string, operation: () => Promise<T>) => {
    const circuitUntil = upstreamCircuitUntil.get(model) || 0;
    if (circuitUntil > nowImpl()) {
      const remainingSeconds = Math.max(1, Math.ceil((circuitUntil - nowImpl()) / 1000));
      throw new RelayImageAdapterError(
        `${relayImageModelLabel(model)}刚刚被上游拒绝，已暂停 ${remainingSeconds} 秒，期间不会再次提交付费请求。`,
        'CIRCUIT_OPEN'
      );
    }
    upstreamCircuitUntil.delete(model);
    try {
      const result = await operation();
      upstreamCircuitUntil.delete(model);
      return result;
    } catch (error) {
      if (!(error instanceof RelayImageAdapterError) || error.code !== 'UPSTREAM_REJECTED') throw error;
      upstreamCircuitUntil.set(model, nowImpl() + relayUpstreamCircuitMs);
      throw new RelayImageAdapterError(
        `${error.message}；${relayImageModelLabel(model)}已暂停 120 秒，本次未自动重复提交。`,
        'UPSTREAM_REJECTED',
        error
      );
    }
  };

  const rotateFailedFetchCandidate = (failedCandidate: (typeof fetchCandidates)[number]) => {
    if (fetchCandidates.length < 2 || activeFetchCandidate !== failedCandidate) return;
    const failedIndex = fetchCandidates.indexOf(failedCandidate);
    activeFetchCandidate = fetchCandidates[(failedIndex + 1) % fetchCandidates.length];
    verifiedConnectionSignature = '';
  };

  const connectionSignature = (request: RelayConnectionRequest) => createHash('sha256')
    .update(`${JSON.stringify(relayConfig(request))}\n${request.apiKey}`)
    .digest('hex');

  const generateSynchronously = async (request: RelayImageRequest, signal: AbortSignal) => {
    const candidate = activeFetchCandidate;
    try {
      const { response, json } = await relayJsonFetch(candidate.fetchImpl, relayApiEndpoint(relayConfig(request), 'image'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${request.apiKey}` },
        body: buildRelayEditForm(request)
      }, signal, relayGenerationTimeoutMs, request.apiKey, '接收同步生成结果');
      if (!response.ok) throw relayHttpError(response, json, request.apiKey);
      return parseRelayImage(json);
    } catch (error) {
      if (error instanceof RelayImageAdapterError && error.code === 'CONNECTION_FAILED' && error.cause) {
        rotateFailedFetchCandidate(candidate);
        throw relayUncertainResultError(error);
      }
      throw error;
    }
  };

  const generateBananaImage = async (request: RelayImageRequest, signal: AbortSignal) => {
    const candidate = activeFetchCandidate;
    const endpoint = relayApiEndpoint(relayConfig(request), 'image');
    try {
      return await relayBananaStreamFetch(candidate.fetchImpl, endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: buildBananaImageBody(request)
      }, signal, request.apiKey);
    } catch (error) {
      if (error instanceof RelayImageAdapterError && error.code === 'CONNECTION_FAILED' && error.cause) {
        rotateFailedFetchCandidate(candidate);
        throw relayUncertainResultError(error);
      }
      throw error;
    }
  };

  return {
    async probe(request: RelayConnectionRequest, signal: AbortSignal) {
      const config = relayConfig(request);
      const model = config.model;
      const signature = connectionSignature(request);
      if (verifiedConnectionSignature === signature) {
        return { ok: true, message: `API 已连接，当前分组已开放${relayImageModelLabel(model)}（${model}）。` };
      }
      let lastConnectionFailure: RelayImageAdapterError | undefined;
      const orderedCandidates = [
        activeFetchCandidate,
        ...fetchCandidates.filter((candidate) => candidate !== activeFetchCandidate)
      ];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        for (const candidate of orderedCandidates) {
          try {
            const response = await relayFetch(candidate.fetchImpl, relayApiEndpoint(config, 'models'), {
              method: 'GET',
              headers: { Authorization: `Bearer ${request.apiKey}` }
            }, signal, relayProbeTimeoutMs, request.apiKey);
            const json = await readRelayJson(response, request.apiKey);
            if (!response.ok) throw relayHttpError(response, json, request.apiKey);
            const hasImageModel = json.data?.some((item) => item.id?.trim() === model) === true;
            if (!hasImageModel) {
              throw new RelayImageAdapterError(
                `API Key 当前分组未开放${relayImageModelLabel(model)}（${model}），请在服务后台为该 Key 选择对应图片模型分组。`,
                'AUTH_FAILED'
              );
            }
            activeFetchCandidate = candidate;
            verifiedConnectionSignature = signature;
            return { ok: true, message: `API 已连接，当前分组已开放${relayImageModelLabel(model)}（${model}）。` };
          } catch (error) {
            if (!(error instanceof RelayImageAdapterError) || error.code !== 'CONNECTION_FAILED') throw error;
            lastConnectionFailure = error;
          }
        }
        if (attempt === 0) await waitImpl(500);
      }
      throw lastConnectionFailure || new RelayImageAdapterError('API 网络暂时不可达。', 'CONNECTION_FAILED');
    },

    async generate(request: RelayImageRequest, signal: AbortSignal) {
      const config = relayConfig(request);
      const model = config.model;
      return runWithUpstreamCircuit(model, () => config.protocol === 'gemini'
        ? generateBananaImage(request, signal)
        : generateSynchronously(request, signal));
    },

    async download(rawUrl: string, signal: AbortSignal) {
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new RelayImageAdapterError('API 返回了不安全的图片地址。', 'DOWNLOAD_FAILED');
      }
      try {
        return await relayImageFetch(activeFetchCandidate.fetchImpl, url.toString(), signal);
      } catch (error) {
        const transient = error instanceof RelayImageAdapterError && error.code === 'DOWNLOAD_FAILED' && Boolean(error.cause);
        if (!transient) throw error;
        await waitImpl(1_000);
        return relayImageFetch(activeFetchCandidate.fetchImpl, url.toString(), signal);
      }
    }
  };
}
