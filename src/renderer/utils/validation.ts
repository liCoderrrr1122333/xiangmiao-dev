import type { ProjectState, ValidationItem } from '../../shared/types';
import { regionalPrompt, type PromptBuildOptions } from '../prompt/PromptBuilder';
import { wardrobeReferenceSignature } from '../prompt/wardrobePrompt';
import { webPoseSelectionSignature } from '../../shared/webPosePolicy';

export function buildGenerationChecklist(project: ProjectState, options: PromptBuildOptions = {}): ValidationItem[] {
  const includeOriginalUnderstanding = options.includeOriginalUnderstanding !== false;
  return [
    { id: 'main', label: '主图已上传', level: 'required', status: project.mainImage ? 'ok' : 'block' },
    { id: 'circle', label: '红圈已标记', level: 'required', status: project.maskCircle ? 'ok' : 'block' },
    { id: 'refs', label: '至少一张参考图已上传', level: 'required', status: project.referenceImages.length > 0 ? 'ok' : 'block' },
    { id: 'primary', label: '已设置主参考图', level: 'recommended', status: project.referenceImages.some((item) => item.isPrimary) ? 'ok' : 'warn' },
    ...(project.wardrobeReferences.length
      ? [{
          id: 'wardrobe',
          label: `已配置 ${project.wardrobeReferences.length} 张衣物配饰参考图`,
          level: 'recommended' as const,
          status: project.wardrobeReferences.every((item) => item.target.trim()) ? 'ok' as const : 'warn' as const
        }]
      : []),
    ...(includeOriginalUnderstanding
      ? [
          { id: 'scene', label: '已填写场景描述', level: 'recommended' as const, status: project.sceneDescription.trim() ? 'ok' as const : 'warn' as const },
          { id: 'pose', label: '已填写动作姿态描述', level: 'recommended' as const, status: project.poseDescription.trim() ? 'ok' as const : 'warn' as const },
          { id: 'face', label: '已填写面部朝向描述', level: 'recommended' as const, status: project.faceDirectionDescription.trim() ? 'ok' as const : 'warn' as const },
          { id: 'light', label: '已填写光影妆容描述', level: 'recommended' as const, status: project.lightingMakeupDescription.trim() ? 'ok' as const : 'warn' as const }
        ]
      : []),
    { id: 'protect', label: '红圈外保护强度为 10', level: 'recommended', status: project.sliders.outsideProtection === 10 ? 'ok' : 'warn' },
    { id: 'mode', label: '已选择提示词输出模式', level: 'recommended', status: project.outputMode ? 'ok' : 'warn' }
  ];
}

export function buildSendChecklist(project: ProjectState, options: PromptBuildOptions = {}): ValidationItem[] {
  const draft = project.promptDraft;
  const hasPromptText = Boolean(draft?.promptText.trim());
  const selectedWebPose = options.includeOriginalUnderstanding === false ? undefined : project.selectedWebPose;
  return [
    ...buildGenerationChecklist(project, options),
    {
      id: 'occlusion',
      label: '一键蒙脸（可选）',
      level: 'recommended',
      status: project.faceOcclusionEnabled && project.faceOcclusionMask?.raster?.dataUrl ? 'ok' : 'warn'
    },
    {
      id: project.outputMode === 'custom' ? 'custom-prompt' : 'prompt',
      label: project.outputMode === 'custom' ? '自定义提示词已填写' : '提示词草稿已生成',
      level: 'required',
      status: hasPromptText ? 'ok' : 'block'
    },
    ...(project.outputMode === 'regional'
      ? [{
          id: 'wardrobe-prompt',
          label: '衣物配饰要求已写入当前草稿',
          level: 'required' as const,
          status:
            draft?.promptText.includes('【穿搭规则】') && draft.wardrobeSignature === wardrobeReferenceSignature(project)
              ? 'ok' as const
              : 'block' as const
        }]
      : []),
    ...(project.outputMode === 'regional'
      ? [{
          id: 'web-pose-prompt',
          label: '网感姿势已写入当前草稿',
          level: 'required' as const,
          status:
            draft?.webPoseSignature === webPoseSelectionSignature(selectedWebPose) &&
            (selectedWebPose
              ? draft.promptText.includes('【姿势规则】')
              : !draft.promptText.includes('【姿势规则】'))
              ? 'ok' as const
              : 'block' as const
        }]
      : []),
    ...(project.outputMode === 'regional'
      ? [{
          id: 'prompt-source',
          label: '提示词素材与原图理解仍为当前版本',
          level: 'required' as const,
          status: draft?.promptText === regionalPrompt(project, options) ? 'ok' as const : 'block' as const
        }]
      : []),
    { id: 'send-mode', label: '已选择发送模式', level: 'recommended', status: project.sendMode ? 'ok' : 'warn' }
  ];
}

export function hasBlockingItems(items: ValidationItem[]) {
  return items.some((item) => item.level === 'required' && item.status === 'block');
}

export function firstBlockingItem(items: ValidationItem[]) {
  return items.find((item) => item.level === 'required' && item.status === 'block');
}
