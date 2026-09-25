import { Copy, ExternalLink, FolderOpen, RotateCcw } from 'lucide-react';
import { useProjectStore } from '../state/projectStore';
import { useSettingsStore } from '../state/settingsStore';
import { normalizeWebAiProvider } from '../../shared/webAiProviderPolicy';
import { generationProviderLabel, normalizeGenerationProvider } from '../../shared/generationProviderPolicy';

export function SendHistoryPanel({ onCopy }: { onCopy: (text?: string) => void }) {
  const project = useProjectStore((state) => state.project);
  const settings = useSettingsStore((state) => state.settings);
  return (
    <section className="panel history-panel">
      <div className="panel-head">
        <h3>发送历史记录</h3>
        <span className="badge">{project.sendHistory.length} 次</span>
      </div>
      {project.sendHistory.length === 0 && <div className="empty-state">还没有发送记录。点击“打开做图网页”后会自动归档。</div>}
      {project.sendHistory.map((item) => {
        const provider = normalizeGenerationProvider(item.provider, normalizeWebAiProvider(settings.webAiProvider));
        const providerLabel = generationProviderLabel(provider);
        const providerUrl = provider === 'gemini' ? settings.geminiUrl : provider === 'chatgpt' ? settings.chatGptUrl : '';
        return (
        <article className="history-card" key={item.id}>
          <div>
            <strong>{new Date(item.sentAt).toLocaleString()}</strong>
            <p>
              {item.projectName} · 人脸参考 {item.referenceCount} 张
              {item.wardrobeReferenceCount ? ` · 穿搭参考 ${item.wardrobeReferenceCount} 张` : ''} · {item.wordCount} 字符权重
            </p>
          </div>
          <div className="mini-actions">
            <button onClick={() => window.masklock?.openPath(item.exportDir)}>
              <FolderOpen /> 文件夹
            </button>
            <button onClick={() => onCopy(item.promptText)}>
              <Copy /> 复制提示词
            </button>
            {providerUrl && <button onClick={() => window.masklock?.openExternal(providerUrl)}>
              <ExternalLink /> {providerLabel}
            </button>}
            <button
              onClick={() => onCopy(
                `请基于这次发送继续修正。核心规则：${item.wardrobeReferenceCount ? '人脸只在红圈内替换，穿搭只在指定服饰配饰区域替换，其余内容完全不变。' : '红圈内可编辑，红圈外完全不变。'}\n\n${item.promptText}`
              )}
            >
              <RotateCcw /> 修正
            </button>
          </div>
          <div className="history-flags">
            <span className={item.copied ? 'ok' : 'warn'}>复制 {item.copied ? '成功' : '失败'}</span>
            <span className={item.chatGptOpened ? 'ok' : 'warn'}>{providerLabel} {item.chatGptOpened ? '已打开' : '未打开'}</span>
            <span className={item.exportFolderOpened ? 'ok' : 'warn'}>文件夹 {item.exportFolderOpened ? '已打开' : '未打开'}</span>
          </div>
        </article>
        );
      })}
    </section>
  );
}
