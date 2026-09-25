import { Copy, ExternalLink, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildRevisionPrompt, revisionIssueLabels } from '../prompt/revisionTemplates';
import { useProjectStore } from '../state/projectStore';
import { useSettingsStore } from '../state/settingsStore';
import { normalizeWebAiProvider } from '../../shared/webAiProviderPolicy';
import { generationProviderLabel, normalizeGenerationProvider } from '../../shared/generationProviderPolicy';

export function RevisionPromptPanel({ onCopy }: { onCopy: (text?: string) => void }) {
  const [issues, setIssues] = useState<string[]>(['红圈外内容被改动']);
  const settings = useSettingsStore((state) => state.settings);
  const provider = normalizeGenerationProvider(settings.generationProvider, normalizeWebAiProvider(settings.webAiProvider));
  const providerLabel = generationProviderLabel(provider);
  const providerUrl = provider === 'gemini' ? settings.geminiUrl : provider === 'chatgpt' ? settings.chatGptUrl : '';
  const wardrobeEnabled = useProjectStore((state) => state.project.wardrobeReferences.length > 0);
  const visibleIssues = useMemo(
    () => wardrobeEnabled ? revisionIssueLabels : revisionIssueLabels.filter((issue) => !['衣物不像穿搭参考图', '配饰不像配饰参考图', '服饰穿模或遮挡错误'].includes(issue)),
    [wardrobeEnabled]
  );
  const prompt = useMemo(() => buildRevisionPrompt(issues, wardrobeEnabled), [issues, wardrobeEnabled]);

  function toggle(issue: string) {
    setIssues((items) => (items.includes(issue) ? items.filter((item) => item !== issue) : [...items, issue]));
  }

  return (
    <section className="panel revision-panel">
      <div className="panel-head">
        <h3>二次修正提示词</h3>
        <span className="badge danger">{wardrobeEnabled ? '人脸 + 穿搭定向修正' : '只修红圈内'}</span>
      </div>
      <div className="issue-grid">
        {visibleIssues.map((issue) => (
          <label key={issue}>
            <input type="checkbox" checked={issues.includes(issue)} onChange={() => toggle(issue)} />
            <span>{issue}</span>
          </label>
        ))}
      </div>
      <textarea className="prompt-output" value={prompt} readOnly />
      <div className="action-row">
        <button onClick={() => onCopy(prompt)}>
          <Copy /> 一键复制
        </button>
        {providerUrl && <button onClick={() => window.masklock?.openExternal(providerUrl)}>
          <ExternalLink /> 继续打开 {providerLabel}
        </button>}
        <button onClick={() => setIssues(['红圈外内容被改动'])}>
          <RotateCcw /> 重置
        </button>
      </div>
    </section>
  );
}
