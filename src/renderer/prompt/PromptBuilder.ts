import { nanoid } from 'nanoid';
import type { OutputMode, ProjectState, PromptResult } from '../../shared/types';
import { countPromptCharacters } from '../../shared/promptPolicy';
import { faceReferenceResponsibility } from './faceReferencePrompt';
import { fallbackText, modeLabels, negativeBase } from './templates';
import { wardrobeNegativeConstraints, wardrobePromptBlock, wardrobeReferenceSignature } from './wardrobePrompt';
import { webPoseSelectionSignature } from '../../shared/webPosePolicy';
import { webPoseNegativeConstraints, webPosePromptBlock } from './webPosePrompt';

export interface PromptBuildOptions {
  includeOriginalUnderstanding?: boolean;
}

function compactField(value: string, fallback: string, maxLength = 180) {
  const text = fallbackText(value, fallback).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/[，。；、\s]+$/, '')}。`;
}

function primaryFaceReference(project: ProjectState) {
  return project.referenceImages.find((item) => item.isPrimary) || project.referenceImages[0];
}

function attachmentResponsibilities(project: ProjectState) {
  const primary = primaryFaceReference(project);
  const primaryName = primary?.name ? `“${primary.name}”` : '标记为主参考图的人脸参考图';
  const wardrobeRole = project.wardrobeReferences.length
    ? '\n3. 穿搭参考图：只负责各自明确指定的衣物或配饰外观，不负责人物身份、发型、背景或姿势。'
    : '';

  return `【附件职责】
1. 红圈主垫图：负责目标人物的位置与身体承载关系，以及构图、背景、透视、拍摄距离、原有遮挡、环境光影、画质和最终像素尺寸，不负责目标人物身份。
2. 人脸参考图：${faceReferenceResponsibility} ${primaryName}是发型唯一基准；其中的衣物、背景、姿势和拍摄环境不作为依据。${wardrobeRole}`;
}

function originalUnderstanding(project: ProjectState, includeOriginalUnderstanding: boolean) {
  if (!includeOriginalUnderstanding) {
    return `【主垫图基准】
本轮未使用文字原图分析。请直接依据主垫图中实际可见的构图、背景、人物位置、姿态、光影、遮挡和画质完成编辑，不推测画面外内容。`;
  }
  const light = compactField(
    project.lightingMakeupDescription,
    '面部光影、阴影方向、妆容、肤色质感、皮肤纹理、噪点和普通手机拍摄画质按主垫图保持。',
    210
  );

  if (project.wardrobeReferences.length) {
    return `【原图理解】
本轮只继承原图分析中的光影、妆容与画质：${light}`;
  }

  const scene = compactField(project.sceneDescription, '场景、背景、构图和整体氛围按主垫图保持。', 150);
  const face = compactField(project.faceDirectionDescription, '头部角度、面部朝向、眼神方向和表情强度按主垫图匹配。', 150);
  if (project.selectedWebPose) {
    return `【原图理解】
场景：${scene}
面部朝向：${face}
光影、妆容与画质：${light}
原图姿态描述不作为本轮依据，改用已选择的网感姿势。`;
  }

  const pose = compactField(project.poseDescription, '身体姿态、手部位置、肩颈关系、身体朝向和拍摄距离按主垫图保持。', 150);
  return `【原图理解】
场景：${scene}
姿态：${pose}
面部朝向：${face}
光影、妆容与画质：${light}`;
}

function wardrobeRule(project: ProjectState) {
  const referenceRule = wardrobePromptBlock(project);
  if (referenceRule) return referenceRule;
  const poseFit = project.selectedWebPose
    ? '衣物本身的款式、颜色、材质、纹理和图案保持主垫图不变，姿势适配遵循下方姿势规则。'
    : '衣物轮廓、褶皱、袖口、下摆、穿搭层次和遮挡关系也保持主垫图不变。';

  return `【穿搭规则】
本轮没有穿搭参考图。目标人物的衣物和配饰全部以主垫图为唯一基准，不得参考人脸参考图中的衣服，也不得擅自更换、增加、删除或重新设计任何服饰配饰。
${poseFit}`;
}

function skinTextureRule(project: ProjectState) {
  const level = Math.max(0, Math.min(10, Math.round(project.sliders?.skinRealism ?? 9)));
  if (level <= 3) {
    return `【脸庞质感】
身份来自人脸参考图。皮肤仍跟随主垫图红圈内原来的光影和清晰度，不要换成磨皮或棚拍皮肤。`;
  }
  if (level <= 6) {
    return `【脸庞质感】
五官、脸型和身份只来自人脸参考图。皮肤纹理、毛孔、噪点、清晰度和脸上的明暗只跟随主垫图红圈内原来的脸，不要搬用人脸参考图的光影或美颜肤质。`;
  }
  return `【脸庞质感】
五官、脸型、眉眼、鼻型和身份只来自人脸参考图，不要保留主垫图人物的原身份。
皮肤纹理、毛孔、细纹、汗毛、传感器噪点、压缩感和清晰度必须贴近主垫图红圈内原来那张脸。不要提高皮肤清晰度，不要磨皮，不要塑料皮，不要把参考图的棚拍光或美颜肤色搬过来。
下颌、发际和脖子的肤色与噪点要和周围皮肤连续，不要出现一圈硬边。`;
}

function protectionBoundary(project: ProjectState) {
  const editable = [
    '目标人脸',
    '匹配主参考图所需的头发区域',
    ...(project.wardrobeReferences.length ? ['穿搭参考图明确指定的服饰配饰区域'] : []),
    ...(project.selectedWebPose ? ['已选择网感姿势所需的身体与衣物褶皱区域'] : [])
  ].join('、');
  const poseBoundary = project.selectedWebPose ? '' : '身体、肩颈、手臂和手部也保持主垫图不变。';
  return `【保护边界】
只允许编辑${editable}。除此之外，背景、其他人物、未指定服饰配饰、道具、构图、镜头、画幅、环境光、画质和最终像素尺寸保持主垫图不变。${poseBoundary}`;
}

function finalCheck(project: ProjectState) {
  const wardrobeCheck = project.wardrobeReferences.length
    ? '指定衣物和配饰来自各自对应的穿搭参考图，未指定穿搭保持主垫图原样。'
    : '全部衣物和配饰保持主垫图原样。';
  const poseCheck = project.selectedWebPose
    ? '身体执行已选择的网感姿势。'
    : '身体姿态保持主垫图原样。';
  return `【最终检查】
- 目标人物身份明确来自人脸参考图中的目标男生，发型来自人脸主参考图。
- ${wardrobeCheck}
- ${poseCheck}
- 没有保留主垫图人物的原身份，画面也没有红圈、纯色蒙脸遮挡、红色描边或其他标记。`;
}

export function regionalPrompt(project: ProjectState, options: PromptBuildOptions = {}) {
  const includeOriginalUnderstanding = options.includeOriginalUnderstanding !== false;
  const promptProject = includeOriginalUnderstanding
    ? project
    : { ...project, selectedWebPose: undefined };
  const poseRule = webPosePromptBlock(promptProject);
  const customProtection = project.customLockedElements.length
    ? `\n特别保护：${project.customLockedElements.join('；')}。`
    : '';
  const negative = [
    ...(project.wardrobeReferences.length ? ['不要混用人脸参考图与穿搭参考图的职责'] : ['不要把人脸参考图中的衣服作为穿搭依据']),
    '不要保留主垫图人物的原身份',
    ...(project.wardrobeReferences.length ? ['不要保留已指定替换的原穿搭'] : []),
    '不要直接贴脸、贴头或平面粘贴衣物',
    '不要修改未授权区域',
    '不要出现假脸感、穿模、错误遮挡、过度美颜、塑料皮肤、磨皮或明显 AI 感',
    '不要提高皮肤清晰度，不要把人脸参考图的光影和肤质搬到主垫图上'
  ].join('；');

  return `【任务目标】
请根据本轮附件直接完成图片编辑。本次只编辑红圈对应的目标人物；最终图片中的目标人物必须是人脸参考图中的目标男生，并自然出现在主垫图原有的位置和场景中。

${attachmentResponsibilities(promptProject)}

${originalUnderstanding(promptProject, includeOriginalUnderstanding)}

${wardrobeRule(promptProject)}${poseRule ? `\n\n${poseRule}` : ''}

【融合要求】
将目标男生自然重建到红圈人物位置，不要直接贴脸或拼接头部。保持人脸、头发、手部、衣领和配饰之间真实的前后遮挡。新脸的身份来自人脸参考图，脸庞质感必须回到主垫图原来的皮肤。

${skinTextureRule(promptProject)}

${protectionBoundary(promptProject)}${customProtection}

${finalCheck(promptProject)}

【负面限制】
${negative}。`;
}

export class PromptBuilder {
  static build(project: ProjectState, mode: OutputMode = project.outputMode, options: PromptBuildOptions = {}): PromptResult {
    const includeOriginalUnderstanding = options.includeOriginalUnderstanding !== false;
    const promptProject = includeOriginalUnderstanding
      ? project
      : { ...project, selectedWebPose: undefined };
    const promptText = mode === 'custom' ? '' : regionalPrompt(promptProject, options);
    const negativePrompt = PromptBuilder.negativePrompt(promptProject);
    return {
      id: nanoid(),
      title: `像锚 ${modeLabels[mode]}提示词`,
      promptText,
      negativePrompt,
      checklist: [
        '主垫图是构图、场景、光影、画质和最终尺寸基准',
        '人脸参考图唯一负责目标人物身份，主参考图唯一决定发型',
        promptProject.wardrobeReferences.length
          ? '指定穿搭按对应参考图替换，未指定穿搭保持主垫图原样'
          : '未上传穿搭参考图，全部穿搭保持主垫图原样',
        promptProject.selectedWebPose
          ? '已选择网感姿势替代原图姿态'
          : '未选择网感姿势，身体姿态保持主垫图原样',
        '未授权区域和红圈外保护保持不变'
      ],
      outputMode: mode,
      wordCount: countPromptCharacters(promptText),
      createdAt: new Date().toISOString(),
      wardrobeSignature: wardrobeReferenceSignature(promptProject),
      webPoseSignature: webPoseSelectionSignature(promptProject.selectedWebPose)
    };
  }

  static negativePrompt(project: ProjectState) {
    const base = negativeBase.map((item) => {
      let next = project.wardrobeReferences.length ? item.replace(/衣服、?/g, '').replace(/服装、?/g, '').replace(/道具、?/g, '') : item;
      if (project.selectedWebPose) {
        next = next.replace(/身体、?/g, '').replace(/手部、?/g, '').replace(/肩膀、?/g, '');
      }
      return next;
    });
    return [
      ...base,
      ...wardrobeNegativeConstraints(project),
      ...webPoseNegativeConstraints(project),
      ...project.customLockedElements.map((item) => `不要改变${item.replace(/^不(?:要)?改变/, '')}`)
    ].join('；');
  }

  static sendInstruction(project: ProjectState) {
    const attachments = project.wardrobeReferences.length ? '、穿搭参考图' : '';
    return `依次上传红圈主垫图、人脸参考图${attachments}，再粘贴软件生成的完整提示词。附件职责和条件分支已经写入提示词，请不要额外混用素材。项目：${project.projectName}`;
  }
}
