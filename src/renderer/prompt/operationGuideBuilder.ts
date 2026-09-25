import type { ProjectState } from '../../shared/types';
import { faceReferenceResponsibility } from './faceReferencePrompt';

function referenceLabel(index: number) {
  const labels = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return labels[index] || String(index + 1);
}

export function buildOperationGuide(project: ProjectState, providerLabel = 'ChatGPT') {
  const referenceOrder = project.referenceImages
    .map((reference, index) => `${index + 2}. 上传 人脸参考图${referenceLabel(index)}${reference.isPrimary ? '（主参考图）' : ''}：${reference.name}`)
    .join('\n');
  const wardrobeStart = Math.max(1, project.referenceImages.length) + 2;
  const wardrobeOrder = project.wardrobeReferences
    .map(
      (reference, index) =>
        `${wardrobeStart + index}. 上传 ${reference.kind === 'clothing' ? '衣物' : '配饰'}参考图${referenceLabel(index)}：${reference.name}（目标：${reference.target}）`
    )
    .join('\n');
  const promptStep = wardrobeStart + project.wardrobeReferences.length;
  const hasWardrobe = project.wardrobeReferences.length > 0;
  const hasWebPose = Boolean(project.selectedWebPose);
  const faceOcclusionApplied = Boolean(project.faceOcclusionEnabled && project.faceOcclusionMask?.raster?.dataUrl);
  const mainMatFileName = faceOcclusionApplied ? '01_红圈蒙脸主垫图' : '01_红圈主垫图';
  const mainMatCleanup = faceOcclusionApplied ? '红圈或蒙脸遮挡' : '红圈';
  const wardrobeRule = hasWardrobe
    ? '穿搭参考图只负责各自指定的衣物或配饰；未指定穿搭保持主垫图原样。'
    : '本轮没有穿搭参考图，全部衣物和配饰保持主垫图原样。';
  const poseRule = hasWebPose
    ? `已选择的网感姿势 ${project.selectedWebPose?.id}“${project.selectedWebPose?.title}”替代原图姿态，仅为姿势适配调整身体、手部和必要衣物褶皱。`
    : '本轮没有网感姿势，身体姿态和手部关系保持主垫图原样。';

  return `请在 ${providerLabel} 中按照以下流程操作：

1. 上传 ${mainMatFileName}，作为最终像素尺寸、完整构图、背景、红圈外保护和允许编辑区域的唯一主图；最终图片不得保留${mainMatCleanup}。
${referenceOrder || '2. 上传至少一张人脸参考图，并标记主参考图。'}
${wardrobeOrder ? `${wardrobeOrder}\n` : ''}${promptStep}. 粘贴软件已复制好的完整提示词。
${promptStep + 1}. 素材职责：${faceReferenceResponsibility} 人脸主参考图唯一决定发型；${wardrobeRule}
${promptStep + 2}. 姿势职责：${poseRule}
${promptStep + 3}. 生成后检查目标男生身份、主参考图发型、穿搭来源、姿势来源、遮挡关系和背景保护是否正确。

当前项目：${project.projectName}`;
}
