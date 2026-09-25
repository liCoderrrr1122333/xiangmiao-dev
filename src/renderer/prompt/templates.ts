import type { ProjectState, StoredOutputMode } from '../../shared/types';
import { faceReferenceResponsibility } from './faceReferencePrompt';

export const modeLabels: Record<StoredOutputMode, string> = {
  compact: '精简版',
  standard: '标准版',
  strict: '极致严格版',
  regional: '区域编辑定制版',
  custom: '自定义'
};

export const defaultLockedElements = [
  '不改变红圈外背景',
  '不改变衣服',
  '不改变身体姿势',
  '不改变手部',
  '不改变道具',
  '不改变构图',
  '不改变镜头焦距',
  '不改变图片比例',
  '不改变整体画质',
  '不改变原图光影环境',
  '不改变红圈外任何人物或物体'
];

export const negativeBase = [
  '不要修改未授权区域',
  '不要改变背景、衣服、身体、手部、道具、构图、光影、画幅和画质',
  '不要改变非目标人物的头发，也不要改变目标人物的脖子和肩膀',
  '不要出现拼接感、假脸感、边缘断层、肤色不一致、光影不一致',
  '不要过度美颜、塑料皮、网红脸、AI 感、五官漂移、比例变形',
  '不要生成证件伪造、误导材料或任何未经授权的人像替换'
];

export function fallbackText(value: string, fallback: string) {
  return value.trim().length ? value.trim() : fallback;
}

export function referenceSummary(project: ProjectState) {
  if (project.referenceImages.length === 0) return '未提供参考图。';
  if (project.referenceImages.length === 1) {
    return `${faceReferenceResponsibility} 参考人物五官结构、脸型、肤色、表情、妆容和皮肤质感，不参考背景、衣服或场景。`;
  }
  const primary = project.referenceImages.find((item) => item.isPrimary) || project.referenceImages[0];
  return `${faceReferenceResponsibility} 以“${primary.name}”作为主参考图，其他参考图仅辅助理解身份、五官结构、脸型、肤色、表情和妆容。背景不参考，衣服不参考，场景不参考。`;
}

export function strictLockParagraph(project: ProjectState) {
  const hasWardrobeEditing = project.wardrobeReferences.length > 0;
  const hasAccessoryEditing = project.wardrobeReferences.some((item) => item.kind === 'accessory');
  const hasWebPose = Boolean(project.selectedWebPose);
  const locked = [
    ...project.lockedElements.filter(
      (item) =>
        (!hasWardrobeEditing || (!item.includes('衣服') && (!hasAccessoryEditing || !item.includes('道具')))) &&
        (!hasWebPose || (!item.includes('身体姿势') && !item.includes('手部')))
    ),
    ...project.customLockedElements
  ].filter((item) => item && !['不改变红圈外头发', '不改变发丝边缘'].includes(item));
  return [
    hasWebPose ? '最高优先级规则：人脸、必要头发区域、已选择姿势所需区域与指定服饰配饰目标区域可编辑，其他区域保持原图不变。' : hasWardrobeEditing ? '最高优先级规则：人脸、必要头发区域与指定服饰配饰目标区域可编辑，其他区域完全不变。' : '最高优先级规则：人脸与必要头发区域可编辑，其他区域完全不变。',
    hasWebPose
      ? '除人脸、目标人物头发、已选择姿势所需的人体与衣物褶皱区域和指定服饰配饰目标外，背景、其他人物、未指定道具、构图、镜头焦距、图片比例、光影环境、画质、噪点、纹理、色调和清晰度必须保持与原图一致。'
      : hasWardrobeEditing
      ? '红圈区域用于人脸身份替换，目标人物头发区域用于匹配主参考图发型；服饰配饰参考图指定的穿搭区域是另一类独立授权编辑范围。'
      : '红圈区域用于人脸身份替换，并允许为匹配主参考图发型处理目标人物头发区域。',
    hasWardrobeEditing
      ? '人脸身份在红圈内替换，发型只处理目标人物头发区域；衣物配饰只在对应穿搭目标区域替换，不要扩散到其他内容。'
      : '人脸身份在红圈内替换，发型只处理目标人物头发区域，不要编辑其他内容。',
    `禁止改变内容：${locked.join('；')}。`,
    hasWardrobeEditing
      ? '除人脸、目标人物头发和指定服饰配饰目标外，背景、身体比例、姿态、手部、未指定道具、构图、镜头焦距、图片比例、光影环境、画质、噪点、纹理、色调和清晰度必须保持与原图一致。'
      : '除人脸与目标人物头发外，背景、身体、衣服、手部、道具、构图、镜头焦距、图片比例、光影环境、画质、噪点、纹理、色调、清晰度和其他元素必须保持与原图完全一致。'
  ].join('\n');
}
