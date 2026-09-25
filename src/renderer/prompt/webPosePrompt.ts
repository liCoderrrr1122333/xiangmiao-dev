import type { ProjectState } from '../../shared/types';

export function webPosePromptBlock(project: ProjectState) {
  const selected = project.selectedWebPose;
  if (!selected) return '';
  return `【姿势规则】
网感姿势 ${selected.id}：${selected.title}
${selected.description}

使用这条姿势替代原图身体姿态，只允许重建目标人物的身体、肩颈、手臂、手部以及必要衣物褶皱；穿搭来源继续遵循上方穿搭规则。
新姿势必须适合主垫图已经可见的身体范围和拍摄环境，不新增道具，不强行补出画幅外肢体。`;
}

export function applyWebPoseEditingIntent(prompt: string, project: ProjectState) {
  const block = webPosePromptBlock(project);
  return block ? `${prompt}\n\n${block}` : prompt;
}

export function webPoseNegativeConstraints(project: ProjectState) {
  if (!project.selectedWebPose) return [];
  return [
    '不要用原图姿态覆盖已选择的网感姿势',
    '不要新增道具、人物、场景元素或画幅外肢体',
    '不要出现肢体错位、多余手指或错误遮挡'
  ];
}
