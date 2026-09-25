import { ChevronDown, Gem, ImagePlus, Shirt, Trash2 } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import type { WardrobeReferenceKind } from '../../shared/types';
import { IMAGE_IMPORT_ACCEPT } from '../../shared/imageImportPolicy';
import { useProjectStore } from '../state/projectStore';
import { filesToImageAssets, formatImageImportErrors } from '../utils/imageUtils';

const targetOptions: Record<WardrobeReferenceKind, string[]> = {
  clothing: ['整套穿搭', '上装', '外套', '下装', '连衣裙/连体装', '鞋靴'],
  accessory: ['对应配饰位置', '包袋', '首饰', '帽子', '眼镜', '腰带', '手表', '其他配饰']
};

const tagOptions: Record<WardrobeReferenceKind, string[]> = {
  clothing: ['版型', '颜色', '材质', '纹理', '图案', '穿搭层次', '完整复刻'],
  accessory: ['款式', '颜色', '材质', '佩戴位置', '尺寸比例', '细节纹理', '完整复刻']
};

export function WardrobeReferencePanel() {
  const { project, addWardrobeReferences, updateWardrobeReference, removeWardrobeReference, updateProject } = useProjectStore();
  const clothingCount = project.wardrobeReferences.filter((item) => item.kind === 'clothing').length;
  const accessoryCount = project.wardrobeReferences.length - clothingCount;
  const [isDragActive, setIsDragActive] = useState(false);

  async function addFiles(files: FileList | File[], kind: WardrobeReferenceKind) {
    const { assets, errors } = await filesToImageAssets(files);
    if (assets.length) addWardrobeReferences(assets, kind);
    if (errors.length) alert(formatImageImportErrors(errors));
  }

  function setKind(id: string, kind: WardrobeReferenceKind) {
    updateWardrobeReference(id, { kind, target: targetOptions[kind][0], tags: [] });
  }

  function toggleTag(id: string, tag: string, checked: boolean) {
    const reference = project.wardrobeReferences.find((item) => item.id === id);
    if (!reference) return;
    updateWardrobeReference(id, {
      tags: checked ? Array.from(new Set([...reference.tags, tag])) : reference.tags.filter((item) => item !== tag)
    });
  }

  function releaseDropZone(event: DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragActive(false);
  }

  return (
    <section
      className="panel wardrobe-panel"
      data-drag-active={isDragActive ? 'true' : undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={releaseDropZone}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragActive(false);
        void addFiles(event.dataTransfer.files, 'clothing');
      }}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="panel-head minimal-panel-head">
        <h3 className="section-title">
          <span className="section-copy">
            <b>穿搭参考图</b>
          </span>
        </h3>
        <div className="tool-strip wardrobe-tools">
          <span
            className="panel-counter"
            aria-label={`已添加 ${project.wardrobeReferences.length} 张衣物或配饰参考图，其中衣物 ${clothingCount} 张、配饰 ${accessoryCount} 张`}
          >
            {project.wardrobeReferences.length}/12
          </span>
          <input
            id="wardrobe-upload-input"
            hidden
            multiple
            type="file"
            accept={IMAGE_IMPORT_ACCEPT}
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files, 'clothing');
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            className="wardrobe-upload-button"
            onClick={() => document.querySelector<HTMLInputElement>('#wardrobe-upload-input')?.click()}
          >
            <ImagePlus /> 上传参考图
          </button>
          <button type="button" onClick={() => updateProject({ wardrobeReferences: [] })} disabled={!project.wardrobeReferences.length}>
            清空
          </button>
        </div>
      </div>

      <div className="filmstrip wardrobe-strip">
        {project.wardrobeReferences.length === 0 && (
          <div className="empty-state wardrobe-empty">
            <ImagePlus />
            <strong>上传参考图</strong>
            <span>衣物 / 配饰 / 场景</span>
          </div>
        )}

        {project.wardrobeReferences.map((reference, index) => (
          <article key={reference.id} className={`wardrobe-card ${reference.kind}`}>
            <div className="wardrobe-thumb">
              <img src={reference.dataUrl} alt={reference.name} />
              <span>{reference.kind === 'clothing' ? '衣物' : '配饰'} {index + 1}</span>
            </div>
            <details className="wardrobe-body material-card-details">
              <summary>
                <span>
                  <strong>{reference.kind === 'clothing' ? '衣物' : '配饰'} {index + 1}</strong>
                  <small>{reference.width} x {reference.height}</small>
                </span>
                <ChevronDown />
              </summary>
              <div className="material-card-editor">
                <div className="wardrobe-title">
                  <strong title={reference.name}>{reference.name}</strong>
                  <button type="button" onClick={() => removeWardrobeReference(reference.id)} title="删除参考图" aria-label="删除参考图">
                    <Trash2 />
                  </button>
                </div>

                <div className="wardrobe-kind-switch" role="group" aria-label="参考图类型">
                  <button type="button" className={reference.kind === 'clothing' ? 'active' : ''} onClick={() => setKind(reference.id, 'clothing')}>
                    <Shirt /> 衣物
                  </button>
                  <button type="button" className={reference.kind === 'accessory' ? 'active' : ''} onClick={() => setKind(reference.id, 'accessory')}>
                    <Gem /> 配饰
                  </button>
                </div>

                <label className="wardrobe-target">
                  <span>替换目标</span>
                  <select value={reference.target} onChange={(event) => updateWardrobeReference(reference.id, { target: event.target.value })}>
                    {targetOptions[reference.kind].map((target) => (
                      <option key={target} value={target}>{target}</option>
                    ))}
                  </select>
                </label>

                <div className="tag-grid wardrobe-tags">
                  {tagOptions[reference.kind].map((tag) => (
                    <label key={tag}>
                      <input type="checkbox" checked={reference.tags.includes(tag)} onChange={(event) => toggleTag(reference.id, tag, event.target.checked)} />
                      <span>{tag}</span>
                    </label>
                  ))}
                </div>

                <textarea
                  value={reference.note}
                  placeholder="补充颜色、材质、版型、佩戴位置或保留细节"
                  onChange={(event) => updateWardrobeReference(reference.id, { note: event.target.value })}
                />
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
