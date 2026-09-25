export interface OllamaVisionModel {
  name: string;
  size: number;
  capabilities: string[];
}

const automaticModelPriority = [
  /^gemma3(?::4b|:latest)?$/i,
  /^minicpm-v(?::latest)?$/i,
  /^llava(?::7b|:latest)?$/i,
  /^qwen2\.5vl(?::latest)?$/i,
  /^llama3\.2-vision(?::latest)?$/i,
  /^moondream(?::latest)?$/i
];

const knownVisionModelPattern = /(vision|llava|moondream|minicpm-v|qwen\d*(?:\.\d+)?vl|gemma3)/i;

export function normalizeOllamaModelName(name: string) {
  return name.trim().toLowerCase().replace(/:latest$/, '');
}

export function isSameOllamaModel(left: string, right: string) {
  return normalizeOllamaModelName(left) === normalizeOllamaModelName(right);
}

export function parseOllamaJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced ? fenced[1] : text).replace(/\u00a0/g, ' ').trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('模型没有返回可解析的 JSON。');
  const objectText = source.slice(start, end + 1);
  const repairCandidates = [
    objectText,
    objectText.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1')
  ];
  let lastError: unknown;
  for (const candidate of repairCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('模型没有返回可解析的 JSON。');
}

export function isOllamaVisionModel(model: OllamaVisionModel) {
  return model.capabilities.some((capability) => capability.toLowerCase() === 'vision') || knownVisionModelPattern.test(model.name);
}

function automaticRank(model: OllamaVisionModel) {
  const preferredIndex = automaticModelPriority.findIndex((pattern) => pattern.test(model.name));
  if (preferredIndex >= 0) return preferredIndex * 100;
  return 1000 + Math.max(0, model.size) / (1024 * 1024);
}

export function selectOllamaVisionModels(models: OllamaVisionModel[], preferred = 'auto', lastSuccessful = '') {
  const installedVisionModels = models.filter(isOllamaVisionModel);
  const ordered: OllamaVisionModel[] = [];
  const add = (model: OllamaVisionModel | undefined) => {
    if (model && !ordered.some((item) => isSameOllamaModel(item.name, model.name))) ordered.push(model);
  };
  const findInstalled = (name: string) => installedVisionModels.find((model) => isSameOllamaModel(model.name, name));

  const automaticSelection = !preferred.trim() || preferred.trim().toLowerCase() === 'auto';
  if (!automaticSelection) add(findInstalled(preferred));
  add(findInstalled(lastSuccessful));
  [...installedVisionModels]
    .sort((left, right) => automaticRank(left) - automaticRank(right) || left.size - right.size || left.name.localeCompare(right.name))
    .forEach(add);

  return ordered;
}

export type OllamaFailureCode = 'out_of_memory' | 'model_missing' | 'timeout' | 'service_unavailable' | 'request_failed';

export function explainOllamaFailure(message: string, model = ''): { code: OllamaFailureCode; message: string } {
  const source = message.trim();
  const lower = source.toLowerCase();
  const modelLabel = model ? `模型 ${model}` : 'Ollama 模型';

  if (/out[- ]of[- ]memory|failed to allocate|not enough memory|insufficient memory/.test(lower)) {
    return { code: 'out_of_memory', message: `${modelLabel}加载时内存不足，软件将自动尝试更轻量的视觉模型。` };
  }
  if (/model.*not found|pull model|does not exist/.test(lower)) {
    return { code: 'model_missing', message: `${modelLabel}未安装，软件将自动尝试本机其他视觉模型。` };
  }
  if (/abort|timed? ?out|timeout|超时/.test(lower)) {
    return { code: 'timeout', message: `${modelLabel}响应超时，软件将自动尝试其他视觉模型。` };
  }
  if (/fetch failed|econnrefused|connection refused|无法连接|failed to connect/.test(lower)) {
    return { code: 'service_unavailable', message: '无法连接本地 Ollama 服务。' };
  }
  return {
    code: 'request_failed',
    message: source ? `${modelLabel}分析失败：${source.slice(0, 220)}` : `${modelLabel}分析失败。`
  };
}
