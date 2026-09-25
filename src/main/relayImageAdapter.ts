import type { RelayApiConfig } from '../shared/relayApiConfig.js';

export type RelayImageAdapterErrorCode =
  | 'INVALID_CONFIG'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_REJECTED'
  | 'CIRCUIT_OPEN'
  | 'CONNECTION_FAILED'
  | 'RESULT_UNCERTAIN'
  | 'INVALID_RESPONSE'
  | 'DOWNLOAD_FAILED'
  | 'CANCELLED';

export class RelayImageAdapterError extends Error {
  readonly code: RelayImageAdapterErrorCode;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: RelayImageAdapterErrorCode,
    cause?: unknown
  ) {
    super(message);
    this.name = 'RelayImageAdapterError';
    this.code = code;
    this.cause = cause;
  }
}

export function relayBatchFailurePolicy(error: unknown): {
  classification: 'failed' | 'manual-review';
  stopNewTasks: boolean;
} {
  if (!(error instanceof RelayImageAdapterError)) {
    return { classification: 'failed', stopNewTasks: false };
  }
  if (error.code === 'RESULT_UNCERTAIN') {
    return { classification: 'manual-review', stopNewTasks: false };
  }
  return {
    classification: 'failed',
    stopNewTasks: ['AUTH_FAILED', 'RATE_LIMITED', 'UPSTREAM_REJECTED', 'CIRCUIT_OPEN'].includes(error.code)
  };
}

export interface RelayImageAttachment {
  name: string;
  mimeType: string;
  data: Buffer;
}

export interface RelayImageRequest extends Partial<Pick<RelayApiConfig, 'protocol' | 'imagePath' | 'modelsPath'>> {
  taskId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  resolution: string;
  prompt: string;
  attachments: RelayImageAttachment[];
}

export interface RelayConnectionRequest extends Partial<Pick<RelayApiConfig, 'protocol' | 'imagePath' | 'modelsPath'>> {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface RelayTransportResult {
  mimeType?: string;
  url?: string;
  base64?: string;
}

export interface RelayImageTransport {
  probe: (request: RelayConnectionRequest, signal: AbortSignal) => Promise<{ ok: boolean; message?: string }>;
  generate: (request: RelayImageRequest, signal: AbortSignal) => Promise<RelayTransportResult>;
  download: (url: string, signal: AbortSignal) => Promise<Buffer>;
}

export interface RelayImageResult {
  bytes: Buffer;
  mimeType: string;
  source: 'url' | 'base64';
}

function validateConfig(request: RelayConnectionRequest) {
  if (!request.apiKey.trim()) throw new RelayImageAdapterError('API Key 未配置。', 'INVALID_CONFIG');
  if (!request.baseUrl.trim()) throw new RelayImageAdapterError('API 服务地址未配置。', 'INVALID_CONFIG');
  if (!request.model.trim()) throw new RelayImageAdapterError('API 模型未配置。', 'INVALID_CONFIG');
}

function asRelayError(error: unknown, fallbackCode: RelayImageAdapterErrorCode) {
  if (error instanceof RelayImageAdapterError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new RelayImageAdapterError('API 任务已取消。', 'CANCELLED', error);
  }
  return new RelayImageAdapterError(
    error instanceof Error ? error.message : String(error),
    fallbackCode,
    error
  );
}

export class RelayImageAdapter {
  private readonly activeTasks = new Map<string, AbortController>();
  private readonly transport: RelayImageTransport;

  constructor(transport: RelayImageTransport) {
    this.transport = transport;
  }

  async testConnection(request: RelayConnectionRequest) {
    validateConfig(request);
    const controller = new AbortController();
    try {
      return await this.transport.probe(request, controller.signal);
    } catch (error) {
      throw asRelayError(error, 'CONNECTION_FAILED');
    }
  }

  async generate(request: RelayImageRequest): Promise<RelayImageResult> {
    validateConfig(request);
    if (!request.taskId.trim()) throw new RelayImageAdapterError('API 任务 ID 无效。', 'INVALID_CONFIG');
    if (this.activeTasks.has(request.taskId)) {
      throw new RelayImageAdapterError('同一 API 任务正在执行，请勿重复提交。', 'INVALID_CONFIG');
    }
    const controller = new AbortController();
    this.activeTasks.set(request.taskId, controller);
    try {
      const response = await this.transport.generate(request, controller.signal);
      controller.signal.throwIfAborted();
      if (response.base64) {
        const bytes = Buffer.from(response.base64, 'base64');
        if (!bytes.length) throw new RelayImageAdapterError('API 返回了空的 Base64 图片。', 'INVALID_RESPONSE');
        return { bytes, mimeType: response.mimeType || 'image/png', source: 'base64' };
      }
      if (response.url) {
        try {
          const bytes = await this.transport.download(response.url, controller.signal);
          controller.signal.throwIfAborted();
          if (!bytes.length) throw new RelayImageAdapterError('API 图片下载结果为空。', 'DOWNLOAD_FAILED');
          return { bytes, mimeType: response.mimeType || 'image/jpeg', source: 'url' };
        } catch (error) {
          throw asRelayError(error, 'DOWNLOAD_FAILED');
        }
      }
      throw new RelayImageAdapterError('API 响应没有 URL 或 Base64 图片。', 'INVALID_RESPONSE');
    } catch (error) {
      throw asRelayError(error, 'INVALID_RESPONSE');
    } finally {
      this.activeTasks.delete(request.taskId);
    }
  }

  cancel(taskId: string) {
    const controller = this.activeTasks.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}
