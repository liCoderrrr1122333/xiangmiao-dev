export type RelayApiProtocol = 'openai-images' | 'gemini';

export interface RelayApiConfig {
  baseUrl: string;
  model: string;
  protocol: RelayApiProtocol;
  imagePath: string;
  modelsPath: string;
}

export function normalizeRelayBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整 API 服务地址，例如 https://api.example.com。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('API 地址须使用 HTTPS（本机服务可用 HTTP），不能包含密钥、账号或查询参数。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1(?:beta)?$/, '');
  return url.href.replace(/\/+$/, '');
}

function normalizeApiPath(value: string) {
  const path = value.trim();
  if (!/^\/[A-Za-z0-9_./:{}%-]+$/.test(path) || path.startsWith('//') || /(?:%2e|%2f|%5c|\.\.)/i.test(path)) {
    throw new Error('接口路径应以单个 / 开头，不能包含网址、查询参数或上级目录。');
  }
  return path;
}

export function normalizeRelayApiConfig(value: Partial<RelayApiConfig>): RelayApiConfig {
  const baseUrl = normalizeRelayBaseUrl(value.baseUrl || '');
  const protocol = value.protocol || 'openai-images';
  if (!['openai-images', 'gemini'].includes(protocol)) throw new Error('请选择支持的图片接口协议。');
  const model = (value.model || (protocol === 'gemini' ? 'gemini-3.1-flash-image-preview' : 'gpt-image-2')).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw new Error('API 模型名称无效。');
  return {
    baseUrl, protocol, model,
    imagePath: normalizeApiPath(value.imagePath || (protocol === 'gemini' ? '/v1beta/models/{model}:streamGenerateContent' : '/v1/images/edits')),
    modelsPath: normalizeApiPath(value.modelsPath || '/v1/models')
  };
}

export function relayApiEndpoint(config: RelayApiConfig, operation: 'image' | 'models') {
  const path = (operation === 'image' ? config.imagePath : config.modelsPath).replaceAll('{model}', encodeURIComponent(config.model));
  return `${config.baseUrl}${path}${operation === 'image' && config.protocol === 'gemini' ? '?alt=sse' : ''}`;
}
