import { ChevronDown, GripVertical, ImagePlus, Star, Trash2 } from 'lucide-react';
import { useState, type ChangeEvent, type DragEvent } from 'react';
import { useProjectStore } from '../state/projectStore';
import { IMAGE_IMPORT_ACCEPT } from '../../shared/imageImportPolicy';
import { filesToImageAssets, formatImageImportErrors } from '../utils/imageUtils';

const tags = ['主参考图', '正脸', '侧脸', '五官参考', '脸型参考', '肤色参考', '妆容参考', '光影参考', '表情参考', '发型仅参考', '不参考背景'];

export function ReferenceImagePanel() {
  const { project, addReferences, updateReference, removeReference, updateProject } = useProjectStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  async function addFiles(files: FileList | File[]) {
    const { assets, errors } = await filesToImageAssets(files);
    if (assets.length) addReferences(assets);
    if (errors.length) alert(formatImageImportErrors(errors));
  }

  function setPrimary(id: string) {
    updateProject({
      referenceImages: project.referenceImages.map((item) => ({
        ...item,
        isPrimary: item.id === id,
        tags: item.id === id ? Array.from(new Set([...item.tags, '主参考图'])) : item.tags.filter((tag) => tag !== '主参考图')
      }))
    });
  }

  function toggleTag(id: string, tag: string, checked: boolean) {
    const ref = project.referenceImages.find((item) => item.id === id);
    if (!ref) return;

    if (tag === '主参考图') {
      updateProject({
        referenceImages: project.referenceImages.map((item) => ({
          ...item,
          isPrimary: item.id === id ? checked : false,
          tags:
            item.id === id
              ? checked
                ? Array.from(new Set([...item.tags, tag]))
                : item.tags.filter((value) => value !== tag)
              : item.tags.filter((value) => value !== tag)
        }))
      });
      return;
    }

    updateReference(id, {
      tags: checked ? [...ref.tags, tag] : ref.tags.filter((item) => item !== tag)
    });
  }

  function reorder(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const refs = [...project.referenceImages];
    const from = refs.findIndex((item) => item.id === dragId);
    const to = refs.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = refs.splice(from, 1);
    refs.splice(to, 0, moved);
    updateProject({ referenceImages: refs });
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files || [])];
    event.currentTarget.value = '';
    if (files.length) void addFiles(files);
  }

  function releaseDropZone(event: DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragActive(false);
  }

  return (
    <section
      className={`panel reference-panel ${isDragActive ? 'is-drag-active' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={releaseDropZone}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragActive(false);
        void addFiles(event.dataTransfer.files);
      }}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="panel-head minimal-panel-head">
        <h3 className="section-title">
          <span className="section-copy">
            <b>人脸参考图</b>
          </span>
        </h3>
        <div className="tool-strip">
          <span className="panel-counter" aria-label={`已添加 ${project.referenceImages.length} 张人脸参考图`}>
            {project.referenceImages.length}/6
          </span>
          <input id="ref-upload-input" hidden multiple type="file" accept={IMAGE_IMPORT_ACCEPT} onChange={selectFiles} />
          <button onClick={() => document.querySelector<HTMLInputElement>('#ref-upload-input')?.click()}>
            <ImagePlus /> 上传参考图
          </button>
          <button onClick={() => updateProject({ referenceImages: [] })}>批量清空</button>
        </div>
      </div>
      <div className="filmstrip">
        {project.referenceImages.length === 0 && (
          <div className="empty-state reference-empty">
            <ImagePlus />
            <strong>添加参考图</strong>
            <span>JPG / PNG / WEBP / HEIC</span>
          </div>
        )}
        {project.referenceImages.map((ref, index) => (
          <article
            key={ref.id}
            className={`ref-card ${ref.isPrimary ? 'primary' : ''}`}
            draggable
            onDragStart={() => setDragId(ref.id)}
            onDrop={(e) => {
              e.preventDefault();
              reorder(ref.id);
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            <GripVertical className="drag-icon" />
            <div className="ref-thumb">
              <img src={ref.dataUrl} alt={ref.name} />
              {ref.isPrimary && <span>PRIMARY</span>}
            </div>
            <details className="ref-body material-card-details">
              <summary>
                <span>
                  <strong>{ref.isPrimary ? '主参考图' : `参考图 ${index + 1}`}</strong>
                  <small>{ref.width} x {ref.height}</small>
                </span>
                <ChevronDown />
              </summary>
              <div className="material-card-editor">
                <div className="ref-title">
                  <strong title={ref.name}>{ref.name}</strong>
                  <button onClick={() => setPrimary(ref.id)} title="设置主参考图">
                    <Star className={ref.isPrimary ? 'filled' : ''} />
                  </button>
                  <button onClick={() => removeReference(ref.id)} title="删除">
                    <Trash2 />
                  </button>
                </div>
                <div className="tag-grid">
                  {tags.map((tag) => (
                    <label key={tag}>
                      <input
                        type="checkbox"
                        checked={ref.tags.includes(tag)}
                        onChange={(event) => toggleTag(ref.id, tag, event.target.checked)}
                      />
                      <span>{tag}</span>
                    </label>
                  ))}
                </div>
                <textarea value={ref.note} placeholder="备注：正脸、侧脸、妆容、光影等" onChange={(event) => updateReference(ref.id, { note: event.target.value })} />
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
