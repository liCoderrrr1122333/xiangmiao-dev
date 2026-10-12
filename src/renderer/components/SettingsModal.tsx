import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore } from '../state/settingsStore';
import { DOUBAO_ANALYSIS_MODELS, normalizeDoubaoAnalysisModel } from '../../shared/analysisProviderPolicy';
import type { AppSettings } from '../../shared/types';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useSettingsStore();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || [])
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    window.xiangmao?.writeSettings(next);
  }

  function setSessionKey(value: string) {
    setSettings({ apiKeySessionOnly: value });
  }

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="关闭设置">
          <X />
        </button>
        <h2 id="settings-title">设置</h2>
        <div className="settings-grid">
          <section>
            <h3>基础设置</h3>
            <label>
              主题
              <select value={settings.theme} onChange={(e) => patch('theme', e.target.value as AppSettings['theme'])}>
                <option value="dark">深色</option>
                <option value="light">浅色</option>
                <option value="system">跟随系统</option>
              </select>
            </label>
            <label>
              默认提示词语言
              <select value={settings.defaultLanguage} onChange={(e) => patch('defaultLanguage', e.target.value as AppSettings['defaultLanguage'])}>
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="bilingual">中英双语</option>
              </select>
            </label>
            <label>
              字体大小
              <select value={settings.fontSize} onChange={(e) => patch('fontSize', e.target.value as AppSettings['fontSize'])}>
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </label>
            <label>
              动态效果
              <select value={settings.motionMode} onChange={(e) => patch('motionMode', e.target.value as AppSettings['motionMode'])}>
                <option value="full">完整</option>
                <option value="reduced">减弱</option>
                <option value="off">关闭</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={settings.autoSave} onChange={(e) => patch('autoSave', e.target.checked)} />
              自动保存项目
            </label>
            <label>
              <input type="checkbox" checked={settings.includeNegativePrompt} onChange={(e) => patch('includeNegativePrompt', e.target.checked)} />
              生成负面约束段落
            </label>
          </section>

          <section>
            <h3>网页自动化设置</h3>
            <label>
              默认打开方式
              <select value={settings.chatGptOpenMode} onChange={(e) => patch('chatGptOpenMode', e.target.value as AppSettings['chatGptOpenMode'])}>
                <option value="auto">自动判断</option>
                <option value="desktop-first">优先桌面端</option>
                <option value="browser-first">优先浏览器</option>
                <option value="browser-only">只打开浏览器</option>
              </select>
            </label>
            <label>
              ChatGPT 网页地址
              <input value={settings.chatGptUrl} onChange={(e) => patch('chatGptUrl', e.target.value)} />
            </label>
            <label>
              Gemini 网页地址
              <input value={settings.geminiUrl} onChange={(e) => patch('geminiUrl', e.target.value)} />
            </label>
            <label>
              网页自动化模式
              <select value={settings.chatGptAutomationMode} onChange={(e) => patch('chatGptAutomationMode', e.target.value as AppSettings['chatGptAutomationMode'])}>
                <option value="manual">手动：只打开当前服务商</option>
                <option value="upload-review">自动上传并粘贴，发送前确认</option>
                <option value="auto-send">全自动上传、粘贴并发送</option>
              </select>
            </label>
            <label>
              自动窗口登录失效时
              <select value={settings.chatGptLoginFallback} onChange={(e) => patch('chatGptLoginFallback', e.target.value as AppSettings['chatGptLoginFallback'])}>
                <option value="chrome">打开已登录的 Chrome / 默认浏览器</option>
                <option value="auto-window">停在自动窗口等待登录</option>
              </select>
            </label>
            <p className="soft-note">
              ChatGPT 与 Gemini 共用一个像锚专属 Chrome，并分别使用独立标签页；登录和安全验证始终由你手动完成。
            </p>
            <label>
              <input type="checkbox" checked={settings.chatGptKeepAliveEnabled} onChange={(e) => patch('chatGptKeepAliveEnabled', e.target.checked)} />
              长期保留网页登录
            </label>
            <p className="soft-note">
              专属 Chrome 登录资料保存在本机 D 盘，软件不会导出 Cookie 或 Token。
            </p>
            <label>
              <input type="checkbox" checked={settings.autoOpenExportFolder} onChange={(e) => patch('autoOpenExportFolder', e.target.checked)} />
              发送时自动打开导出文件夹
            </label>
            <label>
              <input type="checkbox" checked={settings.autoCopyPrompt} onChange={(e) => patch('autoCopyPrompt', e.target.checked)} />
              发送时自动复制提示词
            </label>
          </section>

          <section>
            <h3>原图分析模型</h3>
            <p className="soft-note">
              不另选分析来源时，默认使用豆包 Seed 2.1 Pro。域名和模型已内置，不需要填写。
            </p>
            <label>
              AI 供应商
              <select value={settings.apiProvider} onChange={(e) => patch('apiProvider', e.target.value as AppSettings['apiProvider'])}>
                <option value="doubao">豆包 Seed 2.1 Pro，默认</option>
                <option value="chatgpt">ChatGPT 内置窗口，高质量</option>
                <option value="ollama">本地模型，免费离线</option>
                <option value="gemini">Gemini 专属窗口</option>
              </select>
            </label>
            {settings.apiProvider === 'doubao' ? (
              <>
              <label>
                豆包模型
                <select
                  value={normalizeDoubaoAnalysisModel(settings.doubaoAnalysisModel)}
                  onChange={(event) => patch('doubaoAnalysisModel', normalizeDoubaoAnalysisModel(event.target.value))}
                >
                  {DOUBAO_ANALYSIS_MODELS.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <p className="soft-note">
                已选择豆包。自动使用本机保存的 Key，只需在上面五个模型里选择。做图仍走当前制作通道。
              </p>
              </>
            ) : (
            <label>
              API Key（Ollama / ChatGPT / Gemini 不需要）
              <input type="password" value={settings.apiKeySessionOnly} onChange={(e) => setSessionKey(e.target.value)} placeholder="仅其他备用供应商需要填写" />
            </label>
            )}
            {settings.apiProvider !== 'doubao' && (
            <label>
              Base URL
              <input value={settings.apiBaseUrl} onChange={(e) => patch('apiBaseUrl', e.target.value)} />
            </label>
            )}
            {settings.apiProvider !== 'doubao' && (
            <>
            <label>
              原图分析视觉模型 / 接入点 ID
              <input list="ollama-vision-model-options" value={settings.apiVisionModel} onChange={(e) => patch('apiVisionModel', e.target.value)} />
              <datalist id="ollama-vision-model-options">
                <option value="auto">自动选择可用模型</option>
                <option value="qwen2.5vl:3b">qwen2.5vl:3b</option>
                <option value="gemma3:4b">gemma3:4b</option>
                <option value="moondream:latest">moondream:latest</option>
                <option value="minicpm-v:latest">minicpm-v:latest</option>
                <option value="llava:7b">llava:7b</option>
              </datalist>
            </label>
            <p className="soft-note">
              本地模型默认连接 http://127.0.0.1:11434，模型填写 auto 时会自动选择本机可用视觉模型。
            </p>
            </>
            )}
          </section>

          <section>
            <h3>API 直接生成</h3>
            <p className="soft-note">
              这个入口只影响 API 直接生图，不影响豆包原图分析。豆包分析使用内置域名，不在这里配置。
            </p>
            <label>
              <input type="checkbox" checked={settings.apiModeEnabled} onChange={(e) => patch('apiModeEnabled', e.target.checked)} />
              启用 API 直接生成
            </label>
            <label>
              直接生成模型
              <input value={settings.apiModel} onChange={(e) => patch('apiModel', e.target.value)} />
            </label>
            <label>
              输出尺寸
              <select value={settings.apiSize} onChange={(e) => patch('apiSize', e.target.value)}>
                <option>1024x1024</option>
                <option>1024x1536</option>
                <option>1536x1024</option>
              </select>
            </label>
          </section>
        </div>
        <p className="danger-hint">
          专属 Chrome 使用像锚独立的本机登录资料。API Key 只保留在当前运行会话；本地 Ollama 仅连接本机服务。
        </p>
      </div>
    </div>
  );
}
