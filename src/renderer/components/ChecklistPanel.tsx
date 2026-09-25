import { AlertTriangle, CheckCircle2, CircleSlash2 } from 'lucide-react';
import type { ValidationItem } from '../../shared/types';

export function ChecklistPanel({ title, items }: { title: string; items: ValidationItem[] }) {
  const blockers = items.filter((item) => item.status === 'block').length;
  const warnings = items.filter((item) => item.status === 'warn').length;
  const completed = items.filter((item) => item.status === 'ok').length;
  const visibleItems = items.filter((item) => item.status !== 'ok');
  return (
    <section className="panel checklist-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className={blockers ? 'badge danger' : warnings ? 'badge warn' : 'badge ok'}>
          {blockers ? `${blockers} 项缺失` : warnings ? `${warnings} 项建议` : '已就绪'}
        </span>
      </div>
      <div className="checklist">
        {(visibleItems.length ? visibleItems : items.slice(0, 1)).map((item) => (
          <div key={item.id} className={`check-item ${item.status}`}>
            {item.status === 'ok' ? <CheckCircle2 /> : item.status === 'warn' ? <AlertTriangle /> : <CircleSlash2 />}
            <span>{item.label}</span>
            <small>{item.level === 'required' ? '必须' : '建议'}</small>
          </div>
        ))}
      </div>
      {completed > 0 && (
        <details className="checklist-completed">
          <summary>已完成 {completed}/{items.length}</summary>
          <div className="checklist">
            {items
              .filter((item) => item.status === 'ok')
              .map((item) => (
                <div key={item.id} className="check-item ok">
                  <CheckCircle2 />
                  <span>{item.label}</span>
                  <small>{item.level === 'required' ? '必须' : '建议'}</small>
                </div>
              ))}
          </div>
        </details>
      )}
      {warnings > 0 && blockers === 0 && <p className="soft-note">可以直接生成，但补充这些信息会让效果更稳定、更自然。</p>}
    </section>
  );
}
