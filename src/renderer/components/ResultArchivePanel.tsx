import { FolderOpen, ImagePlus, Star, Trash2 } from 'lucide-react';
import { IMAGE_IMPORT_ACCEPT } from '../../shared/imageImportPolicy';
import { useProjectStore } from '../state/projectStore';
import { filesToImageAssets, formatImageImportErrors } from '../utils/imageUtils';

function folderFromPath(filePath?: string) {
  return filePath?.replace(/[\\/][^\\/]*$/, '');
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function ResultArchivePanel() {
  const { project, addResult, updateProject } = useProjectStore();
  const latest = project.resultArchive[0];

  async function addFiles(files: FileList | File[]) {
    const { assets, errors } = await filesToImageAssets(files);
    assets.forEach(addResult);
    if (errors.length) alert(formatImageImportErrors(errors));
  }

  return (
    <section className="panel archive-panel" onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }} onDragOver={(e) => e.preventDefault()}>
      <div className="panel-head">
        <div>
          <h3>结果回传与归档</h3>
          <p>把网页生成后的图片拖回这里，记录评分、备注，并生成二次修正提示词。</p>
        </div>
        <div className="tool-strip">
          <input id="result-upload-input" hidden multiple type="file" accept={IMAGE_IMPORT_ACCEPT} onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <button onClick={() => document.querySelector<HTMLInputElement>('#result-upload-input')?.click()}>
            <ImagePlus /> 导入结果图
          </button>
        </div>
      </div>
      {project.resultArchive.length === 0 && <div className="empty-state">拖入结果图进行归档。</div>}
      {latest && (
        <article className="latest-result-preview">
          <img src={latest.image.dataUrl} alt={latest.image.name} />
          <div>
            <span className="eyebrow">最新结果</span>
            <h4>{latest.fileName || latest.image.name}</h4>
            <p>第 {latest.sequence || project.resultArchive.length} 次生成 · {formatTime(latest.addedAt)}</p>
            {latest.filePath && <code>{latest.filePath}</code>}
          </div>
          {latest.filePath && (
            <button type="button" onClick={() => window.masklock?.openPath(folderFromPath(latest.filePath) || latest.filePath!)}>
              <FolderOpen /> 打开文件夹
            </button>
          )}
        </article>
      )}
      <div className="archive-grid">
        {project.resultArchive.map((item) => (
          <article className="archive-card" key={item.id}>
            <img src={item.image.dataUrl} alt={item.image.name} />
            <div className="archive-meta">
              <b>{item.sequence ? `第 ${item.sequence} 次生成` : '手动归档'}</b>
              <span>{item.fileName || item.image.name}</span>
              <small>{formatTime(item.addedAt)}</small>
              {item.filePath && <code>{item.filePath}</code>}
              {item.promptText && <p>{item.promptText}</p>}
            </div>
            <textarea
              value={item.note}
              placeholder="结果备注"
              onChange={(event) =>
                updateProject({ resultArchive: project.resultArchive.map((x) => (x.id === item.id ? { ...x, note: event.target.value } : x)) })
              }
            />
            <div className="score-grid">
              {[
                ['identitySimilarity', '身份'],
                ['blendNaturalness', '融合'],
                ['outsidePreservation', '红圈外'],
                ['lightingConsistency', '光影'],
                ['skinRealism', '皮肤'],
                ['aiFeeling', 'AI感']
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={item.score[key as keyof typeof item.score]}
                    onChange={(event) =>
                      updateProject({
                        resultArchive: project.resultArchive.map((x) =>
                          x.id === item.id ? { ...x, score: { ...x.score, [key]: Number(event.target.value) } } : x
                        )
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="mini-actions">
              <button
                onClick={() =>
                  updateProject({ resultArchive: project.resultArchive.map((x) => (x.id === item.id ? { ...x, success: !x.success, needsRevision: false } : x)) })
                }
              >
                <Star /> 标记成功
              </button>
              <button onClick={() => updateProject({ resultArchive: project.resultArchive.filter((x) => x.id !== item.id) })}>
                <Trash2 /> 删除
              </button>
              {item.filePath && (
                <button type="button" onClick={() => window.masklock?.openPath(folderFromPath(item.filePath) || item.filePath!)}>
                  <FolderOpen /> 文件夹
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
