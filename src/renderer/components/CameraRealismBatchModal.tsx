import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, FolderOpen, ScanFace, X } from 'lucide-react';
import type { CameraRealismFolderItem, ResultArchiveItem } from '../../shared/types';

type CameraRealismBatchItem = ResultArchiveItem | CameraRealismFolderItem;
type CameraRealismItemProgress = 'pending' | 'processing' | 'success' | 'error';

interface CameraRealismBatchModalProps {
  items: CameraRealismBatchItem[];
  processing: boolean;
  completedCount: number;
  totalCount: number;
  onClose: () => void;
  onConfirm: (selectedIds: string[], strength: number) => void;
  variant?: 'camera' | 'face';
  sourceMode?: 'archive' | 'folder';
  sourceDir?: string;
  folderLoading?: boolean;
  itemProgress?: Record<string, CameraRealismItemProgress>;
  onSelectArchive?: () => void;
  onChooseFolder?: () => void;
  onStop?: () => void;
}

function isFolderItem(item: CameraRealismBatchItem): item is CameraRealismFolderItem {
  return 'status' in item;
}

export function CameraRealismBatchModal({
  items,
  processing,
  completedCount,
  totalCount,
  onClose,
  onConfirm,
  variant = 'camera',
  sourceMode = 'archive',
  sourceDir,
  folderLoading = false,
  itemProgress = {},
  onSelectArchive,
  onChooseFolder,
  onStop
}: CameraRealismBatchModalProps) {
  const selectableIds = items.filter((item) => !isFolderItem(item) || item.status === 'ready').map((item) => item.id);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(selectableIds));
  const [strength, setStrength] = useState(50);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelectedIds(new Set(selectableIds));
  }, [items, sourceMode]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !processing) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, processing]);

  function toggleItem(id: string) {
    if (processing) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isFaceMode = variant === 'face';
  const title = isFaceMode ? '批量面部自然化' : '批量降 AI 感';
  const description = isFaceMode
    ? '只处理识别到的人脸区域，背景和服装保持不变。'
    : sourceMode === 'folder'
      ? '选择文件夹中的图片，原图会完整保留，结果输出到新子目录。'
      : '选择需要处理的结果图，原图会完整保留。';
  const Icon = isFaceMode ? ScanFace : Camera;

  return createPortal(
    <div
      className="levitated-workbench modal-backdrop camera-realism-batch-backdrop"
      onMouseDown={(event) => {
        if (!processing && event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className={`modal camera-realism-batch-modal ${isFaceMode ? 'face-naturalization-batch-modal' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-realism-batch-title"
        aria-describedby="camera-realism-batch-description"
      >
        <header className="camera-realism-batch-header">
          <div>
            <h2 id="camera-realism-batch-title"><Icon aria-hidden="true" />{title}</h2>
            <p id="camera-realism-batch-description">{description}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="camera-realism-batch-close"
            disabled={processing}
            onClick={onClose}
            aria-label={`关闭${title}`}
            title="关闭"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {!isFaceMode && (
          <>
            <div className="camera-realism-source-switch" role="group" aria-label="图片来源">
              <button
                type="button"
                className={sourceMode === 'archive' ? 'active' : ''}
                disabled={processing}
                onClick={onSelectArchive}
              >
                结果归档
              </button>
              <button
                type="button"
                className={sourceMode === 'folder' ? 'active' : ''}
                disabled={processing || folderLoading}
                onClick={onChooseFolder}
              >
                <FolderOpen aria-hidden="true" />
                {folderLoading ? '正在读取...' : '导入文件夹'}
              </button>
            </div>
            <div className="camera-realism-strength-control">
              <div className="camera-realism-strength-heading">
                <label htmlFor="camera-realism-strength">处理强度</label>
                <output htmlFor="camera-realism-strength">{strength}</output>
              </div>
              <div className="camera-realism-strength-range">
                <span>轻微</span>
                <input
                  id="camera-realism-strength"
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={strength}
                  disabled={processing}
                  onChange={(event) => setStrength(Number(event.currentTarget.value))}
                  aria-valuetext={`${strength} 强度`}
                />
                <span>强烈</span>
              </div>
              <small>
                {strength <= 30
                  ? '轻微增加自然噪点与镜头质感'
                  : strength <= 60
                    ? '自然强度，适合大多数人像结果'
                    : strength <= 85
                      ? '明显增加细节、光晕与边缘镜头感'
                      : '强烈成像处理，细节和压缩痕迹更明显'}
              </small>
            </div>
          </>
        )}

        <div className="camera-realism-batch-toolbar">
          <span>已选择 {selectedIds.size}/{selectableIds.length} 张{sourceDir ? ` · ${sourceDir}` : ''}</span>
          <div>
            <button type="button" disabled={processing || selectedIds.size === selectableIds.length} onClick={() => setSelectedIds(new Set(selectableIds))}>全选</button>
            <button type="button" disabled={processing || selectedIds.size === 0} onClick={() => setSelectedIds(new Set())}>清空</button>
          </div>
        </div>

        <div className="camera-realism-batch-grid">
          {items.map((item, index) => {
            const selected = selectedIds.has(item.id);
            const folderItem = isFolderItem(item) ? item : undefined;
            const archiveItem = isFolderItem(item) ? undefined : item;
            const preview = folderItem?.previewDataUrl || archiveItem?.image.dataUrl || '';
            const fileName = folderItem?.fileName || archiveItem?.fileName || archiveItem?.image.name || '';
            const width = folderItem?.width || archiveItem?.image.width;
            const height = folderItem?.height || archiveItem?.image.height;
            const progress = itemProgress[item.id];
            const disabled = processing || folderItem?.status === 'error';
            return (
              <label key={item.id} className={`camera-realism-batch-item ${selected ? 'is-selected' : ''} ${folderItem?.status === 'error' ? 'is-error' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => toggleItem(item.id)}
                  aria-label={`选择结果 ${index + 1}`}
                />
                {preview ? <img src={preview} alt={fileName} /> : <div className="camera-realism-batch-placeholder"><X aria-hidden="true" /></div>}
                <span>
                  <b>{folderItem ? fileName : `结果 ${archiveItem?.sequence || items.length - index}`}</b>
                  <small>{folderItem?.error || (width && height ? `${width} × ${height}` : fileName)}</small>
                  {progress && progress !== 'pending' && <small className={`item-progress ${progress}`}>{progress === 'processing' ? '处理中' : progress === 'success' ? '已完成' : '处理失败'}</small>}
                </span>
                {selected && <Check className="camera-realism-batch-check" aria-hidden="true" />}
              </label>
            );
          })}
        </div>

        <footer className="camera-realism-batch-footer">
          <span>{processing ? `正在处理 ${completedCount}/${totalCount}` : sourceMode === 'folder' ? '外部图片不会写入当前项目归档' : '处理结果将作为新图片加入归档'}</span>
          <div>
            <button type="button" onClick={processing ? onStop : onClose}>{processing ? '停止' : '取消'}</button>
            <button
              type="button"
              className="camera-realism-batch-confirm"
              disabled={processing || selectedIds.size === 0}
              onClick={() => onConfirm([...selectedIds], strength)}
            >
              <Icon aria-hidden="true" />
              {processing ? `处理中 ${completedCount}/${totalCount}` : `批量处理 ${selectedIds.size} 张`}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
