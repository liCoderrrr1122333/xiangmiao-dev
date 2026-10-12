import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, PencilLine, X } from 'lucide-react';
import { useProjectStore } from '../state/projectStore';
import { modeLabels } from '../prompt/templates';
import { countPromptCharacters, updatePromptDraftText } from '../../shared/promptPolicy';

interface Props {
  onCopy: () => void;
  providerLabel?: string;
}

export function PromptOutputPanel({
  onCopy,
  providerLabel = 'ChatGPT'
}: Props) {
  const { project, updateProject, setPromptDraft } = useProjectStore();
  const prompt = project.promptDraft;
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentText, setAdjustmentText] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const hasGeneratedPrompt = Boolean(prompt?.promptText.trim());

  useEffect(() => {
    if (!adjustmentOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => editorRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAdjustmentOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [adjustmentOpen]);

  function openAdjustment() {
    if (!prompt?.promptText.trim()) return;
    setAdjustmentText(prompt.promptText);
    setAdjustmentOpen(true);
  }

  function saveAdjustment() {
    if (!prompt || !adjustmentText.trim()) return;
    updateProject({ outputMode: 'custom' });
    setPromptDraft(
      updatePromptDraftText(
        { ...prompt, outputMode: 'custom', title: '像锚 自定义提示词', usedForSend: false },
        adjustmentText
      )
    );
    setAdjustmentOpen(false);
  }

  const adjustmentDialog = adjustmentOpen
    ? createPortal(
        <div
          className="levitated-workbench modal-backdrop prompt-adjustment-backdrop"
          data-testid="prompt-adjustment-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setAdjustmentOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="modal prompt-adjustment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-adjustment-title"
            aria-describedby="prompt-adjustment-description"
          >
            <span className="gold-corner gold-corner-top-left" aria-hidden="true" />
            <span className="gold-corner gold-corner-top-right" aria-hidden="true" />
            <span className="gold-corner gold-corner-bottom-left" aria-hidden="true" />
            <span className="gold-corner gold-corner-bottom-right" aria-hidden="true" />
            <header className="prompt-adjustment-header">
              <div>
                <h2 id="prompt-adjustment-title">提示词自定义微调</h2>
                <p id="prompt-adjustment-description">修改后将用于下一次生成</p>
              </div>
              <button
                className="prompt-adjustment-close"
                type="button"
                onClick={() => setAdjustmentOpen(false)}
                aria-label="关闭提示词微调"
                title="关闭"
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <textarea
              ref={editorRef}
              className="prompt-adjustment-editor"
              value={adjustmentText}
              onChange={(event) => setAdjustmentText(event.target.value)}
              aria-label="微调后的提示词"
              spellCheck={false}
            />
            <footer className="prompt-adjustment-footer">
              <span className="prompt-adjustment-count">{countPromptCharacters(adjustmentText)} 字符</span>
              <div className="prompt-adjustment-actions">
                <button type="button" onClick={() => setAdjustmentOpen(false)}>取消</button>
                <button
                  className="prompt-adjustment-save"
                  type="button"
                  disabled={!adjustmentText.trim()}
                  onClick={saveAdjustment}
                >
                  <Check aria-hidden="true" />
                  保存修改
                </button>
              </div>
            </footer>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <section className="panel prompt-panel">
        <div className="panel-head">
          <h3 className="section-title">
            <span className="section-index module-mark">做图</span>
            <span className="section-copy">
              <b>Image 2.0 提示词</b>
              <small>生成 · 微调 · 复制 · 发送</small>
            </span>
          </h3>
          <div className="section-head-right">
            <button className="prompt-copy-button" type="button" onClick={onCopy} disabled={!prompt} title="复制提示词">
              <Copy /> 复制
            </button>
          </div>
        </div>
        <div className="section-status-row prompt-status-row">
          <span className="badge subtle-chip">{prompt ? modeLabels[prompt.outputMode] : '待生成'}</span>
          <span>{prompt ? `${prompt.wordCount} 字符 · 已生成` : '等待一键生成提示词'}</span>
        </div>
        <div className="prompt-editor-shell">
          <div className="prompt-editor-top">
            <strong>提示词预览</strong>
            <em>{prompt ? modeLabels[prompt.outputMode] : '等待生成'}</em>
          </div>
          <textarea
            className="prompt-output"
            value={prompt?.promptText || ''}
            readOnly
            placeholder={`生成后的 ${providerLabel} 图片提示词会显示在这里。`}
            aria-label="提示词预览"
          />
        </div>
        {prompt && (
          <div className="prompt-meta">
            <span>{modeLabels[prompt.outputMode]}</span>
            <span>{prompt.wordCount} 字符权重</span>
            <span>{new Date(prompt.createdAt).toLocaleString()}</span>
          </div>
        )}
        <div className={`prompt-customize-entry ${hasGeneratedPrompt ? 'is-ready' : 'is-disabled'}`}>
          <span className="gold-corner gold-corner-top-left" aria-hidden="true" />
          <span className="gold-corner gold-corner-top-right" aria-hidden="true" />
          <span className="gold-corner gold-corner-bottom-left" aria-hidden="true" />
          <span className="gold-corner gold-corner-bottom-right" aria-hidden="true" />
          <div className="prompt-customize-copy">
            <strong>提示词自定义微调</strong>
            <small>{hasGeneratedPrompt ? '基于当前已生成提示词调整' : '等待一键生成提示词'}</small>
          </div>
          <button
            className="prompt-customize-button"
            type="button"
            disabled={!hasGeneratedPrompt}
            onClick={openAdjustment}
            title={hasGeneratedPrompt ? '打开提示词微调窗口' : '请先一键生成提示词'}
          >
            <span>进入微调</span>
            <PencilLine aria-hidden="true" />
          </button>
        </div>
      </section>
      {adjustmentDialog}
    </>
  );
}
