import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function createProject(wardrobeReferences = []) {
  return {
    projectName: '穿搭提示词测试',
    outputMode: 'regional',
    sceneDescription: '场景唯一标记：原图人物站在旧衣柜旁。',
    poseDescription: '姿态唯一标记：原图人物双手交叉。',
    faceDirectionDescription: '面部唯一标记：原图人物侧脸朝左。',
    lightingMakeupDescription: '光影唯一标记：柔和侧光、自然淡妆、保留手机画质。',
    referenceImages: [],
    wardrobeReferences,
    customLockedElements: []
  };
}

function faceReference() {
  return {
    id: 'face-primary',
    name: '主参考图.png',
    type: 'image/png',
    size: 1,
    dataUrl: 'data:image/png;base64,AA==',
    isPrimary: true,
    note: ''
  };
}

function clothingReference() {
  return {
    id: 'wardrobe-1',
    name: '白色衬衫.png',
    type: 'image/png',
    size: 1,
    dataUrl: 'data:image/png;base64,AA==',
    kind: 'clothing',
    target: '上衣',
    tags: ['版型', '颜色', '材质'],
    note: ''
  };
}

function selectedPose() {
  return {
    id: 4,
    title: '交叉重心',
    description: '双腿形成前后重心，上身轻微扭转，手臂在腰前自然交叠。'
  };
}

test('prompt branches keep identity, wardrobe and pose sources mutually exclusive', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const { PromptBuilder } = await vite.ssrLoadModule('/src/renderer/prompt/PromptBuilder.ts');

  const base = { ...createProject(), referenceImages: [faceReference()] };
  const original = PromptBuilder.build(base).promptText;
  assert.match(original, /最终图片中的目标人物必须是人脸参考图中的目标男生/);
  assert.match(original, /本轮没有穿搭参考图/);
  assert.match(original, /衣物和配饰[^。]*主垫图为唯一基准/);
  assert.match(original, /场景唯一标记/);
  assert.match(original, /姿态唯一标记/);
  assert.match(original, /面部唯一标记/);
  assert.match(original, /光影唯一标记/);
  assert.doesNotMatch(original, /穿搭参考图是对应服饰外观的唯一基准/);

  const originalWithPose = PromptBuilder.build({ ...base, selectedWebPose: selectedPose() }).promptText;
  assert.match(originalWithPose, /本轮没有穿搭参考图/);
  assert.match(originalWithPose, /网感姿势 4：交叉重心/);
  assert.match(originalWithPose, /场景唯一标记/);
  assert.doesNotMatch(originalWithPose, /姿态唯一标记/);
  assert.match(originalWithPose, /面部唯一标记/);
  assert.match(originalWithPose, /光影唯一标记/);
  assert.match(originalWithPose, /衣物本身的款式、颜色、材质、纹理和图案保持主垫图不变/);

  const wardrobe = PromptBuilder.build({ ...base, wardrobeReferences: [clothingReference()] }).promptText;
  assert.match(wardrobe, /穿搭参考图是对应服饰外观的唯一基准/);
  assert.match(wardrobe, /只替换目标人物的上衣/);
  assert.match(wardrobe, /未被指定的其他衣物、配饰、鞋子、包袋和道具继续保持主垫图原样/);
  assert.doesNotMatch(wardrobe, /本轮没有穿搭参考图/);
  assert.doesNotMatch(wardrobe, /场景唯一标记|姿态唯一标记|面部唯一标记/);
  assert.match(wardrobe, /光影唯一标记/);

  const wardrobeWithPose = PromptBuilder.build({
    ...base,
    wardrobeReferences: [clothingReference()],
    selectedWebPose: selectedPose()
  }).promptText;
  assert.match(wardrobeWithPose, /穿搭参考图是对应服饰外观的唯一基准/);
  assert.match(wardrobeWithPose, /网感姿势 4：交叉重心/);
  assert.doesNotMatch(wardrobeWithPose, /本轮没有穿搭参考图|场景唯一标记|姿态唯一标记|面部唯一标记/);
  assert.match(wardrobeWithPose, /光影唯一标记/);

  for (const prompt of [original, originalWithPose, wardrobe, wardrobeWithPose]) {
    assert.ok((prompt.match(/【最高优先级/g) || []).length <= 1, '最高优先级不得重复');
    assert.equal((prompt.match(/【附件职责】/g) || []).length, 1, '附件职责只定义一次');
    assert.equal((prompt.match(/【保护边界】/g) || []).length, 1, '保护边界只定义一次');
    assert.equal((prompt.match(/【最终检查】/g) || []).length, 1, '最终检查只定义一次');
    assert.doesNotMatch(prompt, /请在 Image 2\.0 中/);
  }
});

test('API prompt can intentionally skip original understanding and the selected web pose', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const [{ PromptBuilder }, { buildGenerationChecklist, buildSendChecklist }] = await Promise.all([
    vite.ssrLoadModule('/src/renderer/prompt/PromptBuilder.ts'),
    vite.ssrLoadModule('/src/renderer/utils/validation.ts')
  ]);
  const project = {
    ...createProject([clothingReference()]),
    referenceImages: [faceReference()],
    selectedWebPose: selectedPose(),
    sliders: { outsideProtection: 10 },
    sendMode: 'copy'
  };
  const options = { includeOriginalUnderstanding: false };
  const promptDraft = PromptBuilder.build(project, 'regional', options);

  assert.match(promptDraft.promptText, /【主垫图基准】/);
  assert.match(promptDraft.promptText, /本轮未使用文字原图分析/);
  assert.doesNotMatch(promptDraft.promptText, /【原图理解】|场景唯一标记|姿态唯一标记|面部唯一标记|光影唯一标记/);
  assert.doesNotMatch(promptDraft.promptText, /【姿势规则】|网感姿势 4|交叉重心/);
  assert.match(promptDraft.promptText, /穿搭参考图是对应服饰外观的唯一基准/);
  const disabledAnalysisChecklist = buildGenerationChecklist(project, options);
  assert.equal(disabledAnalysisChecklist.some((item) => ['scene', 'pose', 'face', 'light'].includes(item.id)), false);
  assert.equal(buildSendChecklist({ ...project, promptDraft }, options).find((item) => item.id === 'prompt-source')?.status, 'ok');
  assert.equal(buildSendChecklist({ ...project, promptDraft }, { includeOriginalUnderstanding: true }).find((item) => item.id === 'prompt-source')?.status, 'block');
});

test('removing wardrobe or pose sources invalidates the previous regional prompt', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const [{ PromptBuilder }, { buildSendChecklist }] = await Promise.all([
    vite.ssrLoadModule('/src/renderer/prompt/PromptBuilder.ts'),
    vite.ssrLoadModule('/src/renderer/utils/validation.ts')
  ]);

  const project = {
    ...createProject([clothingReference()]),
    referenceImages: [faceReference()],
    selectedWebPose: selectedPose(),
    sliders: { identity: 10, realism: 10, outsideProtection: 10, styleStrength: 0 },
    sendMode: 'guided'
  };
  const promptDraft = PromptBuilder.build(project);

  assert.equal(
    buildSendChecklist({ ...project, wardrobeReferences: [], promptDraft })
      .find((item) => item.id === 'wardrobe-prompt')?.status,
    'block'
  );
  assert.equal(
    buildSendChecklist({ ...project, selectedWebPose: undefined, promptDraft })
      .find((item) => item.id === 'web-pose-prompt')?.status,
    'block'
  );
});

test('regional prompt freshness follows only the source fields used by its active branch', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const [{ PromptBuilder }, { buildSendChecklist }] = await Promise.all([
    vite.ssrLoadModule('/src/renderer/prompt/PromptBuilder.ts'),
    vite.ssrLoadModule('/src/renderer/utils/validation.ts')
  ]);
  const secondaryFace = { ...faceReference(), id: 'face-secondary', name: '辅助参考图.png', isPrimary: false };
  const base = {
    ...createProject(),
    referenceImages: [faceReference(), secondaryFace],
    sliders: { identity: 10, realism: 10, outsideProtection: 10, styleStrength: 0 },
    sendMode: 'guided'
  };
  const baseDraft = PromptBuilder.build(base);
  const primaryChanged = {
    ...base,
    referenceImages: base.referenceImages.map((item) => ({ ...item, isPrimary: item.id === 'face-secondary' })),
    promptDraft: baseDraft
  };

  assert.equal(
    buildSendChecklist({ ...base, sceneDescription: '新的场景描述', promptDraft: baseDraft })
      .find((item) => item.id === 'prompt-source')?.status,
    'block'
  );
  assert.equal(buildSendChecklist(primaryChanged).find((item) => item.id === 'prompt-source')?.status, 'block');

  const wardrobeProject = { ...base, wardrobeReferences: [clothingReference()] };
  const wardrobeDraft = PromptBuilder.build(wardrobeProject);
  assert.equal(
    buildSendChecklist({ ...wardrobeProject, sceneDescription: '穿搭分支不使用的新场景', promptDraft: wardrobeDraft })
      .find((item) => item.id === 'prompt-source')?.status,
    'ok'
  );
  assert.equal(
    buildSendChecklist({ ...wardrobeProject, lightingMakeupDescription: '新的光影描述', promptDraft: wardrobeDraft })
      .find((item) => item.id === 'prompt-source')?.status,
    'block'
  );

  const customProject = {
    ...base,
    outputMode: 'custom',
    sceneDescription: '自定义模式允许继续修改来源字段',
    promptDraft: { ...baseDraft, outputMode: 'custom', promptText: '用户确认的自定义提示词' }
  };
  assert.equal(buildSendChecklist(customProject).some((item) => item.id === 'prompt-source'), false);
});

test('one-click prompt only inherits lighting, makeup and image quality when a wardrobe reference exists', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const { PromptBuilder } = await vite.ssrLoadModule('/src/renderer/prompt/PromptBuilder.ts');

  const originalPrompt = PromptBuilder.build(createProject()).promptText;
  assert.match(originalPrompt, /场景唯一标记/);
  assert.match(originalPrompt, /姿态唯一标记/);
  assert.match(originalPrompt, /面部唯一标记/);
  assert.match(originalPrompt, /光影唯一标记/);

  const wardrobePrompt = PromptBuilder.build(
    createProject([
      {
        id: 'wardrobe-1',
        name: '新穿搭.png',
        type: 'image/png',
        size: 1,
        dataUrl: 'data:image/png;base64,AA==',
        kind: 'clothing',
        target: '整套穿搭',
        tags: ['完整复刻'],
        note: ''
      }
    ])
  ).promptText;

  assert.doesNotMatch(wardrobePrompt, /场景唯一标记/);
  assert.doesNotMatch(wardrobePrompt, /姿态唯一标记/);
  assert.doesNotMatch(wardrobePrompt, /面部唯一标记/);
  assert.match(wardrobePrompt, /光影唯一标记/);
});

test('face references own identity and primary-reference hairstyle without conflicting original-hair locks', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const [{ PromptBuilder }, { buildOperationGuide }, { buildRevisionPrompt }] = await Promise.all([
    vite.ssrLoadModule('/src/renderer/prompt/PromptBuilder.ts'),
    vite.ssrLoadModule('/src/renderer/prompt/operationGuideBuilder.ts'),
    vite.ssrLoadModule('/src/renderer/prompt/revisionTemplates.ts')
  ]);

  const references = [
    {
      id: 'face-primary',
      name: '主参考图.png',
      type: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,AA==',
      isPrimary: true,
      note: ''
    },
    {
      id: 'face-secondary',
      name: '辅助参考图.png',
      type: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,AA==',
      isPrimary: false,
      note: ''
    }
  ];
  const wardrobeReferences = [
    {
      id: 'wardrobe-1',
      name: '新穿搭.png',
      type: 'image/png',
      size: 1,
      dataUrl: 'data:image/png;base64,AA==',
      kind: 'clothing',
      target: '整套穿搭',
      tags: ['完整复刻'],
      note: ''
    }
  ];
  const project = { ...createProject(wardrobeReferences), referenceImages: references };
  const result = PromptBuilder.build(project);
  const sendInstruction = PromptBuilder.sendInstruction(project);
  const operationGuide = buildOperationGuide(project);
  const revisionPrompt = buildRevisionPrompt(['红圈外内容被改动', '发型不像主参考图'], true);

  assert.match(
    result.promptText,
    /人脸参考图是目标人物身份的唯一来源；综合全部人脸参考图判断目标男生/
  );
  assert.match(result.promptText, /“主参考图\.png”是发型唯一基准/);
  assert.match(result.promptText, /只允许编辑目标人脸、匹配主参考图所需的头发区域、穿搭参考图明确指定的服饰配饰区域/);
  assert.doesNotMatch(result.promptText, /人脸参考图只负责身份|人脸参考图只负责身份与五官|头发保持不变|手势、头发、构图|头发边缘[^。]*不要新增/);
  assert.ok(result.checklist.includes('人脸参考图唯一负责目标人物身份，主参考图唯一决定发型'));
  assert.ok(result.checklist.includes('指定穿搭按对应参考图替换，未指定穿搭保持主垫图原样'));
  assert.doesNotMatch(result.checklist.join('\n'), /红圈是唯一允许编辑区域|红圈外所有内容完全不变/);
  assert.doesNotMatch(result.negativePrompt, /不要改变红圈外头发|不要修改红圈外任何内容/);
  assert.match(sendInstruction, /附件职责和条件分支已经写入提示词/);
  assert.match(operationGuide, /人脸参考图是目标人物身份的唯一来源/);
  assert.match(revisionPrompt, /发型以主参考图为准/);
  assert.doesNotMatch(
    revisionPrompt,
    /恢复红圈外所有头发|不要改变发型轮廓|背景、头发、身体比例|红圈内可编辑，红圈外完全不变/
  );
  assert.doesNotMatch(
    `${sendInstruction}\n${operationGuide}`,
    /人脸参考图只负责身份|头发保持不变|手势、头发、构图|背景、头发、身体[^。]*保持不变/
  );
});

test('red circle stays required while face occlusion is optional and raw original stays local', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const [{ PromptBuilder }, { buildOperationGuide }, { buildSendChecklist }] = await Promise.all([
    vite.ssrLoadModule('/src/renderer/prompt/PromptBuilder.ts'),
    vite.ssrLoadModule('/src/renderer/prompt/operationGuideBuilder.ts'),
    vite.ssrLoadModule('/src/renderer/utils/validation.ts')
  ]);

  const faceReference = {
    id: 'face-1',
    name: '人脸参考.png',
    type: 'image/png',
    size: 1,
    dataUrl: 'data:image/png;base64,AA==',
    isPrimary: true
  };
  const project = {
    ...createProject(),
    mainImage: { ...faceReference, name: '原图.png', width: 100, height: 100 },
    maskCircle: { x: 50, y: 50, width: 40, height: 40 },
    faceOcclusionEnabled: false,
    faceOcclusionMask: undefined,
    referenceImages: [faceReference],
    sliders: { identity: 10, realism: 10, outsideProtection: 10, styleStrength: 0 },
    promptDraft: {
      id: 'prompt-1',
      title: '测试提示词',
      promptText: '只修改红圈内人脸。',
      negativePrompt: '',
      checklist: [],
      outputMode: 'regional',
      wordCount: 10,
      createdAt: '2026-08-14T00:00:00.000Z'
    },
    sendMode: 'guided'
  };

  assert.deepEqual(
    buildSendChecklist(project).find((item) => item.id === 'occlusion'),
    {
      id: 'occlusion',
      label: '一键蒙脸（可选）',
      level: 'recommended',
      status: 'warn'
    }
  );
  const readyProject = {
    ...project,
    faceOcclusionEnabled: true,
    faceOcclusionMask: {
      points: [{ x: 45, y: 45 }, { x: 55, y: 45 }, { x: 50, y: 55 }],
      raster: { dataUrl: 'data:image/png;base64,AA==', x: 40, y: 40, width: 20, height: 20 }
    }
  };
  assert.equal(buildSendChecklist(readyProject).find((item) => item.id === 'occlusion')?.status, 'ok');

  const promptText = PromptBuilder.build(project).promptText;
  const sendInstruction = PromptBuilder.sendInstruction(project);
  const unmaskedOperationGuide = buildOperationGuide(project);
  const maskedOperationGuide = buildOperationGuide(readyProject);
  assert.match(promptText, /红圈主垫图/);
  assert.doesNotMatch(promptText, /红圈蒙脸主垫图/);
  assert.match(sendInstruction, /红圈主垫图/);
  assert.match(unmaskedOperationGuide, /01_红圈主垫图/);
  assert.doesNotMatch(unmaskedOperationGuide, /01_红圈蒙脸主垫图/);
  assert.match(maskedOperationGuide, /01_红圈蒙脸主垫图/);
  assert.doesNotMatch(sendInstruction, /无标记原图|01_原图/);
  assert.doesNotMatch(unmaskedOperationGuide, /无标记原图|01_原图/);
  assert.doesNotMatch(maskedOperationGuide, /无标记原图|01_原图/);
});
