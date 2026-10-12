import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, Trash2, X } from 'lucide-react';
import type { RelayApiStatus } from '../../shared/types';
import { normalizeRelayApiConfig, type RelayApiConfig, type RelayApiProtocol } from '../../shared/relayApiConfig';
import {
  RELAY_BANANA_IMAGE_MODEL,
  RELAY_STANDARD_IMAGE_MODEL,
  normalizeRelayImageModel,
  relayImageModelLabel,
  type RelayImageModel
} from '../../shared/relayImageModels';

interface RelayApiConfigModalProps {
  open: boolean;
  status: RelayApiStatus | null;
  selectedModel: string;
  onClose: () => void;
  onStatusChange: (status: RelayApiStatus) => void;
  onModelChange: (model: RelayImageModel) => void;
}

export function RelayApiConfigModal({
  open,
  status,
  selectedModel: rawSelectedModel,
  onClose,
  onStatusChange,
  onModelChange
}: RelayApiConfigModalProps) {
  const selectedModel = normalizeRelayImageModel(rawSelectedModel);
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState<'connect' | 'clear' | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [protocol, setProtocol] = useState<RelayApiProtocol>('openai-images');
  const [model, setModel] = useState<string>(selectedModel);
  const [imagePath, setImagePath] = useState('/v1/images/edits');
  const [modelsPath, setModelsPath] = useState('/v1/models');
  const [error, setError] = useState('');

  const populate = (config?: RelayApiConfig) => {
    setBaseUrl(config?.baseUrl || '');
    setProtocol(config?.protocol || 'openai-images');
    setModel(config?.model || RELAY_STANDARD_IMAGE_MODEL);
    setImagePath(config?.imagePath || '/v1/images/edits');
    setModelsPath(config?.modelsPath || '/v1/models');
  };

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setApiKey('');
    setError('');
    void window.xiangmao?.getRelayApiStatus().then((next) => {
      if (disposed) return;
      onStatusChange(next);
      setRemember(next.remembered);
      populate(next.config);
    }).catch(() => setError('读取 API 配置失败，请关闭后重试。'));
    return () => { disposed = true; };
  }, [onStatusChange, open]);

  if (!open) return null;

  const saveAndTestConnection = async () => {
    setBusy('connect');
    setError('');
    try {
      const config = normalizeRelayApiConfig({ baseUrl, protocol, model, imagePath, modelsPath });
      if (JSON.stringify(config) !== JSON.stringify(status?.config) && !apiKey.trim()) {
        setError('更换服务或接口后，请重新粘贴该服务的 API Key。');
        return;
      }
      const configured = await window.xiangmao?.configureRelayApiKey({ apiKey, remember, config });
      if (configured) onStatusChange(configured);
      if (!configured?.ok) return;
      populate(configured.config);
      setApiKey('');
      const result = await window.xiangmao?.testRelayApiConnection({ model: selectedModel });
      if (result) onStatusChange(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'API 配置失败，请重试。');
    } finally {
      setBusy(null);
    }
  };

  const clearCredential = async () => {
    setBusy('clear');
    try {
      const result = await window.xiangmao?.clearRelayApiKey();
      if (result) onStatusChange(result);
      if (!result?.ok) return;
      setApiKey('');
      setRemember(false);
      populate();
      setError('');
    } catch {
      setError('清除失败，请重试。');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relay-config-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section className="relay-config-modal" role="dialog" aria-modal="true" aria-labelledby="relay-config-title">
        <header>
          <div>
            <KeyRound />
            <div>
              <h2 id="relay-config-title">配置自由 API</h2>
              <p>服务地址与密钥</p>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={Boolean(busy)} aria-label="关闭 API 配置" title="关闭">
            <X />
          </button>
        </header>

        <div className="relay-service-summary" aria-label="自由 API 配置">
          <div><span>协议</span><strong>{protocol === 'gemini' ? 'Gemini 图片' : 'OpenAI 图片'}</strong></div>
          <div><span>模型</span><strong>{relayImageModelLabel(model)}</strong></div>
          <div><span>输出</span><strong>自动匹配原图</strong></div>
        </div>

        <div className="relay-config-fields">
          <label>
            <span>服务地址（Base URL）</span>
            <input type="url" value={baseUrl} disabled={Boolean(busy)} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com" autoComplete="off" spellCheck={false} />
          </label>
          <details className="relay-interface-settings">
            <summary>接口设置</summary>
          <fieldset className="relay-model-selector">
            <legend>图片模型</legend>
            <div role="radiogroup" aria-label="API 图片模型">
              {([
                [RELAY_STANDARD_IMAGE_MODEL, '标准图片', '使用 gpt-image-2 编辑图片'],
                [RELAY_BANANA_IMAGE_MODEL, '香蕉生图', '使用香蕉图片模型编辑图片']
              ] as const).map(([model, label, description]) => (
                <button
                  key={model}
                  type="button"
                  role="radio"
                  aria-checked={protocol === (model === RELAY_BANANA_IMAGE_MODEL ? 'gemini' : 'openai-images')}
                  className={protocol === (model === RELAY_BANANA_IMAGE_MODEL ? 'gemini' : 'openai-images') ? 'active' : ''}
                  onClick={() => {
                    onModelChange(model);
                    setModel(model);
                    setProtocol(model === RELAY_BANANA_IMAGE_MODEL ? 'gemini' : 'openai-images');
                    setImagePath(model === RELAY_BANANA_IMAGE_MODEL ? '/v1beta/models/{model}:streamGenerateContent' : '/v1/images/edits');
                  }}
                  disabled={Boolean(busy)}
                >
                  <strong>{label}</strong>
                  <span>{description}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <label><span>模型名称</span><input value={model} disabled={Boolean(busy)} onChange={event => setModel(event.target.value)} spellCheck={false} /></label>
          <label><span>图片编辑接口路径</span><input value={imagePath} disabled={Boolean(busy)} onChange={event => setImagePath(event.target.value)} spellCheck={false} /></label>
          <label><span>模型列表接口路径</span><input value={modelsPath} disabled={Boolean(busy)} onChange={event => setModelsPath(event.target.value)} spellCheck={false} /></label>
          </details>
          <label>
            <span>API Key</span>
            <input
              type="password"
              disabled={Boolean(busy)}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              placeholder={status?.maskedKey || '仅本次运行有效'}
            />
          </label>
          <label className="relay-remember-option">
            <input type="checkbox" disabled={Boolean(busy)} checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span>记住本机，使用 Electron safeStorage 加密保存</span>
          </label>
        </div>

        <div className={`relay-config-status ${status?.configured ? 'configured' : ''}`} role="status">
          <strong>{status?.configured ? `已配置 · ${status.maskedKey}` : 'API 未配置'}</strong>
          <span>{error || status?.message || '请输入自己的服务地址和 API Key。'}</span>
        </div>

        <footer>
          <button type="button" className="relay-clear-button" onClick={() => void clearCredential()} disabled={Boolean(busy)}>
            {busy === 'clear' ? <LoaderCircle className="spin" /> : <Trash2 />} 清除密钥
          </button>
          <div>
            <button
              type="button"
              className="primary"
              onClick={() => void saveAndTestConnection()}
              disabled={Boolean(busy) || !baseUrl.trim() || (!apiKey.trim() && !status?.configured)}
            >
              {busy === 'connect' && <LoaderCircle className="spin" />}
              {apiKey.trim() ? '保存并测试' : '测试连接'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
