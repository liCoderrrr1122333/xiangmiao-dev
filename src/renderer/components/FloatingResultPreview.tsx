import { useEffect, useMemo, useRef, useState, type WheelEvent } from 'react';
import { FolderOpen, Maximize2, Minimize2, X } from 'lucide-react';
import type { ResultArchiveItem } from '../../shared/types';

function folderFromPath(filePath?: string) {
  return filePath?.replace(/[\\/][^\\/]*$/, '');
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
}

function filePathToUrl(filePath?: string) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return encodeURI(`file://${absolutePath}`);
}

function imageSources(result?: ResultArchiveItem) {
  if (!result) return [];
  return [result.image.dataUrl, filePathToUrl(result.filePath)].filter((source): source is string => Boolean(source));
}

export function FloatingResultPreview({ result }: { result?: ResultArchiveItem }) {
  const lastSeenId = useRef<string | undefined>(undefined);
  const [current, setCurrent] = useState<ResultArchiveItem | undefined>();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const sources = useMemo(() => imageSources(current), [current]);
  const imageSrc = sources[sourceIndex] || '';

  function forwardWheelToPage(event: WheelEvent<HTMLElement>) {
    if (expanded) return;
    const candidates = new Set<HTMLElement>();
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      if (!(element instanceof HTMLElement) || element.closest('.result-float-layer')) continue;
      candidates.add(element);
      const scrollContainer = element.closest<HTMLElement>('.right-scroll-area, .right-stack, .left-stack');
      if (scrollContainer) candidates.add(scrollContainer);
    }
    const target =
      [...candidates].find((candidate) => {
        const style = window.getComputedStyle(candidate);
        const canScrollY = /(auto|scroll)/.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight;
        const canScrollX = /(auto|scroll)/.test(style.overflowX) && candidate.scrollWidth > candidate.clientWidth;
        return canScrollY || canScrollX;
      }) || document.querySelector<HTMLElement>('.right-scroll-area, .right-stack, .left-stack');
    if (!target) return;
    target.scrollBy({ top: event.deltaY, left: event.deltaX, behavior: 'auto' });
    event.preventDefault();
    event.stopPropagation();
  }

  useEffect(() => {
    if (!result) {
      if (lastSeenId.current === undefined) lastSeenId.current = '';
      setVisible(false);
      return;
    }
    if (lastSeenId.current === undefined) {
      lastSeenId.current = result.id;
      return;
    }
    if (result.id !== lastSeenId.current) {
      lastSeenId.current = result.id;
      const addedAt = new Date(result.addedAt).getTime();
      if (!Number.isFinite(addedAt) || Date.now() - addedAt > 30000) {
        setVisible(false);
        return;
      }
      setCurrent(result);
      setSourceIndex(0);
      setExpanded(false);
      setPaused(false);
      setVisible(true);
    }
  }, [result]);

  useEffect(() => {
    if (!visible || expanded || paused) return undefined;
    const timeoutId = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [visible, expanded, paused, current?.id]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVisible(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible]);

  if (!visible || !current) return null;

  return (
    <div className={`result-float-layer ${expanded ? 'is-expanded' : ''} ${paused ? 'is-paused' : ''}`} role="dialog" aria-label="最新生成结果预览">
      <article className="result-float-card" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onWheel={forwardWheelToPage}>
        <div className="result-float-head">
          <div>
            <span className="eyebrow">最新生成结果</span>
            <strong>{current.fileName || current.image.name}</strong>
          </div>
          <div className="result-float-actions">
            {current.filePath && (
              <button type="button" onClick={() => window.masklock?.openPath(folderFromPath(current.filePath) || current.filePath!)} title="打开文件夹" aria-label="打开文件夹">
                <FolderOpen />
              </button>
            )}
            <button type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? '缩小预览' : '放大预览'} aria-label={expanded ? '缩小预览' : '放大预览'}>
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </button>
            <button type="button" onClick={() => setVisible(false)} title="关闭预览" aria-label="关闭预览">
              <X />
            </button>
          </div>
        </div>
        <div className="result-float-image">
          {imageSrc && sourceIndex < sources.length ? (
            <img src={imageSrc} alt={current.image.name} onError={() => setSourceIndex((index) => index + 1)} />
          ) : (
            <span>预览不可用，但图片已保存到文件夹。</span>
          )}
        </div>
        <div className="result-float-meta">
          <span>第 {current.sequence || 1} 次生成</span>
          <span>{formatTime(current.addedAt)}</span>
        </div>
        {current.filePath && <code>{current.filePath}</code>}
        {!expanded && <div className="result-float-timer" aria-hidden="true" />}
      </article>
    </div>
  );
}
