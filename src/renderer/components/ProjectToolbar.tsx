import {
  Download,
  FileInput,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Settings,
  Sparkles,
  WandSparkles
} from 'lucide-react';
import { useProjectStore } from '../state/projectStore';

interface Props {
  onNew: () => void;
  onSave: () => void;
  onImport: () => void;
  onExport: () => void;
  onSettings: () => void;
  onHelp: () => void;
  analysisCollapsed: boolean;
  inspectorCollapsed: boolean;
  onToggleAnalysis: () => void;
  onToggleInspector: () => void;
}

export function ProjectToolbar({
  onNew,
  onSave,
  onImport,
  onExport,
  onSettings,
  onHelp,
  analysisCollapsed,
  inspectorCollapsed,
  onToggleAnalysis,
  onToggleInspector
}: Props) {
  const { project, updateProject, loadExample } = useProjectStore();
  return (
    <header className="topbar">
      <div className="brand">
        <img className="logo-mark" src="./yaochuang-tray.png" alt="" aria-hidden="true" width="34" height="34" />
        <div>
          <strong>耀创工坊</strong>
        </div>
      </div>
      <input
        className="project-name"
        value={project.projectName}
        onChange={(event) => updateProject({ projectName: event.target.value })}
        name="projectName"
        autoComplete="off"
        spellCheck={false}
        aria-label="项目名称"
      />
      <nav className="toolbar-actions">
        <button className="toolbar-primary" onClick={onNew} aria-label="新建项目" title="新建项目">
          <Sparkles /> <span className="toolbar-label">新建项目</span>
        </button>
        <button className="toolbar-strong" onClick={onSave} aria-label="保存项目" title="保存项目">
          <Save /> <span className="toolbar-label">保存项目</span>
        </button>
        <button onClick={onImport} aria-label="导入项目" title="导入项目">
          <FileInput /> <span className="toolbar-label">导入项目</span>
        </button>
        <button onClick={onExport} aria-label="导出项目" title="导出项目">
          <Download /> <span className="toolbar-label">导出项目</span>
        </button>
        <button className="toolbar-sample" onClick={loadExample} aria-label="载入示例项目" title="示例项目">
          <WandSparkles /> <span className="toolbar-label">示例项目</span>
        </button>
        <button
          className="toolbar-layout"
          onClick={onToggleAnalysis}
          aria-label={analysisCollapsed ? '展开原图理解面板' : '收起原图理解面板'}
          aria-pressed={analysisCollapsed}
          title={analysisCollapsed ? '展开原图理解' : '收起原图理解'}
        >
          {analysisCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <button
          className="toolbar-layout"
          onClick={onToggleInspector}
          aria-label={inspectorCollapsed ? '展开制作流程面板' : '收起制作流程面板'}
          aria-pressed={inspectorCollapsed}
          title={inspectorCollapsed ? '展开制作流程' : '收起制作流程'}
        >
          {inspectorCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
        </button>
        <button className="toolbar-iconic" onClick={onSettings} aria-label="打开设置" title="设置">
          <Settings /> <span className="toolbar-label">设置</span>
        </button>
        <button className="toolbar-iconic" onClick={onHelp} aria-label="打开帮助" title="帮助">
          <HelpCircle /> <span className="toolbar-label">帮助</span>
        </button>
      </nav>
    </header>
  );
}
