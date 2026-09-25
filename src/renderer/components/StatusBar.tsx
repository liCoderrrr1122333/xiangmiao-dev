import { useProjectStore } from '../state/projectStore';
import { useSettingsStore } from '../state/settingsStore';
import { generationProviderLabel, normalizeGenerationProvider } from '../../shared/generationProviderPolicy';
import { normalizeWebAiProvider } from '../../shared/webAiProviderPolicy';

export function StatusBar() {
  const project = useProjectStore((state) => state.project);
  const settings = useSettingsStore((state) => state.settings);
  const provider = normalizeGenerationProvider(settings.generationProvider, normalizeWebAiProvider(settings.webAiProvider));
  const parts = [
    project.mainImage ? '主图已上传' : '主图未上传',
    `人脸参考 ${project.referenceImages.length} 张`,
    ...(project.wardrobeReferences.length ? [`穿搭参考 ${project.wardrobeReferences.length} 张`] : []),
    project.maskCircle ? '红圈已标记' : '红圈未标记',
    project.promptHistory.length ? '提示词已生成' : '提示词未生成',
    project.sendHistory.length ? `已发送到 ${generationProviderLabel(provider)}` : '等待发送'
  ];
  return <footer className="statusbar">{parts.join('｜')}</footer>;
}
