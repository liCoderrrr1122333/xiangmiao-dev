import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  ImageAsset,
  OutputMode,
  ProjectState,
  ReferenceImage,
  ResultArchiveItem,
  SendHistoryRecord,
  WardrobeReference,
  WardrobeReferenceKind
} from '../../shared/types';
import { defaultLockedElements } from '../prompt/templates';
import { normalizeOutputMode, normalizeStoredOutputMode, updatePromptDraftText } from '../../shared/promptPolicy';
import { normalizeWebPoseSuggestion, normalizeWebPoseSuggestions } from '../../shared/webPosePolicy';

function normalizeFaceOcclusionMask(mask: ProjectState['faceOcclusionMask']) {
  if (!mask || !Array.isArray(mask.points) || !mask.raster) return undefined;
  const points = mask.points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  const raster = mask.raster;
  const validRaster =
    typeof raster.dataUrl === 'string' &&
    raster.dataUrl.startsWith('data:image/png;base64,') &&
    Number.isFinite(raster.x) &&
    Number.isFinite(raster.y) &&
    Number.isFinite(raster.width) &&
    Number.isFinite(raster.height) &&
    raster.width > 0 &&
    raster.height > 0;
  return points.length >= 12 && validRaster ? { points, raster } : undefined;
}

export function createEmptyProject(): ProjectState {
  return {
    softwareVersion: '1.2.4',
    projectName: '未命名项目',
    faceOcclusionEnabled: false,
    referenceImages: [],
    wardrobeReferences: [],
    webPoseSuggestions: [],
    sceneDescription: '',
    poseDescription: '',
    faceDirectionDescription: '',
    lightingMakeupDescription: '',
    lockedElements: defaultLockedElements,
    customLockedElements: [],
    sliders: {
      identitySimilarity: 8,
      blendNaturalness: 9,
      originalPreservation: 10,
      skinRealism: 9,
      makeupRestoration: 8,
      outsideProtection: 10
    },
    consentConfirmed: false,
    outputMode: 'regional',
    language: 'zh',
    sendMode: 'standard-upload',
    promptHistory: [],
    sendHistory: [],
    resultArchive: []
  };
}

export function normalizeProjectState(project: ProjectState): ProjectState {
  const empty = createEmptyProject();
  const faceOcclusionMask = normalizeFaceOcclusionMask(project.faceOcclusionMask);
  const promptHistory = Array.isArray(project.promptHistory)
    ? project.promptHistory.map((prompt) => ({ ...prompt, outputMode: normalizeStoredOutputMode(prompt.outputMode) }))
    : [];
  const draftMatchesSentHistory = Boolean(
    project.promptDraft && promptHistory.some((prompt) => prompt.id === project.promptDraft?.id && prompt.usedForSend === true)
  );
  const restoredDraft = project.promptDraft
    ? project.promptDraft.usedForSend !== true && !draftMatchesSentHistory
      ? { ...project.promptDraft, outputMode: normalizeOutputMode(project.promptDraft.outputMode), usedForSend: false }
      : undefined
    : promptHistory[0] && promptHistory[0].usedForSend !== true
      ? { ...promptHistory[0], outputMode: normalizeOutputMode(promptHistory[0].outputMode), usedForSend: false }
      : undefined;
  return {
    ...empty,
    ...project,
    softwareVersion: '1.2.4',
    outputMode: normalizeOutputMode(project.outputMode),
    faceOcclusionEnabled: Boolean(project.maskCircle && faceOcclusionMask && project.faceOcclusionEnabled === true),
    faceOcclusionMask,
    referenceImages: Array.isArray(project.referenceImages) ? project.referenceImages : [],
    wardrobeReferences: Array.isArray(project.wardrobeReferences) ? project.wardrobeReferences : [],
    webPoseSuggestions: normalizeWebPoseSuggestions(project.webPoseSuggestions) || [],
    selectedWebPose: normalizeWebPoseSuggestion(project.selectedWebPose),
    promptDraft: restoredDraft,
    promptHistory,
    sendHistory: Array.isArray(project.sendHistory) ? project.sendHistory : [],
    resultArchive: Array.isArray(project.resultArchive) ? project.resultArchive : [],
    sliders: { ...empty.sliders, ...(project.sliders || {}) }
  };
}

interface ProjectStore {
  project: ProjectState;
  setProject: (project: ProjectState) => void;
  updateProject: (patch: Partial<ProjectState>) => void;
  updateProjectForMainImage: (mainImageId: string, patch: Partial<ProjectState>) => boolean;
  newProject: () => void;
  loadExample: () => void;
  setMainImage: (image: ImageAsset) => void;
  addReferences: (images: ImageAsset[]) => void;
  updateReference: (id: string, patch: Partial<ReferenceImage>) => void;
  removeReference: (id: string) => void;
  addWardrobeReferences: (images: ImageAsset[], kind: WardrobeReferenceKind) => void;
  updateWardrobeReference: (id: string, patch: Partial<WardrobeReference>) => void;
  removeWardrobeReference: (id: string) => void;
  addPrompt: (prompt: ProjectState['promptHistory'][number]) => void;
  setPromptDraft: (prompt?: ProjectState['promptDraft']) => void;
  updatePromptDraftText: (text: string) => void;
  addSendHistory: (record: SendHistoryRecord) => void;
  addResult: (image: ImageAsset) => void;
  setOutputMode: (mode: OutputMode) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: createEmptyProject(),
  setProject: (project) => set({ project: normalizeProjectState(project) }),
  updateProject: (patch) => set((state) => ({ project: { ...state.project, ...patch } })),
  updateProjectForMainImage: (mainImageId, patch) => {
    let accepted = false;
    set((state) => {
      if (state.project.mainImage?.id !== mainImageId) return state;
      accepted = true;
      return { project: { ...state.project, ...patch } };
    });
    return accepted;
  },
  newProject: () => set({ project: createEmptyProject() }),
  loadExample: () =>
    set((state) => ({
      project: {
        ...state.project,
        projectName: '示例项目 - 区域锁定人像',
        sceneDescription: '手机拍摄的真实生活照，室内暖色灯光，背景保持原样。',
        poseDescription: '人物身体微微侧向镜头，肩膀自然放松，手部姿势保持不变。',
        faceDirectionDescription: '脸部略微向右，眼神看向镜头下方，表情自然。',
        lightingMakeupDescription: '保留原图面部光影方向，皮肤质感真实，不要过度磨皮，妆容自然融合。',
        customLockedElements: ['不要改变手机壳', '不要改变窗帘', '不要改变衣服褶皱'],
        consentConfirmed: false
      }
    })),
  setMainImage: (image) =>
    set((state) => ({
      project: {
        ...state.project,
        mainImage: image,
        maskCircle: undefined,
        faceOcclusionEnabled: false,
        faceOcclusionMask: undefined,
        webPoseSuggestions: [],
        selectedWebPose: undefined,
        sceneDescription: '',
        poseDescription: '',
        faceDirectionDescription: '',
        lightingMakeupDescription: '',
        customLockedElements: [],
        promptDraft: undefined
      }
    })),
  addReferences: (images) =>
    set((state) => {
      const existingHasPrimary = state.project.referenceImages.some((item) => item.isPrimary);
      const refs: ReferenceImage[] = images.map((image, index) => ({
        ...image,
        tags: index === 0 && !existingHasPrimary ? ['主参考图'] : [],
        note: '',
        isPrimary: index === 0 && !existingHasPrimary
      }));
      return { project: { ...state.project, referenceImages: [...state.project.referenceImages, ...refs] } };
    }),
  updateReference: (id, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        referenceImages: state.project.referenceImages.map((item) => (item.id === id ? { ...item, ...patch } : item))
      }
    })),
  removeReference: (id) =>
    set((state) => ({
      project: { ...state.project, referenceImages: state.project.referenceImages.filter((item) => item.id !== id) }
    })),
  addWardrobeReferences: (images, kind) =>
    set((state) => {
      const references: WardrobeReference[] = images.map((image) => ({
        ...image,
        kind,
        target: kind === 'clothing' ? '整套穿搭' : '对应配饰位置',
        tags: [],
        note: ''
      }));
      return { project: { ...state.project, wardrobeReferences: [...state.project.wardrobeReferences, ...references] } };
    }),
  updateWardrobeReference: (id, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        wardrobeReferences: state.project.wardrobeReferences.map((item) => (item.id === id ? { ...item, ...patch } : item))
      }
    })),
  removeWardrobeReference: (id) =>
    set((state) => ({
      project: { ...state.project, wardrobeReferences: state.project.wardrobeReferences.filter((item) => item.id !== id) }
    })),
  addPrompt: (prompt) =>
    set((state) => ({ project: { ...state.project, promptHistory: [prompt, ...state.project.promptHistory].slice(0, 50) } })),
  setPromptDraft: (prompt) => set((state) => ({ project: { ...state.project, promptDraft: prompt } })),
  updatePromptDraftText: (text) =>
    set((state) => ({
      project: {
        ...state.project,
        promptDraft: state.project.promptDraft ? updatePromptDraftText(state.project.promptDraft, text) : undefined
      }
    })),
  addSendHistory: (record) =>
    set((state) => ({ project: { ...state.project, sendHistory: [record, ...state.project.sendHistory].slice(0, 100) } })),
  addResult: (image) =>
    set((state) => {
      const existingIndex = state.project.resultArchive.findIndex(
        (item) => item.image.id === image.id || Boolean(image.path && item.image.path === image.path)
      );
      if (existingIndex >= 0) {
        const archive = [...state.project.resultArchive];
        const existing = archive[existingIndex];
        archive[existingIndex] = {
          ...existing,
          image,
          promptId: existing.promptId || state.project.promptHistory[0]?.id,
          sendHistoryId: existing.sendHistoryId || state.project.sendHistory[0]?.id,
          sequence: image.sequence,
          fileName: image.name,
          filePath: image.path,
          promptText: image.promptText || existing.promptText
        };
        return { project: { ...state.project, resultArchive: archive } };
      }
      const result: ResultArchiveItem = {
        id: nanoid(),
        image,
        promptId: state.project.promptHistory[0]?.id,
        sendHistoryId: state.project.sendHistory[0]?.id,
        sequence: image.sequence,
        fileName: image.name,
        filePath: image.path,
        promptText: image.promptText || state.project.promptHistory[0]?.promptText,
        addedAt: image.createdAt || new Date().toISOString(),
        note: '',
        score: {
          identitySimilarity: 7,
          blendNaturalness: 7,
          outsidePreservation: 8,
          lightingConsistency: 7,
          skinRealism: 7,
          aiFeeling: 3
        },
        needsRevision: true,
        success: false
      };
      return { project: { ...state.project, resultArchive: [result, ...state.project.resultArchive] } };
    }),
  setOutputMode: (mode) => set((state) => ({ project: { ...state.project, outputMode: mode } }))
}));
