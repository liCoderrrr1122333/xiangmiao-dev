import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
  createPromptSendSnapshot,
  normalizeOutputMode,
  normalizeStoredOutputMode,
  updatePromptDraftText
} from '../dist-electron/shared/promptPolicy.js';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const draft = {
  id: 'draft-1',
  title: '草稿',
  promptText: '初始正文',
  negativePrompt: '',
  checklist: ['保持尺寸'],
  outputMode: 'regional',
  wordCount: 4,
  createdAt: '2026-01-01T00:00:00.000Z'
};

test('legacy project modes migrate to regional while historical labels remain readable', () => {
  assert.equal(normalizeOutputMode('compact'), 'regional');
  assert.equal(normalizeOutputMode('standard'), 'regional');
  assert.equal(normalizeOutputMode('strict'), 'regional');
  assert.equal(normalizeOutputMode('custom'), 'custom');
  assert.equal(normalizeStoredOutputMode('compact'), 'compact');
});

test('editing a draft does not mutate its original value and send snapshot is immutable', () => {
  const edited = updatePromptDraftText(draft, '用户最终修改的正文');
  const snapshot = createPromptSendSnapshot(edited, 'send-1', '2026-02-01T00:00:00.000Z');
  assert.equal(draft.promptText, '初始正文');
  assert.equal(edited.promptText, '用户最终修改的正文');
  assert.equal(snapshot.promptText, '用户最终修改的正文');
  assert.equal(snapshot.usedForSend, true);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('renderer uses prompt draft and commits a click-time snapshot before automation', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/renderer/components/PromptOutputPanel.tsx', import.meta.url), 'utf8');
  const validation = await readFile(new URL('../src/renderer/utils/validation.ts', import.meta.url), 'utf8');
  assert.match(app, /const activePrompt = project\.promptDraft/);
  assert.match(app, /const promptSnapshot = createPromptSendSnapshot\(activePrompt, nanoid\(\)\)/);
  assert.match(app, /promptHistory: \[promptSnapshot, \.\.\.project\.promptHistory\]/);
  assert.match(app, /project: projectAtSend, prompt: promptSnapshot/);
  assert.match(panel, /setAdjustmentText\(prompt\.promptText\)/);
  assert.match(panel, /updatePromptDraftText\(/);
  assert.match(panel, /outputMode: 'custom'/);
  assert.match(panel, /createPortal\(/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /readOnly/);
  assert.doesNotMatch(panel, /selectMode\(|const modes:/);
  assert.match(validation, /const draft = project\.promptDraft/);
  assert.doesNotMatch(validation, /project\.promptHistory\[0\]/);
});

test('one-click regeneration leaves custom editing mode and the obsolete advanced row is removed', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/renderer/components/PromptOutputPanel.tsx', import.meta.url), 'utf8');

  assert.match(app, /updateProject\(\{ outputMode: 'regional' \}\);\s*const prompt = PromptBuilder\.build\(project, 'regional', promptBuildOptions\);/);
  assert.doesNotMatch(panel, /生成与导出选项|prompt-advanced-controls/);
});

test('replacing the main image clears analysis and prompt state derived from the previous image', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const { createEmptyProject, useProjectStore } = await vite.ssrLoadModule('/src/renderer/state/projectStore.ts');
  const oldImage = {
    id: 'old-image',
    name: '旧主图.png',
    type: 'image/png',
    size: 1,
    dataUrl: 'data:image/png;base64,AA==',
    width: 100,
    height: 100
  };
  const oldPrompt = {
    ...draft,
    promptText: '旧主图的提示词',
    wardrobeSignature: '[]',
    webPoseSignature: ''
  };
  const faceReference = { ...oldImage, id: 'face-reference', isPrimary: true, note: '' };
  const wardrobeReference = {
    ...oldImage,
    id: 'wardrobe-reference',
    kind: 'clothing',
    target: '整套穿搭',
    tags: [],
    note: ''
  };
  const sentSnapshot = { ...oldPrompt, id: 'sent-prompt', usedForSend: true };
  const sendRecord = {
    id: 'send-record',
    sentAt: '2026-08-14T00:00:00.000Z',
    projectName: '旧项目',
    mainImageName: oldImage.name,
    circleImageName: '01_红圈蒙脸主垫图.png',
    referenceCount: 1,
    wardrobeReferenceCount: 1,
    outputMode: 'regional',
    wordCount: 8,
    copied: true,
    chatGptOpened: true,
    exportFolderOpened: false
  };
  useProjectStore.getState().setProject({
    ...createEmptyProject(),
    mainImage: oldImage,
    maskCircle: { x: 50, y: 50, width: 40, height: 40 },
    faceOcclusionEnabled: true,
    faceOcclusionMask: {
      points: Array.from({ length: 12 }, (_, index) => ({ x: 40 + index, y: 40 + index })),
      raster: { dataUrl: oldImage.dataUrl, x: 40, y: 40, width: 20, height: 20 }
    },
    referenceImages: [faceReference],
    wardrobeReferences: [wardrobeReference],
    webPoseSuggestions: [{ id: 1, title: '旧姿势', description: '旧图姿势建议' }],
    selectedWebPose: { id: 1, title: '旧姿势', description: '旧图姿势建议' },
    sceneDescription: '旧主图场景',
    poseDescription: '旧主图姿态',
    faceDirectionDescription: '旧主图朝向',
    lightingMakeupDescription: '旧主图光影',
    customLockedElements: ['旧主图窗帘不变'],
    promptDraft: oldPrompt,
    promptHistory: [sentSnapshot],
    sendHistory: [sendRecord],
    resultArchive: [{ id: 'result', createdAt: '2026-08-14T00:00:00.000Z', image: oldImage }]
  });

  useProjectStore.getState().setMainImage({ ...oldImage, id: 'new-image', name: '新主图.png' });
  const project = useProjectStore.getState().project;

  assert.equal(project.sceneDescription, '');
  assert.equal(project.poseDescription, '');
  assert.equal(project.faceDirectionDescription, '');
  assert.equal(project.lightingMakeupDescription, '');
  assert.deepEqual(project.customLockedElements, []);
  assert.equal(project.promptDraft, undefined);
  assert.equal(project.maskCircle, undefined);
  assert.equal(project.faceOcclusionEnabled, false);
  assert.equal(project.faceOcclusionMask, undefined);
  assert.deepEqual(project.webPoseSuggestions, []);
  assert.equal(project.selectedWebPose, undefined);
  assert.deepEqual(project.referenceImages, [faceReference]);
  assert.deepEqual(project.wardrobeReferences, [wardrobeReference]);
  assert.deepEqual(project.promptHistory, [sentSnapshot]);
  assert.deepEqual(project.sendHistory, [sendRecord]);
  assert.equal(project.resultArchive.length, 1);
});

test('project restore preserves prompt history without reviving a sent snapshot as the current draft', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const { createEmptyProject, normalizeProjectState } = await vite.ssrLoadModule('/src/renderer/state/projectStore.ts');
  const sentSnapshot = {
    ...draft,
    id: 'sent-snapshot',
    promptText: '只应保留在历史里的已发送提示词',
    usedForSend: true
  };

  const restored = normalizeProjectState(
    JSON.parse(JSON.stringify({ ...createEmptyProject(), promptDraft: undefined, promptHistory: [sentSnapshot] }))
  );

  assert.equal(restored.promptDraft, undefined);
  assert.equal(restored.promptHistory[0]?.id, 'sent-snapshot');
  assert.equal(restored.promptHistory[0]?.usedForSend, true);

  const legacy = normalizeProjectState({
    ...createEmptyProject(),
    promptHistory: [{ ...sentSnapshot, id: 'legacy-draft', usedForSend: undefined }]
  });
  assert.equal(legacy.promptDraft?.id, 'legacy-draft');

  const explicitSentDraft = normalizeProjectState({
    ...createEmptyProject(),
    promptDraft: sentSnapshot,
    promptHistory: []
  });
  assert.equal(explicitSentDraft.promptDraft, undefined);

  const contaminatedDraft = normalizeProjectState({
    ...createEmptyProject(),
    promptDraft: { ...sentSnapshot, usedForSend: false },
    promptHistory: [sentSnapshot]
  });
  assert.equal(contaminatedDraft.promptDraft, undefined);
});

test('late analysis results cannot write into a project whose main image has changed', async (context) => {
  const vite = await createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true }
  });
  context.after(() => vite.close());
  const { createEmptyProject, useProjectStore } = await vite.ssrLoadModule('/src/renderer/state/projectStore.ts');
  const oldImage = {
    id: 'old-image',
    name: '旧主图.png',
    type: 'image/png',
    size: 1,
    dataUrl: 'data:image/png;base64,AA==',
    width: 100,
    height: 100
  };
  const newImage = { ...oldImage, id: 'new-image', name: '新主图.png' };
  useProjectStore.getState().setProject({ ...createEmptyProject(), mainImage: oldImage });

  useProjectStore.getState().setMainImage(newImage);
  const staleAccepted = useProjectStore.getState().updateProjectForMainImage('old-image', {
    sceneDescription: '旧图迟到的分析',
    webPoseSuggestions: [{ id: 1, title: '旧图姿势', description: '不应写回' }]
  });

  assert.equal(staleAccepted, false);
  assert.equal(useProjectStore.getState().project.sceneDescription, '');
  assert.deepEqual(useProjectStore.getState().project.webPoseSuggestions, []);

  const currentAccepted = useProjectStore.getState().updateProjectForMainImage('new-image', {
    sceneDescription: '新图当前分析'
  });
  assert.equal(currentAccepted, true);
  assert.equal(useProjectStore.getState().project.sceneDescription, '新图当前分析');
});

test('autosave is hydration-gated, backed up, and replaced through a temporary file', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(app, /projectHydration !== 'ready'/);
  assert.match(app, /if \(!settings\.autoSave \|\| projectHydration !== 'ready'\) return/);
  assert.match(main, /const autosaveBackupPath = \(\) => autosavePath\(\)\.replace/);
  assert.match(main, /autosave\.masklock\.json/);
  assert.match(main, /async function replaceFileAtomically/);
  assert.match(main, /autosave\.xiangmao\.corrupt-/);
  assert.match(main, /status: 'recovered-backup'/);
});
