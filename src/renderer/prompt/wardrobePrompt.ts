import type { ProjectState, WardrobeReference } from '../../shared/types';

export function wardrobeReferenceSignature(project: ProjectState) {
  return JSON.stringify(
    project.wardrobeReferences.map((reference) => ({
      id: reference.id,
      kind: reference.kind,
      target: reference.target,
      tags: [...reference.tags].sort(),
      note: reference.note.trim()
    }))
  );
}

function referenceLine(reference: WardrobeReference, index: number) {
  const kind = reference.kind === 'clothing' ? '衣物参考' : '配饰参考';
  const aspects = reference.tags.length
    ? reference.tags.join('、')
    : reference.kind === 'clothing'
      ? '款式、版型、颜色、材质、纹理与穿搭层次'
      : '款式、颜色、材质、尺寸比例与佩戴位置';
  const note = reference.note.trim() ? `；补充要求：${reference.note.trim()}` : '';
  return `${index + 1}. ${kind}“${reference.name}”对应目标人物的${reference.target}，以图中实际可见的${aspects}为准${note}。`;
}

export function wardrobePromptBlock(project: ProjectState) {
  if (!project.wardrobeReferences.length) return '';
  const targets = [...new Set(project.wardrobeReferences.map((reference) => reference.target.trim()).filter(Boolean))];
  const targetText = targets.length ? targets.join('、') : '指定衣物或配饰';
  const references = project.wardrobeReferences.map(referenceLine).join('\n');
  const fitRule = project.selectedWebPose
    ? '衣物的姿势适配遵循下方姿势规则。'
    : '衣物服从主垫图原有身体比例、姿态、透视、重力和遮挡关系。';

  return `【穿搭规则】
本轮已经上传穿搭参考图。穿搭参考图是对应服饰外观的唯一基准，不是普通风格参考。
只替换目标人物的${targetText}；未被指定的其他衣物、配饰、鞋子、包袋和道具继续保持主垫图原样。

素材对应：
${references}

执行时采用参考图中实际可见的款式、版型、颜色、材质、纹理、图案和穿搭层次；不可见部分只按同一件服饰的结构合理补全，不得新增款式、图案、文字或配饰。${fitRule}
穿搭参考图中的模特身份、脸、发型、背景和姿势不作为生成依据；人脸参考图中的衣物也不作为穿搭依据。`;
}

export function applyWardrobeEditingIntent(prompt: string, project: ProjectState) {
  const block = wardrobePromptBlock(project);
  return block ? `${prompt}\n\n${block}` : prompt;
}

export function wardrobeNegativeConstraints(project: ProjectState) {
  if (!project.wardrobeReferences.length) return [];
  return [
    '不要混用人脸参考图和穿搭参考图的职责',
    '不要保留已指定替换的原穿搭',
    '不要让衣物悬空、穿模、贴图化或产生错误遮挡',
    '不要修改未指定的服饰配饰'
  ];
}
