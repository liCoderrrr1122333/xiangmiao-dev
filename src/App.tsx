import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import {
  Archive,
  Bot,
  Camera,
  Check,
  ExternalLink,
  LoaderCircle,
  Minus,
  PanelRightOpen,
  Pause,
  Plus,
  RefreshCcw,
  ScanFace,
  Send,
  Square,
  Sparkles,
  X
} from 'lucide-react';
import '../tokens.css';
import './styles/globals.css';
import './styles/levitated-workbench.css';
import './styles/hallmark-workbench.css';
import './styles/glass-workbench.css';
import './styles/startup-notice.css';
import { ProjectToolbar } from './renderer/components/ProjectToolbar';
import { MainImageCanvas, type MainCanvasHandle } from './renderer/components/MainImageCanvas';
import { ReferenceImagePanel } from './renderer/components/ReferenceImagePanel';
import { WardrobeReferencePanel } from './renderer/components/WardrobeReferencePanel';
import { DescriptionPanel } from './renderer/components/DescriptionPanel';
import { PromptOutputPanel } from './renderer/components/PromptOutputPanel';
import { ChecklistPanel } from './renderer/components/ChecklistPanel';
import { StatusBar } from './renderer/components/StatusBar';
import { SendHistoryPanel } from './renderer/components/SendHistoryPanel';
import { ResultArchivePanel } from './renderer/components/ResultArchivePanel';
import { RevisionPromptPanel } from './renderer/components/RevisionPromptPanel';
import { SettingsModal } from './renderer/components/SettingsModal';
import { StartupNoticeModal } from './renderer/components/StartupNoticeModal';
import { FloatingResultPreview } from './renderer/components/FloatingResultPreview';
import { CameraRealismBatchModal } from './renderer/components/CameraRealismBatchModal';
import { RelayApiConfigModal } from './renderer/components/RelayApiConfigModal';
import { useProjectStore } from './renderer/state/projectStore';
import { defaultSettings, useSettingsStore } from './renderer/state/settingsStore';
import { PromptBuilder } from './renderer/prompt/PromptBuilder';
import { buildOperationGuide } from './renderer/prompt/operationGuideBuilder';
import { buildGenerationChecklist, buildSendChecklist, firstBlockingItem, hasBlockingItems } from './renderer/utils/validation';
import { renderRedCircleImage } from './renderer/utils/imageUtils';
import { detectFaceNaturalizationMask } from './renderer/utils/faceLandmarkMask';
import { withTimeout } from './shared/asyncTimeout';
import { isNewerAutomationLifecycleSequence, shouldDisableGenerationAction } from './shared/generationSessionPolicy';
import { createPromptSendSnapshot } from './shared/promptPolicy';
import { followCurrentChatGptModel } from './shared/chatGptModelPolicy';
import {
  normalizeRelayImageModel,
  relayImageModelLabel,
  type RelayImageModel
} from './shared/relayImageModels';
import {
  CURRENT_NOTICE_VERSION,
  normalizeAcknowledgedNoticeVersion,
  shouldShowStartupNotice
} from './shared/startupNoticePolicy';
import {
  normalizeWebAiProvider,
  resolveWebAiProviderModel,
  resolveWebAiProviderUrl,
  webAiProviderLabel,
  type WebAiProvider
} from './shared/webAiProviderPolicy';
import {
  generationProviderLabel,
  isWebGenerationProvider,
  normalizeGenerationProvider,
  type GenerationProvider
} from './shared/generationProviderPolicy';
import { normalizeAnalysisProvider } from './shared/analysisProviderPolicy';
import type {
  AppSettings,
  ChatGptAutomationStatus,
  ChatGptBrowserBackend,
  ChatGptLoginStatus,
  ChatGptModelCatalog,
  ChatGptParallelism,
  ChatGptWorkMode,
  CameraRealismFolderItem,
  LegacyPostProcessingRecovery,
  RelayApiStatus,
  ResultArchiveItem
} from './shared/types';

const legacyDefaultVisionModels = new Set(['', 'minicpm-v', 'minicpm-v:latest']);
const chatGptLoginCheckTimeoutMs = 100_000;
const chatGptWindowOpenTimeoutMs = 110_000;

function sendBlockerMessage(blockerId?: string) {
  const messageByBlocker: Record<string, string> = {
    main: '请先上传原图，再开始做图。',
    circle: '请先在原图上圈选需要编辑的人脸区域。',
    refs: '请重新上传至少一张人脸参考图。若选择同名文件，软件现在也会重新读取。',
    prompt: '请先点击“一键生成提示词”。',
    'custom-prompt': '请先在自定义编辑框中填写提示词。',
    'wardrobe-prompt': '衣物配饰素材已变化，请先重新生成提示词。',
    'web-pose-prompt': '网感姿势已变化，请先重新生成提示词。',
    'prompt-source': '提示词素材或原图理解已变化，请先重新生成提示词。'
  };
  return messageByBlocker[blockerId || ''] || '发送前请补齐主图、红圈、参考图和提示词。';
}

function App() {
  const { project, setPromptDraft, addSendHistory, addResult, setProject, updateProject, newProject } = useProjectStore();
  const { settings, setSettings } = useSettingsStore();
  const [canvasHandle, setCanvasHandle] = useState<MainCanvasHandle | null>(null);
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<number | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [automationStatus, setAutomationStatus] = useState<ChatGptAutomationStatus | null>(null);
  const [chatGptLoginStatus, setChatGptLoginStatus] = useState<ChatGptLoginStatus | null>(null);
  const [chatGptModelCatalog, setChatGptModelCatalog] = useState<ChatGptModelCatalog | null>(null);
  const [isRefreshingChatGptModels, setIsRefreshingChatGptModels] = useState(false);
  const [isCheckingChatGptLogin, setIsCheckingChatGptLogin] = useState(false);
  const [isOpeningChatGptWindow, setIsOpeningChatGptWindow] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isApplyingCameraRealism, setIsApplyingCameraRealism] = useState(false);
  const [cameraRealismBatchOpen, setCameraRealismBatchOpen] = useState(false);
  const [cameraRealismBatchCandidates, setCameraRealismBatchCandidates] = useState<Array<ResultArchiveItem | CameraRealismFolderItem>>([]);
  const [cameraRealismProgress, setCameraRealismProgress] = useState({ completed: 0, total: 0 });
  const [cameraRealismSourceMode, setCameraRealismSourceMode] = useState<'archive' | 'folder'>('archive');
  const [cameraRealismFolderSessionId, setCameraRealismFolderSessionId] = useState<string>();
  const [cameraRealismFolderSourceDir, setCameraRealismFolderSourceDir] = useState<string>();
  const [cameraRealismFolderLoading, setCameraRealismFolderLoading] = useState(false);
  const [relayConfigOpen, setRelayConfigOpen] = useState(false);
  const [relayApiStatus, setRelayApiStatus] = useState<RelayApiStatus | null>(null);
  const [cameraRealismItemProgress, setCameraRealismItemProgress] = useState<Record<string, 'pending' | 'processing' | 'success' | 'error'>>({});
  const cameraRealismCancelRef = useRef(false);
  const [isApplyingFaceNaturalization, setIsApplyingFaceNaturalization] = useState(false);
  const [faceNaturalizationBatchOpen, setFaceNaturalizationBatchOpen] = useState(false);
  const [faceNaturalizationBatchCandidates, setFaceNaturalizationBatchCandidates] = useState<ResultArchiveItem[]>([]);
  const [faceNaturalizationProgress, setFaceNaturalizationProgress] = useState({ completed: 0, total: 0 });
  const [isPauseRequested, setIsPauseRequested] = useState(false);
  const [completedGenerationCount, setCompletedGenerationCount] = useState(0);
  const [projectHydration, setProjectHydration] = useState<'loading' | 'ready'>('loading');
  const [startupNoticeState, setStartupNoticeState] = useState<'loading' | 'visible' | 'dismissed'>(() =>
    window.masklock ? 'loading' : 'dismissed'
  );
  const [activeRightTab, setActiveRightTab] = useState<'prompt' | 'history' | 'archive' | 'revision'>('prompt');
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [legacyResultRecovery, setLegacyResultRecovery] = useState<LegacyPostProcessingRecovery>();
  const chatGptLoginRequestRef = useRef<{
    key: string;
    promise: Promise<ChatGptLoginStatus | undefined>;
  } | null>(null);
  const chatGptWindowOpenPromiseRef = useRef<Promise<void> | null>(null);
  const chatGptLoginSequenceRef = useRef(0);
  const webAiModelRefreshSequenceRef = useRef(0);
  const automationLifecycleSequenceRef = useRef(0);
  const startupSettingsRef = useRef<AppSettings | null>(null);
  const startupProviderInitializationStartedRef = useRef(false);

  const activePrompt = project.promptDraft;
  const webAiProvider = normalizeWebAiProvider(settings.webAiProvider);
  const generationProvider = normalizeGenerationProvider(settings.generationProvider, webAiProvider);
  const activeProviderLabel = generationProviderLabel(generationProvider);
  const activeProviderUrl = resolveWebAiProviderUrl(webAiProvider, settings);
  const activeProviderModel = generationProvider === 'relay'
    ? normalizeRelayImageModel(settings.apiModel)
    : resolveWebAiProviderModel(generationProvider, settings);
  const includeOriginalUnderstanding = generationProvider !== 'relay' || settings.relayOriginalUnderstandingEnabled;
  const promptBuildOptions = useMemo(
    () => ({ includeOriginalUnderstanding }),
    [includeOriginalUnderstanding]
  );
  const generationChecklist = useMemo(
    () => buildGenerationChecklist(project, promptBuildOptions),
    [project, promptBuildOptions]
  );
  const sendChecklist = useMemo(() => buildSendChecklist(project, promptBuildOptions), [project, promptBuildOptions]);
  const canGenerate = projectHydration === 'ready' && !hasBlockingItems(generationChecklist);
  const canSend = projectHydration === 'ready' && !hasBlockingItems(sendChecklist);
  const generationBlockingItem = firstBlockingItem(generationChecklist);
  const sendBlockingItem = firstBlockingItem(sendChecklist);
  const currentSendBlockerMessage = projectHydration === 'ready' ? sendBlockerMessage(sendBlockingItem?.id) : '正在恢复上次项目，请稍候。';
  const hasProjectResults = project.resultArchive.length > 0;
  const hasGeneratedResults = hasProjectResults;
  const hasAnalysis = Boolean(
    project.sceneDescription.trim() ||
      project.poseDescription.trim() ||
      project.faceDirectionDescription.trim() ||
      project.lightingMakeupDescription.trim()
  );
  const workflowSteps = [
    {
      id: 'main-image',
      label: '上传原图',
      detail: project.mainImage ? '主图已锁定' : '等待上传主图',
      completed: Boolean(project.mainImage)
    },
    {
      id: 'reference',
      label: '添加参考图',
      detail: project.referenceImages.length ? `已添加 ${project.referenceImages.length} 张参考图` : '等待添加人脸参考图',
      completed: project.referenceImages.length > 0
    },
    {
      id: 'analysis',
      label: '原图理解',
      detail: includeOriginalUnderstanding
        ? hasAnalysis ? '画面描述已写入' : '等待 AI 分析'
        : '未启用，直接依据主垫图',
      completed: !includeOriginalUnderstanding || hasAnalysis
    },
    {
      id: 'prompt',
      label: '生成提示词',
      detail: activePrompt?.promptText.trim() ? '提示词草稿已就绪' : '等待生成提示词',
      completed: Boolean(activePrompt?.promptText.trim())
    },
    {
      id: 'generate',
      label: `${activeProviderLabel} 做图`,
      detail: isGeneratingImage
        ? '正在生成并保存结果'
        : hasProjectResults
            ? '结果已归档'
            : canSend
              ? '可以开始执行'
              : '等待完成前置步骤',
      completed: hasGeneratedResults,
      active: isGeneratingImage || (!hasGeneratedResults && canSend)
    }
  ];
  const generationCount = Math.max(1, Math.min(100, Math.round(settings.chatGptBatchCount || 1)));
  const requestedGenerationCount = settings.chatGptAutomationMode === 'auto-send' ? generationCount : 1;
  const activeBatchTotal = automationStatus?.batchTotal || requestedGenerationCount;
  const activeParallelism = automationStatus?.effectiveParallelism ?? Math.min(requestedGenerationCount, settings.chatGptParallelism || 1);
  const generationButtonText = isGeneratingImage
    ? isPauseRequested
      ? '正在暂停...'
      : activeBatchTotal > 1
        ? `暂停生成 ${completedGenerationCount}/${activeBatchTotal}`
        : '暂停生成'
    : hasGeneratedResults
      ? requestedGenerationCount > 1
        ? `重新生成 ${requestedGenerationCount} 张`
        : '重新生成'
      : requestedGenerationCount > 1
        ? `开始生成 ${requestedGenerationCount} 张`
        : '开始做图';
  const generationButtonHint = isGeneratingImage
    ? isPauseRequested
      ? '当前图片保存后暂停，不再开始下一张'
      : activeBatchTotal > 1
        ? `${activeParallelism} 路任务执行中；再次点击后不再分配新任务`
        : '再次点击可暂停；当前图片仍会等待并保存'
    : !canSend
      ? currentSendBlockerMessage
      : hasGeneratedResults
      ? requestedGenerationCount > 1
        ? '每通道复用对话 · 仅保存本轮新增结果'
        : '重新上传红圈图与参考图 · 保存下一张结果'
      : requestedGenerationCount > 1
        ? '连续上传、生成并按序保存全部结果'
        : '复制提示词 · 导出红圈图 · 导出参考图';

  function updateGenerationCount(nextCount: number) {
    if (isGeneratingImage) return;
    const chatGptBatchCount = Math.max(1, Math.min(100, Math.round(nextCount || 1)));
    const nextSettings = { ...settings, chatGptBatchCount };
    setSettings({ chatGptBatchCount });
    void window.masklock?.writeSettings(nextSettings);
  }

  const flash = useCallback((message: string) => {
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast('');
      toastTimerRef.current = undefined;
    }, 2600);
  }, []);

  function openCameraRealismBatch() {
    if (isApplyingCameraRealism) return;
    setCameraRealismSourceMode('archive');
    setCameraRealismBatchCandidates(project.resultArchive.slice());
    setCameraRealismProgress({ completed: 0, total: 0 });
    setCameraRealismItemProgress({});
    setCameraRealismBatchOpen(true);
  }

  function releaseCameraRealismFolderSession() {
    const sessionId = cameraRealismFolderSessionId;
    setCameraRealismFolderSessionId(undefined);
    setCameraRealismFolderSourceDir(undefined);
    if (sessionId) void window.masklock?.closeCameraRealismFolderSession(sessionId);
  }

  function closeCameraRealismBatch() {
    if (isApplyingCameraRealism) return;
    releaseCameraRealismFolderSession();
    setCameraRealismBatchOpen(false);
    setCameraRealismBatchCandidates([]);
    setCameraRealismProgress({ completed: 0, total: 0 });
    setCameraRealismItemProgress({});
  }

  function selectCameraRealismArchive() {
    if (isApplyingCameraRealism) return;
    releaseCameraRealismFolderSession();
    setCameraRealismSourceMode('archive');
    setCameraRealismBatchCandidates(project.resultArchive.slice());
    setCameraRealismItemProgress({});
  }

  async function chooseCameraRealismFolder() {
    if (isApplyingCameraRealism || cameraRealismFolderLoading) return;
    setCameraRealismFolderLoading(true);
    try {
      const selected = await window.masklock?.chooseCameraRealismFolder();
      if (!selected || selected.canceled) return;
      if (selected.error || !selected.sessionId || !selected.items) {
        throw new Error(selected.error || '没有读取到可处理的图片文件夹。');
      }
      releaseCameraRealismFolderSession();
      setCameraRealismSourceMode('folder');
      setCameraRealismFolderSessionId(selected.sessionId);
      setCameraRealismFolderSourceDir(selected.sourceDir);
      setCameraRealismBatchCandidates(selected.items);
      setCameraRealismItemProgress(Object.fromEntries(selected.items.map((item) => [item.id, 'pending'])));
      if (!selected.items.length) flash('所选文件夹中没有 JPG、JPEG、PNG、WebP 或可解码的 HEIC 图片。');
    } catch (error) {
      flash(error instanceof Error ? error.message : '读取图片文件夹失败。');
    } finally {
      setCameraRealismFolderLoading(false);
    }
  }

  function stopCameraRealismBatch() {
    cameraRealismCancelRef.current = true;
    flash('将在当前图片处理完成后停止。');
  }

  async function applyCameraRealismBatch(selectedIds: string[], strength: number) {
    if (isApplyingCameraRealism) return;
    const selectedIdSet = new Set(selectedIds);
    const selectedResults = cameraRealismBatchCandidates.filter((item) => selectedIdSet.has(item.id));
    if (!selectedResults.length) {
      flash('请至少选择一张结果图。');
      return;
    }
    setIsApplyingCameraRealism(true);
    cameraRealismCancelRef.current = false;
    setCameraRealismProgress({ completed: 0, total: selectedResults.length });
    let succeeded = 0;
    let outputDir = '';
    const failures: string[] = [];
    for (const item of selectedResults) {
      if (cameraRealismCancelRef.current) break;
      setCameraRealismItemProgress((current) => ({ ...current, [item.id]: 'processing' }));
      try {
        if (cameraRealismSourceMode === 'folder') {
          if (!cameraRealismFolderSessionId || !('status' in item)) throw new Error('文件夹处理会话已失效。');
          const result = await window.masklock?.processCameraRealismFolderItem({
            sessionId: cameraRealismFolderSessionId,
            itemId: item.id,
            strength
          });
          if (!result?.ok) throw new Error(result?.error || '没有生成降 AI 感副本。');
          outputDir = result.outputDir || outputDir;
        } else {
          if (!('image' in item)) throw new Error('结果归档条目无效。');
          const result = await window.masklock?.applyCameraRealism({
            projectName: project.projectName,
            image: {
              ...item.image,
              promptText: item.promptText || item.image.promptText
            },
            strength
          });
          if (!result?.ok || !result.image) {
            throw new Error(result?.error || '没有生成相机质感副本。');
          }
          addResult(result.image);
        }
        succeeded += 1;
        setCameraRealismItemProgress((current) => ({ ...current, [item.id]: 'success' }));
      } catch (error) {
        failures.push(error instanceof Error ? error.message : '相机质感处理失败');
        setCameraRealismItemProgress((current) => ({ ...current, [item.id]: 'error' }));
      } finally {
        setCameraRealismProgress((current) => ({ ...current, completed: current.completed + 1 }));
      }
    }
    const stopped = cameraRealismCancelRef.current;
    setIsApplyingCameraRealism(false);
    releaseCameraRealismFolderSession();
    setCameraRealismBatchOpen(false);
    setCameraRealismBatchCandidates([]);
    setCameraRealismProgress({ completed: 0, total: 0 });
    setCameraRealismItemProgress({});
    flash(stopped
      ? `批量处理已停止：完成 ${succeeded} 张，原图均未修改。`
      : failures.length
        ? `批量处理完成：成功 ${succeeded} 张，失败 ${failures.length} 张。首个原因：${failures[0]}`
        : cameraRealismSourceMode === 'folder'
          ? `批量处理完成：已保留原图，生成 ${succeeded} 张到 ${outputDir || '新输出目录'}。`
          : `批量处理完成：已保留原图，并生成 ${succeeded} 张相机质感副本。`);
  }

  function openFaceNaturalizationBatch() {
    if (isApplyingCameraRealism || isApplyingFaceNaturalization) return;
    if (!project.resultArchive.length) {
      flash('请先生成或导入一张结果图。');
      return;
    }
    setFaceNaturalizationBatchCandidates(project.resultArchive.slice());
    setFaceNaturalizationProgress({ completed: 0, total: 0 });
    setFaceNaturalizationBatchOpen(true);
  }

  function closeFaceNaturalizationBatch() {
    if (isApplyingFaceNaturalization) return;
    setFaceNaturalizationBatchOpen(false);
    setFaceNaturalizationBatchCandidates([]);
    setFaceNaturalizationProgress({ completed: 0, total: 0 });
  }

  async function applyFaceNaturalizationBatch(selectedIds: string[]) {
    if (isApplyingCameraRealism || isApplyingFaceNaturalization) return;
    const selectedIdSet = new Set(selectedIds);
    const selectedResults = faceNaturalizationBatchCandidates.filter((item) => selectedIdSet.has(item.id));
    if (!selectedResults.length) {
      flash('请至少选择一张结果图。');
      return;
    }
    setIsApplyingFaceNaturalization(true);
    setFaceNaturalizationProgress({ completed: 0, total: selectedResults.length });
    let succeeded = 0;
    const failures: string[] = [];
    for (const item of selectedResults) {
      try {
        const image = {
          ...item.image,
          promptText: item.promptText || item.image.promptText
        };
        const detected = await detectFaceNaturalizationMask(image);
        const result = await window.masklock?.applyFaceNaturalization({
          projectName: project.projectName,
          image,
          mask: detected.raster
        });
        if (!result?.ok || !result.image) {
          throw new Error(result?.error || '没有生成面部自然化副本。');
        }
        addResult(result.image);
        succeeded += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : '面部自然化处理失败');
      } finally {
        setFaceNaturalizationProgress((current) => ({ ...current, completed: current.completed + 1 }));
      }
    }
    setIsApplyingFaceNaturalization(false);
    setFaceNaturalizationBatchOpen(false);
    setFaceNaturalizationBatchCandidates([]);
    setFaceNaturalizationProgress({ completed: 0, total: 0 });
    flash(failures.length
      ? `面部自然化完成：成功 ${succeeded} 张，失败 ${failures.length} 张。首个原因：${failures[0]}`
      : `面部自然化完成：已保留原图，并生成 ${succeeded} 张面部自然化副本。`);
  }

  async function generatePrompt() {
    if (projectHydration !== 'ready') {
      flash('正在恢复上次项目，请稍候。');
      return;
    }
    if (!canGenerate) {
      flash(sendBlockerMessage(generationBlockingItem?.id));
      return;
    }
    updateProject({ outputMode: 'regional' });
    const prompt = PromptBuilder.build(project, 'regional', promptBuildOptions);
    setPromptDraft(prompt);
    setActiveRightTab('prompt');
    flash('提示词草稿已生成，可以继续微调。');
  }

  function updateGenerationProvider(provider: GenerationProvider) {
    if (isGeneratingImage || provider === generationProvider) return;
    chatGptLoginSequenceRef.current += 1;
    webAiModelRefreshSequenceRef.current += 1;
    const patch: Partial<AppSettings> = { generationProvider: provider };
    if (provider !== 'relay') {
      patch.webAiProvider = provider;
      patch.apiProvider = provider;
    }
    const nextSettings = { ...settings, ...patch };
    setSettings(patch);
    setChatGptLoginStatus(null);
    setChatGptModelCatalog(null);
    setIsCheckingChatGptLogin(false);
    setIsRefreshingChatGptModels(false);
    if (provider === 'relay') {
      void window.masklock?.getRelayApiStatus().then(setRelayApiStatus);
    }
    void window.masklock?.writeSettings(nextSettings);
  }

  function updateRelayOriginalUnderstanding(enabled: boolean) {
    if (isGeneratingImage || settings.relayOriginalUnderstandingEnabled === enabled) return;
    const nextSettings = { ...settings, relayOriginalUnderstandingEnabled: enabled };
    setSettings({ relayOriginalUnderstandingEnabled: enabled });
    void window.masklock?.writeSettings(nextSettings);
    if (project.promptDraft) setPromptDraft(undefined);
    flash(enabled
      ? '已启用原图理解，请重新生成提示词。'
      : '已停用原图理解，将直接依据主垫图重新生成提示词。');
  }

  function updateRelayImageModel(apiModel: RelayImageModel) {
    if (isGeneratingImage || normalizeRelayImageModel(settings.apiModel) === apiModel) return;
    const nextSettings = { ...settings, apiModel };
    setSettings({ apiModel });
    void window.masklock?.writeSettings(nextSettings);
  }

  function updateChatGptModel(model: string) {
    if (isGeneratingImage) return;
    const patch = webAiProvider === 'gemini' ? { geminiModel: model } : { chatGptModel: model };
    const nextSettings = { ...settings, ...patch };
    setSettings(patch);
    void window.masklock?.writeSettings(nextSettings);
  }

  function updateChatGptParallelism(chatGptParallelism: ChatGptParallelism) {
    if (isGeneratingImage) return;
    const nextSettings = { ...settings, chatGptParallelism };
    setSettings({ chatGptParallelism });
    void window.masklock?.writeSettings(nextSettings);
  }

  function updateChatGptWorkMode(chatGptWorkMode: ChatGptWorkMode) {
    if (isGeneratingImage) return;
    const patch = { chatGptWorkMode };
    const nextSettings = { ...settings, ...patch };
    setSettings(patch);
    void window.masklock?.writeSettings(nextSettings);
  }

  async function refreshChatGptModels(
    showToast = true,
    url = activeProviderUrl,
    backend = settings.chatGptBrowserBackend,
    provider = webAiProvider
  ) {
    if (provider === 'chatgpt' && settings.chatGptWorkMode === 'direct') {
      setChatGptModelCatalog({
        ok: true,
        models: [],
        currentModel: '沿用网页当前设置（未探测）',
        refreshedAt: new Date().toISOString(),
        message: '极简直传：沿用 ChatGPT 网页当前模型与思考设置，不执行模型探测。'
      });
      return;
    }
    if (isRefreshingChatGptModels) return;
    const sequence = ++webAiModelRefreshSequenceRef.current;
    setIsRefreshingChatGptModels(true);
    try {
      const result = await withTimeout(
        Promise.resolve(window.masklock?.listWebAiModels({ provider, url, backend })),
        60_000,
        `读取 ${webAiProviderLabel(provider)} 模型超过 60 秒`
      );
      if (sequence !== webAiModelRefreshSequenceRef.current) return;
      if (result) setChatGptModelCatalog(result);
      if (showToast) flash(result?.message || `暂时无法读取 ${webAiProviderLabel(provider)} 模型。`);
    } catch (error) {
      if (sequence !== webAiModelRefreshSequenceRef.current) return;
      const message = error instanceof Error ? error.message : `读取 ${webAiProviderLabel(provider)} 模型失败。`;
      setChatGptModelCatalog({
        ok: false,
        models: [],
        refreshedAt: new Date().toISOString(),
        message,
        error: message
      });
      if (showToast) flash(message);
    } finally {
      if (sequence === webAiModelRefreshSequenceRef.current) setIsRefreshingChatGptModels(false);
    }
  }

  async function copyPrompt(text = activePrompt?.promptText) {
    if (!text) return flash('还没有可复制的提示词。');
    await window.masklock?.copyText(text);
    flash('提示词已复制到剪贴板。');
  }

  async function saveProject() {
    const result = await window.masklock?.saveProject(project);
    if (result && !result.canceled) {
      updateProject({ projectPath: result.filePath });
      flash('项目已保存。');
    }
  }

  async function importProject() {
    try {
      const result = await window.masklock?.importProject();
      if (result && !result.canceled && result.project) {
        setProject({ ...result.project, projectPath: result.filePath });
        flash('项目已导入。');
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : '项目文件无效，无法导入。');
    }
  }

  function requestChatGptLoginStatus(
    url: string,
    backend = settings.chatGptBrowserBackend,
    provider = webAiProvider,
    reconcileProtection = false
  ) {
    const key = `${provider}:${backend}:${reconcileProtection ? 'reconcile' : 'probe'}:${url}`;
    if (chatGptLoginRequestRef.current?.key === key) return chatGptLoginRequestRef.current.promise;
    const previousRequest = chatGptLoginRequestRef.current?.promise;
    const runCheck = () =>
      withTimeout(
        Promise.resolve(
          window.masklock?.checkWebAiLogin({ provider, url, backend, reconcileProtection })
        ),
        chatGptLoginCheckTimeoutMs,
        `${webAiProviderLabel(provider)} 登录检查超过 ${Math.round(chatGptLoginCheckTimeoutMs / 1000)} 秒`
      );
    const request = (previousRequest
      ? previousRequest.catch(() => undefined).then(runCheck)
      : runCheck())
      .catch((error): ChatGptLoginStatus => ({
        ok: false,
        loggedIn: false,
        needsLogin: false,
        usable: false,
        message: `${webAiProviderLabel(provider)} 登录检查超时。请点击“查看窗口”确认页面状态，再重新检查。`,
        error: error instanceof Error ? error.message : String(error)
      }));
    const record = { key, promise: request };
    chatGptLoginRequestRef.current = record;
    void request.finally(() => {
      if (chatGptLoginRequestRef.current === record) chatGptLoginRequestRef.current = null;
    });
    return request;
  }

  async function checkChatGptLogin(
    showToast = false,
    url = activeProviderUrl,
    backend = settings.chatGptBrowserBackend,
    provider = webAiProvider
  ) {
    if (chatGptWindowOpenPromiseRef.current) {
      await chatGptWindowOpenPromiseRef.current;
      return undefined;
    }
    const sequence = ++chatGptLoginSequenceRef.current;
    setIsCheckingChatGptLogin(true);
    const providerLabel = webAiProviderLabel(provider);
    setChatGptLoginStatus((current) =>
      current?.loggedIn
        ? { ...current, message: `${providerLabel} 已登录，正在后台复核会话...` }
        : { ok: false, loggedIn: false, needsLogin: false, message: `正在检查 ${providerLabel} 登录状态...` }
    );
    const progressTimer = window.setTimeout(() => {
      if (sequence !== chatGptLoginSequenceRef.current) return;
      setChatGptLoginStatus((current) =>
        current?.loggedIn
          ? current
          : {
              ok: false,
              loggedIn: false,
              needsLogin: false,
              usable: false,
              backend,
              message: '正在启动或恢复耀创工坊专属 Chrome，请稍候...'
            }
      );
    }, 8_000);
    try {
      const result = await requestChatGptLoginStatus(url, backend, provider, showToast && provider === 'chatgpt');
      if (result && sequence === chatGptLoginSequenceRef.current) {
        if (result.backend && result.backend !== settings.chatGptBrowserBackend) {
          setSettings({ chatGptBrowserBackend: result.backend });
        }
        setChatGptLoginStatus(result);
        if ((result.loggedIn || result.usable) && !result.protectionPaused) {
          void refreshChatGptModels(false, url, result.backend || backend, provider);
        }
        if (provider === 'chatgpt' && result.protectionPaused !== undefined) {
          setAutomationStatus((current) => ({
            ...(current || { step: '' }),
            step: result.protectionPaused ? 'ChatGPT 访问保护，任务已安全暂停' : 'ChatGPT 页面已恢复',
            detail: result.message,
            level: result.protectionPaused ? 'warning' : 'success',
            protectionPaused: result.protectionPaused,
            pacingMode: result.protectionPaused ? 'cooldown' : 'slow',
            cooldownUntil: undefined
          }));
        }
        if (showToast) flash(result.message);
      }
      return result;
    } finally {
      window.clearTimeout(progressTimer);
      if (sequence === chatGptLoginSequenceRef.current) setIsCheckingChatGptLogin(false);
    }
  }

  async function showChatGptWindow(forceRecovery = false) {
    if (chatGptWindowOpenPromiseRef.current) return chatGptWindowOpenPromiseRef.current;
    const operation = (async () => {
      const sequence = ++chatGptLoginSequenceRef.current;
      setIsCheckingChatGptLogin(false);
      setIsOpeningChatGptWindow(true);
      setChatGptLoginStatus({
        ok: false,
        loggedIn: false,
        needsLogin: false,
        usable: false,
        backend: settings.chatGptBrowserBackend,
        message: forceRecovery
          ? '正在重新建立专属 Chrome 自动化通道，请稍候...'
          : `正在修复并打开 ${activeProviderLabel} 专属 Chrome，请稍候...`
      });
      try {
        const action = forceRecovery
          ? window.masklock?.recoverWebAiWindow
          : window.masklock?.showWebAiWindow;
        const result = await withTimeout(
          Promise.resolve(
            action?.({
              provider: webAiProvider,
              url: activeProviderUrl,
              backend: settings.chatGptBrowserBackend
            })
          ),
          chatGptWindowOpenTimeoutMs,
          '打开耀创工坊专属 Chrome 超时'
        );
        if (sequence !== chatGptLoginSequenceRef.current) return;
        if (result?.backend && result.backend !== settings.chatGptBrowserBackend) {
          setSettings({ chatGptBrowserBackend: result.backend });
        }
        const message = result?.message || '专属 Chrome 没有返回打开结果，请再次点击“查看窗口”自动恢复。';
        setChatGptLoginStatus({
          ok: result?.ok === true,
          loggedIn: false,
          needsLogin: false,
          usable: result?.ok === true,
          backend: result?.backend || settings.chatGptBrowserBackend,
          message,
          error: result?.error,
          recoveryAvailable: result?.recoveryAvailable,
          recoveryReason: result?.recoveryReason,
          recoveryAttempts: result?.recoveryAttempts
        });
        flash(message);
      } catch {
        if (sequence !== chatGptLoginSequenceRef.current) return;
        const message = forceRecovery
          ? '恢复专属 Chrome 超时。软件已停止本次操作，请检查网络或浏览器安装后重试。'
          : '打开专属 Chrome 超时。软件已停止本次等待，可点击“恢复窗口”重新建立通道。';
        setChatGptLoginStatus({
          ok: false,
          loggedIn: false,
          needsLogin: false,
          usable: false,
          backend: settings.chatGptBrowserBackend,
          message,
          error: message,
          recoveryAvailable: true,
          recoveryReason: 'window-action-timeout',
          recoveryAttempts: forceRecovery ? 2 : 1
        });
        flash(message);
      } finally {
        setIsOpeningChatGptWindow(false);
      }
    })();
    chatGptWindowOpenPromiseRef.current = operation;
    try {
      await operation;
    } finally {
      if (chatGptWindowOpenPromiseRef.current === operation) chatGptWindowOpenPromiseRef.current = null;
    }
  }

  async function checkChatGptProtectionRecovery() {
    const result = await window.masklock?.checkChatGptProtectionRecovery({
      url: activeProviderUrl,
      backend: settings.chatGptBrowserBackend
    });
    if (!result) return;
    setAutomationStatus((current) => ({
      ...(current || { step: '' }),
      step: result.ok ? 'ChatGPT 页面已恢复' : 'ChatGPT 访问保护，任务已安全暂停',
      detail: result.message,
      level: result.ok ? 'success' : 'warning',
      protectionPaused: Boolean(result.protectionPaused),
      pacingMode: result.ok ? 'slow' : 'cooldown',
      cooldownUntil: undefined
    }));
  }

  async function pauseChatGptBatch() {
    if (!isGeneratingImage || isPauseRequested) return;
    setIsPauseRequested(true);
    const result = await window.masklock?.pauseChatGptBatch();
    if (!result?.ok) {
      setIsPauseRequested(false);
      flash(result?.message || '当前批量任务暂时无法暂停。');
      return;
    }
    flash(result.message);
  }

  async function sendToChatGPT() {
    if (isGeneratingImage) {
      await pauseChatGptBatch();
      return;
    }
    if (!canSend) {
      if (project.outputMode === 'regional' && project.wardrobeReferences.length && !activePrompt?.promptText.includes('【穿搭规则】')) {
        flash('衣物配饰素材已变化，请先重新生成提示词。');
        return;
      }
      flash(currentSendBlockerMessage);
      return;
    }
    if (generationProvider === 'relay') {
      const status = await window.masklock?.getRelayApiStatus();
      if (status) setRelayApiStatus(status);
      if (!status?.configured || !status.protocolReady) {
        setRelayConfigOpen(true);
        flash(status?.message || '请先配置 API。');
        return;
      }
    }
    if (
      !project.mainImage ||
      !project.maskCircle ||
      !activePrompt?.promptText.trim()
    ) return;
    const faceOcclusionApplied = Boolean(
      project.faceOcclusionEnabled && project.faceOcclusionMask?.raster?.dataUrl
    );
    const circleImageName = faceOcclusionApplied
      ? '01_红圈蒙脸主垫图.png'
      : '01_红圈主垫图.png';
    const promptSnapshot = createPromptSendSnapshot(activePrompt, nanoid());
    const projectAtSend = {
      ...project,
      promptDraft: { ...activePrompt, checklist: [...activePrompt.checklist] },
      promptHistory: [promptSnapshot, ...project.promptHistory].slice(0, 50)
    };
    setProject(projectAtSend);
    setIsPauseRequested(false);
    setCompletedGenerationCount(0);
    setIsGeneratingImage(true);
    try {
      const redCircleDataUrl = canvasHandle?.exportRedCircle
        ? await canvasHandle.exportRedCircle()
        : await renderRedCircleImage(
            project.mainImage,
            project.maskCircle,
            faceOcclusionApplied ? project.faceOcclusionMask : undefined
          );
      const operationGuide = buildOperationGuide(projectAtSend, activeProviderLabel);
      await window.masklock?.writeRecentAutoSave(projectAtSend);
      setAutomationStatus(
        settings.chatGptAutomationMode === 'manual'
          ? null
          : { step: `正在准备 ${activeProviderLabel} 后台自动化`, detail: '正在导出素材包并启动后台自动窗口。' }
      );
      const result = await window.masklock?.createSendPackage(
        {
          project: projectAtSend, prompt: promptSnapshot,
          redCircleDataUrl,
          operationGuide,
          generationCount: requestedGenerationCount
        },
        settings
      );
      if (!result?.ok) {
        const message = result?.error || '发送包创建失败。';
        setAutomationStatus({ step: '生成流程失败', detail: message, level: 'error' });
        flash(message);
        return;
      }
      const savedImages = result.chatGptAutomation?.savedImages?.length
        ? result.chatGptAutomation.savedImages
        : result.chatGptAutomation?.savedImage
          ? [result.chatGptAutomation.savedImage]
          : [];
      setCompletedGenerationCount(result.chatGptAutomation?.completedCount || savedImages.length);
      addSendHistory({
        id: nanoid(),
        provider: generationProvider,
        sentAt: new Date().toISOString(),
        projectName: project.projectName,
        mainImageName: project.mainImage.name,
        circleImageName,
        referenceCount: project.referenceImages.length,
        wardrobeReferenceCount: project.wardrobeReferences.length,
        outputMode: promptSnapshot.outputMode,
        wordCount: promptSnapshot.wordCount,
        copied: result.copied,
        chatGptOpened: result.chatGptOpened,
        exportFolderOpened: result.exportFolderOpened,
        exportDir: result.exportDir,
        promptText: result.promptText || promptSnapshot.promptText,
        note: '',
        resultAttached: savedImages.length > 0,
        revisionGenerated: false
      });
      if (savedImages.length) {
        for (const image of savedImages) addResult(image);
        setActiveRightTab('archive');
      }
      if (result.chatGptAutomation?.paused) {
        const requestedCount = result.chatGptAutomation.requestedCount || requestedGenerationCount;
        const completedCount = result.chatGptAutomation.completedCount || savedImages.length;
        flash(`批量任务已暂停，已保存 ${completedCount}/${requestedCount} 张`);
      } else if (savedImages.length) {
        const requestedCount = result.chatGptAutomation?.requestedCount || requestedGenerationCount;
        const completedCount = result.chatGptAutomation?.completedCount || savedImages.length;
        flash(
          result.chatGptAutomation?.ok && completedCount === requestedCount
            ? `已连续生成并保存 ${completedCount} 张图片`
            : `已保存 ${completedCount}/${requestedCount} 张，后续任务已停止`
        );
      } else if (result.chatGptAutomation?.sent) {
        flash(result.chatGptAutomation.error || `已发送，但未保存到生成结果图。请查看 ${activeProviderLabel} 页面状态。`);
      } else if (result.chatGptAutomation?.uploaded) {
        flash(`已自动上传素材并粘贴提示词，等待你在 ${activeProviderLabel} 窗口确认发送。`);
      } else if (result.chatGptAutomation?.ok && result.chatGptAutomation.message) {
        flash(result.chatGptAutomation.message);
      } else if (result.chatGptAutomation && !result.chatGptAutomation.ok) {
        flash(result.chatGptAutomation.error || `${activeProviderLabel} 自动化失败，已保留素材包。`);
      } else {
        flash(`发送素材包已准备好，${activeProviderLabel} 已尝试打开。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成流程失败。';
      setAutomationStatus({ step: '生成流程失败', detail: message, level: 'error' });
      flash(message);
    } finally {
      setIsPauseRequested(false);
      setIsGeneratingImage(false);
    }
  }

  async function exportPrompt(format: 'txt' | 'md') {
    if (!activePrompt?.promptText.trim()) return flash('请先生成或填写提示词。');
    const content =
      format === 'md'
        ? `# ${activePrompt.title}\n\n> 仅编辑提示词明确授权的区域，其他内容保持原图不变。\n\n${activePrompt.promptText}\n\n## Negative Prompt\n\n${activePrompt.negativePrompt}\n`
        : activePrompt.promptText;
    await window.masklock?.exportTextFile({ defaultName: `${project.projectName}_prompt.${format}`, content });
    flash('提示词已导出。');
  }

  async function exportRedCircle() {
    if (!project.mainImage || !project.maskCircle) return flash('请先上传主图并画红圈。');
    const dataUrl = canvasHandle?.exportRedCircle
      ? await canvasHandle.exportRedCircle()
      : await renderRedCircleImage(
          project.mainImage,
          project.maskCircle,
          project.faceOcclusionEnabled ? project.faceOcclusionMask : undefined
        );
    await window.masklock?.exportRedCircleImage({ projectName: project.projectName, dataUrl });
    flash('带红圈主图已导出。');
  }

  async function apiGenerate() {
    if (!activePrompt?.promptText.trim()) return flash('请先生成或填写提示词。');
    if (!settings.apiModeEnabled) return flash('请先在设置中启用 API 直接生成。');
    const result = await window.masklock?.apiGenerate({
      prompt: activePrompt.promptText,
      apiKey: settings.apiKeySessionOnly,
      model: settings.apiModel,
      size: settings.apiSize,
      targetDimensions:
        project.mainImage?.width && project.mainImage?.height
          ? { width: project.mainImage.width, height: project.mainImage.height }
          : undefined
    });
    if (!result?.ok || !result.imageUrl) {
      flash(result?.error || 'API 生成失败。');
      return;
    }
    addResult({
      id: nanoid(),
      name: `api_result_${Date.now()}.jpg`,
      type: 'image/jpeg',
      size: result.size || 0,
      width: result.width,
      height: result.height,
      dataUrl: result.imageUrl
    });
    setActiveRightTab('archive');
    flash('API 结果已生成并加入归档。');
  }

  async function acknowledgeStartupNotice() {
    const bridge = window.masklock;
    if (!bridge) throw new Error('设置服务不可用。');
    const currentSettings = useSettingsStore.getState().settings;
    const nextSettings = {
      ...currentSettings,
      acknowledgedNoticeVersion: CURRENT_NOTICE_VERSION
    };
    const saved = await bridge.writeSettings(nextSettings);
    if (!saved) throw new Error('公告状态未保存。');
    setSettings({ acknowledgedNoticeVersion: CURRENT_NOTICE_VERSION });
    startupSettingsRef.current = nextSettings;
    setStartupNoticeState('dismissed');
  }

  useEffect(() => {
    const bridge = window.masklock;
    if (!bridge) {
      setStartupNoticeState('dismissed');
    } else {
      void bridge.readSettings().then(async (saved) => {
        const nextSettings = { ...defaultSettings, ...saved };
        nextSettings.acknowledgedNoticeVersion = normalizeAcknowledgedNoticeVersion(
          saved.acknowledgedNoticeVersion
        );
        nextSettings.chatGptBrowserBackend = 'chrome';
        nextSettings.webAiProvider = normalizeWebAiProvider(nextSettings.webAiProvider);
        nextSettings.generationProvider = normalizeGenerationProvider(
          nextSettings.generationProvider,
          nextSettings.webAiProvider
        );
        nextSettings.apiProvider = normalizeAnalysisProvider(nextSettings.apiProvider);
        if (nextSettings.apiProvider === 'ollama' && legacyDefaultVisionModels.has(nextSettings.apiVisionModel.trim().toLowerCase())) {
          nextSettings.apiProvider = 'ollama';
          nextSettings.apiBaseUrl = 'http://127.0.0.1:11434';
          nextSettings.apiVisionModel = 'auto';
        }
        setSettings(nextSettings);
        startupSettingsRef.current = nextSettings;
        if (nextSettings.generationProvider === 'relay') {
          void bridge.getRelayApiStatus().then(setRelayApiStatus);
        }
        await bridge.writeSettings(nextSettings).catch(() => false);
        setStartupNoticeState(
          shouldShowStartupNotice(nextSettings.acknowledgedNoticeVersion) ? 'visible' : 'dismissed'
        );
      }).catch(() => {
        const nextSettings = { ...defaultSettings };
        setSettings(nextSettings);
        startupSettingsRef.current = nextSettings;
        setStartupNoticeState('visible');
      });
    }
    void (async () => {
      try {
        const saved = await window.masklock?.readRecentAutoSave();
        if (saved?.project?.projectName) setProject(saved.project);
        if (saved?.status === 'recovered-backup') flash(saved.message || '自动保存已从备份恢复。');
        if (saved?.status === 'corrupt') flash(saved.message || '自动保存损坏，已保留问题文件并建立新项目。');
        const legacyRecovery = await window.masklock?.recoverLegacyPostProcessingResults();
        if (legacyRecovery?.found) {
          for (const image of legacyRecovery.recoveredImages) addResult(image);
          setLegacyResultRecovery(legacyRecovery);
          if (legacyRecovery.message) flash(legacyRecovery.message);
          if (legacyRecovery.recoveredImages.length) setActiveRightTab('archive');
        }
      } catch (error) {
        flash(error instanceof Error ? error.message : '恢复自动保存失败，已使用空项目。');
      } finally {
        setProjectHydration('ready');
      }
    })();
    // Startup hydration is intentionally single-run; live login changes arrive through IPC subscriptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addResult, flash, setProject, setSettings]);

  useEffect(() => {
    const nextSettings = startupSettingsRef.current;
    if (
      startupNoticeState !== 'dismissed' ||
      !nextSettings ||
      startupProviderInitializationStartedRef.current
    ) return;
    startupProviderInitializationStartedRef.current = true;
    if (nextSettings.apiProvider === 'ollama') {
      window.setTimeout(() => {
        window.masklock?.apiWarmVisionModel({
          provider: 'ollama',
          baseUrl: nextSettings.apiBaseUrl,
          model: nextSettings.apiVisionModel
        });
      }, 1800);
    }
    // Startup only warms the selected local analysis route. Web providers initialize on explicit use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupNoticeState]);

  useEffect(() => {
    if (!settings.autoSave || projectHydration !== 'ready') return;
    const id = window.setTimeout(() => window.masklock?.writeRecentAutoSave(project), 600);
    return () => window.clearTimeout(id);
  }, [project, projectHydration, settings.autoSave]);

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: light)');
    const applyTheme = () => {
      document.documentElement.dataset.theme = settings.theme === 'system'
        ? (colorScheme.matches ? 'light' : 'dark')
        : settings.theme;
      document.documentElement.dataset.themePreference = settings.theme;
    };

    applyTheme();
    colorScheme.addEventListener('change', applyTheme);
    document.documentElement.dataset.font = settings.fontSize;
    document.documentElement.dataset.motion = settings.motionMode;

    return () => colorScheme.removeEventListener('change', applyTheme);
  }, [settings.theme, settings.fontSize, settings.motionMode]);

  useEffect(() => {
    return window.masklock?.onChatGptAutomationStatus(setAutomationStatus);
  }, []);

  useEffect(() => {
    return window.masklock?.onChatGptAutomationLifecycle((lifecycle) => {
      if (!isNewerAutomationLifecycleSequence(automationLifecycleSequenceRef.current, lifecycle.sequence)) return;
      automationLifecycleSequenceRef.current = lifecycle.sequence;
      setIsGeneratingImage(lifecycle.running);
      if (!lifecycle.running) {
        setIsPauseRequested(false);
        setAutomationStatus((current) => {
          if (!current || current.level === 'success' || current.level === 'error') return current;
          if (/暂停|未全部完成|已停止/.test(current.step)) return current;
          return null;
        });
      }
    });
  }, []);

  useEffect(() => {
    return window.masklock?.onChatGptBrowserBackendChanged((backend: ChatGptBrowserBackend) => {
      chatGptLoginSequenceRef.current += 1;
      setSettings({ chatGptBrowserBackend: backend });
      setChatGptLoginStatus((current) =>
        current
          ? {
              ...current,
              backend,
              message:
                backend === 'chrome'
                  ? `${activeProviderLabel} 登录已切换到耀创工坊专属 Chrome，请在该窗口完成登录。`
                  : current.message
            }
          : current
      );
    });
  }, [activeProviderLabel, setSettings]);

  useEffect(() => {
    return window.masklock?.onChatGptLoginStatusChanged((status) => {
      const statusProvider = normalizeWebAiProvider(status.provider);
      if (statusProvider !== webAiProvider) return;
      chatGptLoginSequenceRef.current += 1;
      if (status.backend) setSettings({ chatGptBrowserBackend: status.backend });
      setChatGptLoginStatus(status);
    });
  }, [setSettings, webAiProvider]);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current);
    },
    []
  );

  useEffect(() => {
    return window.masklock?.onChatGptAutomationResult(({ image, completedCount, requestedCount, taskIndex, laneId }) => {
      addResult(image);
      setCompletedGenerationCount(completedCount);
      setActiveRightTab('archive');
      setAutomationStatus({
        step: `任务 ${taskIndex || completedCount}/${requestedCount} 已保存`,
        detail: image.dimensionWarning
          ? `${image.path}；${image.dimensionWarning}`
          : `${image.path}${image.dimensionAdjustment ? `；${image.dimensionAdjustment}` : ''}${laneId ? `；通道 ${laneId}` : ''}`,
        level: image.dimensionWarning ? 'warning' : 'success',
        batchIndex: taskIndex || completedCount,
        batchTotal: requestedCount
      });
    });
  }, [addResult]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (startupNoticeState !== 'dismissed') {
        if (mod) event.preventDefault();
        return;
      }
      if (!mod) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newProject();
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveProject();
      }
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        importProject();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        generatePrompt();
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copyPrompt();
      }
      if (event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        sendToChatGPT();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
    <div
      className="app levitated-workbench"
      inert={startupNoticeState !== 'dismissed' ? true : undefined}
      aria-hidden={startupNoticeState !== 'dismissed' ? true : undefined}
    >
      <a className="skip-link" href="#workbench-main">跳到工作区</a>
      <ProjectToolbar
        onNew={newProject}
        onSave={saveProject}
        onImport={importProject}
        onExport={saveProject}
        onSettings={() => setSettingsOpen(true)}
        onHelp={() => flash('README 中已包含完整安全说明和操作流程。')}
        analysisCollapsed={analysisCollapsed}
        inspectorCollapsed={inspectorCollapsed}
        onToggleAnalysis={() => setAnalysisCollapsed((current) => !current)}
        onToggleInspector={() => setInspectorCollapsed((current) => !current)}
      />

      <div className="window-controls" aria-label="窗口控制">
        <button onClick={() => window.masklock?.windowMinimize()} aria-label="最小化">
          <Minus />
        </button>
        <button onClick={() => window.masklock?.windowToggleMaximize()} aria-label="最大化或还原">
          <Square />
        </button>
        <button className="window-close" onClick={() => window.masklock?.windowClose()} aria-label="关闭">
          <X />
        </button>
      </div>

      <main
        id="workbench-main"
        className={`workbench ${analysisCollapsed ? 'is-analysis-collapsed' : ''} ${inspectorCollapsed ? 'is-inspector-collapsed' : ''}`.trim()}
      >
        <section className="left-stack">
          <MainImageCanvas onReady={setCanvasHandle} onExportRedCircle={exportRedCircle} />
          <ReferenceImagePanel />
          <WardrobeReferencePanel />
        </section>

        <section className="center-stack" aria-hidden={analysisCollapsed || undefined}>
          <DescriptionPanel
            generationProvider={generationProvider}
            isGenerating={isGeneratingImage}
            relayStatus={relayApiStatus}
            includeOriginalUnderstanding={includeOriginalUnderstanding}
            onGenerationProviderChange={updateGenerationProvider}
            onOriginalUnderstandingChange={updateRelayOriginalUnderstanding}
            onOpenApiConfig={() => setRelayConfigOpen(true)}
          />
        </section>

        <aside className="right-stack" aria-hidden={inspectorCollapsed || undefined}>
          <div className="panel workflow-action-panel">
            <div className="workflow-action-head">
              <div>
                <h3>{activeProviderLabel} 做图</h3>
                <p>生成提示词并自动完成上传、发送与结果保存。</p>
              </div>
              <span className={isGeneratingImage ? 'badge warn' : canSend ? 'badge ok' : 'badge warn'}>
                {isGeneratingImage ? '生成中' : canSend ? '可开始' : '待准备'}
              </span>
            </div>
            <ol className="workflow-rail" aria-label="展示面制作流程">
              {workflowSteps.map((step, index) => (
                <li
                  key={step.id}
                  className={`${step.completed ? 'is-complete' : ''} ${step.active && !step.completed ? 'is-active' : ''}`.trim()}
                  aria-current={step.active && !step.completed ? 'step' : undefined}
                >
                  <span className="workflow-rail-node" aria-hidden="true">
                    {step.completed ? <Check /> : index + 1}
                  </span>
                  <span className="workflow-rail-copy">
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </span>
                </li>
              ))}
            </ol>
            <div className="workflow-action-buttons">
              <div className="batch-count-control">
                <div className="batch-count-label">
                  <strong>本次生成</strong>
                  <span>连续任务</span>
                </div>
                <div className="batch-count-stepper">
                  <button
                    type="button"
                    onClick={() => updateGenerationCount(generationCount - 1)}
                    disabled={isGeneratingImage || settings.chatGptAutomationMode !== 'auto-send' || generationCount <= 1}
                    aria-label="减少生成张数"
                    title="减少生成张数"
                  >
                    <Minus />
                  </button>
                  <label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={generationCount}
                      disabled={isGeneratingImage || settings.chatGptAutomationMode !== 'auto-send'}
                      onChange={(event) => updateGenerationCount(Number(event.target.value))}
                      aria-label="本次生成张数"
                    />
                    <span>张</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => updateGenerationCount(generationCount + 1)}
                    disabled={isGeneratingImage || settings.chatGptAutomationMode !== 'auto-send' || generationCount >= 100}
                    aria-label="增加生成张数"
                    title="增加生成张数"
                  >
                    <Plus />
                  </button>
                </div>
              </div>
              <div className="chatgpt-runtime-controls">
                {generationProvider === 'chatgpt' && (
                  <div className="chatgpt-work-mode" role="group" aria-label="ChatGPT 图片工作模式">
                    <span>模式</span>
                    <div>
                      {([
                        ['direct', '极简直传', '沿用 ChatGPT 网页当前模型与思考设置，不读取或切换'],
                        ['fast', '快速', '当前模型 / 低思考强度'],
                        ['balanced', '均衡', '当前模型 / 中思考强度'],
                        ['quality', '稳定高质', '当前模型 / 高思考强度']
                      ] as const).map(([mode, label, title]) => (
                        <button
                          key={mode}
                          type="button"
                          className={(settings.chatGptWorkMode || 'quality') === mode ? 'active' : ''}
                          onClick={() => updateChatGptWorkMode(mode)}
                          disabled={isGeneratingImage}
                          aria-pressed={(settings.chatGptWorkMode || 'quality') === mode}
                          title={title}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {generationProvider === 'relay' ? (
                  <div className="relay-provider-summary" role="status">
                    <div><span>服务</span><strong>API</strong></div>
                    <div><span>模型</span><strong>{relayImageModelLabel(relayApiStatus?.config?.model || normalizeRelayImageModel(settings.apiModel))}</strong></div>
                    <div><span>输出</span><strong>自动匹配原图</strong></div>
                  </div>
                ) : generationProvider === 'chatgpt' && settings.chatGptWorkMode === 'direct' ? (
                  <div className="chatgpt-model-control chatgpt-direct-mode-note" role="status">
                    <span>模型</span>
                    <strong>沿用网页当前设置（未探测）</strong>
                  </div>
                ) : (
                <label className="chatgpt-model-control">
                  <span>模型</span>
                  <select
                    value={activeProviderModel || followCurrentChatGptModel}
                    onChange={(event) => updateChatGptModel(event.target.value)}
                    disabled={isGeneratingImage || isRefreshingChatGptModels}
                    aria-label={`${activeProviderLabel} 做图模型`}
                    title={`模型列表来自当前 ${activeProviderLabel} 登录账号`}
                  >
                    <option value={followCurrentChatGptModel}>
                      {chatGptModelCatalog?.currentModel
                        ? `跟随当前 · ${chatGptModelCatalog.currentModel}`
                        : '跟随当前模型'}
                    </option>
                    {chatGptModelCatalog?.models.map((model) => (
                      <option key={model.id} value={model.label}>
                        {model.label}{model.current ? ' · 当前' : ''}
                      </option>
                    ))}
                    {activeProviderModel &&
                      activeProviderModel !== followCurrentChatGptModel &&
                      !chatGptModelCatalog?.models.some((model) => model.label === activeProviderModel) && (
                        <option value={activeProviderModel}>{activeProviderModel} · 待验证</option>
                      )}
                  </select>
                </label>
                )}
                <div className="chatgpt-parallel-control" role="group" aria-label={`${activeProviderLabel} 并行通道数`}>
                  <span>并行通道</span>
                  <div>
                    {([1, 2, 3] as ChatGptParallelism[]).map((parallelism) => (
                      <button
                        key={parallelism}
                        type="button"
                        className={(settings.chatGptParallelism || 1) === parallelism ? 'active' : ''}
                        onClick={() => updateChatGptParallelism(parallelism)}
                        disabled={isGeneratingImage || settings.chatGptAutomationMode !== 'auto-send'}
                        aria-pressed={(settings.chatGptParallelism || 1) === parallelism}
                        title={`${parallelism} 路独立聊天标签页`}
                      >
                        {parallelism} 路
                      </button>
                    ))}
                  </div>
                </div>
                {isWebGenerationProvider(generationProvider) && !(generationProvider === 'chatgpt' && settings.chatGptWorkMode === 'direct') && <button
                  type="button"
                  className="chatgpt-model-refresh"
                  onClick={() => void refreshChatGptModels(true)}
                  disabled={isGeneratingImage || isRefreshingChatGptModels}
                  aria-label="刷新可用模型"
                  title={`从当前 ${activeProviderLabel} 账号重新读取模型`}
                >
                  <RefreshCcw className={isRefreshingChatGptModels ? 'spin' : ''} />
                </button>}
              </div>
              {generationProvider !== 'relay' && chatGptModelCatalog && (
                <div className={`chatgpt-model-status ${chatGptModelCatalog.ok ? 'ok' : 'warn'}`} role="status">
                  {chatGptModelCatalog.message}
                </div>
              )}
              <button
                className={`primary-cta prompt-send-cta ${isGeneratingImage ? 'is-busy' : ''}`}
                disabled={shouldDisableGenerationAction(isGeneratingImage, isPauseRequested)}
                onClick={isGeneratingImage ? pauseChatGptBatch : sendToChatGPT}
                aria-busy={isGeneratingImage}
                aria-label={isGeneratingImage ? '暂停批量生成' : generationButtonText}
                data-ready={canSend ? 'true' : 'false'}
                title={!isGeneratingImage && !canSend ? currentSendBlockerMessage : generationButtonText}
              >
                {isGeneratingImage ? <Pause /> : <Send />}
                <span>
                  {generationButtonText}
                  <small>{generationButtonHint}</small>
                </span>
              </button>
              <button className="workflow-generate-btn" aria-disabled={!canGenerate} data-ready={canGenerate ? 'true' : 'false'} onClick={generatePrompt}>
                <Sparkles />
                一键生成提示词
              </button>
            </div>
            <div className="workflow-step-hint">
              <span>{settings.chatGptAutomationMode === 'auto-send' ? '全自动上传并发送' : settings.chatGptAutomationMode === 'upload-review' ? '自动上传后确认' : '手动发送模式'}</span>
              <span>{generationProvider === 'relay' ? '独立 API 流程' : `${activeProviderLabel} 网页流程`}</span>
            </div>
            {generationProvider !== 'relay' ? <div
              className={`chatgpt-login-strip ${chatGptLoginStatus?.loggedIn || chatGptLoginStatus?.usable ? 'ok' : chatGptLoginStatus?.needsLogin ? 'warn' : ''}`}
              aria-busy={isOpeningChatGptWindow || isCheckingChatGptLogin}
            >
              <span>
                {chatGptLoginStatus?.message || `尚未检查 ${activeProviderLabel} 登录状态`}
                <small className="chatgpt-backend-label">
                  {settings.chatGptBrowserBackend === 'chrome' ? '专属 Chrome' : '内置窗口'}
                </small>
              </span>
              <div className="chatgpt-login-actions">
                <button type="button" onClick={() => void showChatGptWindow(false)} disabled={isOpeningChatGptWindow}>
                  {isOpeningChatGptWindow ? <LoaderCircle className="spin" /> : <ExternalLink />}
                  {isOpeningChatGptWindow ? '打开中' : '查看窗口'}
                </button>
                <button
                  type="button"
                  onClick={() => checkChatGptLogin(true)}
                  disabled={isCheckingChatGptLogin || isOpeningChatGptWindow}
                >
                  {isCheckingChatGptLogin && <LoaderCircle className="spin" />}
                  {isCheckingChatGptLogin ? '检查中' : '检查登录'}
                </button>
                {chatGptLoginStatus?.recoveryAvailable && (
                  <button
                    type="button"
                    className="chatgpt-recovery-button"
                    onClick={() => void showChatGptWindow(true)}
                    disabled={isCheckingChatGptLogin || isOpeningChatGptWindow}
                    title={chatGptLoginStatus.recoveryReason || '重新建立专属 Chrome 自动化通道'}
                  >
                    <RefreshCcw />
                    恢复窗口
                  </button>
                )}
              </div>
            </div> : (
              <div className={`relay-api-strip ${relayApiStatus?.configured ? 'configured' : ''}`} role="status">
                <span>
                  <strong>{relayApiStatus?.configured ? `已配置 · ${relayApiStatus.maskedKey}` : 'API 未配置'}</strong>
                  <small>{relayApiStatus?.message || '填写自己的 API Key 后才能开始任务。'}</small>
                </span>
              </div>
            )}
            {automationStatus && (
              <div className={`automation-status ${automationStatus.level || 'info'}`} role="status" aria-live="polite">
                <strong>{automationStatus.step}</strong>
                {automationStatus.detail && <span>{automationStatus.detail}</span>}
                {automationStatus.protectionPaused && (
                  <button type="button" onClick={() => void checkChatGptProtectionRecovery()}>
                    <RefreshCcw />
                    检查恢复
                  </button>
                )}
                {(automationStatus.batchTotal || automationStatus.elapsedMs || automationStatus.averageDurationMs || automationStatus.pacingMode) && (
                  <div className="automation-runtime-metrics" aria-label="批量运行监控">
                    <span>任务 {automationStatus.batchIndex || automationStatus.completedCount || 0}/{automationStatus.batchTotal || requestedGenerationCount}</span>
                    <span>完成 {automationStatus.completedCount || 0}</span>
                    <span>待执行 {automationStatus.pendingCount ?? Math.max(0, activeBatchTotal - (automationStatus.completedCount || 0) - (automationStatus.failedCount || 0) - (automationStatus.manualReviewCount || 0))}</span>
                    <span>待确认 {automationStatus.manualReviewCount || 0}</span>
                    <span>失败 {automationStatus.failedCount || 0}</span>
                    <span>有效通道 {automationStatus.effectiveParallelism ?? activeParallelism}</span>
                    <span>
                      总耗时 {automationStatus.elapsedMs
                        ? `${Math.floor(automationStatus.elapsedMs / 60_000)}分${Math.round((automationStatus.elapsedMs % 60_000) / 1000)}秒`
                        : '0分0秒'}
                    </span>
                    <span>
                      均耗时 {automationStatus.averageDurationMs
                        ? `${Math.floor(automationStatus.averageDurationMs / 60_000)}分${Math.round((automationStatus.averageDurationMs % 60_000) / 1000)}秒`
                        : '待统计'}
                    </span>
                    <span>
                      节奏 {automationStatus.pacingMode === 'cooldown'
                        ? '冷却'
                        : automationStatus.pacingMode === 'rest'
                          ? '休息'
                          : automationStatus.pacingMode === 'slow'
                            ? '降速'
                            : automationStatus.pacingMode === 'balanced'
                              ? '平衡'
                              : '正常'}
                    </span>
                    {automationStatus.cooldownUntil && (
                      <span>恢复 {new Date(automationStatus.cooldownUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="workflow-mini-rail" aria-hidden="true">
              <span className={project.mainImage ? 'done' : ''}>主图</span>
              <span className={project.maskCircle ? 'done' : ''}>红圈</span>
              <span className={project.referenceImages.length ? 'done' : ''}>参考</span>
              {project.wardrobeReferences.length > 0 && <span className="done">穿搭</span>}
              <span className={activePrompt?.promptText.trim() ? 'done' : ''}>提示词</span>
              <span className={canSend ? 'done' : ''}>发送</span>
            </div>
          </div>

          <div className="right-scroll-area">
            <PromptOutputPanel
              providerLabel={activeProviderLabel}
              onCopy={() => copyPrompt()}
            />

            <section className="inline-result-strip" aria-label="结果归档预览">
              <div className="inline-result-head">
                <div>
                  <strong>结果归档</strong>
                  <span>
                    {hasProjectResults
                      ? `已保存 ${project.resultArchive.length} 张结果`
                      : '生成结果会自动归档到这里'}
                  </span>
                </div>
                <div className="inline-result-actions">
                  <button
                    type="button"
                    className="inline-result-camera-action inline-result-camera-primary"
                    disabled={isApplyingCameraRealism || isApplyingFaceNaturalization}
                    title="选择结果归档或任意本地文件夹中的图片进行批量处理"
                    onClick={openCameraRealismBatch}
                  >
                    <Camera aria-hidden="true" />
                    {isApplyingCameraRealism
                      ? `处理中 ${cameraRealismProgress.completed}/${cameraRealismProgress.total}`
                      : '批量降 AI 感'}
                  </button>
                  <button
                    type="button"
                    className="inline-result-face-action"
                    disabled={!hasProjectResults || isApplyingCameraRealism || isApplyingFaceNaturalization}
                    title={hasProjectResults ? '只处理结果图中的人脸区域，生成面部自然化副本' : '请先生成或导入结果图'}
                    onClick={openFaceNaturalizationBatch}
                  >
                    <ScanFace aria-hidden="true" />
                    {isApplyingFaceNaturalization
                      ? `处理中 ${faceNaturalizationProgress.completed}/${faceNaturalizationProgress.total}`
                      : '批量面部自然化'}
                  </button>
                  <button
                    type="button"
                    className="inline-result-view-all"
                    onClick={() => setActiveRightTab('archive')}
                    title="查看全部结果"
                  >
                    <Archive aria-hidden="true" />
                    <span>全部</span>
                  </button>
                </div>
              </div>
              {legacyResultRecovery?.needsAttention && (
                <div className="legacy-result-recovery" role="status">
                  <span>{legacyResultRecovery.message || '旧版待处理图片已原样保留。'}</span>
                  <button type="button" onClick={() => window.masklock?.openPath(legacyResultRecovery.sourceDir)}>打开恢复位置</button>
                </div>
              )}
              <div className="inline-result-grid">
                {Array.from({ length: 4 }, (_, index) => {
                  const item = project.resultArchive[index];
                  return item ? (
                    <button key={item.id} type="button" className="inline-result-card is-filled" onClick={() => setActiveRightTab('archive')}>
                      <img src={item.image.dataUrl} alt={item.image.name} />
                      <span>{item.sequence || index + 1}</span>
                    </button>
                  ) : (
                    <div key={`result-slot-${index}`} className="inline-result-card" aria-label={`结果 ${index + 1} 等待生成`}>
                      <Archive aria-hidden="true" />
                      <span>结果 {index + 1}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="tabbar">
              {[
                ['prompt', Sparkles, '提示词'],
                ['history', PanelRightOpen, '发送'],
                ['archive', Archive, '归档'],
                ['revision', Bot, '修正']
              ].map(([id, Icon, label]) => (
                <button key={String(id)} className={activeRightTab === id ? 'active' : ''} onClick={() => setActiveRightTab(id as typeof activeRightTab)}>
                  <Icon />
                  {label as string}
                </button>
              ))}
            </div>

            {activeRightTab === 'prompt' && <ChecklistPanel title="检查清单" items={generationChecklist} />}
            {activeRightTab === 'history' && (
              <>
                <ChecklistPanel title="发送检查" items={sendChecklist} />
                <SendHistoryPanel onCopy={copyPrompt} />
              </>
            )}
            {activeRightTab === 'archive' && <ResultArchivePanel />}
            {activeRightTab === 'revision' && <RevisionPromptPanel onCopy={copyPrompt} />}
          </div>
        </aside>
      </main>

      <StatusBar />
      <FloatingResultPreview result={project.resultArchive[0]} />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
    {startupNoticeState === 'loading' && <div className="startup-notice-loading-layer" aria-hidden="true" />}
    {startupNoticeState === 'visible' && <StartupNoticeModal onConfirm={acknowledgeStartupNotice} />}
    {cameraRealismBatchOpen && (
      <CameraRealismBatchModal
        items={cameraRealismBatchCandidates}
        processing={isApplyingCameraRealism}
        completedCount={cameraRealismProgress.completed}
        totalCount={cameraRealismProgress.total}
        sourceMode={cameraRealismSourceMode}
        sourceDir={cameraRealismFolderSourceDir}
        folderLoading={cameraRealismFolderLoading}
        itemProgress={cameraRealismItemProgress}
        onClose={closeCameraRealismBatch}
        onSelectArchive={selectCameraRealismArchive}
        onChooseFolder={() => void chooseCameraRealismFolder()}
        onStop={stopCameraRealismBatch}
        onConfirm={(selectedIds, strength) => void applyCameraRealismBatch(selectedIds, strength)}
      />
    )}
    <RelayApiConfigModal
      open={relayConfigOpen}
      status={relayApiStatus}
      selectedModel={settings.apiModel}
      onClose={() => setRelayConfigOpen(false)}
      onStatusChange={setRelayApiStatus}
      onModelChange={updateRelayImageModel}
    />
    {faceNaturalizationBatchOpen && (
      <CameraRealismBatchModal
        items={faceNaturalizationBatchCandidates}
        processing={isApplyingFaceNaturalization}
        completedCount={faceNaturalizationProgress.completed}
        totalCount={faceNaturalizationProgress.total}
        variant="face"
        onClose={closeFaceNaturalizationBatch}
        onConfirm={(selectedIds) => void applyFaceNaturalizationBatch(selectedIds)}
      />
    )}
    </>
  );
}

export default App;
