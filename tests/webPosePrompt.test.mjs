import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function suggestions() {
  return Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    title: `姿势 ${index + 1}`,
    description: `身体微微转向镜头 ${index + 1}，肩颈自然放松，双手保持在当前画幅可见范围内。`
  }));
}

function projectWithPose(selectedWebPose) {
  return {
    softwareVersion: '1.1.1',
    projectName: '网感姿势测试',
    mainImage: {
      id: 'main-1',
      name: '原图.png',
      type: 'image/png',
      size: 1,
      width: 1080,
      height: 1440,
      dataUrl: 'data:image/png;base64,AA=='
    },
    maskCircle: { x: 50, y: 50, width: 30, height: 30 },
    faceOcclusionEnabled: true,
    faceOcclusionMask: {
      points: Array.from({ length: 12 }, (_, index) => ({ x: 40 + index, y: 40 + index })),
      raster: { dataUrl: 'data:image/png;base64,AA==', x: 40, y: 40, width: 20, height: 20 }
    },
    referenceImages: [
      {
        id: 'face-primary',
        name: '主参考图.png',
        type: 'image/png',
        size: 1,
        dataUrl: 'data:image/png;base64,AA==',
        tags: ['主参考图'],
        note: '',
        isPrimary: true
      }
    ],
    wardrobeReferences: [],
    webPoseSuggestions: suggestions(),
    selectedWebPose,
    sceneDescription: '原图场景唯一标记：室内落地窗前。',
    poseDescription: '原图姿态唯一标记：人物双手抱臂站立。',
    faceDirectionDescription: '面部朝向镜头。',
    lightingMakeupDescription: '柔和侧光，自然肤质。',
    lockedElements: ['不改变身体姿势', '不改变手部'],
    customLockedElements: [],
    sliders: {
      identitySimilarity: 8,
      blendNaturalness: 9,
      originalPreservation: 10,
      skinRealism: 9,
      makeupRestoration: 8,
      outsideProtection: 10
    },
    consentConfirmed: true,
    outputMode: 'regional',
    language: 'zh',
    sendMode: 'standard-upload',
    promptHistory: [],
    sendHistory: [],
    resultArchive: []
  };
}

test('web pose response rules allow the fixed JSON keys and require Chinese values', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const instruction = source.match(/async function analyzeWebPosesWithChatGpt[\s\S]*?const automationUrl/)[0];

  assert.match(instruction, /除固定 JSON 键名 poses、id、title、description 外，所有内容必须使用中文/);
  assert.doesNotMatch(instruction, /不要英文。poses 必须/);
});

test('web pose analysis accepts exactly eight ordered JSON suggestions', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const { parseWebPoseSuggestions } = await vite.ssrLoadModule('/src/shared/webPosePolicy.ts');
  const source = `\`\`\`json\n${JSON.stringify({ poses: suggestions() })}\n\`\`\``;

  assert.deepEqual(parseWebPoseSuggestions(source), suggestions());
  assert.equal(parseWebPoseSuggestions(JSON.stringify({ poses: suggestions().slice(0, 7) })), null);
  assert.equal(
    parseWebPoseSuggestions(JSON.stringify({ poses: suggestions().map((item) => ({ ...item, id: 1 })) })),
    null
  );
});

test('selected web pose replaces original pose guidance without weakening unrelated protection', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const [{ PromptBuilder }, { webPoseSelectionSignature }] = await Promise.all([
    vite.ssrLoadModule('/src/renderer/prompt/PromptBuilder.ts'),
    vite.ssrLoadModule('/src/shared/webPosePolicy.ts')
  ]);
  const selected = suggestions()[3];
  const result = PromptBuilder.build(projectWithPose(selected));

  assert.match(result.promptText, /【姿势规则】/);
  assert.match(result.promptText, /网感姿势 4：姿势 4/);
  assert.match(result.promptText, new RegExp(selected.description));
  assert.match(result.promptText, /身体、肩颈、手臂、手部以及必要衣物褶皱/);
  assert.doesNotMatch(result.promptText, /原图姿态唯一标记|人物姿态按原图延续|不改变身体姿势|不改变手部/);
  assert.match(result.promptText, /背景、其他人物、未指定服饰配饰、道具、构图、镜头、画幅、环境光、画质和最终像素尺寸保持主垫图不变/);
  assert.equal(result.webPoseSignature, webPoseSelectionSignature(selected));
  assert.ok(result.checklist.includes('已选择网感姿势替代原图姿态'));
});

test('changing the selected web pose invalidates the previous generated prompt', async (context) => {
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
  const firstPose = suggestions()[0];
  const firstProject = projectWithPose(firstPose);
  const promptDraft = PromptBuilder.build(firstProject);
  const readyProject = { ...firstProject, promptDraft };

  assert.equal(buildSendChecklist(readyProject).find((item) => item.id === 'web-pose-prompt')?.status, 'ok');

  const changedProject = { ...readyProject, selectedWebPose: suggestions()[1] };
  assert.equal(buildSendChecklist(changedProject).find((item) => item.id === 'web-pose-prompt')?.status, 'block');
});
