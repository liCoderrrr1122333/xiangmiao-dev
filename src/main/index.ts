import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, safeStorage, screen, session, shell, Tray, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import type {
  AppSettings,
  CameraRealismRequest,
  CameraRealismResponse,
  CameraRealismFolderProcessResult,
  CameraRealismFolderSelection,
  FaceNaturalizationRequest,
  FaceNaturalizationResponse,
  ChatGptAutomationLifecycleEvent,
  ChatGptAutomationResult,
  ChatGptAutomationStatus,
  ChatGptBrowserBackend,
  ChatGptLoginStatus,
  ChatGptModelCatalog,
  ChatGptWindowActionResult,
  FaceLandmarkerAssetBundle,
  ImageAsset,
  ImageImportRequest,
  ImageImportResult,
  LocalAnalysisModelStatus,
  MainImageAnalysis,
  MainImageAnalysisResult,
  MainImageAnalysisStatus,
  ProjectState,
  RelayApiActionResult,
  RelayApiStatus,
  SendPackagePayload,
  VisionModelHealthResult,
  WebPoseAnalysisResult,
  WebPoseAnalysisStatus
} from '../shared/types.js';
import { parseWebPoseSuggestions } from '../shared/webPosePolicy.js';
import { OperationTimeoutError, withTimeout } from '../shared/asyncTimeout.js';
import { resolveMainWindowBounds } from './windowLayoutPolicy.js';
import { normalizeImportedImage } from './imageImport.js';
import {
  createCameraRealismFolderOutputDirectory,
  nextCameraRealismFolderOutputPath,
  scanCameraRealismFolder,
  type CameraRealismFolderItem as InternalCameraRealismFolderItem
} from './cameraRealismFolder.js';
import {
  chatGptModelDomPolicy,
  dedupeChatGptModelOptions,
  followCurrentChatGptModel,
  isSameChatGptModelLabel,
  normalizeChatGptModelLabel
} from '../shared/chatGptModelPolicy.js';
import {
  buildChatGptBatchIncompleteMessage,
  canAssignChatGptTask,
  formatChatGptTaskIndices,
  isChatGptConversationAccessLimitedMessage,
  isChatGptGlobalFailureMessage,
  isChatGptRateLimitMessage,
  missingChatGptTaskIndices,
  normalizeChatGptParallelism,
  normalizeCompletedTaskIndices,
  planChatGptRateLimitRecovery,
  takeReadyChatGptTask
} from '../shared/chatGptParallelPolicy.js';
import {
  appendChatGptRuntimeSample,
  chatGptAdaptiveRecoveryIntervalMs,
  chatGptAutomationMaxBatchCount,
  chatGptGenerationHardTimeoutMs,
  chatGptReasoningTargetForWorkMode,
  createChatGptProtectionState,
  createChatGptTaskRuntimeRecords,
  normalizeChatGptRuntimeSamples,
  normalizeChatGptTaskRuntimeRecords,
  nextChatGptCooldownDeadline,
  planChatGptAdaptivePacing,
  planChatGptConfigurationSync,
  planChatGptCooldownRecovery,
  planChatGptGenerationWait,
  planChatGptProtectionEscalation,
  shouldReconcileChatGptProtectionFromLoginCheck,
  transitionChatGptProtectionState,
  updateChatGptTaskRuntimeRecord,
  type ChatGptProtectionState,
  type ChatGptRuntimeSample,
  type ChatGptTaskRuntimeRecord
} from '../shared/chatGptAutomationRuntimePolicy.js';
import { normalizeAnalysisProvider, normalizeDoubaoAnalysisModel, type AnalysisProvider } from '../shared/analysisProviderPolicy.js';
import {
  buildCurrentTurnChatGptPrompt,
  completeChatGptLaneConversation,
  createChatGptLaneConversation,
  invalidateChatGptLaneConversation,
  openChatGptLaneConversation,
  planChatGptLaneConversation,
  type ChatGptLaneConversation
} from '../shared/chatGptConversationPolicy.js';
import {
  chatGptMaxAttemptsPerImage,
  chatGptParallelLaneStartupIntervalMs,
  hasCompleteUploadEvidence,
  nextStableUploadPollCount,
  resolveContainedChild,
  requiredChatGptSubmissionDelay,
  sanitizeWindowsFileName,
  selectBestChatGptAnalysisCandidate,
  shouldRetryChatGptNoOpSend,
  shouldRetryChatGptBatchItem,
  shouldAcceptChatGptAnalysis,
  shouldRejectSettledStructuredResponse,
  shouldUseChatGptAnalysisTimeoutFallback,
  type ChatGptAnalysisTextCandidate,
  type UploadEvidence
} from './automationPolicy.js';
import {
  explainOllamaFailure,
  isSameOllamaModel,
  parseOllamaJsonObject,
  selectOllamaVisionModels,
  type OllamaVisionModel
} from './ollamaVisionPolicy.js';
import {
  ChromeChatGptStartupError,
  createChromeChatGptWindow,
  type ChatGptWebContentsLike,
  type ChatGptWindowLike,
  type ChromeChatGptMode
} from './chromeChatGpt.js';
import {
  assessChatGptPageHealth,
  isChatGptAuthenticationUrl,
  canUseChatGptComposer,
  classifyChatGptNavigation,
  isConfirmedChatGptLogin,
  isConfirmedChatGptLogout,
  resolveChatGptModelDiscovery
} from './chatGptBrowserPolicy.js';
import {
  jpegPreviewDataUrl,
  normalizeImageDataUrlToJpeg,
  writeVerifiedJpegAtomically
} from './imagePersistence.js';
import { recoverLegacyPostProcessingResults } from './legacyPostProcessingRecovery.js';
import { writeCameraRealismCopy, writeFaceNaturalizationCopy } from './cameraRealism.js';
import sharp from 'sharp';
import { ChatGptControlQueue, type ChatGptControlOperation } from './chatGptControlQueue.js';
import { ensureChatGptReasoning, readChatGptReasoningState } from './chatGptReasoningControl.js';
import {
  inspectGeneratedImageBuffer,
  nextGeneratedImageReadinessState,
  type GeneratedImageReadinessState
} from './chatGptImageReadiness.js';
import { sanitizeDiagnosticRecord } from './diagnosticRedaction.js';
import {
  defaultWebAiUrls,
  normalizeWebAiProvider,
  webAiProviderLabel,
  type WebAiProvider
} from '../shared/webAiProviderPolicy.js';
import {
  assessGeminiPageHealth,
  classifyGeminiNavigation,
  isConfirmedGeminiLogin,
  isConfirmedGeminiLogout
} from './geminiBrowserPolicy.js';
import { canUseGeminiForAutomation, inspectGeminiModels, waitForGeminiPage } from './geminiWebAdapter.js';
import {
  captureGeminiBaseline,
  captureGeminiDomDiagnostics,
  downloadGeminiImage,
  enableGeminiImageMode,
  resetGeminiComposer,
  sendGeminiPrompt,
  setGeminiPrompt,
  uploadAndConfirmGeminiAttachments,
  waitForGeminiComposerReady,
  waitForGeminiImageResult,
  waitForGeminiSendAcceptance,
  waitForGeminiTextResult,
  type GeminiAutomationBaseline,
  type GeminiImageCandidate
} from './geminiWebAutomation.js';
import { canSafelyRetryGeminiSend, classifyGeminiFailure } from './geminiAutomationPolicy.js';
import type { WebAiControlAdapter } from './webAiProvider.js';
import {
  normalizeGenerationProvider
} from '../shared/generationProviderPolicy.js';
import {
  RelayImageAdapter,
  RelayImageAdapterError,
  relayBatchFailurePolicy,
  type RelayImageAttachment,
  type RelayImageResult
} from './relayImageAdapter.js';
import {
  createLianYiLianRelayTransport,
  relayResolutionForDimensions
} from './lianyilianRelayTransport.js';
import { normalizeRelayApiConfig, type RelayApiConfig } from '../shared/relayApiConfig.js';
import {
  RELAY_BANANA_IMAGE_MODEL,
  normalizeRelayImageModel,
  relayImageModelLabel
} from '../shared/relayImageModels.js';
import {
  normalizeRelayResultToPng,
  parseRelayResolution,
  prepareRelayMainAttachment,
  relayImageFileExtension,
  relayPngPreviewDataUrl,
  writeRelayOriginalAtomically,
  writeRelayPngAtomically,
  type RelayCanvasPlan
} from './relayImagePreservation.js';
import {
  buildRelayBatchJobKey,
  createRelayBatchJournal,
  readRelayBatchJournal,
  relayBatchResumePlan,
  transitionRelayBatchTask,
  writeRelayBatchJournalAtomically,
  type RelayBatchJournal,
  type RelayBatchTaskPhase
} from './relayBatchJournal.js';
import { preferredAppDataDirectory } from './platformPolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged && process.env.npm_lifecycle_event === 'dev';
const chatGptAnalysisInitialWaitMs = 240_000;
const chatGptAnalysisRecoveryWaitMs = 180_000;
const chatGptNavigationTimeoutMs = 15_000;
const chatGptStorageTimeoutMs = 5_000;
const chatGptComposerRecoveryHardTimeoutMs = 65_000;
const chatGptBatchTotalTimeoutMs = 12 * 60 * 60 * 1000;
app.setName('像锚');
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
// The packaged GUI can outlive a terminal or automation parent that owned its output pipes.
process.stdout?.on('error', () => undefined);
process.stderr?.on('error', () => undefined);
if (process.platform === 'win32') {
  app.setAppUserModelId('studio.xiangmao.workshop');
}
const preferredAppDataDir = preferredAppDataDirectory(
  process.platform,
  process.env.XIANGMAO_USER_DATA_DIR || process.env.YAOCHUANG_USER_DATA_DIR,
  app.isPackaged ? '' : path.join(app.getAppPath(), '.local-data'),
  app.isPackaged && process.platform === 'darwin'
    ? path.join(app.getPath('appData'), '耀创工坊')
    : ''
);
if (preferredAppDataDir) {
  try {
    fsSync.mkdirSync(preferredAppDataDir, { recursive: true });
    app.setPath('userData', preferredAppDataDir);
    app.setPath('sessionData', preferredAppDataDir);
  } catch (error) {
    if (!app.isPackaged || (process.env.XIANGMAO_USER_DATA_DIR || process.env.YAOCHUANG_USER_DATA_DIR)?.trim()) {
      throw new Error('无法创建指定的数据目录。请检查目录权限或设置 XIANGMAO_USER_DATA_DIR 为可写的绝对路径。', { cause: error });
    }
    // Only an unavailable installed default may retain Electron's platform directory.
  }
}
const appDataDir = () => app.getPath('userData');
const autosavePath = () => {
  const current = path.join(appDataDir(), 'autosave.xiangmao.json');
  const legacy = path.join(appDataDir(), 'autosave.masklock.json');
  return !fsSync.existsSync(current) && fsSync.existsSync(legacy) ? legacy : current;
};
const autosaveBackupPath = () => autosavePath().replace(/\.json$/, '.backup.json');
const settingsPath = () => path.join(appDataDir(), 'settings.json');
const relayCredentialPath = () => path.join(appDataDir(), 'relay-api-key.bin');
const doubaoAnalysisCredentialPath = () => path.join(appDataDir(), 'doubao-analysis-key.bin');
let doubaoAnalysisApiKey = '';
const relayBatchCheckpointPath = () => path.join(appDataDir(), 'relay-batch-checkpoint.json');
const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lRz6AAAAAABJRU5ErkJggg==';
const trayPngBase64 = [
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAP0SURBVFhH1VdfSFNRHN5bbi7n3XbvsnRbLCemlmSRiA0jcyQxzCQDmSgkiSJGxNiDRJQQBcEo8CUWBfbiy0B6qB5ECJ8aBUFEL7GXQnqMnvLhxHfuPWfnnnv3z+qhH3xsd+ee3//fd84cjv9VnF6tt94XGBAhv/NXxaWq+5yKNus927/VvDRDIqt3SHT9AcehtbsEv2vj5z65FDW9xxMIyzp2JR6Pp7E+GF5uXprZ6fjwnBz59qIiugo5EsrcIA3RyBM4LuusWpBW38jgz/a3zyxGqkHn5zXSNHvpV50SuCzrrigurzoVvL+4IytFFhCdOhYnvvgpE4L3Fkn71mOLIwezNwmyKNsoKe5IZAZ1lQ0HJs4Tl1erCDjTtrFi2o9nT1vrimzLIki7HDkazh0KWwxVAjIi6kGjopFlm1zQMKi5uAlKZMW1IDA9anKiZXlux+VRu2XbVNwtoUdipyNyXVEnyebThOQTZJg+x8jmdpoQhlxCX+eP+GbJtGD+/YS3DEHeqhiguZWNGBhSQ1UMinyeaCRlI5OBCjn4VMJ3EZ66IDANJvCkzOgjsYXsLYsJfQ5dg4nJknJJ8km4YDWdGQ8YwMDC8kSGE7SVIlHFD6jpuyoPT3rJocUC8MfmSLmHu+eQiKjdTm50mBKRd/z8WKZbIpgV0Wmq5P/uDGwXZix1objylPkhR3Sv+ul0DvAZSkVAkAsSEx5rwMOFhE7/yJM3wTNSA2HM0EmlGMWIa9A3ujrdwGsswZ0unTRkTiQL0s0RuNphtnU8AMGc+0FFbDIpgNwOnVrukOKNqsOH6ersNlHaCNZ4lahFEqG4h2lNN9GeoAUiFyuKfnaFkHKBeYal19BnBSMjuYPOoA6FfkfnB5cZOuHKNndUCOvHwGQOfMBkYeBx51ACSEE44tgrn4RmPcOOmwUczUngE0N7OBnkPzG4PocASmRr6zRToixiZKRDQi1vWG0bIZMMhKckAMEqzrCIXquAM4KtkiwCaBU6wcUZl5twNGUKy/Nh5/w41DQArgaPYCeEFW8icQiQ4cgNE3OQBpPNH9SvRy/+KERdFugKYW9aqTiS+ybSrIQsvtOf4iILLibgBOEQ+56MuH9tEzwWyKIwnPweGy4mrgHeg1GQcJWU5BO2no7sjJV3BcLM0MWRqYd2RSTDu+48Q1dX5JCYXqlJPH1uWLJbvvs7uCDESMZhOjBvAM4zh1ZVNlBVdpRC4qk4GaipHKwDpNe1WR2who2n9x6L2cjUqg1/jp0a9lG64WgSL/yOBrMJjdnw8A840SaVdG33Ge/xeCrOAPqFNRbzVdHXuKUuE7/YdcY6p/Aysp23pBcj2BAAAAAElFTkSuQmCC'
].join('');
let chatGptWindow: ChatGptWindowLike | null = null;
let geminiWindow: ChatGptWindowLike | null = null;
let chatGptWindowReadyPromise: Promise<ChatGptWindowLike> | null = null;
let chatGptWindowBackend: ChatGptBrowserBackend | null = null;
let chatGptWindowReadyBackend: ChatGptBrowserBackend | null = null;
let chatGptWindowReadyChromeMode: ChromeChatGptMode | null = null;
let chatGptChromeLoginInterventionActive = false;
let chatGptLoginMonitorGeneration = 0;
let googleLoginSwitchInProgress = false;
let mainWindow: BrowserWindow | null = null;
let appTray: Tray | null = null;
let chatGptKeepAliveTimer: NodeJS.Timeout | null = null;
let chatGptSessionConfigured = false;
let chatGptAutomationRunning = false;
let chatGptAnalysisRunning = false;
let chatGptBatchProgress: { index: number; total: number } | null = null;
let chatGptBatchPauseRequested = false;
let activeRelayAdapter: RelayImageAdapter | null = null;
let relayConfiguredAdapter: RelayImageAdapter | null = null;
let relayConfiguredAdapterKeyFingerprint = '';
const activeRelayTaskIds = new Set<string>();
let chatGptTaskTabs: ChatGptWindowLike[] = [];
let chatGptAutomationLifecycleSequence = 0;
let isAppQuitting = false;
let isFlushingBeforeQuit = false;
let cachedSettings: Partial<AppSettings> = {};
let relaySessionApiKey = '';
let relaySessionConfig: RelayApiConfig | undefined;
let relayCredentialChanging = false;
let relayCredentialLoaded = false;
let relayCredentialLoadPromise: Promise<void> | undefined;
let relayCredentialRemembered = false;
const chatGptControlQueue = new ChatGptControlQueue();
const chatGptSubmissionQueue = new ChatGptControlQueue();
const chatGptVerifiedConfigByPage = new WeakMap<object, {
  requestedModel: string;
  currentModel: string;
  reasoning: 'low' | 'medium' | 'high';
  verifiedAt: number;
}>();
let lastChatGptSubmissionStartedAt = 0;
let chatGptConversationAccessBlockedUntil = 0;
let chatGptProtectionDetectionTimestamps: number[] = [];
let chatGptProtectionState: ChatGptProtectionState = createChatGptProtectionState();
let chatGptManualVerificationRequired = false;
const chatGptSurfaceRecoveryAttempted = new WeakSet<object>();
const chatGptGuardedContents = new WeakSet<object>();
const chatGptManualVerificationMessage = 'ChatGPT 正在等待人工登录或安全验证。自动化已暂停，不会刷新或重新打开对话。请点击“查看窗口”手动完成，再点击“检查恢复”。';
let chatGptSubmissionSafetyBlockedUntil = 0;
let chatGptSubmissionSafetyReason = '';
const chatGptSubmissionSafetyCooldownMs = 5 * 60 * 1000;
let chatGptRuntimeSamples: ChatGptRuntimeSample[] = [];
let chatGptSubmissionsSinceRest = 0;
let chatGptSafetyStateLoaded = false;
let chatGptRuntimeLoadPromise: Promise<void> | undefined;
let chatGptRuntimeWriteQueue: Promise<void> = Promise.resolve();
let chatGptBatchMonitor: Pick<ChatGptAutomationStatus,
  'completedCount' | 'failedCount' | 'manualReviewCount' | 'pendingCount' | 'averageDurationMs' | 'cooldownUntil' | 'pacingMode' | 'effectiveParallelism'> | null = null;
let chatGptBatchStartedAt = 0;
let lastSuccessfulOllamaVisionModel = '';
const localAnalysisDefaultModel = 'qwen2.5vl:3b';
const localAnalysisInstallerUrl = 'https://ollama.com/download/windows';
// Reuse the old browser partition when it holds an existing login.
const chatGptPartition = fsSync.existsSync(path.join(appDataDir(), 'Partitions', 'yaochuang-chatgpt'))
  ? 'persist:yaochuang-chatgpt'
  : 'persist:xiangmao-chatgpt';
const chatGptKeepAliveMs = 10 * 60 * 1000;
const chatGptLoginConfirmationCount = 3;
const chatGptConfirmedLoginGraceMs = 5 * 60 * 1000;
const lastConfirmedChatGptLogin = new Map<ChatGptBrowserBackend, number>();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

interface ChatGptBaselineImage {
  src: string;
  fingerprint: string;
  sourceType: string;
  width: number;
  height: number;
  top: number;
  left: number;
  bottom: number;
  role: string;
  inComposer: boolean;
}

interface ChatGptImageBaseline {
  capturedAt: number;
  pageUrl: string;
  promptText: string;
  userMessageCount: number;
  messageNodeCount: number;
  sources: string[];
  fingerprints: string[];
  assistantMessageCount: number;
  images: ChatGptBaselineImage[];
}

interface ChatGptGeneratedCandidate {
  src: string;
  fingerprint: string;
  sourceType: string;
  width: number;
  height: number;
  top: number;
  left: number;
  bottom: number;
  area: number;
  srcKind: string;
  loaded: boolean;
  assistantIndex: number;
  messageIndex: number;
  assistantAssociated: boolean;
  generationControlEvidence: boolean;
  domSignature: string;
  rootStrategy?: string;
  dataUrl?: string;
}

interface ChatGptGeneratedSnapshot {
  busy: boolean;
  busyCount: number;
  stopVisible: boolean;
  quotaExceeded: boolean;
  quotaMessage: string;
  assistantMessageCount: number;
  messageNodeCount: number;
  candidates: ChatGptGeneratedCandidate[];
  rootStrategy: string;
  rejected: Record<string, number>;
  terminalFailure?: string;
  reason?: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface ChatGptComposerResetState {
  ok: boolean;
  hasTextbox: boolean;
  textLength: number;
  attachmentCount: number;
  removeButtonCount: number;
}

interface ChatGptSendAcceptanceSnapshot {
  accepted: boolean;
  acceptedReason: string;
  composerCleared: boolean;
  composerTextLength: number;
  attachmentCount: number;
  userMessageCount: number;
  messageNodeCount: number;
  pageChanged: boolean;
  stopVisible: boolean;
  busyCount: number;
  href: string;
  terminalFailure?: string;
}

class ChatGptQuotaExceededError extends Error {
  readonly quotaMessage: string;

  constructor(quotaMessage: string) {
    super(quotaMessage);
    this.name = 'ChatGptQuotaExceededError';
    this.quotaMessage = quotaMessage;
  }
}

class ChatGptTerminalGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatGptTerminalGenerationError';
  }
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error('图片数据格式无效，必须是 base64 data URL。');
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new Error('图片数据为空，无法写入文件。');
  return { mime: match[1], buffer };
}

function validDimension(value?: number) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.round(Number(value)) : 0;
}

function parseProjectStateJson(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('项目文件不是有效对象。');
  const project = parsed as Partial<ProjectState>;
  if (typeof project.projectName !== 'string') throw new Error('项目文件缺少项目名称。');
  for (const key of ['referenceImages', 'promptHistory', 'sendHistory', 'resultArchive'] as const) {
    if (!Array.isArray(project[key])) throw new Error(`项目文件字段 ${key} 无效。`);
  }
  return project as ProjectState;
}

class ChatGptProtectionPausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatGptProtectionPausedError';
  }
}

async function replaceFileAtomically(filePath: string, content: string) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const replacedPath = `${filePath}.${process.pid}.${Date.now()}.replaced`;
  let replacementCommitted = false;
  await fs.writeFile(temporaryPath, content, 'utf8');
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    const existing = await fs.stat(filePath).catch(() => undefined);
    if (!existing) throw error;
    await fs.rename(filePath, replacedPath);
    try {
      await fs.rename(temporaryPath, filePath);
      replacementCommitted = true;
      await fs.unlink(replacedPath).catch(() => undefined);
    } catch (replacementError) {
      await fs.rename(replacedPath, filePath).catch(() => undefined);
      throw replacementError;
    }
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
    if (replacementCommitted) await fs.unlink(replacedPath).catch(() => undefined);
  }
}

async function writeAutosaveProject(project: ProjectState) {
  await ensureDir(appDataDir());
  const currentRaw = await fs.readFile(autosavePath(), 'utf8').catch(() => '');
  if (currentRaw) {
    try {
      parseProjectStateJson(currentRaw);
      await replaceFileAtomically(autosaveBackupPath(), currentRaw);
    } catch {
      // Keep the last known-good backup when the current autosave is corrupt.
    }
  }
  await replaceFileAtomically(autosavePath(), JSON.stringify(project, null, 2));
}

async function readAutosaveProject() {
  const primary = autosavePath();
  const backup = autosaveBackupPath();
  const raw = await fs.readFile(primary, 'utf8').catch(() => '');
  if (raw) {
    try {
      return { project: parseProjectStateJson(raw), status: 'loaded' as const };
    } catch (error) {
      const corruptPath = path.join(appDataDir(), `autosave.xiangmao.corrupt-${Date.now()}.json`);
      await fs.copyFile(primary, corruptPath).catch(() => undefined);
      const backupRaw = await fs.readFile(backup, 'utf8').catch(() => '');
      if (backupRaw) {
        try {
          const project = parseProjectStateJson(backupRaw);
          await replaceFileAtomically(primary, backupRaw);
          await appendChatGptAutomationDiagnostic('autosave-recovered', {
            corruptPath,
            backupPath: backup,
            reason: error instanceof Error ? error.message : String(error)
          });
          return {
            project,
            status: 'recovered-backup' as const,
            message: '上次自动保存不完整，已从安全备份恢复。',
            backupPath: backup,
            corruptPath
          };
        } catch {
          // Report both files below without deleting either one.
        }
      }
      await appendChatGptAutomationDiagnostic('autosave-corrupt', {
        corruptPath,
        backupPath: backup,
        reason: error instanceof Error ? error.message : String(error)
      });
      return {
        project: null,
        status: 'corrupt' as const,
        message: '自动保存文件损坏，问题文件已保留；当前已建立空项目。',
        backupPath: backup,
        corruptPath
      };
    }
  }
  const backupRaw = await fs.readFile(backup, 'utf8').catch(() => '');
  if (backupRaw) {
    try {
      const project = parseProjectStateJson(backupRaw);
      await replaceFileAtomically(primary, backupRaw);
      return {
        project,
        status: 'recovered-backup' as const,
        message: '已从自动保存备份恢复上次项目。',
        backupPath: backup
      };
    } catch {
      // A broken backup is left untouched for diagnostics.
    }
  }
  return { project: null, status: 'empty' as const };
}

function dimensionsFromImageAsset(image: ImageAsset): ImageDimensions | undefined {
  const width = validDimension(image.width);
  const height = validDimension(image.height);
  if (width && height) return { width, height };
  try {
    const decoded = nativeImage.createFromDataURL(image.dataUrl);
    if (decoded.isEmpty()) return undefined;
    const size = decoded.getSize();
    const decodedWidth = validDimension(size.width);
    const decodedHeight = validDimension(size.height);
    return decodedWidth && decodedHeight ? { width: decodedWidth, height: decodedHeight } : undefined;
  } catch {
    return undefined;
  }
}

function appendOriginalSizeInstruction(promptText: string, dimensions?: ImageDimensions) {
  if (!dimensions) return promptText;
  const sizeLine = `原图尺寸要求：最终输出图片必须原生保持和原始主图完全一致的像素尺寸 ${dimensions.width}x${dimensions.height}px，保持同一画幅比例、构图边界和可见范围，不要裁切、扩边、留白、改变方向或改变长宽比；请直接生成这个尺寸，不要依赖后期拉伸或缩放。`;
  if (promptText.includes(`${dimensions.width}x${dimensions.height}`) && promptText.includes('原图尺寸')) return promptText;
  return `${promptText.trim()}\n\n${sizeLine}`;
}

function extFromMime(mime: string) {
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

function safeName(name: string) {
  return sanitizeWindowsFileName(name, '像锚项目');
}

function safeResultProjectName(projectName: string) {
  const trimmed = projectName.trim();
  if (!trimmed || trimmed === '未命名项目') return '像锚_未命名项目';
  return safeName(trimmed);
}

const maximumCameraRealismInputBytes = 160 * 1024 * 1024;
const maximumFaceNaturalizationMaskBytes = 32 * 1024 * 1024;
const cameraRealismFolderSessions = new Map<string, {
  sourceDir: string;
  outputDir?: string;
  items: Map<string, InternalCameraRealismFolderItem>;
}>();

function isContainedFile(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function readResultImageInput(
  payload: Pick<CameraRealismRequest, 'image'>,
  resultDir: string,
  label: string
) {
  const sourcePath = typeof payload.image?.path === 'string' ? payload.image.path : '';
  if (sourcePath && isContainedFile(resultDir, sourcePath)) {
    const [realRoot, realSource] = await Promise.all([
      fs.realpath(resultDir),
      fs.realpath(sourcePath).catch(() => '')
    ]);
    if (realSource && isContainedFile(realRoot, realSource)) {
      const stats = await fs.stat(realSource);
      if (!stats.isFile() || stats.size > maximumCameraRealismInputBytes) {
        throw new Error(`结果图片超过${label}处理上限。`);
      }
      return fs.readFile(realSource);
    }
  }

  const dataUrl = payload.image?.dataUrl;
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(maximumCameraRealismInputBytes * 4 / 3) + 256) {
    throw new Error('结果图片数据超过相机质感处理上限。');
  }
  const decoded = dataUrlToBuffer(dataUrl);
  if (!decoded.mime.startsWith('image/') || decoded.buffer.length > maximumCameraRealismInputBytes) {
    throw new Error(`${label}只接受有效图片。`);
  }
  return decoded.buffer;
}

async function nextCameraRealismFile(resultDir: string, sourceName: string) {
  const sourceStem = safeName(path.parse(sourceName || '结果图').name);
  for (let copy = 1; copy <= 9999; copy += 1) {
    const suffix = copy === 1 ? '' : `_${copy}`;
    const fileName = `${sourceStem}_相机质感${suffix}.jpg`;
    const filePath = resolveContainedChild(resultDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      return { fileName, filePath };
    }
  }
  throw new Error('相机质感副本数量过多，请整理当前项目文件夹后重试。');
}

async function nextFaceNaturalizationFile(resultDir: string, sourceName: string) {
  const sourceStem = safeName(path.parse(sourceName || '结果图').name);
  for (let copy = 1; copy <= 9999; copy += 1) {
    const suffix = copy === 1 ? '' : `_${copy}`;
    const fileName = `${sourceStem}_面部自然化${suffix}.png`;
    const filePath = resolveContainedChild(resultDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      return { fileName, filePath };
    }
  }
  throw new Error('面部自然化副本数量过多，请整理当前项目文件夹后重试。');
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function nextResultFile(projectName: string, extension: 'jpg' | 'png' = 'jpg') {
  const baseName = safeResultProjectName(projectName);
  const resultDir = resolveContainedChild(app.getPath('desktop'), baseName);
  await ensureDir(resultDir);
  const entries = await fs.readdir(resultDir).catch(() => []);
  const pattern = new RegExp(`^${escapeRegex(baseName)}_(\\d+)\\.(?:png|jpe?g)$`, 'i');
  const maxIndex = entries.reduce((max, fileName) => {
    const match = fileName.match(pattern);
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  const sequence = maxIndex + 1;
  const fileName = `${baseName}_${sequence}.${extension}`;
  return { baseName, resultDir, sequence, fileName, filePath: path.join(resultDir, fileName) };
}

function referenceLabel(index: number) {
  const labels = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return labels[index] || String(index + 1);
}

function stamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function exportRootDir() {
  if (process.platform === 'win32') {
    const preferredRoot = 'D:\\';
    try {
      await fs.access(preferredRoot);
      return path.join(preferredRoot, 'Xiangmao-Workshop', 'Exports');
    } catch {
      // Fall through to the platform documents directory.
    }
  }
  return path.join(app.getPath('documents'), '像锚', 'Exports');
}

async function writeDataUrl(filePath: string, dataUrl: string) {
  const { buffer } = dataUrlToBuffer(dataUrl);
  await fs.writeFile(filePath, buffer);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ResultFileReservation {
  baseName: string;
  resultDir: string;
  sequence: number;
  fileName: string;
  filePath: string;
}

async function reserveResultFiles(projectName: string, total: number, sequenceStart?: number, extension: 'jpg' | 'png' = 'jpg') {
  const first = await nextResultFile(projectName, extension);
  const start = Math.max(1, Math.round(sequenceStart || first.sequence));
  return Array.from({ length: total }, (_, index): ResultFileReservation => {
    const sequence = start + index;
    const fileName = `${first.baseName}_${sequence}.${extension}`;
    return {
      ...first,
      sequence,
      fileName,
      filePath: path.join(first.resultDir, fileName)
    };
  });
}

function freshChatGptConversationUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl || 'https://chatgpt.com/');
    if (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')) return `${url.origin}/`;
  } catch {
    // Use the canonical ChatGPT home page when a saved URL is no longer valid.
  }
  return 'https://chatgpt.com/';
}

const automationTaskContexts = new WeakMap<object, { taskIndex: number; total: number; laneId: number }>();

function taskScopedAutomationEvent(
  event: IpcMainInvokeEvent,
  context: { taskIndex: number; total: number; laneId: number }
) {
  const scopedEvent = { sender: event.sender } as IpcMainInvokeEvent;
  automationTaskContexts.set(scopedEvent, context);
  return scopedEvent;
}

function emitAutomationStatus(event: IpcMainInvokeEvent, status: ChatGptAutomationStatus) {
  const taskContext = automationTaskContexts.get(event);
  const monitoredStatus = chatGptBatchMonitor ? { ...chatGptBatchMonitor, ...status } : status;
  const timedStatus = chatGptBatchStartedAt > 0
    ? { ...monitoredStatus, elapsedMs: Math.max(0, Date.now() - chatGptBatchStartedAt) }
    : monitoredStatus;
  if (taskContext) {
    event.sender.send('chatgpt-automation:status', {
      ...timedStatus,
      step: taskContext.total > 1 ? `第 ${taskContext.taskIndex}/${taskContext.total} 张 · ${status.step}` : status.step,
      batchIndex: taskContext.taskIndex,
      batchTotal: taskContext.total,
      taskIndex: taskContext.taskIndex,
      laneId: taskContext.laneId
    } satisfies ChatGptAutomationStatus);
    return;
  }
  event.sender.send('chatgpt-automation:status', timedStatus);
}

async function evalInPage<T>(webContents: ChatGptWebContentsLike, script: string) {
  return webContents.executeJavaScript(script, true) as Promise<T>;
}

async function evalInPageWithTimeout<T>(webContents: ChatGptWebContentsLike, script: string, timeoutMs = 6000) {
  return withTimeout(evalInPage<T>(webContents, script), timeoutMs, `ChatGPT 页面脚本执行超时（${timeoutMs}ms）`);
}

async function evalChatGptMutation<T>(webContents: ChatGptWebContentsLike, script: string, timeoutMs = 6000) {
  await assertChatGptPageOperationAllowed(webContents);
  return evalInPageWithTimeout<T>(webContents, script, timeoutMs);
}

function emitAutomationLifecycle(event: IpcMainInvokeEvent, running: boolean) {
  if (event.sender.isDestroyed()) return;
  const progress = chatGptBatchProgress;
  event.sender.send('chatgpt-automation:lifecycle', {
    sequence: ++chatGptAutomationLifecycleSequence,
    running,
    batchIndex: progress?.index,
    batchTotal: progress?.total
  } satisfies ChatGptAutomationLifecycleEvent);
}

async function waitForPageResult<T>(
  webContents: ChatGptWebContentsLike,
  script: string,
  isReady: (value: T) => boolean,
  timeoutMs = 30000,
  intervalMs = 600
) {
  const startedAt = Date.now();
  let lastValue: T | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastValue = await evalInPageWithTimeout<T>(webContents, script, Math.min(5000, Math.max(1200, intervalMs + 1800)));
      if (isReady(lastValue)) return lastValue;
    } catch {
      // ChatGPT can navigate or hydrate while we poll; retry until timeout.
    }
    await sleep(intervalMs);
  }
  return lastValue;
}

function resolveChatGptBrowserBackend(requested?: ChatGptBrowserBackend) {
  if (requested === 'chrome' || requested === 'embedded') return requested;
  return cachedSettings.chatGptBrowserBackend === 'chrome' ? 'chrome' : 'embedded';
}

async function persistChatGptBrowserBackend(backend: ChatGptBrowserBackend) {
  cachedSettings = { ...cachedSettings, chatGptBrowserBackend: backend };
  await ensureDir(appDataDir());
  const saved = await fs
    .readFile(settingsPath(), 'utf8')
    .then((raw) => sanitizeStoredSettings(JSON.parse(raw)))
    .catch(() => ({}));
  const next = { ...saved, chatGptBrowserBackend: backend, apiKeySessionOnly: '' };
  const temporaryPath = `${settingsPath()}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(temporaryPath, settingsPath());
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('chatgpt-browser:backend-changed', backend);
  }
}

function sanitizeStoredSettings(value: unknown): Partial<AppSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const {
    postProcessingEnabled: _removedPostProcessingSetting,
    apiKeySessionOnly: _sessionApiKey,
    relayApiKey: _relayApiKey,
    relayKeySessionOnly: _relaySessionKey,
    relayBaseUrl: _removedRelayBaseUrl,
    relayModel: _removedRelayModel,
    relayResolution: _removedRelayResolution,
    ...settings
  } = value as Record<string, unknown>;
  return { ...settings, apiKeySessionOnly: '' } as Partial<AppSettings>;
}

function maskRelayApiKey(apiKey: string) {
  const suffix = apiKey.slice(-4).toUpperCase();
  return suffix ? `****${suffix}` : undefined;
}

function resetRelayConfiguredAdapter() {
  relayConfiguredAdapter = null;
  relayConfiguredAdapterKeyFingerprint = '';
}

function configuredRelayAdapter() {
  const keyFingerprint = createHash('sha256').update(`${JSON.stringify(relaySessionConfig)}\n${relaySessionApiKey}`).digest('hex');
  if (relayConfiguredAdapter && relayConfiguredAdapterKeyFingerprint === keyFingerprint) {
    return relayConfiguredAdapter;
  }
  const electronSessionFetch = session.defaultSession.fetch.bind(session.defaultSession) as unknown as typeof fetch;
  relayConfiguredAdapter = new RelayImageAdapter(createLianYiLianRelayTransport({
    fetchCandidates: [
      { id: 'node-direct', fetchImpl: fetch },
      { id: 'electron-system-proxy', fetchImpl: electronSessionFetch }
    ]
  }));
  relayConfiguredAdapterKeyFingerprint = keyFingerprint;
  return relayConfiguredAdapter;
}

async function ensureRelayCredentialLoaded() {
  if (relayCredentialLoaded) return;
  relayCredentialLoadPromise ??= (async () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      try {
        const encrypted = await fs.readFile(relayCredentialPath());
        const stored = JSON.parse(safeStorage.decryptString(encrypted));
        const config = normalizeRelayApiConfig(stored.config);
        if (typeof stored.apiKey !== 'string' || !stored.apiKey.trim()) return;
        relaySessionConfig = config;
        relaySessionApiKey = stored.apiKey.trim();
        relayCredentialRemembered = Boolean(relaySessionApiKey);
        return;
      } catch {
        relaySessionApiKey = '';
        relaySessionConfig = undefined;
        relayCredentialRemembered = false;
      }
      try {
        const pendingPath = path.join(appDataDir(), 'relay-api-key.pending.json');
        const pending = JSON.parse(await fs.readFile(pendingPath, 'utf8')) as { apiKey?: unknown; config?: RelayApiConfig };
        const apiKey = typeof pending.apiKey === 'string' ? pending.apiKey.trim() : '';
        if (!apiKey) return;
        const config = normalizeRelayApiConfig(pending.config || {});
        await ensureDir(appDataDir());
        await fs.writeFile(relayCredentialPath(), safeStorage.encryptString(JSON.stringify({ config, apiKey })));
        await fs.unlink(pendingPath);
        relaySessionConfig = config;
        relaySessionApiKey = apiKey;
        relayCredentialRemembered = true;
      } catch {
        relaySessionApiKey = relaySessionApiKey || '';
      }
    } finally {
      relayCredentialLoaded = true;
    }
  })();
  return relayCredentialLoadPromise;
}

function relayApiStatus(message?: string): RelayApiStatus {
  return {
    configured: Boolean(relaySessionApiKey && relaySessionConfig),
    config: relaySessionConfig,
    remembered: relayCredentialRemembered,
    maskedKey: maskRelayApiKey(relaySessionApiKey),
    protocolReady: true,
    message: message || (relaySessionApiKey
      ? 'API Key 已配置，可使用 API 做图。'
      : '自由 API 未配置。请填写服务地址和 API Key。')
  };
}

async function configureRelayCredential(apiKey: string, remember: boolean, configInput: RelayApiConfig): Promise<RelayApiActionResult> {
  if (relayCredentialChanging || activeRelayAdapter || chatGptAutomationRunning) {
    return { ok: false, ...relayApiStatus('任务运行中，请结束后再修改 API 配置。') };
  }
  relayCredentialChanging = true;
  try {
  const config = normalizeRelayApiConfig(configInput);
  await ensureRelayCredentialLoaded();
  const endpointChanged = JSON.stringify(config) !== JSON.stringify(relaySessionConfig);
  const normalizedKey = apiKey.trim() || (!endpointChanged ? relaySessionApiKey : '');
  if (!normalizedKey) return { ok: false, ...relayApiStatus('请输入有效的 API Key。'), error: 'API Key 为空。' };
  if (/\s/.test(normalizedKey) || normalizedKey.length > 4096) throw new Error('API Key 格式无效。');
  if (remember && !safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      ...relayApiStatus('当前系统无法使用 Electron safeStorage，API Key 未保存。'),
      error: '本机安全存储不可用。'
    };
  }
  if (remember) {
    await ensureDir(appDataDir());
    const encrypted = safeStorage.encryptString(JSON.stringify({ config, apiKey: normalizedKey }));
    const temporaryPath = `${relayCredentialPath()}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporaryPath, encrypted);
      await fs.rename(temporaryPath, relayCredentialPath());
    } finally {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
  } else {
    await fs.unlink(relayCredentialPath()).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  resetRelayConfiguredAdapter();
  relaySessionApiKey = normalizedKey;
  relaySessionConfig = config;
  relayCredentialRemembered = remember;
  return { ok: true, ...relayApiStatus('API Key 已安全配置，正在等待连接测试。') };
  } catch {
    return { ok: false, ...relayApiStatus('API 配置未保存，请检查地址、接口路径、密钥和本机存储。') };
  } finally { relayCredentialChanging = false; }
}

async function clearRelayCredential(): Promise<RelayApiActionResult> {
  if (relayCredentialChanging || activeRelayAdapter || chatGptAutomationRunning) {
    return { ok: false, ...relayApiStatus('任务运行中，暂不能清除 API 配置。') };
  }
  relayCredentialChanging = true;
  try {
    await ensureRelayCredentialLoaded();
    try { await fs.unlink(relayCredentialPath()); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, ...relayApiStatus('清除失败，请检查本机存储权限。') };
    }
    relaySessionApiKey = '';
    relaySessionConfig = undefined;
    relayCredentialRemembered = false;
    resetRelayConfiguredAdapter();
    return { ok: true, ...relayApiStatus('自由 API 配置和密钥已清除。') };
  } finally {
    relayCredentialChanging = false;
  }
}

function runChatGptControlOperation<T>(
  operation: ChatGptControlOperation,
  action: () => Promise<T>,
  mode: 'serialized' | 'single-flight' = 'serialized'
) {
  const queuedAt = Date.now();
  const pendingBefore = chatGptControlQueue.pendingCount;
  const run = mode === 'single-flight'
    ? chatGptControlQueue.runSingleFlight.bind(chatGptControlQueue)
    : chatGptControlQueue.run.bind(chatGptControlQueue);
  return run(operation, async () => {
    await appendChatGptAutomationDiagnostic('chatgpt-control-operation-started', {
      operation,
      mode,
      queuedMs: Date.now() - queuedAt,
      pendingBefore
    });
    try {
      const result = await action();
      await appendChatGptAutomationDiagnostic('chatgpt-control-operation-finished', {
        operation,
        durationMs: Date.now() - queuedAt,
        ok: typeof result === 'object' && result !== null && 'ok' in result ? Boolean((result as { ok?: unknown }).ok) : true
      });
      return result;
    } catch (error) {
      await appendChatGptAutomationDiagnostic('chatgpt-control-operation-failed', {
        operation,
        durationMs: Date.now() - queuedAt,
        reason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  });
}

async function acquireChatGptTaskSlot(purpose: 'analysis' | 'generation') {
  const startedAt = Date.now();
  let cancelled = false;
  let slotSet = false;
  try {
    return await withTimeout(
      chatGptControlQueue.runExclusive(async () => {
        await appendChatGptAutomationDiagnostic('chatgpt-task-slot-waiting', {
          purpose,
          pendingControls: chatGptControlQueue.pendingCount
        });
        await chatGptControlQueue.waitForSingleFlights([
          'show-window',
          'gemini:show-window'
        ]);
        if (cancelled) return { acquired: false as const, blocker: 'expired' as const };
        if (chatGptAutomationRunning || chatGptAnalysisRunning) {
          return {
            acquired: false as const,
            blocker: chatGptAutomationRunning ? 'generation' as const : 'analysis' as const
          };
        }
        if (purpose === 'generation') chatGptAutomationRunning = true;
        else chatGptAnalysisRunning = true;
        slotSet = true;
        void appendChatGptAutomationDiagnostic('chatgpt-task-slot-acquired', {
          purpose,
          durationMs: Date.now() - startedAt
        });
        return { acquired: true as const };
      }),
      105_000,
      '后台登录或模型检查长时间没有结束。'
    );
  } catch (error) {
    cancelled = true;
    if (slotSet) {
      if (purpose === 'generation') chatGptAutomationRunning = false;
      else chatGptAnalysisRunning = false;
    }
    await appendChatGptAutomationDiagnostic('chatgpt-task-slot-failed', {
      purpose,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function describeChatGptWindowFailure(error: unknown, action: 'open' | 'check') {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const prefix = action === 'open' ? '专属 Chrome 窗口未能打开。' : '暂时无法检查 ChatGPT 登录状态。';
  if (
    error instanceof ChromeChatGptStartupError ||
    rawMessage.includes('XIANGMAO_CHROME_STARTUP_FAILED') ||
    /ECONNREFUSED|local control port|before opening its local control port/i.test(rawMessage)
  ) {
    return `${prefix}软件已清理专属进程，并依次尝试无端口本地管道、兼容端口、Chrome 与 Edge；普通浏览器能打开不代表本地自动化通道可用。请再次点击“查看窗口”，软件会重新建立独立通道。`;
  }
  if (/Google Chrome or Microsoft Edge is required/i.test(rawMessage)) {
    return `${prefix}此电脑未找到可用的 Google Chrome 或 Microsoft Edge，请安装或修复其中任意一个浏览器后重试。`;
  }
  if (/EACCES|EPERM|permission|access is denied/i.test(rawMessage)) {
    return `${prefix}系统阻止了专属浏览器配置目录或进程访问，请关闭安全软件的拦截提示后重试。`;
  }
  if (/timed out|timeout|超时/i.test(rawMessage)) {
    return `${prefix}浏览器或 ChatGPT 页面启动超时，请确认网络可访问 ChatGPT 后再次点击“查看窗口”。`;
  }
  return `${prefix}软件已停止本次操作以避免卡死，请再次点击“查看窗口”自动恢复。`;
}

async function closeChatGptTaskTabs() {
  const tabs = chatGptTaskTabs.splice(0);
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.isDestroyed()) return;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        tab.on('closed', finish);
        setTimeout(finish, 2500);
        tab.destroy();
      });
    })
  );
}

async function releaseChatGptWindow(expectedWindow?: ChatGptWindowLike) {
  const current = chatGptWindow;
  if (!current || (expectedWindow && current !== expectedWindow)) return;
  await closeChatGptTaskTabs();
  geminiWindow = null;
  chatGptWindow = null;
  chatGptWindowBackend = null;
  chatGptChromeLoginInterventionActive = false;
  chatGptLoginMonitorGeneration += 1;
  if (current.isDestroyed()) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    current.on('closed', finish);
    setTimeout(finish, 4500);
    current.destroy();
  });
  await sleep(250);
}

function installEmbeddedChatGptNavigationGuards(createdWindow: BrowserWindow) {
  const queueGoogleSwitch = (targetUrl: string) => {
    setTimeout(() => {
      void switchEmbeddedGoogleLoginToChrome(createdWindow as unknown as ChatGptWindowLike, targetUrl);
    }, 0);
  };
  const guardNavigation = (event: Electron.Event, targetUrl: string) => {
    if (classifyChatGptNavigation(targetUrl) !== 'google-oauth') return;
    event.preventDefault();
    queueGoogleSwitch(targetUrl);
  };
  createdWindow.webContents.on('will-navigate', guardNavigation);
  createdWindow.webContents.on('will-redirect', guardNavigation);
  createdWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    const kind = classifyChatGptNavigation(targetUrl);
    if (kind === 'google-oauth') {
      queueGoogleSwitch(targetUrl);
      return { action: 'deny' };
    }
    if (kind === 'trusted-chatgpt') {
      void loadChatGptUrlRecoverably(
        createdWindow as unknown as ChatGptWindowLike,
        targetUrl,
        'trusted-auth-popup'
      );
      return { action: 'deny' };
    }
    if (kind === 'external') void openSafeExternalUrl(targetUrl).catch(() => undefined);
    return { action: 'deny' };
  });
  createdWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    console.warn('[ChatGPT window] embedded page failed to load', {
      errorCode,
      errorDescription,
      validatedUrl
    });
  });
  createdWindow.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[ChatGPT window] embedded renderer exited', details);
    if (!isAppQuitting && chatGptWindow === (createdWindow as unknown as ChatGptWindowLike)) {
      createdWindow.destroy();
    }
  });
  createdWindow.on('unresponsive', () => {
    console.warn('[ChatGPT window] embedded renderer became unresponsive');
  });
}

function validatedExternalUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('外部链接无效。');
  const target = new URL(value.trim());
  const localHttp = target.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
  if (target.protocol !== 'https:' && !localHttp) throw new Error('只允许打开 HTTPS 链接。');
  return target.toString();
}

async function openSafeExternalUrl(value: unknown) {
  await shell.openExternal(validatedExternalUrl(value));
}

async function openExistingDirectory(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || !path.isAbsolute(value)) {
    throw new Error('要打开的文件夹路径无效。');
  }
  const target = path.resolve(value);
  const stats = await fs.stat(target).catch(() => undefined);
  if (!stats?.isDirectory()) throw new Error('目标文件夹不存在或不是文件夹。');
  return shell.openPath(target);
}

async function getChatGptWindow(
  url: string,
  requestedBackend?: ChatGptBrowserBackend,
  requestedChromeMode: ChromeChatGptMode = 'background'
) {
  await loadChatGptRuntimeState();
  if (chatGptManualVerificationRequired && requestedChromeMode === 'background' &&
      (!chatGptWindow || chatGptWindow.isDestroyed())) {
    throw new ChatGptProtectionPausedError(chatGptManualVerificationMessage);
  }
  const backend = resolveChatGptBrowserBackend(requestedBackend);
  if (chatGptWindowReadyPromise) {
    if (
      chatGptWindowReadyBackend === backend &&
      (backend !== 'chrome' || chatGptWindowReadyChromeMode === requestedChromeMode)
    ) {
      return chatGptWindowReadyPromise;
    }
    await chatGptWindowReadyPromise.catch(() => undefined);
    return getChatGptWindow(url, backend, requestedChromeMode);
  }
  if (chatGptWindow && !chatGptWindow.isDestroyed()) {
    const currentMode = chatGptWindow.mode || 'background';
    const canReuseChromeAcrossVisibilityModes =
      backend === 'chrome' &&
      chatGptWindowBackend === 'chrome';
    if (
      chatGptWindowBackend === backend &&
      (backend !== 'chrome' || currentMode === requestedChromeMode || canReuseChromeAcrossVisibilityModes)
    ) {
      const preserveChromeLoginWindow =
        canReuseChromeAcrossVisibilityModes &&
        requestedChromeMode === 'background' &&
        chatGptChromeLoginInterventionActive;
      if (
        !preserveChromeLoginWindow &&
        !(backend === 'chrome' && requestedChromeMode === 'visible')
      ) {
        keepChatGptWindowInBackground(chatGptWindow);
      }
      return chatGptWindow;
    }
    await releaseChatGptWindow();
  }

  const targetUrl = url || 'https://chatgpt.com/';
  const readyPromise = (async (): Promise<ChatGptWindowLike> => {
    let createdWindow: ChatGptWindowLike | undefined;
    try {
      if (backend === 'chrome') {
        createdWindow = await createChromeChatGptWindow({
          profileDir: path.join(appDataDir(), 'ChatGPT-Chrome'),
          url: targetUrl,
          mode: requestedChromeMode,
          onDiagnostic: (event, payload) => appendChatGptAutomationDiagnostic(event, payload)
        });
        chatGptChromeLoginInterventionActive = requestedChromeMode === 'visible';
      } else {
        const chatGptSession = getChatGptSession();
        const electronWindow = new BrowserWindow({
          show: false,
          width: 1280,
          height: 920,
          minWidth: 980,
          minHeight: 720,
          title: 'ChatGPT 自动做图',
          icon: getTrayIconPath(),
          autoHideMenuBar: true,
          focusable: false,
          skipTaskbar: false,
          paintWhenInitiallyHidden: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
            partition: chatGptPartition
          }
        });
        installEmbeddedChatGptNavigationGuards(electronWindow);
        electronWindow.webContents.setUserAgent(getStableChatGptUserAgent(chatGptSession.getUserAgent()));
        electronWindow.on('close', (event) => {
          if (isAppQuitting) return;
          event.preventDefault();
          keepChatGptWindowInBackground(electronWindow as unknown as ChatGptWindowLike);
          electronWindow.hide();
          void flushChatGptSessionStorage();
        });
        createdWindow = electronWindow as unknown as ChatGptWindowLike;
      }

      chatGptWindow = createdWindow;
      chatGptWindowBackend = backend;
      installChatGptInteractionGuard(createdWindow.webContents);
      createdWindow.on('closed', () => {
        if (chatGptWindow === createdWindow) {
          chatGptWindow = null;
          chatGptWindowBackend = null;
          chatGptChromeLoginInterventionActive = false;
        }
      });
      const initialNavigation = classifyChatGptNavigation(createdWindow.webContents.getURL());
      if (initialNavigation === 'blank' || initialNavigation === 'external') {
        await loadChatGptRuntimeState();
        if (chatGptManualVerificationRequired && requestedChromeMode === 'visible') {
          // Explicit View Window after restart may open a page, but never clears the pause.
          await withTimeout(createdWindow.loadURL(targetUrl), chatGptNavigationTimeoutMs, '人工登录窗口加载超时');
        } else {
          await loadChatGptUrlRecoverably(createdWindow, targetUrl, 'initial-window-load');
        }
      }
      await persistChatGptPageStorage(createdWindow.webContents);
      if (!(backend === 'chrome' && requestedChromeMode === 'visible')) {
        keepChatGptWindowInBackground(createdWindow);
      }
      return createdWindow;
    } catch (error) {
      if (
        createdWindow &&
        isRecoveredChatGptNavigationAbort(error, createdWindow.webContents.getURL())
      ) {
        console.info('[ChatGPT window] initial navigation was superseded by a trusted navigation');
        await sleep(500);
        await persistChatGptPageStorage(createdWindow.webContents);
        if (!(backend === 'chrome' && requestedChromeMode === 'visible')) {
          keepChatGptWindowInBackground(createdWindow);
        }
        return createdWindow;
      }
      if (createdWindow && chatGptWindow === createdWindow) {
        await releaseChatGptWindow(createdWindow);
      } else if (createdWindow && !createdWindow.isDestroyed()) {
        createdWindow.destroy();
      }
      throw error;
    }
  })();
  chatGptWindowReadyPromise = readyPromise;
  chatGptWindowReadyBackend = backend;
  chatGptWindowReadyChromeMode = backend === 'chrome' ? requestedChromeMode : null;
  try {
    return await readyPromise;
  } finally {
    if (chatGptWindowReadyPromise === readyPromise) {
      chatGptWindowReadyPromise = null;
      chatGptWindowReadyBackend = null;
      chatGptWindowReadyChromeMode = null;
    }
  }
}

async function releaseGeminiWindow() {
  const current = geminiWindow;
  geminiWindow = null;
  if (!current || current === chatGptWindow || current.isDestroyed()) return;
  current.destroy();
  await sleep(250);
}

async function getGeminiWindow(
  url: string = defaultWebAiUrls.gemini,
  mode: ChromeChatGptMode = 'background'
) {
  if (geminiWindow && !geminiWindow.isDestroyed()) return geminiWindow;
  // Keep the stable ChatGPT root tab intact and host Gemini in a sibling tab
  // inside the same persistent Chrome context/profile.
  const root = await getChatGptWindow(defaultWebAiUrls.chatgpt, 'chrome', mode);
  const currentNavigation = classifyGeminiNavigation(root.webContents.getURL());
  const providerWindow =
    currentNavigation === 'trusted-gemini' || currentNavigation === 'google-oauth'
      ? root
      : root.createTab
        ? await root.createTab('about:blank')
        : root;
  if (providerWindow === root && currentNavigation !== 'trusted-gemini' && currentNavigation !== 'google-oauth') {
    await loadGeminiUrlRecoverably(providerWindow, url, 'Gemini 页面');
  } else if (providerWindow !== root) {
    await loadGeminiUrlRecoverably(providerWindow, url, 'Gemini 页面');
  }
  geminiWindow = providerWindow;
  providerWindow.on('closed', () => {
    if (geminiWindow === providerWindow) geminiWindow = null;
  });
  if (mode === 'visible') providerWindow.show();
  else keepChatGptWindowInBackground(providerWindow);
  return providerWindow;
}

function isRecoveredGeminiNavigationAbort(error: unknown, currentUrl: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/ERR_ABORTED|\(-3\)/i.test(message)) return false;
  const navigation = classifyGeminiNavigation(currentUrl);
  return navigation === 'trusted-gemini' || navigation === 'google-oauth';
}

async function loadGeminiUrlRecoverably(win: ChatGptWindowLike, targetUrl: string, label: string) {
  try {
    await withTimeout(win.loadURL(targetUrl), chatGptNavigationTimeoutMs, `${label}加载超时`);
  } catch (error) {
    await sleep(900);
    const currentUrl = win.webContents.getURL();
    if (isRecoveredGeminiNavigationAbort(error, currentUrl)) {
      await appendChatGptAutomationDiagnostic('gemini-navigation-abort-recovered', {
        label,
        pageUrl: currentUrl
      });
      return;
    }
    throw error;
  }
}

async function loadFreshGeminiConversation(win: ChatGptWindowLike, targetUrl: string, label: string) {
  if (classifyGeminiNavigation(win.webContents.getURL()) === 'google-oauth') return;
  await withTimeout(win.loadURL('about:blank'), chatGptNavigationTimeoutMs, `${label}清理旧页面超时`);
  await loadGeminiUrlRecoverably(win, targetUrl, label);
}

async function ensureGeminiWindowUrl(win: ChatGptWindowLike, url: string = defaultWebAiUrls.gemini) {
  const navigation = classifyGeminiNavigation(win.webContents.getURL());
  if (navigation === 'trusted-gemini' || navigation === 'google-oauth') return;
  await loadGeminiUrlRecoverably(win, url, 'Gemini 页面');
}

async function recoverGeminiSurfaceInBackground(
  win: ChatGptWindowLike,
  url: string = defaultWebAiUrls.gemini,
  reason = 'blank-or-unrecognized'
) {
  if (classifyGeminiNavigation(win.webContents.getURL()) === 'google-oauth') {
    return waitForGeminiPage(win.webContents, 5000);
  }
  await appendChatGptAutomationDiagnostic('gemini-surface-recovery-started', {
    reason,
    pageUrl: win.webContents.getURL()
  });
  await withTimeout(win.loadURL('about:blank'), chatGptNavigationTimeoutMs, 'Gemini 白屏清理超时');
  await loadGeminiUrlRecoverably(win, url, 'Gemini 白屏恢复');
  const probe = await waitForGeminiPage(win.webContents, 30_000);
  const health = probe ? assessGeminiPageHealth(probe) : undefined;
  await appendChatGptAutomationDiagnostic('gemini-surface-recovery-finished', {
    reason,
    pageUrl: win.webContents.getURL(),
    composerReady: probe?.composerReady,
    loginVisible: probe?.loginVisible,
    regionBlocked: probe?.regionBlocked,
    usable: health?.usable === true,
    blank: health?.blank === true
  });
  keepChatGptWindowInBackground(win);
  return probe;
}

function describeGeminiWindowFailure(error: unknown, action: 'open' | 'check') {
  const detail = error instanceof Error ? error.message : String(error);
  const prefix = action === 'open' ? 'Gemini 专属窗口未能打开。' : '暂时无法检查 Gemini 登录状态。';
  if (/timed out|timeout|超时/i.test(detail)) return `${prefix}请确认网络可访问 Gemini 后重试。`;
  if (/ECONNREFUSED|local control port|browser process|Chrome|Edge/i.test(detail)) {
    return `${prefix}专属 Chrome 自动化通道异常，请点击“恢复窗口”重新建立连接。`;
  }
  return `${prefix}软件已停止本次操作以避免卡死，请点击“恢复窗口”重试。`;
}

async function checkGeminiLogin(url: string = defaultWebAiUrls.gemini): Promise<ChatGptLoginStatus> {
  try {
    if (chatGptAutomationRunning || chatGptAnalysisRunning) {
      return {
        ok: false,
        loggedIn: false,
        needsLogin: false,
        usable: false,
        message: '自动任务正在运行，Gemini 登录复核将在任务结束后进行。',
        backend: 'chrome',
        provider: 'gemini'
      };
    }
    const win = await getGeminiWindow(url, 'background');
    await ensureGeminiWindowUrl(win, url);
    let probe = await waitForGeminiPage(win.webContents, 20_000);
    if ((!probe || assessGeminiPageHealth(probe).blank) && classifyGeminiNavigation(probe?.url || win.webContents.getURL()) !== 'google-oauth') {
      probe = await recoverGeminiSurfaceInBackground(win, url, 'login-check-blank');
    }
    const navigation = classifyGeminiNavigation(win.webContents.getURL());
    if (!probe) {
      return {
        ok: false,
        loggedIn: false,
        needsLogin: false,
        usable: false,
        message: 'Gemini 页面长时间没有完成加载，请检查网络后点击“恢复窗口”。',
        backend: 'chrome',
        provider: 'gemini',
        recoveryAvailable: true,
        recoveryReason: 'gemini-page-timeout',
        recoveryAttempts: 1
      };
    }
    const health = assessGeminiPageHealth(probe);
    await appendChatGptAutomationDiagnostic('gemini-login-check', {
      navigation,
      composerReady: probe.composerReady,
      accountReady: probe.accountReady,
      loginVisible: probe.loginVisible,
      regionBlocked: probe.regionBlocked,
      usable: health.usable
    });
    if (probe.regionBlocked) {
      return {
        ok: false,
        loggedIn: false,
        needsLogin: false,
        usable: false,
        message: 'Google 当前提示 Gemini 暂不支持所在地区。请恢复可访问 Gemini 的网络环境后点击“恢复窗口”。',
        url: probe.url,
        backend: 'chrome',
        provider: 'gemini',
        recoveryAvailable: true,
        recoveryReason: 'gemini-region-blocked',
        recoveryAttempts: 0
      };
    }
    if (isConfirmedGeminiLogin(probe)) {
      keepChatGptWindowInBackground(win);
      return {
        ok: true,
        loggedIn: true,
        needsLogin: false,
        usable: true,
        message: 'Gemini 已登录，自动化将在后台运行。',
        url: probe.url,
        backend: 'chrome',
        provider: 'gemini'
      };
    }
    if (isConfirmedGeminiLogout(probe) || navigation === 'google-oauth') {
      keepChatGptWindowInBackground(win);
      return {
        ok: true,
        loggedIn: false,
        needsLogin: true,
        usable: false,
        message: 'Gemini 需要登录。请点击“查看窗口”手动完成 Google 登录。',
        url: probe.url,
        backend: 'chrome',
        provider: 'gemini'
      };
    }
    return {
      ok: false,
      loggedIn: false,
      needsLogin: false,
      usable: false,
      message: '暂时无法确认 Gemini 登录状态，请点击“查看窗口”确认页面。',
      url: probe.url,
      backend: 'chrome',
      provider: 'gemini'
    };
  } catch (error) {
    const message = describeGeminiWindowFailure(error, 'check');
    await appendChatGptAutomationDiagnostic('gemini-login-check-failed', {
      reason: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      loggedIn: false,
      needsLogin: false,
      usable: false,
      message,
      error: message,
      backend: 'chrome',
      provider: 'gemini',
      recoveryAvailable: true,
      recoveryReason: 'gemini-login-check-failed',
      recoveryAttempts: 1
    };
  }
}

async function showGeminiWindowForInspection(
  url: string = defaultWebAiUrls.gemini
): Promise<ChatGptWindowActionResult> {
  try {
    const win = await getGeminiWindow(url, 'background');
    await ensureGeminiWindowUrl(win, url);
    const initialProbe = await waitForGeminiPage(win.webContents, 7000);
    if ((!initialProbe || assessGeminiPageHealth(initialProbe).blank) && classifyGeminiNavigation(initialProbe?.url || win.webContents.getURL()) !== 'google-oauth') {
      await recoverGeminiSurfaceInBackground(win, url, 'inspection-blank');
    }
    // A user-requested reveal must win over an overlapping login/model probe
    // that would otherwise return the shared Chrome window to the background.
    chatGptChromeLoginInterventionActive = true;
    const visible = await showAndConfirmChatGptWindow(win);
    const navigation = classifyGeminiNavigation(win.webContents.getURL());
    const message = !visible
      ? 'Gemini 页面已打开，但系统没有确认窗口可见。请点击“恢复窗口”。'
      : initialProbe?.regionBlocked
        ? 'Google 当前提示 Gemini 暂不支持所在地区；请恢复可访问 Gemini 的网络环境后再重试。'
      : navigation === 'google-oauth'
        ? 'Google 登录页面已显示，请手动完成登录；软件不会点击验证步骤。'
        : 'Gemini 专属 Chrome 已显示。';
    return {
      ok: visible,
      message,
      error: visible ? undefined : message,
      url: win.webContents.getURL(),
      backend: 'chrome',
      recoveryAvailable: !visible,
      recoveryReason: visible ? undefined : 'gemini-window-not-visible',
      recoveryAttempts: visible ? 0 : 1
    };
  } catch (error) {
    const message = describeGeminiWindowFailure(error, 'open');
    return {
      ok: false,
      message,
      error: message,
      backend: 'chrome',
      recoveryAvailable: true,
      recoveryReason: 'gemini-window-open-failed',
      recoveryAttempts: 1
    };
  }
}

async function recoverGeminiWindowForInspection(url: string = defaultWebAiUrls.gemini) {
  const current = geminiWindow;
  if (current && current === chatGptWindow) await releaseChatGptWindow(current);
  else await releaseGeminiWindow();
  return showGeminiWindowForInspection(url);
}

async function listGeminiModels(url: string = defaultWebAiUrls.gemini): Promise<ChatGptModelCatalog> {
  const login = await checkGeminiLogin(url);
  if (!login.loggedIn) {
    return {
      ok: false,
      models: [],
      refreshedAt: new Date().toISOString(),
      message: login.needsLogin ? '请先登录 Gemini，再刷新模型。' : login.message,
      error: login.error || 'gemini-login-required',
      provider: 'gemini'
    };
  }
  const win = await getGeminiWindow(url, 'background');
  const catalog = await inspectGeminiModels(win.webContents);
  keepChatGptWindowInBackground(win);
  await appendChatGptAutomationDiagnostic('gemini-model-catalog', {
    currentModel: catalog.currentModel || 'unknown',
    availableModelCount: catalog.models.length,
    ok: catalog.ok
  });
  return catalog;
}

function isRecoveredChatGptNavigationAbort(error: unknown, currentUrl: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/ERR_ABORTED|\(-3\)/i.test(message)) return false;
  const currentLower = currentUrl.toLowerCase();
  return (
    currentLower.includes('chatgpt.com') ||
    currentLower.includes('openai.com') ||
    currentLower.includes('auth0') ||
    currentLower.includes('accounts.google.com')
  );
}

async function loadChatGptUrlRecoverably(win: ChatGptWindowLike, targetUrl: string, label: string) {
  await assertChatGptPageOperationAllowed(win.webContents);
  try {
    await withTimeout(
      win.loadURL(targetUrl),
      chatGptNavigationTimeoutMs,
      `ChatGPT 页面加载超时（${chatGptNavigationTimeoutMs}ms）`
    );
    return true;
  } catch (error) {
    if (error instanceof OperationTimeoutError) {
      console.warn('[ChatGPT window] navigation timed out; continuing with the live window', {
        label,
        targetUrl,
        currentUrl: win.webContents.getURL()
      });
      return false;
    }
    if (!isRecoveredChatGptNavigationAbort(error, win.webContents.getURL())) throw error;
    console.info('[ChatGPT window] navigation was superseded and recovered', {
      label,
      targetUrl,
      currentUrl: win.webContents.getURL()
    });
    await sleep(500);
    return false;
  }
}

interface ChatGptPageProbe {
  url: string;
  title: string;
  bodyTextLength: number;
  htmlLength: number;
  loginSurface: boolean;
  composerReady: boolean;
  challengeVisible: boolean;
  probeFailed?: boolean;
}

const chatGptPageProbeScript = `(() => {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const controls = [...document.querySelectorAll('button, a, input, textarea, [role="button"], [role="textbox"], [contenteditable="true"]')].filter(visible);
  const text = (element) => [
    element.textContent || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('placeholder') || '',
    element.getAttribute('data-testid') || ''
  ].join(' ').toLowerCase();
  const loginSurface = controls.some((element) => {
    if (element.closest('[data-message-author-role], [data-testid^="conversation-turn"], [data-turn]')) return false;
    if (!element.matches('button, [role="button"], a[href*="/auth/"], input[type="email"], input[type="password"]')) return false;
    if (element.matches('input[type="email"], input[type="password"]')) return true;
    const label = (element.getAttribute('aria-label') || element.textContent || '').trim();
    return /^(log in|sign in|sign up|continue with google|continue with microsoft|登录|注册|使用 google)$/i.test(label);
  });
  const composerReady = controls.some((element) => {
    const value = text(element);
    return element.matches('textarea, [role="textbox"], [contenteditable="true"]') &&
      !/email|password|verification|验证码|密码/.test(value);
  });
  const challengePattern = /verify (?:that )?you are human|checking your browser|performing security verification|正在进行安全验证|验证您不是|验证您是真人|正在验证|确认您是真人/i;
  const challengeComponent = [...document.querySelectorAll('#challenge-stage, #challenge-running, #challenge-form, .cf-turnstile, iframe[src*="challenges.cloudflare.com"]')].some(visible);
  const challengeDialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
    .filter(visible).some((element) => challengePattern.test(element.innerText || ''));
  const challengeVisible = challengeComponent || challengeDialog || (!composerReady &&
    challengePattern.test(document.body?.innerText || ''));
  return {
    url: location.href,
    title: document.title || '',
    bodyTextLength: (document.body?.innerText || '').trim().length,
    htmlLength: document.documentElement?.outerHTML?.length || 0,
    loginSurface,
    composerReady,
    challengeVisible
  };
})()`;

async function probeChatGptPage(webContents: ChatGptWebContentsLike) {
  return evalInPageWithTimeout<ChatGptPageProbe>(webContents, chatGptPageProbeScript, 5000).catch(() => ({
    url: webContents.getURL(),
    title: '',
    bodyTextLength: 0,
    htmlLength: 0,
    loginSurface: false,
    composerReady: false,
    challengeVisible: false,
    probeFailed: true
  }));
}

async function observeChatGptManualIntervention(webContents: ChatGptWebContentsLike) {
  const probe = await probeChatGptPage(webContents);
  const health = assessChatGptPageHealth(probe);
  if (health.manualIntervention) {
    chatGptChromeLoginInterventionActive = true;
    if (!chatGptManualVerificationRequired) {
      await loadChatGptRuntimeState();
      chatGptManualVerificationRequired = true;
      chatGptProtectionState = transitionChatGptProtectionState(chatGptProtectionState, 'detected', 3).state;
      await persistChatGptRuntimeState();
      await appendChatGptAutomationDiagnostic('manual-verification-paused', { stage: 'page-guard', errorClass: 'manual-verification' });
    }
  }
  return { probe, health };
}

async function assertChatGptPageOperationAllowed(webContents: ChatGptWebContentsLike) {
  if (classifyChatGptNavigation(webContents.getURL()) === 'external') return;
  await loadChatGptRuntimeState();
  if (chatGptManualVerificationRequired) throw new ChatGptProtectionPausedError(chatGptManualVerificationMessage);
  const { probe, health } = await observeChatGptManualIntervention(webContents);
  if (health.manualIntervention || chatGptManualVerificationRequired) {
    throw new ChatGptProtectionPausedError(chatGptManualVerificationMessage);
  }
  if (chatGptProtectionState.phase === 'PROTECTION_PAUSED') {
    throw new ChatGptProtectionPausedError('ChatGPT 访问保护仍在暂停中，请先检查恢复。');
  }
  if (probe.probeFailed) throw new Error('无法确认 ChatGPT 页面状态，本轮不会操作页面。');
}

function installChatGptInteractionGuard(webContents: ChatGptWebContentsLike) {
  if (chatGptGuardedContents.has(webContents)) return;
  chatGptGuardedContents.add(webContents);
  const sendCommand = webContents.debugger.sendCommand.bind(webContents.debugger);
  webContents.debugger.sendCommand = async (method, params) => {
    if (/^Input\.|^DOM\.setFileInputFiles$|^Page\.(reload|navigate)$|^Network\.clearBrowserCache$/.test(method)) {
      await assertChatGptPageOperationAllowed(webContents);
    }
    return sendCommand(method, params);
  };
}

async function confirmChatGptManualPagesReady(webContents: ChatGptWebContentsLike) {
  const pages = [...new Set([webContents, ...[chatGptWindow, ...chatGptTaskTabs]
    .filter((win): win is ChatGptWindowLike => Boolean(win && !win.isDestroyed()))
    .map(win => win.webContents)])];
  const urls = pages.map(page => page.getURL());
  for (let sample = 0; sample < 2; sample++) {
    if (sample) await sleep(1000);
    for (const [index, page] of pages.entries()) {
      if (classifyChatGptNavigation(page.getURL()) === 'external') continue;
      const { probe, health } = await observeChatGptManualIntervention(page);
      if (probe.probeFailed || health.manualIntervention || !health.composerReady ||
          page.isLoading() || urls[index] !== page.getURL()) return false;
    }
  }
  return true;
}

async function waitForUsableChatGptSurface(win: ChatGptWindowLike, timeoutMs = 18000) {
  const startedAt = Date.now();
  let lastProbe: ChatGptPageProbe | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const observed = await observeChatGptManualIntervention(win.webContents);
    lastProbe = observed.probe;
    const health = observed.health;
    if (health.usable || health.manualIntervention) return { probe: lastProbe, health };
    await sleep(600);
  }
  return {
    probe: lastProbe,
    health: assessChatGptPageHealth(lastProbe || { url: win.webContents.getURL() })
  };
}

async function reloadChatGptIgnoringHttpCache(win: ChatGptWindowLike, label: string) {
  await assertChatGptPageOperationAllowed(win.webContents);
  const chatGptDebugger = win.webContents.debugger;
  let attachedHere = false;
  try {
    if (!chatGptDebugger.isAttached()) {
      chatGptDebugger.attach('1.3');
      attachedHere = true;
    }
    await withTimeout(
      chatGptDebugger.sendCommand('Network.enable'),
      5000,
      `ChatGPT 网络调试初始化超时（${label}）`
    );
    await withTimeout(
      chatGptDebugger.sendCommand('Network.clearBrowserCache'),
      5000,
      `ChatGPT 缓存清理超时（${label}）`
    );
    await withTimeout(
      chatGptDebugger.sendCommand('Page.reload', { ignoreCache: true }),
      5000,
      `ChatGPT 强制重载超时（${label}）`
    );
    console.info('[ChatGPT window] HTTP cache cleared and page reloaded', { label });
    return true;
  } catch (error) {
    console.warn(
      '[ChatGPT window] cache-bypass reload failed',
      label,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  } finally {
    if (attachedHere && chatGptDebugger.isAttached()) {
      try {
        chatGptDebugger.detach();
      } catch {
        // The page may have closed while the recovery reload was starting.
      }
    }
  }
}

const advanceGoogleLoginScript = `(() => {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const controls = [...document.querySelectorAll('button, a, [role="button"]')].filter(visible);
  const text = (element) => [
    element.textContent || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('title') || ''
  ].join(' ').replace(/\\s+/g, ' ').trim().toLowerCase();
  if (location.hostname === 'accounts.google.com') return { stage: 'google-page', clicked: false };
  const cookieChoice =
    controls.find((element) => /^(reject non-essential|reject all|拒绝非必需|仅使用必要 cookie)$/.test(text(element))) ||
    controls.find((element) => /^(accept all|全部接受)$/.test(text(element)));
  if (cookieChoice) {
    const box = cookieChoice.getBoundingClientRect();
    return { stage: 'cookie-target', clicked: false, x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  const google = controls.find((element) => /continue with google|使用 google|通过 google|google 账号|google 账户/.test(text(element)));
  if (google) {
    const box = google.getBoundingClientRect();
    return { stage: 'google-target', clicked: false, x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  const loginDialog = [...document.querySelectorAll('dialog, [role="dialog"]')]
    .filter(visible)
    .find((element) => /log in|login|sign in|sign up|google|apple|phone|email|登录|注册|手机号/.test(text(element)));
  if (loginDialog) return { stage: 'login-surface', clicked: false };
  const explicitLogin = document.querySelector('button[data-testid="login-button"], a[data-testid="login-button"]');
  const login =
    (explicitLogin && visible(explicitLogin) ? explicitLogin : undefined) ||
    controls.find((element) => /^(log in|login|sign in|登录|登陆)$/.test(text(element)));
  if (login) {
    const box = login.getBoundingClientRect();
    return { stage: 'login-target', clicked: false, x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  return { stage: 'waiting', clicked: false };
})()`;

interface DedicatedChromeLoginTarget {
  stage: 'google-page' | 'google-target' | 'login-surface' | 'login-target' | 'cookie-target' | 'waiting' | 'script-wait';
  clicked: boolean;
  x?: number;
  y?: number;
}

async function dispatchTrustedChatGptClick(
  webContents: ChatGptWebContentsLike,
  target: Pick<DedicatedChromeLoginTarget, 'x' | 'y'>
) {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
  const x = target.x as number;
  const y = target.y as number;
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1
  });
  await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1
  });
  return true;
}

async function driveDedicatedChromeLogin(
  win: ChatGptWindowLike,
  options: { selectGoogle: boolean; timeoutMs: number }
) {
  const startedAt = Date.now();
  let lastStage = 'waiting';
  while (Date.now() - startedAt < options.timeoutMs && !win.isDestroyed()) {
    const currentUrl = win.webContents.getURL();
    if (classifyChatGptNavigation(currentUrl) === 'google-oauth') return true;
    const result = await evalInPageWithTimeout<DedicatedChromeLoginTarget>(
      win.webContents,
      advanceGoogleLoginScript,
      5000
    ).catch(() => ({ stage: 'script-wait', clicked: false }) as DedicatedChromeLoginTarget);
    lastStage = result.stage;
    if (result.stage === 'google-page') return true;
    if (!options.selectGoogle && (result.stage === 'google-target' || result.stage === 'login-surface')) {
      return true;
    }
    const shouldClick =
      result.stage === 'cookie-target' ||
      result.stage === 'login-target' ||
      (options.selectGoogle && result.stage === 'google-target');
    const clicked = shouldClick
      ? await dispatchTrustedChatGptClick(win.webContents, result).catch(() => false)
      : false;
    await sleep(clicked ? 1100 : 650);
  }
  return lastStage === 'google-page' || lastStage === 'google-target' || lastStage === 'login-surface';
}

async function openDedicatedChromeLoginSurface(win: ChatGptWindowLike) {
  return driveDedicatedChromeLogin(win, { selectGoogle: false, timeoutMs: 12000 });
}

async function advanceDedicatedChromeToGoogleLogin(win: ChatGptWindowLike) {
  const reachedGoogle = await driveDedicatedChromeLogin(win, { selectGoogle: true, timeoutMs: 30000 });
  if (reachedGoogle) return true;
  console.warn('[ChatGPT login] dedicated Chrome did not reach Google login automatically');
  return false;
}

async function switchEmbeddedGoogleLoginToChrome(sourceWindow: ChatGptWindowLike, _interceptedUrl: string) {
  if (googleLoginSwitchInProgress || isAppQuitting) return;
  googleLoginSwitchInProgress = true;
  try {
    await persistChatGptBrowserBackend('chrome');
    if (chatGptWindowReadyPromise) {
      await Promise.race([chatGptWindowReadyPromise.catch(() => undefined), sleep(3500)]);
    }
    await releaseChatGptWindow(sourceWindow);
    const chromeWindow = await getChatGptWindow('https://chatgpt.com/', 'chrome', 'visible');
    chatGptChromeLoginInterventionActive = true;
    chromeWindow.show();
    chromeWindow.focus();
    const surface = await waitForUsableChatGptSurface(chromeWindow, 18000);
    if (!surface.health.usable) await recoverChatGptSurface(chromeWindow, 'https://chatgpt.com/', 'inspection', surface);
    await advanceDedicatedChromeToGoogleLogin(chromeWindow);
  } catch (error) {
    console.error(
      '[ChatGPT login] failed to switch Google login to dedicated Chrome',
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    googleLoginSwitchInProgress = false;
  }
}

function getChatGptSession() {
  const chatGptSession = session.fromPartition(chatGptPartition, { cache: true });
  if (!chatGptSessionConfigured) {
    chatGptSessionConfigured = true;
    chatGptSession.setUserAgent(getStableChatGptUserAgent(chatGptSession.getUserAgent()), 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
    chatGptSession.setPermissionRequestHandler((webContents, permission, callback) => {
      try {
        const origin = new URL(webContents.getURL() || 'https://chatgpt.com/').origin;
        const trustedOrigin = origin === 'https://chatgpt.com' || origin.endsWith('.openai.com');
        callback(trustedOrigin && permission === 'clipboard-sanitized-write');
      } catch {
        callback(false);
      }
    });
    console.info('[ChatGPT session] configured persistent browser profile', {
      userData: appDataDir(),
      sessionData: app.getPath('sessionData'),
      partition: chatGptPartition,
      persistent: chatGptSession.isPersistent(),
      userAgent: getStableChatGptUserAgent(chatGptSession.getUserAgent())
    });
  }
  return chatGptSession;
}

function getStableChatGptUserAgent(rawUserAgent: string) {
  return rawUserAgent
    .replace(/\sElectron\/[\d.]+/g, '')
    .replace(/\s像锚\/[\d.]+/g, '')
    .trim();
}

async function persistChatGptPageStorage(webContents: ChatGptWebContentsLike) {
  try {
    if (chatGptManualVerificationRequired ||
        (await observeChatGptManualIntervention(webContents)).health.manualIntervention) return;
    const result = await evalInPageWithTimeout(
      webContents,
      `Promise.resolve((async () => {
        const persistedBefore = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
        const persistedAfter = navigator.storage?.persist ? await navigator.storage.persist().catch(() => false) : persistedBefore;
        const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
        try { localStorage.setItem('xiangmao_chatgpt_profile_keepalive', String(Date.now())); } catch {}
        return { persistedBefore, persistedAfter, estimate };
      })())`,
      chatGptStorageTimeoutMs
    );
    console.info('[ChatGPT session] page storage persistence requested', result);
  } catch (error) {
    console.warn('[ChatGPT session] page storage persistence request failed', error instanceof Error ? error.message : String(error));
  }
}

async function flushChatGptSessionStorage() {
  const chatGptSession = getChatGptSession();
  try {
    chatGptSession.flushStorageData();
  } catch (error) {
    console.warn('[ChatGPT session] DOM storage flush failed', error instanceof Error ? error.message : String(error));
  }
  try {
    await withTimeout(
      chatGptSession.cookies.flushStore(),
      chatGptStorageTimeoutMs,
      `ChatGPT Cookie 写入超时（${chatGptStorageTimeoutMs}ms）`
    );
  } catch (error) {
    console.warn('[ChatGPT session] cookie flush failed', error instanceof Error ? error.message : String(error));
  }
}

async function flushChatGptSessionBeforeQuit() {
  if (chatGptKeepAliveTimer) {
    clearInterval(chatGptKeepAliveTimer);
    chatGptKeepAliveTimer = null;
  }
  if (chatGptWindow && !chatGptWindow.isDestroyed()) {
    try {
      await Promise.race([persistChatGptPageStorage(chatGptWindow.webContents), sleep(3500)]);
    } catch {
      // Storage persistence is best-effort during shutdown.
    }
  }
  if (chatGptWindowBackend === 'chrome') await releaseChatGptWindow();
  await Promise.race([flushChatGptSessionStorage(), sleep(3500)]);
  await sleep(350);
}

async function keepChatGptSessionWarm(url: string) {
  if (chatGptManualVerificationRequired) return;
  const targetUrl = url || 'https://chatgpt.com/';
  const backend = resolveChatGptBrowserBackend();
  if (
    backend === 'chrome' &&
    chatGptChromeLoginInterventionActive &&
    chatGptWindow?.mode === 'visible' &&
    !chatGptWindow.isDestroyed()
  ) {
    return;
  }
  try {
    const win = await getChatGptWindow(targetUrl, backend, 'background');
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 12000);
        win.webContents.once('did-finish-load', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    await evalInPageWithTimeout(
      win.webContents,
      `(() => ({ href: location.href, title: document.title, at: Date.now(), storage: Boolean(window.localStorage) }))()`,
      chatGptStorageTimeoutMs
    )
      .catch(() => null);
    await persistChatGptPageStorage(win.webContents);
    keepChatGptWindowInBackground(win);
    if (backend === 'embedded') await flushChatGptSessionStorage();
    console.info('[ChatGPT session] persistent profile warmed', {
      userData: appDataDir(),
      backend,
      url: win.webContents.getURL()
    });
  } catch (error) {
    console.warn('[ChatGPT session] keep-alive failed', error instanceof Error ? error.message : String(error));
  }
}

function shouldMaintainChatGptSession(settings: Partial<AppSettings>) {
  if (settings.chatGptKeepAliveEnabled === false) return false;
  const webAiProvider = normalizeWebAiProvider(settings.webAiProvider);
  const generationProvider = normalizeGenerationProvider(settings.generationProvider, webAiProvider);
  const analysisProvider = normalizeAnalysisProvider(settings.apiProvider);
  return generationProvider === 'chatgpt' || analysisProvider === 'chatgpt';
}

function configureChatGptPersistence(settings: Partial<AppSettings>, warmNow = false) {
  cachedSettings = { ...cachedSettings, ...settings };
  if (chatGptKeepAliveTimer) {
    clearInterval(chatGptKeepAliveTimer);
    chatGptKeepAliveTimer = null;
  }
  if (!shouldMaintainChatGptSession(settings)) {
    destroyAppTray();
    return;
  }

  const url = settings.chatGptUrl || 'https://chatgpt.com/';
  ensureAppTray();
  if (resolveChatGptBrowserBackend(settings.chatGptBrowserBackend) === 'embedded') {
    void flushChatGptSessionStorage();
  }
  if (warmNow) {
    setTimeout(() => {
      void keepChatGptSessionWarm(url);
    }, 2500);
  }
  chatGptKeepAliveTimer = setInterval(() => {
    void keepChatGptSessionWarm(url);
  }, chatGptKeepAliveMs);
  chatGptKeepAliveTimer.unref?.();
}

function keepChatGptWindowInBackground(win: ChatGptWindowLike) {
  if (chatGptManualVerificationRequired) return;
  if (
    chatGptWindowBackend === 'chrome' &&
    win.isVisible() &&
    chatGptChromeLoginInterventionActive
  ) {
    return;
  }
  try {
    win.setFocusable(false);
  } catch {
    // Some platforms may reject focusability changes; background operation still continues through webContents.
  }
  try {
    if (win.isVisible()) win.hide();
  } catch {
    // Best-effort: the automation uses webContents and does not require foreground focus.
  }
}

function isChatGptKeepAliveEnabled() {
  return cachedSettings.chatGptKeepAliveEnabled !== false;
}

function getTrayIconPath() {
  const portableIcons = [
    path.join(__dirname, '../../dist/xiangmao.ico'),
    path.join(process.cwd(), 'public/xiangmao.ico'),
    path.join(process.cwd(), 'build/icon.ico'),
    path.join(__dirname, '../../dist/xiangmao-tray.png'),
    path.join(process.cwd(), 'public/xiangmao-tray.png')
  ];
  const iconCandidates = process.platform === 'darwin'
    ? [
        path.join(process.resourcesPath, 'xiangmao-tray.png'),
        path.join(__dirname, '../../dist/xiangmao-tray.png'),
        path.join(process.cwd(), 'public/xiangmao-tray.png'),
        ...portableIcons
      ]
    : [path.join(process.resourcesPath, 'icon.ico'), ...portableIcons];

  for (const iconPath of iconCandidates) {
    if (!fsSync.existsSync(iconPath)) continue;
    return iconPath;
  }
  return undefined;
}

function getTrayIcon() {
  const iconPath = getTrayIconPath();
  if (iconPath) return iconPath;

  const trayImage = nativeImage.createFromDataURL(`data:image/png;base64,${trayPngBase64}`);
  if (!trayImage.isEmpty()) return trayImage.resize({ width: 16, height: 16, quality: 'best' });

  const fallbackImage = nativeImage.createFromDataURL(`data:image/png;base64,${tinyPngBase64}`);
  return fallbackImage.resize({ width: 16, height: 16, quality: 'best' });
}

function ensureAppTray() {
  if (appTray && !appTray.isDestroyed()) {
    appTray.setImage(getTrayIcon());
    return appTray;
  }
  appTray = new Tray(getTrayIcon());
  appTray.setToolTip('像锚 - 正在后台保留 ChatGPT 登录');
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开像锚',
        click: () => {
          void restoreMainWindowFromTray();
        }
      },
      {
        label: '查看 ChatGPT 自动窗口',
        click: () => {
          void showChatGptWindowForInspection(
            cachedSettings.chatGptUrl || 'https://chatgpt.com/',
            cachedSettings.chatGptOpenMode,
            cachedSettings.chatGptBrowserBackend
          );
        }
      },
      { type: 'separator' },
      {
        label: '完全退出',
        click: () => {
          isAppQuitting = true;
          app.quit();
        }
      }
    ])
  );
  appTray.on('double-click', () => {
    void restoreMainWindowFromTray();
  });
  return appTray;
}

function destroyAppTray() {
  if (!appTray || appTray.isDestroyed()) return;
  appTray.destroy();
  appTray = null;
}

async function restoreMainWindowFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindowToTray(win: BrowserWindow) {
  ensureAppTray();
  win.hide();
  void keepChatGptSessionWarm(cachedSettings.chatGptUrl || 'https://chatgpt.com/');
}

function revealChatGptWindowForIntervention(win: ChatGptWindowLike) {
  if (chatGptWindowBackend === 'chrome') chatGptChromeLoginInterventionActive = true;
  try {
    win.setFocusable(true);
  } catch {
    // The user can still use the Chrome fallback if the automatic window cannot become focusable.
  }
  try {
    if (win.isMinimized()) win.restore();
    win.showInactive();
    win.flashFrame(true);
  } catch {
    // Revealing is only for recoverable login / structure-change situations.
  }
}

async function showAndConfirmChatGptWindow(win: ChatGptWindowLike) {
  try {
    win.setFocusable(true);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.flashFrame(false);
    if (!win.waitForVisibility) return true;
    return await withTimeout(
      win.waitForVisibility(),
      12000,
      '专属 Chrome 原生窗口显示确认超时'
    );
  } catch {
    return false;
  }
}

function chatGptWindowDiagnosticSnapshot(win?: ChatGptWindowLike | null) {
  if (!win) {
    return {
      backend: chatGptWindowBackend || 'none',
      browser: 'none',
      mode: 'none',
      visible: false,
      minimized: false,
      destroyed: true,
      url: ''
    };
  }
  return {
    backend: chatGptWindowBackend || 'none',
    browser: win.browserLabel || 'embedded',
    mode: win.mode || 'background',
    visible: !win.isDestroyed() && win.isVisible(),
    minimized: !win.isDestroyed() && win.isMinimized(),
    destroyed: win.isDestroyed(),
    url: win.isDestroyed() ? '' : win.webContents.getURL()
  };
}

async function recoverChatGptSurface(
  win: ChatGptWindowLike,
  url: string,
  scope: 'inspection' | 'login-check',
  initialSurface: Awaited<ReturnType<typeof waitForUsableChatGptSurface>>,
  maxAttempts = 1
) {
  let surface = initialSurface;
  let attempts = 0;
  if (surface.health.manualIntervention || isChatGptAuthenticationUrl(win.webContents.getURL())) {
    return { surface, attempts };
  }
  if (chatGptManualVerificationRequired || !surface.health.blank ||
      win.webContents.isLoading() || chatGptSurfaceRecoveryAttempted.has(win.webContents)) return { surface, attempts };
  chatGptSurfaceRecoveryAttempted.add(win.webContents);
  for (let attempt = 1; attempt <= Math.min(1, maxAttempts) && !surface.health.usable; attempt += 1) {
    if (classifyChatGptNavigation(win.webContents.getURL()) === 'google-oauth') break;
    attempts = attempt;
    if (scope === 'login-check') keepChatGptWindowInBackground(win);
    await appendChatGptAutomationDiagnostic('chatgpt-surface-recovery-started', {
      scope,
      attempt,
      maxAttempts,
      ...chatGptWindowDiagnosticSnapshot(win)
    });
    if (attempt > 1) await sleep(400 * attempt);
    const reloaded =
      attempt === 1
        ? await reloadChatGptIgnoringHttpCache(win, `${scope}-blank-recovery`)
        : false;
    if (!reloaded) break;
    surface = await waitForUsableChatGptSurface(win, attempt === 1 ? 9000 : 14000);
    await appendChatGptAutomationDiagnostic('chatgpt-surface-recovery-finished', {
      scope,
      attempt,
      usable: surface.health.usable,
      blank: surface.health.blank,
      ...chatGptWindowDiagnosticSnapshot(win)
    });
  }
  return { surface, attempts };
}

async function showChatGptWindowForInspection(
  url: string,
  openMode?: AppSettings['chatGptOpenMode'],
  requestedBackend?: ChatGptBrowserBackend
): Promise<ChatGptWindowActionResult> {
  const backend = resolveChatGptBrowserBackend(requestedBackend);
  // Viewing a live page must never restart or navigate away from a login challenge.
  if (!shouldUseExternalChatGpt(openMode) && chatGptWindow && !chatGptWindow.isDestroyed()) {
    const candidates = [...chatGptTaskTabs, chatGptWindow].filter(win => !win.isDestroyed());
    let selected = chatGptWindow;
    for (const candidate of candidates) {
      const { health } = await observeChatGptManualIntervention(candidate.webContents);
      if (health.manualIntervention) { selected = candidate; break; }
    }
    chatGptVerifiedConfigByPage.delete(selected.webContents as object);
    const visible = await showAndConfirmChatGptWindow(selected);
    chatGptChromeLoginInterventionActive = true;
    return { ok: visible, message: chatGptManualVerificationRequired ? chatGptManualVerificationMessage :
      '已显示专属 Chrome 当前页面，没有刷新或切换对话。', url: selected.webContents.getURL(), backend, recoveryAvailable: false };
  }
  if (shouldUseExternalChatGpt(openMode)) {
    await openChromeFallback(url || 'https://chatgpt.com/');
    return {
      ok: true,
      message: '已打开 Chrome / 默认浏览器中的 ChatGPT。这个模式会复用浏览器自己的登录状态。',
      url: url || 'https://chatgpt.com/',
      backend
    };
  }
  if (chatGptAutomationRunning || chatGptAnalysisRunning) {
    const activeWindow = chatGptWindow && !chatGptWindow.isDestroyed()
      ? chatGptWindow
      : chatGptWindowReadyPromise
        ? await Promise.race([chatGptWindowReadyPromise.catch(() => null), sleep(12_000).then(() => null)])
        : null;
    if (!activeWindow || activeWindow.isDestroyed()) {
      return {
        ok: false,
        message: 'ChatGPT 自动任务正在准备窗口，请稍候再点“查看窗口”。当前任务不会被中断。',
        backend,
        recoveryAvailable: false,
        recoveryReason: 'automation-window-starting'
      };
    }
    chatGptVerifiedConfigByPage.delete(activeWindow.webContents as object);
    if (backend === 'chrome') chatGptChromeLoginInterventionActive = true;
    const confirmedVisible = await showAndConfirmChatGptWindow(activeWindow);
    return {
      ok: confirmedVisible,
      message: confirmedVisible
        ? '已显示正在运行的专属 Chrome；软件没有刷新或切换当前任务页面。'
        : '自动任务仍在后台运行，但系统暂未确认窗口可见。请稍后再次点击“查看窗口”。',
      error: confirmedVisible ? undefined : '系统暂未确认专属 Chrome 窗口可见。',
      url: activeWindow.webContents.getURL(),
      backend,
      recoveryAvailable: !confirmedVisible,
      recoveryReason: confirmedVisible ? undefined : 'automation-window-not-visible'
    };
  }
  let win: ChatGptWindowLike;
  try {
    win = await getChatGptWindow(
      url || 'https://chatgpt.com/',
      backend,
      'visible'
    );
  } catch (error) {
    const message = describeChatGptWindowFailure(error, 'open');
    console.warn('[ChatGPT window] inspection open failed', error instanceof Error ? error.message : String(error));
    await appendChatGptAutomationDiagnostic('inspection-open-failed', {
      backend,
      message: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      message,
      error: message,
      backend,
      recoveryAvailable: true,
      recoveryReason: 'inspection-open-failed',
      recoveryAttempts: 1
    };
  }
  chatGptVerifiedConfigByPage.delete(win.webContents as object);
  const inspection = await observeChatGptManualIntervention(win.webContents);
  if (inspection.health.manualIntervention || chatGptManualVerificationRequired) {
    const visible = await showAndConfirmChatGptWindow(win);
    return { ok: visible, message: chatGptManualVerificationMessage, url: win.webContents.getURL(), backend, recoveryAvailable: false };
  }
  if (backend === 'chrome') chatGptChromeLoginInterventionActive = true;
  let windowVisible = await showAndConfirmChatGptWindow(win);
  if (backend === 'chrome' && !windowVisible) {
    await appendChatGptAutomationDiagnostic('chrome-window-reveal-failed', {
      browser: win.browserLabel || 'unknown',
      url: win.webContents.getURL(),
      recovery: 'restart-visible'
    });
    try {
      await releaseChatGptWindow(win);
      win = await getChatGptWindow(url || 'https://chatgpt.com/', 'chrome', 'visible');
      chatGptChromeLoginInterventionActive = true;
      windowVisible = await showAndConfirmChatGptWindow(win);
    } catch (error) {
      const message = describeChatGptWindowFailure(error, 'open');
      await appendChatGptAutomationDiagnostic('chrome-window-reveal-restart-failed', {
        message: error instanceof Error ? error.message : String(error)
      });
      return {
        ok: false,
        message,
        error: message,
        backend,
        recoveryAvailable: true,
        recoveryReason: 'window-reveal-restart-failed',
        recoveryAttempts: 2
      };
    }
  }
  if (backend === 'chrome' && !windowVisible) {
    const message = '专属 Chrome 已启动，但系统没有确认窗口成功显示。软件已完成一次可见模式重启，请再次点击“查看窗口”。';
    return {
      ok: false,
      message,
      error: message,
      url: win.webContents.getURL(),
      backend,
      recoveryAvailable: true,
      recoveryReason: 'window-not-visible',
      recoveryAttempts: 2
    };
  }
  await ensureChatGptWindowUrl(win, url || 'https://chatgpt.com/');
  if (backend === 'chrome' && classifyChatGptNavigation(win.webContents.getURL()) === 'google-oauth') {
    chatGptChromeLoginInterventionActive = true;
    void monitorDedicatedChromeLogin(win);
    const confirmedVisible = await showAndConfirmChatGptWindow(win);
    const message = confirmedVisible
      ? 'Google 登录页面已打开。登录期间软件不会刷新、探测或隐藏此页面。'
      : 'Google 登录页面已载入，但系统未确认窗口可见；请再次点击“查看窗口”。';
    return {
      ok: confirmedVisible,
      message,
      error: confirmedVisible ? undefined : message,
      url: win.webContents.getURL(),
      backend,
      recoveryAvailable: !confirmedVisible,
      recoveryReason: confirmedVisible ? undefined : 'google-login-window-not-visible',
      recoveryAttempts: confirmedVisible ? 0 : 2
    };
  }
  let surface = await waitForUsableChatGptSurface(win, 7000);
  if (surface.health.manualIntervention || chatGptManualVerificationRequired) {
    const visible = await showAndConfirmChatGptWindow(win);
    return { ok: visible, message: chatGptManualVerificationMessage, url: win.webContents.getURL(), backend, recoveryAvailable: false };
  }
  if (!surface.health.usable) {
    const recovered = await recoverChatGptSurface(
      win,
      url || 'https://chatgpt.com/',
      'inspection',
      surface
    );
    surface = recovered.surface;
  }
  if (surface.health.manualIntervention || chatGptManualVerificationRequired) {
    const visible = await showAndConfirmChatGptWindow(win);
    return { ok: visible, message: chatGptManualVerificationMessage, url: win.webContents.getURL(), backend, recoveryAvailable: false };
  }
  if (!surface.health.usable) {
    const message = '专属 Chrome 已显示，但 ChatGPT 页面仍在加载或网络异常。请在窗口中确认页面状态后重试。';
    return {
      ok: false,
      message,
      error: message,
      url: win.webContents.getURL(),
      backend,
      recoveryAvailable: true,
      recoveryReason: 'chatgpt-surface-unusable',
      recoveryAttempts: 2
    };
  }
  if (backend === 'chrome') {
    const loginState = await evalInPageWithTimeout<ChatGptComposerProbeState>(
      win.webContents,
      composerProbeScript(true),
      6500
    ).catch(() => undefined);
    if (isConfirmedChatGptLogout(loginState)) {
      await openDedicatedChromeLoginSurface(win).catch(() => false);
    }
    void monitorDedicatedChromeLogin(win);
  }
  try {
    const confirmedVisible = await showAndConfirmChatGptWindow(win);
    if (backend === 'chrome' && !confirmedVisible) {
      const message = '专属 Chrome 页面已恢复，但系统没有确认窗口成功显示。请再次点击“查看窗口”自动重试。';
      return {
        ok: false,
        message,
        error: message,
        url: win.webContents.getURL(),
        backend,
        recoveryAvailable: true,
        recoveryReason: 'window-confirmation-failed',
        recoveryAttempts: 2
      };
    }
    return {
      ok: true,
      message: backend === 'chrome' ? '像锚专属 Chrome 已显示。' : 'ChatGPT 自动窗口已显示。',
      url: win.webContents.getURL(),
      backend,
      recoveryAvailable: false,
      recoveryAttempts: 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '显示 ChatGPT 自动窗口失败。';
    return {
      ok: false,
      message: describeChatGptWindowFailure(error, 'open'),
      error: message,
      url: win.webContents.getURL(),
      backend,
      recoveryAvailable: true,
      recoveryReason: 'window-display-failed',
      recoveryAttempts: 2
    };
  }
}

async function recoverChatGptWindowForInspection(
  url: string,
  openMode?: AppSettings['chatGptOpenMode'],
  requestedBackend?: ChatGptBrowserBackend
): Promise<ChatGptWindowActionResult> {
  const backend = resolveChatGptBrowserBackend(requestedBackend);
  const targetUrl = url || 'https://chatgpt.com/';
  if (chatGptAutomationRunning || chatGptAnalysisRunning) {
    return {
      ok: false,
      message: 'ChatGPT 自动任务正在运行。为避免关闭任务标签页，恢复操作已暂停；任务结束后可再次点击“恢复窗口”。',
      backend,
      recoveryAvailable: true,
      recoveryReason: 'automation-active',
      recoveryAttempts: 0
    };
  }
  const current = chatGptWindow;
  if (current && !current.isDestroyed()) {
    await observeChatGptManualIntervention(current.webContents);
    if (chatGptManualVerificationRequired) return showChatGptWindowForInspection(targetUrl, openMode, backend);
  }
  if (
    backend === 'chrome' &&
    current &&
    !current.isDestroyed() &&
    classifyChatGptNavigation(current.webContents.getURL()) === 'google-oauth'
  ) {
    await appendChatGptAutomationDiagnostic('window-recovery-preserved-google-login', {
      ...chatGptWindowDiagnosticSnapshot(current)
    });
    return showChatGptWindowForInspection(targetUrl, openMode, backend);
  }

  await appendChatGptAutomationDiagnostic('window-recovery-started', {
    attempt: 1,
    maxAttempts: 1,
    requestedBackend: backend,
    ...chatGptWindowDiagnosticSnapshot(chatGptWindow)
  });
  if (chatGptWindow && !chatGptWindow.isDestroyed()) {
    await releaseChatGptWindow(chatGptWindow);
  }
  const result = await showChatGptWindowForInspection(targetUrl, openMode, backend);
  if (chatGptManualVerificationRequired) return result;
  await appendChatGptAutomationDiagnostic('window-recovery-finished', {
    attempt: 1,
    ok: result.ok,
    reason: result.recoveryReason || '',
    ...chatGptWindowDiagnosticSnapshot(chatGptWindow)
  });
  return {
    ...result,
    recoveryAvailable: !result.ok,
    recoveryReason: result.ok ? undefined : result.recoveryReason || 'window-recovery-exhausted',
    recoveryAttempts: 1
  };
}

async function ensureChatGptWindowUrl(win: ChatGptWindowLike, url: string) {
  const targetUrl = url || 'https://chatgpt.com/';
  const currentUrl = win.webContents.getURL();
  const navigationKind = classifyChatGptNavigation(currentUrl);
  const shouldReload = navigationKind === 'blank' || navigationKind === 'external';
  if (!shouldReload) return;
  try {
    await loadChatGptUrlRecoverably(win, targetUrl, 'ensure-window-url');
    await persistChatGptPageStorage(win.webContents);
  } catch (error) {
    if (isRecoveredChatGptNavigationAbort(error, win.webContents.getURL())) {
      console.info('[ChatGPT window] inspection navigation was superseded by an equivalent ChatGPT navigation');
      return;
    }
    console.warn('[ChatGPT window] reload before inspection failed', error instanceof Error ? error.message : String(error));
  }
}

function pageScript(fn: (...args: any[]) => any, ...args: any[]) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

interface ChatGptModelMenuSnapshot {
  triggerFound: boolean;
  currentModel: string;
  options: Array<{ label: string; current: boolean }>;
  requestedModel?: string;
  requestedAvailable?: boolean;
  selected?: boolean;
  confirmed?: boolean;
  trustedClickTarget?: { x: number; y: number };
}

function chatGptModelMenuScript(requestedModel = '') {
  return pageScript(async (requested: string, policy: typeof chatGptModelDomPolicy) => {
    const waitInPage = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const strongMarkerPattern = new RegExp(policy.strongMarkerPattern, 'i');
    const semanticMarkerPattern = new RegExp(policy.semanticMarkerPattern, 'i');
    const excludedMarkerPattern = new RegExp(policy.excludedMarkerPattern, 'i');
    const excludedOptionPattern = new RegExp(policy.excludedOptionPattern, 'i');
    const genericLabelPattern = new RegExp(policy.genericLabelPattern, 'i');
    const composerModePattern = new RegExp(policy.composerModePattern, 'i');
    const advancedMenuPattern = new RegExp(policy.advancedMenuPattern, 'i');
    const modelBranchPattern = new RegExp(policy.modelBranchPattern, 'i');
    const modelOptionPattern = new RegExp(policy.modelOptionPattern, 'i');
    const visible = (element: Element) => {
      if (element.closest('[inert], [aria-hidden="true"], [data-active="false"]')) return false;
      const box = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const normalized = (value: string) =>
      value
        .replace(/\s+/g, ' ')
        .replace(/(?:current model|当前模型|已选择|selected)/gi, '')
        .trim()
        .toLocaleLowerCase();
    const sameModel = (left: string, right: string) => {
      const identity = (value: string) => normalized(value).replace(/^(?:chatgpt|gpt)[-\s]?/i, '').trim();
      return Boolean(identity(left) && identity(right) && identity(left) === identity(right));
    };
    const textLinesOf = (element: Element) =>
      ((element as HTMLElement).innerText || element.textContent || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 2);
    const sanitizeModelLabel = (value: string) => {
      const cleaned = value
        .replace(/\s+/g, ' ')
        .replace(/^(?:model (?:selector|picker)|choose model|select model|模型选择器|选择模型)[,，:：\s-]*/i, '')
        .replace(/^(?:current model(?: is)?|当前模型(?:为|是)?)[,，:：\s-]*/i, '')
        .replace(/(?:[,，]\s*)?(?:open|打开).*(?:menu|菜单)$/i, '')
        .trim()
        .slice(0, 120);
      return !cleaned || genericLabelPattern.test(cleaned) ? '' : cleaned;
    };
    const labelOf = (element: Element) => {
      const visibleLabel = sanitizeModelLabel(textLinesOf(element)[0] || '');
      if (visibleLabel) return visibleLabel;
      return sanitizeModelLabel(element.getAttribute('aria-label') || element.getAttribute('title') || '');
    };
    const rawMarkerOf = (element: Element) => {
      const text = textLinesOf(element).join(' ');
      return `${element.getAttribute('data-testid') || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${text}`.toLocaleLowerCase();
    };
    const isModelLabel = (value: string) => modelOptionPattern.test(sanitizeModelLabel(value));
    const activateElement = (element: HTMLElement) => {
      const pointerDown: PointerEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      };
      const pointerUp: PointerEventInit = { ...pointerDown, buttons: 0 };
      const mouseDown: MouseEventInit = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, view: window };
      const mouseUp: MouseEventInit = { ...mouseDown, buttons: 0 };
      element.dispatchEvent(new PointerEvent('pointerdown', pointerDown));
      element.dispatchEvent(new MouseEvent('mousedown', mouseDown));
      element.focus({ preventScroll: true });
      element.dispatchEvent(new PointerEvent('pointerup', pointerUp));
      element.dispatchEvent(new MouseEvent('mouseup', mouseUp));
      element.dispatchEvent(new MouseEvent('click', mouseUp));
    };
    const hoverElement = (element: HTMLElement) => {
      const pointer: PointerEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      };
      const mouse: MouseEventInit = { bubbles: true, cancelable: true, composed: true, view: window };
      element.dispatchEvent(new PointerEvent('pointerover', pointer));
      element.dispatchEvent(new MouseEvent('mouseover', mouse));
      element.dispatchEvent(new PointerEvent('pointermove', pointer));
      element.dispatchEvent(new MouseEvent('mousemove', mouse));
    };
    const modelValueOf = (element: Element) => {
      const candidates = [
        ...textLinesOf(element),
        ...[...element.querySelectorAll('*')]
          .map((child) => (child.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
      ];
      return candidates.map(sanitizeModelLabel).find(isModelLabel) || '';
    };
    const closeMenus = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        await waitInPage(80);
      }
    };
    const menuRoots = () => [...document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-menu-content], [role="dialog"]')]
      .filter(visible) as HTMLElement[];
    const optionCandidatesFrom = (root: Element, modelOnly = false) => [...root.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button, [data-testid*="model"]')]
      .filter(visible)
      .filter((element) => element.matches('[role="menuitem"], [role="menuitemradio"], [role="option"], button') ||
        !element.querySelector('[role="menuitem"], [role="menuitemradio"], [role="option"], button'))
      .filter((element) => element.getAttribute('aria-haspopup') !== 'menu')
      .map((element) => {
        const label = labelOf(element);
        const marker = `${label} ${element.getAttribute('data-testid') || ''} ${element.getAttribute('aria-label') || ''}`.toLocaleLowerCase();
        const current =
          element.getAttribute('aria-checked') === 'true' ||
          element.getAttribute('aria-selected') === 'true' ||
          element.getAttribute('data-state') === 'checked' ||
          /current model|当前模型|selected|已选择/.test(marker);
        return { element: element as HTMLElement, label, current };
      })
      .filter((candidate) => candidate.label.length > 0 && candidate.label.length <= 120)
      .filter((candidate) => !excludedOptionPattern.test(candidate.label))
      .filter((candidate) => !modelOnly || isModelLabel(candidate.label));
    const uniqueOptions = (candidates: ReturnType<typeof optionCandidatesFrom>) => {
      const unique = new Map<string, (typeof candidates)[number]>();
      for (const candidate of candidates) {
        const key = normalized(candidate.label);
        if (key && !unique.has(key)) unique.set(key, candidate);
      }
      return [...unique.values()];
    };
    const scoreTrigger = (element: Element) => {
      const marker = rawMarkerOf(element);
      const box = element.getBoundingClientRect();
      const strong = strongMarkerPattern.test(marker);
      const semantic = semanticMarkerPattern.test(marker);
      const insideComposer = Boolean(element.closest('form, [data-testid*="composer"], [class*="composer"]'));
      const insideSidebar = Boolean(element.closest('#sidebar, [data-testid*="sidebar"], [class*="sidebar"]'));
      const excluded = insideSidebar || excludedMarkerPattern.test(marker);
      if (excluded || (!strong && (!semantic || !element.getAttribute('aria-haspopup')))) return -1;
      return (strong ? 220 : 100) + (element.getAttribute('aria-haspopup') ? 20 : 0) + (box.top < 220 ? 10 : 0) -
        (insideComposer && !strong ? 40 : 0);
    };
    const composerTriggers = () => [...document.querySelectorAll('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')]
      .filter(visible)
      .map((element) => {
        const marker = rawMarkerOf(element);
        const className = typeof (element as HTMLElement).className === 'string' ? (element as HTMLElement).className : '';
        const text = labelOf(element);
        const box = element.getBoundingClientRect();
        const insideComposer = Boolean(element.closest('form, [data-testid*="composer"], [class*="composer"]'));
        const insideSidebar = Boolean(element.closest('#sidebar, [data-testid*="sidebar"], [class*="sidebar"]'));
        const disabled = (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
        const composerPill = /(?:^|\s)__?composer-pill(?:\s|$)/i.test(className);
        const modeLabel = composerModePattern.test(text);
        const score = (modeLabel ? 240 : 0) + (composerPill ? 180 : 0) + (box.width <= 180 ? 20 : 0) + box.left / 10000;
        return { element: element as HTMLElement, marker, text, insideComposer, insideSidebar, disabled, score };
      })
      .filter((candidate) => candidate.insideComposer && !candidate.insideSidebar && !candidate.disabled)
      .filter((candidate) => !excludedMarkerPattern.test(candidate.marker))
      .filter((candidate) => candidate.score >= 180)
      .sort((left, right) => right.score - left.score);
    const openMenuBranch = async (element: HTMLElement) => {
      const rootsBefore = new Set(menuRoots());
      hoverElement(element);
      await waitInPage(260);
      if (menuRoots().some((root) => !rootsBefore.has(root))) return;
      activateElement(element);
      await waitInPage(360);
    };
    const menuBranchCandidates = () => menuRoots()
      .flatMap((root) => [...root.querySelectorAll('[role="menuitem"], [role="button"], button, [aria-haspopup="menu"]')])
      .filter(visible)
      .map((element) => {
        const label = labelOf(element);
        const modelValue = modelValueOf(element);
        const marker = `${label} ${rawMarkerOf(element)}`.replace(/\s+/g, ' ').trim();
        const isModelBranch = modelBranchPattern.test(element.getAttribute('aria-label') || '') ||
          modelBranchPattern.test(label) || Boolean(modelValue);
        const isAdvancedBranch = advancedMenuPattern.test(label) || advancedMenuPattern.test(marker);
        const excluded = excludedMarkerPattern.test(marker);
        return {
          element: element as HTMLElement,
          label,
          modelValue,
          isModelBranch,
          isAdvancedBranch,
          excluded
        };
      })
      .filter((candidate) => !candidate.excluded);
    const readVisibleModelOptions = () => menuRoots()
      .map((root) => ({ root, options: uniqueOptions(optionCandidatesFrom(root, true)) }))
      .filter((candidate) => candidate.options.length > 0)
      .sort((left, right) => right.options.length - left.options.length)[0];
    const openNestedModelMenu = async (composerTrigger: HTMLElement) => {
      await closeMenus();
      activateElement(composerTrigger);
      await waitInPage(360);
      let familyLabel = '';
      const openedBranches = new Set<HTMLElement>();
      for (let depth = 0; depth < 3; depth += 1) {
        const visibleOptions = readVisibleModelOptions();
        if (visibleOptions) return { familyLabel, options: visibleOptions.options };

        const branches = menuBranchCandidates().filter((candidate) => !openedBranches.has(candidate.element));
        const modelBranch = branches.find((candidate) => candidate.isModelBranch);
        if (modelBranch) {
          familyLabel = modelBranch.modelValue || familyLabel;
          openedBranches.add(modelBranch.element);
          await openMenuBranch(modelBranch.element);
          continue;
        }
        const advancedBranch = branches.find((candidate) => candidate.isAdvancedBranch);
        if (advancedBranch) {
          openedBranches.add(advancedBranch.element);
          await openMenuBranch(advancedBranch.element);
          continue;
        }
        break;
      }
      const visibleOptions = readVisibleModelOptions();
      if (visibleOptions) return { familyLabel, options: visibleOptions.options };
      await closeMenus();
      return undefined;
    };
    const triggerCandidates = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .map((element) => {
        return { element: element as HTMLElement, text: labelOf(element), score: scoreTrigger(element) };
      })
      .filter((candidate) => candidate.score >= 100)
      .sort((left, right) => right.score - left.score);
    const trigger = triggerCandidates[0];
    if (!trigger) {
      for (const composerTrigger of composerTriggers()) {
        if (requested && sameModel(composerTrigger.text, requested)) {
          return {
            triggerFound: true,
            currentModel: requested,
            options: [{ label: requested, current: true }],
            requestedModel: requested,
            requestedAvailable: true,
            selected: false,
            confirmed: true
          };
        }
        composerTrigger.element.setAttribute('data-xiangmao-model-trigger', 'composer-nested');
        const nested = await openNestedModelMenu(composerTrigger.element);
        if (!nested) {
          composerTrigger.element.removeAttribute('data-xiangmao-model-trigger');
          continue;
        }
        const currentOption = nested.options.find((option) => option.current);
        const currentModel = currentOption?.label || nested.familyLabel;
        const requestedOption = requested
          ? nested.options.find((candidate) => normalized(candidate.label) === normalized(requested))
          : undefined;
        if (!requested) {
          await closeMenus();
          composerTrigger.element.removeAttribute('data-xiangmao-model-trigger');
          return {
            triggerFound: true,
            currentModel,
            options: nested.options.map(({ label, current }) => ({ label, current }))
          };
        }
        if (!requestedOption) {
          await closeMenus();
          composerTrigger.element.removeAttribute('data-xiangmao-model-trigger');
          return {
            triggerFound: true,
            currentModel,
            options: nested.options.map(({ label, current }) => ({ label, current })),
            requestedModel: requested,
            requestedAvailable: false,
            selected: false,
            confirmed: false
          };
        }
        if (requestedOption.current) {
          await closeMenus();
          composerTrigger.element.removeAttribute('data-xiangmao-model-trigger');
          return {
            triggerFound: true,
            currentModel: requestedOption.label,
            options: nested.options.map(({ label, current }) => ({ label, current })),
            requestedModel: requested,
            requestedAvailable: true,
            selected: false,
            confirmed: true
          };
        }
        if (nested.familyLabel && sameModel(nested.familyLabel, requested)) {
          await closeMenus();
          composerTrigger.element.removeAttribute('data-xiangmao-model-trigger');
          return {
            triggerFound: true,
            currentModel: nested.familyLabel,
            options: nested.options.map(({ label, current }) => ({
              label,
              current: current || normalized(label) === normalized(requested)
            })),
            requestedModel: requested,
            requestedAvailable: true,
            selected: false,
            confirmed: true
          };
        }
        activateElement(requestedOption.element);
        await waitInPage(700);
        const markedTrigger = document.querySelector('[data-xiangmao-model-trigger="composer-nested"]');
        const refreshedComposerTrigger = markedTrigger && visible(markedTrigger)
          ? markedTrigger as HTMLElement
          : composerTriggers()[0]?.element;
        const verification = refreshedComposerTrigger
          ? await openNestedModelMenu(refreshedComposerTrigger)
          : undefined;
        const verifiedOption = verification?.options.find((candidate) => normalized(candidate.label) === normalized(requested));
        const confirmed = Boolean(verifiedOption?.current) || Boolean(
          verification?.familyLabel && sameModel(verification.familyLabel, requested)
        );
        const verifiedCurrent = verification?.options.find((candidate) => candidate.current)?.label || verification?.familyLabel || '';
        const trustedClickTarget = !confirmed && verifiedOption
          ? (() => {
              const box = verifiedOption.element.getBoundingClientRect();
              return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            })()
          : undefined;
        if (!trustedClickTarget) await closeMenus();
        refreshedComposerTrigger?.removeAttribute('data-xiangmao-model-trigger');
        return {
          triggerFound: true,
          currentModel: verifiedCurrent,
          options: (verification?.options || nested.options).map(({ label, current }) => ({
            label,
            current: current || (confirmed && normalized(label) === normalized(requested))
          })),
          requestedModel: requested,
          requestedAvailable: true,
          selected: true,
          confirmed,
          trustedClickTarget
        };
      }
      return { triggerFound: false, currentModel: '', options: [] };
    }
    const currentModel = trigger.text;
    if (requested && currentModel && normalized(currentModel) === normalized(requested)) {
      return {
        triggerFound: true,
        currentModel,
        options: [{ label: requested, current: true }],
        requestedModel: requested,
        requestedAvailable: true,
        selected: false,
        confirmed: true
      };
    }
    trigger.element.setAttribute('data-xiangmao-model-trigger', 'true');
    activateElement(trigger.element);
    await waitInPage(420);
    const root = menuRoots().at(-1);
    const options = root ? uniqueOptions(optionCandidatesFrom(root)) : [];
    const requestedOption = requested
      ? options.find((candidate) => normalized(candidate.label) === normalized(requested))
      : undefined;
    if (!requested) {
      await closeMenus();
      trigger.element.removeAttribute('data-xiangmao-model-trigger');
      return {
        triggerFound: true,
        currentModel,
        options: options.map(({ label, current }) => ({ label, current }))
      };
    }
    if (!requestedOption) {
      await closeMenus();
      trigger.element.removeAttribute('data-xiangmao-model-trigger');
      return {
        triggerFound: true,
        currentModel,
        options: options.map(({ label, current }) => ({ label, current })),
        requestedModel: requested,
        requestedAvailable: false,
        selected: false,
        confirmed: false
      };
    }
    activateElement(requestedOption.element);
    await waitInPage(700);
    const markedTrigger = document.querySelector('[data-xiangmao-model-trigger="true"]');
    const refreshedTrigger = markedTrigger && visible(markedTrigger)
      ? markedTrigger
      : [...document.querySelectorAll('button, [role="button"]')]
          .filter(visible)
          .map((element) => ({ element, score: scoreTrigger(element) }))
          .filter((candidate) => candidate.score >= 100)
          .sort((left, right) => right.score - left.score)[0]?.element;
    const selectedLabel = refreshedTrigger ? labelOf(refreshedTrigger) : '';
    const confirmed = Boolean(selectedLabel) && (
      normalized(selectedLabel) === normalized(requestedOption.label) ||
      normalized(selectedLabel).includes(normalized(requestedOption.label)) ||
      normalized(requestedOption.label).includes(normalized(selectedLabel))
    );
    refreshedTrigger?.removeAttribute('data-xiangmao-model-trigger');
    return {
      triggerFound: true,
      currentModel: selectedLabel,
      options: options.map(({ label }) => ({ label, current: normalized(label) === normalized(requestedOption.label) })),
      requestedModel: requested,
      requestedAvailable: true,
      selected: true,
      confirmed
    };
  }, requestedModel, chatGptModelDomPolicy);
}

interface ChatGptTrustedModelMenuProbe {
  composerModel: string;
  composerTarget?: { x: number; y: number };
  advancedTarget?: { x: number; y: number };
  modelBranchTarget?: { x: number; y: number };
  options: Array<{ label: string; current: boolean; target: { x: number; y: number } }>;
}

const chatGptTrustedModelMenuProbeScript = pageScript((policy: typeof chatGptModelDomPolicy) => {
  const modelOptionPattern = new RegExp(policy.modelOptionPattern, 'i');
  const advancedMenuPattern = new RegExp(policy.advancedMenuPattern, 'i');
  const modelBranchPattern = new RegExp(policy.modelBranchPattern, 'i');
  const visible = (element: Element) => {
    if (element.closest('[inert], [aria-hidden="true"], [data-active="false"]')) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const linesOf = (element: Element) => ((element as HTMLElement).innerText || element.textContent || '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const targetOf = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  const composerCandidates = [...document.querySelectorAll<HTMLElement>(
    'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]'
  )]
    .filter(visible)
    .filter((element) => Boolean(element.closest('form, [data-testid*="composer"], [class*="composer"]')))
    .map((element) => {
      const className = typeof element.className === 'string' ? element.className : '';
      const lines = linesOf(element);
      const score = (className.includes('composer-pill') ? 200 : 0) + (element.getBoundingClientRect().width <= 180 ? 20 : 0);
      return { element, lines, score };
    })
    .filter((candidate) => candidate.score >= 200)
    .sort((left, right) => right.score - left.score);
  const composer = composerCandidates[0];
  const visibleMenus = [...document.querySelectorAll<HTMLElement>(
    '[role="menu"], [role="listbox"], [data-radix-menu-content], [role="dialog"]'
  )].filter(visible);
  const menuItems = visibleMenus.flatMap((root) => [
    ...root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="option"], button, [aria-haspopup="menu"]')
  ]).filter(visible);
  const options = menuItems
    .filter((element) => element.getAttribute('aria-haspopup') !== 'menu')
    .map((element) => {
      const label = linesOf(element)[0] || '';
      const current = element.getAttribute('aria-checked') === 'true' ||
        element.getAttribute('aria-selected') === 'true' || element.getAttribute('data-state') === 'checked';
      return { label, current, target: targetOf(element) };
    })
    .filter((option) => modelOptionPattern.test(option.label));
  const branches = menuItems
    .filter((element) => element.getAttribute('aria-haspopup') === 'menu' ||
      (element.getAttribute('aria-expanded') === 'false' && modelBranchPattern.test(element.getAttribute('aria-label') || '')))
    .map((element) => ({ element, label: element.getAttribute('aria-label') || linesOf(element)[0] || '' }));
  const advanced = branches.find((branch) => advancedMenuPattern.test(branch.label));
  const modelBranch = branches.find((branch) => modelBranchPattern.test(branch.label));
  return {
    composerModel: composer?.lines[0] || '',
    composerTarget: composer ? targetOf(composer.element) : undefined,
    advancedTarget: advanced ? targetOf(advanced.element) : undefined,
    modelBranchTarget: modelBranch ? targetOf(modelBranch.element) : undefined,
    options
  };
}, chatGptModelDomPolicy);

async function closeChatGptMenusWithTrustedKeyboard(webContents: ChatGptWebContentsLike) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
    });
    await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
    });
    await sleep(90);
  }
}

async function inspectChatGptModelsWithTrustedClicks(
  win: ChatGptWindowLike,
  requestedModel = ''
): Promise<ChatGptModelMenuSnapshot> {
  await closeChatGptMenusWithTrustedKeyboard(win.webContents);
  let probe = await evalInPageWithTimeout<ChatGptTrustedModelMenuProbe>(
    win.webContents,
    chatGptTrustedModelMenuProbeScript,
    6000
  );
  if (!probe.composerTarget) return { triggerFound: false, currentModel: '', options: [] };
  if (requestedModel && isSameChatGptModelLabel(probe.composerModel, requestedModel)) {
    return {
      triggerFound: true,
      currentModel: requestedModel,
      options: [{ label: requestedModel, current: true }],
      requestedModel,
      requestedAvailable: true,
      selected: false,
      confirmed: true
    };
  }
  await dispatchTrustedChatGptClick(win.webContents, probe.composerTarget);
  await sleep(320);
  for (let depth = 0; depth < 4; depth += 1) {
    probe = await evalInPageWithTimeout<ChatGptTrustedModelMenuProbe>(
      win.webContents,
      chatGptTrustedModelMenuProbeScript,
      6000
    );
    if (probe.options.length > 0) break;
    const branchTarget = probe.modelBranchTarget || probe.advancedTarget;
    if (!branchTarget) break;
    await dispatchTrustedChatGptClick(win.webContents, branchTarget);
    await sleep(360);
  }
  const currentOption = probe.options.find((option) => option.current);
  const currentModel = currentOption?.label || probe.composerModel;
  if (!requestedModel) {
    await closeChatGptMenusWithTrustedKeyboard(win.webContents);
    return {
      triggerFound: probe.options.length > 0,
      currentModel,
      options: probe.options.map(({ label, current }) => ({ label, current }))
    };
  }
  const requestedOption = probe.options.find((option) => isSameChatGptModelLabel(option.label, requestedModel));
  if (!requestedOption) {
    await closeChatGptMenusWithTrustedKeyboard(win.webContents);
    return {
      triggerFound: probe.options.length > 0,
      currentModel,
      options: probe.options.map(({ label, current }) => ({ label, current })),
      requestedModel,
      requestedAvailable: false,
      selected: false,
      confirmed: false
    };
  }
  if (!requestedOption.current) {
    await dispatchTrustedChatGptClick(win.webContents, requestedOption.target);
    await sleep(850);
  }
  let verification = await evalInPageWithTimeout<ChatGptTrustedModelMenuProbe>(
    win.webContents,
    chatGptTrustedModelMenuProbeScript,
    6000
  );
  if (!requestedOption.current && !isSameChatGptModelLabel(verification.composerModel, requestedModel)) {
    if (!verification.modelBranchTarget && !verification.advancedTarget && !verification.options.length && verification.composerTarget) {
      await dispatchTrustedChatGptClick(win.webContents, verification.composerTarget);
      await sleep(320);
      verification = await evalInPageWithTimeout<ChatGptTrustedModelMenuProbe>(win.webContents, chatGptTrustedModelMenuProbeScript, 6000);
    }
    for (let depth = 0; depth < 3 && !verification.options.length; depth += 1) {
      const target = verification.modelBranchTarget || verification.advancedTarget;
      if (!target) break;
      await dispatchTrustedChatGptClick(win.webContents, target);
      await sleep(360);
      verification = await evalInPageWithTimeout<ChatGptTrustedModelMenuProbe>(win.webContents, chatGptTrustedModelMenuProbeScript, 6000);
    }
  }
  const confirmed = isSameChatGptModelLabel(verification.composerModel, requestedModel) || requestedOption.current ||
    verification.options.some((option) => option.current && isSameChatGptModelLabel(option.label, requestedModel));
  await closeChatGptMenusWithTrustedKeyboard(win.webContents);
  return {
    triggerFound: true,
    currentModel: confirmed ? requestedModel : verification.composerModel,
    options: probe.options.map(({ label, current }) => ({
      label,
      current: confirmed ? isSameChatGptModelLabel(label, requestedModel) : current
    })),
    requestedModel,
    requestedAvailable: true,
    selected: !requestedOption.current,
    confirmed
  };
}

async function inspectChatGptModels(
  win: ChatGptWindowLike,
  requestedModel = '',
  maxProbes = 5
): Promise<ChatGptModelCatalog & { selectionConfirmed?: boolean }> {
  let snapshot = await evalChatGptMutation<ChatGptModelMenuSnapshot>(
    win.webContents,
    chatGptModelMenuScript(requestedModel),
    12000
  );
  for (let attempt = 1; attempt < Math.max(1, maxProbes) && !snapshot.triggerFound; attempt += 1) {
    await sleep(Math.min(1200 * attempt, 3600));
    snapshot = await evalChatGptMutation<ChatGptModelMenuSnapshot>(
      win.webContents,
      chatGptModelMenuScript(requestedModel),
      12000
    );
  }
  for (
    let attempt = 1;
    attempt < Math.min(Math.max(1, maxProbes), 3) &&
      Boolean(requestedModel && snapshot.triggerFound && snapshot.requestedAvailable && !snapshot.confirmed);
    attempt += 1
  ) {
    if (snapshot.trustedClickTarget) {
      await dispatchTrustedChatGptClick(win.webContents, snapshot.trustedClickTarget);
    }
    await sleep(650 * attempt);
    snapshot = await evalChatGptMutation<ChatGptModelMenuSnapshot>(
      win.webContents,
      chatGptModelMenuScript(requestedModel),
      12000
    );
  }
  if (!snapshot.triggerFound || Boolean(requestedModel && !snapshot.confirmed)) {
    const trustedSnapshot = await inspectChatGptModelsWithTrustedClicks(win, requestedModel).catch(() => undefined);
    if (trustedSnapshot?.triggerFound) snapshot = trustedSnapshot;
  }
  const models = dedupeChatGptModelOptions(
    snapshot.options.map((option) => ({
      id: normalizeChatGptModelLabel(option.label),
      label: option.label,
      current: option.current
    }))
  );
  const ok = snapshot.triggerFound && (!requestedModel || Boolean(snapshot.requestedAvailable && snapshot.confirmed));
  return {
    ok,
    modelMode: snapshot.triggerFound ? 'explicit' : 'automatic',
    currentModel: snapshot.currentModel || models.find((model) => model.current)?.label,
    models,
    refreshedAt: new Date().toISOString(),
    message: snapshot.triggerFound
      ? requestedModel
        ? ok
          ? `已确认模型：${snapshot.currentModel || requestedModel}`
          : `指定模型“${requestedModel}”当前不可用或切换后未能确认。`
        : models.length
          ? `已读取 ${models.length} 个当前账号可用模型。`
          : '当前账号没有显示可切换模型，将跟随 ChatGPT 当前模型。'
      : '当前 ChatGPT 页面没有显示模型选择器，将跟随网页当前模型。',
    error: ok || !requestedModel ? undefined : `指定模型“${requestedModel}”当前不可用。`,
    selectionConfirmed: snapshot.confirmed
  };
}

async function ensureChatGptModelForSend(
  event: IpcMainInvokeEvent,
  win: ChatGptWindowLike,
  requestedModel?: string,
  workMode: AppSettings['chatGptWorkMode'] = 'quality'
) {
  const configurationPlan = planChatGptConfigurationSync(workMode);
  if (!configurationPlan.inspectModel && !configurationPlan.inspectThinking) {
    await appendChatGptAutomationDiagnostic('chatgpt-config-direct', {
      model: configurationPlan.modelLogLabel,
      modelDomQueries: 0,
      modelClicks: 0,
      thinkingDomQueries: 0,
      thinkingClicks: 0
    });
    emitAutomationStatus(event, {
      step: '已沿用 ChatGPT 网页配置',
      detail: '极简直传未读取或切换模型与思考强度。'
    });
    return {
      ok: true,
      currentModel: configurationPlan.modelLogLabel,
      models: [],
      refreshedAt: new Date().toISOString(),
      message: configurationPlan.modelLogLabel,
      selectionConfirmed: true
    } satisfies ChatGptModelCatalog & { selectionConfirmed?: boolean };
  }
  const requested = requestedModel?.trim() || followCurrentChatGptModel;
  const reasoningTarget = chatGptReasoningTargetForWorkMode(workMode) || 'high';
  const cached = chatGptVerifiedConfigByPage.get(win.webContents as object);
  if (
    cached?.requestedModel === requested &&
    cached.reasoning === reasoningTarget &&
    Date.now() - cached.verifiedAt <= 30 * 60 * 1000
  ) {
    await appendChatGptAutomationDiagnostic('chatgpt-config-reused', {
      requestedModel: requested,
      currentModel: cached.currentModel,
      reasoning: reasoningTarget,
      ageMs: Date.now() - cached.verifiedAt
    });
    emitAutomationStatus(event, {
      step: '已复用 ChatGPT 工作配置',
      detail: `${cached.currentModel} / ${reasoningTarget === 'low' ? '低' : reasoningTarget === 'medium' ? '中' : '高'}，本任务没有重复打开模型菜单。`
    });
    return {
      ok: true,
      currentModel: cached.currentModel,
      models: [{ id: normalizeChatGptModelLabel(cached.currentModel), label: cached.currentModel, current: true }],
      refreshedAt: new Date().toISOString(),
      message: `已复用模型：${cached.currentModel}`,
      selectionConfirmed: true
    } satisfies ChatGptModelCatalog & { selectionConfirmed?: boolean };
  }
  if (requested === followCurrentChatGptModel) {
    const catalog = await inspectChatGptModels(win).catch(() => undefined);
    await appendChatGptAutomationDiagnostic('chatgpt-model-follow-current', {
      currentModel: catalog?.currentModel || 'unknown',
      modelCount: catalog?.models.length || 0
    });
    await ensureChatGptHighReasoningForSend(event, win, catalog?.currentModel || '', reasoningTarget);
    chatGptVerifiedConfigByPage.set(win.webContents as object, {
      requestedModel: requested,
      currentModel: catalog?.currentModel || 'ChatGPT 当前模型',
      reasoning: reasoningTarget,
      verifiedAt: Date.now()
    });
    return catalog;
  }
  emitAutomationStatus(event, { step: '正在确认 ChatGPT 模型', detail: `本轮指定模型：${requested}` });
  const catalog = await inspectChatGptModels(win, requested);
  await appendChatGptAutomationDiagnostic('chatgpt-model-selection', {
    requestedModel: requested,
    currentModel: catalog.currentModel || 'unknown',
    availableModels: catalog.models.map((model) => model.label),
    ok: catalog.ok
  });
  if (!catalog.ok) {
    throw new Error(`${catalog.error || catalog.message} 本轮已在上传附件前停止，没有静默切换到其他模型。`);
  }
  await ensureChatGptHighReasoningForSend(
    event,
    win,
    catalog.currentModel || requested,
    reasoningTarget
  );
  chatGptVerifiedConfigByPage.set(win.webContents as object, {
    requestedModel: requested,
    currentModel: catalog.currentModel || requested,
    reasoning: reasoningTarget,
    verifiedAt: Date.now()
  });
  return catalog;
}

async function ensureChatGptHighReasoningForSend(
  event: IpcMainInvokeEvent,
  win: ChatGptWindowLike,
  model: string,
  target: 'low' | 'medium' | 'high' = 'high'
) {
  const targetLabel = target === 'low' ? '低' : target === 'medium' ? '中' : '高';
  emitAutomationStatus(event, {
    step: '正在确认 ChatGPT 思考强度',
    detail: model ? `${model} 发送前自动设置为${targetLabel}。` : '发送前检查当前 5.5 / 5.6 模型的思考强度。'
  });
  try {
    const result = await ensureChatGptReasoning(win.webContents, model, target);
    await appendChatGptAutomationDiagnostic('chatgpt-reasoning-high-gate', { ...result });
    if (result.required && !result.confirmed) throw new Error(`${result.model} 的思考强度没有确认到${targetLabel}。`);
    if (result.required) {
      emitAutomationStatus(event, {
        step: '已确认 ChatGPT 思考强度',
        detail: `${result.model} 已设置为${targetLabel}，继续上传附件。`
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendChatGptAutomationDiagnostic('chatgpt-reasoning-high-gate-failed', { model, message });
    throw new Error(`${message} 本轮已在上传附件前停止，没有使用未知强度继续做图。`);
  }
}

const chatGptSessionProbeTimeoutMs = 1800;
const chatGptSessionProbeCacheMs = 10_000;

const composerProbeScript = (probeSession = true) => pageScript(async (
  shouldProbeSession: boolean,
  sessionProbeTimeoutMs: number,
  sessionProbeCacheMs: number
) => {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (element: Element) =>
    `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('placeholder') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
  const url = location.href.toLowerCase();
  const bodyText = (document.body?.innerText || '').toLowerCase();
  const controls = [...document.querySelectorAll('a, button, [role="button"], input, textarea, [contenteditable="true"], [role="textbox"]')];
  const visibleControls = controls.filter(visible);
  const loginButtonCount = visibleControls.filter((element) => {
    const text = textOf(element);
    return /\b(log in|login|sign in|sign up|get started|continue with google|continue with microsoft)\b/.test(text) || text.includes('\u767b\u5f55') || text.includes('\u6ce8\u518c');
  }).length;
  const loginInputCount = visibleControls.filter((element) => {
    const text = textOf(element);
    const type = (element.getAttribute('type') || '').toLowerCase();
    const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
    return (
      type === 'email' ||
      type === 'password' ||
      autocomplete === 'username' ||
      autocomplete === 'current-password' ||
      /\b(email address|password|verification code|one-time code)\b/.test(text)
    );
  }).length;
  const authUrl = /\/(auth|login|signin|signup|verify|challenge)\b/.test(url) || url.includes('auth0') || url.includes('oauth');
  const authText = /\b(log in to chatgpt|sign up for chatgpt|continue with google|continue with microsoft|verify you are human|email address|password)\b/.test(bodyText);
  const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible) as HTMLElement[];
  const composerTextboxes = textboxes.filter((textbox) => {
    const textboxText = textOf(textbox);
    const composerContainer = textbox.closest('form, [data-testid*="composer"], [class*="composer"]');
    const composer = composerContainer || textbox.parentElement?.parentElement?.parentElement || textbox.parentElement;
    const composerText = composer ? textOf(composer) : '';
    const box = textbox.getBoundingClientRect();
    const isTextInput = textbox.matches('textarea, [contenteditable="true"]') && textbox.tagName !== 'INPUT';
    const isInPrimaryComposerRegion =
      isTextInput &&
      box.width >= 160 &&
      box.height >= 20 &&
      box.bottom >= Math.max(240, window.innerHeight * 0.5);
    const hasComposerMarker =
      textboxText.includes('message chatgpt') ||
      textboxText.includes('ask anything') ||
      textboxText.includes('message') ||
      textboxText.includes('\u7ed9 chatgpt \u53d1\u6d88\u606f') ||
      textboxText.includes('\u95ee\u95ee chatgpt') ||
      textboxText.includes('\u8be2\u95ee chatgpt') ||
      textboxText.includes('\u5411 chatgpt') ||
      (textboxText.includes('chatgpt') && !/email|password|verification|\u90ae\u7bb1|\u5bc6\u7801|\u9a8c\u8bc1\u7801/.test(textboxText)) ||
      composerText.includes('composer') ||
      composerText.includes('prompt-textarea') ||
      Boolean(composerContainer) ||
      Boolean(textbox.closest('#prompt-textarea'));
    return hasComposerMarker || isInPrimaryComposerRegion;
  });
  const accountSelectors = [
    '[data-testid="profile-button"]',
    '[data-testid="account-menu-button"]',
    '[data-testid*="profile"]',
    '[data-testid*="account"]',
    '[data-testid*="user-menu"]',
    '[aria-label*="Profile"]',
    '[aria-label*="profile"]',
    '[aria-label*="Account"]',
    '[aria-label*="account"]',
    '[aria-label*="账户"]',
    '[aria-label*="帐号"]',
    '[aria-label*="个人资料"]',
    'button img[alt*="User"]',
    'button img[alt*="user"]',
    'nav a[href^="/c/"]',
    'a[href^="/c/"]',
    '[data-testid*="history"]'
  ];
  const accountElements = accountSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  const accountTextSignals = controls.filter((element) => {
    const text = textOf(element);
    return (
      text.includes('open profile menu') ||
      text.includes('profile menu') ||
      text.includes('my plan') ||
      text.includes('customize chatgpt') ||
      text.includes('\u6253\u5f00\u4e2a\u4eba\u8d44\u6599') ||
      text.includes('\u8d26\u6237')
    );
  });
  const conversationLinkCount = [...document.querySelectorAll('a[href^="/c/"], a[href*="/c/"]')].length;
  let sessionAuthenticated = false;
  let sessionUnauthenticated = false;
  let sessionStatus = 0;
  let sessionProbeError = '';
  if (shouldProbeSession && (location.hostname === 'chatgpt.com' || location.hostname.endsWith('.chatgpt.com'))) {
    type SessionProbeCache = {
      checkedAt: number;
      authenticated: boolean;
      unauthenticated: boolean;
      status: number;
      error: string;
    };
    const cacheHost = window as typeof window & { __xiangmaoSessionProbe?: SessionProbeCache };
    const cached = cacheHost.__xiangmaoSessionProbe;
    const cacheLifetime =
      cached?.error || cached?.unauthenticated ? Math.min(1500, sessionProbeCacheMs) : sessionProbeCacheMs;
    if (cached && Date.now() - cached.checkedAt < cacheLifetime) {
      sessionAuthenticated = cached.authenticated;
      sessionUnauthenticated = cached.unauthenticated;
      sessionStatus = cached.status;
      sessionProbeError = cached.error;
    } else {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), sessionProbeTimeoutMs);
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        });
        sessionStatus = response.status;
        if (response.ok) {
          const session = await response.json();
          sessionAuthenticated = Boolean(session?.user?.id || session?.account?.id);
          sessionUnauthenticated = !sessionAuthenticated;
        } else if (response.status === 401 || response.status === 403) {
          sessionUnauthenticated = true;
        }
      } catch (error) {
        sessionProbeError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      } finally {
        window.clearTimeout(timeoutId);
      }
      cacheHost.__xiangmaoSessionProbe = {
        checkedAt: Date.now(),
        authenticated: sessionAuthenticated,
        unauthenticated: sessionUnauthenticated,
        status: sessionStatus,
        error: sessionProbeError
      };
    }
  }
  const rawLoginSurface = authUrl || authText || loginButtonCount > 0 || loginInputCount > 0;
  const loginText = !sessionAuthenticated && rawLoginSurface;
  const composerReady = composerTextboxes.length > 0;
  const accountReady =
    sessionAuthenticated ||
    ((accountElements.length > 0 || accountTextSignals.length > 0 || conversationLinkCount > 0) && !loginText) ||
    (!shouldProbeSession && composerReady && !rawLoginSurface);
  const ready = composerReady && accountReady;
  return {
    ready,
    loginText,
    composerReady,
    accountReady,
    textboxCount: textboxes.length,
    composerCount: composerTextboxes.length,
    accountSignalCount: accountElements.length + accountTextSignals.length + conversationLinkCount,
    loginButtonCount,
    loginInputCount,
    authUrl,
    rawLoginSurface,
    sessionAuthenticated,
    sessionUnauthenticated,
    sessionStatus,
    sessionProbeError,
    title: document.title,
    href: location.href,
    reason: ready ? 'logged-in-chat-composer-ready' : loginText ? 'login-or-auth-visible' : composerReady ? 'guest-composer-without-account-signal' : 'chat-composer-not-found'
  };
}, probeSession, chatGptSessionProbeTimeoutMs, chatGptSessionProbeCacheMs);

const revealFileInputScript = pageScript(() => {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const inputCount = document.querySelectorAll('input[type="file"]').length;
  if (inputCount > 0) return { inputCount, clicked: false };

  const textOf = (element: Element) =>
    `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('placeholder') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
  const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible) as HTMLElement[];
  const textbox =
    textboxes.find((element) => element.id === 'prompt-textarea') ||
    textboxes.find((element) => /message|ask|chatgpt|\u6d88\u606f|\u8be2\u95ee|\u95ee\u95ee/.test(textOf(element))) ||
    textboxes[textboxes.length - 1];
  const composer = textbox?.closest('form') || textbox?.closest('[data-testid*="composer"]') || textbox?.parentElement?.parentElement?.parentElement || document.body;
  const labels = ['attach', 'upload', 'add photos', 'add files', '附件', '上传', '添加文件', '添加图片', '照片', '图片'];
  const candidates = [...composer.querySelectorAll('button, [role="button"], label'), ...document.querySelectorAll('button, [role="button"], label')].filter(visible) as HTMLElement[];
  const explicitTarget = candidates.find((element) => {
    const text = textOf(element);
    return labels.some((label) => text.includes(label)) || text.trim() === '+';
  }) as HTMLElement | undefined;
  const textboxBox = textbox?.getBoundingClientRect();
  const target =
    explicitTarget ||
    (textboxBox
      ? candidates
          .map((element) => ({ element, box: element.getBoundingClientRect(), text: textOf(element) }))
          .filter(({ box, text }) => {
            const notSend = !text.includes('send') && !text.includes('发送') && !text.includes('submit') && !text.includes('voice') && !text.includes('mic');
            return notSend && box.left <= textboxBox.left + 80 && box.top >= textboxBox.top - 20;
          })
          .sort((a, b) => b.box.top - a.box.top || a.box.left - b.box.left)[0]?.element
      : undefined);
  if (!target) return { inputCount: 0, clicked: false };
  target.click();
  return { inputCount: document.querySelectorAll('input[type="file"]').length, clicked: true };
});

const markComposerFileInputScript = (marker: string) =>
  pageScript((token: string) => {
    const present = (element: Element) => {
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (element: Element) =>
      `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('placeholder') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
    const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(present) as HTMLElement[];
    const textbox =
      textboxes.find((element) => element.id === 'prompt-textarea') ||
      textboxes.find((element) => /message|ask|chatgpt|\u6d88\u606f|\u8be2\u95ee|\u95ee\u95ee/.test(textOf(element))) ||
      textboxes[textboxes.length - 1];
    const composer =
      textbox?.closest('form') ||
      textbox?.closest('[data-testid*="composer"]') ||
      textbox?.closest('[class*="composer"]') ||
      textbox?.parentElement?.parentElement?.parentElement;
    const allInputs = [...document.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
    for (const input of allInputs) input.removeAttribute('data-xiangmao-upload-target');
    const scopedInputs = composer ? ([...composer.querySelectorAll('input[type="file"]')] as HTMLInputElement[]) : [];
    // A page-level hidden file input may belong to account/settings UI. Only
    // inject through an input owned by the active composer; drag/drop is the
    // trusted fallback when ChatGPT has not mounted that input yet.
    const candidates = scopedInputs;
    const selected = candidates
      .map((input, index) => {
        const accept = (input.accept || '').toLowerCase();
        const text = textOf(input);
        const imageScore = accept.includes('image') || accept.includes('.png') || accept.includes('.jpg') || accept.includes('.jpeg') ? 10 : 0;
        const composerScore = composer?.contains(input) ? 20 : 0;
        const multipleScore = input.multiple ? 4 : 0;
        const labelScore = /attach|upload|image|photo|\u9644\u4ef6|\u4e0a\u4f20|\u56fe\u7247|\u7167\u7247/.test(text) ? 3 : 0;
        return { input, score: composerScore + imageScore + multipleScore + labelScore + index / 1000 };
      })
      .sort((a, b) => b.score - a.score)[0]?.input;
    if (!selected) return { selected: false, inputCount: allInputs.length, scopedCount: scopedInputs.length, accept: '', multiple: false };
    selected.setAttribute('data-xiangmao-upload-target', token);
    return {
      selected: true,
      inputCount: allInputs.length,
      scopedCount: scopedInputs.length,
      accept: selected.accept || '',
      multiple: selected.multiple
    };
  }, marker);

const dismissOpenMenusScript = pageScript(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  return true;
});

const resetComposerScript = pageScript(() => {
  const present = (element: Element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (element: Element) =>
    `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('placeholder') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
  const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(present) as HTMLElement[];
  const textbox =
    textboxes.find((element) => element.id === 'prompt-textarea') ||
    textboxes.find((element) => /message|ask|chatgpt|\u6d88\u606f|\u8be2\u95ee|\u95ee\u95ee/.test(textOf(element))) ||
    textboxes[textboxes.length - 1];
  const composer =
    textbox?.closest('form') ||
    textbox?.closest('[data-testid*="composer"]') ||
    textbox?.closest('[class*="composer"]') ||
    textbox?.parentElement?.parentElement?.parentElement ||
    document.body;

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));

  const removeButtons = [...composer.querySelectorAll('button, [role="button"]')]
    .filter(present)
    .filter((element) => {
      const text = textOf(element);
      return (
        text.includes('remove') ||
        text.includes('delete') ||
        text.includes('clear') ||
        text.includes('cancel upload') ||
        text.includes('移除') ||
        text.includes('删除') ||
        text.includes('清除') ||
        text.includes('取消上传')
      );
    }) as HTMLElement[];
  for (const button of removeButtons.slice(0, 20)) {
    button.click();
  }

  if (textbox instanceof HTMLTextAreaElement) {
    textbox.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(textbox, '');
    else textbox.value = '';
    textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    textbox.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (textbox) {
    textbox.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textbox);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const deleted = document.execCommand('delete', false);
    if (!deleted || (textbox.textContent || '').trim()) {
      textbox.textContent = '';
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    }
  }

  const composerText = textbox instanceof HTMLTextAreaElement ? textbox.value.trim() : (textbox?.textContent || '').trim();
  const attachmentCount = [...composer.querySelectorAll('img, canvas, picture, [data-testid*="attachment"], [data-testid*="file"], [class*="attachment"], [class*="upload"], [class*="thumbnail"]')]
    .filter(present)
    .filter((element) => {
      const box = element.getBoundingClientRect();
      const text = textOf(element);
      const likelyAttachment =
        text.includes('attachment') ||
        text.includes('uploaded') ||
        text.includes('upload') ||
        text.includes('file') ||
        text.includes('remove') ||
        text.includes('附件') ||
        text.includes('上传') ||
        text.includes('删除') ||
        ['IMG', 'CANVAS', 'PICTURE'].includes(element.tagName);
      const intrinsicSize =
        element instanceof HTMLImageElement
          ? Math.min(element.naturalWidth, element.naturalHeight)
          : element instanceof HTMLCanvasElement
            ? Math.min(element.width, element.height)
            : 0;
      return (box.width >= 24 && box.height >= 24 ? true : intrinsicSize >= 24) && likelyAttachment;
    }).length;

  return {
    ok: Boolean(textbox) && !composerText && attachmentCount === 0,
    hasTextbox: Boolean(textbox),
    textLength: composerText.length,
    attachmentCount,
    removeButtonCount: removeButtons.length
  };
});

const composerDropPointScript = pageScript(() => {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (element: Element) =>
    `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('placeholder') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
  const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible) as HTMLElement[];
  const textbox =
    textboxes.find((element) => element.id === 'prompt-textarea') ||
    textboxes.find((element) => /message|ask|chatgpt|\u6d88\u606f|\u8be2\u95ee|\u95ee\u95ee/.test(textOf(element))) ||
    textboxes[textboxes.length - 1];
  const composer =
    textbox?.closest('form') ||
    textbox?.closest('[data-testid*="composer"]') ||
    textbox?.closest('[class*="composer"]') ||
    textbox?.parentElement?.parentElement?.parentElement ||
    textbox ||
    document.body;
  const box = (composer as HTMLElement).getBoundingClientRect();
  const textboxBox = textbox?.getBoundingClientRect();
  const targetBox = textboxBox && textboxBox.width > 0 && textboxBox.height > 0 ? textboxBox : box;
  return {
    ok: Boolean(targetBox.width > 0 && targetBox.height > 0),
    x: Math.round(targetBox.left + Math.min(targetBox.width / 2, Math.max(40, targetBox.width - 60))),
    y: Math.round(targetBox.top + targetBox.height / 2),
    width: Math.round(targetBox.width),
    height: Math.round(targetBox.height),
    textboxCount: textboxes.length,
    composerText: textOf(composer).slice(0, 160)
  };
});

const setPromptScript = (prompt: string) =>
  pageScript((text: string) => {
    const present = (element: Element) => {
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (element: Element) =>
      `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('placeholder') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(present) as HTMLElement[];
    const target =
      candidates.find((element) => element.id === 'prompt-textarea') ||
      candidates.find((element) => /message|ask|chatgpt|\u6d88\u606f|\u8be2\u95ee|\u95ee\u95ee/.test(textOf(element))) ||
      candidates.find((element) => element.getAttribute('contenteditable') === 'true') ||
      candidates[candidates.length - 1];
    if (!target) return false;
    target.focus();
    if (target instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(target, text);
      else target.value = text;
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return target.value === text;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('delete', false);
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted || (target.textContent || '').trim() !== text.trim()) {
      target.textContent = text;
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    }
    return (target.textContent || '').trim() === text.trim();
  }, prompt);

const uploadReadyScript = (expectedCount: number) =>
  pageScript((minimumAttachments: number) => {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible) as HTMLElement[];
  const textbox = textboxes[textboxes.length - 1];
  const composer = textbox?.closest('form') || textbox?.closest('[data-testid*="composer"]') || textbox?.parentElement?.parentElement?.parentElement || document.body;
  const busyCount = [...composer.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].filter(visible).length;
  const textboxBox = textbox?.getBoundingClientRect();
  const isSendButton = (button: HTMLButtonElement) => {
    const text = `${button.textContent || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.getAttribute('data-testid') || ''}`.toLowerCase();
    return (
      button.getAttribute('data-testid') === 'send-button' ||
      button.getAttribute('data-testid') === 'composer-submit-button' ||
      text.includes('send prompt') ||
      text.includes('send message') ||
      text.includes('send') ||
      text.includes('发送') ||
      text.includes('提交')
    );
  };
  const buttons = [...composer.querySelectorAll('button'), ...document.querySelectorAll('button')].filter(visible) as HTMLButtonElement[];
  const sendButton =
    buttons.find(isSendButton) ||
    (textboxBox
      ? buttons
          .map((button) => ({ button, box: button.getBoundingClientRect(), text: `${button.textContent || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.getAttribute('data-testid') || ''}`.toLowerCase() }))
          .filter(({ button, box, text }) => {
            const notAux = !text.includes('attach') && !text.includes('upload') && !text.includes('附件') && !text.includes('上传') && !text.includes('voice') && !text.includes('mic');
            return notAux && box.left >= textboxBox.right - 120 && box.top >= textboxBox.top - 20 && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
          })
          .sort((a, b) => b.box.left - a.box.left || b.box.top - a.box.top)[0]?.button
      : undefined);
  const composerText = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
    .map((element) => (element instanceof HTMLTextAreaElement ? element.value : element.textContent || ''))
    .join('\n')
    .trim();
  const composerAttachmentCandidates = [...composer.querySelectorAll('img, canvas, picture, [data-testid*="attachment"], [data-testid*="file"], [class*="attachment"], [class*="thumbnail"]')]
    .filter(visible)
    .filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width >= 28 && box.height >= 28;
    });
  const composerAttachmentElements = composerAttachmentCandidates.filter((element) =>
    !composerAttachmentCandidates.some((other) => other !== element && element.contains(other))
  );
  const composerAttachmentCount = new Set(
    composerAttachmentElements.map((element) => {
      const box = element.getBoundingClientRect();
      return `${Math.round((box.left + box.width / 2) / 12)}:${Math.round((box.top + box.height / 2) / 12)}`;
    })
  ).size;
  const bodyText = document.body.innerText.toLowerCase();
  const uploadErrorText = [
    'failed to upload',
    'upload failed',
    'could not upload',
    "couldn't upload",
    'unsupported file',
    'file is too large',
    '上传失败',
    '无法上传',
    '不支持的文件',
    '文件过大'
  ].find((text) => bodyText.includes(text)) || '';
  const sendEnabled = Boolean(sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true');
  return {
    ready: !uploadErrorText && busyCount === 0 && Boolean(composerText) && sendEnabled && composerAttachmentCount >= minimumAttachments,
    busyCount,
    sendEnabled,
    hasPrompt: Boolean(composerText),
    attachmentCount: composerAttachmentCount,
    uploadErrorText
  };
  }, Math.max(1, expectedCount));

const uploadAttachmentSnapshotScript = (expectedFileNames: string[]) =>
  pageScript((fileNames: string[]) => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (box.width > 0 && box.height > 0) return true;
      if (element instanceof HTMLImageElement) return element.naturalWidth > 0 && element.naturalHeight > 0;
      if (element instanceof HTMLCanvasElement) return element.width > 0 && element.height > 0;
      return Boolean(element.querySelector('img, picture, a[href], canvas'));
    };
    const textOf = (element: Element) =>
      `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
    const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible) as HTMLElement[];
    const textbox = textboxes[textboxes.length - 1];
    const composer =
      textbox?.closest('form') ||
      textbox?.closest('[data-testid*="composer"]') ||
      textbox?.closest('[class*="composer"]') ||
      textbox?.parentElement?.parentElement?.parentElement ||
      document.body;
    const normalizedNames = fileNames.map((name) => name.toLowerCase());
    const composerText = (composer.textContent || '').toLowerCase();
    const nameHits = normalizedNames.filter((name) => composerText.includes(name)).length;
    const previewCandidates = [...composer.querySelectorAll('img, canvas, picture, [data-testid*="attachment"], [data-testid*="file"], [class*="attachment"], [class*="thumbnail"]')]
      .filter(visible)
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const text = textOf(element);
        const hasAttachmentText =
          text.includes('attachment') ||
          text.includes('uploaded') ||
          text.includes('upload') ||
          text.includes('file') ||
          text.includes('remove') ||
          text.includes('附件') ||
          text.includes('上传') ||
          text.includes('删除') ||
          normalizedNames.some((name) => text.includes(name));
        return box.width >= 28 && box.height >= 28 && (['IMG', 'CANVAS', 'PICTURE'].includes(element.tagName) || hasAttachmentText);
      });
    const previewElements = previewCandidates.filter((element) =>
      !previewCandidates.some((other) => other !== element && element.contains(other))
    );
    const previewCount = new Set(
      previewElements.map((element) => {
        const box = element.getBoundingClientRect();
        return `${Math.round((box.left + box.width / 2) / 12)}:${Math.round((box.top + box.height / 2) / 12)}`;
      })
    ).size;
    const removeButtons = [...composer.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .filter((element) => {
        const text = textOf(element);
        return text.includes('remove') || text.includes('delete') || text.includes('删除') || text.includes('移除');
      });
    const fileInputCount = [...document.querySelectorAll('input[type="file"]')]
      .map((input) => (input as HTMLInputElement).files?.length || 0)
      .reduce((sum, count) => sum + count, 0);
    const busyCount = [...composer.querySelectorAll('[aria-busy="true"], [role="progressbar"]')]
      .filter(visible)
      .length;
    const bodyText = document.body.innerText.toLowerCase();
    const uploadErrorText = [
      'failed to upload',
      'upload failed',
      'could not upload',
      "couldn't upload",
      'unsupported file',
      'file is too large',
      '上传失败',
      '无法上传',
      '不支持的文件',
      '文件过大'
    ].find((text) => bodyText.includes(text));
    const evidenceCount = Math.max(nameHits, previewCount, removeButtons.length);
    return {
      expectedCount: fileNames.length,
      evidenceCount,
      nameHits,
      previewCount,
      removeButtonCount: removeButtons.length,
      fileInputCount,
      busyCount,
      uploadErrorText: uploadErrorText || '',
      ready: evidenceCount >= Math.max(1, fileNames.length) && !uploadErrorText
    };
  }, expectedFileNames);

const clickSendScript = pageScript(() => {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (element: Element) =>
    `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
  const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible) as HTMLElement[];
  const textbox =
    textboxes.find((element) => element.id === 'prompt-textarea') ||
    textboxes.find((element) => /message|ask|消息|询问/.test(textOf(element))) ||
    textboxes[textboxes.length - 1];
  const composer =
    textbox?.closest('form') ||
    textbox?.closest('[data-testid*="composer"]') ||
    textbox?.closest('[class*="composer"]');
  if (!textbox || !composer) return false;
  const textboxBox = textbox?.getBoundingClientRect();
  const isSendButton = (button: HTMLButtonElement) => {
    const text = textOf(button);
    return (
      !button.disabled &&
      button.getAttribute('aria-disabled') !== 'true' &&
      (button.getAttribute('data-testid') === 'send-button' ||
        button.getAttribute('data-testid') === 'composer-submit-button' ||
        text.includes('send prompt') ||
        text.includes('send message') ||
        text.includes('send') ||
        text.includes('发送') ||
        text.includes('提交'))
    );
  };
  const buttons = [...composer.querySelectorAll('button')].filter(visible) as HTMLButtonElement[];
  const sendButton =
    buttons.find(isSendButton) ||
    (textboxBox
      ? buttons
          .map((button) => ({ button, box: button.getBoundingClientRect(), text: `${button.textContent || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.getAttribute('data-testid') || ''}`.toLowerCase() }))
          .filter(({ button, box, text }) => {
            const notAux = !text.includes('attach') && !text.includes('upload') && !text.includes('附件') && !text.includes('上传') && !text.includes('voice') && !text.includes('mic');
            return notAux && box.left >= textboxBox.right - 120 && box.top >= textboxBox.top - 20 && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
          })
          .sort((a, b) => b.box.left - a.box.left || b.box.top - a.box.top)[0]?.button
      : undefined);
  if (!sendButton) return false;
  sendButton.click();
  return true;
});

const sendButtonTargetScript = pageScript(() => {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (element: Element) =>
    `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
  const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
    .filter(visible) as HTMLElement[];
  const textbox =
    textboxes.find((element) => element.id === 'prompt-textarea') ||
    textboxes.find((element) => /message|ask|chatgpt|\u6d88\u606f|\u8be2\u95ee|\u95ee\u95ee/.test(textOf(element))) ||
    textboxes[textboxes.length - 1];
  const composer =
    textbox?.closest('form') ||
    textbox?.closest('[data-testid*="composer"]') ||
    textbox?.closest('[class*="composer"]');
  if (!textbox || !composer) return { found: false, enabled: false, label: 'composer-not-found' };
  const textboxBox = textbox.getBoundingClientRect();
  const buttons = [...composer.querySelectorAll<HTMLButtonElement>('button')].filter(visible);
  const explicit = buttons.find((button) => {
    const marker = textOf(button);
    return button.getAttribute('data-testid') === 'send-button' ||
      button.getAttribute('data-testid') === 'composer-submit-button' ||
      /send prompt|send message|send|submit|\u53d1\u9001|\u63d0\u4ea4/.test(marker);
  });
  const positional = buttons
    .map((button) => ({ button, box: button.getBoundingClientRect(), marker: textOf(button) }))
    .filter(({ box, marker }) =>
      !/attach|upload|voice|mic|\u9644\u4ef6|\u4e0a\u4f20/.test(marker) &&
      box.left >= textboxBox.right - 120 && box.top >= textboxBox.top - 20
    )
    .sort((left, right) => right.box.left - left.box.left || right.box.top - left.box.top)[0]?.button;
  const button = explicit || positional;
  if (!button) return { found: false, enabled: false, label: 'send-button-not-found' };
  const box = button.getBoundingClientRect();
  return {
    found: true,
    enabled: !button.disabled && button.getAttribute('aria-disabled') !== 'true',
    label: textOf(button).slice(0, 120),
    x: box.left + box.width / 2,
    y: box.top + box.height / 2
  };
});

const fallbackClickSendScript = pageScript(() => {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (element: Element) =>
    `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
  const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible) as HTMLElement[];
  const textbox =
    textboxes.find((element) => element.id === 'prompt-textarea') ||
    textboxes.find((element) => textOf(element).includes('message')) ||
    textboxes[textboxes.length - 1];
  const composer =
    textbox?.closest('form') ||
    textbox?.closest('[data-testid*="composer"]') ||
    textbox?.closest('[class*="composer"]') ||
    textbox?.parentElement?.parentElement?.parentElement;
  if (!textbox || !composer) return { sent: false, method: 'none', label: 'composer-not-found' };
  const composerBox = (composer as HTMLElement).getBoundingClientRect?.();
  const buttons = [...composer.querySelectorAll('button')].filter(visible) as HTMLButtonElement[];
  const explicit = buttons.find((button) => {
    const text = textOf(button);
    return (
      !button.disabled &&
      button.getAttribute('aria-disabled') !== 'true' &&
      (/send|submit|arrow-up|composer-submit|send-button/i.test(button.getAttribute('data-testid') || '') ||
        text.includes('send') ||
        text.includes('submit') ||
        text.includes('发送') ||
        text.includes('提交'))
    );
  });
  const positional = composerBox
    ? buttons
        .map((button) => ({ button, box: button.getBoundingClientRect(), text: textOf(button) }))
        .filter(({ button, box, text }) => {
          const notAux = !text.includes('attach') && !text.includes('upload') && !text.includes('voice') && !text.includes('mic') && !text.includes('附件') && !text.includes('上传');
          return notAux && box.left > composerBox.left + composerBox.width * 0.6 && box.top > composerBox.top + composerBox.height * 0.35 && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
        })
        .sort((a, b) => b.box.left - a.box.left || b.box.top - a.box.top)[0]?.button
    : undefined;
  const target = explicit || positional;
  if (target) {
    target.click();
    return { sent: true, method: 'button', label: textOf(target).slice(0, 120) };
  }
  textbox.focus();
  textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  textbox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  return { sent: true, method: 'enter', label: 'keyboard-enter' };
});

const sendAcceptedSnapshotScript = (baseline: ChatGptImageBaseline) =>
  pageScript((base: ChatGptImageBaseline) => {
    const present = (element: Element) => {
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (element: Element) =>
      `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
    const textboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(present) as HTMLElement[];
    const textbox =
      textboxes.find((element) => element.id === 'prompt-textarea') ||
      textboxes.find((element) => textOf(element).includes('message') || textOf(element).includes('ask')) ||
      textboxes[textboxes.length - 1];
    const composer =
      textbox?.closest('form') ||
      textbox?.closest('[data-testid*="composer"]') ||
      textbox?.closest('[class*="composer"]') ||
      textbox?.parentElement?.parentElement?.parentElement ||
      document.body;
    const composerText = textbox instanceof HTMLTextAreaElement ? textbox.value.trim() : (textbox?.textContent || '').trim();
    const attachmentCount = [...composer.querySelectorAll('img, canvas, picture, [data-testid*="attachment"], [data-testid*="file"], [class*="attachment"], [class*="upload"], [class*="thumbnail"]')]
      .filter(present)
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const intrinsicSize =
          element instanceof HTMLImageElement
            ? Math.min(element.naturalWidth, element.naturalHeight)
            : element instanceof HTMLCanvasElement
              ? Math.min(element.width, element.height)
              : 0;
        return (box.width >= 24 && box.height >= 24) || intrinsicSize >= 24;
      }).length;
    const stopVisible = [...document.querySelectorAll('button, [role="button"]')]
      .filter(present)
      .some((element) => {
        const text = textOf(element);
        return text.includes('stop') || text.includes('\u505c\u6b62');
      });
    const busyCount = document.querySelectorAll('[aria-busy="true"], [role="progressbar"]').length;
    const userMessageCount = document.querySelectorAll('[data-message-author-role="user"]').length;
    const messageNodeCount = document.querySelectorAll('[data-message-id], [data-testid^="conversation-turn-"], article').length;
    const pageChanged = location.href !== base.pageUrl;
    const newUserMessage = userMessageCount > base.userMessageCount;
    const newMessage = newUserMessage || messageNodeCount > base.messageNodeCount;
    const promptCleared = Boolean(textbox) && !composerText;
    const restrictionPatterns = [
      /请求过于频繁/i,
      /暂时限制.{0,30}(?:访问)?对话记录/i,
      /too many requests/i,
      /rate limit/i
    ];
    const terminalFailure = [...document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"], [data-testid*="toast"], [data-testid*="error"], [role="dialog"]')]
      .filter(present)
      .filter((element) => !element.closest('form, [data-testid*="composer"]'))
      .map((element) => ((element as HTMLElement).innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
      .find((text) => restrictionPatterns.some((pattern) => pattern.test(text))) || '';
    const acceptedReason = newUserMessage
      ? 'new-user-message'
      : stopVisible
        ? 'generation-stop-visible'
        : busyCount > 0 && (newMessage || promptCleared || pageChanged)
          ? 'generation-busy'
          : promptCleared && (newMessage || pageChanged)
            ? 'composer-cleared'
            : '';
    return {
      accepted: Boolean(acceptedReason),
      acceptedReason,
      composerCleared: promptCleared,
      composerTextLength: composerText.length,
      attachmentCount,
      userMessageCount,
      messageNodeCount,
      pageChanged,
      stopVisible,
      busyCount,
      href: location.href,
      terminalFailure: terminalFailure.slice(0, 300)
    };
  }, baseline);

const chatGptQuotaSnapshotScript = pageScript(() => {
  const visible = (element: Element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const quotaPatterns = [
    /(?:you(?:'|’)?ve|you have).{0,60}(?:hit|reached).{0,60}(?:limit|quota)/i,
    /(?:hit|reached).{0,50}(?:maximum|max).{0,60}(?:images?|image generation)/i,
    /can(?:not|'t|’t).{0,30}(?:make|create|generate).{0,30}(?:more )?images?/i,
    /(?:image generation|image creation|generate images?).{0,70}(?:limit|quota|unavailable)/i,
    /(?:not enough|out of).{0,40}(?:credits?|quota)/i,
    /(?:0|no).{0,24}(?:image generations?|images?).{0,24}(?:left|remaining)/i,
    /limit.{0,30}(?:reset|resets)/i,
    /(?:rate limit|too many requests|usage limit|plan limit|high demand)/i,
    /请求过于频繁/i,
    /暂时限制.{0,30}(?:访问)?对话记录/i,
    /(?:upgrade|higher plan).{0,60}(?:image|limit|continue)/i,
    /(?:额度|余额).{0,16}(?:不足|用完|耗尽)/,
    /(?:剩余|可用).{0,16}(?:0|零).{0,16}(?:次|张|额度)/,
    /(?:图片|图像|生成|使用次数|用量).{0,30}(?:达到|已达|超出|超过).{0,16}(?:上限|限制|额度|用量)/,
    /(?:图片|图像|生成|使用次数|用量).{0,30}(?:已用完|用尽|耗尽)/,
    /(?:已达到|已超出|超过).{0,30}(?:上限|限制|额度|用量)/,
    /(?:升级|购买).{0,24}(?:套餐|计划|额度)/,
    /无法.{0,16}(?:创建|生成).{0,16}(?:更多)?(?:图片|图像)/
  ];
  const messageRoots = [...document.querySelectorAll('[data-message-author-role="assistant"], [role="alert"], [role="status"], [aria-live="assertive"], [data-testid*="toast"], [data-testid*="error"], [role="dialog"], [data-message-id], [data-testid^="conversation-turn-"], article')]
    .filter(visible)
    .filter(
      (element) =>
        !element.closest('[data-message-author-role="user"], form, [data-testid*="composer"]') &&
        !element.querySelector('[data-message-author-role="user"]')
    )
    .slice(-10);
  const message =
    messageRoots
      .map((element) => normalizeText((element as HTMLElement).innerText || element.textContent || '').slice(0, 600))
      .find((text) => quotaPatterns.some((pattern) => pattern.test(text))) || '';
  return { quotaExceeded: Boolean(message), message: message.slice(0, 300) };
});

const chatGptConversationAccessRecoveryScript = (dismiss: boolean) => pageScript((shouldDismiss: boolean) => {
  const visible = (element: Element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const restrictionPatterns = [
    /请求过于频繁/i,
    /暂时限制.{0,30}(?:访问)?对话记录/i,
    /too many requests/i,
    /rate limit/i
  ];
  const acknowledgementPatterns = [
    /^明白了$/i,
    /^知道了$/i,
    /^我知道了$/i,
    /^好的$/i,
    /^确定$/i,
    /^关闭$/i,
    /^got it$/i,
    /^understood$/i,
    /^ok(?:ay)?$/i,
    /^dismiss$/i,
    /^close$/i
  ];
  const roots = [...document.querySelectorAll(
    '[role="alert"], [role="status"], [aria-live="assertive"], [data-testid*="toast"], [data-testid*="error"], [role="dialog"], dialog'
  )].filter(visible);
  const root = roots.reverse().find((element) => {
    const text = normalizeText((element as HTMLElement).innerText || element.textContent || '');
    return restrictionPatterns.some((pattern) => pattern.test(text));
  });
  if (!root) {
    return { pageLimited: false, message: '', acknowledgementAvailable: false, acknowledged: false };
  }
  const message = normalizeText((root as HTMLElement).innerText || root.textContent || '').slice(0, 300);
  const acknowledgement = [...root.querySelectorAll('button, [role="button"]')]
    .filter(visible)
    .find((element) => {
      const text = normalizeText(
        `${(element as HTMLElement).innerText || element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`
      );
      return acknowledgementPatterns.some((pattern) => pattern.test(text));
    }) as HTMLElement | undefined;
  if (shouldDismiss && acknowledgement) acknowledgement.click();
  return {
    pageLimited: true,
    message,
    acknowledgementAvailable: Boolean(acknowledgement),
    acknowledged: Boolean(shouldDismiss && acknowledgement)
  };
}, dismiss);

function chatGptRuntimeStatePath() {
  return path.join(appDataDir(), 'chatgpt-automation-runtime.json');
}

async function loadChatGptRuntimeState() {
  if (chatGptSafetyStateLoaded) return;
  chatGptRuntimeLoadPromise ??= (async () => {
    try {
      const stored = JSON.parse(await fs.readFile(chatGptRuntimeStatePath(), 'utf8')) as {
        version?: number;
        lastSubmittedAt?: number;
        conversationAccessBlockedUntil?: number;
        submissionSafetyBlockedUntil?: number;
        submissionSafetyReason?: string;
        recentSamples?: unknown;
        completedSinceRest?: number;
        protectionState?: Partial<ChatGptProtectionState>;
        manualVerificationRequired?: boolean;
        protectionDetectionTimestamps?: unknown;
      };
      if (stored.version !== 1) return;
      lastChatGptSubmissionStartedAt = Math.max(0, Number(stored.lastSubmittedAt) || 0);
      chatGptConversationAccessBlockedUntil = Math.max(0, Number(stored.conversationAccessBlockedUntil) || 0);
      chatGptSubmissionSafetyBlockedUntil = Math.max(0, Number(stored.submissionSafetyBlockedUntil) || 0);
      chatGptSubmissionSafetyReason = typeof stored.submissionSafetyReason === 'string'
        ? stored.submissionSafetyReason.slice(0, 1000)
        : '';
      chatGptRuntimeSamples = normalizeChatGptRuntimeSamples(stored.recentSamples);
      chatGptSubmissionsSinceRest = Math.max(0, Math.min(10, Math.round(Number(stored.completedSinceRest) || 0)));
      chatGptProtectionState = createChatGptProtectionState(stored.protectionState);
      chatGptManualVerificationRequired ||= stored.manualVerificationRequired === true;
      chatGptProtectionDetectionTimestamps = Array.isArray(stored.protectionDetectionTimestamps)
        ? stored.protectionDetectionTimestamps
            .map((value) => Math.max(0, Number(value) || 0))
            .filter((value) => value > Date.now() - 60 * 60 * 1000 && value <= Date.now())
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await appendChatGptAutomationDiagnostic('automation-runtime-state-read-failed', {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      chatGptSafetyStateLoaded = true;
    }
  })();
  return chatGptRuntimeLoadPromise;
}

function persistChatGptRuntimeState() {
  const payload = {
    version: 1,
    lastSubmittedAt: lastChatGptSubmissionStartedAt,
    conversationAccessBlockedUntil: chatGptConversationAccessBlockedUntil,
    submissionSafetyBlockedUntil: chatGptSubmissionSafetyBlockedUntil,
    submissionSafetyReason: chatGptSubmissionSafetyReason,
    recentSamples: chatGptRuntimeSamples,
    completedSinceRest: chatGptSubmissionsSinceRest,
    protectionState: chatGptProtectionState,
    manualVerificationRequired: chatGptManualVerificationRequired,
    protectionDetectionTimestamps: chatGptProtectionDetectionTimestamps,
    updatedAt: Date.now()
  };
  chatGptRuntimeWriteQueue = chatGptRuntimeWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await ensureDir(path.dirname(chatGptRuntimeStatePath()));
      const temporaryPath = `${chatGptRuntimeStatePath()}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
        await fs.rename(temporaryPath, chatGptRuntimeStatePath());
      } finally {
        await fs.unlink(temporaryPath).catch(() => undefined);
      }
    })
    .catch(async (error) => {
      await appendChatGptAutomationDiagnostic('automation-runtime-state-write-failed', {
        message: error instanceof Error ? error.message : String(error)
      });
    });
  return chatGptRuntimeWriteQueue;
}

function rememberChatGptRateLimit(message: string) {
  if (chatGptProtectionState.phase === 'PROTECTION_PAUSED') {
    return true;
  }
  const now = Date.now();
  const escalation = planChatGptProtectionEscalation(chatGptProtectionDetectionTimestamps, now);
  chatGptProtectionDetectionTimestamps = escalation.detectionTimestamps;
  chatGptConversationAccessBlockedUntil = escalation.manualOnly
    ? 0
    : nextChatGptCooldownDeadline(chatGptConversationAccessBlockedUntil, now, escalation.cooldownMs);
  chatGptProtectionState = transitionChatGptProtectionState(
    chatGptProtectionState,
    'detected',
    3
  ).state;
  if (escalation.manualOnly) {
    chatGptProtectionState = transitionChatGptProtectionState(
      chatGptProtectionState,
      'page-still-limited',
      3
    ).state;
  }
  void appendChatGptAutomationDiagnostic('conversation-access-protection-escalated', {
    occurrenceWithinHour: escalation.detectionTimestamps.length,
    cooldownMs: escalation.cooldownMs,
    manualOnly: escalation.manualOnly,
    messageClass: isChatGptConversationAccessLimitedMessage(message) ? 'conversation-access' : 'rate-limit'
  });
  void persistChatGptRuntimeState();
  return true;
}

async function recoverChatGptConversationAccessAfterCooldown(
  event: IpcMainInvokeEvent,
  webContents: ChatGptWebContentsLike,
  options: { manual?: boolean } = {}
) {
  const cooldownUntil = chatGptConversationAccessBlockedUntil;
  const now = Date.now();
  if (
    chatGptProtectionState.phase === 'PROTECTION_PAUSED' &&
    !options.manual
  ) {
    return {
      ok: false as const,
      paused: true as const,
      error: 'ChatGPT 仍处于访问保护状态。冷却结束不会自动恢复；请使用“检查恢复”进行一次只读页面确认。'
    };
  }
  if (cooldownUntil > now) {
    return {
      ok: false as const,
      paused: true as const,
      error: `ChatGPT 访问保护仍在冷却中，约 ${Math.ceil((cooldownUntil - now) / 1000)} 秒后才能检查。`
    };
  }
  if (!await confirmChatGptManualPagesReady(webContents)) {
    return { ok: false as const, paused: true as const, error: chatGptManualVerificationRequired
      ? chatGptManualVerificationMessage : 'ChatGPT 页面还没有稳定就绪，本轮不刷新，请查看窗口后再检查恢复。' };
  }
  if (cooldownUntil <= 0 && chatGptProtectionState.phase !== 'PROTECTION_PAUSED') {
    return { ok: true as const, paused: false as const };
  }

  emitAutomationStatus(event, {
    step: '正在人工检查 ChatGPT 恢复状态',
    detail: '本轮只读取保护提示、输入框和页面稳定性，不会点击“知道了”、刷新或自动恢复批次。',
    level: 'warning',
    pacingMode: 'cooldown',
    cooldownUntil,
    protectionPaused: true
  });

  const quotaState = await evalInPageWithTimeout<{ quotaExceeded: boolean; message: string }>(
    webContents,
    chatGptQuotaSnapshotScript,
    4000
  ).catch(() => undefined);
  if (!quotaState) {
    chatGptConversationAccessBlockedUntil = 0;
    chatGptProtectionState = transitionChatGptProtectionState(
      chatGptProtectionState,
      'page-still-limited',
      3
    ).state;
    await persistChatGptRuntimeState();
    await appendChatGptAutomationDiagnostic('cooldown-recovery-stopped', {
      action: 'page-state-unavailable',
      cooldownUntil
    });
    return {
      ok: false as const,
      paused: true as const,
      error: '五分钟冷却已经结束，但软件无法读取 ChatGPT 页面状态。已停止自动重试并保留断点，请查看窗口确认页面后再次点击继续缺失任务。'
    };
  }
  if (quotaState.quotaExceeded && !isChatGptConversationAccessLimitedMessage(quotaState.message)) {
    chatGptConversationAccessBlockedUntil = 0;
    if (!chatGptManualVerificationRequired) chatGptProtectionState = createChatGptProtectionState();
    await persistChatGptRuntimeState();
    await appendChatGptAutomationDiagnostic('cooldown-recovery-stopped', {
      action: 'other-quota-limit',
      cooldownUntil,
      reason: quotaState.message
    });
    return {
      ok: false as const,
      paused: chatGptManualVerificationRequired,
      error: `ChatGPT 页面仍提示额度或其他限制：${quotaState.message || '当前无法继续生成图片。'} 已停止自动重试并保留断点。`
    };
  }

  const overlayState = await evalInPageWithTimeout<{
    pageLimited: boolean;
    message: string;
    acknowledgementAvailable: boolean;
    acknowledged: boolean;
  }>(webContents, chatGptConversationAccessRecoveryScript(false), 3000).catch(() => undefined);
  const composerState = await waitForStableChatGptProbe(webContents, 8000, true).catch(() => undefined);
  await sleep(1000);
  const stableQuotaState = await evalInPageWithTimeout<{ quotaExceeded: boolean; message: string }>(
    webContents,
    chatGptQuotaSnapshotScript,
    4000
  ).catch(() => undefined);
  const initialPlan = planChatGptCooldownRecovery({
    cooldownUntil,
    now,
    pageLimited: Boolean(quotaState.quotaExceeded || overlayState?.pageLimited || stableQuotaState?.quotaExceeded),
    acknowledgementAvailable: Boolean(overlayState?.acknowledgementAvailable),
    manualCheckRequested: options.manual === true,
    composerReady: isAutomationComposerReady(composerState),
    pageStable: stableQuotaState !== undefined && stableQuotaState.quotaExceeded === quotaState.quotaExceeded
  });
  if (initialPlan.action === 'resume') {
    if (!await confirmChatGptManualPagesReady(webContents)) {
      return { ok: false as const, paused: true as const, error: chatGptManualVerificationMessage };
    }
    // The latch is cleared only by an explicit, successful read-only recovery check.
    chatGptManualVerificationRequired = false;
    chatGptConversationAccessBlockedUntil = 0;
    chatGptProtectionState = transitionChatGptProtectionState(
      chatGptProtectionState,
      'page-recovered',
      3
    ).state;
    await persistChatGptRuntimeState();
    emitAutomationStatus(event, {
      step: 'ChatGPT 冷却检查通过',
      detail: '保护提示已消失，输入框连续稳定可用。再次开始时将先以单路继续缺失任务。',
      level: 'success',
      pacingMode: 'slow',
      cooldownUntil: undefined,
      protectionPaused: false
    });
    await appendChatGptAutomationDiagnostic('cooldown-recovery-completed', {
      action: 'manual-check-passed',
      cooldownUntil
    });
    return { ok: true as const, paused: false as const };
  }

  chatGptConversationAccessBlockedUntil = 0;
  chatGptProtectionState = transitionChatGptProtectionState(
    chatGptProtectionState,
    'page-still-limited',
    3
  ).state;
  await persistChatGptRuntimeState();
  const error = 'ChatGPT 页面尚未通过人工恢复检查。关闭“知道了”不代表服务端保护已经解除；软件不会继续点击，请稍后再次使用“检查恢复”。';
  emitAutomationStatus(event, {
    step: 'ChatGPT 访问保护，任务已安全暂停',
    detail: error,
    level: 'warning',
    pacingMode: 'slow',
    cooldownUntil: undefined,
    protectionPaused: true
  });
  await appendChatGptAutomationDiagnostic('cooldown-recovery-stopped', {
    action: 'manual-check',
    cooldownUntil,
    acknowledgementAvailable: Boolean(overlayState?.acknowledgementAvailable)
  });
  return { ok: false as const, paused: true as const, error };
}

function rememberChatGptConversationAccessLimit(message: string) {
  if (!isChatGptConversationAccessLimitedMessage(message)) return false;
  return rememberChatGptRateLimit(message);
}

function rememberUncertainChatGptSubmission(message: string) {
  chatGptSubmissionSafetyBlockedUntil = nextChatGptCooldownDeadline(
    chatGptSubmissionSafetyBlockedUntil,
    Date.now(),
    chatGptSubmissionSafetyCooldownMs
  );
  chatGptSubmissionSafetyReason = message;
  void persistChatGptRuntimeState();
}

async function assertChatGptAutomationStartAllowed() {
  await loadChatGptRuntimeState();
  if (chatGptManualVerificationRequired) throw new ChatGptProtectionPausedError(chatGptManualVerificationMessage);
  if (chatGptWindow && !chatGptWindow.isDestroyed()) {
    await assertChatGptPageOperationAllowed(chatGptWindow.webContents);
  }
  const now = Date.now();
  if (chatGptSubmissionSafetyBlockedUntil > now) {
    throw new Error('上一次发送结果仍无法确认。本轮不会打开对话、上传或发送，请稍后从断点继续。');
  }
  if (chatGptConversationAccessBlockedUntil > now) {
    const remainingSeconds = Math.max(1, Math.ceil((chatGptConversationAccessBlockedUntil - now) / 1000));
    throw new ChatGptProtectionPausedError(
      `ChatGPT 请求过于频繁，访问保护仍在冷却中。本轮保持零点击，约 ${remainingSeconds} 秒后再检查。`
    );
  }
  if (chatGptProtectionState.phase !== 'PROTECTION_PAUSED') return;
  throw new ChatGptProtectionPausedError(
    'ChatGPT 请求过于频繁，访问保护尚未确认恢复。本轮不会打开对话、上传或发送，请先使用“检查恢复”。'
  );
}

async function assertChatGptSubmissionAllowed(webContents: ChatGptWebContentsLike) {
  await assertChatGptPageOperationAllowed(webContents);
  await loadChatGptRuntimeState();
  const now = Date.now();
  if (chatGptSubmissionSafetyBlockedUntil > now) {
    const remainingSeconds = Math.max(1, Math.ceil((chatGptSubmissionSafetyBlockedUntil - now) / 1000));
    throw new Error(
      `上一次发送结果无法确认，为避免重复发送和继续触发访问限制，本批次已停止新提交。请先查看 ChatGPT 页面，并在至少 ${remainingSeconds} 秒后从断点续做。${chatGptSubmissionSafetyReason ? ` 上一次原因：${chatGptSubmissionSafetyReason}` : ''}`
    );
  }
  if (chatGptConversationAccessBlockedUntil > now) {
    const remainingSeconds = Math.max(1, Math.ceil((chatGptConversationAccessBlockedUntil - now) / 1000));
    throw new ChatGptProtectionPausedError(
      `ChatGPT 请求过于频繁，当前仍处于对话记录访问保护期，请稍等几分钟后再重试（至少 ${remainingSeconds} 秒）。`
    );
  }
  if (chatGptProtectionState.phase === 'PROTECTION_PAUSED') {
    throw new ChatGptProtectionPausedError(
      'ChatGPT 请求过于频繁，访问保护尚未确认恢复。软件不会继续点击，请先使用“检查恢复”。'
    );
  }

  const quotaState = await evalInPageWithTimeout<{ quotaExceeded: boolean; message: string }>(
    webContents,
    chatGptQuotaSnapshotScript,
    4000
  ).catch(() => undefined);
  if (!quotaState?.quotaExceeded) return;
  if (rememberChatGptConversationAccessLimit(quotaState.message)) {
    throw new ChatGptProtectionPausedError(
      `ChatGPT 请求过于频繁，已进入访问保护。页面提示：${quotaState.message || '请稍后再试。'}`
    );
  }
  throw new ChatGptQuotaExceededError(`ChatGPT 图片生成额度或频率已达限制。页面提示：${quotaState.message || '当前无法继续生成图片。'}`);
}

async function waitForChatGptSubmissionTurn(event: IpcMainInvokeEvent, webContents: ChatGptWebContentsLike) {
  await loadChatGptRuntimeState();
  if (
    chatGptProtectionState.phase === 'PROTECTION_PAUSED' ||
    chatGptConversationAccessBlockedUntil > Date.now()
  ) {
    throw new ChatGptProtectionPausedError(
      'ChatGPT 访问保护仍在生效。软件不会等待后自动提交，请稍后使用“检查恢复”。'
    );
  }
  const cooldownUntil = Math.max(chatGptConversationAccessBlockedUntil, chatGptSubmissionSafetyBlockedUntil);
  const pacing = planChatGptAdaptivePacing({
    recentSamples: chatGptRuntimeSamples,
    completedSinceRest: chatGptSubmissionsSinceRest,
    cooldownUntil
  });
  chatGptBatchMonitor = {
    ...chatGptBatchMonitor,
    pacingMode: pacing.mode,
    averageDurationMs: pacing.averageDurationMs,
    cooldownUntil: pacing.mode === 'cooldown' ? cooldownUntil : undefined
  };
  if (pacing.waitMs > 0) {
    const waitSeconds = Math.ceil(pacing.waitMs / 1000);
    emitAutomationStatus(event, {
      step: pacing.mode === 'cooldown' ? 'ChatGPT 自动冷却中' : '批次自动休息中',
      detail: pacing.mode === 'cooldown'
        ? `提交安全冷却约 ${waitSeconds} 秒，期间保持零点击；结束后仍会重新确认页面和发送条件。`
        : `已连续完成 10 个任务，休息约 ${waitSeconds} 秒后自动继续。`,
      level: 'warning',
      pacingMode: pacing.mode,
      cooldownUntil: pacing.mode === 'cooldown' ? cooldownUntil : undefined
    });
    await appendChatGptAutomationDiagnostic('adaptive-pacing-wait', {
      mode: pacing.mode,
      waitMs: pacing.waitMs,
      averageDurationMs: pacing.averageDurationMs,
      failureRate: pacing.failureRate
    });
    await waitForChatGptBatchRetry(pacing.waitMs);
    if (chatGptBatchPauseRequested) throw new Error('用户已请求暂停批量任务。');
    if (pacing.mode === 'rest') {
      chatGptSubmissionsSinceRest = 0;
      await persistChatGptRuntimeState();
    }
  }
  await assertChatGptSubmissionAllowed(webContents);
  const delayMs = requiredChatGptSubmissionDelay(
    lastChatGptSubmissionStartedAt,
    Date.now(),
    chatGptProtectionState.phase === 'RECOVERING_ONE_LANE' || chatGptProtectionState.phase === 'RECOVERING_TWO_LANES'
      ? Math.max(pacing.minimumSubmissionIntervalMs, chatGptAdaptiveRecoveryIntervalMs)
      : pacing.minimumSubmissionIntervalMs
  );
  if (delayMs > 0) {
    const delaySeconds = Math.ceil(delayMs / 1000);
    emitAutomationStatus(event, {
      step: '正在错峰提交 ChatGPT',
      detail: `为避免短时间密集请求，将在约 ${delaySeconds} 秒后发送；其他已发送任务仍在并行生成。`,
      level: 'warning'
    });
    await appendChatGptAutomationDiagnostic('submission-pacing-wait', { delayMs });
    await waitForChatGptBatchRetry(delayMs);
    if (chatGptBatchPauseRequested) throw new Error('用户已请求暂停批量任务。');
  }
  await assertChatGptSubmissionAllowed(webContents);
}

async function triggerPacedChatGptSend(event: IpcMainInvokeEvent, webContents: ChatGptWebContentsLike) {
  await waitForChatGptSubmissionTurn(event, webContents);
  lastChatGptSubmissionStartedAt = Date.now();
  await appendChatGptAutomationDiagnostic('submission-attempt', {
    submittedAt: lastChatGptSubmissionStartedAt,
    pendingSubmissions: chatGptSubmissionQueue.pendingCount
  });
  const sent = await triggerChatGptSend(webContents);
  if (sent) chatGptSubmissionsSinceRest += 1;
  await persistChatGptRuntimeState();
  return sent;
}

interface ChatGptAssistantTextSnapshot {
  done: boolean;
  text: string;
  assistantMessageCount: number;
  messageNodeCount: number;
  busyCount: number;
  stopVisible: boolean;
  hasUsefulText: boolean;
  rootStrategy: string;
  candidates: ChatGptAnalysisTextCandidate[];
  errorText?: string;
}

const chatGptAssistantTextSnapshotScript = (baseline: ChatGptImageBaseline) =>
  pageScript((base: ChatGptImageBaseline): ChatGptAssistantTextSnapshot => {
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && element.getClientRects().length > 0;
    };
    const textOf = (element: Element) =>
      `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
    const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
    const promptNeedle = normalizeText(base.promptText).slice(0, 120);
    const composerInputs = [
      ...document.querySelectorAll(
        'textarea[name="prompt-textarea"], #prompt-textarea, [contenteditable="true"][aria-label*="ChatGPT" i], [contenteditable="true"][aria-label*="聊天"], [role="textbox"][aria-label*="ChatGPT" i], [role="textbox"][aria-label*="聊天"]'
      )
    ] as HTMLElement[];
    const composerRoots = composerInputs
      .map(
        (input) =>
          input.closest('form, [data-testid*="composer"], [class*="composer"]') ||
          input.parentElement
      )
      .filter(Boolean) as Element[];
    const isComposerAssociated = (element: Element) =>
      composerInputs.some((input) => input === element || input.contains(element)) ||
      composerRoots.some((root) => root === element || root.contains(element));
    const stopVisible = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .some((element) => {
        const text = textOf(element);
        return text.includes('stop') || text.includes('停止') || text.includes('停止生成');
      });
    const busyCount = [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"], [data-testid*="loading"], [data-testid*="spinner"]')]
      .filter(visible)
      .filter((element) => Boolean(element.closest('main, form, article, [data-message-author-role]'))).length;
    const assistantRoots = [...document.querySelectorAll('[data-turn="assistant"], [data-message-author-role="assistant"]:not([data-turn="assistant"] *)')].filter(visible) as HTMLElement[];
    const messageRoots = [
      ...document.querySelectorAll('[data-message-id], [data-testid^="conversation-turn-"], [data-turn-id], article, [role="article"]')
    ] as HTMLElement[];
    const selectorSets: Array<{ source: string; elements: Element[] }> = [
      { source: 'assistant-role', elements: assistantRoots },
      {
        source: 'assistant-content',
        elements: [
          ...document.querySelectorAll(
            '[data-message-author-role="assistant"] .markdown, [data-message-author-role="assistant"] .prose, [data-message-author-role="assistant"] [data-testid*="response"]'
          )
        ]
      },
      {
        source: 'assistant-code',
        elements: [...document.querySelectorAll('[data-message-author-role="assistant"] pre, [data-message-author-role="assistant"] code')]
      },
      {
        source: 'assistant-testid',
        elements: [...document.querySelectorAll('[data-testid*="assistant-message"], [data-testid*="assistant-response"]')]
      },
      {
        source: 'artifact',
        elements: [
          ...document.querySelectorAll(
            '[data-testid*="artifact"], [data-testid*="document"], [aria-label*="文稿"], [aria-label*="文档"], [aria-label*="artifact" i]'
          )
        ]
      },
      {
        source: 'canvas',
        elements: [
          ...document.querySelectorAll(
            '[data-testid*="canvas"], [aria-label*="画布"], [aria-label*="canvas" i], main [contenteditable="true"]'
          )
        ]
      },
      { source: 'conversation-turn', elements: [...document.querySelectorAll('[data-testid^="conversation-turn-"], [data-turn-id]')] },
      { source: 'message-id', elements: [...document.querySelectorAll('main [data-message-id]')] },
      { source: 'article', elements: [...document.querySelectorAll('main article, main [role="article"]')] },
      { source: 'markdown', elements: [...document.querySelectorAll('main .markdown, main [class*="markdown"]')] },
      { source: 'prose', elements: [...document.querySelectorAll('main .prose, main [class*="prose"]')] },
      { source: 'message-testid', elements: [...document.querySelectorAll('main [data-testid*="message"]')] }
    ];
    const structuredPatterns = [
      /sceneDescription|场景描述|原图场景/,
      /poseDescription|姿态描述|动作描述|身体姿态/,
      /faceDirectionDescription|面部朝向|脸部朝向/,
      /lightingMakeupDescription|光影妆容|光线妆容/,
      /precisionNotes|编辑约束|红圈外完全不变/
    ];
    const sourceRank: Record<string, number> = {
      'assistant-role': 8,
      'assistant-content': 7.8,
      'assistant-code': 7.6,
      'assistant-testid': 7.4,
      artifact: 7.2,
      canvas: 7,
      'conversation-turn': 6,
      'message-id': 5,
      article: 4,
      markdown: 3,
      prose: 2,
      'message-testid': 1
    };
    const candidateByText = new Map<string, ChatGptAnalysisTextCandidate>();
    let candidateDomIndex = 0;
    for (const set of selectorSets) {
      for (const element of set.elements) {
        candidateDomIndex += 1;
        if (!visible(element)) continue;
        const composerAssociated = isComposerAssociated(element);
        const text = normalizeText(
          element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
            ? element.value
            : (element as HTMLElement).innerText || element.textContent || ''
        );
        if (text.length < 20) continue;
        const roleRoot = element.closest('[data-message-author-role], [data-turn]');
        const role = roleRoot?.getAttribute('data-message-author-role') || roleRoot?.getAttribute('data-turn') || '';
        const messageRoot = element.closest(
          '[data-message-id], [data-testid^="conversation-turn-"], [data-turn-id], article, [role="article"]'
        );
        const messageIndex = messageRoot ? messageRoots.indexOf(messageRoot as HTMLElement) : -1;
        const promptEcho = promptNeedle.length >= 20 && text.includes(promptNeedle);
        const userAssociated =
          role === 'user' ||
          Boolean(element.closest('[data-message-author-role="user"]')) ||
          Boolean(element.querySelector('[data-message-author-role="user"]')) ||
          promptEcho;
        const structuredFieldHits = structuredPatterns.filter((pattern) => pattern.test(text)).length;
        const pendingOnly =
          /^(正在思考|思考中|正在生成|generating|thinking|working|analyzing|分析中)[.…。·\s]*$/i.test(text) ||
          (text.length < 100 && /正在思考|思考中|正在生成|thinking|generating/i.test(text));
        const isNew =
          messageIndex >= base.messageNodeCount ||
          (set.source === 'assistant-role' && assistantRoots.indexOf(element as HTMLElement) >= base.assistantMessageCount);
        const assistantAssociated =
          role === 'assistant' ||
          set.source === 'assistant-role' ||
          set.source === 'assistant-content' ||
          set.source === 'assistant-code' ||
          set.source === 'assistant-testid' ||
          ((set.source === 'artifact' || set.source === 'canvas') &&
            structuredFieldHits >= 3 &&
            !composerAssociated) ||
          (isNew && !userAssociated && !composerAssociated) ||
          (structuredFieldHits >= 3 && !userAssociated && !composerAssociated);
        const candidate: ChatGptAnalysisTextCandidate = {
          text: text.slice(0, 16000),
          source: set.source,
          domIndex: messageIndex >= 0 ? messageIndex : candidateDomIndex,
          isNew,
          assistantAssociated,
          userAssociated,
          composerAssociated,
          promptEcho,
          structuredFieldHits,
          pendingOnly
        };
        const existing = candidateByText.get(candidate.text);
        const quality = (value: ChatGptAnalysisTextCandidate) =>
          value.structuredFieldHits * 10 +
          (value.isNew ? 5 : 0) +
          (value.assistantAssociated ? 4 : 0) +
          (sourceRank[value.source] || 0);
        if (!existing || quality(candidate) > quality(existing)) candidateByText.set(candidate.text, candidate);
      }
    }
    const candidates = [...candidateByText.values()]
      .sort(
        (left, right) =>
          right.structuredFieldHits - left.structuredFieldHits ||
          Number(right.isNew) - Number(left.isNew) ||
          Number(right.assistantAssociated) - Number(left.assistantAssociated) ||
          right.domIndex - left.domIndex ||
          right.text.length - left.text.length
      )
      .slice(0, 24);
    const selected =
      candidates.find(
        (candidate) =>
          !candidate.userAssociated &&
          !candidate.composerAssociated &&
          !candidate.promptEcho &&
          !candidate.pendingOnly &&
          candidate.structuredFieldHits >= 3
      ) ||
      candidates.find(
        (candidate) =>
          !candidate.userAssociated &&
          !candidate.composerAssociated &&
          !candidate.promptEcho &&
          !candidate.pendingOnly &&
          candidate.isNew &&
          candidate.assistantAssociated &&
          candidate.text.length >= 40
      );
    const text = selected?.text || '';
    const errorText =
      candidates
        .filter((candidate) => !candidate.userAssociated && !candidate.composerAssociated && candidate.text.length <= 500)
        .map((candidate) => candidate.text)
        .find((value) => /unable|cannot|can't|failed|try again|无法|不能|失败|重试|出错/.test(value.toLowerCase())) || '';
    const hasUsefulText = text.length >= 40 && (text.includes('{') || /场景|姿态|面部|光影|妆容/.test(text));
    return {
      done: hasUsefulText && !stopVisible && busyCount === 0,
      text,
      assistantMessageCount: assistantRoots.length,
      messageNodeCount: messageRoots.length,
      busyCount,
      stopVisible,
      hasUsefulText,
      rootStrategy: selected?.source || 'none',
      candidates,
      errorText: errorText.slice(0, 300)
    };
  }, baseline);

const collectImageBaselineScript = pageScript(() => {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (box.width > 0 && box.height > 0) return true;
    if (element instanceof HTMLImageElement) return element.naturalWidth > 0 && element.naturalHeight > 0;
    if (element instanceof HTMLCanvasElement) return element.width > 0 && element.height > 0;
    return Boolean(element.querySelector('img, picture, a[href], canvas'));
  };
  const normalizeSrc = (src: string) => src.split('#')[0].trim();
  const bestFromSrcset = (srcset: string) => {
    const items = srcset
      .split(',')
      .map((item) => {
        const [url = '', descriptor = ''] = item.trim().split(/\s+/);
        const score = descriptor.endsWith('w') ? Number.parseInt(descriptor, 10) : descriptor.endsWith('x') ? Number.parseFloat(descriptor) * 1000 : 0;
        return { url, score: Number.isFinite(score) ? score : 0 };
      })
      .filter((item) => item.url);
    return items.sort((a, b) => b.score - a.score)[0]?.url || '';
  };
  const backgroundUrls = (element: Element) =>
    [...window.getComputedStyle(element).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => normalizeSrc(match[1] || ''));
  const makeInfo = (element: Element, sourceType: string, source: string, widthHint = 0, heightHint = 0) => {
    const box = element.getBoundingClientRect();
    const src = normalizeSrc(source);
    const width = Math.round(widthHint || box.width || 0);
    const height = Math.round(heightHint || box.height || 0);
    const fingerprint = `${sourceType}|${src}|${width}x${height}`;
    // ChatGPT can reuse a cached image URL in a later response. Keep a node-level
    // marker so the result scan can distinguish an old DOM node from a new reply.
    element.setAttribute('data-xiangmao-before-send-image', fingerprint);
    const role = element.closest('[data-message-author-role]')?.getAttribute('data-message-author-role') || '';
    const inComposer = Boolean(element.closest('form, [data-testid*="composer"], textarea, [contenteditable="true"]'));
    return {
      src,
      fingerprint,
      sourceType,
      width,
      height,
      top: Math.round(box.top),
      left: Math.round(box.left),
      bottom: Math.round(box.bottom),
      role,
      inComposer
    };
  };
  const imageInfo = [
    ...[...document.querySelectorAll('img')]
      .filter(visible)
      .map((image) => makeInfo(image, 'img', image.currentSrc || image.src || bestFromSrcset(image.getAttribute('srcset') || ''), image.naturalWidth, image.naturalHeight)),
    ...[...document.querySelectorAll('picture source')].map((source) => {
      const picture = source.closest('picture') || source;
      return makeInfo(picture, 'picture', bestFromSrcset(source.getAttribute('srcset') || '') || source.getAttribute('src') || '');
    }),
    ...[...document.querySelectorAll('a[href]')]
      .filter(visible)
      .map((link) => makeInfo(link, 'link', (link as HTMLAnchorElement).href || '')),
    ...[...document.querySelectorAll('canvas')]
      .filter(visible)
      .map((canvas, index) => makeInfo(canvas, 'canvas', `canvas:${index}:${(canvas as HTMLCanvasElement).width}x${(canvas as HTMLCanvasElement).height}`, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height)),
    ...[...document.querySelectorAll('main *, article *, [data-message-author-role] *')]
      .filter(visible)
      .flatMap((element) => backgroundUrls(element).map((url) => makeInfo(element, 'background', url)))
  ].filter((image) => image.src && image.width >= 24 && image.height >= 24);
  const composerTextboxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')] as HTMLElement[];
  const composerTextbox =
    composerTextboxes.find((element) => element.id === 'prompt-textarea') || composerTextboxes[composerTextboxes.length - 1];
  const promptText = composerTextbox instanceof HTMLTextAreaElement ? composerTextbox.value : composerTextbox?.textContent || '';
  return {
    capturedAt: Date.now(),
    pageUrl: location.href,
    promptText: promptText.trim(),
    userMessageCount: document.querySelectorAll('[data-message-author-role="user"]').length,
    messageNodeCount: document.querySelectorAll('[data-message-id], [data-testid^="conversation-turn-"], article').length,
    sources: [...new Set(imageInfo.map((image) => image.src))],
    fingerprints: [...new Set(imageInfo.map((image) => image.fingerprint))],
    assistantMessageCount: document.querySelectorAll('[data-turn="assistant"], [data-message-author-role="assistant"]:not([data-turn="assistant"] *)').length,
    images: imageInfo
  };
});

const generatedImageSnapshotScript = (baseline: ChatGptImageBaseline) =>
  pageScript((base: ChatGptImageBaseline) => {
    const knownSources = new Set(base.sources);
    const knownFingerprints = new Set(base.fingerprints);
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1 && element.getClientRects().length > 0;
    };
    const normalizeSrc = (src: string) => src.split('#')[0].trim();
    const bestFromSrcset = (srcset: string) => {
      const items = srcset
        .split(',')
        .map((item) => {
          const [url = '', descriptor = ''] = item.trim().split(/\s+/);
          const score = descriptor.endsWith('w') ? Number.parseInt(descriptor, 10) : descriptor.endsWith('x') ? Number.parseFloat(descriptor) * 1000 : 0;
          return { url, score: Number.isFinite(score) ? score : 0 };
        })
        .filter((item) => item.url);
      return items.sort((a, b) => b.score - a.score)[0]?.url || '';
    };
    const backgroundUrls = (element: Element) =>
      [...window.getComputedStyle(element).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => normalizeSrc(match[1] || ''));
    const textOf = (element: Element) =>
      `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
    const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
    const promptNeedle = normalizeText(base.promptText).slice(0, 80);
    const stopVisible = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .filter((element) => Boolean(element.closest('main, form, article, [data-message-author-role]')))
      .some((element) => {
        const text = textOf(element);
        return text.includes('stop') || text.includes('停止') || text.includes('停止生成');
      });
    const busyCount = [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"], [data-testid*="loading"], [data-testid*="spinner"]')]
      .filter(visible)
      .filter((element) => Boolean(element.closest('main, form, article, [data-message-author-role]'))).length;
    const assistantRoots = [...document.querySelectorAll('[data-turn="assistant"], [data-message-author-role="assistant"]:not([data-turn="assistant"] *)')].filter((element) => !element.querySelector('textarea, [contenteditable="true"]')) as HTMLElement[];
    const articles = [...document.querySelectorAll('article')].filter((element) => !element.querySelector('textarea, [contenteditable="true"]')) as HTMLElement[];
    const mainBlocks = [...document.querySelectorAll('main [data-testid], main article, main section, main div')]
      .filter((element) => !element.querySelector('textarea, [contenteditable="true"]'))
      .filter((element) => element.querySelector('img, picture, a[href], canvas, button, [role="button"]')) as HTMLElement[];
    const downloadableBlocks = [...document.querySelectorAll('main *')]
      .filter((element) => /download|下载|open image|view image|copy|复制/i.test(textOf(element)) || element.querySelector('img, picture, a[href], canvas')) as HTMLElement[];
    const quotaPatterns = [
      /(?:you(?:'|’)?ve|you have).{0,60}(?:hit|reached).{0,60}(?:limit|quota)/i,
      /(?:hit|reached).{0,50}(?:maximum|max).{0,60}(?:images?|image generation)/i,
      /can(?:not|'t|’t).{0,30}(?:make|create|generate).{0,30}(?:more )?images?/i,
      /(?:image generation|image creation|generate images?).{0,70}(?:limit|quota|unavailable)/i,
      /(?:not enough|out of).{0,40}(?:credits?|quota)/i,
      /(?:0|no).{0,24}(?:image generations?|images?).{0,24}(?:left|remaining)/i,
      /limit.{0,30}(?:reset|resets)/i,
      /(?:rate limit|too many requests|usage limit|plan limit|high demand)/i,
      /(?:upgrade|higher plan).{0,60}(?:image|limit|continue)/i,
      /(?:额度|余额).{0,16}(?:不足|用完|耗尽)/,
      /(?:剩余|可用).{0,16}(?:0|零).{0,16}(?:次|张|额度)/,
      /(?:图片|图像|生成|使用次数|用量).{0,30}(?:达到|已达|超出|超过).{0,16}(?:上限|限制|额度|用量)/,
      /(?:图片|图像|生成|使用次数|用量).{0,30}(?:已用完|用尽|耗尽)/,
      /(?:已达到|已超出|超过).{0,30}(?:上限|限制|额度|用量)/,
      /(?:升级|购买).{0,24}(?:套餐|计划|额度)/,
      /无法.{0,16}(?:创建|生成).{0,16}(?:更多)?(?:图片|图像)/
    ];
    const messageRoots = [...new Set(document.querySelectorAll('[data-message-id], [data-testid^="conversation-turn-"], article'))] as HTMLElement[];
    const newAssistantRoots = assistantRoots.slice(base.assistantMessageCount);
    const newMessageRoots = messageRoots.slice(base.messageNodeCount);
    const alertRoots = [...document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"], [data-testid*="toast"], [data-testid*="error"], [role="dialog"]')]
      .filter(visible) as HTMLElement[];
    const quotaNoticeRoots = [...new Set([...alertRoots, ...assistantRoots, ...messageRoots.slice(-6)])].filter((element) => {
      if (
        element.closest('[data-message-author-role="user"], form, [data-testid*="composer"]') ||
        element.querySelector('[data-message-author-role="user"]')
      )
        return false;
      const normalized = normalizeText(element.textContent || '');
      return !(promptNeedle.length >= 20 && normalized.includes(promptNeedle));
    });
    const quotaMessage =
      quotaNoticeRoots
        .map((element) => normalizeText((element as HTMLElement).innerText || element.textContent || '').slice(0, 600))
        .find((text) => quotaPatterns.some((pattern) => pattern.test(text))) || '';
    const quotaExceeded = Boolean(quotaMessage);
    const rootSets = [
      { strategy: 'assistant-role', roots: assistantRoots, start: base.assistantMessageCount },
      { strategy: 'article', roots: articles, start: Math.max(0, articles.length - 2) },
      { strategy: 'main-block', roots: mainBlocks, start: Math.max(0, mainBlocks.length - 5) },
      { strategy: 'downloadable-block', roots: downloadableBlocks, start: Math.max(0, downloadableBlocks.length - 5) },
      { strategy: 'global-new-image', roots: [document.body], start: 0 }
    ].filter((set) => set.roots.length > 0);
    const decorativePattern = /avatar|icon|logo|sprite|emoji|favicon|profile|userpic|button|mask|thumbnail|thumb/i;
    const imageLikeHref = (href: string) => /^(blob:|data:image\/|https?:\/\/)/i.test(href) && !/\.(js|css|html)(?:[?#]|$)/i.test(href);
    const rejected: Record<string, number> = {};
    const reject = (reason: string) => {
      rejected[reason] = (rejected[reason] || 0) + 1;
      return false;
    };
    const makeCandidate = (element: Element, sourceType: string, source: string, widthHint = 0, heightHint = 0, dataUrl = '') => {
      const box = element.getBoundingClientRect();
      const src = normalizeSrc(source || dataUrl);
      const width = Math.round(widthHint || box.width || 0);
      const height = Math.round(heightHint || box.height || 0);
      const fingerprint = `${sourceType}|${src}|${width}x${height}`;
      const srcKind = src.startsWith('blob:') ? 'blob' : src.startsWith('data:') ? 'data' : src.startsWith('http') ? 'remote' : sourceType;
      const roleRoot = element.closest('[data-message-author-role], [data-turn]');
      const role = roleRoot?.getAttribute('data-message-author-role') || roleRoot?.getAttribute('data-turn') || '';
      const messageRoot = element.closest('[data-message-id], [data-testid^="conversation-turn-"], article');
      const messageIndex = messageRoot ? messageRoots.indexOf(messageRoot as HTMLElement) : -1;
      const messageText = normalizeText(messageRoot?.textContent || '');
      const isPromptEcho = promptNeedle.length >= 20 && messageText.includes(promptNeedle);
      const contextRoot = messageRoot || roleRoot || element.parentElement;
      const contextText = contextRoot ? textOf(contextRoot) : '';
      const isInNewResponse =
        newAssistantRoots.some((root) => root === element || root.contains(element)) ||
        newMessageRoots.some((root) => root === element || root.contains(element));
      const generationControlEvidence = Boolean(
        contextRoot &&
          (/download|open image|view image|edit image|copy image|share image|\u4e0b\u8f7d|\u6253\u5f00\u56fe\u7247|\u67e5\u770b\u56fe\u7247|\u7f16\u8f91\u56fe\u7247|\u590d\u5236\u56fe\u7247/.test(contextText) ||
            contextRoot.querySelector('[download], [data-testid*="download"], [aria-label*="download" i], [aria-label*="image" i]'))
      );
      const isUserAttachment = Boolean(element.closest('[data-message-author-role="user"], form, [data-testid*="composer"]')) || role === 'user' || isPromptEcho;
      const assistantAssociated =
        role === 'assistant' ||
        (messageIndex >= base.messageNodeCount && messageIndex >= 0 && !isUserAttachment) ||
        isInNewResponse ||
        generationControlEvidence;
      return {
        src,
        fingerprint,
        sourceType,
        width,
        height,
        top: Math.round(box.top),
        left: Math.round(box.left),
        bottom: Math.round(box.bottom),
        area: width * height,
        srcKind,
        loaded: width >= 256 && height >= 256,
        assistantIndex: -1,
        messageIndex,
        assistantAssociated,
        generationControlEvidence,
        domSignature: `${sourceType}:${Math.round(box.top)}:${Math.round(box.left)}:${width}x${height}`,
        dataUrl,
        isKnown: knownSources.has(src) || knownFingerprints.has(fingerprint),
        isPreexistingNode: element.getAttribute('data-xiangmao-before-send-image') === fingerprint,
        isInNewResponse,
        isUserAttachment,
        isDecorative: decorativePattern.test(`${element.getAttribute('alt') || ''} ${element.getAttribute('class') || ''} ${element.getAttribute('aria-label') || ''} ${src}`)
      };
    };
    const candidatesWithStrategy = rootSets.flatMap((set) =>
      set.roots.slice(set.start).flatMap((root, rootOffset) => {
        const rootIndex = set.start + rootOffset;
        const raw = [
          ...[...root.querySelectorAll('img')].map((image) =>
            makeCandidate(image, 'img', image.currentSrc || image.src || bestFromSrcset(image.getAttribute('srcset') || ''), image.naturalWidth, image.naturalHeight)
          ),
          ...[...root.querySelectorAll('picture source')].map((source) => {
            const picture = source.closest('picture') || source;
            return makeCandidate(picture, 'picture', bestFromSrcset(source.getAttribute('srcset') || '') || source.getAttribute('src') || '');
          }),
          ...[...root.querySelectorAll('a[href]')]
            .filter((link) => imageLikeHref((link as HTMLAnchorElement).href || ''))
            .map((link) => {
              const nestedImage = link.querySelector('img');
              const downloadHint = link.hasAttribute('download') || /download|\u4e0b\u8f7d/.test(textOf(link));
              return makeCandidate(
                link,
                'link',
                (link as HTMLAnchorElement).href || '',
                nestedImage?.naturalWidth || (downloadHint ? 512 : 0),
                nestedImage?.naturalHeight || (downloadHint ? 512 : 0)
              );
            }),
          ...[...root.querySelectorAll('canvas')].map((canvas, index) => {
            let dataUrl = '';
            try {
              dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png');
            } catch {
              dataUrl = '';
            }
            return makeCandidate(canvas, 'canvas', `canvas:${rootIndex}:${index}:${(canvas as HTMLCanvasElement).width}x${(canvas as HTMLCanvasElement).height}`, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height, dataUrl);
          }),
          ...[root, ...root.querySelectorAll('*')].flatMap((element) => backgroundUrls(element).map((url) => makeCandidate(element, 'background', url)))
        ];
        return raw.map((candidate) => ({ ...candidate, assistantIndex: rootIndex, rootStrategy: set.strategy }));
      })
    );
    const strategyRank: Record<string, number> = {
      'assistant-role': 0,
      article: 1,
      'main-block': 2,
      'downloadable-block': 3,
      'global-new-image': 4
    };
    const uniqueCandidates = new Map<string, (typeof candidatesWithStrategy)[number]>();
    for (const candidate of candidatesWithStrategy) {
      const key = `${candidate.sourceType}|${candidate.src}|${candidate.width}x${candidate.height}`;
      const previous = uniqueCandidates.get(key);
      const candidateIsPreferred =
        !previous ||
        (candidate.isInNewResponse && !previous.isInNewResponse) ||
        (!candidate.isPreexistingNode && previous.isPreexistingNode) ||
        (candidate.isInNewResponse === previous.isInNewResponse &&
          candidate.isPreexistingNode === previous.isPreexistingNode &&
          (strategyRank[candidate.rootStrategy] ?? 99) < (strategyRank[previous.rootStrategy] ?? 99));
      if (candidateIsPreferred) {
        uniqueCandidates.set(key, candidate);
      }
    }
    const candidates = [...uniqueCandidates.values()]
      .filter((candidate) => candidate.src || candidate.dataUrl || reject('empty-source'))
      .filter((candidate) => candidate.sourceType !== 'canvas' || Boolean(candidate.dataUrl) || reject('unreadable-canvas'))
      .filter((candidate) => !candidate.isUserAttachment || reject('user-attachment'))
      .filter((candidate) => !candidate.isPreexistingNode || candidate.isInNewResponse || reject('preexisting-node'))
      .filter((candidate) => !candidate.isKnown || candidate.isInNewResponse || candidate.generationControlEvidence || reject('known-before-send'))
      .filter((candidate) => candidate.assistantAssociated || candidate.isInNewResponse || candidate.generationControlEvidence || reject('not-assistant-associated'))
      .filter((candidate) => !candidate.isDecorative || reject('decorative'))
      .filter((candidate) => candidate.loaded || reject('too-small-or-not-loaded'))
      .filter((candidate) => candidate.area >= 256 * 256 || reject('small-area'))
      .sort((a, b) => b.messageIndex - a.messageIndex || b.assistantIndex - a.assistantIndex || b.area - a.area || b.bottom - a.bottom)
      .map((candidate) => ({
        src: candidate.src,
        fingerprint: candidate.fingerprint,
        sourceType: candidate.sourceType,
        width: candidate.width,
        height: candidate.height,
        top: candidate.top,
        left: candidate.left,
        bottom: candidate.bottom,
        area: candidate.area,
        srcKind: candidate.srcKind,
        loaded: candidate.loaded,
        assistantIndex: candidate.assistantIndex,
        messageIndex: candidate.messageIndex,
        assistantAssociated: candidate.assistantAssociated,
        generationControlEvidence: candidate.generationControlEvidence,
        domSignature: candidate.domSignature,
        dataUrl: candidate.dataUrl,
        rootStrategy: candidate.rootStrategy
      }));

    const newResponseRoots = assistantRoots.length > base.assistantMessageCount
      ? assistantRoots.slice(base.assistantMessageCount)
      : messageRoots
          .slice(base.messageNodeCount)
          .filter((element) => !element.closest('[data-message-author-role="user"]') && !element.querySelector('[data-message-author-role="user"]'));
    const terminalFailure =
      newResponseRoots
        .map((element) => normalizeText((element as HTMLElement).innerText || element.textContent || '').slice(0, 500))
        .find((text) =>
          /(?:could not|couldn't|unable to|failed to|can(?:not|'t))\s+(?:create|generate|make).{0,40}(?:image|picture)|image generation failed|something went wrong.{0,40}(?:image|generation)|(?:抱歉.{0,24})?未能成功生成.{0,20}(?:图片|图像)|(?:图片|图像)生成过程中.{0,24}(?:错误|失败)|无法.{0,20}(?:创建|生成).{0,20}(?:图片|图像)|(?:图片|图像).{0,20}生成失败/.test(text)
        ) || '';

    return {
      busy: busyCount > 0,
      busyCount,
      stopVisible,
      quotaExceeded,
      quotaMessage: quotaMessage.slice(0, 300),
      assistantMessageCount: assistantRoots.length,
      messageNodeCount: document.querySelectorAll('[data-message-id], [data-testid^="conversation-turn-"], article').length,
      candidates,
      rootStrategy: candidates[0]?.rootStrategy || rootSets[0]?.strategy || 'none',
      rejected,
      terminalFailure: terminalFailure.slice(0, 300),
      reason: candidates.length ? 'candidate-found' : 'waiting-for-generated-image'
    };
  }, baseline);

const candidateToPngDataUrlScript = (candidate: ChatGptGeneratedCandidate) =>
  pageScript(async (item: ChatGptGeneratedCandidate) => {
    const withDeadline = async <T>(
      promise: Promise<T>,
      timeoutMs: number,
      label: string,
      disposeLateValue?: (value: T) => void
    ) => {
      let timeoutId = 0;
      let expired = false;
      const guardedPromise = promise.then((value) => {
        if (expired) {
          disposeLateValue?.(value);
          throw new Error(`${label}-timeout`);
        }
        return value;
      });
      try {
        return await Promise.race([
          guardedPromise,
          new Promise<T>((_resolve, reject) => {
            timeoutId = window.setTimeout(() => {
              expired = true;
              reject(new Error(`${label}-timeout`));
            }, timeoutMs);
          })
        ]);
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
      }
    };
    const fetchBlobWithDeadline = async (input: RequestInfo | URL, timeoutMs: number, label: string) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(input, { signal: controller.signal });
        const blob = await response.blob();
        return { response, blob };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw new Error(`${label}-timeout`);
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
    };
    const blobToPng = async (blob: Blob) => {
      const bitmap = await withDeadline(createImageBitmap(blob), 4000, 'image-decode', (lateBitmap) => lateBitmap.close());
      try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建图片转换画布。');
        context.drawImage(bitmap, 0, 0);
        return { dataUrl: canvas.toDataURL('image/png'), width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close();
      }
    };
    if (item.sourceType === 'canvas' && item.dataUrl?.startsWith('data:image/')) {
      return { dataUrl: item.dataUrl, width: item.width, height: item.height };
    }
    if (item.src?.startsWith('data:image/')) {
      const { blob } = await fetchBlobWithDeadline(item.src, 5000, 'data-image-read');
      return blobToPng(blob);
    }
    if (!item.src) throw new Error('候选图片没有可读取的地址。');
    const { response, blob } = await fetchBlobWithDeadline(item.src, 14000, 'generated-image-read');
    if (!response.ok) throw new Error(`页面内读取图片失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/') && !blob.type.startsWith('image/')) {
      throw new Error(`候选资源不是图片：${contentType || blob.type || 'unknown'}`);
    }
    return blobToPng(blob);
  }, candidate);

async function fetchRemoteImageAsPng(webContents: ChatGptWebContentsLike, candidate: ChatGptGeneratedCandidate) {
  if (!/^https?:\/\//i.test(candidate.src)) throw new Error('候选图片不是可由主进程兜底读取的远程地址。');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  const response = await webContents.session
    .fetch(candidate.src, {
      credentials: 'include',
      referrer: webContents.getURL() || 'https://chatgpt.com/',
      signal: controller.signal
    })
    .finally(() => clearTimeout(timeoutId));
  if (!response.ok) throw new Error(`主进程读取远程图片失败：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const arrayBuffer = await response.arrayBuffer();
  const input = Buffer.from(arrayBuffer);
  if (input.length < 1024) throw new Error(`远程图片数据过小：${contentType || 'unknown'}，${input.length} bytes`);
  const converted = nativeImage.createFromBuffer(input);
  if (converted.isEmpty()) throw new Error(`Electron 无法解码远程图片：${contentType || 'unknown'}。`);
  const png = converted.toPNG();
  return {
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    width: converted.getSize().width,
    height: converted.getSize().height
  };
}

async function readGeneratedCandidateImage(webContents: ChatGptWebContentsLike, candidate: ChatGptGeneratedCandidate) {
  if (candidate.dataUrl?.startsWith('data:image/')) {
    return { dataUrl: candidate.dataUrl, width: candidate.width, height: candidate.height };
  }
  try {
    return await evalInPageWithTimeout<{ dataUrl: string; width?: number; height?: number }>(webContents, candidateToPngDataUrlScript(candidate), 20000);
  } catch (error) {
    console.warn('[ChatGPT image] page extraction failed, trying main-process fallback', {
      error: error instanceof Error ? error.message : String(error),
      sourceType: candidate.sourceType,
      srcKind: candidate.srcKind,
      width: candidate.width,
      height: candidate.height
    });
    return fetchRemoteImageAsPng(webContents, candidate);
  }
}

async function writeGeneratedImageAtomically(filePath: string, buffer: Buffer, target: ImageDimensions) {
  await writeVerifiedJpegAtomically(filePath, buffer, target);
}

function normalizeImageDataUrlToDimensions(dataUrl: string, target: ImageDimensions) {
  return normalizeImageDataUrlToJpeg(dataUrl, target);
}

function generatedImagePreviewDataUrl(buffer: Buffer, width: number, height: number) {
  return jpegPreviewDataUrl(buffer, width, height, 960);
}

async function saveGeneratedImageFromChatGpt(
  webContents: ChatGptWebContentsLike,
  projectName: string,
  promptText: string,
  candidate: ChatGptGeneratedCandidate,
  targetDimensions: ImageDimensions,
  reservedFile?: ResultFileReservation
): Promise<ImageAsset> {
  const image = await readGeneratedCandidateImage(webContents, candidate);
  const readiness = await inspectGeneratedImageBuffer(dataUrlToBuffer(image.dataUrl).buffer);
  if (!readiness.ready) {
    throw new Error(`ChatGPT 返回的结果图仍像是占位图，未保存（${readiness.reason}）。`);
  }
  const normalized = normalizeImageDataUrlToDimensions(image.dataUrl, targetDimensions);
  const dimensionAdjustment = normalized.resized
    ? `ChatGPT 返回 ${normalized.originalWidth}x${normalized.originalHeight}px，已使用最高质量重采样并以 JPG 保存为原图尺寸 ${targetDimensions.width}x${targetDimensions.height}px。`
    : `生成图已转换为手机兼容 JPG，并核验为原图尺寸：${targetDimensions.width}x${targetDimensions.height}px。`;
  const nextFile = reservedFile || (await nextResultFile(projectName));
  await writeGeneratedImageAtomically(nextFile.filePath, normalized.buffer, targetDimensions);
  const previewDataUrl = generatedImagePreviewDataUrl(normalized.buffer, normalized.width, normalized.height);
  console.info('[ChatGPT image] saved generated image', {
    sourceType: candidate.sourceType,
    srcKind: candidate.srcKind,
    detectedWidth: image.width,
    detectedHeight: image.height,
    originalDecodedWidth: normalized.originalWidth,
    originalDecodedHeight: normalized.originalHeight,
    savedWidth: normalized.width,
    savedHeight: normalized.height,
    targetDimensions,
    resizedToOriginalDimensions: normalized.resized,
    aspectRatioChanged: normalized.aspectRatioChanged,
    scaleFactor: normalized.scaleFactor,
    verifiedAfterWrite: true,
    bytes: normalized.buffer.length,
    filePath: nextFile.filePath
  });
  return {
    id: `${Date.now()}_${nextFile.sequence}`,
    name: nextFile.fileName,
    type: 'image/jpeg',
    size: normalized.buffer.length,
    width: normalized.width,
    height: normalized.height,
    dataUrl: previewDataUrl,
    path: nextFile.filePath,
    sequence: nextFile.sequence,
    promptText,
    dimensionAdjustment
  };
}

async function saveGeneratedImageFromGemini(
  webContents: ChatGptWebContentsLike,
  projectName: string,
  promptText: string,
  candidate: GeminiImageCandidate,
  targetDimensions: ImageDimensions,
  reservedFile?: ResultFileReservation
): Promise<ImageAsset> {
  const image = await downloadGeminiImage(webContents, candidate);
  const normalized = normalizeImageDataUrlToDimensions(image.dataUrl, targetDimensions);
  const dimensionAdjustment = normalized.resized
    ? `Gemini 返回 ${normalized.originalWidth}x${normalized.originalHeight}px，已使用最高质量重采样并以 JPG 保存为原图尺寸 ${targetDimensions.width}x${targetDimensions.height}px。`
    : `Gemini 生成图已转换为手机兼容 JPG，并核验为原图尺寸：${targetDimensions.width}x${targetDimensions.height}px。`;
  const nextFile = reservedFile || (await nextResultFile(projectName));
  await writeGeneratedImageAtomically(nextFile.filePath, normalized.buffer, targetDimensions);
  const previewDataUrl = generatedImagePreviewDataUrl(normalized.buffer, normalized.width, normalized.height);
  await appendChatGptAutomationDiagnostic('gemini-generated-image-saved', {
    source: candidate.src,
    detectedWidth: image.width || candidate.width,
    detectedHeight: image.height || candidate.height,
    originalDecodedWidth: normalized.originalWidth,
    originalDecodedHeight: normalized.originalHeight,
    savedWidth: normalized.width,
    savedHeight: normalized.height,
    resizedToOriginalDimensions: normalized.resized,
    verifiedAfterWrite: true,
    bytes: normalized.buffer.length,
    filePath: nextFile.filePath
  });
  return {
    id: `${Date.now()}_${nextFile.sequence}`,
    name: nextFile.fileName,
    type: 'image/jpeg',
    size: normalized.buffer.length,
    width: normalized.width,
    height: normalized.height,
    dataUrl: previewDataUrl,
    path: nextFile.filePath,
    sequence: nextFile.sequence,
    promptText,
    dimensionAdjustment
  };
}

async function saveGeneratedImageFromRelay(
  projectName: string,
  promptText: string,
  result: RelayImageResult,
  targetDimensions: ImageDimensions,
  canvasPlan: RelayCanvasPlan,
  reservedFile?: ResultFileReservation
): Promise<ImageAsset> {
  const nextFile = reservedFile || (await nextResultFile(projectName, 'png'));
  const rawExtension = await relayImageFileExtension(result.bytes);
  const rawDirectory = path.join(nextFile.resultDir, 'API原始图');
  const rawFilePath = path.join(rawDirectory, `${nextFile.baseName}_${nextFile.sequence}_原始.${rawExtension}`);
  await writeRelayOriginalAtomically(rawFilePath, result.bytes);
  const normalized = await normalizeRelayResultToPng(result.bytes, canvasPlan, targetDimensions);
  await writeRelayPngAtomically(nextFile.filePath, normalized.buffer, targetDimensions);
  const previewDataUrl = await relayPngPreviewDataUrl(normalized.buffer);
  const dimensionAdjustment = `API 原始结果已原封不动保存在“API原始图”；正式结果已按临时补边映射裁剪并等比归一为原图尺寸 ${targetDimensions.width}x${targetDimensions.height}px，以无损 PNG 保存，没有进行非等比拉伸。`;
  console.info('[Relay image] saved generated image', {
    source: result.source,
    originalDecodedWidth: normalized.originalWidth,
    originalDecodedHeight: normalized.originalHeight,
    savedWidth: normalized.width,
    savedHeight: normalized.height,
    targetDimensions,
    crop: normalized.crop,
    usedNonUniformStretch: normalized.usedNonUniformStretch,
    rawFilePath,
    rawBytes: result.bytes.length,
    verifiedAfterWrite: true,
    bytes: normalized.buffer.length,
    filePath: nextFile.filePath
  });
  return {
    id: `${Date.now()}_${nextFile.sequence}`,
    name: nextFile.fileName,
    type: 'image/png',
    size: normalized.buffer.length,
    width: normalized.width,
    height: normalized.height,
    dataUrl: previewDataUrl,
    path: nextFile.filePath,
    sequence: nextFile.sequence,
    promptText,
    dimensionAdjustment
  };
}

async function loadSavedRelayImage(
  promptText: string,
  targetDimensions: ImageDimensions,
  reservation: ResultFileReservation
): Promise<ImageAsset | undefined> {
  try {
    const buffer = await fs.readFile(reservation.filePath);
    const dataUrl = await relayPngPreviewDataUrl(buffer);
    return {
      id: `relay-recovered-${reservation.sequence}`,
      name: reservation.fileName,
      type: 'image/png',
      size: buffer.length,
      width: targetDimensions.width,
      height: targetDimensions.height,
      dataUrl,
      path: reservation.filePath,
      sequence: reservation.sequence,
      promptText,
      dimensionAdjustment: `从 API 批次断点恢复；正式结果保持原图尺寸 ${targetDimensions.width}x${targetDimensions.height}px。`
    };
  } catch {
    return undefined;
  }
}

async function waitForStableGeneratedImage(
  event: IpcMainInvokeEvent,
  webContents: ChatGptWebContentsLike,
  baseline: ChatGptImageBaseline
) {
  const startedAt = Date.now();
  let stableKey = '';
  let stableSince = 0;
  let stablePolls = 0;
  let lastSnapshot: ChatGptGeneratedSnapshot | undefined;
  let lastStatusAt = 0;
  let lastReadAttemptAt = 0;
  let settledWithoutImageSince = 0;
  let readinessState: GeneratedImageReadinessState | undefined;
  let readinessCandidateKey = '';
  let protectionSeenAfterSend = false;
  let exitAction: Exclude<ReturnType<typeof planChatGptGenerationWait>['action'], 'continue'> | undefined;

  while (!exitAction) {
    const inspection = await observeChatGptManualIntervention(webContents);
    if (inspection.health.manualIntervention) protectionSeenAfterSend = true;
    let freshSnapshot: ChatGptGeneratedSnapshot | undefined;
    try {
      const snapshot = await evalInPageWithTimeout<ChatGptGeneratedSnapshot>(
        webContents,
        generatedImageSnapshotScript(baseline),
        6000
      );
      freshSnapshot = snapshot;
      lastSnapshot = snapshot;
      if (snapshot.quotaExceeded) {
        const pageReason = snapshot.quotaMessage || 'ChatGPT 提示当前无法继续生成图片。';
        if (isChatGptConversationAccessLimitedMessage(pageReason)) {
          if (!protectionSeenAfterSend) {
            rememberChatGptConversationAccessLimit(pageReason);
            emitAutomationStatus(event, {
              step: 'ChatGPT 访问保护，任务已安全暂停',
              detail: '已发送任务仍会在当前页面继续等待并尝试保存结果；软件不会再分配、上传或发送新任务。',
              level: 'warning',
              pacingMode: 'cooldown',
              cooldownUntil: chatGptConversationAccessBlockedUntil,
              protectionPaused: true
            });
          }
          protectionSeenAfterSend = true;
        } else {
          const message = `ChatGPT 图片生成额度或频率已达限制。页面提示：${pageReason}`;
          console.warn('[ChatGPT quota] generation cannot continue', { pageReason });
          emitAutomationStatus(event, {
            step: 'ChatGPT 图片生成额度不足',
            detail: `${message} 本批次已停止，请等待额度恢复或升级 ChatGPT 套餐后再试。`,
            level: 'error'
          });
          throw new ChatGptQuotaExceededError(message);
        }
      }
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= 10000 && snapshot.terminalFailure && !snapshot.busy && !snapshot.stopVisible && snapshot.candidates.length === 0) {
        throw new ChatGptTerminalGenerationError(`ChatGPT 本轮明确返回了生成失败信息：${snapshot.terminalFailure}`);
      }
      const candidate = snapshot.candidates[0];
      const elapsedSeconds = Math.round(elapsedMs / 1000);
      const remainingSeconds = Math.max(0, Math.ceil((chatGptGenerationHardTimeoutMs - elapsedMs) / 1000));

      if (Date.now() - lastStatusAt > 7000) {
        console.info('[ChatGPT image] poll generated candidates', {
          candidates: snapshot.candidates.length,
          rootStrategy: snapshot.rootStrategy,
          rejected: snapshot.rejected,
          busy: snapshot.busy,
          stopVisible: snapshot.stopVisible,
          quotaExceeded: snapshot.quotaExceeded,
          quotaMessage: snapshot.quotaMessage,
          assistantMessageCount: snapshot.assistantMessageCount,
          messageNodeCount: snapshot.messageNodeCount,
          firstCandidate: candidate
            ? {
                sourceType: candidate.sourceType,
                srcKind: candidate.srcKind,
                width: candidate.width,
                height: candidate.height,
                area: candidate.area
              }
            : undefined
        });
        emitAutomationStatus(event, {
          step: candidate ? '正在检测生成结果' : '正在等待 ChatGPT 生成图片',
          detail: candidate
            ? `已找到候选结果图 ${candidate.width}x${candidate.height}，等待页面停止生成并确认图片稳定。`
            : `已等待 ${elapsedSeconds} 秒，剩余最多 ${remainingSeconds} 秒；正在排除上传附件和历史图片。`
        });
        lastStatusAt = Date.now();
      }

      if (candidate && candidate.loaded) {
        const nextStableKey = `${candidate.sourceType}|${candidate.messageIndex}|${candidate.assistantIndex}|${candidate.width}x${candidate.height}|${candidate.rootStrategy || ''}`;
        if (nextStableKey !== readinessCandidateKey) {
          readinessCandidateKey = nextStableKey;
          readinessState = undefined;
        }
        if (nextStableKey === stableKey) {
          stablePolls += 1;
        } else {
          stableKey = nextStableKey;
          stableSince = Date.now();
          stablePolls = 1;
        }
        const stableForMs = Date.now() - stableSince;
        const generationControlActive = snapshot.busy || snapshot.stopVisible;
        if (generationControlActive) readinessState = undefined;
        const pageSettled = !generationControlActive;
        if (pageSettled && stablePolls >= 3 && stableForMs >= 5000 && Date.now() - lastReadAttemptAt >= 5000) {
          lastReadAttemptAt = Date.now();
          try {
            const readableImage = await readGeneratedCandidateImage(webContents, candidate);
            const readableBuffer = dataUrlToBuffer(readableImage.dataUrl).buffer;
            if (!readableImage.dataUrl.startsWith('data:image/') || readableBuffer.length < 1024) {
              throw new Error(`结果图数据校验失败：${readableBuffer.length} bytes`);
            }
            const readiness = await inspectGeneratedImageBuffer(readableBuffer);
            const nextReadinessState = nextGeneratedImageReadinessState(readinessState, readiness, pageSettled);
            readinessState = nextReadinessState;
            if (!readiness.ready) {
              throw new Error(`结果图像素内容尚未就绪：${readiness.reason}，active=${readiness.activePixelRatio.toFixed(3)}，lumaStdDev=${readiness.lumaStdDev.toFixed(2)}。`);
            }
            if (!nextReadinessState.accepted) {
              throw new Error(`结果图像素内容尚未连续稳定：${nextReadinessState.stablePolls}/${2} 次。`);
            }
            console.info('[ChatGPT image] stable result is readable', {
              sourceType: candidate.sourceType,
              srcKind: candidate.srcKind,
              width: readableImage.width || candidate.width,
              height: readableImage.height || candidate.height,
              bytes: readableBuffer.length,
              contentHash: readiness.contentHash,
              activePixelRatio: readiness.activePixelRatio,
              lumaStdDev: readiness.lumaStdDev,
              edgeRatio: readiness.edgeRatio
            });
            return {
              ...candidate,
              dataUrl: readableImage.dataUrl,
              width: readableImage.width || candidate.width,
              height: readableImage.height || candidate.height,
              area: (readableImage.width || candidate.width) * (readableImage.height || candidate.height)
            };
          } catch (error) {
            console.warn('[ChatGPT image] stable candidate was not readable yet; continuing to poll', {
              error: error instanceof Error ? error.message : String(error),
              sourceType: candidate.sourceType,
              srcKind: candidate.srcKind
            });
            await appendChatGptAutomationDiagnostic('generated-candidate-unreadable', {
              error: error instanceof Error ? error.message : String(error),
              sourceType: candidate.sourceType,
              srcKind: candidate.srcKind,
              width: candidate.width,
              height: candidate.height,
              rootStrategy: candidate.rootStrategy,
              stableForMs,
              busyCount: snapshot.busyCount,
              stopVisible: snapshot.stopVisible
            });
          }
        }
      } else if (!candidate) {
        stableKey = '';
        stableSince = 0;
        stablePolls = 0;
        readinessCandidateKey = '';
        readinessState = undefined;
      }
    } catch (error) {
      if (error instanceof ChatGptQuotaExceededError || error instanceof ChatGptTerminalGenerationError) throw error;
      // The page can re-render while ChatGPT is streaming; the immutable deadline still applies.
    }

    if (freshSnapshot) {
      const assistantAdvanced = freshSnapshot.assistantMessageCount > baseline.assistantMessageCount;
      const settledWithoutImage =
        assistantAdvanced &&
        !freshSnapshot.busy &&
        !freshSnapshot.stopVisible &&
        freshSnapshot.candidates.length === 0;
      if (settledWithoutImage) {
        settledWithoutImageSince ||= Date.now();
      } else {
        settledWithoutImageSince = 0;
      }
    }
    const snapshot = freshSnapshot || lastSnapshot;
    const waitPlan = planChatGptGenerationWait({
      elapsedMs: Date.now() - startedAt,
      assistantAdvanced: Boolean(snapshot && snapshot.assistantMessageCount > baseline.assistantMessageCount),
      busy: Boolean(snapshot?.busy),
      stopVisible: Boolean(snapshot?.stopVisible),
      candidateCount: snapshot?.candidates.length || 0,
      settledWithoutImageMs: settledWithoutImageSince ? Date.now() - settledWithoutImageSince : 0
    });
    if (protectionSeenAfterSend && Date.now() - startedAt >= chatGptGenerationHardTimeoutMs) {
      exitAction = 'hard-timeout';
      break;
    }
    if (waitPlan.action !== 'continue' && !protectionSeenAfterSend) {
      exitAction = waitPlan.action;
      break;
    }
    await sleep(Math.min(2500, Math.max(100, chatGptGenerationHardTimeoutMs - (Date.now() - startedAt))));
  }

  const state = lastSnapshot
    ? `最后检测状态：assistant 消息数 ${lastSnapshot.assistantMessageCount}，消息节点 ${lastSnapshot.messageNodeCount}，候选图 ${lastSnapshot.candidates.length}，busy=${lastSnapshot.busy}，stop=${lastSnapshot.stopVisible}。`
    : '最后没有拿到可用的页面检测状态。';
  await appendChatGptAutomationDiagnostic('generated-image-timeout', {
    state,
    exitAction,
    elapsedMs: Date.now() - startedAt,
    candidate: lastSnapshot?.candidates[0]
      ? {
          sourceType: lastSnapshot.candidates[0].sourceType,
          srcKind: lastSnapshot.candidates[0].srcKind,
          width: lastSnapshot.candidates[0].width,
          height: lastSnapshot.candidates[0].height,
          rootStrategy: lastSnapshot.candidates[0].rootStrategy
        }
      : undefined,
    busyCount: lastSnapshot?.busyCount,
    stopVisible: lastSnapshot?.stopVisible,
    rejected: lastSnapshot?.rejected
  });
  const reason = exitAction === 'no-signal'
    ? '发送确认后 60 秒内没有出现新的助手回复或生成状态。'
    : exitAction === 'settled-without-image'
      ? 'ChatGPT 已结束本轮助手回复，但页面连续 15 秒没有出现结果图。'
      : 'ChatGPT 生成等待已达到 3 分钟硬上限。';
  if (protectionSeenAfterSend) {
    throw new ChatGptProtectionPausedError(
      `ChatGPT 访问保护出现后，已发送任务在本轮等待上限内仍未检测到结果图。${state} 当前聊天页和断点已保留，不会自动重发。`
    );
  }
  throw new Error(`已发送，但未检测到 ChatGPT 生成完成的结果图。${reason}${state} 当前聊天页已保留，请人工确认，不会自动重发。`);
}

async function setChatGptFileInputFiles(webContents: ChatGptWebContentsLike, files: string[]) {
  for (const file of files) {
    await fs.access(file).catch(() => {
      throw new Error(`待上传图片不存在：${file}`);
    });
  }
  const marker = `xiangmao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const marked = await evalInPageWithTimeout<{
    selected: boolean;
    inputCount: number;
    scopedCount: number;
    accept: string;
    multiple: boolean;
  }>(webContents, markComposerFileInputScript(marker), 4000);
  if (!marked.selected) throw new Error(`没有找到 ChatGPT composer 的图片上传入口（页面 file input 数量：${marked.inputCount}）。`);
  console.info('[ChatGPT upload] marked composer file input', marked);

  const debuggerApi = webContents.debugger;
  let attachedHere = false;
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach('1.3');
    attachedHere = true;
  }

  try {
    const { root } = (await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true })) as { root: { nodeId: number } };
    const { nodeId } = (await debuggerApi.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: `input[data-xiangmao-upload-target="${marker}"]`
    })) as { nodeId: number };

    if (!nodeId) throw new Error('已经定位 composer 上传入口，但 CDP 无法取得对应节点。');
    await debuggerApi.sendCommand('DOM.setFileInputFiles', {
      nodeId,
      files
    });
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
    await evalInPageWithTimeout<boolean>(
      webContents,
      pageScript((token: string) => {
        document.querySelector(`input[data-xiangmao-upload-target="${token}"]`)?.removeAttribute('data-xiangmao-upload-target');
        return true;
      }, marker),
      1500
    ).catch(() => false);
  }
}

async function dispatchChatGptFileDrop(webContents: ChatGptWebContentsLike, files: string[]) {
  for (const file of files) {
    await fs.access(file).catch(() => {
      throw new Error(`待上传图片不存在：${file}`);
    });
  }
  const dropPoint = await evalInPageWithTimeout<{
    ok: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    textboxCount: number;
    composerText: string;
  }>(webContents, composerDropPointScript, 3500);
  if (!dropPoint.ok) throw new Error('没有找到可接收拖放上传的 ChatGPT 输入区。');

  const debuggerApi = webContents.debugger;
  let attachedHere = false;
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach('1.3');
    attachedHere = true;
  }

  const data = {
    items: [],
    files,
    dragOperationsMask: 1
  };
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await debuggerApi.sendCommand('Input.dispatchDragEvent', {
        type,
        x: dropPoint.x,
        y: dropPoint.y,
        data
      });
      await sleep(type === 'drop' ? 150 : 80);
    }
    console.info('[ChatGPT upload] CDP file drop dispatched', {
      files,
      dropPoint
    });
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
}

async function uploadFilesToChatGptComposer(webContents: ChatGptWebContentsLike, files: string[]) {
  if (files.length > 1) {
    const receipts: Array<{ file: string; method: string; errors: string[] }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const fileName = path.basename(file);
      const beforeFile = await evalInPageWithTimeout<UploadEvidence>(
        webContents,
        uploadAttachmentSnapshotScript([fileName]),
        5000
      ).catch(() => ({ evidenceCount: 0, nameHits: 0, previewCount: 0, removeButtonCount: 0, fileInputCount: 0, busyCount: 0 }));
      const receipt = await uploadFilesToChatGptComposer(webContents, [file]);
      let confirmation = await waitForStableChatGptAttachments(
        webContents,
        [fileName],
        beforeFile,
        12_000
      );
      if (!confirmation?.uploadErrorText && !hasCompleteUploadEvidence(beforeFile, confirmation) && (confirmation?.busyCount || 0) > 0) {
        confirmation = await waitForStableChatGptAttachments(webContents, [fileName], beforeFile, 30_000);
      }
      if (!confirmation?.uploadErrorText && !hasCompleteUploadEvidence(beforeFile, confirmation) && receipt.method === 'file-input') {
        await dismissOpenMenus(webContents);
        await withTimeout(dispatchChatGptFileDrop(webContents, [file]), 15_000, 'ChatGPT 单个附件拖放上传超时。');
        confirmation = await waitForStableChatGptAttachments(webContents, [fileName], beforeFile, 30_000);
      }
      if (confirmation?.uploadErrorText || !hasCompleteUploadEvidence(beforeFile, confirmation)) {
        throw new Error(`ChatGPT 未确认接收第 ${index + 1}/${files.length} 个附件“${fileName}”。`);
      }
      receipts.push({ file: fileName, method: receipt.method, errors: receipt.errors });
      await dismissOpenMenus(webContents);
    }
    return { method: 'sequential', errors: receipts.flatMap((receipt) => receipt.errors), receipts };
  }

  const errors: string[] = [];
  try {
    await withTimeout(setChatGptFileInputFiles(webContents, files), 15000, 'ChatGPT 文件入口上传超过 15 秒没有返回。');
    return { method: 'file-input', errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`file-input: ${message}`);
    console.warn('[ChatGPT upload] file input upload failed; trying drag/drop fallback', message);
  }

  try {
    await dismissOpenMenus(webContents);
    await withTimeout(dispatchChatGptFileDrop(webContents, files), 15000, 'ChatGPT 拖放上传超过 15 秒没有返回。');
    return { method: 'cdp-drag-drop', errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`cdp-drag-drop: ${message}`);
    console.warn('[ChatGPT upload] drag/drop upload failed', message);
  }

  throw new Error(`图片上传入口不可用。${errors.join('；')}`);
}

async function dismissOpenMenus(webContents: ChatGptWebContentsLike) {
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await withTimeout(
        webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
        }),
        1500,
        '关闭 ChatGPT 菜单的按键按下操作超时。'
      );
      await withTimeout(
        webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
        }),
        1500,
        '关闭 ChatGPT 菜单的按键释放操作超时。'
      );
      await sleep(80);
    }
  } catch {
    // Embedded windows may not have a debugger attached; the page fallback below still closes menus.
  }
  await evalChatGptMutation<boolean>(webContents, dismissOpenMenusScript, 1800).catch(() => false);
  await sleep(250);
}

async function triggerChatGptSend(webContents: ChatGptWebContentsLike) {
  const target = await evalInPageWithTimeout<{
    found: boolean;
    enabled: boolean;
    label: string;
    x?: number;
    y?: number;
  }>(webContents, sendButtonTargetScript, 5000).catch(() => undefined);
  if (target?.found && target.enabled && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    const trusted = await dispatchTrustedChatGptClick(webContents, target).catch(() => false);
    if (trusted) return true;
  }
  return evalChatGptMutation<boolean>(webContents, clickSendScript, 6000).catch(() => false);
}

async function resetChatGptComposer(
  event: IpcMainInvokeEvent,
  win: ChatGptWindowLike,
  url: string,
  statusTarget: 'automation' | 'analysis' | 'web-pose' = 'automation'
): Promise<ChatGptComposerResetState | undefined> {
  const webContents = win.webContents;
  const freshUrl = freshChatGptConversationUrl(url);
  if (statusTarget === 'web-pose') {
    emitWebPoseAnalysisStatus(event, {
      step: '正在准备全新 ChatGPT 姿势分析对话',
      detail: '正在清空旧提示词和附件，避免上一轮内容影响本次姿势建议。',
      level: 'info'
    });
  } else if (statusTarget === 'analysis') {
    emitMainImageAnalysisStatus(event, {
      step: '正在准备全新 ChatGPT 分析对话',
      detail: '正在清空旧提示词和附件，确保本次原图分析不受上一轮内容影响。',
      level: 'info',
      model: 'ChatGPT'
    });
  } else {
    emitAutomationStatus(event, {
      step: '正在后台准备全新 ChatGPT 对话',
      detail: '每一轮生成都从空白对话开始，避免上一轮附件、提示词和结果影响重新生成。'
    });
  }

  console.info('[ChatGPT composer] opening fresh conversation', { from: webContents.getURL(), to: freshUrl });
  await loadChatGptUrlRecoverably(win, freshUrl, 'composer-reset-fresh');
  await persistChatGptPageStorage(webContents);
  keepChatGptWindowInBackground(win);
  const composerState = await waitForChatGptComposer(webContents, 30000);
  if (!isAutomationComposerReady(composerState)) {
    console.warn('[ChatGPT composer] fresh conversation did not expose a usable composer', composerState);
    return undefined;
  }

  await dismissOpenMenus(webContents);
  let state = await evalChatGptMutation<ChatGptComposerResetState>(webContents, resetComposerScript, 5000).catch((error) => {
    console.warn('[ChatGPT composer] reset script failed', error instanceof Error ? error.message : String(error));
    return undefined;
  });
  await sleep(500);
  state = await evalChatGptMutation<ChatGptComposerResetState>(webContents, resetComposerScript, 5000).catch(() => state);

  if (state?.ok) {
    console.info('[ChatGPT composer] clean composer confirmed', state);
    return state;
  }

  console.warn('[ChatGPT composer] composer not clean, reloading fresh chat', state);
  if (statusTarget === 'web-pose') {
    emitWebPoseAnalysisStatus(event, {
      step: '正在重置 ChatGPT 姿势分析对话',
      detail: '首次清理后仍有残留内容，正在重新载入空白对话。',
      level: 'warning'
    });
  } else if (statusTarget === 'analysis') {
    emitMainImageAnalysisStatus(event, {
      step: '正在重置 ChatGPT 分析对话',
      detail: '首次清理后仍检测到残留内容，正在重新载入空白对话并做最后一次确认。',
      level: 'warning',
      model: 'ChatGPT'
    });
  } else {
    emitAutomationStatus(event, {
      step: '正在后台重置 ChatGPT 新对话',
      detail: '首次清理后仍检测到残留内容，正在重新载入空白对话并做最后一次确认。',
      level: 'warning'
    });
  }
  await loadChatGptUrlRecoverably(win, freshUrl, 'composer-reset-reload');
  await persistChatGptPageStorage(webContents);
  keepChatGptWindowInBackground(win);
  await waitForChatGptComposer(webContents, 30000);
  await dismissOpenMenus(webContents);
  state = await evalChatGptMutation<ChatGptComposerResetState>(webContents, resetComposerScript, 6000).catch(() => undefined);
  console.info('[ChatGPT composer] clean composer after reload', state);
  return state;
}

function hasNewUploadEvidence(
  baseline: UploadEvidence,
  snapshot?: UploadEvidence
) {
  return hasCompleteUploadEvidence(baseline, snapshot);
}

async function waitForStableChatGptAttachments(
  webContents: ChatGptWebContentsLike,
  expectedFileNames: string[],
  baseline: UploadEvidence,
  timeoutMs: number
) {
  const startedAt = Date.now();
  let lastSnapshot: UploadEvidence | undefined;
  let stablePolls = 0;
  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await evalInPageWithTimeout<UploadEvidence>(
      webContents,
      uploadAttachmentSnapshotScript(expectedFileNames),
      5000
    ).catch(() => lastSnapshot);
    if (lastSnapshot?.uploadErrorText) return lastSnapshot;
    stablePolls = nextStableUploadPollCount(baseline, lastSnapshot, stablePolls);
    if (stablePolls >= 4) return lastSnapshot;
    await sleep(700);
  }
  return lastSnapshot;
}

async function waitForStableChatGptComposerReady(
  webContents: ChatGptWebContentsLike,
  expectedAttachments: number,
  timeoutMs: number
) {
  const startedAt = Date.now();
  let stablePolls = 0;
  let lastSnapshot: {
    ready: boolean;
    busyCount: number;
    sendEnabled: boolean;
    hasPrompt: boolean;
    attachmentCount?: number;
    uploadErrorText?: string;
  } | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await evalInPageWithTimeout<typeof lastSnapshot>(
      webContents,
      uploadReadyScript(expectedAttachments),
      5000
    ).catch(() => lastSnapshot);
    if (lastSnapshot?.uploadErrorText) return lastSnapshot;
    stablePolls = lastSnapshot?.ready ? stablePolls + 1 : 0;
    if (stablePolls >= 3) return lastSnapshot;
    await sleep(700);
  }
  return lastSnapshot;
}

async function openChromeFallback(url: string) {
  await openSafeExternalUrl(url || 'https://chatgpt.com/');
}

function shouldUseExternalChatGpt(openMode?: AppSettings['chatGptOpenMode']) {
  return openMode === 'browser-only' || openMode === 'browser-first';
}

interface ChatGptComposerProbeState {
  ready: boolean;
  loginText: boolean;
  composerReady?: boolean;
  accountReady?: boolean;
  textboxCount: number;
  composerCount?: number;
  accountSignalCount?: number;
  loginButtonCount?: number;
  loginInputCount?: number;
  authUrl?: boolean;
  rawLoginSurface?: boolean;
  sessionAuthenticated?: boolean;
  sessionUnauthenticated?: boolean;
  sessionStatus?: number;
  sessionProbeError?: string;
  title: string;
  href?: string;
  reason?: string;
}

interface ChatGptSendTaskContext {
  window: ChatGptWindowLike;
  taskIndex: number;
  laneId: number;
  total: number;
  resultFile: ResultFileReservation;
  conversation: ChatGptLaneConversation;
}

async function appendChatGptTaskDiagnostic(
  context: ChatGptSendTaskContext,
  event: string,
  payload: Record<string, unknown> = {}
) {
  await appendChatGptAutomationDiagnostic(`parallel-${event}`, {
    taskIndex: context.taskIndex,
    laneId: context.laneId,
    total: context.total,
    pageUrl: context.window.webContents.getURL(),
    ...payload
  });
}

function replaceChatGptLaneConversation(
  target: ChatGptLaneConversation,
  next: ChatGptLaneConversation
) {
  target.laneId = next.laneId;
  target.initialized = next.initialized;
  target.completedInConversation = next.completedInConversation;
  target.conversationUrl = next.conversationUrl;
  target.invalidReason = next.invalidReason;
}

async function prepareChatGptComposerForLane(
  event: IpcMainInvokeEvent,
  win: ChatGptWindowLike,
  url: string,
  conversation: ChatGptLaneConversation
) {
  const webContents = win.webContents;
  let plan = planChatGptLaneConversation(conversation);
  if (
    plan.action === 'reuse' &&
    conversation.conversationUrl &&
    webContents.getURL() !== conversation.conversationUrl
  ) {
    replaceChatGptLaneConversation(
      conversation,
      invalidateChatGptLaneConversation(conversation, 'page-changed')
    );
    plan = planChatGptLaneConversation(conversation);
  }

  if (plan.action === 'reuse') {
    emitAutomationStatus(event, {
      step: '正在复用当前通道对话',
      detail: `本通道已在当前对话完成 ${conversation.completedInConversation} 张，本轮只清空输入区并记录新的消息与图片基线。`
    });
    const composerState = await waitForChatGptComposer(webContents, 15_000);
    if (isAutomationComposerReady(composerState)) {
      await dismissOpenMenus(webContents);
      const clean = await evalChatGptMutation<ChatGptComposerResetState>(
        webContents,
        resetComposerScript,
        5000
      ).catch(() => undefined);
      if (clean?.ok) return { state: clean, reused: true, reason: plan.reason };
    }
    replaceChatGptLaneConversation(
      conversation,
      invalidateChatGptLaneConversation(conversation, 'attachment-residue')
    );
    plan = planChatGptLaneConversation(conversation);
  }

  const clean = await resetChatGptComposer(event, win, url);
  if (clean?.ok) {
    replaceChatGptLaneConversation(
      conversation,
      openChatGptLaneConversation(conversation, webContents.getURL())
    );
  }
  return { state: clean, reused: false, reason: plan.reason };
}

function isAutomationComposerReady(state?: ChatGptComposerProbeState) {
  return canUseChatGptComposer(state);
}

async function waitForStableChatGptProbe(
  webContents: ChatGptWebContentsLike,
  timeoutMs: number,
  requireComposer: boolean
) {
  const startedAt = Date.now();
  let lastValue: ChatGptComposerProbeState | undefined;
  let confirmedLogoutSamples = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const { health } = await observeChatGptManualIntervention(webContents);
    if (health.manualIntervention) {
      if (requireComposer) throw new ChatGptProtectionPausedError(chatGptManualVerificationMessage);
      return undefined;
    }
    try {
      const value = await evalInPageWithTimeout<ChatGptComposerProbeState>(
        webContents,
        composerProbeScript(!requireComposer),
        6500
      );
      lastValue = value;
      if (requireComposer ? isAutomationComposerReady(value) : isConfirmedChatGptLogin(value)) {
        return value;
      }
      if (isConfirmedChatGptLogout(value)) {
        confirmedLogoutSamples += 1;
        if (confirmedLogoutSamples >= chatGptLoginConfirmationCount) return value;
      } else {
        confirmedLogoutSamples = 0;
      }
    } catch {
      confirmedLogoutSamples = 0;
      // ChatGPT may be navigating or hydrating; keep the last usable sample.
    }
    await sleep(900);
  }
  return lastValue;
}

async function waitForChatGptComposer(webContents: ChatGptWebContentsLike, timeoutMs = 45000) {
  return waitForStableChatGptProbe(webContents, timeoutMs, true);
}

async function recoverChatGptComposerInBackground(event: IpcMainInvokeEvent, win: ChatGptWindowLike, url: string) {
  return withTimeout(
    recoverChatGptComposerInBackgroundUnsafe(event, win, url),
    chatGptComposerRecoveryHardTimeoutMs,
    'ChatGPT 输入框后台恢复超过 65 秒，已停止本次恢复并保留任务。'
  );
}

async function recoverChatGptComposerInBackgroundUnsafe(event: IpcMainInvokeEvent, win: ChatGptWindowLike, url: string) {
  const webContents = win.webContents;
  await assertChatGptPageOperationAllowed(webContents);
  const startedAt = Date.now();
  await appendChatGptAutomationDiagnostic('composer-background-recovery-started', {
    ...chatGptWindowDiagnosticSnapshot(win)
  });
  emitAutomationStatus(event, {
    step: '正在后台恢复 ChatGPT 自动窗口',
    detail: '没有稳定检测到输入框，正在后台关闭弹层并恢复聊天页。',
    level: 'warning'
  });
  keepChatGptWindowInBackground(win);
  await dismissOpenMenus(webContents);

  let recovered = await waitForChatGptComposer(webContents, 8000);
  if (isAutomationComposerReady(recovered)) {
    await appendChatGptAutomationDiagnostic('composer-background-recovery-finished', {
      outcome: 'composer-ready-without-reload',
      durationMs: Date.now() - startedAt,
      reason: recovered?.reason || '',
      sessionProbeError: recovered?.sessionProbeError || '',
      ...chatGptWindowDiagnosticSnapshot(win)
    });
    emitAutomationStatus(event, {
      step: 'ChatGPT 页面已恢复',
      detail: '已经重新确认输入框可用，正在继续本轮任务。',
      level: 'success'
    });
    return recovered;
  }
  if (isConfirmedChatGptLogout(recovered)) {
    await appendChatGptAutomationDiagnostic('composer-background-recovery-finished', {
      outcome: 'confirmed-logout',
      durationMs: Date.now() - startedAt,
      reason: recovered?.reason || '',
      ...chatGptWindowDiagnosticSnapshot(win)
    });
    return recovered;
  }

  const surface = await observeChatGptManualIntervention(webContents);
  await assertChatGptPageOperationAllowed(webContents);
  if (surface.health.blank) {
    emitAutomationStatus(event, {
      step: '正在后台重新载入 ChatGPT',
      detail: '自动窗口页面可能停在弹层、旧页面或加载异常，正在后台重新进入聊天页。',
      level: 'warning'
    });
    await recoverChatGptSurface(win, url, 'login-check', surface);
    await persistChatGptPageStorage(webContents);
    keepChatGptWindowInBackground(win);
    recovered = await waitForChatGptComposer(webContents, 25000);
  }

  const recoveredComposer = isAutomationComposerReady(recovered);
  await appendChatGptAutomationDiagnostic('composer-background-recovery-finished', {
    outcome: recoveredComposer ? 'composer-ready-after-reload' : 'composer-unavailable',
    durationMs: Date.now() - startedAt,
    reason: recovered?.reason || '',
    sessionProbeError: recovered?.sessionProbeError || '',
    ...chatGptWindowDiagnosticSnapshot(win)
  });
  if (recoveredComposer) {
    emitAutomationStatus(event, {
      step: 'ChatGPT 页面已恢复',
      detail: '后台恢复完成，输入框已经可用，正在继续本轮任务。',
      level: 'success'
    });
  }

  return recovered;
}

function freshGeminiConversationUrl(rawUrl?: string) {
  try {
    const url = new URL(rawUrl || defaultWebAiUrls.gemini);
    if (url.hostname === 'gemini.google.com' || url.hostname.endsWith('.gemini.google.com')) {
      return `${url.origin}/app`;
    }
  } catch {
    // Fall through to the official Gemini entry point.
  }
  return defaultWebAiUrls.gemini;
}

async function ensureGeminiModelForSend(
  event: IpcMainInvokeEvent,
  win: ChatGptWindowLike,
  requestedModel?: string
) {
  emitAutomationStatus(event, {
    step: '正在确认 Gemini 模型',
    detail: requestedModel && requestedModel !== 'follow-current'
      ? `发送前确认模型：${requestedModel}。`
      : '使用 Gemini 网页当前模型，不主动切换。'
  });
  const catalog = await withTimeout((async () => {
    let result = await inspectGeminiModels(win.webContents, requestedModel || 'follow-current');
    if (!result.ok && /模型选择器|model.{0,12}(?:selector|picker|trigger)/i.test(result.message || '')) {
      emitAutomationStatus(event, {
        step: '正在等待 Gemini 模型菜单',
        detail: '页面控件仍在挂载，正在做一次有界重试。',
        level: 'warning'
      });
      await sleep(1500);
      result = await inspectGeminiModels(win.webContents, requestedModel || 'follow-current');
    }
    return result;
  })(), 35_000, 'Gemini 模型确认超过 35 秒');
  if (!catalog.ok) throw new Error(catalog.message || 'Gemini 模型不可用，本轮尚未上传附件。');
  if (requestedModel && requestedModel !== 'follow-current') {
    const current = (catalog.currentModel || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const requested = requestedModel.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (current !== requested) {
      throw new Error(`指定模型 ${requestedModel} 未能确认，Gemini 没有静默切换到其他模型；本轮尚未上传附件。`);
    }
  }
  return catalog;
}

async function automateGeminiSend(
  event: IpcMainInvokeEvent,
  settings: AppSettings,
  projectName: string,
  prompt: string,
  files: string[],
  targetDimensions: ImageDimensions,
  taskContext?: ChatGptSendTaskContext
): Promise<ChatGptAutomationResult> {
  const mode = settings.chatGptAutomationMode || 'manual';
  if (mode === 'manual') {
    return { mode, ok: true, sent: false, uploaded: false, message: '手动模式未执行 Gemini 网页自动化。' };
  }

  let uploaded = false;
  let sent = false;
  const automationUrl = freshGeminiConversationUrl(settings.geminiUrl);
  let activeWindow = taskContext?.window;
  try {
    emitAutomationStatus(event, { step: '正在后台打开 Gemini', detail: '使用同一个像锚专属 Chrome，不会启动第二个浏览器进程。' });
    const win = activeWindow || await getGeminiWindow(automationUrl, 'background');
    activeWindow = win;
    if (taskContext) {
      await appendChatGptTaskDiagnostic(taskContext, 'gemini-task-start', {
        provider: 'gemini',
        model: settings.geminiModel,
        resultPath: taskContext.resultFile.filePath
      });
    }
    await loadFreshGeminiConversation(win, automationUrl, 'Gemini 新对话');
    keepChatGptWindowInBackground(win);
    let probe = await waitForGeminiPage(win.webContents, 45_000);
    if ((!probe || (!canUseGeminiForAutomation(probe) && !isConfirmedGeminiLogout(probe) && assessGeminiPageHealth(probe).blank))) {
      probe = await recoverGeminiSurfaceInBackground(win, automationUrl, 'generation-blank');
    }
    if (!canUseGeminiForAutomation(probe)) {
      const message = probe?.regionBlocked
        ? 'Google 当前提示 Gemini 暂不支持所在地区。本轮尚未上传附件；请恢复可访问 Gemini 的网络环境后重试。'
        : isConfirmedGeminiLogout(probe)
        ? 'Gemini 需要重新登录或完成 Google 安全验证。请点击“查看窗口”手动处理后重试。'
        : 'Gemini 页面没有稳定显示输入框或账号状态，本轮尚未上传附件；请点击“恢复窗口”后重试。';
      return { mode, ok: false, sent: false, uploaded: false, message, error: message };
    }

    const clean = await resetGeminiComposer(win.webContents);
    if (!clean.ok) {
      throw new Error(`无法确认 Gemini 新对话已清空（输入字符 ${clean.textLength}，附件 ${clean.attachmentCount}）。为避免串入旧任务，本轮已停止。`);
    }

    await ensureGeminiModelForSend(event, win, settings.geminiModel);
    const imageMode = await enableGeminiImageMode(win.webContents);
    if (!imageMode.ok) {
      throw new Error('当前 Gemini 页面没有稳定显示输入区，本轮尚未上传附件。');
    }

    emitAutomationStatus(event, {
      step: '正在上传本轮图片到 Gemini',
      detail: `${files.length} 个附件，上传完成后会逐项核对。`
    });
    const confirmedUpload = await uploadAndConfirmGeminiAttachments(win.webContents, files, 45_000);
    await appendChatGptAutomationDiagnostic('gemini-attachments-confirmed', {
      taskIndex: taskContext?.taskIndex,
      laneId: taskContext?.laneId,
      attachmentCount: files.length,
      uploadMethod: confirmedUpload.receipt.method,
      uploadAttempts: confirmedUpload.attempts,
      readyAttachmentCount: confirmedUpload.confirmation.readyAttachmentCount
    });

    emitAutomationStatus(event, { step: '正在后台粘贴提示词到 Gemini' });
    const geminiAttachmentOrder = files.map((file, index) => `${index + 1}. ${path.basename(file)}`).join('\n');
    const promptForComposer = `本轮附件顺序如下：\n${geminiAttachmentOrder}\n\n请完整读取附件文件名和下方提示词中定义的素材职责，并直接生成一张新图片。\n\n${prompt.trim()}\n\n请依据本轮全部附件和提示词完成图片编辑，在当前回复中返回最终图片；不要只提供文字说明。`;
    const promptSet = await setGeminiPrompt(win.webContents, promptForComposer);
    if (!promptSet) throw new Error('Gemini 输入框没有确认写入本轮提示词，本轮未发送。');

    emitAutomationStatus(event, {
      step: '正在等待 Gemini 附件上传完成',
      detail: '发送前再次确认提示词、全部附件、上传状态和右侧发送按钮。'
    });
    const composerReady = await waitForGeminiComposerReady(win.webContents, files.length, 60_000);
    if (!composerReady.ready) {
      if (composerReady.uploadErrorText) {
        throw new Error(`Gemini 页面提示附件上传失败：${composerReady.uploadErrorText}`);
      }
      const reason = !composerReady.hasPrompt
        ? '提示词没有保留在 Gemini 输入框。'
        : composerReady.attachmentCount < files.length
          ? `Gemini 输入区只确认 ${composerReady.attachmentCount}/${files.length} 个附件。`
          : !composerReady.sendEnabled
            ? 'Gemini 右侧发送按钮仍不可用。'
            : 'Gemini 附件仍处于上传状态。';
      throw new Error(`${reason} 本轮未发送，请点击“查看窗口”确认页面状态。`);
    }
    uploaded = true;

    emitAutomationStatus(event, {
      step: '正在后台建立 Gemini 结果基线',
      detail: '记录发送前已有回复和图片，防止把附件或旧对话图片保存成结果。'
    });
    const baseline = await captureGeminiBaseline(win.webContents);

    emitAutomationStatus(event, {
      step: '正在后台发送到 Gemini',
      detail: '附件和提示词已通过最终门禁，正在执行可信按钮点击。'
    });
    const sendAction = await sendGeminiPrompt(win.webContents);
    if (!sendAction.sent) throw new Error('Gemini 没有可用的发送按钮，本轮未发送。');
    let acceptance = await waitForGeminiSendAcceptance(win.webContents, baseline, 30_000);
    if (canSafelyRetryGeminiSend(baseline, acceptance.snapshot)) {
      emitAutomationStatus(event, {
        step: '正在重新触发 Gemini 发送',
        detail: '第一次点击后页面没有建立新消息，且原输入内容仍完整；只补发一次以避免重复提交。',
        level: 'warning'
      });
      const retry = await sendGeminiPrompt(win.webContents);
      if (retry.sent) acceptance = await waitForGeminiSendAcceptance(win.webContents, baseline, 30_000);
    }
    if (!acceptance.accepted) {
      throw new Error(
        `Gemini 没有确认接收本轮消息（输入字符 ${acceptance.snapshot?.composerTextLength ?? 'unknown'}，附件 ${acceptance.snapshot?.attachmentCount ?? 'unknown'}）。为避免重复发送，本轮已停止。`
      );
    }
    sent = true;
    keepChatGptWindowInBackground(win);
    emitAutomationStatus(event, { step: '正在等待 Gemini 生成图片', detail: '网页已确认接收本轮消息。' });
    const imageResult = await waitForGeminiImageResult(
      win.webContents,
      baseline,
      300_000,
      ({ elapsedSeconds, candidate, busy }) => {
        emitAutomationStatus(event, {
          step: candidate ? '正在确认 Gemini 结果图' : '正在等待 Gemini 生成图片',
          detail: candidate
            ? `已发现 ${candidate.width}x${candidate.height} 候选图，等待页面停止生成并确认资源稳定。`
            : `已等待 ${elapsedSeconds} 秒，页面状态=${busy ? '生成中' : '等待响应'}。`
        });
      }
    );
    if (imageResult.failure) {
      const reason = imageResult.failureText || 'Gemini 本轮明确返回失败。';
      const message = imageResult.failure.code === 'rate-limited'
        ? `Gemini 请求频率限制：${reason}`
        : imageResult.failure.code === 'quota-exceeded'
          ? `Gemini 账号额度不足或达到使用上限：${reason}`
          : imageResult.failure.code === 'login-required'
            ? `Gemini 需要重新登录：${reason}`
            : `Gemini 本轮图片生成失败：${reason}`;
      return { mode, ok: false, sent, uploaded, message, error: message };
    }
    let savedImage: ImageAsset | undefined;
    let localSaveFailure: unknown;
    const localSaveAttempts = 3;
    for (let localAttempt = 1; localAttempt <= localSaveAttempts; localAttempt += 1) {
      try {
        savedImage = await saveGeneratedImageFromGemini(
          win.webContents,
          projectName,
          prompt,
          imageResult.candidate,
          targetDimensions,
          taskContext?.resultFile
        );
        break;
      } catch (error) {
        localSaveFailure = error;
        if (localAttempt >= localSaveAttempts) break;
        emitAutomationStatus(event, {
          step: '正在重试本地保存',
          detail: `Gemini 已完成本张生成；JPG 第 ${localAttempt}/${localSaveAttempts} 次读取或写入失败，只重试本地保存，不会重新发送提示词。`,
          level: 'warning'
        });
        await sleep(800 * localAttempt);
      }
    }
    if (!savedImage) {
      const reason = localSaveFailure instanceof Error ? localSaveFailure.message : String(localSaveFailure || '未知读取或写入错误');
      throw new Error(`Gemini 已成功生成本张，但 JPG 连续 ${localSaveAttempts} 次保存失败：${reason}。本批次已安全停止，不会重新发送该任务。`);
    }
    emitAutomationStatus(event, { step: 'Gemini 结果已保存', detail: savedImage.path, level: 'success' });
    return {
      mode,
      ok: true,
      sent,
      uploaded,
      message: 'Gemini 已生成图片，并按原图尺寸保存为手机兼容 JPG。',
      savedImage,
      savedPath: savedImage.path,
      sequence: savedImage.sequence,
      resultDir: savedImage.path ? path.dirname(savedImage.path) : undefined,
      taskIndex: taskContext?.taskIndex,
      laneId: taskContext?.laneId
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const classified = classifyGeminiFailure(rawMessage);
    const message = classified?.code === 'rate-limited'
      ? `Gemini 请求频率限制：${rawMessage}`
      : classified?.code === 'quota-exceeded'
        ? `Gemini 账号额度不足或达到使用上限：${rawMessage}`
        : rawMessage;
    const dom = activeWindow && !activeWindow.isDestroyed()
      ? await captureGeminiDomDiagnostics(activeWindow.webContents).catch((diagnosticError) => ({
          unavailable: true,
          reason: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
        }))
      : { unavailable: true, reason: 'window-unavailable' };
    await appendChatGptAutomationDiagnostic('gemini-task-failed', {
      taskIndex: taskContext?.taskIndex,
      laneId: taskContext?.laneId,
      uploaded,
      sent,
      failureCode: classified?.code || 'unknown',
      message,
      dom
    });
    if (activeWindow && !activeWindow.isDestroyed()) {
      await resetGeminiComposer(activeWindow.webContents).catch(() => undefined);
    }
    if (activeWindow && !activeWindow.isDestroyed()) keepChatGptWindowInBackground(activeWindow);
    return { mode, ok: false, sent, uploaded, message, error: message, taskIndex: taskContext?.taskIndex, laneId: taskContext?.laneId };
  }
}

async function automateChatGptSend(
  event: IpcMainInvokeEvent,
  settings: AppSettings,
  projectName: string,
  prompt: string,
  files: string[],
  targetDimensions: ImageDimensions,
  taskContext?: ChatGptSendTaskContext
): Promise<ChatGptAutomationResult> {
  if (normalizeWebAiProvider(settings.webAiProvider) === 'gemini') {
    return automateGeminiSend(event, settings, projectName, prompt, files, targetDimensions, taskContext);
  }
  const mode = settings.chatGptAutomationMode || 'manual';
  if (mode === 'manual') {
    return { mode, ok: true, sent: false, uploaded: false, message: '手动模式未执行网页自动化。' };
  }

  let uploaded = false;
  let sent = false;
  let activeWindow = taskContext?.window;
  let releaseSubmissionSlot: (() => void) | undefined;
  const automationUrl = freshChatGptConversationUrl(settings.chatGptUrl || 'https://chatgpt.com/');
  const taskStartedAt = Date.now();
  let taskStageStartedAt = taskStartedAt;
  const recordTaskStage = async (stage: string) => {
    if (!taskContext) return;
    const now = Date.now();
    await appendChatGptTaskDiagnostic(taskContext, 'task-stage', {
      stage,
      durationMs: now - taskStageStartedAt,
      elapsedMs: now - taskStartedAt
    });
    taskStageStartedAt = now;
  };
  try {
    await assertChatGptAutomationStartAllowed();
    emitAutomationStatus(event, { step: '正在后台打开 ChatGPT', detail: '自动窗口将在后台运行，不会遮挡像锚。' });
    const backend = resolveChatGptBrowserBackend(settings.chatGptBrowserBackend);
    const win = activeWindow || (await getChatGptWindow(automationUrl, backend, 'background'));
    activeWindow = win;
    if (taskContext) {
      await appendChatGptTaskDiagnostic(taskContext, 'task-start', {
        model: settings.chatGptModel,
        resultPath: taskContext.resultFile.filePath
      });
    }
    keepChatGptWindowInBackground(win);
    const webContents = win.webContents;

    emitAutomationStatus(event, {
      step: '正在等待安全提交时段',
      detail: '只串行模型确认、附件上传和发送；发送被确认后，各通道仍会并行等待图片。'
    });
    releaseSubmissionSlot = await chatGptSubmissionQueue.acquireExclusive();
    await assertChatGptSubmissionAllowed(webContents);

    emitAutomationStatus(event, { step: '正在后台等待 ChatGPT 输入框' });
    let composerState = await waitForChatGptComposer(webContents, 45000);
    console.info('[ChatGPT login probe] automation composer state', composerState);
    if (!isAutomationComposerReady(composerState) && !isConfirmedChatGptLogout(composerState)) {
      composerState = await recoverChatGptComposerInBackground(event, win, automationUrl);
      console.info('[ChatGPT login probe] automation composer state after background recovery', composerState);
    }
    if (!isAutomationComposerReady(composerState)) {
      keepChatGptWindowInBackground(win);
      const message = isConfirmedChatGptLogout(composerState)
        ? 'ChatGPT 自动窗口需要重新登录或验证码确认。请点击“查看窗口”处理后再重新生成。'
        : 'ChatGPT 自动窗口暂时没有找到输入框。已在后台尝试恢复聊天页，请稍后重试；如仍失败，再点击“查看窗口”确认页面状态。';
      emitAutomationStatus(event, { step: '自动窗口不可继续', detail: message, level: 'error' });
      return { mode, ok: false, sent: false, uploaded: false, message, error: message };
    }
    if (composerState?.composerReady && !composerState.accountReady) {
      console.info('[ChatGPT login probe] continuing automation with composer-ready state because no login page was detected', composerState);
      emitAutomationStatus(event, {
        step: '已确认自动窗口可继续',
        detail: '检测到 ChatGPT 输入框，没有检测到登录页。即使账号菜单未显示，也继续使用内部自动窗口执行重新生成。',
        level: 'info'
      });
    }
    await recordTaskStage('composer-ready');

    const composerPreparation = taskContext
      ? await prepareChatGptComposerForLane(event, win, automationUrl, taskContext.conversation)
      : { state: await resetChatGptComposer(event, win, automationUrl), reused: false, reason: 'single-task' };
    const cleanComposerState = composerPreparation.state;
    if (!cleanComposerState?.ok) {
      console.warn('[ChatGPT composer] refusing to start with an unverified composer', cleanComposerState);
      throw new Error('无法确认 ChatGPT 新对话的输入框已经清空。为避免重复上传附件和提示词，本轮已停止；请点击“查看窗口”确认页面状态后重试。');
    }
    await recordTaskStage(composerPreparation.reused ? 'reused-conversation' : 'fresh-conversation');

    await ensureChatGptModelForSend(event, win, settings.chatGptModel, settings.chatGptWorkMode);
    await recordTaskStage('config-ready');
    await dismissOpenMenus(webContents);
    emitAutomationStatus(event, { step: '正在后台准备文件上传入口' });
    const fileInputState = await evalChatGptMutation<{ inputCount: number; clicked: boolean }>(webContents, revealFileInputScript, 4500).catch((error) => {
      console.warn('[ChatGPT upload] reveal file input failed', error instanceof Error ? error.message : String(error));
      return { inputCount: 0, clicked: false };
    });
    console.info('[ChatGPT upload] file input reveal state', fileInputState);
    await sleep(800);

    emitAutomationStatus(event, { step: '正在后台上传红圈主垫图与参考图', detail: `${files.length} 个文件；第 1 个文件同时负责构图基准、红圈外保护和允许编辑区域。` });
    const expectedFileNames = files.map((file) => path.basename(file));
    const uploadBaseline = await evalInPageWithTimeout<{ evidenceCount: number; nameHits: number; previewCount: number; removeButtonCount: number; fileInputCount: number; busyCount: number; expectedCount: number; uploadErrorText?: string }>(
      webContents,
      uploadAttachmentSnapshotScript(expectedFileNames),
      6000
    ).catch(() => ({ evidenceCount: 0, nameHits: 0, previewCount: 0, removeButtonCount: 0, fileInputCount: 0, busyCount: 0, expectedCount: expectedFileNames.length, uploadErrorText: '' }));
    console.info('[ChatGPT upload] baseline before file input', uploadBaseline);
    const uploadMethod = await uploadFilesToChatGptComposer(webContents, files);
    console.info('[ChatGPT upload] upload method selected', uploadMethod);

    emitAutomationStatus(event, { step: '正在确认图片是否上传到 ChatGPT', detail: '正在检测附件预览、文件名或附件删除按钮。' });
    type UploadConfirmation = UploadEvidence & {
      ready: boolean;
      expectedCount: number;
      uploadErrorText: string;
    };
    let uploadConfirm = await waitForStableChatGptAttachments(webContents, expectedFileNames, uploadBaseline, 12_000);
    if (!uploadConfirm?.uploadErrorText && !hasNewUploadEvidence(uploadBaseline, uploadConfirm) && (uploadConfirm?.busyCount || 0) > 0) {
      uploadConfirm = await waitForStableChatGptAttachments(webContents, expectedFileNames, uploadBaseline, 30_000);
    }
    console.info('[ChatGPT upload] confirmation after file input', uploadConfirm);
    if (uploadConfirm?.uploadErrorText) {
      throw new Error(`ChatGPT 页面提示图片上传失败：${uploadConfirm.uploadErrorText}。请点击“查看窗口”确认文件格式、大小或网络状态。`);
    }
    if ((!uploadConfirm || !hasNewUploadEvidence(uploadBaseline, uploadConfirm)) && uploadMethod.method === 'file-input') {
      emitAutomationStatus(event, {
        step: '文件入口未返回附件，正在切换拖放上传',
        detail: 'composer 文件入口没有出现完整附件回执，后台自动改用拖放方式重试。',
        level: 'warning'
      });
      await dismissOpenMenus(webContents);
      await withTimeout(dispatchChatGptFileDrop(webContents, files), 15000, 'ChatGPT 拖放上传超过 15 秒没有返回。');
      uploadConfirm = await waitForStableChatGptAttachments(webContents, expectedFileNames, uploadBaseline, 35_000);
      console.info('[ChatGPT upload] confirmation after drag/drop fallback', uploadConfirm);
      if (uploadConfirm?.uploadErrorText) {
        throw new Error(`ChatGPT 页面提示图片上传失败：${uploadConfirm.uploadErrorText}。请点击“查看窗口”确认文件格式、大小或网络状态。`);
      }
    }
    if (!uploadConfirm || !hasNewUploadEvidence(uploadBaseline, uploadConfirm)) {
      throw new Error(
        `图片没有完整上传到 ChatGPT。已尝试上传 ${expectedFileNames.length} 个文件，但没有检测到全部附件的独立回执。请点击“查看窗口”确认文件格式或网络状态。`
      );
    }
    await recordTaskStage('upload-ready');

    emitAutomationStatus(event, { step: '正在后台粘贴提示词' });
    await dismissOpenMenus(webContents);
    const promptForComposer = buildCurrentTurnChatGptPrompt(expectedFileNames, prompt);
    const promptSet = await evalChatGptMutation<boolean>(webContents, setPromptScript(promptForComposer), 6000);
    if (!promptSet) throw new Error('没有成功写入 ChatGPT 输入框。');

    emitAutomationStatus(event, { step: '正在后台等待附件上传完成' });
    const uploadState = await waitForStableChatGptComposerReady(webContents, expectedFileNames.length, 60_000);
    const finalUploadEvidence = await waitForStableChatGptAttachments(
      webContents,
      expectedFileNames,
      uploadBaseline,
      12_000
    );
    const hasFinalAttachmentEvidence = hasNewUploadEvidence(uploadBaseline, finalUploadEvidence);
    if (!uploadState?.ready) {
      if (uploadState?.uploadErrorText) {
        throw new Error(`ChatGPT 页面提示附件上传失败：${uploadState.uploadErrorText}。请点击“查看窗口”确认原因后重试。`);
      }
      const canTryFallbackSend = Boolean(uploadState?.hasPrompt && uploadState.busyCount === 0 && hasFinalAttachmentEvidence);
      if (canTryFallbackSend) {
        console.warn('[ChatGPT automation] send button readiness was not detected; trying fallback send anyway', uploadState);
        emitAutomationStatus(event, {
          step: '正在尝试兜底发送',
          detail: '提示词已写入且未检测到上传进度，后台正在尝试右下角按钮/回车发送。',
          level: 'warning'
        });
      } else {
        const reason = !uploadState?.hasPrompt
        ? '提示词没有成功写入 ChatGPT 输入框。'
        : !hasFinalAttachmentEvidence
          ? '图片没有成功上传到 ChatGPT，未检测到附件预览或文件名。'
          : !uploadState.sendEnabled
          ? '发送按钮仍不可用，可能是图片还在上传或 ChatGPT 输入框尚未准备好。'
          : '附件上传仍未完成。';
        console.warn('[ChatGPT automation] upload/send readiness failed', uploadState);
        throw new Error(reason);
      }
    }
    if (!hasFinalAttachmentEvidence) {
      console.warn('[ChatGPT automation] upload evidence disappeared before send', { uploadBaseline, uploadConfirm, uploadState });
      throw new Error('图片上传未完成或已经从 ChatGPT 输入框中消失，已停止发送。请点击“查看窗口”确认后重试。');
    }
    uploaded = true;

    if (mode === 'upload-review') {
      revealChatGptWindowForIntervention(win);
      emitAutomationStatus(event, { step: '已完成后台上传和提示词粘贴', detail: '已显示 ChatGPT 窗口，请确认后手动发送。', level: 'success' });
      return { mode, ok: true, sent: false, uploaded: true, message: '已上传素材并粘贴提示词，等待你手动发送。' };
    }

    emitAutomationStatus(event, { step: '正在后台建立图片基线', detail: '记录发送前页面已有图片，防止把上传附件或历史图片保存成结果。' });
    const imageBaseline = await evalInPageWithTimeout<ChatGptImageBaseline>(webContents, collectImageBaselineScript, 6000);
    console.info('[ChatGPT image] captured baseline', {
      images: imageBaseline.images.length,
      sources: imageBaseline.sources.length,
      assistantMessageCount: imageBaseline.assistantMessageCount,
      byType: imageBaseline.images.reduce<Record<string, number>>((counts, image) => {
        counts[image.sourceType] = (counts[image.sourceType] || 0) + 1;
        return counts;
      }, {})
    });

    emitAutomationStatus(event, { step: '正在后台发送', detail: '图片和提示词已就绪，正在后台提交给 ChatGPT。' });
    await dismissOpenMenus(webContents);
    const preSendState = await waitForStableChatGptComposerReady(webContents, expectedFileNames.length, 15_000);
    const preSendAttachments = await waitForStableChatGptAttachments(
      webContents,
      expectedFileNames,
      uploadBaseline,
      10_000
    );
    if (!preSendState?.ready || !hasNewUploadEvidence(uploadBaseline, preSendAttachments)) {
      throw new Error('发送前复核发现原图或参考图附件已经从 ChatGPT 输入区消失，或发送按钮仍不可用。本轮没有发送不完整消息，请重试。');
    }
    sent = await triggerPacedChatGptSend(event, webContents);
    if (!sent) {
      const fallback = await evalChatGptMutation<{ sent: boolean; method: string; label: string }>(
        webContents,
        fallbackClickSendScript,
        6000
      ).catch(() => ({
        sent: false,
        method: 'script-error',
        label: ''
      }));
      console.warn('[ChatGPT automation] fallback send result', fallback);
      sent = fallback.sent;
    }
    if (!sent) throw new Error('没有找到可用的发送按钮，已停在 ChatGPT 页面等待手动处理。');
    keepChatGptWindowInBackground(win);

    emitAutomationStatus(event, { step: '正在确认后台发送结果', detail: '正在确认输入框已经清空，并且 ChatGPT 已建立本轮新消息。' });
    const sendAcceptance = await waitForChatGptSendAcceptance(webContents, imageBaseline, 45000);
    console.info('[ChatGPT automation] send acceptance', sendAcceptance);
    if (sendAcceptance?.terminalFailure) throw new Error(sendAcceptance.terminalFailure);
    if (!sendAcceptance?.accepted) {
      throw new Error(
        `发送按钮已点击，但 ChatGPT 没有确认接收本轮消息（输入框清空=${Boolean(sendAcceptance?.composerCleared)}，输入框字符=${sendAcceptance?.composerTextLength ?? 'unknown'}，残留附件=${sendAcceptance?.attachmentCount ?? 'unknown'}，新用户消息=${Math.max(0, (sendAcceptance?.userMessageCount ?? imageBaseline.userMessageCount) - imageBaseline.userMessageCount)}，生成中=${Boolean(sendAcceptance?.stopVisible || (sendAcceptance?.busyCount ?? 0) > 0)}）。为避免重复发送，本轮已停止。`
      );
    }
    await recordTaskStage('send-accepted');

    releaseSubmissionSlot?.();
    releaseSubmissionSlot = undefined;
    emitAutomationStatus(event, { step: '正在后台等待 ChatGPT 生成图片', detail: '发送成功，后台等待最新助手回复完成出图。' });
    const generated = await waitForStableGeneratedImage(event, webContents, imageBaseline);
    await recordTaskStage('result-ready');

    emitAutomationStatus(event, {
      step: '正在保存生成图',
      detail: '已确认结果图来自本轮最新助手回复，正在转换、校正方向并写入桌面项目文件夹。'
    });
    // The current archive UI stores one result per generation, so use the largest stable image in the latest assistant message.
    let savedImage: ImageAsset | undefined;
    let localSaveFailure: unknown;
    const localSaveAttempts = 3;
    for (let localAttempt = 1; localAttempt <= localSaveAttempts; localAttempt += 1) {
      try {
        savedImage = await saveGeneratedImageFromChatGpt(
          webContents,
          projectName,
          prompt,
          generated,
          targetDimensions,
          taskContext?.resultFile
        );
        break;
      } catch (error) {
        localSaveFailure = error;
        if (localAttempt >= localSaveAttempts) break;
        emitAutomationStatus(event, {
          step: '正在重试本地保存',
          detail: `ChatGPT 已完成本张生成；JPG 第 ${localAttempt}/${localSaveAttempts} 次写入失败，只重试本地保存，不会重新发送提示词。`,
          level: 'warning'
        });
        await sleep(800 * localAttempt);
      }
    }
    if (!savedImage) {
      const reason = localSaveFailure instanceof Error ? localSaveFailure.message : String(localSaveFailure || '未知写入错误');
      throw new Error(`ChatGPT 已成功生成本张，但 JPG 连续 ${localSaveAttempts} 次保存失败：${reason}。本批次已安全停止，不会重新发送该任务。`);
    }
    await recordTaskStage('saved');
    const resultDir = savedImage.path ? path.dirname(savedImage.path) : undefined;
    emitAutomationStatus(event, {
      step: '生成完成，已按原图尺寸保存',
      detail: `${savedImage.path}；${savedImage.dimensionAdjustment || `${targetDimensions.width}x${targetDimensions.height}px`}`,
      level: 'success'
    });
    if (taskContext) {
      replaceChatGptLaneConversation(
        taskContext.conversation,
        completeChatGptLaneConversation(taskContext.conversation, webContents.getURL())
      );
      await appendChatGptTaskDiagnostic(taskContext, 'task-complete', {
        savedPath: savedImage.path,
        sequence: savedImage.sequence,
        conversationTasks: taskContext.conversation.completedInConversation,
        conversationUrl: taskContext.conversation.conversationUrl
      });
    }
    return {
      mode,
      ok: true,
      sent: true,
      uploaded: true,
      message: `已自动上传、发送，并按原图尺寸保存生成图：${savedImage.path}；${savedImage.dimensionAdjustment || ''}`,
      savedImage,
      savedPath: savedImage.path,
      sequence: savedImage.sequence,
      resultDir,
      taskIndex: taskContext?.taskIndex,
      laneId: taskContext?.laneId
    };
  } catch (error) {
    let message = error instanceof Error ? error.message : 'ChatGPT 自动化失败。';
    let protectionPaused = chatGptManualVerificationRequired || error instanceof ChatGptProtectionPausedError || isChatGptConversationAccessLimitedMessage(message);
    if (protectionPaused) rememberChatGptConversationAccessLimit(message);
    let quotaExceeded = error instanceof ChatGptQuotaExceededError;
    if (!quotaExceeded && !protectionPaused && activeWindow && !activeWindow.isDestroyed()) {
      const quotaState = await evalInPageWithTimeout<{ quotaExceeded: boolean; message: string }>(
        activeWindow.webContents,
        chatGptQuotaSnapshotScript,
        4000
      ).catch(() => undefined);
      if (quotaState?.quotaExceeded) {
        protectionPaused = isChatGptConversationAccessLimitedMessage(quotaState.message);
        if (protectionPaused) {
          rememberChatGptConversationAccessLimit(quotaState.message);
          message = `ChatGPT 访问保护已触发。页面提示：${quotaState.message || '请稍后再试。'}`;
        } else {
          quotaExceeded = true;
          message = `ChatGPT 图片生成额度或频率已达限制。页面提示：${quotaState.message || '当前无法继续生成图片。'}`;
        }
      }
    }
    if (!protectionPaused && activeWindow && !activeWindow.isDestroyed()) {
      await evalChatGptMutation(activeWindow.webContents, resetComposerScript, 4000).catch((resetError) => {
        console.warn('[ChatGPT composer] cleanup after automation failure failed', resetError instanceof Error ? resetError.message : String(resetError));
      });
      keepChatGptWindowInBackground(activeWindow);
    }
    if (taskContext) {
      replaceChatGptLaneConversation(
        taskContext.conversation,
        invalidateChatGptLaneConversation(
          taskContext.conversation,
          protectionPaused ? 'protection-paused' : sent ? 'send-state-uncertain' : 'task-failed'
        )
      );
      await appendChatGptTaskDiagnostic(taskContext, 'task-failed', {
        sent,
        uploaded,
        quotaExceeded,
        protectionPaused,
        message
      });
    }
    emitAutomationStatus(event, {
      step: protectionPaused ? 'ChatGPT 访问保护，任务已安全暂停' : quotaExceeded ? 'ChatGPT 额度受限' : 'ChatGPT 自动化失败',
      detail: protectionPaused
        ? `${message} 未发送任务已保留，已发送任务不会自动重发。`
        : quotaExceeded
          ? `${message} 本批次已停止，请按页面提示等待恢复后再从断点续做。`
          : message,
      level: protectionPaused ? 'warning' : 'error',
      protectionPaused,
      pacingMode: protectionPaused ? 'cooldown' : undefined,
      cooldownUntil: protectionPaused ? chatGptConversationAccessBlockedUntil : undefined
    });
    return {
      mode,
      ok: false,
      sent,
      uploaded,
      message,
      error: message,
      paused: protectionPaused,
      protectionPaused,
      taskIndex: taskContext?.taskIndex,
      laneId: taskContext?.laneId
    };
  } finally {
    releaseSubmissionSlot?.();
  }
}

function normalizeChatGptBatchCount(value?: number) {
  return Math.max(1, Math.min(chatGptAutomationMaxBatchCount, Math.round(Number(value) || 1)));
}

async function automateRelayBatch(
  event: IpcMainInvokeEvent,
  settings: AppSettings,
  projectName: string,
  prompt: string,
  attachments: RelayImageAttachment[],
  requestedCount: number,
  targetDimensions: ImageDimensions
): Promise<ChatGptAutomationResult> {
  const mode = settings.chatGptAutomationMode || 'auto-send';
  const total = normalizeChatGptBatchCount(requestedCount);
  await ensureRelayCredentialLoaded();
  if (!relaySessionApiKey || !relaySessionConfig) {
    const message = 'API 未配置。请先粘贴自己的 API Key。';
    return { mode, ok: false, sent: false, uploaded: false, message, error: message, requestedCount: total, completedCount: 0, savedImages: [] };
  }
  if (chatGptAutomationRunning || chatGptAnalysisRunning) {
    const message = chatGptAnalysisRunning
      ? '原图 AI 分析正在运行，请等待完成后再开始 API 做图。'
      : '已有一个图片生成任务正在运行，请等待当前批次结束。';
    return { mode, ok: false, sent: false, uploaded: false, message, error: message, requestedCount: total, completedCount: 0, savedImages: [] };
  }

  const batchConnection = { ...relaySessionConfig, apiKey: relaySessionApiKey };
  const relayModel = batchConnection.model;
  const adapter = configuredRelayAdapter();
  try {
    await adapter.testConnection({
      ...batchConnection
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'API 连接或图片模型权限检查失败。';
    await appendChatGptAutomationDiagnostic('relay-preflight-failed', {
      errorCode: error instanceof RelayImageAdapterError ? error.code : 'UNKNOWN',
      reason
    });
    emitAutomationStatus(event, {
      step: 'API 尚未准备好',
      detail: reason,
      level: 'error',
      effectiveParallelism: 0
    });
    return {
      mode,
      ok: false,
      sent: false,
      uploaded: false,
      message: reason,
      error: reason,
      requestedCount: total,
      completedCount: 0,
      savedImages: []
    };
  }
  const resolution = relayResolutionForDimensions(targetDimensions);
  const canvasDimensions = parseRelayResolution(resolution);
  const [mainAttachment, ...referenceAttachments] = attachments;
  if (!mainAttachment) {
    const message = 'API 图片编辑缺少主垫图。';
    return { mode, ok: false, sent: false, uploaded: false, message, error: message, requestedCount: total, completedCount: 0, savedImages: [] };
  }
  let canvasPlan: RelayCanvasPlan;
  let relayAttachments: RelayImageAttachment[];
  try {
    const preparedMain = await prepareRelayMainAttachment(mainAttachment.data, targetDimensions, canvasDimensions);
    canvasPlan = preparedMain.plan;
    relayAttachments = [{ ...mainAttachment, mimeType: preparedMain.mimeType, data: preparedMain.buffer }, ...referenceAttachments];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'API 主垫图保真准备失败。';
    return { mode, ok: false, sent: false, uploaded: false, message, error: message, requestedCount: total, completedCount: 0, savedImages: [] };
  }
  const jobKey = buildRelayBatchJobKey({
    endpointIdentity: JSON.stringify({ ...batchConnection, apiKey: undefined }),
    projectName,
    prompt,
    total,
    model: relayModel,
    targetDimensions,
    attachments: relayAttachments.map(({ name, data }) => ({ name, data }))
  });
  const checkpointFile = relayBatchCheckpointPath();
  const existingJournal = await readRelayBatchJournal(checkpointFile);
  const canResume = Boolean(
    existingJournal
    && existingJournal.jobKey === jobKey
    && existingJournal.total === total
    && existingJournal.model === relayModel
    && existingJournal.targetDimensions.width === targetDimensions.width
    && existingJournal.targetDimensions.height === targetDimensions.height
  );
  const reservations = await reserveResultFiles(
    projectName,
    total,
    canResume ? existingJournal!.resultSequenceStart : undefined,
    'png'
  );
  let relayJournal: RelayBatchJournal = canResume
    ? existingJournal!
    : createRelayBatchJournal({
        jobKey,
        total,
        model: relayModel,
        resultSequenceStart: reservations[0].sequence,
        targetDimensions
      });
  let relayJournalWrite = Promise.resolve();
  const persistRelayJournal = async () => {
    const snapshot = relayJournal;
    relayJournalWrite = relayJournalWrite.then(() => writeRelayBatchJournalAtomically(checkpointFile, snapshot));
    await relayJournalWrite;
  };
  const setRelayTaskPhase = async (
    taskNumber: number,
    phase: RelayBatchTaskPhase,
    patch: Parameters<typeof transitionRelayBatchTask>[3] = {}
  ) => {
    relayJournal = transitionRelayBatchTask(relayJournal, taskNumber, phase, patch);
    await persistRelayJournal();
  };
  const savedImagesByTask = new Map<number, ImageAsset>();
  for (let taskNumber = 1; taskNumber <= total; taskNumber += 1) {
    const recovered = await loadSavedRelayImage(prompt, targetDimensions, reservations[taskNumber - 1]);
    if (recovered) {
      savedImagesByTask.set(taskNumber, recovered);
      relayJournal = transitionRelayBatchTask(relayJournal, taskNumber, 'saved', {
        savedPath: recovered.path,
        sequence: recovered.sequence
      });
    } else if (relayJournal.tasks[taskNumber - 1]?.phase === 'saved') {
      relayJournal = transitionRelayBatchTask(relayJournal, taskNumber, 'failed', {
        errorCode: 'SAVED_FILE_MISSING',
        message: '断点记录中的结果文件不存在或无法读取，将仅重试这一张。'
      });
    }
  }
  const resumePlan = relayBatchResumePlan(relayJournal, Date.now(), { retryUncertain: true });
  relayJournal = resumePlan.journal;
  await persistRelayJournal();
  const pendingTaskNumbers = resumePlan.pendingTaskNumbers.filter((taskNumber) => !savedImagesByTask.has(taskNumber));
  const failedReasons = new Map<number, string>();
  const manualReviewReasons = new Map<number, string>();
  const requestedParallelism = normalizeChatGptParallelism(settings.chatGptParallelism);
  const effectiveParallelism = Math.min(pendingTaskNumbers.length, requestedParallelism);
  let cursor = 0;
  let startedTaskCount = 0;
  let globalFailure: string | undefined;

  chatGptAutomationRunning = true;
  chatGptBatchPauseRequested = false;
  chatGptBatchProgress = { index: 1, total };
  chatGptBatchStartedAt = Date.now();
  chatGptBatchMonitor = {
    completedCount: 0,
    failedCount: 0,
    manualReviewCount: 0,
    pendingCount: pendingTaskNumbers.length,
    averageDurationMs: 0,
    pacingMode: 'normal',
    effectiveParallelism
  };
  activeRelayAdapter = adapter;
  emitAutomationLifecycle(event, true);
  emitAutomationStatus(event, {
    step: `API 批量生成 0/${total}`,
    detail: canResume
      ? `已从断点恢复 ${savedImagesByTask.size}/${total} 张，仅继续缺失任务；${Math.max(1, effectiveParallelism)} 路执行。`
      : `使用自由 API · ${relayImageModelLabel(relayModel)}，${effectiveParallelism} 路执行。`,
    effectiveParallelism
  });

  const worker = async (laneId: number) => {
    while (!chatGptBatchPauseRequested && !globalFailure) {
      const pendingIndex = cursor;
      if (pendingIndex >= pendingTaskNumbers.length) return;
      cursor += 1;
      startedTaskCount += 1;
      const taskNumber = pendingTaskNumbers[pendingIndex];
      const taskIndex = taskNumber - 1;
      chatGptBatchProgress = { index: taskNumber, total };
      const taskId = `relay-${Date.now()}-${taskNumber}-${randomUUID()}`;
      const scopedEvent = taskScopedAutomationEvent(event, { taskIndex: taskNumber, total, laneId });
      activeRelayTaskIds.add(taskId);
      const startedAt = Date.now();
      emitAutomationStatus(scopedEvent, {
        step: '正在调用自由 API',
        detail: `已一次性提交 ${relayAttachments.length} 张附件，等待图片结果。`,
        effectiveParallelism
      });
      await appendChatGptAutomationDiagnostic('relay-task-started', {
        taskNumber,
        total,
        laneId,
        model: relayModel,
        resolution,
        attachmentCount: relayAttachments.length,
        attachmentBytes: relayAttachments.reduce((sum, attachment) => sum + attachment.data.length, 0),
        effectiveParallelism
      });
      let resultReceived = false;
      try {
        await setRelayTaskPhase(taskNumber, 'submitting', { laneId, requestId: taskId });
        const generated = await adapter.generate({
          taskId,
          ...batchConnection,
          resolution,
          prompt,
          attachments: relayAttachments
        });
        resultReceived = true;
        await appendChatGptAutomationDiagnostic('relay-task-result-received', {
          taskNumber,
          total,
          laneId,
          source: generated.source,
          durationMs: Date.now() - startedAt
        });
        const image = await saveGeneratedImageFromRelay(
          projectName,
          prompt,
          generated,
          targetDimensions,
          canvasPlan,
          reservations[taskIndex]
        );
        savedImagesByTask.set(taskNumber, image);
        await setRelayTaskPhase(taskNumber, 'saved', {
          laneId,
          requestId: taskId,
          savedPath: image.path,
          sequence: image.sequence,
          errorCode: undefined,
          message: undefined
        });
        await appendChatGptAutomationDiagnostic('relay-task-saved', {
          taskNumber,
          total,
          laneId,
          width: image.width,
          height: image.height,
          durationMs: Date.now() - startedAt
        });
        const completedCount = savedImagesByTask.size;
        const finishedCount = completedCount + failedReasons.size + manualReviewReasons.size;
        chatGptBatchMonitor = {
          ...chatGptBatchMonitor!,
          completedCount,
          failedCount: failedReasons.size,
          manualReviewCount: manualReviewReasons.size,
          pendingCount: Math.max(0, total - finishedCount),
          averageDurationMs: Math.round(
            ((chatGptBatchMonitor?.averageDurationMs || 0) * Math.max(0, finishedCount - 1) + (Date.now() - startedAt)) /
            Math.max(1, finishedCount)
          )
        };
        if (!event.sender.isDestroyed()) {
          event.sender.send('chatgpt-automation:result', {
            image,
            completedCount,
            requestedCount: total,
            taskIndex: taskNumber,
            laneId
          });
        }
        emitAutomationStatus(scopedEvent, {
          step: '图片已保存',
          detail: `${image.name} · ${image.width}x${image.height}px`,
          level: 'success',
          effectiveParallelism
        });
      } catch (error) {
        if (
          chatGptBatchPauseRequested ||
          (globalFailure && error instanceof RelayImageAdapterError && error.code === 'CANCELLED')
        ) {
          await setRelayTaskPhase(taskNumber, 'uncertain', {
            laneId,
            requestId: taskId,
            errorCode: 'RESULT_UNCERTAIN',
            message: '任务在付费提交后被暂停，无法确认服务端结果，本轮不会自动重复提交。'
          });
          return;
        }
        const effectiveError = resultReceived && !(error instanceof RelayImageAdapterError)
          ? new RelayImageAdapterError(
              `API 已返回图片，但本地保存未完成：${error instanceof Error ? error.message : String(error)}`,
              'RESULT_UNCERTAIN',
              error
            )
          : error;
        const reason = effectiveError instanceof Error ? effectiveError.message : String(effectiveError);
        const failurePolicy = relayBatchFailurePolicy(effectiveError);
        await appendChatGptAutomationDiagnostic('relay-task-failed', {
          taskNumber,
          total,
          laneId,
          model: relayModel,
          resolution,
          errorCode: effectiveError instanceof RelayImageAdapterError ? effectiveError.code : 'UNKNOWN',
          classification: failurePolicy.classification,
          decision: failurePolicy.stopNewTasks ? 'stop-new-tasks' : 'continue-other-tasks',
          reason,
          durationMs: Date.now() - startedAt
        });
        if (failurePolicy.classification === 'manual-review') {
          manualReviewReasons.set(taskNumber, reason);
          await setRelayTaskPhase(taskNumber, 'uncertain', {
            laneId,
            requestId: taskId,
            errorCode: effectiveError instanceof RelayImageAdapterError ? effectiveError.code : 'UNKNOWN',
            message: reason
          });
        } else {
          failedReasons.set(taskNumber, reason);
          await setRelayTaskPhase(taskNumber, 'failed', {
            laneId,
            requestId: taskId,
            errorCode: effectiveError instanceof RelayImageAdapterError ? effectiveError.code : 'UNKNOWN',
            message: reason
          });
        }
        if (failurePolicy.stopNewTasks) {
          globalFailure ||= reason;
          cursor = total;
        }
        chatGptBatchMonitor = {
          ...chatGptBatchMonitor!,
          completedCount: savedImagesByTask.size,
          failedCount: failedReasons.size,
          manualReviewCount: manualReviewReasons.size,
          pendingCount: Math.max(0, total - savedImagesByTask.size - failedReasons.size - manualReviewReasons.size)
        };
        emitAutomationStatus(scopedEvent, {
          step: failurePolicy.classification === 'manual-review' ? '当前 API 结果待确认' : '本张生成失败',
          detail: reason,
          level: failurePolicy.classification === 'manual-review' ? 'warning' : 'error',
          effectiveParallelism
        });
      } finally {
        activeRelayTaskIds.delete(taskId);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: effectiveParallelism }, (_, index) => worker(index + 1)));
    const savedImages = [...savedImagesByTask.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, image]) => image);
    const latest = savedImages[savedImages.length - 1];
    const completedCount = savedImages.length;
    const firstFailure = [...failedReasons.entries()].sort(([left], [right]) => left - right)[0];
    const firstManualReview = [...manualReviewReasons.entries()].sort(([left], [right]) => left - right)[0];
    const paused = chatGptBatchPauseRequested;
    const ok = !paused && completedCount === total;
    if (ok) await fs.rm(checkpointFile, { force: true });
    const summary = paused
      ? `API 批量任务已暂停，已保存 ${completedCount}/${total} 张。`
      : ok
        ? `API 批量生成完成，已保存 ${completedCount} 张。`
        : firstManualReview && !firstFailure
          ? `任务 ${firstManualReview[0]} 的 API 结果连接中断，当前任务未重复提交并已列为待确认；已保存 ${completedCount}/${total} 张，待确认 ${manualReviewReasons.size} 张。`
          : `${globalFailure ? '批次已停止' : `首个失败原因（任务 ${firstFailure?.[0] || 1}）`}：${firstFailure?.[1] || globalFailure || '未知错误'}；已保存 ${completedCount}/${total} 张。`;
    const message = globalFailure && !paused
      ? `${summary} 未完成任务已保留；请稍后重试${relayModel === RELAY_BANANA_IMAGE_MODEL ? '，或在 API 配置中手动改用标准图片模型' : ''}。软件不会自动切换模型。`
      : summary;
    emitAutomationStatus(event, {
      step: paused ? 'API 批量任务已暂停' : ok ? 'API 批量生成完成' : 'API 批量任务未全部完成',
      detail: message,
      level: ok ? 'success' : paused || manualReviewReasons.size > 0 ? 'warning' : 'error',
      effectiveParallelism
    });
    return {
      mode,
      ok,
      sent: startedTaskCount > 0,
      uploaded: startedTaskCount > 0,
      message,
      error: ok || paused ? undefined : message,
      savedImage: latest,
      savedImages,
      savedPath: latest?.path,
      sequence: latest?.sequence,
      resultDir: latest?.path ? path.dirname(latest.path) : reservations[0]?.resultDir,
      requestedCount: total,
      completedCount,
      paused,
      failedAttempts: failedReasons.size,
      manualReviewCount: manualReviewReasons.size
    };
  } finally {
    for (const taskId of activeRelayTaskIds) adapter.cancel(taskId);
    activeRelayTaskIds.clear();
    activeRelayAdapter = null;
    chatGptBatchProgress = null;
    chatGptBatchPauseRequested = false;
    chatGptAutomationRunning = false;
    emitAutomationLifecycle(event, false);
    chatGptBatchMonitor = null;
    chatGptBatchStartedAt = 0;
  }
}

interface ChatGptBatchCheckpoint {
  version: 5;
  jobKey: string;
  total: number;
  completedTaskIndices: number[];
  tasks: ChatGptTaskRuntimeRecord[];
  recentSamples: ChatGptRuntimeSample[];
  cooldownUntil: number;
  resultSequenceStart: number;
  targetDimensions: ImageDimensions;
  createdAt: number;
  updatedAt: number;
}

interface StoredChatGptBatchCheckpoint {
  version?: number;
  jobKey?: string;
  total?: number;
  completedCount?: number;
  completedTaskIndices?: unknown;
  tasks?: unknown;
  recentSamples?: unknown;
  cooldownUntil?: number;
  resultSequenceStart?: number;
  resultStorage?: unknown;
  targetDimensions?: Partial<ImageDimensions>;
  createdAt?: number;
  updatedAt?: number;
}

function chatGptBatchCheckpointPath() {
  return path.join(appDataDir(), 'chatgpt-batch-checkpoint.json');
}

async function buildChatGptBatchJobKey(
  projectName: string,
  prompt: string,
  files: string[],
  total: number,
  targetDimensions: ImageDimensions,
  provider: WebAiProvider = 'chatgpt'
) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ projectName, prompt, total, targetDimensions, provider }));
  for (const file of files) {
    hash.update(path.basename(file));
    hash.update(await fs.readFile(file));
  }
  return hash.digest('hex');
}

async function archiveChatGptBatchCheckpoint(reason: 'invalid' | 'legacy-post-processing') {
  const source = chatGptBatchCheckpointPath();
  const parsed = path.parse(source);
  const destination = path.join(parsed.dir, `${parsed.name}.${reason}-${Date.now()}${parsed.ext}`);
  try {
    await fs.rename(source, destination);
    return destination;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readChatGptBatchCheckpoint(): Promise<ChatGptBatchCheckpoint | undefined> {
  try {
    const checkpoint = JSON.parse(await fs.readFile(chatGptBatchCheckpointPath(), 'utf8')) as StoredChatGptBatchCheckpoint;
    const commonValid =
      typeof checkpoint.jobKey === 'string' &&
      checkpoint.jobKey.length === 64 &&
      typeof checkpoint.total === 'number' &&
      checkpoint.total >= 1 &&
      Boolean(checkpoint.targetDimensions) &&
      validDimension(checkpoint.targetDimensions?.width) > 0 &&
      validDimension(checkpoint.targetDimensions?.height) > 0 &&
      typeof checkpoint.createdAt === 'number' &&
      typeof checkpoint.updatedAt === 'number' &&
      Date.now() - checkpoint.updatedAt <= 24 * 60 * 60 * 1000;
    if (!commonValid) {
      await archiveChatGptBatchCheckpoint('invalid');
      return undefined;
    }
    const total = checkpoint.total as number;
    const migratedCheckpoint = (
      completedTaskIndices: number[],
      resultSequenceStart: number,
      tasks: unknown = undefined,
      recentSamples: unknown = undefined,
      cooldownUntil = 0
    ): ChatGptBatchCheckpoint => ({
      version: 5,
      jobKey: checkpoint.jobKey as string,
      total,
      completedTaskIndices,
      tasks: normalizeChatGptTaskRuntimeRecords(tasks, total, completedTaskIndices, checkpoint.updatedAt as number),
      recentSamples: normalizeChatGptRuntimeSamples(recentSamples),
      cooldownUntil: Math.max(0, Number(cooldownUntil) || 0),
      resultSequenceStart,
      targetDimensions: checkpoint.targetDimensions as ImageDimensions,
      createdAt: checkpoint.createdAt as number,
      updatedAt: checkpoint.updatedAt as number
    });
    if (checkpoint.version === 1 && typeof checkpoint.completedCount === 'number') {
      return migratedCheckpoint(
        normalizeCompletedTaskIndices(undefined, total, checkpoint.completedCount),
        0
      );
    }
    if (checkpoint.version === 2 && typeof checkpoint.resultSequenceStart === 'number') {
      return migratedCheckpoint(
        normalizeCompletedTaskIndices(checkpoint.completedTaskIndices, total),
        Math.max(1, Math.round(checkpoint.resultSequenceStart))
      );
    }
    if (checkpoint.version === 3 && checkpoint.resultStorage === 'post-processing') {
      await archiveChatGptBatchCheckpoint('legacy-post-processing');
      return undefined;
    }
    if (
      (checkpoint.version === 3 || checkpoint.version === 4) &&
      typeof checkpoint.resultSequenceStart === 'number' &&
      (checkpoint.version === 4 || checkpoint.resultStorage === 'desktop')
    ) {
      return migratedCheckpoint(
        normalizeCompletedTaskIndices(checkpoint.completedTaskIndices, total),
        Math.max(1, Math.round(checkpoint.resultSequenceStart))
      );
    }
    if (checkpoint.version === 5 && typeof checkpoint.resultSequenceStart === 'number') {
      const completedTaskIndices = normalizeCompletedTaskIndices(checkpoint.completedTaskIndices, total);
      return migratedCheckpoint(
        completedTaskIndices,
        Math.max(1, Math.round(checkpoint.resultSequenceStart)),
        checkpoint.tasks,
        checkpoint.recentSamples,
        checkpoint.cooldownUntil
      );
    }
    await archiveChatGptBatchCheckpoint('invalid');
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await archiveChatGptBatchCheckpoint('invalid').catch(() => undefined);
    }
    return undefined;
  }
}

async function writeChatGptBatchCheckpoint(checkpoint: ChatGptBatchCheckpoint) {
  await ensureDir(path.dirname(chatGptBatchCheckpointPath()));
  const temporaryPath = `${chatGptBatchCheckpointPath()}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(checkpoint, null, 2), 'utf8');
    await fs.rename(temporaryPath, chatGptBatchCheckpointPath());
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

async function clearChatGptBatchCheckpoint() {
  await fs.unlink(chatGptBatchCheckpointPath()).catch(() => undefined);
}

function isPermanentChatGptBatchFailure(result: ChatGptAutomationResult) {
  const message = `${result.error || ''} ${result.message || ''}`;
  return /待上传图片不存在|文件夹创建失败|文件写入失败|ENOSPC|EACCES|EPERM|ENOENT|需要重新登录|登录页|验证码|captcha|浏览器一致模式|无法执行后台全自动化|额度.{0,12}(?:不足|限制|用完|耗尽)|频率.{0,12}(?:限制|上限)|rate limit|usage limit|plan limit|too many requests|not enough credits|out of credits/i.test(message);
}

async function waitForChatGptBatchRetry(delayMs: number) {
  const startedAt = Date.now();
  while (!chatGptBatchPauseRequested && Date.now() - startedAt < delayMs) {
    await sleep(Math.min(500, delayMs - (Date.now() - startedAt)));
  }
}

async function prepareGeminiTaskWindows(
  event: IpcMainInvokeEvent,
  settings: AppSettings,
  total: number
): Promise<ChatGptWindowLike[]> {
  await closeChatGptTaskTabs();
  const automationUrl = freshGeminiConversationUrl(settings.geminiUrl);
  const rootWindow = await getGeminiWindow(automationUrl, 'background');
  keepChatGptWindowInBackground(rootWindow);
  const requestedParallelism = Math.min(total, normalizeChatGptParallelism(settings.chatGptParallelism));
  if (requestedParallelism <= 1) return [rootWindow];
  if (!rootWindow.createTab) {
    emitAutomationStatus(event, {
      step: 'Gemini 已安全切换为单路生成',
      detail: '当前专属 Chrome 通道不支持独立标签页，本批次继续单路运行，不会启动额外浏览器进程。',
      level: 'warning'
    });
    return [rootWindow];
  }

  const windows = [rootWindow];
  for (let laneId = 2; laneId <= requestedParallelism; laneId += 1) {
    try {
      const taskWindow = await rootWindow.createTab('about:blank');
      await loadGeminiUrlRecoverably(taskWindow, automationUrl, `Gemini 并行通道 ${laneId}`);
      keepChatGptWindowInBackground(taskWindow);
      chatGptTaskTabs.push(taskWindow);
      taskWindow.on('closed', () => {
        chatGptTaskTabs = chatGptTaskTabs.filter((item) => item !== taskWindow);
      });
      windows.push(taskWindow);
      await appendChatGptAutomationDiagnostic('gemini-parallel-lane-ready', {
        laneId,
        requestedParallelism,
        pageUrl: taskWindow.webContents.getURL()
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      emitAutomationStatus(event, {
        step: `Gemini 并行通道已降为 ${windows.length} 路`,
        detail: `第 ${laneId} 个标签页未能安全建立：${reason}。现有通道继续执行，不会创建第二个 Chrome 进程。`,
        level: 'warning'
      });
      break;
    }
  }
  return windows;
}

async function prepareChatGptTaskWindows(
  event: IpcMainInvokeEvent,
  settings: AppSettings,
  total: number
): Promise<ChatGptWindowLike[]> {
  if (normalizeWebAiProvider(settings.webAiProvider) === 'gemini') {
    return prepareGeminiTaskWindows(event, settings, total);
  }
  await assertChatGptAutomationStartAllowed();
  await closeChatGptTaskTabs();
  const automationUrl = freshChatGptConversationUrl(settings.chatGptUrl || 'https://chatgpt.com/');
  const backend = resolveChatGptBrowserBackend(settings.chatGptBrowserBackend);
  const rootWindow = await getChatGptWindow(automationUrl, backend, 'background');
  keepChatGptWindowInBackground(rootWindow);
  const requestedParallelism = Math.min(total, normalizeChatGptParallelism(settings.chatGptParallelism));
  if (requestedParallelism <= 1) return [rootWindow];
  if (backend !== 'chrome' || !rootWindow.createTab) {
    emitAutomationStatus(event, {
      step: '已安全切换为单路生成',
      detail: '当前自动窗口不支持同一专属 Chrome 的独立标签页；本批次继续单路运行，不会启动额外浏览器进程。',
      level: 'warning'
    });
    return [rootWindow];
  }

  const windows = [rootWindow];
  for (let laneId = 2; laneId <= requestedParallelism; laneId += 1) {
    try {
      emitAutomationStatus(event, {
        step: `正在错峰建立第 ${laneId} 路`,
        detail: `等待 ${Math.round(chatGptParallelLaneStartupIntervalMs / 1000)} 秒后再打开下一个 ChatGPT 标签页，避免同时加载多份会话记录。`
      });
      await sleep(chatGptParallelLaneStartupIntervalMs);
      await assertChatGptPageOperationAllowed(rootWindow.webContents);
      const taskWindow = await rootWindow.createTab(automationUrl);
      installChatGptInteractionGuard(taskWindow.webContents);
      keepChatGptWindowInBackground(taskWindow);
      chatGptTaskTabs.push(taskWindow);
      taskWindow.on('closed', () => {
        chatGptTaskTabs = chatGptTaskTabs.filter((item) => item !== taskWindow);
      });
      windows.push(taskWindow);
      await appendChatGptAutomationDiagnostic('parallel-lane-ready', {
        laneId,
        requestedParallelism,
        pageUrl: taskWindow.webContents.getURL()
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      emitAutomationStatus(event, {
        step: `并行通道已降为 ${windows.length} 路`,
        detail: `第 ${laneId} 个标签页未能安全建立：${reason}。现有通道继续执行，不会创建第二个 Chrome 进程。`,
        level: 'warning'
      });
      await appendChatGptAutomationDiagnostic('parallel-lane-create-failed', {
        laneId,
        requestedParallelism,
        reason
      });
      break;
    }
  }
  return windows;
}

async function automateChatGptBatch(
  event: IpcMainInvokeEvent,
  settings: AppSettings,
  projectName: string,
  prompt: string,
  files: string[],
  requestedCount: number,
  targetDimensions: ImageDimensions
): Promise<ChatGptAutomationResult> {
  const mode = settings.chatGptAutomationMode || 'manual';
  const total = mode === 'auto-send' ? normalizeChatGptBatchCount(requestedCount) : 1;
  const provider = normalizeWebAiProvider(settings.webAiProvider);
  const providerLabel = webAiProviderLabel(provider);
  if (chatGptAutomationRunning || chatGptAnalysisRunning) {
    const message = chatGptAnalysisRunning
      ? `原图 AI 分析正在使用网页服务，请等待分析完成后再开始 ${providerLabel} 做图。`
      : `已有一个 ${providerLabel} 自动生成任务正在运行，请等待当前批次全部结束后再重新生成。`;
    return { mode, ok: false, sent: false, uploaded: false, message, error: message, requestedCount: total, completedCount: 0, savedImages: [] };
  }

  try {
    const acquisition = await acquireChatGptTaskSlot('generation');
    if (!acquisition.acquired) {
      const message = acquisition.blocker === 'analysis'
        ? '原图 AI 分析已先开始，请等待分析完成后再开始做图。'
        : `另一个 ${providerLabel} 自动生成任务已先开始，本轮尚未发送。`;
      return { mode, ok: false, sent: false, uploaded: false, message, error: message, requestedCount: total, completedCount: 0, savedImages: [] };
    }
  } catch {
    const message = '后台登录或模型检查没有在安全时间内结束。本轮尚未发送，请点击“恢复窗口”后重试。';
    return { mode, ok: false, sent: false, uploaded: false, message, error: message, requestedCount: total, completedCount: 0, savedImages: [] };
  }
  chatGptBatchPauseRequested = false;
  chatGptBatchProgress = { index: 1, total };
  chatGptBatchMonitor = {
    completedCount: 0,
    failedCount: 0,
    manualReviewCount: 0,
    pendingCount: total,
    averageDurationMs: 0,
    pacingMode: 'normal',
    effectiveParallelism: 0
  };
  emitAutomationLifecycle(event, true);
  const savedImagesByTask = new Map<number, ImageAsset>();
  const completedTaskIndices = new Set<number>();
  const failedTaskReasons = new Map<number, string>();
  const manualReviewTaskReasons = new Map<number, string>();
  const attemptsByTask = new Map<number, number>();
  let taskRuntimeRecords = createChatGptTaskRuntimeRecords(total);
  let jobKey = '';
  let checkpointCreatedAt = Date.now();
  let resultSequenceStart = 0;
  let lastResult: ChatGptAutomationResult | undefined;
  let globalFailure: ChatGptAutomationResult | undefined;
  let protectionPauseResult: ChatGptAutomationResult | undefined;
  let failedAttempts = 0;
  let timedOut = false;
  const batchStartedAt = Date.now();
  chatGptBatchStartedAt = batchStartedAt;
  let checkpointWriteQueue = Promise.resolve();
  try {
    await loadChatGptRuntimeState();
    if (mode !== 'auto-send') {
      const result = await automateChatGptSend(event, settings, projectName, prompt, files, targetDimensions);
      const savedImages = result.savedImage ? [result.savedImage] : [];
      return {
        ...result,
        savedImages,
        requestedCount: 1,
        completedCount: savedImages.length,
        failedAttempts: result.ok ? 0 : 1
      };
    }

    jobKey = await buildChatGptBatchJobKey(
      projectName,
      prompt,
      files,
      total,
      targetDimensions,
      normalizeWebAiProvider(settings.webAiProvider)
    );
    const previousCheckpoint = await readChatGptBatchCheckpoint();
    const matchingCheckpoint = previousCheckpoint?.jobKey === jobKey ? previousCheckpoint : undefined;
    if (previousCheckpoint && !matchingCheckpoint) await clearChatGptBatchCheckpoint();

    if (matchingCheckpoint) {
      for (const taskIndex of normalizeCompletedTaskIndices(matchingCheckpoint.completedTaskIndices, total)) {
        completedTaskIndices.add(taskIndex);
      }
      checkpointCreatedAt = matchingCheckpoint.createdAt;
      resultSequenceStart = matchingCheckpoint.resultSequenceStart;
      taskRuntimeRecords = normalizeChatGptTaskRuntimeRecords(
        matchingCheckpoint.tasks,
        total,
        [...completedTaskIndices],
        Date.now()
      );
      chatGptRuntimeSamples = normalizeChatGptRuntimeSamples([
        ...chatGptRuntimeSamples,
        ...matchingCheckpoint.recentSamples
      ]);
      chatGptConversationAccessBlockedUntil = Math.max(
        chatGptConversationAccessBlockedUntil,
        matchingCheckpoint.cooldownUntil
      );
      emitAutomationStatus(event, {
        step: completedTaskIndices.size >= total ? '批量任务已经完成' : '正在恢复未完成的批量任务',
        detail:
          completedTaskIndices.size >= total
            ? `检查点显示 ${total}/${total} 张均已保存，本次不会重复发送。`
            : `已确认任务素材与提示词完全一致，只继续任务 ${formatChatGptTaskIndices(missingChatGptTaskIndices(total, [...completedTaskIndices]))}，不重复发送已完成任务。`,
        level: 'warning'
      });
    }

    const initiallyMissing = missingChatGptTaskIndices(total, [...completedTaskIndices]);
    if (!resultSequenceStart) resultSequenceStart = (await nextResultFile(projectName)).sequence;
    let reservations = await reserveResultFiles(projectName, total, resultSequenceStart);
    if (initiallyMissing.some((taskIndex) => fsSync.existsSync(reservations[taskIndex - 1].filePath))) {
      resultSequenceStart = (await nextResultFile(projectName)).sequence;
      reservations = await reserveResultFiles(projectName, total, resultSequenceStart);
      emitAutomationStatus(event, {
        step: '已重新预约安全的结果文件名',
        detail: '恢复检查发现旧预约位置已有文件，为避免覆盖现有结果，本轮已自动使用新的连续序号。',
        level: 'warning'
      });
    }

    const persistCheckpoint = () => {
      const checkpoint: ChatGptBatchCheckpoint = {
        version: 5,
        jobKey,
        total,
        completedTaskIndices: [...completedTaskIndices].sort((left, right) => left - right),
        tasks: taskRuntimeRecords,
        recentSamples: chatGptRuntimeSamples,
        cooldownUntil: Math.max(chatGptConversationAccessBlockedUntil, chatGptSubmissionSafetyBlockedUntil),
        resultSequenceStart,
        targetDimensions,
        createdAt: checkpointCreatedAt,
        updatedAt: Date.now()
      };
      checkpointWriteQueue = checkpointWriteQueue.catch(() => undefined).then(() => writeChatGptBatchCheckpoint(checkpoint));
      return checkpointWriteQueue;
    };
    await persistCheckpoint();

    const pendingTasks = initiallyMissing.map((taskIndex) => ({ taskIndex, notBefore: 0 }));
    if (pendingTasks.length === 0) {
      await clearChatGptBatchCheckpoint();
      return {
        mode,
        ok: true,
        sent: false,
        uploaded: false,
        message: `检查点显示 ${total}/${total} 张均已保存，本次没有重复发送。`,
        savedImages: [],
        requestedCount: total,
        completedCount: total,
        failedAttempts: 0
      };
    }

    if (
      provider === 'chatgpt' &&
      (chatGptProtectionState.phase === 'PROTECTION_PAUSED' || chatGptConversationAccessBlockedUntil > Date.now())
    ) {
      const message = chatGptConversationAccessBlockedUntil > Date.now()
        ? `ChatGPT 访问保护仍在冷却中，约 ${Math.max(1, Math.ceil((chatGptConversationAccessBlockedUntil - Date.now()) / 1000))} 秒后才允许检查。当前保持零点击。`
        : 'ChatGPT 访问保护尚未确认恢复。请先使用“检查恢复”，本轮没有打开页面、上传或发送。';
      emitAutomationStatus(event, {
        step: 'ChatGPT 访问保护，任务已安全暂停',
        detail: message,
        level: 'warning',
        completedCount: completedTaskIndices.size,
        pendingCount: pendingTasks.length,
        protectionPaused: true,
        effectiveParallelism: 0,
        pacingMode: 'cooldown',
        cooldownUntil: chatGptConversationAccessBlockedUntil || undefined
      });
      return {
        mode,
        ok: true,
        sent: false,
        uploaded: false,
        message,
        paused: true,
        protectionPaused: true,
        requestedCount: total,
        completedCount: completedTaskIndices.size,
        savedImages: []
      };
    }

    const laneWindows = await prepareChatGptTaskWindows(event, settings, total);
    const requestedParallelism = laneWindows.length;
    const laneConversations = new Map(
      laneWindows.map((_taskWindow, index) => [index + 1, createChatGptLaneConversation(index + 1)])
    );
    let activeParallelism = chatGptProtectionState.phase === 'RECOVERING_ONE_LANE'
      ? 1
      : chatGptProtectionState.phase === 'RECOVERING_TWO_LANES'
        ? Math.min(2, requestedParallelism)
        : requestedParallelism;
    chatGptBatchMonitor = { ...chatGptBatchMonitor, effectiveParallelism: activeParallelism };
    emitAutomationStatus(event, {
      step: activeParallelism > 1 ? `${activeParallelism} 路并行已就绪` : '单路生成已就绪',
      detail:
        activeParallelism > 1
          ? `同一个专属 Chrome 中已建立 ${activeParallelism} 个独立聊天标签页；每个任务的附件、提示词、回复基线和结果文件相互隔离。`
          : '本批次使用一个独立聊天标签页稳定生成。',
      level: 'success',
      effectiveParallelism: activeParallelism
    });

    let inFlightTaskCount = 0;
    const worker = async (laneId: number, taskWindow: ChatGptWindowLike) => {
      while (true) {
        if (provider === 'chatgpt' && chatGptProtectionState.phase === 'PROTECTION_PAUSED') {
          const taskIndex = pendingTasks[0]?.taskIndex;
          const error = chatGptConversationAccessBlockedUntil > Date.now()
            ? 'ChatGPT 访问保护正在冷却，所有新页面操作已停止。冷却结束后请人工点击“检查恢复”。'
            : 'ChatGPT 访问保护等待人工检查恢复，软件不会自动重新打开对话、上传或发送。';
          protectionPauseResult ||= {
            mode,
            ok: false,
            sent: false,
            uploaded: false,
            message: error,
            error,
            paused: true,
            protectionPaused: true,
            taskIndex,
            laneId
          };
          return;
        }
        const canAssign = canAssignChatGptTask({
          pauseRequested: chatGptBatchPauseRequested,
          hasGlobalFailure: Boolean(globalFailure),
          laneId,
          activeParallelism
        });
        if (!canAssign) {
          const waitingForProtectionRamp =
            !chatGptBatchPauseRequested &&
            !globalFailure &&
            !protectionPauseResult &&
            laneId > activeParallelism &&
            chatGptProtectionState.phase !== 'IDLE';
          if (waitingForProtectionRamp) {
            await waitForChatGptBatchRetry(500);
            continue;
          }
          return;
        }
        const sharedCooldownUntil = Math.max(
          chatGptConversationAccessBlockedUntil,
          chatGptSubmissionSafetyBlockedUntil
        );
        if (sharedCooldownUntil > Date.now()) {
          chatGptBatchMonitor = {
            ...chatGptBatchMonitor,
            pacingMode: 'cooldown',
            cooldownUntil: sharedCooldownUntil,
            completedCount: completedTaskIndices.size,
            failedCount: failedTaskReasons.size,
            manualReviewCount: manualReviewTaskReasons.size,
            pendingCount: pendingTasks.length
          };
          await waitForChatGptBatchRetry(Math.min(1000, sharedCooldownUntil - Date.now()));
          continue;
        }
        if (Date.now() - batchStartedAt >= chatGptBatchTotalTimeoutMs) {
          timedOut = true;
          return;
        }
        const queued = takeReadyChatGptTask(pendingTasks);
        if (!queued.task) {
          if (pendingTasks.length > 0 || inFlightTaskCount > 0) {
            await waitForChatGptBatchRetry(Math.min(500, queued.waitMs || 250));
            continue;
          }
          return;
        }

        const taskIndex = queued.task.taskIndex;
        const taskParallelism = activeParallelism;
        const taskStartedAt = Date.now();
        chatGptBatchMonitor = {
          ...chatGptBatchMonitor,
          pendingCount: pendingTasks.length
        };
        inFlightTaskCount += 1;
        try {
          const attempt = (attemptsByTask.get(taskIndex) || 0) + 1;
          attemptsByTask.set(taskIndex, attempt);
          taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'PROCESSING', {
            attempts: attempt,
            startedAt: taskStartedAt,
            error: undefined
          });
          await persistCheckpoint();
          const scopedEvent = taskScopedAutomationEvent(event, { taskIndex, total, laneId });
          emitAutomationStatus(scopedEvent, {
            step: attempt > 1 ? '正在自动重试当前任务' : '正在准备生成任务',
            detail: `通道 ${laneId}，第 ${attempt}/${chatGptMaxAttemptsPerImage} 次尝试；已完成 ${completedTaskIndices.size}/${total} 张。`
          });
          const taskContext: ChatGptSendTaskContext = {
            window: taskWindow,
            taskIndex,
            laneId,
            total,
            resultFile: reservations[taskIndex - 1],
            conversation: laneConversations.get(laneId)!
          };
          const result = await automateChatGptSend(
            scopedEvent,
            settings,
            projectName,
            prompt,
            files,
            targetDimensions,
            taskContext
          );
          lastResult = result;
          if (result.savedImage) {
            const durationMs = Date.now() - taskStartedAt;
            chatGptRuntimeSamples = appendChatGptRuntimeSample(chatGptRuntimeSamples, {
              durationMs,
              responseMs: durationMs,
              success: true,
              rateLimited: false,
              completedAt: Date.now()
            });
            savedImagesByTask.set(taskIndex, result.savedImage);
            completedTaskIndices.add(taskIndex);
            failedTaskReasons.delete(taskIndex);
            taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'SUCCESS', {
              attempts: attempt,
              resultPath: result.savedImage.path,
              error: undefined
            });
            if (chatGptProtectionState.phase === 'RECOVERING_ONE_LANE' || chatGptProtectionState.phase === 'RECOVERING_TWO_LANES') {
              const ramp = transitionChatGptProtectionState(
                chatGptProtectionState,
                'task-success',
                requestedParallelism
              );
              chatGptProtectionState = ramp.state;
              activeParallelism = ramp.activeParallelism;
              chatGptBatchMonitor = { ...chatGptBatchMonitor, effectiveParallelism: activeParallelism };
              emitAutomationStatus(event, {
                step: chatGptProtectionState.phase === 'IDLE' ? 'ChatGPT 并行已恢复' : `ChatGPT 正在以 ${activeParallelism} 路观察恢复`,
                detail: chatGptProtectionState.phase === 'IDLE'
                  ? `连续健康任务已经通过，恢复用户选择的 ${requestedParallelism} 路。`
                  : '先确认当前通道稳定，再逐步放开下一路，不会一次恢复全部提交。',
                level: 'success',
                protectionPaused: false,
                pacingMode: 'slow',
                effectiveParallelism: activeParallelism
              });
            }
            const pacing = planChatGptAdaptivePacing({
              recentSamples: chatGptRuntimeSamples,
              completedSinceRest: chatGptSubmissionsSinceRest,
              cooldownUntil: 0
            });
            chatGptBatchMonitor = {
              completedCount: completedTaskIndices.size,
              failedCount: failedTaskReasons.size,
              manualReviewCount: manualReviewTaskReasons.size,
              pendingCount: pendingTasks.length,
              averageDurationMs: pacing.averageDurationMs,
              pacingMode: pacing.mode,
              cooldownUntil: undefined,
              effectiveParallelism: activeParallelism
            };
            try {
              await Promise.all([persistCheckpoint(), persistChatGptRuntimeState()]);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              await appendChatGptAutomationDiagnostic('parallel-task-failed', {
                taskIndex,
                laneId,
                attempt,
                phase: 'checkpoint-write',
                classification: 'checkpoint-integrity',
                decision: 'stop-batch',
                reason
              });
              globalFailure ||= {
                ...result,
                taskIndex,
                laneId,
                ok: false,
                message: `结果图已保存，但批量检查点写入失败：${reason}`,
                error: `批量检查点写入失败：${reason}`
              };
              return;
            }
            const completedCount = completedTaskIndices.size;
            if (!event.sender.isDestroyed()) {
              event.sender.send('chatgpt-automation:result', {
                image: result.savedImage,
                completedCount,
                requestedCount: total,
                taskIndex,
                laneId
              });
            }
            continue;
          }

          failedAttempts += 1;
          const reason = result.error || result.message || '本张生成结果没有成功保存。';
          const durationMs = Date.now() - taskStartedAt;
          const rateLimited = isChatGptRateLimitMessage(reason);
          chatGptRuntimeSamples = appendChatGptRuntimeSample(chatGptRuntimeSamples, {
            durationMs,
            responseMs: durationMs,
            success: false,
            rateLimited,
            completedAt: Date.now()
          });
          await persistChatGptRuntimeState();
          if (result.protectionPaused || isChatGptConversationAccessLimitedMessage(reason)) {
            failedAttempts = Math.max(0, failedAttempts - 1);
            rememberChatGptRateLimit(reason);
            activeParallelism = 1;
            chatGptBatchMonitor = { ...chatGptBatchMonitor, effectiveParallelism: 0 };
            const preservedAttempts = result.sent ? attempt : Math.max(0, attempt - 1);
            attemptsByTask.set(taskIndex, preservedAttempts);
            taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'PROTECTION_PAUSED', {
              attempts: preservedAttempts,
              error: reason
            });
            if (!result.sent) {
              pendingTasks.unshift({ taskIndex, notBefore: 0 });
            }
            await persistCheckpoint();
            await appendChatGptAutomationDiagnostic('parallel-task-protection-paused', {
              taskIndex,
              laneId,
              attempt,
              phase: 'automation-result',
              classification: 'conversation-access-rate-limit',
              decision: result.sent ? 'preserve-sent-page' : 'pause-for-manual-recovery',
              cooldownUntil: chatGptConversationAccessBlockedUntil,
              reason
            });
            emitAutomationStatus(event, {
              step: 'ChatGPT 访问保护，任务已安全暂停',
              detail: result.sent
                ? '所有新点击已停止；本任务已经发送，当前聊天页和断点已保留，不会重复发送。'
                : '所有新点击已停止；冷却结束后请使用“检查恢复”，软件不会自动重启批次。',
              level: 'warning',
              pacingMode: 'cooldown',
              cooldownUntil: chatGptConversationAccessBlockedUntil,
              protectionPaused: true,
              effectiveParallelism: 0
            });
            protectionPauseResult ||= result;
            return;
          }
          const rateLimitRecovery = rateLimited
            ? planChatGptRateLimitRecovery(taskParallelism, activeParallelism)
            : undefined;
          if (rateLimited) {
            rememberChatGptRateLimit(reason);
            activeParallelism = 1;
            chatGptBatchMonitor = { ...chatGptBatchMonitor, effectiveParallelism: 0 };
            attemptsByTask.set(taskIndex, Math.max(0, attempt - 1));
            taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'PAUSED', {
              attempts: Math.max(0, attempt - 1),
              error: reason
            });
            pendingTasks.unshift({ taskIndex, notBefore: 0 });
            await persistCheckpoint();
            emitAutomationStatus(event, {
              step: '检测到频率限制，已降为单路并自动冷却',
              detail: `任务 ${taskIndex} 没有记为完成。软件保持零点击；冷却后请人工检查恢复，再从断点继续缺失任务。`,
              level: 'warning',
              pacingMode: 'cooldown',
              cooldownUntil: chatGptConversationAccessBlockedUntil,
              effectiveParallelism: 0
            });
            await appendChatGptAutomationDiagnostic('parallel-rate-limit-downgrade', {
              taskIndex,
              laneId,
              activeParallelism,
              previousRecoveryAction: rateLimitRecovery?.action,
              cooldownUntil: chatGptConversationAccessBlockedUntil,
              reason
            });
            protectionPauseResult ||= result;
            return;
          }
          if (chatGptProtectionState.phase === 'RECOVERING_ONE_LANE' || chatGptProtectionState.phase === 'RECOVERING_TWO_LANES') {
            const ramp = transitionChatGptProtectionState(
              chatGptProtectionState,
              'task-failure',
              requestedParallelism
            );
            chatGptProtectionState = ramp.state;
            activeParallelism = ramp.activeParallelism;
            chatGptBatchMonitor = { ...chatGptBatchMonitor, effectiveParallelism: activeParallelism };
            await persistChatGptRuntimeState();
          }
          if (result.sent && !result.savedImage) {
            manualReviewTaskReasons.set(taskIndex, reason);
            taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'MANUAL_REVIEW', {
              attempts: attempt,
              error: reason
            });
            chatGptBatchMonitor = {
              ...chatGptBatchMonitor,
              completedCount: completedTaskIndices.size,
              failedCount: failedTaskReasons.size,
              manualReviewCount: manualReviewTaskReasons.size,
              pendingCount: pendingTasks.length
            };
            await persistCheckpoint();
            await appendChatGptAutomationDiagnostic('parallel-task-failed', {
              taskIndex,
              laneId,
              attempt,
              phase: 'automation-result',
              classification: 'ambiguous-submission',
              decision: 'quarantine-lane',
              reason
            });
            emitAutomationStatus(scopedEvent, {
              step: '当前通道等待人工确认',
              detail: `任务 ${taskIndex} 已发送但没有确认到结果图；该聊天页已保留且不会复用，其他健康通道继续执行剩余任务。`,
              level: 'warning'
            });
            return;
          }
          const accountWideFailure = isChatGptGlobalFailureMessage(reason);
          const permanentFailure = isPermanentChatGptBatchFailure(result) && !rateLimited;
          if (accountWideFailure) {
            failedTaskReasons.set(taskIndex, reason);
            taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'FAILED', {
              attempts: attempt,
              error: reason
            });
            chatGptBatchMonitor = {
              ...chatGptBatchMonitor,
              completedCount: completedTaskIndices.size,
              failedCount: failedTaskReasons.size,
              manualReviewCount: manualReviewTaskReasons.size,
              pendingCount: pendingTasks.length
            };
            await persistCheckpoint();
            await appendChatGptAutomationDiagnostic('parallel-task-failed', {
              taskIndex,
              laneId,
              attempt,
              phase: 'automation-result',
              classification: 'account-wide',
              decision: 'stop-batch',
              reason
            });
            globalFailure ||= {
              ...result,
              taskIndex,
              laneId
            };
            return;
          }
          if (permanentFailure) {
            failedTaskReasons.set(taskIndex, reason);
            taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'FAILED', {
              attempts: attempt,
              error: reason
            });
            chatGptBatchMonitor = {
              ...chatGptBatchMonitor,
              completedCount: completedTaskIndices.size,
              failedCount: failedTaskReasons.size,
              manualReviewCount: manualReviewTaskReasons.size,
              pendingCount: pendingTasks.length
            };
            await persistCheckpoint();
            await appendChatGptAutomationDiagnostic('parallel-task-failed', {
              taskIndex,
              laneId,
              attempt,
              phase: 'automation-result',
              classification: 'permanent-local',
              decision: 'leave-for-resume',
              reason
            });
            emitAutomationStatus(scopedEvent, {
              step: '当前任务无法继续',
              detail: `任务 ${taskIndex}：${reason} 其他任务继续，稍后可从缺失任务恢复。`,
              level: 'error'
            });
            continue;
          }
          const shouldRetry = shouldRetryChatGptBatchItem({
            attempts: attempt,
            permanentFailure: false,
            pauseRequested: chatGptBatchPauseRequested
          });
          if (!shouldRetry) {
            failedTaskReasons.set(taskIndex, reason);
            taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'FAILED', {
              attempts: attempt,
              error: reason
            });
            chatGptBatchMonitor = {
              ...chatGptBatchMonitor,
              completedCount: completedTaskIndices.size,
              failedCount: failedTaskReasons.size,
              manualReviewCount: manualReviewTaskReasons.size,
              pendingCount: pendingTasks.length
            };
            await persistCheckpoint();
            await appendChatGptAutomationDiagnostic('parallel-task-failed', {
              taskIndex,
              laneId,
              attempt,
              phase: 'automation-result',
              classification: 'task-local',
              decision: 'leave-for-resume',
              reason
            });
            emitAutomationStatus(scopedEvent, {
              step: '当前任务已停止自动重试',
              detail: `任务 ${taskIndex} 连续 ${chatGptMaxAttemptsPerImage} 次未保存；其他任务继续，稍后可从缺失任务恢复。最后原因：${reason}`,
              level: 'error'
            });
            continue;
          }
          const retryDelayMs = Math.min(15000, 3000 + Math.max(0, attempt - 1) * 2000);
          taskRuntimeRecords = updateChatGptTaskRuntimeRecord(taskRuntimeRecords, taskIndex, 'WAITING', {
            attempts: attempt,
            error: reason
          });
          pendingTasks.push({ taskIndex, notBefore: Date.now() + retryDelayMs });
          await persistCheckpoint();
          await appendChatGptAutomationDiagnostic('parallel-task-failed', {
            taskIndex,
            laneId,
            attempt,
            phase: 'automation-result',
            classification: 'task-local',
            decision: 'retry',
            retryDelayMs,
            reason
          });
          emitAutomationStatus(scopedEvent, {
            step: '本任务未保存，稍后自动重试',
            detail: `${reason} ${Math.ceil(retryDelayMs / 1000)} 秒后只重试任务 ${taskIndex}，不会重发其他成功任务。`,
            level: 'warning'
          });
        } finally {
          inFlightTaskCount = Math.max(0, inFlightTaskCount - 1);
        }
      }
    };

    await Promise.all(laneWindows.map((taskWindow, index) => worker(index + 1, taskWindow)));
    await checkpointWriteQueue.catch(() => undefined);
    const savedImages = [...savedImagesByTask.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, image]) => image);
    const latest = savedImages[savedImages.length - 1];
    const completedCount = completedTaskIndices.size;
    const missingTasks = missingChatGptTaskIndices(total, [...completedTaskIndices]);

    if (completedCount === total) {
      await clearChatGptBatchCheckpoint();
      emitAutomationStatus(event, {
        step: total > 1 ? '批量生成完成' : '生成完成',
        detail: total > 1 ? `已按任务序号保存 ${completedCount} 张图片。` : latest?.path,
        level: 'success'
      });
      return {
        ...(lastResult || { mode, ok: true, sent: false, uploaded: false, message: '' }),
        ok: true,
        message: total > 1 ? `已按任务序号保存 ${completedCount} 张图片。` : lastResult?.message || '生成图片已保存。',
        savedImage: latest,
        savedImages,
        savedPath: latest?.path,
        sequence: latest?.sequence,
        resultDir: latest?.path ? path.dirname(latest.path) : lastResult?.resultDir,
        requestedCount: total,
        completedCount,
        failedAttempts
      };
    }

    const baseMessage = chatGptBatchPauseRequested
      ? `批量任务已暂停，已保存 ${completedCount}/${total} 张；下次只继续任务 ${formatChatGptTaskIndices(missingTasks)}。`
      : protectionPauseResult
        ? `ChatGPT 访问保护，任务已安全暂停。已保存 ${completedCount}/${total} 张；缺失任务：${formatChatGptTaskIndices(missingTasks)}。页面仍受保护时请稍后使用“检查恢复”，恢复后只继续缺失任务。`
        : timedOut
        ? `批量任务达到 12 小时总时限，已保存 ${completedCount}/${total} 张；缺失任务：${formatChatGptTaskIndices(missingTasks)}。`
        : globalFailure
          ? buildChatGptBatchIncompleteMessage({
              completedCount,
              total,
              missingTaskIndices: missingTasks,
              failedTasks: [{
                taskIndex: globalFailure.taskIndex || missingTasks[0] || 1,
                reason: globalFailure.error || globalFailure.message
              }]
            })
          : buildChatGptBatchIncompleteMessage({
              completedCount,
              total,
              missingTaskIndices: missingTasks,
              failedTasks: [...manualReviewTaskReasons.entries(), ...failedTaskReasons.entries()]
                .sort(([left], [right]) => left - right)
                .map(([taskIndex, reason]) => ({ taskIndex, reason }))
            });
    for (const taskIndex of missingTasks) {
      const existing = taskRuntimeRecords.find((task) => task.taskIndex === taskIndex);
      if (existing?.status === 'FAILED' || existing?.status === 'MANUAL_REVIEW') continue;
      taskRuntimeRecords = updateChatGptTaskRuntimeRecord(
        taskRuntimeRecords,
        taskIndex,
        protectionPauseResult ? 'PROTECTION_PAUSED' : 'PAUSED',
        {
        attempts: existing?.attempts || 0,
        error: existing?.error || baseMessage
        }
      );
    }
    await persistCheckpoint();
    await appendChatGptAutomationDiagnostic('parallel-batch-incomplete', {
      completedCount,
      total,
      missingTasks: formatChatGptTaskIndices(missingTasks),
      stopReason: chatGptBatchPauseRequested
        ? 'paused'
        : protectionPauseResult
          ? 'protection-paused'
        : timedOut
          ? 'timeout'
          : globalFailure
            ? 'global-failure'
            : manualReviewTaskReasons.size > 0
              ? 'manual-review'
              : 'task-failures'
    });
    chatGptBatchMonitor = {
      ...chatGptBatchMonitor,
      completedCount,
      failedCount: failedTaskReasons.size,
      manualReviewCount: manualReviewTaskReasons.size,
      pendingCount: Math.max(0, missingTasks.length - failedTaskReasons.size - manualReviewTaskReasons.size)
    };
    emitAutomationStatus(event, {
      step: protectionPauseResult
        ? 'ChatGPT 访问保护，任务已安全暂停'
        : chatGptBatchPauseRequested
          ? '批量任务已暂停'
          : '批量任务未全部完成',
      detail: baseMessage,
      level: chatGptBatchPauseRequested || protectionPauseResult ? 'warning' : 'error',
      protectionPaused: Boolean(protectionPauseResult),
      pacingMode: protectionPauseResult ? 'cooldown' : undefined,
      cooldownUntil: protectionPauseResult ? chatGptConversationAccessBlockedUntil || undefined : undefined
    });
    return {
      ...(protectionPauseResult || globalFailure || lastResult || { mode, ok: false, sent: false, uploaded: false, message: baseMessage }),
      ok: chatGptBatchPauseRequested || Boolean(protectionPauseResult),
      message: baseMessage,
      error: chatGptBatchPauseRequested || protectionPauseResult ? undefined : baseMessage,
      paused: chatGptBatchPauseRequested || Boolean(protectionPauseResult),
      protectionPaused: Boolean(protectionPauseResult),
      savedImage: latest,
      savedImages,
      savedPath: latest?.path,
      sequence: latest?.sequence,
      resultDir: latest?.path ? path.dirname(latest.path) : lastResult?.resultDir,
      requestedCount: total,
      completedCount,
      failedAttempts
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const savedImages = [...savedImagesByTask.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, image]) => image);
    const latest = savedImages[savedImages.length - 1];
    const protectionPaused = chatGptManualVerificationRequired || error instanceof ChatGptProtectionPausedError;
    emitAutomationStatus(event, { step: protectionPaused ? 'ChatGPT 等待人工处理，任务已安全暂停' : '批量任务安全停止',
      detail: message, level: protectionPaused ? 'warning' : 'error', protectionPaused, effectiveParallelism: 0 });
    return {
      mode,
      ok: false,
      paused: protectionPaused,
      protectionPaused,
      sent: Boolean(lastResult?.sent),
      uploaded: Boolean(lastResult?.uploaded),
      message,
      error: protectionPaused ? undefined : message,
      savedImage: latest,
      savedImages,
      savedPath: latest?.path,
      sequence: latest?.sequence,
      resultDir: latest?.path ? path.dirname(latest.path) : lastResult?.resultDir,
      requestedCount: total,
      completedCount: completedTaskIndices.size,
      failedAttempts
    };
  } finally {
    chatGptBatchProgress = null;
    chatGptBatchPauseRequested = false;
    chatGptAutomationRunning = false;
    emitAutomationLifecycle(event, false);
    chatGptBatchMonitor = null;
    chatGptBatchStartedAt = 0;
  }
}

function rememberConfirmedChatGptLogin(backend: ChatGptBrowserBackend) {
  lastConfirmedChatGptLogin.set(backend, Date.now());
}

function hasRecentConfirmedChatGptLogin(backend: ChatGptBrowserBackend) {
  const confirmedAt = lastConfirmedChatGptLogin.get(backend) || 0;
  return Date.now() - confirmedAt < chatGptConfirmedLoginGraceMs;
}

function publishChatGptLoginStatus(status: ChatGptLoginStatus) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('chatgpt-login:status-changed', status);
  }
}

async function monitorDedicatedChromeLogin(win: ChatGptWindowLike) {
  const generation = ++chatGptLoginMonitorGeneration;
  const startedAt = Date.now();
  let observedConfirmedLogout = false;
  while (
    generation === chatGptLoginMonitorGeneration &&
    Date.now() - startedAt < 10 * 60 * 1000 &&
    !win.isDestroyed() &&
    chatGptWindow === win &&
    chatGptWindowBackend === 'chrome' &&
    chatGptChromeLoginInterventionActive
  ) {
    if (chatGptManualVerificationRequired) return;
    if ((await observeChatGptManualIntervention(win.webContents)).health.manualIntervention) return;
    if (classifyChatGptNavigation(win.webContents.getURL()) === 'google-oauth') {
      await sleep(1200);
      continue;
    }
    const state = await evalInPageWithTimeout<ChatGptComposerProbeState>(
      win.webContents,
      composerProbeScript(true),
      6500
    ).catch(() => undefined);
    if (isConfirmedChatGptLogout(state)) observedConfirmedLogout = true;
    if (isConfirmedChatGptLogin(state)) {
      rememberConfirmedChatGptLogin('chrome');
      if (observedConfirmedLogout) {
        const status: ChatGptLoginStatus = {
          ok: true,
          loggedIn: true,
          needsLogin: false,
          usable: true,
          message: '像锚专属 Chrome 已登录，自动化将在后台运行。',
          url: win.webContents.getURL(),
          backend: 'chrome'
        };
        publishChatGptLoginStatus(status);
        await appendChatGptAutomationDiagnostic('login-monitor-confirmed', {
          backend: 'chrome',
          sessionAuthenticated: state?.sessionAuthenticated === true,
          composerReady: state?.composerReady === true,
          accountReady: state?.accountReady === true,
          navigation: classifyChatGptNavigation(win.webContents.getURL())
        });
        transitionDedicatedChromeToBackground(win, win.webContents.getURL());
      }
      return;
    }
    await sleep(1200);
  }
}

function transitionDedicatedChromeToBackground(win: ChatGptWindowLike, url: string) {
  setTimeout(() => {
    void (async () => {
      if (
        isAppQuitting ||
        chatGptManualVerificationRequired ||
        chatGptAutomationRunning ||
        chatGptAnalysisRunning ||
        chatGptWindow !== win ||
        chatGptWindowBackend !== 'chrome' ||
        !win.isVisible()
      ) {
        return;
      }
      chatGptChromeLoginInterventionActive = false;
      chatGptLoginMonitorGeneration += 1;
      await persistChatGptPageStorage(win.webContents);
      keepChatGptWindowInBackground(win);
      console.info('[ChatGPT login] dedicated Chrome hidden in place after successful login', {
        url: url || win.webContents.getURL()
      });
    })().catch((error) => {
      console.warn(
        '[ChatGPT login] failed to hide dedicated Chrome after successful login',
        error instanceof Error ? error.message : String(error)
      );
    });
  }, 700);
}

async function checkChatGptLogin(
  url: string,
  fallbackToChrome = false,
  openMode?: AppSettings['chatGptOpenMode'],
  _openExternal = false,
  requestedBackend?: ChatGptBrowserBackend
) {
  const backend = resolveChatGptBrowserBackend(requestedBackend);
  try {
    await loadChatGptRuntimeState();
    if (chatGptManualVerificationRequired && (!chatGptWindow || chatGptWindow.isDestroyed())) {
      return { ok: true, loggedIn: false, needsLogin: true, usable: false,
        message: chatGptManualVerificationMessage, backend, protectionPaused: true, recoveryAvailable: false };
    }
    if (shouldUseExternalChatGpt(openMode)) {
      return {
        ok: true,
        loggedIn: false,
        needsLogin: false,
        message: '当前为浏览器一致模式：登录状态以 Chrome / 默认浏览器为准；检查登录不会主动打开或抢占浏览器窗口。',
        url: url || 'https://chatgpt.com/',
        backend
      };
    }
    if (chatGptAutomationRunning || chatGptAnalysisRunning) {
      const recentlyConfirmed = hasRecentConfirmedChatGptLogin(backend);
      return {
        ok: true,
        loggedIn: recentlyConfirmed,
        needsLogin: false,
        usable: recentlyConfirmed,
        message: recentlyConfirmed
          ? 'ChatGPT 自动任务正在运行；为避免干扰当前标签页，本次沿用刚刚确认的登录状态。'
          : 'ChatGPT 自动任务正在运行；为避免干扰当前标签页，登录复核将在任务结束后进行。',
        url: chatGptWindow?.webContents.getURL() || url || 'https://chatgpt.com/',
        backend,
        recoveryAvailable: false
      };
    }
    const win = await getChatGptWindow(url || 'https://chatgpt.com/', backend, 'background');
    const webContents = win.webContents;
    const inspection = await observeChatGptManualIntervention(webContents);
    if (inspection.health.manualIntervention) {
      return { ok: true, loggedIn: false, needsLogin: true, usable: false,
        message: chatGptManualVerificationMessage, url: webContents.getURL(), backend,
        protectionPaused: true, recoveryAvailable: false };
    }
    if (!chatGptManualVerificationRequired) await ensureChatGptWindowUrl(win, url || 'https://chatgpt.com/');
    const navigationBeforeProbe = classifyChatGptNavigation(webContents.getURL());
    if (backend === 'chrome' && navigationBeforeProbe === 'google-oauth') {
      chatGptChromeLoginInterventionActive = true;
      void monitorDedicatedChromeLogin(win);
      await appendChatGptAutomationDiagnostic('google-login-manual-guard', {
        backend,
        url: webContents.getURL(),
        windowWasAlreadyVisible: win.isVisible(),
        foregroundAction: 'none'
      });
      return {
        ok: true,
        loggedIn: false,
        needsLogin: true,
        usable: false,
        message: 'Google 登录尚未完成。请点击“查看窗口”继续；检查登录不会刷新页面、点击验证步骤或抢占前台。',
        url: webContents.getURL(),
        backend,
        recoveryAvailable: false
      };
    }
    let surface = await waitForUsableChatGptSurface(win, 12000);
    if (!surface.health.usable && !chatGptManualVerificationRequired) {
      const recovered = await recoverChatGptSurface(
        win,
        url || 'https://chatgpt.com/',
        'login-check',
        surface
      );
      surface = recovered.surface;
    }
    if (surface.health.manualIntervention || chatGptManualVerificationRequired) {
      return { ok: true, loggedIn: false, needsLogin: true, usable: false,
        message: chatGptManualVerificationMessage, url: webContents.getURL(), backend,
        protectionPaused: true, recoveryAvailable: false };
    }
    if (!surface.health.usable) {
      return {
        ok: false,
        loggedIn: false,
        needsLogin: false,
        usable: false,
        message: 'ChatGPT 页面为空白或加载异常，后台自动恢复已达到安全次数。请检查网络后点击“恢复窗口”。',
        url: webContents.getURL(),
        backend,
        recoveryAvailable: true,
        recoveryReason: 'login-check-surface-unusable',
        recoveryAttempts: 2
      };
    }
    const state = await waitForStableChatGptProbe(webContents, 20000, false);
    const currentUrl = webContents.getURL();
    console.info('[ChatGPT login probe] check-login state', { ...state, currentUrl });
    await appendChatGptAutomationDiagnostic('login-check-probe', {
      backend,
      navigation: classifyChatGptNavigation(currentUrl),
      confirmedLogin: isConfirmedChatGptLogin(state),
      confirmedLogout: isConfirmedChatGptLogout(state),
      sessionAuthenticated: state?.sessionAuthenticated === true,
      sessionUnauthenticated: state?.sessionUnauthenticated === true,
      sessionStatus: state?.sessionStatus || 0,
      composerReady: state?.composerReady === true,
      accountReady: state?.accountReady === true,
      rawLoginSurface: state?.rawLoginSurface === true,
      reason: state?.reason || 'probe-unavailable'
    });
    if (isConfirmedChatGptLogin(state)) {
      rememberConfirmedChatGptLogin(backend);
      await persistChatGptPageStorage(webContents);
      if (backend === 'embedded') await flushChatGptSessionStorage();
      if (backend === 'chrome' && win.isVisible()) transitionDedicatedChromeToBackground(win, currentUrl);
      return {
        ok: true,
        loggedIn: true,
        needsLogin: false,
        usable: true,
        message:
          backend === 'chrome'
            ? '像锚专属 Chrome 已登录，自动化将在后台运行。'
            : 'ChatGPT 自动窗口已登录。',
        url: currentUrl,
        backend
      };
    }
    if (
      isConfirmedChatGptLogout(state) ||
      currentUrl.includes('/auth') ||
      currentUrl.includes('/login') ||
      classifyChatGptNavigation(currentUrl) === 'google-oauth'
    ) {
      lastConfirmedChatGptLogin.delete(backend);
      keepChatGptWindowInBackground(win);
      return {
        ok: true,
        loggedIn: false,
        needsLogin: true,
        usable: false,
        message:
          backend === 'chrome'
            ? '像锚专属 Chrome 需要完成登录。请点击“查看窗口”处理。'
            : 'ChatGPT 自动窗口需要重新登录。使用 Google 登录时会自动切换到专属 Chrome。',
        url: currentUrl,
        backend
      };
    }
    if (state?.composerReady && !state.accountReady) {
      keepChatGptWindowInBackground(win);
      return {
        ok: true,
        loggedIn: false,
        needsLogin: false,
        usable: true,
        message: 'ChatGPT 自动窗口输入框可用，未检测到登录页；账号菜单未显示，暂时无法完全确认登录状态。',
        url: currentUrl,
        backend
      };
    }
    if (hasRecentConfirmedChatGptLogin(backend)) {
      keepChatGptWindowInBackground(win);
      return {
        ok: true,
        loggedIn: true,
        needsLogin: false,
        usable: true,
        message:
          backend === 'chrome'
            ? '像锚专属 Chrome 已登录；本次页面复核暂未完成，将继续使用已确认的会话。'
            : 'ChatGPT 自动窗口已登录；本次页面复核暂未完成，将继续使用已确认的会话。',
        url: currentUrl,
        backend
      };
    }
    return {
      ok: false,
      loggedIn: false,
      needsLogin: false,
      message: '暂时无法确认 ChatGPT 登录状态，请查看自动窗口。',
      url: currentUrl,
      backend
    };
  } catch (error) {
    const message = describeChatGptWindowFailure(error, 'check');
    console.warn('[ChatGPT login] check failed', error instanceof Error ? error.message : String(error));
    await appendChatGptAutomationDiagnostic('login-check-failed', {
      message: error instanceof Error ? error.message : String(error),
      ...chatGptWindowDiagnosticSnapshot(chatGptWindow)
    });
    return {
      ok: false,
      loggedIn: false,
      needsLogin: false,
      message,
      error: message,
      backend,
      recoveryAvailable: true,
      recoveryReason: 'login-check-failed',
      recoveryAttempts: 2
    };
  }
}

async function checkChatGptLoginAndProtection(
  event: IpcMainInvokeEvent,
  payload: {
    url: string;
    fallbackToChrome?: boolean;
    openMode?: AppSettings['chatGptOpenMode'];
    openExternal?: boolean;
    backend?: ChatGptBrowserBackend;
    reconcileProtection?: boolean;
  }
): Promise<ChatGptLoginStatus> {
  await loadChatGptRuntimeState();
  const login = await checkChatGptLogin(
    payload.url,
    payload.fallbackToChrome,
    payload.openMode,
    payload.openExternal,
    payload.backend
  );
  if (chatGptProtectionState.phase !== 'PROTECTION_PAUSED') return login;

  if (!payload.reconcileProtection) {
    return {
      ...login,
      protectionPaused: true,
      message: `${login.message}；ChatGPT 访问保护仍在安全暂停，点击“检查恢复”或再次主动检查登录后再继续。`
    };
  }

  const now = Date.now();
  if (!shouldReconcileChatGptProtectionFromLoginCheck({
    phase: chatGptProtectionState.phase,
    loginUsable: login.usable === true,
    cooldownUntil: chatGptConversationAccessBlockedUntil,
    now
  })) {
    const cooldownMessage = chatGptConversationAccessBlockedUntil > now
      ? `ChatGPT 访问保护仍在冷却中，约 ${Math.max(1, Math.ceil((chatGptConversationAccessBlockedUntil - now) / 1000))} 秒后才能检查恢复。`
      : 'ChatGPT 页面尚未确认输入框稳定可用，访问保护继续安全暂停。';
    return {
      ...login,
      protectionPaused: true,
      message: `${login.message}；${cooldownMessage}`
    };
  }

  const win = chatGptWindow && !chatGptWindow.isDestroyed()
    ? chatGptWindow
    : await getChatGptWindow(payload.url || 'https://chatgpt.com/', payload.backend, 'background');
  const recovery = await recoverChatGptConversationAccessAfterCooldown(event, win.webContents, { manual: true });
  return {
    ...login,
    protectionPaused: !recovery.ok && recovery.paused,
    message: recovery.ok
      ? `${login.message}；访问保护恢复检查已通过，将先以单路继续缺失任务。`
      : `${login.message}；${recovery.error}`
  };
}

async function listChatGptModels(
  url: string,
  requestedBackend?: ChatGptBrowserBackend
): Promise<ChatGptModelCatalog> {
  try {
    if (chatGptAutomationRunning || chatGptAnalysisRunning) {
      const message = 'ChatGPT 自动任务正在运行。为避免打开模型菜单干扰当前标签页，请在任务结束后刷新模型。';
      return { ok: false, models: [], refreshedAt: new Date().toISOString(), message, error: message, provider: 'chatgpt' };
    }
    const backend = resolveChatGptBrowserBackend(requestedBackend);
    const targetUrl = url || defaultWebAiUrls.chatgpt;
    const coldStart = !hasRecentConfirmedChatGptLogin(backend);
    if (coldStart) {
      const loginStatus = await checkChatGptLogin(targetUrl, false, undefined, false, backend);
      if (!loginStatus.loggedIn && !loginStatus.usable) {
        const message = loginStatus.needsLogin
          ? '请先登录专属 Chrome，再刷新模型。'
          : loginStatus.message || 'ChatGPT 页面尚未准备好模型选择器，请稍后重试。';
        return { ok: false, models: [], refreshedAt: new Date().toISOString(), message, error: message, provider: 'chatgpt' };
      }
    }
    const win = await getChatGptWindow(targetUrl, backend, 'background');
    await ensureChatGptWindowUrl(win, targetUrl);
    keepChatGptWindowInBackground(win);
    const composer = await waitForChatGptComposer(win.webContents, 30000);
    if (!isAutomationComposerReady(composer)) {
      const message = isConfirmedChatGptLogout(composer)
        ? '请先登录专属 Chrome，再刷新模型。'
        : 'ChatGPT 页面尚未准备好模型选择器，请稍后重试。';
      return { ok: false, models: [], refreshedAt: new Date().toISOString(), message, error: message, provider: 'chatgpt' };
    }
    const catalog = await inspectChatGptModels(win, '', coldStart ? 10 : 3);
    const discovery = resolveChatGptModelDiscovery({
      composerReady: true,
      explicitModelPicker: catalog.modelMode === 'explicit',
      modelCount: catalog.models.length
    });
    keepChatGptWindowInBackground(win);
    await appendChatGptAutomationDiagnostic('chatgpt-model-catalog', {
      currentModel: catalog.currentModel || 'unknown',
      availableModels: catalog.models.map((model) => model.label),
      ok: discovery.ok,
      modelMode: discovery.modelMode
    });
    return {
      ...catalog,
      ok: discovery.ok,
      modelMode: discovery.modelMode,
      message: discovery.message,
      error: discovery.ok ? undefined : catalog.error,
      provider: 'chatgpt'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取 ChatGPT 模型失败。';
    return {
      ok: false,
      models: [],
      refreshedAt: new Date().toISOString(),
      message: '暂时无法读取当前账号模型，请确认专属 Chrome 已登录后重试。',
      error: message,
      provider: 'chatgpt'
    };
  }
}

function createWebAiControlAdapter(
  provider: WebAiProvider,
  url: string,
  backend?: ChatGptBrowserBackend
): WebAiControlAdapter {
  if (provider === 'gemini') {
    return {
      provider,
      ensureReady: async () => {
        const win = await getGeminiWindow(url, 'background');
        await ensureGeminiWindowUrl(win, url);
        return waitForGeminiPage(win.webContents, 20_000);
      },
      checkLogin: () => checkGeminiLogin(url),
      showWindow: () => showGeminiWindowForInspection(url),
      listModels: () => listGeminiModels(url)
    };
  }
  return {
    provider,
    ensureReady: async () => {
      const resolvedBackend = resolveChatGptBrowserBackend(backend);
      const win = await getChatGptWindow(url, resolvedBackend, 'background');
      await ensureChatGptWindowUrl(win, url);
      return waitForChatGptComposer(win.webContents, 30_000);
    },
    checkLogin: () => checkChatGptLogin(url, false, 'auto', false, backend),
    showWindow: () => showChatGptWindowForInspection(url, 'auto', backend),
    listModels: () => listChatGptModels(url, backend)
  };
}

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
}

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.replace(/^data:.*?;base64,/, '');
}

function parseJsonObject(text: string) {
  return parseOllamaJsonObject(text);
}

function pickAnalysisValue(parsed: Record<string, unknown>, names: string[]) {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s_\-：:]/g, '');
  for (const name of names) {
    const direct = parsed[name];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
  }
  const normalizedNames = names.map(normalize);
  for (const [key, value] of Object.entries(parsed)) {
    const normalizedKey = normalize(key);
    if (normalizedNames.some((name) => normalizedKey.includes(name) || name.includes(normalizedKey))) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}

function isTemplateAnalysisValue(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[“”"'`，。！？、：:\s_-]/g, '');
  return [
    '场景',
    '场景描述',
    '你看到的场景',
    '姿态',
    '姿态描述',
    '动作',
    '动作描述',
    '脸部朝向',
    '脸部朝向描述',
    '面部朝向',
    '面部朝向描述',
    '光影',
    '光影妆容',
    '光影妆容描述',
    '编辑约束',
    '约束',
    '精确注释',
    '精准说明'
  ].includes(normalized);
}

function isUsefulAnalysisValue(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed) && !isTemplateAnalysisValue(trimmed);
}

function parseStructuredAnalysisObject(text: string): MainImageAnalysis | null {
  try {
    const parsed = parseJsonObject(text) as Record<string, unknown>;
    const fixedPrecisionNotes =
      '红圈内的人脸替换要融入原图，维持红圈内原先面部光影、手机拍摄普通画质和真实皮肤质感，红圈外完全不变，不要简单把头P过去。';
    const analysis = {
      sceneDescription: pickAnalysisValue(parsed, ['sceneDescription', 'scene description', '场景描述', '原图场景描述', '场景']),
      poseDescription: pickAnalysisValue(parsed, ['poseDescription', 'pose description', '姿势描述', '动作描述', '人物动作描述', '身体姿态描述', '原图人物动作与身体姿态']),
      faceDirectionDescription: pickAnalysisValue(parsed, [
        'faceDirectionDescription',
        'face direction',
        'face direction description',
        '面部方向描述',
        '面部朝向描述',
        '原图面部朝向与表情',
        '脸部朝向描述'
      ]),
      lightingMakeupDescription: pickAnalysisValue(parsed, [
        'lightingMakeupDescription',
        'lightingMakeup',
        'lighting makeup description',
        '灯光化妆描述',
        '光影妆容描述',
        '原图光影妆容描述',
        '光影与妆容',
        '光线妆容描述'
      ]),
      precisionNotes: fixedPrecisionNotes
    };
    const requiredValues = [analysis.sceneDescription, analysis.poseDescription, analysis.faceDirectionDescription, analysis.lightingMakeupDescription];
    return requiredValues.filter(isUsefulAnalysisValue).length >= 3 ? analysis : null;
  } catch {
    return null;
  }
}

function parseAnalysisObject(text: string): MainImageAnalysis {
  const structured = parseStructuredAnalysisObject(text);
  if (structured) return structured;
  const clean = text.replace(/```[\s\S]*?```/g, '').trim();
  const summary = clean || '以原图可见内容为准，保持原图真实拍摄条件与整体画面不变。';
  return {
    sceneDescription: `原图场景以画面可见内容为准：${summary} 请保持背景环境、构图、图片比例、普通手机拍摄质感和整体真实感不变。`,
    poseDescription: '人物动作、身体姿态、肩颈位置、手部动作、衣服、道具和红圈外身体部分均以原图为准，红圈外完全不变。',
    faceDirectionDescription: '面部朝向、头部角度、眼神方向、表情情绪、嘴唇状态和眉眼状态均以原图红圈内原先状态为准，替换后的人脸必须匹配原图角度。',
    lightingMakeupDescription: '原图红圈内面部光影以画面可见状态为准：请保留主光颜色和色温、额头与眉眼的明暗关系、鼻梁和脸颊的高光或亮面、鼻翼一侧和下颌附近的阴影、肤色环境反射、妆容浓淡、皮肤纹理、毛孔瑕疵、噪点、压缩痕迹、清晰度和普通手机拍摄画质。',
    precisionNotes: '红圈内的人脸替换要融入原图，维持红圈内原先面部光影、手机拍摄普通画质和真实皮肤质感，红圈外完全不变，不要简单把头P过去。'
  };
}

interface JsonResponse {
  ok: boolean;
  status: number;
  json: Record<string, any>;
  text: string;
}

async function fetchJsonWithTimeout(url: string, init: Parameters<typeof fetch>[1], timeoutMs: number, timeoutMessage: string): Promise<JsonResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json: Record<string, any> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, any>) : {};
    } catch {
      json = {};
    }
    return { ok: response.ok, status: response.status, json, text };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isLocalOllamaBaseUrl(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

function startLocalOllamaServer() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const executable = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
  const command = fsSync.existsSync(executable) ? executable : 'ollama';
  console.info('[Ollama vision] starting local service in background', command);
  const child = spawn(command, ['serve'], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.once('error', (error) => {
    console.warn('[Ollama vision] background service start failed', error.message);
  });
  child.unref();
}

async function readOllamaVisionModels(baseUrl: string): Promise<OllamaVisionModel[]> {
  const tagsResponse = await fetchJsonWithTimeout(
    `${baseUrl}/api/tags`,
    { method: 'GET' },
    5000,
    '连接 Ollama 超时。'
  );
  if (!tagsResponse.ok) {
    throw new Error(String(tagsResponse.json.error || tagsResponse.text || `Ollama 返回 HTTP ${tagsResponse.status}`));
  }
  const rawModels = Array.isArray(tagsResponse.json.models) ? tagsResponse.json.models : [];
  return Promise.all(
    rawModels.map(async (model: Record<string, any>) => {
      const name = String(model.name || model.model || '').trim();
      let capabilities: string[] = [];
      if (name) {
        try {
          const showResponse = await fetchJsonWithTimeout(
            `${baseUrl}/api/show`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
              body: JSON.stringify({ model: name })
            },
            5000,
            `读取模型 ${name} 信息超时。`
          );
          if (showResponse.ok && Array.isArray(showResponse.json.capabilities)) {
            capabilities = showResponse.json.capabilities.map(String);
          }
        } catch (error) {
          console.warn('[Ollama vision] model capability probe failed', name, error instanceof Error ? error.message : String(error));
        }
      }
      return {
        name,
        size: Number(model.size || 0),
        capabilities
      };
    })
  );
}

async function ensureOllamaVisionModels(baseUrl: string, onStarting?: () => void) {
  try {
    return await readOllamaVisionModels(baseUrl);
  } catch (initialError) {
    if (!isLocalOllamaBaseUrl(baseUrl)) throw initialError;
    onStarting?.();
    try {
      startLocalOllamaServer();
    } catch (error) {
      console.warn('[Ollama vision] could not launch local service', error instanceof Error ? error.message : String(error));
    }
    let lastError: unknown = initialError;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(1000);
      try {
        return await readOllamaVisionModels(baseUrl);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

function emitMainImageAnalysisStatus(event: IpcMainInvokeEvent, status: MainImageAnalysisStatus) {
  if (!event.sender.isDestroyed()) event.sender.send('main-image-analysis:status', status);
}

function localOllamaExecutableExists() {
  const localAppData = process.env.LOCALAPPDATA || '';
  return fsSync.existsSync(path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'));
}

function localAnalysisStatus(
  state: LocalAnalysisModelStatus['state'],
  message: string,
  options: Partial<LocalAnalysisModelStatus> = {}
): LocalAnalysisModelStatus {
  return {
    state,
    ready: state === 'ready',
    serviceReady: state === 'ready' || state === 'model-missing' || state === 'downloading',
    installedModels: [],
    message,
    ...options
  };
}

async function getLocalAnalysisStatus(baseUrl: string, preferredModel = 'auto'): Promise<LocalAnalysisModelStatus> {
  try {
    const installedModels = await ensureOllamaVisionModels(baseUrl);
    const candidates = selectOllamaVisionModels(installedModels, preferredModel, lastSuccessfulOllamaVisionModel);
    if (candidates.length) {
      return localAnalysisStatus('ready', `本地模型已就绪：${candidates[0].name}`, {
        model: candidates[0].name,
        installedModels: candidates.map((model) => model.name)
      });
    }
    return localAnalysisStatus('model-missing', `本地服务已启动，需要下载 ${localAnalysisDefaultModel}。`, {
      installedModels: installedModels.map((model) => model.name)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = !localOllamaExecutableExists() && /fetch failed|econnrefused|connection refused|无法连接|failed to connect/i.test(message);
    return localAnalysisStatus(
      missing ? 'service-missing' : 'error',
      missing ? '尚未安装本地分析服务。点击后从官方网站下载安装。' : explainOllamaFailure(message).message,
      missing ? { downloadUrl: localAnalysisInstallerUrl } : {}
    );
  }
}

async function pullLocalAnalysisModel(
  event: IpcMainInvokeEvent,
  baseUrl: string,
  model = localAnalysisDefaultModel
): Promise<LocalAnalysisModelStatus> {
  const response = await fetch(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ model, stream: true })
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `下载模型失败，Ollama 返回 HTTP ${response.status}。`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastProgress = 0;
  const emitProgress = (progress: number, message: string) => {
    const status = localAnalysisStatus('downloading', message, { model, progress });
    if (!event.sender.isDestroyed()) event.sender.send('local-analysis:model-progress', status);
  };
  emitProgress(0, `正在下载 ${model}，可以继续使用软件的其他功能。`);

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? '' : lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (record.error) throw new Error(String(record.error));
      const total = Number(record.total || 0);
      const completed = Number(record.completed || 0);
      const progress = total > 0 ? Math.min(100, Math.max(0, Math.round((completed / total) * 100))) : lastProgress;
      if (progress !== lastProgress || record.status === 'success') {
        lastProgress = progress;
        emitProgress(progress, record.status === 'success' ? `${model} 下载完成，正在确认模型。` : `正在下载 ${model} · ${progress}%`);
      }
    }
    if (done) break;
  }

  const finalStatus = await getLocalAnalysisStatus(baseUrl, model);
  if (!event.sender.isDestroyed()) event.sender.send('local-analysis:model-progress', finalStatus);
  return finalStatus;
}

function emitWebPoseAnalysisStatus(event: IpcMainInvokeEvent, status: WebPoseAnalysisStatus) {
  if (!event.sender.isDestroyed()) event.sender.send('web-pose-analysis:status', status);
}

function summarizeChatGptAnalysisSnapshot(snapshot?: ChatGptAssistantTextSnapshot) {
  if (!snapshot) return { captured: false };
  return {
    captured: true,
    responseLength: snapshot.text.length,
    rootStrategy: snapshot.rootStrategy,
    assistantMessageCount: snapshot.assistantMessageCount,
    messageNodeCount: snapshot.messageNodeCount,
    busyCount: snapshot.busyCount,
    stopVisible: snapshot.stopVisible,
    errorDetected: Boolean(snapshot.errorText),
    candidates: snapshot.candidates.map((candidate) => ({
      source: candidate.source,
      textLength: candidate.text.length,
      domIndex: candidate.domIndex,
      isNew: candidate.isNew,
      assistantAssociated: candidate.assistantAssociated,
      userAssociated: candidate.userAssociated,
      composerAssociated: candidate.composerAssociated,
      promptEcho: candidate.promptEcho,
      structuredFieldHits: candidate.structuredFieldHits,
      pendingOnly: candidate.pendingOnly,
      textKind: candidate.text.trim().startsWith('{')
        ? 'json-like'
        : candidate.text.includes('```')
          ? 'code-like'
          : 'plain-text'
    }))
  };
}

async function appendChatGptAutomationDiagnostic(kind: string, details: Record<string, unknown>) {
  try {
    const logDir = path.join(appDataDir(), 'logs');
    const logPath = path.join(logDir, 'chatgpt-automation.ndjson');
    const previousLogPath = path.join(logDir, 'chatgpt-automation.previous.ndjson');
    await ensureDir(logDir);
    const stat = await fs.stat(logPath).catch(() => undefined);
    if (stat && stat.size > 512 * 1024) {
      await fs.unlink(previousLogPath).catch(() => undefined);
      await fs.rename(logPath, previousLogPath).catch(() => undefined);
    }
    const safeDetails = sanitizeDiagnosticRecord(details);
    await fs.appendFile(
      logPath,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        kind,
        appVersion: app.getVersion(),
        ...safeDetails
      })}\n`,
      'utf8'
    );
  } catch (error) {
    console.warn('[ChatGPT automation] diagnostic write failed', error instanceof Error ? error.message : String(error));
  }
}

function isMeaningfulUnstructuredAnalysis(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 50) return false;
  try {
    const parsed = parseJsonObject(trimmed) as Record<string, unknown>;
    const descriptiveValues = [
      pickAnalysisValue(parsed, ['sceneDescription', '场景描述', '场景']),
      pickAnalysisValue(parsed, ['poseDescription', '姿势描述', '动作描述']),
      pickAnalysisValue(parsed, ['faceDirectionDescription', '面部朝向描述', '脸部朝向描述']),
      pickAnalysisValue(parsed, ['lightingMakeupDescription', '光影妆容描述', '灯光化妆描述'])
    ];
    if (descriptiveValues.every((value) => !value)) return false;
    if (descriptiveValues.filter(isUsefulAnalysisValue).length < 3) return false;
  } catch {
    // A useful plain-language description is accepted and completed with safe defaults.
  }
  return !/(i can(?:not|'t)|unable to|cannot analyze|无法.{0,8}(分析|查看)|抱歉)/i.test(trimmed);
}

async function waitForChatGptSendAcceptance(
  webContents: ChatGptWebContentsLike,
  baseline: ChatGptImageBaseline,
  timeoutMs: number
): Promise<ChatGptSendAcceptanceSnapshot | undefined> {
  const startedAt = Date.now();
  let lastSnapshot: ChatGptSendAcceptanceSnapshot | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await evalInPageWithTimeout<ChatGptSendAcceptanceSnapshot>(
      webContents,
      sendAcceptedSnapshotScript(baseline),
      5000
    ).catch(() => lastSnapshot);
    if (lastSnapshot?.accepted) return lastSnapshot;
    if (lastSnapshot?.terminalFailure) return lastSnapshot;
    await sleep(500);
  }
  return lastSnapshot;
}

async function waitForChatGptSendAcceptanceWithNoOpRetry(
  webContents: ChatGptWebContentsLike,
  baseline: ChatGptImageBaseline,
  context: 'analysis' | 'web-pose',
  timeoutMs = 30_000
) {
  const initialWaitMs = Math.min(timeoutMs, 8_000);
  let snapshot = await waitForChatGptSendAcceptance(webContents, baseline, initialWaitMs);
  if (!snapshot || snapshot.accepted || snapshot.terminalFailure || !shouldRetryChatGptNoOpSend(baseline, snapshot)) {
    return snapshot;
  }

  await appendChatGptAutomationDiagnostic('chatgpt-send-noop-retry', {
    context,
    composerTextLength: snapshot.composerTextLength,
    attachmentCount: snapshot.attachmentCount,
    userMessageCount: snapshot.userMessageCount,
    messageNodeCount: snapshot.messageNodeCount
  });
  const retry = await evalChatGptMutation<{ sent: boolean; method: string; label: string }>(
    webContents,
    fallbackClickSendScript,
    6_000
  ).catch(() => ({ sent: false, method: 'script-error', label: '' }));
  if (!retry.sent) return snapshot;

  snapshot = await waitForChatGptSendAcceptance(webContents, baseline, Math.max(1_000, timeoutMs - initialWaitMs));
  return snapshot;
}

async function waitForChatGptAnalysisResponse(
  webContents: ChatGptWebContentsLike,
  baseline: ChatGptImageBaseline,
  timeoutMs = 180000,
  structuredResponseValidator?: (text: string) => boolean
) {
  const startedAt = Date.now();
  let lastSnapshot: ChatGptAssistantTextSnapshot | undefined;
  let bestSnapshot: ChatGptAssistantTextSnapshot | undefined;
  let bestSnapshotQuality = Number.NEGATIVE_INFINITY;
  let lastText = '';
  let textChangedAt = startedAt;

  while (Date.now() - startedAt < timeoutMs) {
    if ((await observeChatGptManualIntervention(webContents)).health.manualIntervention) {
      throw new ChatGptProtectionPausedError(chatGptManualVerificationMessage);
    }
    try {
      const rawSnapshot = await evalInPageWithTimeout<ChatGptAssistantTextSnapshot>(
        webContents,
        chatGptAssistantTextSnapshotScript(baseline),
        5000
      );
      const combinedCandidates = rawSnapshot.candidates || [];
      const selectedCandidate = selectBestChatGptAnalysisCandidate(combinedCandidates);
      const selectedText = selectedCandidate?.text || rawSnapshot.text || '';
      const snapshot: ChatGptAssistantTextSnapshot = {
        ...rawSnapshot,
        text: selectedText,
        rootStrategy: selectedCandidate?.source || rawSnapshot.rootStrategy,
        hasUsefulText: selectedText.length >= 40,
        candidates: combinedCandidates
      };
      lastSnapshot = snapshot;
      if (snapshot.text !== lastText) {
        lastText = snapshot.text;
        textChangedAt = Date.now();
      }

      const structured = structuredResponseValidator || !snapshot.text ? null : parseStructuredAnalysisObject(snapshot.text);
      const hasStructuredAnalysis = structuredResponseValidator
        ? Boolean(snapshot.text && structuredResponseValidator(snapshot.text))
        : Boolean(
            structured &&
              [
                structured.sceneDescription,
                structured.poseDescription,
                structured.faceDirectionDescription,
                structured.lightingMakeupDescription
              ].every(isUsefulAnalysisValue)
          );
      const hasUsefulText = Boolean(snapshot.text) && (hasStructuredAnalysis || (!structuredResponseValidator && isMeaningfulUnstructuredAnalysis(snapshot.text)));
      const generationActive = snapshot.stopVisible || snapshot.busyCount > 0;
      const stableForMs = Date.now() - textChangedAt;
      const snapshotQuality =
        (hasStructuredAnalysis ? 100000 : 0) +
        (selectedCandidate?.structuredFieldHits || 0) * 10000 +
        Math.min(snapshot.text.length, 5000);
      if (hasUsefulText && snapshotQuality > bestSnapshotQuality) {
        bestSnapshot = snapshot;
        bestSnapshotQuality = snapshotQuality;
      }

      if (
        shouldAcceptChatGptAnalysis({
          hasUsefulText,
          hasStructuredAnalysis,
          generationActive,
          stableForMs
        })
      ) {
        console.info('[ChatGPT analysis] assistant response accepted', {
          responseLength: snapshot.text.length,
          rootStrategy: snapshot.rootStrategy,
          hasStructuredAnalysis,
          generationActive,
          stableForMs,
          candidateCount: snapshot.candidates.length,
          messageNodeCount: snapshot.messageNodeCount
        });
        return { ...snapshot, done: true };
      }

      if (
        structuredResponseValidator &&
        shouldRejectSettledStructuredResponse({
          hasResponseText: snapshot.text.trim().length >= 40,
          hasStructuredResponse: hasStructuredAnalysis,
          generationActive,
          stableForMs
        })
      ) {
        return {
          ...snapshot,
          done: false,
          errorText: 'ChatGPT 回复已结束，但没有按要求返回完整的结构化结果。'
        };
      }

      if (snapshot.errorText && !hasUsefulText && !bestSnapshot && !generationActive) return snapshot;
    } catch {
      // ChatGPT can replace the reply subtree while streaming; retry until timeout.
    }
    await sleep(1000);
  }

  const fallbackSnapshot = bestSnapshot || lastSnapshot;
  const fallbackUseful = Boolean(
    fallbackSnapshot?.text &&
      (structuredResponseValidator
        ? structuredResponseValidator(fallbackSnapshot.text)
        : parseStructuredAnalysisObject(fallbackSnapshot.text) || isMeaningfulUnstructuredAnalysis(fallbackSnapshot.text))
  );
  if (fallbackSnapshot && shouldUseChatGptAnalysisTimeoutFallback({ hasUsefulText: fallbackUseful })) {
    console.warn('[ChatGPT analysis] accepting useful text after UI completion timeout', {
      responseLength: fallbackSnapshot.text.length,
      rootStrategy: fallbackSnapshot.rootStrategy,
      busyCount: fallbackSnapshot.busyCount,
      stopVisible: fallbackSnapshot.stopVisible,
      candidateCount: fallbackSnapshot.candidates.length,
      keptEarlierBest: Boolean(bestSnapshot && bestSnapshot !== lastSnapshot)
    });
    return { ...fallbackSnapshot, done: true };
  }
  return lastSnapshot;
}

async function analyzeMainImageWithOllama(
  event: IpcMainInvokeEvent,
  payload: { imageDataUrl: string; baseUrl?: string; model?: string },
  instruction: string
): Promise<MainImageAnalysisResult> {
  const baseUrl = normalizeBaseUrl(payload.baseUrl || 'http://127.0.0.1:11434');
  const preferredModel = payload.model?.trim() || 'auto';
  emitMainImageAnalysisStatus(event, {
    step: '正在检查本地分析服务',
    detail: '正在连接 Ollama 并识别已安装的视觉模型。',
    level: 'info'
  });

  let installedModels: OllamaVisionModel[];
  try {
    installedModels = await ensureOllamaVisionModels(baseUrl, () => {
      emitMainImageAnalysisStatus(event, {
        step: '正在后台启动 Ollama',
        detail: '本地服务未响应，软件正在自动启动并等待服务就绪。',
        level: 'warning'
      });
    });
  } catch (error) {
    const detail = explainOllamaFailure(error instanceof Error ? error.message : String(error));
    const errorMessage = `${detail.message} 软件已尝试后台启动服务，但仍未连接成功。`;
    emitMainImageAnalysisStatus(event, { step: '本地分析服务不可用', detail: errorMessage, level: 'error' });
    return { ok: false, error: errorMessage, errorCode: detail.code, serviceReady: false };
  }

  const candidates = selectOllamaVisionModels(installedModels, preferredModel, lastSuccessfulOllamaVisionModel);
  if (!candidates.length) {
    const installedNames = installedModels.map((model) => model.name).filter(Boolean);
    const error = installedNames.length
      ? `Ollama 已启动，但当前已安装模型不具备视觉能力：${installedNames.join('、')}。`
      : 'Ollama 已启动，但没有检测到已安装模型。请先安装一个视觉模型。';
    emitMainImageAnalysisStatus(event, { step: '没有可用的视觉模型', detail: error, level: 'error' });
    return { ok: false, error, errorCode: 'no_vision_model', serviceReady: true, attemptedModels: [] };
  }

  console.info('[Ollama vision] candidates', {
    preferredModel,
    lastSuccessfulOllamaVisionModel,
    candidates: candidates.map((model) => ({ name: model.name, size: model.size, capabilities: model.capabilities }))
  });
  const attemptedModels: string[] = [];
  const failures: Array<{ code: string; message: string }> = [];

  for (const [index, candidate] of candidates.entries()) {
    attemptedModels.push(candidate.name);
    emitMainImageAnalysisStatus(event, {
      step: index === 0 ? '正在分析原图' : '正在切换备用视觉模型',
      detail: `正在使用 ${candidate.name} 读取场景、动作、面部朝向与光影，首次加载可能需要几十秒。`,
      level: index === 0 ? 'info' : 'warning',
      model: candidate.name
    });
    try {
      const response = await fetchJsonWithTimeout(
        `${baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            model: candidate.name,
            messages: [{ role: 'user', content: instruction, images: [dataUrlToBase64(payload.imageDataUrl)] }],
            stream: false,
            format: 'json',
            keep_alive: '10m',
            options: {
              temperature: 0.1,
              num_ctx: 4096,
              num_predict: 900
            }
          })
        },
        180_000,
        `${candidate.name} 原图分析超过 180 秒。`
      );
      if (!response.ok) throw new Error(String(response.json.error || response.text || `HTTP ${response.status}`));
      const content = String(response.json.message?.content || '').trim();
      if (!content) throw new Error('模型返回了空内容。');

      const structuredAnalysis = parseStructuredAnalysisObject(content);
      const degraded = !structuredAnalysis;
      if (degraded && !isMeaningfulUnstructuredAnalysis(content)) throw new Error('模型没有返回可用的图像描述。');
      const analysis = structuredAnalysis || parseAnalysisObject(content);
      lastSuccessfulOllamaVisionModel = candidate.name;
      const fallbackUsed =
        attemptedModels.length > 1 ||
        (preferredModel.toLowerCase() !== 'auto' && !isSameOllamaModel(candidate.name, preferredModel));
      console.info('[Ollama vision] analysis completed', {
        model: candidate.name,
        attemptedModels,
        fallbackUsed,
        degraded,
        responseLength: content.length
      });
      emitMainImageAnalysisStatus(event, {
        step: degraded ? '原图分析已用兼容模式完成' : '原图分析完成',
        detail: degraded
          ? `${candidate.name} 返回了普通描述，软件已补全安全约束；这不会阻断 ChatGPT 做图。`
          : `${candidate.name} 已完成结构化分析，并会短暂保留以加快后续姿势分析。`,
        level: degraded ? 'warning' : 'success',
        model: candidate.name
      });
      return {
        ok: true,
        analysis,
        model: candidate.name,
        attemptedModels,
        fallbackUsed,
        degraded,
        serviceReady: true
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const detail = explainOllamaFailure(rawMessage, candidate.name);
      failures.push(detail);
      console.warn('[Ollama vision] model attempt failed', {
        model: candidate.name,
        code: detail.code,
        rawMessage
      });
      if (index < candidates.length - 1) {
        emitMainImageAnalysisStatus(event, {
          step: `${candidate.name} 不可用，正在自动恢复`,
          detail: detail.message,
          level: 'warning',
          model: candidate.name
        });
      }
    }
  }

  const lastFailure = failures.at(-1) || { code: 'request_failed', message: '本机视觉模型均未能完成分析。' };
  const conciseFailures = failures.slice(0, 3).map((failure) => failure.message).join(' ');
  const error = `本机可用视觉模型均未完成分析。${conciseFailures || lastFailure.message}`;
  emitMainImageAnalysisStatus(event, { step: '原图分析未完成', detail: `${error} 这不会阻断 ChatGPT 做图自动化。`, level: 'error' });
  return {
    ok: false,
    error,
    errorCode: lastFailure.code,
    attemptedModels,
    fallbackUsed: attemptedModels.length > 1,
    serviceReady: true
  };
}

async function writeAnalysisImageTempFile(dataUrl: string) {
  const tempDir = path.join(appDataDir(), 'analysis-temp');
  await ensureDir(tempDir);
  const { mime, buffer } = dataUrlToBuffer(dataUrl);
  const filePath = path.join(tempDir, `main-image-analysis-${Date.now()}.${extFromMime(mime)}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

interface PendingChatGptAnalysis {
  conversationUrl: string;
  createdAt: number;
}

function pendingChatGptAnalysisPath() {
  return path.join(appDataDir(), 'chatgpt-analysis-pending.json');
}

async function readPendingChatGptAnalysis(): Promise<PendingChatGptAnalysis | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(pendingChatGptAnalysisPath(), 'utf8')) as Partial<PendingChatGptAnalysis>;
    if (
      typeof value.conversationUrl !== 'string' ||
      !/^https:\/\/(?:[^/]+\.)?chatgpt\.com\/c\//i.test(value.conversationUrl) ||
      typeof value.createdAt !== 'number' ||
      Date.now() - value.createdAt > 24 * 60 * 60 * 1000
    ) {
      await fs.unlink(pendingChatGptAnalysisPath()).catch(() => undefined);
      return undefined;
    }
    return value as PendingChatGptAnalysis;
  } catch {
    return undefined;
  }
}

async function rememberPendingChatGptAnalysis(conversationUrl: string) {
  if (!/^https:\/\/(?:[^/]+\.)?chatgpt\.com\/c\//i.test(conversationUrl)) return false;
  await ensureDir(path.dirname(pendingChatGptAnalysisPath()));
  await fs.writeFile(
    pendingChatGptAnalysisPath(),
    JSON.stringify({ conversationUrl, createdAt: Date.now() } satisfies PendingChatGptAnalysis),
    'utf8'
  );
  return true;
}

function isCompleteMainImageAnalysis(analysis: MainImageAnalysis | null | undefined): analysis is MainImageAnalysis {
  if (!analysis) return false;
  return [
    analysis.sceneDescription,
    analysis.poseDescription,
    analysis.faceDirectionDescription,
    analysis.lightingMakeupDescription
  ].every(isUsefulAnalysisValue);
}

async function waitForChatGptConversationUrl(webContents: ChatGptWebContentsLike, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = webContents.getURL();
    if (/^https:\/\/(?:[^/]+\.)?chatgpt\.com\/c\//i.test(currentUrl)) return currentUrl;
    await sleep(400);
  }
  return webContents.getURL();
}

async function clearPendingChatGptAnalysis() {
  await fs.unlink(pendingChatGptAnalysisPath()).catch(() => undefined);
}

async function cleanupChatGptAnalysisConversation(event: IpcMainInvokeEvent, win: ChatGptWindowLike | undefined, url: string, silent = false) {
  if (!win || win.isDestroyed()) return false;
  const webContents = win.webContents;
  const freshUrl = freshChatGptConversationUrl(url);
  try {
    if (!silent) {
      emitMainImageAnalysisStatus(event, {
        step: '正在清理 ChatGPT 分析对话',
        detail: '正在切回空白对话并清空输入框，避免影响后续 ChatGPT 做图。',
        level: 'info',
        model: 'ChatGPT'
      });
    }
    await loadChatGptUrlRecoverably(win, freshUrl, 'analysis-cleanup');
    await persistChatGptPageStorage(webContents);
    keepChatGptWindowInBackground(win);
    await waitForChatGptComposer(webContents, 25000);
    await dismissOpenMenus(webContents);
    const cleanState = await evalChatGptMutation<ChatGptComposerResetState>(webContents, resetComposerScript, 6000).catch(() => undefined);
    const cleaned = Boolean(cleanState?.ok);
    console.info('[ChatGPT analysis] cleanup completed', { cleaned, cleanState });
    return cleaned;
  } catch (error) {
    console.warn('[ChatGPT analysis] cleanup failed', error instanceof Error ? error.message : String(error));
    keepChatGptWindowInBackground(win);
    return false;
  }
}

async function recoverPendingChatGptAnalysis(
  event: IpcMainInvokeEvent,
  win: ChatGptWindowLike,
  automationUrl: string
): Promise<{ status: 'none' | 'pending' | 'recovered'; analysis?: MainImageAnalysis }> {
  const pending = await readPendingChatGptAnalysis();
  if (!pending) return { status: 'none' };

  emitMainImageAnalysisStatus(event, {
    step: '正在续读上一轮 ChatGPT 分析',
    detail: '检测到上次已发送但尚未写回的分析对话，正在先读取已生成正文，不会重复上传或发送。',
    level: 'warning',
    model: 'ChatGPT'
  });
  try {
    await loadChatGptUrlRecoverably(win, pending.conversationUrl, 'analysis-pending-recovery');
    const zeroBaseline: ChatGptImageBaseline = {
      capturedAt: 0,
      pageUrl: '',
      promptText: '',
      userMessageCount: 0,
      messageNodeCount: 0,
      sources: [],
      fingerprints: [],
      assistantMessageCount: 0,
      images: []
    };
    const snapshot = await waitForChatGptAnalysisResponse(win.webContents, zeroBaseline, 60_000);
    const recovered = snapshot?.text ? parseStructuredAnalysisObject(snapshot.text) : null;
    if (!snapshot?.done || !recovered) {
      await appendChatGptAutomationDiagnostic('analysis-pending-recovery-incomplete', {
        pageUrl: win.webContents.getURL(),
        snapshot: summarizeChatGptAnalysisSnapshot(snapshot)
      });
      emitMainImageAnalysisStatus(event, {
        step: '上一轮 ChatGPT 分析仍在处理中',
        detail: '已保留原对话和恢复记录，没有重复上传或发送。请稍后再次点击 AI 分析，软件会继续读取同一轮结果。',
        level: 'warning',
        model: 'ChatGPT'
      });
      return { status: 'pending' };
    }

    await clearPendingChatGptAnalysis();
    const cleaned = await cleanupChatGptAnalysisConversation(event, win, automationUrl);
    emitMainImageAnalysisStatus(event, {
      step: 'ChatGPT 延迟分析已恢复',
      detail: cleaned
        ? '已从上一轮对话读取完整正文、写入区域三并清理为空白对话。'
        : '已从上一轮对话读取完整正文并写入区域三；后续做图会在发送前再次重置。',
      level: cleaned ? 'success' : 'warning',
      model: 'ChatGPT'
    });
    return { status: 'recovered', analysis: recovered };
  } catch (error) {
    await appendChatGptAutomationDiagnostic('analysis-pending-recovery-failed', {
      message: error instanceof Error ? error.message : String(error),
      pageUrl: win.webContents.getURL()
    });
    emitMainImageAnalysisStatus(event, {
      step: '上一轮 ChatGPT 分析暂未恢复',
      detail: '恢复记录仍保留 24 小时，本次不会重复上传或发送；请确认网络后稍后重试。',
      level: 'warning',
      model: 'ChatGPT'
    });
    return { status: 'pending' };
  }
}

async function canContinueReadOnlyChatGptAnalysis(event: IpcMainInvokeEvent, win: ChatGptWindowLike | undefined) {
  if (!win || win.isDestroyed()) return false;
  const webContents = win.webContents;
  const currentUrl = webContents.getURL();
  if (!/^https:\/\/(?:[^/]+\.)?chatgpt\.com\/c\//i.test(currentUrl)) return false;
  if ((await observeChatGptManualIntervention(webContents)).health.manualIntervention) return false;
  emitMainImageAnalysisStatus(event, {
    step: '正在等待 ChatGPT 分析结果',
    detail: 'ChatGPT 已接收任务，将继续只读等待本轮回复，不刷新页面，也不会重复发送。',
    level: 'warning',
    model: 'ChatGPT'
  });
  return true;
}

interface PendingGeminiAnalysis {
  conversationUrl: string;
  createdAt: number;
}

function pendingGeminiAnalysisPath() {
  return path.join(appDataDir(), 'gemini-analysis-pending.json');
}

async function readPendingGeminiAnalysis(): Promise<PendingGeminiAnalysis | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(pendingGeminiAnalysisPath(), 'utf8')) as Partial<PendingGeminiAnalysis>;
    if (
      typeof value.conversationUrl !== 'string' ||
      !/^https:\/\/(?:[^/]+\.)?gemini\.google\.com\/app(?:\/|$)/i.test(value.conversationUrl) ||
      typeof value.createdAt !== 'number' ||
      Date.now() - value.createdAt > 24 * 60 * 60 * 1000
    ) {
      await fs.unlink(pendingGeminiAnalysisPath()).catch(() => undefined);
      return undefined;
    }
    return value as PendingGeminiAnalysis;
  } catch {
    return undefined;
  }
}

async function rememberPendingGeminiAnalysis(conversationUrl: string) {
  if (!/^https:\/\/(?:[^/]+\.)?gemini\.google\.com\/app(?:\/|$)/i.test(conversationUrl)) return false;
  await ensureDir(path.dirname(pendingGeminiAnalysisPath()));
  const temporaryPath = `${pendingGeminiAnalysisPath()}.${process.pid}.tmp`;
  try {
    await fs.writeFile(
      temporaryPath,
      JSON.stringify({ conversationUrl, createdAt: Date.now() } satisfies PendingGeminiAnalysis),
      'utf8'
    );
    await fs.rename(temporaryPath, pendingGeminiAnalysisPath());
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
  return true;
}

async function clearPendingGeminiAnalysis() {
  await fs.unlink(pendingGeminiAnalysisPath()).catch(() => undefined);
}

async function cleanupGeminiAnalysisConversation(win: ChatGptWindowLike | undefined, url: string) {
  if (!win || win.isDestroyed()) return false;
  try {
    await loadFreshGeminiConversation(win, freshGeminiConversationUrl(url), 'Gemini 分析对话清理');
    keepChatGptWindowInBackground(win);
    const probe = await waitForGeminiPage(win.webContents, 25_000);
    if (!probe?.composerReady) return false;
    const clean = await resetGeminiComposer(win.webContents);
    return clean.ok;
  } catch {
    keepChatGptWindowInBackground(win);
    return false;
  }
}

async function recoverPendingGeminiAnalysis(
  event: IpcMainInvokeEvent,
  win: ChatGptWindowLike,
  automationUrl: string
): Promise<{ status: 'none' | 'pending' | 'recovered'; analysis?: MainImageAnalysis; reason?: 'region-blocked' }> {
  const pending = await readPendingGeminiAnalysis();
  if (!pending) return { status: 'none' };
  emitMainImageAnalysisStatus(event, {
    step: '正在续读上一轮 Gemini 分析',
    detail: '只读取已经发送的同一轮结果，不重复上传或发送。',
    level: 'warning',
    model: 'Gemini'
  });
  try {
    await loadGeminiUrlRecoverably(win, pending.conversationUrl, 'Gemini 待恢复分析页');
    const probe = await waitForGeminiPage(win.webContents, 30_000);
    if (probe?.regionBlocked) return { status: 'pending', reason: 'region-blocked' };
    if (!probe?.composerReady) return { status: 'pending' };
    const baseline: GeminiAutomationBaseline = {
      userMessageCount: 0,
      responseCount: 0,
      href: pending.conversationUrl,
      imageSources: [],
      capturedAt: 0
    };
    const result = await waitForGeminiTextResult(
      win.webContents,
      baseline,
      60_000,
      (text) => isCompleteMainImageAnalysis(parseStructuredAnalysisObject(text))
    );
    if (result.failure?.code === 'attachment-missing') {
      await appendChatGptAutomationDiagnostic('gemini-analysis-pending-attachment-missing', {
        pageUrl: pending.conversationUrl,
        message: result.text
      });
      await clearPendingGeminiAnalysis();
      await cleanupGeminiAnalysisConversation(win, automationUrl);
      return { status: 'none' };
    }
    const recovered = !result.failure ? parseStructuredAnalysisObject(result.text) : null;
    if (!isCompleteMainImageAnalysis(recovered)) return { status: 'pending' };
    await clearPendingGeminiAnalysis();
    await cleanupGeminiAnalysisConversation(win, automationUrl);
    return { status: 'recovered', analysis: recovered };
  } catch (error) {
    await appendChatGptAutomationDiagnostic('gemini-analysis-pending-recovery-failed', {
      message: error instanceof Error ? error.message : String(error),
      pageUrl: win.webContents.getURL()
    });
    return { status: 'pending' };
  }
}

async function analyzeMainImageWithGemini(
  event: IpcMainInvokeEvent,
  payload: { imageDataUrl: string; model?: string },
  instruction: string
): Promise<MainImageAnalysisResult> {
  if (chatGptAnalysisRunning || chatGptAutomationRunning) {
    const message = chatGptAutomationRunning
      ? '网页做图任务正在运行，请等待当前批次结束后再分析原图。'
      : '已有一个原图 AI 分析任务正在运行。';
    return { ok: false, error: message, errorCode: 'web_ai_busy', model: 'Gemini', serviceReady: true };
  }
  try {
    const acquisition = await acquireChatGptTaskSlot('analysis');
    if (!acquisition.acquired) {
      return { ok: false, error: '另一个网页自动任务已先开始。', errorCode: 'web_ai_busy', model: 'Gemini', serviceReady: true };
    }
  } catch {
    return {
      ok: false,
      error: '后台窗口操作没有在安全时间内结束。本轮分析尚未发送，请点击“恢复窗口”后重试。',
      errorCode: 'web_ai_control_busy',
      model: 'Gemini',
      serviceReady: true
    };
  }

  const automationUrl = freshGeminiConversationUrl(cachedSettings.geminiUrl);
  let tempFilePath = '';
  let win: ChatGptWindowLike | undefined;
  let sent = false;
  try {
    emitMainImageAnalysisStatus(event, {
      step: '正在准备 Gemini 原图分析',
      detail: '使用独立空白对话上传压缩分析图。',
      level: 'info',
      model: 'Gemini'
    });
    win = await getGeminiWindow(automationUrl, 'background');
    keepChatGptWindowInBackground(win);
    const pending = await recoverPendingGeminiAnalysis(event, win, automationUrl);
    if (pending.status === 'recovered' && pending.analysis) {
      return { ok: true, analysis: pending.analysis, model: 'Gemini 网页', serviceReady: true };
    }
    if (pending.status === 'pending') {
      return {
        ok: false,
        error: pending.reason === 'region-blocked'
          ? 'Google 当前提示 Gemini 暂不支持所在地区；上一轮恢复记录已保留，本次没有重复发送。'
          : '上一轮 Gemini 分析仍未返回完整正文，恢复记录已保留，本次没有重复发送。',
        errorCode: 'gemini_analysis_pending',
        model: 'Gemini',
        serviceReady: true
      };
    }

    await loadFreshGeminiConversation(win, automationUrl, 'Gemini 分析新对话');
    let probe = await waitForGeminiPage(win.webContents, 45_000);
    if ((!probe || (!canUseGeminiForAutomation(probe) && !isConfirmedGeminiLogout(probe) && assessGeminiPageHealth(probe).blank))) {
      probe = await recoverGeminiSurfaceInBackground(win, automationUrl, 'analysis-blank');
    }
    if (!canUseGeminiForAutomation(probe)) {
      const message = probe?.regionBlocked
        ? 'Google 当前提示 Gemini 暂不支持所在地区。本轮未上传图片；请恢复可访问 Gemini 的网络环境后重试。'
        : isConfirmedGeminiLogout(probe)
        ? 'Gemini 需要登录或完成 Google 安全验证。请点击“查看窗口”手动处理。'
        : 'Gemini 页面没有稳定显示输入框，请点击“恢复窗口”后重试。';
      return { ok: false, error: message, errorCode: 'gemini_unavailable', model: 'Gemini', serviceReady: false };
    }
    const clean = await resetGeminiComposer(win.webContents);
    if (!clean.ok) throw new Error('无法确认 Gemini 分析对话已清空，本轮未发送。');
    await ensureGeminiModelForSend(event, win, payload.model || cachedSettings.geminiModel);

    tempFilePath = await writeAnalysisImageTempFile(payload.imageDataUrl);
    const analysisInstruction = `${instruction}

你现在看到的是像锚生成的原图分析拼图：左侧是全图构图与场景基准，右侧是红圈人脸特写。请只完成视觉分析，不要生成图片，也不要复述提示词。`;
    let textResult: Awaited<ReturnType<typeof waitForGeminiTextResult>> | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        sent = false;
        await clearPendingGeminiAnalysis();
        emitMainImageAnalysisStatus(event, {
          step: '正在重新上传 Gemini 分析图',
          detail: 'Gemini 明确表示上一轮没有收到附件，正在新对话内自动重试一次。',
          level: 'warning',
          model: 'Gemini'
        });
        await loadFreshGeminiConversation(win, automationUrl, 'Gemini 分析附件恢复');
        const retryProbe = await waitForGeminiPage(win.webContents, 45_000);
        if (!canUseGeminiForAutomation(retryProbe)) throw new Error('Gemini 附件恢复时页面未就绪，本轮已停止。');
        const retryClean = await resetGeminiComposer(win.webContents);
        if (!retryClean.ok) throw new Error('Gemini 附件恢复时无法确认输入区已清空，本轮已停止。');
        await ensureGeminiModelForSend(event, win, payload.model || cachedSettings.geminiModel);
      }

      emitMainImageAnalysisStatus(event, {
        step: '正在上传原图分析图到 Gemini',
        detail: '等待真实预览稳定后才会发送分析指令。',
        level: 'info',
        model: 'Gemini'
      });
      const confirmedUpload = await uploadAndConfirmGeminiAttachments(win.webContents, [tempFilePath], 45_000);
      await appendChatGptAutomationDiagnostic('gemini-analysis-attachment-confirmed', {
        attempt: attempt + 1,
        method: confirmedUpload.receipt.method,
        uploadAttempts: confirmedUpload.attempts,
        readyAttachmentCount: confirmedUpload.confirmation.readyAttachmentCount
      });
      if (!await setGeminiPrompt(win.webContents, analysisInstruction)) {
        throw new Error('Gemini 输入框没有确认写入分析指令，本轮未发送。');
      }
      const composerReady = await waitForGeminiComposerReady(win.webContents, 1, 60_000);
      if (!composerReady.ready) {
        const reason = composerReady.uploadErrorText
          ? `页面提示上传失败：${composerReady.uploadErrorText}`
          : !composerReady.hasPrompt
            ? '分析指令没有保留在输入框。'
            : composerReady.attachmentCount < 1
              ? '原图分析附件在发送前已从输入区消失。'
              : '右侧发送按钮仍不可用或附件仍在上传。';
        throw new Error(`Gemini 分析发送前门禁未通过：${reason}`);
      }
      const baseline = await captureGeminiBaseline(win.webContents);
      const sendAction = await sendGeminiPrompt(win.webContents);
      if (!sendAction.sent) throw new Error('Gemini 没有可用发送按钮，本轮未发送。');
      await appendChatGptAutomationDiagnostic('gemini-analysis-send-attempt', {
        attempt: attempt + 1,
        method: sendAction.method,
        pageUrl: baseline.href
      });
      let acceptance = await waitForGeminiSendAcceptance(win.webContents, baseline, 30_000);
      if (canSafelyRetryGeminiSend(baseline, acceptance.snapshot)) {
        const retry = await sendGeminiPrompt(win.webContents);
        await appendChatGptAutomationDiagnostic('gemini-analysis-send-retry', {
          attempt: attempt + 1,
          method: retry.method,
          composerTextLength: acceptance.snapshot?.composerTextLength || 0
        });
        if (retry.sent) acceptance = await waitForGeminiSendAcceptance(win.webContents, baseline, 30_000);
      }
      if (!acceptance.accepted) {
        throw new Error('Gemini 没有确认接收分析消息。为避免重复发送，本轮已停止。');
      }
      sent = true;
      await sleep(800);
      const acceptedPage = await captureGeminiBaseline(win.webContents).catch(() => undefined);
      const conversationUrl = acceptedPage?.href || acceptance.snapshot?.href || baseline.href;
      await rememberPendingGeminiAnalysis(conversationUrl);
      emitMainImageAnalysisStatus(event, {
        step: '正在等待 Gemini 分析原图',
        detail: '只读取本轮新回复，旧对话、空页脚和用户回显不会作为结果。',
        level: 'info',
        model: 'Gemini'
      });
      textResult = await waitForGeminiTextResult(
        win.webContents,
        baseline,
        chatGptAnalysisInitialWaitMs,
        (text) => isCompleteMainImageAnalysis(parseStructuredAnalysisObject(text))
      );
      if (textResult.failure?.code === 'attachment-missing' && attempt === 0) {
        await appendChatGptAutomationDiagnostic('gemini-analysis-attachment-retry', {
          pageUrl: conversationUrl,
          message: textResult.text
        });
        continue;
      }
      break;
    }
    if (!textResult) throw new Error('Gemini 分析没有返回可读取结果。');
    if (textResult.failure) {
      throw new Error(`Gemini 分析失败：${textResult.text}`);
    }
    const analysis = parseStructuredAnalysisObject(textResult.text);
    if (!isCompleteMainImageAnalysis(analysis)) {
      throw new Error('Gemini 已返回正文，但没有检测到完整有效的原图分析 JSON；恢复记录已保留。');
    }
    await clearPendingGeminiAnalysis();
    const cleaned = await cleanupGeminiAnalysisConversation(win, automationUrl);
    emitMainImageAnalysisStatus(event, {
      step: 'Gemini 原图分析完成',
      detail: cleaned ? '分析已写回，并已切回空白对话。' : '分析已写回；下次发送前会再次清理输入区。',
      level: cleaned ? 'success' : 'warning',
      model: 'Gemini'
    });
    return { ok: true, analysis, model: 'Gemini 网页', serviceReady: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (sent && win && !win.isDestroyed()) {
      const failedPage = await captureGeminiBaseline(win.webContents).catch(() => undefined);
      await rememberPendingGeminiAnalysis(failedPage?.href || win.webContents.getURL()).catch(() => false);
    }
    const dom = win && !win.isDestroyed()
      ? await captureGeminiDomDiagnostics(win.webContents).catch((diagnosticError) => ({
          unavailable: true,
          reason: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
        }))
      : { unavailable: true, reason: 'window-unavailable' };
    await appendChatGptAutomationDiagnostic('gemini-analysis-failed', {
      sent,
      message,
      pageUrl: win?.webContents.getURL() || '',
      dom
    });
    if (!sent) await clearPendingGeminiAnalysis();
    emitMainImageAnalysisStatus(event, {
      step: 'Gemini 原图分析未完成',
      detail: message,
      level: 'error',
      model: 'Gemini'
    });
    return { ok: false, error: message, errorCode: 'gemini_analysis_failed', model: 'Gemini', serviceReady: true };
  } finally {
    chatGptAnalysisRunning = false;
    if (tempFilePath) await fs.unlink(tempFilePath).catch(() => undefined);
    if (win && !win.isDestroyed()) keepChatGptWindowInBackground(win);
  }
}

async function analyzeWebPosesWithOllama(
  event: IpcMainInvokeEvent,
  payload: { imageDataUrl: string; baseUrl?: string; model?: string }
): Promise<WebPoseAnalysisResult> {
  const baseUrl = normalizeBaseUrl(payload.baseUrl || 'http://127.0.0.1:11434');
  const preferredModel = payload.model?.trim() || 'auto';
  const instruction = `你是人像摄影姿势策划师。只根据附件中实际可见的画幅、人物身体范围、服装、环境和拍摄角度，提出 8 个适合当前照片的自然网感姿势。不要猜测身份，不要生成图片，不要照抄原图姿势，不要新增道具，也不要要求补出画幅外肢体。第 1-3 条变化轻微，第 4-6 条变化适中，第 7-8 条变化明显但仍适合当前画幅。每条 description 写清身体朝向、肩颈、手臂和手部、重心、头部角度、视线与遮挡关系。只返回一个 JSON 对象，不要 Markdown、代码块或解释；固定键名为 poses、id、title、description，其他内容全部使用中文；poses 恰好 8 条，id 依次为 1 到 8：{"poses":[{"id":1,"title":"姿势短标题","description":"完整姿势描述"},{"id":2,"title":"姿势短标题","description":"完整姿势描述"},{"id":3,"title":"姿势短标题","description":"完整姿势描述"},{"id":4,"title":"姿势短标题","description":"完整姿势描述"},{"id":5,"title":"姿势短标题","description":"完整姿势描述"},{"id":6,"title":"姿势短标题","description":"完整姿势描述"},{"id":7,"title":"姿势短标题","description":"完整姿势描述"},{"id":8,"title":"姿势短标题","description":"完整姿势描述"}]}`;

  emitWebPoseAnalysisStatus(event, {
    step: '正在检查本地模型',
    detail: '连接本机分析服务并确认视觉模型。',
    level: 'info'
  });
  let installedModels: OllamaVisionModel[];
  try {
    installedModels = await ensureOllamaVisionModels(baseUrl);
  } catch (error) {
    const detail = explainOllamaFailure(error instanceof Error ? error.message : String(error));
    emitWebPoseAnalysisStatus(event, { step: '本地模型不可用', detail: detail.message, level: 'error' });
    return { ok: false, error: detail.message, errorCode: detail.code };
  }

  const candidates = selectOllamaVisionModels(installedModels, preferredModel, lastSuccessfulOllamaVisionModel);
  if (!candidates.length) {
    const error = '本地服务已启动，但没有可用的视觉模型。请先在制作通道中完成本地模型安装。';
    emitWebPoseAnalysisStatus(event, { step: '需要安装本地模型', detail: error, level: 'error' });
    return { ok: false, error, errorCode: 'no_vision_model' };
  }

  let firstFailure = '';
  for (const [index, candidate] of candidates.entries()) {
    emitWebPoseAnalysisStatus(event, {
      step: index === 0 ? '正在生成 8 个网感姿势' : '正在切换本地备用模型',
      detail: `使用 ${candidate.name} 分析当前原图。`,
      level: index === 0 ? 'info' : 'warning'
    });
    try {
      const response = await fetchJsonWithTimeout(
        `${baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            model: candidate.name,
            messages: [{ role: 'user', content: instruction, images: [dataUrlToBase64(payload.imageDataUrl)] }],
            stream: false,
            format: 'json',
            keep_alive: '10m',
            options: { temperature: 0.2, num_ctx: 4096, num_predict: 900 }
          })
        },
        180_000,
        `${candidate.name} 网感姿势分析超过 180 秒。`
      );
      if (!response.ok) throw new Error(String(response.json.error || response.text || `HTTP ${response.status}`));
      const text = String(response.json.message?.content || '').trim();
      const suggestions = parseWebPoseSuggestions(text);
      if (!suggestions) throw new Error('模型没有返回完整的 8 条姿势。');
      lastSuccessfulOllamaVisionModel = candidate.name;
      emitWebPoseAnalysisStatus(event, {
        step: '网感姿势分析完成',
        detail: `${candidate.name} 已返回 8 个新姿势。`,
        level: 'success'
      });
      return { ok: true, suggestions };
    } catch (error) {
      const detail = explainOllamaFailure(error instanceof Error ? error.message : String(error), candidate.name);
      if (!firstFailure) firstFailure = detail.message;
    }
  }

  const error = firstFailure || '本地模型没有返回完整的 8 条姿势。';
  emitWebPoseAnalysisStatus(event, { step: '网感姿势分析未完成', detail: error, level: 'error' });
  return { ok: false, error, errorCode: 'ollama_pose_failed' };
}

async function analyzeWebPosesWithGemini(
  event: IpcMainInvokeEvent,
  payload: { imageDataUrl: string }
): Promise<WebPoseAnalysisResult> {
  if (chatGptAnalysisRunning || chatGptAutomationRunning) {
    return { ok: false, error: '已有网页自动任务正在运行，请等待完成后再分析网感姿势。', errorCode: 'web_ai_busy' };
  }
  try {
    const acquisition = await acquireChatGptTaskSlot('analysis');
    if (!acquisition.acquired) return { ok: false, error: '另一个网页自动任务已先开始。', errorCode: 'web_ai_busy' };
  } catch {
    return { ok: false, error: '后台窗口操作没有在安全时间内结束，本轮姿势分析尚未发送。', errorCode: 'web_ai_control_busy' };
  }

  const instruction = `你是人像摄影姿势策划师。只根据附件中实际可见的画幅、人物身体范围、服装、环境和拍摄角度，提出 8 个适合当前照片的自然网感姿势。不要猜测身份，不要生成图片，不要照抄原图姿势，不要新增道具，也不要要求补出画幅外肢体。第 1-3 条变化轻微，第 4-6 条变化适中，第 7-8 条变化明显但仍适合当前画幅。每条 description 写清身体朝向、肩颈、手臂和手部、重心、头部角度、视线与遮挡关系。只返回一个 JSON 对象，不要 Markdown、代码块或解释；固定键名为 poses、id、title、description，其他内容全部使用中文；poses 恰好 8 条，id 依次为 1 到 8：{"poses":[{"id":1,"title":"姿势短标题","description":"完整姿势描述"},{"id":2,"title":"姿势短标题","description":"完整姿势描述"},{"id":3,"title":"姿势短标题","description":"完整姿势描述"},{"id":4,"title":"姿势短标题","description":"完整姿势描述"},{"id":5,"title":"姿势短标题","description":"完整姿势描述"},{"id":6,"title":"姿势短标题","description":"完整姿势描述"},{"id":7,"title":"姿势短标题","description":"完整姿势描述"},{"id":8,"title":"姿势短标题","description":"完整姿势描述"}]}`;
  let tempFilePath = '';
  let win: ChatGptWindowLike | undefined;
  try {
    const automationUrl = freshGeminiConversationUrl(cachedSettings.geminiUrl);
    emitWebPoseAnalysisStatus(event, { step: '正在准备 Gemini 网感姿势分析', detail: '使用独立空白对话处理本轮原图。', level: 'info' });
    win = await getGeminiWindow(automationUrl, 'background');
    keepChatGptWindowInBackground(win);
    await loadFreshGeminiConversation(win, automationUrl, 'Gemini 姿势分析新对话');
    const probe = await waitForGeminiPage(win.webContents, 45_000);
    if (!canUseGeminiForAutomation(probe)) {
      throw new Error(probe?.regionBlocked
        ? 'Google 当前提示 Gemini 暂不支持所在地区。'
        : 'Gemini 页面没有稳定显示输入框，请点击“查看窗口”处理登录或页面状态。');
    }
    const clean = await resetGeminiComposer(win.webContents);
    if (!clean.ok) throw new Error('无法确认 Gemini 姿势分析输入区已清空，本轮未发送。');
    await ensureGeminiModelForSend(event, win, cachedSettings.geminiModel);

    tempFilePath = await writeAnalysisImageTempFile(payload.imageDataUrl);
    emitWebPoseAnalysisStatus(event, { step: '正在上传姿势分析图到 Gemini', detail: '检测到真实附件预览后才会发送。', level: 'info' });
    await uploadAndConfirmGeminiAttachments(win.webContents, [tempFilePath], 45_000);
    if (!await setGeminiPrompt(win.webContents, instruction)) throw new Error('Gemini 输入框没有确认写入姿势分析指令。');
    const ready = await waitForGeminiComposerReady(win.webContents, 1, 60_000);
    if (!ready.ready) throw new Error(ready.uploadErrorText || 'Gemini 附件仍未就绪或发送按钮不可用。');

    const baseline = await captureGeminiBaseline(win.webContents);
    const sendAction = await sendGeminiPrompt(win.webContents);
    if (!sendAction.sent) throw new Error('Gemini 没有可用发送按钮，本轮未发送。');
    const acceptance = await waitForGeminiSendAcceptance(win.webContents, baseline, 30_000);
    if (!acceptance.accepted) throw new Error('Gemini 没有确认接收姿势分析消息。为避免重复发送，本轮已停止。');

    emitWebPoseAnalysisStatus(event, { step: '正在生成 8 个网感姿势', detail: '只读取本轮新增回复。', level: 'info' });
    const result = await waitForGeminiTextResult(
      win.webContents,
      baseline,
      chatGptAnalysisInitialWaitMs,
      (text) => Boolean(parseWebPoseSuggestions(text))
    );
    if (result.failure) throw new Error(`Gemini 姿势分析失败：${result.text}`);
    const suggestions = parseWebPoseSuggestions(result.text);
    if (!suggestions) throw new Error('Gemini 没有返回完整的 8 条网感姿势。');
    emitWebPoseAnalysisStatus(event, { step: '网感姿势分析完成', detail: '8 个新姿势已准备好。', level: 'success' });
    return { ok: true, suggestions };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini 网感姿势分析失败。';
    await appendChatGptAutomationDiagnostic('gemini-web-pose-analysis-failed', {
      message,
      pageUrl: win && !win.isDestroyed() ? win.webContents.getURL() : ''
    });
    emitWebPoseAnalysisStatus(event, { step: 'Gemini 网感姿势分析未完成', detail: `${message} 已保留原有姿势选项。`, level: 'error' });
    return { ok: false, error: message, errorCode: 'gemini_web_pose_failed' };
  } finally {
    chatGptAnalysisRunning = false;
    if (tempFilePath) await fs.unlink(tempFilePath).catch(() => undefined);
    if (win && !win.isDestroyed()) keepChatGptWindowInBackground(win);
  }
}

async function analyzeMainImageWithChatGpt(
  event: IpcMainInvokeEvent,
  payload: { imageDataUrl: string },
  instruction: string
): Promise<MainImageAnalysisResult> {
  if (chatGptAnalysisRunning || chatGptAutomationRunning) {
    const message = chatGptAutomationRunning
      ? 'ChatGPT 正在执行做图任务，请等待当前生成结束后再分析原图。'
      : '已有一个原图 AI 分析任务正在运行，请等待当前分析完成。';
    return { ok: false, error: message, errorCode: 'chatgpt_busy', model: 'ChatGPT', serviceReady: true };
  }
  try {
    const acquisition = await acquireChatGptTaskSlot('analysis');
    if (!acquisition.acquired) {
      const message = acquisition.blocker === 'generation'
        ? '做图任务已先开始，请等待当前生成结束后再分析原图。'
        : '另一个原图 AI 分析任务已先开始。';
      return { ok: false, error: message, errorCode: 'chatgpt_busy', model: 'ChatGPT', serviceReady: true };
    }
  } catch {
    return {
      ok: false,
      error: '后台登录或模型检查没有在安全时间内结束。本轮分析尚未发送，请点击“恢复窗口”后重试。',
      errorCode: 'chatgpt_control_busy',
      model: 'ChatGPT',
      serviceReady: true
    };
  }
  const automationUrl = freshChatGptConversationUrl(cachedSettings.chatGptUrl || 'https://chatgpt.com/');
  let tempFilePath = '';
  let analysisWindow: ChatGptWindowLike | undefined;
  let responseSnapshotForDiagnostics: ChatGptAssistantTextSnapshot | undefined;
  let analysisPromptSent = false;
  try {
    await assertChatGptAutomationStartAllowed();
    emitMainImageAnalysisStatus(event, {
      step: '正在准备 ChatGPT 原图分析',
      detail: '将使用已登录的内置 ChatGPT 窗口，新建空白对话并上传压缩后的分析图。',
      level: 'info',
      model: 'ChatGPT'
    });

    const backend = resolveChatGptBrowserBackend(cachedSettings.chatGptBrowserBackend);
    const win = await getChatGptWindow(automationUrl, backend, 'background');
    analysisWindow = win;
    keepChatGptWindowInBackground(win);
    const webContents = win.webContents;

    const pendingRecovery = await recoverPendingChatGptAnalysis(event, win, automationUrl);
    if (pendingRecovery.status === 'recovered' && pendingRecovery.analysis) {
      return { ok: true, analysis: pendingRecovery.analysis, model: 'ChatGPT 内置窗口', serviceReady: true };
    }
    if (pendingRecovery.status === 'pending') {
      return {
        ok: false,
        error: '上一轮 ChatGPT 分析尚未返回完整文本，恢复记录已保留，本次没有重复发送。',
        errorCode: 'chatgpt_analysis_pending',
        model: 'ChatGPT',
        serviceReady: true
      };
    }
    tempFilePath = await writeAnalysisImageTempFile(payload.imageDataUrl);

    emitMainImageAnalysisStatus(event, { step: '正在等待 ChatGPT 输入框', detail: '如果登录失效或遇到验证码，会提示你查看窗口。', level: 'info', model: 'ChatGPT' });
    let composerState = await waitForChatGptComposer(webContents, 45000);
    if (!isAutomationComposerReady(composerState)) {
      composerState = await recoverChatGptComposerInBackground(event, win, automationUrl);
    }
    if (!isAutomationComposerReady(composerState)) {
      const message = isConfirmedChatGptLogout(composerState)
        ? 'ChatGPT 内置窗口需要重新登录或验证码确认。请点击“查看窗口”处理后再重试原图分析。'
        : 'ChatGPT 内置窗口暂时没有找到输入框。请点击“查看窗口”确认页面状态后重试。';
      emitMainImageAnalysisStatus(event, { step: 'ChatGPT 分析不可继续', detail: message, level: 'error', model: 'ChatGPT' });
      return { ok: false, error: message, errorCode: 'chatgpt_unavailable', serviceReady: false, model: 'ChatGPT' };
    }

    const cleanComposerState = await resetChatGptComposer(event, win, automationUrl, 'analysis');
    if (!cleanComposerState?.ok) {
      throw new Error('无法确认 ChatGPT 新对话的输入框已经清空。为避免串入旧附件或旧回复，本次原图分析已停止。');
    }

    await dismissOpenMenus(webContents);
    await evalChatGptMutation<{ inputCount: number; clicked: boolean }>(webContents, revealFileInputScript, 4500).catch(() => ({ inputCount: 0, clicked: false }));
    await sleep(600);

    const files = [tempFilePath];
    const expectedFileNames = files.map((file) => path.basename(file));
    const uploadBaseline = await evalInPageWithTimeout<UploadEvidence>(
      webContents,
      uploadAttachmentSnapshotScript(expectedFileNames),
      6000
    ).catch(() => ({
      evidenceCount: 0,
      nameHits: 0,
      previewCount: 0,
      removeButtonCount: 0,
      fileInputCount: 0,
      busyCount: 0
    }));
    emitMainImageAnalysisStatus(event, { step: '正在上传原图分析图到 ChatGPT', detail: '只上传压缩后的分析拼图，用于识别场景、姿态和光影。', level: 'info', model: 'ChatGPT' });
    const uploadMethod = await uploadFilesToChatGptComposer(webContents, files);
    console.info('[ChatGPT analysis] upload method selected', uploadMethod);
    type UploadConfirmation = UploadEvidence & { uploadErrorText?: string };
    let uploadConfirm = await waitForStableChatGptAttachments(webContents, expectedFileNames, uploadBaseline, 30_000);
    if (uploadConfirm?.uploadErrorText) throw new Error(`ChatGPT 页面提示图片上传失败：${uploadConfirm.uploadErrorText}。`);
    if ((!uploadConfirm || !hasNewUploadEvidence(uploadBaseline, uploadConfirm)) && uploadMethod.method === 'file-input') {
      await dismissOpenMenus(webContents);
      await withTimeout(dispatchChatGptFileDrop(webContents, files), 15000, 'ChatGPT 拖放上传超过 15 秒没有返回。');
      uploadConfirm = await waitForStableChatGptAttachments(webContents, expectedFileNames, uploadBaseline, 35_000);
    }
    if (!uploadConfirm || !hasNewUploadEvidence(uploadBaseline, uploadConfirm)) {
      throw new Error('图片没有完整上传到 ChatGPT，未检测到附件预览或文件名。');
    }

    const chatGptInstruction = `${instruction}

你现在看到的是像锚生成的原图分析拼图：左侧是全图构图与场景基准，右侧是红圈人脸特写。请优先使用你自己的视觉理解能力，写具体可见细节，不要复述提示词，也不要生成图片。`;
    emitMainImageAnalysisStatus(event, { step: '正在发送分析指令给 ChatGPT', detail: '等待 ChatGPT 返回结构化 JSON。', level: 'info', model: 'ChatGPT' });
    await dismissOpenMenus(webContents);
    const promptSet = await evalChatGptMutation<boolean>(webContents, setPromptScript(chatGptInstruction), 6000);
    if (!promptSet) throw new Error('没有成功写入 ChatGPT 输入框。');

    const uploadState = await waitForStableChatGptComposerReady(webContents, expectedFileNames.length, 60_000);
    if (!uploadState?.ready) {
      if (uploadState?.uploadErrorText) throw new Error(`ChatGPT 页面提示附件上传失败：${uploadState.uploadErrorText}。`);
      throw new Error('ChatGPT 附件上传仍未完成或发送按钮不可用。');
    }

    await dismissOpenMenus(webContents);
    const preSendState = await waitForStableChatGptComposerReady(webContents, expectedFileNames.length, 15_000);
    const preSendAttachments = await waitForStableChatGptAttachments(
      webContents,
      expectedFileNames,
      uploadBaseline,
      10_000
    );
    await appendChatGptAutomationDiagnostic('analysis-pre-send-gate', {
      uploadMethod: uploadMethod.method,
      uploadState: preSendState,
      uploadEvidence: preSendAttachments,
      expectedAttachments: expectedFileNames.length
    });
    if (!preSendState?.ready || !hasNewUploadEvidence(uploadBaseline, preSendAttachments)) {
      throw new Error('发送前复核发现原图分析附件已经从 ChatGPT 输入区消失，或发送按钮仍不可用。本轮没有发送空附件消息，请重试。');
    }

    const textBaseline = await evalInPageWithTimeout<ChatGptImageBaseline>(webContents, collectImageBaselineScript, 6000);
    let sent = await triggerPacedChatGptSend(event, webContents);
    if (!sent) {
      const fallback = await evalChatGptMutation<{ sent: boolean; method: string; label: string }>(
        webContents,
        fallbackClickSendScript,
        6000
      ).catch(() => ({ sent: false, method: 'script-error', label: '' }));
      sent = fallback.sent;
    }
    if (!sent) throw new Error('没有找到可用的发送按钮，已停在 ChatGPT 页面等待手动处理。');
    analysisPromptSent = true;
    keepChatGptWindowInBackground(win);

    const acceptance = await waitForChatGptSendAcceptanceWithNoOpRetry(webContents, textBaseline, 'analysis');
    if (acceptance?.terminalFailure) throw new Error(acceptance.terminalFailure);
    if (!acceptance?.accepted) {
      const confirmedNoOp = shouldRetryChatGptNoOpSend(textBaseline, acceptance);
      if (confirmedNoOp) analysisPromptSent = false;
      else rememberUncertainChatGptSubmission('原图分析发送已点击，但 ChatGPT 没有确认建立新消息。');
      throw new Error(
        confirmedNoOp
          ? 'ChatGPT 发送按钮连续两次没有响应，分析消息未发出，输入和附件已安全清理。请稍后重试。'
          : `分析发送未被 ChatGPT 确认接收（输入框字符=${acceptance?.composerTextLength ?? 'unknown'}，新用户消息=${Math.max(0, (acceptance?.userMessageCount ?? textBaseline.userMessageCount) - textBaseline.userMessageCount)}，生成中=${Boolean(acceptance?.stopVisible || (acceptance?.busyCount ?? 0) > 0)}）。为避免重复发送，本轮已停止。`
      );
    }
    const acceptedConversationUrl = await waitForChatGptConversationUrl(webContents);
    await rememberPendingChatGptAnalysis(acceptedConversationUrl || acceptance.href);
    emitMainImageAnalysisStatus(event, { step: '正在等待 ChatGPT 分析原图', detail: '这一步通常比 Ollama 慢一点，但场景细节会更稳定。', level: 'info', model: 'ChatGPT' });
    let responseSnapshot = await waitForChatGptAnalysisResponse(webContents, textBaseline, chatGptAnalysisInitialWaitMs);
    if (!responseSnapshot?.done || !responseSnapshot.text) {
      await appendChatGptAutomationDiagnostic('analysis-primary-wait-incomplete', {
        pageUrl: webContents.getURL(),
        snapshot: summarizeChatGptAnalysisSnapshot(responseSnapshot)
      });
      const canContinueReading = await canContinueReadOnlyChatGptAnalysis(event, win);
      if (canContinueReading) {
        const recoveredSnapshot = await waitForChatGptAnalysisResponse(webContents, textBaseline, chatGptAnalysisRecoveryWaitMs);
        if (
          recoveredSnapshot?.done ||
          (recoveredSnapshot?.text.length || 0) > (responseSnapshot?.text.length || 0)
        ) {
          responseSnapshot = recoveredSnapshot;
        }
      }
    }
    responseSnapshotForDiagnostics = responseSnapshot;
    if (!responseSnapshot?.done || !responseSnapshot.text) {
      await appendChatGptAutomationDiagnostic('analysis-no-usable-text', {
        pageUrl: webContents.getURL(),
        snapshot: summarizeChatGptAnalysisSnapshot(responseSnapshot)
      });
      throw new Error(responseSnapshot?.errorText || 'ChatGPT 没有返回可用的原图分析文本。');
    }

    const analysis = parseAnalysisObject(responseSnapshot.text);
    await appendChatGptAutomationDiagnostic('analysis-succeeded', {
      pageUrl: webContents.getURL(),
      responseLength: responseSnapshot.text.length,
      rootStrategy: responseSnapshot.rootStrategy,
      fieldLengths: {
        sceneDescription: analysis.sceneDescription.length,
        poseDescription: analysis.poseDescription.length,
        faceDirectionDescription: analysis.faceDirectionDescription.length,
        lightingMakeupDescription: analysis.lightingMakeupDescription.length
      }
    });
    await clearPendingChatGptAnalysis();
    const cleaned = await cleanupChatGptAnalysisConversation(event, analysisWindow, automationUrl);
    emitMainImageAnalysisStatus(event, {
      step: 'ChatGPT 原图分析完成',
      detail: cleaned
        ? '已抓取最新助手回复、写入区域三，并清理为空白 ChatGPT 对话。'
        : '已抓取最新助手回复并写入区域三；清理空白对话未确认成功，后续做图会在发送前再次重置。',
      level: cleaned ? 'success' : 'warning',
      model: 'ChatGPT'
    });
    return { ok: true, analysis, model: 'ChatGPT 内置窗口', serviceReady: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ChatGPT 原图分析失败。';
    const protectionPaused = chatGptManualVerificationRequired || error instanceof ChatGptProtectionPausedError || isChatGptConversationAccessLimitedMessage(message);
    if (protectionPaused) rememberChatGptConversationAccessLimit(message);
    await appendChatGptAutomationDiagnostic('analysis-failed', {
      message,
      pageUrl: analysisWindow && !analysisWindow.isDestroyed() ? analysisWindow.webContents.getURL() : '',
      snapshot: summarizeChatGptAnalysisSnapshot(responseSnapshotForDiagnostics)
    });
    if (analysisPromptSent && analysisWindow && !analysisWindow.isDestroyed()) {
      await rememberPendingChatGptAnalysis(analysisWindow.webContents.getURL());
      await persistChatGptPageStorage(analysisWindow.webContents).catch(() => undefined);
      keepChatGptWindowInBackground(analysisWindow);
      await appendChatGptAutomationDiagnostic('analysis-conversation-preserved-for-recovery', {
        pageUrl: analysisWindow.webContents.getURL()
      });
    } else if (!protectionPaused) {
      await cleanupChatGptAnalysisConversation(event, analysisWindow, automationUrl, true);
    }
    emitMainImageAnalysisStatus(event, {
      step: protectionPaused ? 'ChatGPT 访问保护，任务已安全暂停' : 'ChatGPT 原图分析未完成',
      detail: protectionPaused ? `${message} 软件不会继续点击或重复发送。` : `${message} 可临时切回 Ollama 或稍后重试。`,
      level: protectionPaused ? 'warning' : 'error',
      model: 'ChatGPT'
    });
    return {
      ok: false,
      error: message,
      errorCode: protectionPaused ? 'chatgpt_protection_paused' : 'chatgpt_failed',
      model: 'ChatGPT',
      serviceReady: protectionPaused
    };
  } finally {
    chatGptAnalysisRunning = false;
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => undefined);
    }
  }
}

async function analyzeWebPosesWithChatGpt(
  event: IpcMainInvokeEvent,
  payload: { imageDataUrl: string }
): Promise<WebPoseAnalysisResult> {
  if (chatGptAnalysisRunning || chatGptAutomationRunning) {
    return {
      ok: false,
      error: chatGptAutomationRunning
        ? 'ChatGPT 正在执行做图任务，请等待当前生成结束后再分析网感姿势。'
        : '已有一个 AI 分析任务正在运行，请等待完成后再试。',
      errorCode: 'chatgpt_busy'
    };
  }
  try {
    const acquisition = await acquireChatGptTaskSlot('analysis');
    if (!acquisition.acquired) {
      return { ok: false, error: '另一个 ChatGPT 自动任务已先开始。', errorCode: 'chatgpt_busy' };
    }
  } catch {
    return {
      ok: false,
      error: '后台窗口操作没有在安全时间内结束。本轮姿势分析尚未发送，请稍后重试。',
      errorCode: 'chatgpt_control_busy'
    };
  }

  const instruction = `你是人像摄影姿势策划师。请只根据附件中实际可见的原图画幅、人物身体可见范围、服装、环境和拍摄角度，提出 8 个适合这张照片的自然网感姿势。
不要猜测人物身份，不要生成图片，不要照抄原图姿势，不要新增原图不存在的道具，也不要提出需要强行补出画幅外肢体的动作。
第 1-3 个姿势变化轻微，第 4-6 个变化适中，第 7-8 个变化更明显但仍必须适合当前画幅与环境。
每条 description 必须具体写清身体朝向、肩颈、手臂与手部、重心、头部角度、视线和必要遮挡关系，方便图像模型直接执行。
必须直接在当前聊天正文中一次性返回结果，不要创建文稿、Canvas、画布、Artifact、侧边文档或代码编辑器，也不要先回复过渡文字。
只返回一个 JSON 对象，不要 Markdown，不要代码块，不要解释。除固定 JSON 键名 poses、id、title、description 外，所有内容必须使用中文。poses 必须恰好 8 条，id 必须依次为 1 到 8，title 和 description 都必须是非空中文字符串：
{"poses":[{"id":1,"title":"姿势短标题","description":"可直接执行的完整姿势描述"},{"id":2,"title":"姿势短标题","description":"可直接执行的完整姿势描述"},{"id":3,"title":"姿势短标题","description":"可直接执行的完整姿势描述"},{"id":4,"title":"姿势短标题","description":"可直接执行的完整姿势描述"},{"id":5,"title":"姿势短标题","description":"可直接执行的完整姿势描述"},{"id":6,"title":"姿势短标题","description":"可直接执行的完整姿势描述"},{"id":7,"title":"姿势短标题","description":"可直接执行的完整姿势描述"},{"id":8,"title":"姿势短标题","description":"可直接执行的完整姿势描述"}]}`;
  const automationUrl = freshChatGptConversationUrl(cachedSettings.chatGptUrl || 'https://chatgpt.com/');
  let tempFilePath = '';
  let win: ChatGptWindowLike | undefined;
  let responseSnapshotForDiagnostics: ChatGptAssistantTextSnapshot | undefined;
  let posePromptSent = false;
  try {
    await assertChatGptAutomationStartAllowed();
    emitWebPoseAnalysisStatus(event, {
      step: '正在准备网感姿势分析',
      detail: 'ChatGPT 将在后台新建空白对话，只分析原图画幅、环境与人物可动范围。',
      level: 'info'
    });
    const backend = resolveChatGptBrowserBackend(cachedSettings.chatGptBrowserBackend);
    win = await getChatGptWindow(automationUrl, backend, 'background');
    keepChatGptWindowInBackground(win);
    const webContents = win.webContents;

    tempFilePath = await writeAnalysisImageTempFile(payload.imageDataUrl);
    let composerState = await waitForChatGptComposer(webContents, 45_000);
    if (!isAutomationComposerReady(composerState)) {
      composerState = await recoverChatGptComposerInBackground(event, win, automationUrl);
    }
    if (!isAutomationComposerReady(composerState)) {
      throw new Error(
        isConfirmedChatGptLogout(composerState)
          ? 'ChatGPT 需要重新登录或完成验证码，请先在专属窗口处理。'
          : 'ChatGPT 暂时没有稳定显示输入框，请查看专属窗口后重试。'
      );
    }

    const cleanComposerState = await resetChatGptComposer(event, win, automationUrl, 'web-pose');
    if (!cleanComposerState?.ok) throw new Error('无法确认 ChatGPT 新对话已经清空，本轮姿势分析未发送。');
    await dismissOpenMenus(webContents);
    await evalChatGptMutation<{ inputCount: number; clicked: boolean }>(webContents, revealFileInputScript, 4500).catch(() => ({ inputCount: 0, clicked: false }));
    await sleep(600);

    const files = [tempFilePath];
    const expectedFileNames = files.map((file) => path.basename(file));
    const uploadBaseline = await evalInPageWithTimeout<UploadEvidence>(
      webContents,
      uploadAttachmentSnapshotScript(expectedFileNames),
      6000
    ).catch(() => ({ evidenceCount: 0, nameHits: 0, previewCount: 0, removeButtonCount: 0, fileInputCount: 0, busyCount: 0 }));
    emitWebPoseAnalysisStatus(event, {
      step: '正在上传网感姿势分析图',
      detail: '确认原图预览稳定后才会发送分析指令。',
      level: 'info'
    });
    const uploadMethod = await uploadFilesToChatGptComposer(webContents, files);
    let uploadConfirm = await waitForStableChatGptAttachments(webContents, expectedFileNames, uploadBaseline, 30_000);
    if (uploadConfirm?.uploadErrorText) throw new Error(`ChatGPT 页面提示图片上传失败：${uploadConfirm.uploadErrorText}。`);
    if ((!uploadConfirm || !hasNewUploadEvidence(uploadBaseline, uploadConfirm)) && uploadMethod.method === 'file-input') {
      await dismissOpenMenus(webContents);
      await withTimeout(dispatchChatGptFileDrop(webContents, files), 15_000, 'ChatGPT 拖放上传超过 15 秒没有返回。');
      uploadConfirm = await waitForStableChatGptAttachments(webContents, expectedFileNames, uploadBaseline, 35_000);
    }
    if (!uploadConfirm || !hasNewUploadEvidence(uploadBaseline, uploadConfirm)) {
      throw new Error('原图没有完整上传到 ChatGPT，未检测到附件预览或文件名。');
    }

    emitWebPoseAnalysisStatus(event, {
      step: '正在发送网感姿势分析指令',
      detail: '等待 ChatGPT 返回 8 条结构化姿势建议。',
      level: 'info'
    });
    if (!await evalChatGptMutation<boolean>(webContents, setPromptScript(instruction), 6000)) {
      throw new Error('没有成功写入 ChatGPT 输入框。');
    }
    const uploadState = await waitForStableChatGptComposerReady(webContents, expectedFileNames.length, 60_000);
    if (!uploadState?.ready) {
      if (uploadState?.uploadErrorText) throw new Error(`ChatGPT 页面提示附件上传失败：${uploadState.uploadErrorText}。`);
      throw new Error('ChatGPT 附件上传仍未完成或发送按钮不可用。');
    }
    await dismissOpenMenus(webContents);
    const preSendState = await waitForStableChatGptComposerReady(webContents, expectedFileNames.length, 15_000);
    const preSendAttachments = await waitForStableChatGptAttachments(webContents, expectedFileNames, uploadBaseline, 10_000);
    await appendChatGptAutomationDiagnostic('web-pose-analysis-pre-send-gate', {
      uploadMethod: uploadMethod.method,
      uploadState: preSendState,
      uploadEvidence: preSendAttachments,
      expectedAttachments: expectedFileNames.length
    });
    if (!preSendState?.ready || !hasNewUploadEvidence(uploadBaseline, preSendAttachments)) {
      throw new Error('发送前复核发现网感姿势分析图已从输入区消失，或发送按钮仍不可用。本轮没有发送空附件消息。');
    }

    const textBaseline = await evalInPageWithTimeout<ChatGptImageBaseline>(webContents, collectImageBaselineScript, 6000);
    let sent = await triggerPacedChatGptSend(event, webContents);
    if (!sent) {
      const fallback = await evalChatGptMutation<{ sent: boolean; method: string; label: string }>(
        webContents,
        fallbackClickSendScript,
        6000
      ).catch(() => ({ sent: false, method: 'script-error', label: '' }));
      sent = fallback.sent;
    }
    if (!sent) throw new Error('没有找到可用的发送按钮，本轮姿势分析未发送。');
    posePromptSent = true;
    keepChatGptWindowInBackground(win);

    const acceptance = await waitForChatGptSendAcceptanceWithNoOpRetry(webContents, textBaseline, 'web-pose');
    if (acceptance?.terminalFailure) throw new Error(acceptance.terminalFailure);
    if (!acceptance?.accepted) {
      const confirmedNoOp = shouldRetryChatGptNoOpSend(textBaseline, acceptance);
      if (confirmedNoOp) posePromptSent = false;
      if (!confirmedNoOp) {
        rememberUncertainChatGptSubmission('网感姿势分析发送已点击，但 ChatGPT 没有确认建立新消息。');
      }
      throw new Error(
        confirmedNoOp
          ? 'ChatGPT 发送按钮连续两次没有响应，姿势分析消息未发出，请稍后重试。'
          : 'ChatGPT 没有确认接收姿势分析消息，本轮已停止。'
      );
    }
    emitWebPoseAnalysisStatus(event, {
      step: '正在生成 8 个网感姿势',
      detail: '旧的姿势选项和当前选择会一直保留到本轮成功返回。',
      level: 'info'
    });
    const responseSnapshot = await waitForChatGptAnalysisResponse(
      webContents,
      textBaseline,
      chatGptAnalysisInitialWaitMs,
      (text) => Boolean(parseWebPoseSuggestions(text))
    );
    responseSnapshotForDiagnostics = responseSnapshot;
    const suggestions = responseSnapshot?.done && responseSnapshot.text
      ? parseWebPoseSuggestions(responseSnapshot.text)
      : null;
    if (!suggestions) throw new Error(responseSnapshot?.errorText || 'ChatGPT 没有返回完整的 8 条网感姿势。');

    await appendChatGptAutomationDiagnostic('web-pose-analysis-succeeded', {
      pageUrl: webContents.getURL(),
      responseLength: responseSnapshot?.text.length || 0,
      suggestionCount: suggestions.length
    });
    const cleaned = await cleanupChatGptAnalysisConversation(event, win, automationUrl, true);
    emitWebPoseAnalysisStatus(event, {
      step: '网感姿势分析完成',
      detail: cleaned ? '8 个新姿势已准备好，点击下方箭头选择。' : '8 个新姿势已准备好；下次发送前会再次清理 ChatGPT 输入区。',
      level: cleaned ? 'success' : 'warning'
    });
    return { ok: true, suggestions };
  } catch (error) {
    const message = error instanceof Error ? error.message : '网感姿势分析失败。';
    const protectionPaused = chatGptManualVerificationRequired || error instanceof ChatGptProtectionPausedError || isChatGptConversationAccessLimitedMessage(message);
    if (protectionPaused) rememberChatGptConversationAccessLimit(message);
    await appendChatGptAutomationDiagnostic('web-pose-analysis-failed', {
      message,
      pageUrl: win && !win.isDestroyed() ? win.webContents.getURL() : '',
      snapshot: summarizeChatGptAnalysisSnapshot(responseSnapshotForDiagnostics)
    });
    if (!protectionPaused && !posePromptSent) {
      await cleanupChatGptAnalysisConversation(event, win, automationUrl, true);
    }
    emitWebPoseAnalysisStatus(event, {
      step: protectionPaused ? 'ChatGPT 访问保护，任务已安全暂停' : '网感姿势分析未完成',
      detail: `${message} 已保留原有姿势选项和当前选择。${protectionPaused ? ' 软件不会继续点击或重复发送。' : ''}`,
      level: protectionPaused ? 'warning' : 'error'
    });
    return { ok: false, error: message, errorCode: protectionPaused ? 'chatgpt_protection_paused' : 'web_pose_analysis_failed' };
  } finally {
    chatGptAnalysisRunning = false;
    if (tempFilePath) await fs.unlink(tempFilePath).catch(() => undefined);
    if (win && !win.isDestroyed()) keepChatGptWindowInBackground(win);
  }
}

function isTrustedMainRendererUrl(value: string) {
  try {
    const target = new URL(value);
    if (isDev) {
      return target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.port === '5173';
    }
    if (target.protocol !== 'file:') return false;
    const actual = path.resolve(fileURLToPath(target));
    const expected = path.resolve(__dirname, '../../dist/index.html');
    return process.platform === 'win32'
      ? actual.toLowerCase() === expected.toLowerCase()
      : actual === expected;
  } catch {
    return false;
  }
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const senderFrame = event.senderFrame;
  const senderUrl = senderFrame?.url || event.sender.getURL();
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id ||
    Boolean(senderFrame?.parent) ||
    !isTrustedMainRendererUrl(senderUrl)
  ) {
    throw new Error('已拒绝非像锚主界面的操作请求。');
  }
}

type TrustedIpcHandler = Parameters<typeof ipcMain.handle>[1];

function registerTrustedIpcHandler(channel: string, listener: TrustedIpcHandler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return listener(event, ...args);
  });
}

const mainWindowFailurePages = new WeakSet<BrowserWindow>();

async function appendElectronRuntimeDiagnostic(
  event: string,
  details: Record<string, unknown> = {}
) {
  try {
    const logDir = path.join(appDataDir(), 'logs');
    await ensureDir(logDir);
    await fs.appendFile(
      path.join(logDir, 'electron-runtime.ndjson'),
      `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`,
      'utf8'
    );
  } catch {
    // Startup diagnostics must never become another startup failure.
  }
}

async function showMainWindowLoadFailure(win: BrowserWindow, reason: string) {
  if (win.isDestroyed()) return;
  mainWindowFailurePages.add(win);
  await appendElectronRuntimeDiagnostic('main-window-failure-page', { reason });
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>像锚启动异常</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111216;color:#f4f4f5;font-family:"Segoe UI Variable","Microsoft YaHei UI",sans-serif}.panel{width:min(520px,calc(100vw - 48px));padding:24px;border:1px solid #3f3f46;border-radius:8px;background:#18181b}.panel h1{margin:0 0 12px;font-size:20px}.panel p{margin:8px 0;color:#c4c4cc;line-height:1.7}.reason{font-family:Consolas,monospace;color:#f2c66d;word-break:break-word}</style></head><body><main class="panel"><h1>像锚界面未能加载</h1><p>程序已经记录启动诊断。请完全退出后重新打开；若仍出现，请保留 AppData 日志用于定位。</p><p class="reason">${reason.replace(/[<>&"']/g, '')}</p></main></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => undefined);
  if (!win.isDestroyed()) win.show();
}

async function createWindow() {
  const activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const initialBounds = resolveMainWindowBounds(activeDisplay.workArea);
  const win = new BrowserWindow({
    ...initialBounds,
    minWidth: Math.min(1024, initialBounds.width),
    minHeight: Math.min(600, initialBounds.height),
    title: '像锚',
    icon: getTrayIconPath(),
    backgroundColor: '#08090b',
    show: false,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = win;
  win.on('close', (event) => {
    if (isAppQuitting || !isChatGptKeepAliveEnabled()) return;
    event.preventDefault();
    hideMainWindowToTray(win);
  });
  win.on('closed', () => {
    mainWindow = null;
    if (!isAppQuitting && process.platform !== 'darwin') app.quit();
  });

  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  let rendererRecoveryAttempts = 0;
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || mainWindowFailurePages.has(win)) return;
    void appendElectronRuntimeDiagnostic('main-window-did-fail-load', {
      errorCode,
      errorDescription,
      url: validatedUrl
    });
    void showMainWindowLoadFailure(win, `${errorCode}: ${errorDescription}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    void appendElectronRuntimeDiagnostic('main-window-render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      recoveryAttempt: rendererRecoveryAttempts
    });
    if (rendererRecoveryAttempts < 1 && !win.isDestroyed()) {
      rendererRecoveryAttempts += 1;
      win.webContents.reload();
      return;
    }
    void showMainWindowLoadFailure(win, `渲染进程退出：${details.reason} (${details.exitCode})`);
  });
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (mainWindowFailurePages.has(win) && targetUrl.startsWith('data:text/html')) return;
    if (isTrustedMainRendererUrl(targetUrl)) return;
    event.preventDefault();
    void openSafeExternalUrl(targetUrl).catch(() => undefined);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openSafeExternalUrl(url).catch(() => undefined);
    return { action: 'deny' };
  });

  let enteringImmersive = false;
  win.on('maximize', () => {
    if (process.platform !== 'win32' || win.isFullScreen() || enteringImmersive) return;
    enteringImmersive = true;
    win.setFullScreen(true);
    setTimeout(() => {
      enteringImmersive = false;
    }, 250);
  });
  win.on('unmaximize', () => {
    if (process.platform === 'win32' && win.isFullScreen()) win.setFullScreen(false);
  });
  win.on('leave-full-screen', () => {
    if (process.platform === 'win32' && win.isMaximized()) win.unmaximize();
  });

  try {
    if (isDev) {
      await win.loadURL('http://127.0.0.1:5173');
    } else {
      await win.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendElectronRuntimeDiagnostic('main-window-load-rejected', { message });
    await showMainWindowLoadFailure(win, message);
  }
}

function registerIpc() {
  registerTrustedIpcHandler('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return true;
  });

  registerTrustedIpcHandler('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isFullScreen()) {
      win.setFullScreen(false);
    } else {
      win.setFullScreen(true);
    }
    return true;
  });

  registerTrustedIpcHandler('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return true;
  });

  registerTrustedIpcHandler('clipboard:copy', async (_event, text: string) => {
    clipboard.writeText(text);
    return true;
  });

  registerTrustedIpcHandler('shell:open-external', async (_event, url: string) => {
    await openSafeExternalUrl(url);
    return true;
  });

  registerTrustedIpcHandler('shell:open-path', async (_event, folderPath: string) => {
    const result = await openExistingDirectory(folderPath);
    return result.length === 0;
  });

  registerTrustedIpcHandler('face-landmarker:load-assets', async (): Promise<FaceLandmarkerAssetBundle> => {
    const assetRoot = path.join(__dirname, isDev ? '../../public/face-landmarker' : '../../dist/face-landmarker');
    const [model, segmenterModel] = await Promise.all([
      fs.readFile(path.join(assetRoot, 'face_landmarker.task')),
      fs.readFile(path.join(assetRoot, 'selfie_multiclass_256x256.tflite'))
    ]);
    return {
      model: new Uint8Array(model),
      segmenterModel: new Uint8Array(segmenterModel)
    };
  });

  registerTrustedIpcHandler(
    'image:normalize-import',
    async (_event, payload: ImageImportRequest): Promise<ImageImportResult> => {
      try {
        return { ok: true, image: await normalizeImportedImage(payload) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '图片导入失败。'
        };
      }
    }
  );

  registerTrustedIpcHandler('settings:read', async () => {
    try {
      const raw = await fs.readFile(settingsPath(), 'utf8');
      const parsed = sanitizeStoredSettings(JSON.parse(raw));
      cachedSettings = { ...cachedSettings, ...parsed };
      return parsed;
    } catch {
      return {};
    }
  });

  registerTrustedIpcHandler('settings:write', async (_event, settings: AppSettings) => {
    await ensureDir(appDataDir());
    const safeSettings = { ...sanitizeStoredSettings(settings), apiKeySessionOnly: '' };
    await fs.writeFile(settingsPath(), JSON.stringify(safeSettings, null, 2), 'utf8');
    cachedSettings = { ...cachedSettings, ...safeSettings };
    configureChatGptPersistence(safeSettings, false);
    return true;
  });

  registerTrustedIpcHandler('relay:get-status', async (): Promise<RelayApiStatus> => {
    await ensureRelayCredentialLoaded();
    return relayApiStatus();
  });

  registerTrustedIpcHandler(
    'relay:configure-key',
    async (_event, payload?: { apiKey?: string; remember?: boolean; config?: RelayApiConfig }): Promise<RelayApiActionResult> =>
      configureRelayCredential(payload?.apiKey || '', payload?.remember === true, payload?.config as RelayApiConfig)
  );

  registerTrustedIpcHandler('relay:clear-key', async (): Promise<RelayApiActionResult> =>
    clearRelayCredential()
  );

  registerTrustedIpcHandler(
    'relay:test-connection',
    async (_event, payload?: { model?: string }): Promise<RelayApiActionResult> => {
      await ensureRelayCredentialLoaded();
      if (!relaySessionApiKey || !relaySessionConfig) {
        return { ok: false, ...relayApiStatus('请先配置自己的 API Key。'), error: 'API Key 未配置。' };
      }
      try {
        const config = { ...relaySessionConfig };
        const model = config.model;
        const adapter = configuredRelayAdapter();
        const result = await adapter.testConnection({
          apiKey: relaySessionApiKey,
          ...config
        });
        return {
          ok: result.ok,
          ...relayApiStatus(result.message || `API 已连接，当前分组已开放${relayImageModelLabel(model)}。`)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'API 连接失败。';
        return { ok: false, ...relayApiStatus(message), error: message };
      }
    }
  );

  registerTrustedIpcHandler('web-ai:check-login', async (event, payload: { provider?: WebAiProvider; url?: string; backend?: ChatGptBrowserBackend; reconcileProtection?: boolean }) => {
    const provider = normalizeWebAiProvider(payload.provider);
    const url = payload.url || defaultWebAiUrls[provider];
    const adapter = createWebAiControlAdapter(provider, url, payload.backend);
    return runChatGptControlOperation(
      provider === 'gemini' ? 'gemini:check-login' : 'check-login',
      () => provider === 'chatgpt'
        ? checkChatGptLoginAndProtection(event, { ...payload, url, reconcileProtection: payload.reconcileProtection === true })
        : adapter.checkLogin()
    );
  });

  registerTrustedIpcHandler('web-ai:show-window', async (_event, payload: { provider?: WebAiProvider; url?: string; backend?: ChatGptBrowserBackend }) => {
    const provider = normalizeWebAiProvider(payload.provider);
    const url = payload.url || defaultWebAiUrls[provider];
    const adapter = createWebAiControlAdapter(provider, url, payload.backend);
    return runChatGptControlOperation(
      provider === 'gemini' ? 'gemini:show-window' : 'show-window',
      () => adapter.showWindow(),
      'single-flight'
    );
  });

  registerTrustedIpcHandler('web-ai:recover-window', async (_event, payload: { provider?: WebAiProvider; url?: string; backend?: ChatGptBrowserBackend }) => {
    const provider = normalizeWebAiProvider(payload.provider);
    const url = payload.url || defaultWebAiUrls[provider];
    return runChatGptControlOperation(
      provider === 'gemini' ? 'gemini:recover-window' : 'recover-window',
      () => provider === 'gemini'
        ? recoverGeminiWindowForInspection(url)
        : recoverChatGptWindowForInspection(url, 'auto', payload.backend)
    );
  });

  registerTrustedIpcHandler('web-ai:list-models', async (_event, payload: { provider?: WebAiProvider; url?: string; backend?: ChatGptBrowserBackend }) => {
    const provider = normalizeWebAiProvider(payload.provider);
    const url = payload.url || defaultWebAiUrls[provider];
    const adapter = createWebAiControlAdapter(provider, url, payload.backend);
    return runChatGptControlOperation(
      provider === 'gemini' ? 'gemini:list-models' : 'list-models',
      () => adapter.listModels()
    );
  });

  registerTrustedIpcHandler('chatgpt:check-login', async (event, payload: { url: string; fallbackToChrome?: boolean; openMode?: AppSettings['chatGptOpenMode']; openExternal?: boolean; backend?: ChatGptBrowserBackend }) =>
    runChatGptControlOperation('check-login', () =>
      checkChatGptLoginAndProtection(event, { ...payload, reconcileProtection: true })
    )
  );

  registerTrustedIpcHandler('chatgpt:show-window', async (_event, payload: { url: string; openMode?: AppSettings['chatGptOpenMode']; backend?: ChatGptBrowserBackend }) =>
    runChatGptControlOperation(
      'show-window',
      () => showChatGptWindowForInspection(payload.url, payload.openMode, payload.backend),
      chatGptControlQueue.isInFlight('recover-window') ? 'serialized' : 'single-flight'
    )
  );

  registerTrustedIpcHandler('chatgpt:recover-window', async (_event, payload: { url: string; openMode?: AppSettings['chatGptOpenMode']; backend?: ChatGptBrowserBackend }) =>
    runChatGptControlOperation('recover-window', () =>
      recoverChatGptWindowForInspection(payload.url, payload.openMode, payload.backend)
    )
  );

  registerTrustedIpcHandler('chatgpt:list-models', async (_event, payload: { url: string; backend?: ChatGptBrowserBackend }) =>
    runChatGptControlOperation('list-models', () => listChatGptModels(payload.url, payload.backend))
  );

  registerTrustedIpcHandler('chatgpt:pause-batch', async (event) => {
    if (!chatGptAutomationRunning) return { ok: false, message: '当前没有正在运行的网页批量任务。' };
    chatGptBatchPauseRequested = true;
    if (activeRelayAdapter) {
      for (const taskId of activeRelayTaskIds) activeRelayAdapter.cancel(taskId);
    }
    emitAutomationStatus(event, {
      step: '已收到暂停请求',
      detail: activeRelayAdapter
        ? '正在取消 API 请求，并保留已经保存的结果。'
        : '当前已经发送的图片会继续等待并保存，保存后暂停后续图片。',
      level: 'warning'
    });
    return { ok: true, message: '已请求暂停，将在当前图片处理并保存后暂停。' };
  });

  registerTrustedIpcHandler(
    'chatgpt:check-protection-recovery',
    async (event, payload: { url: string; backend?: ChatGptBrowserBackend }) => {
      await loadChatGptRuntimeState();
      if (chatGptManualVerificationRequired && (!chatGptWindow || chatGptWindow.isDestroyed())) {
        return { ok: false, message: chatGptManualVerificationMessage, protectionPaused: true };
      }
      if (chatGptProtectionState.phase !== 'PROTECTION_PAUSED') {
        return { ok: true, message: 'ChatGPT 当前没有处于访问保护暂停状态。', protectionPaused: false };
      }
      if (chatGptConversationAccessBlockedUntil > Date.now()) {
        const seconds = Math.max(1, Math.ceil((chatGptConversationAccessBlockedUntil - Date.now()) / 1000));
        return {
          ok: false,
          message: `ChatGPT 仍在冷却中，约 ${seconds} 秒后才允许进行一次页面恢复检查。`,
          protectionPaused: true
        };
      }
      const win = chatGptWindow && !chatGptWindow.isDestroyed()
        ? chatGptWindow
        : await getChatGptWindow(payload.url || 'https://chatgpt.com/', payload.backend, 'background');
      const recovery = await recoverChatGptConversationAccessAfterCooldown(event, win.webContents, { manual: true });
      return {
        ok: recovery.ok,
        message: recovery.ok ? 'ChatGPT 页面已恢复，将先以单路继续缺失任务。' : recovery.error,
        protectionPaused: !recovery.ok && recovery.paused
      };
    }
  );

  registerTrustedIpcHandler('autosave:read', async () => {
    return readAutosaveProject();
  });

  registerTrustedIpcHandler('autosave:write', async (_event, project: ProjectState) => {
    await writeAutosaveProject(project);
    return true;
  });

  registerTrustedIpcHandler('legacy-results:recover-post-processing', async () =>
    recoverLegacyPostProcessingResults(appDataDir())
  );

  registerTrustedIpcHandler('camera-realism:choose-folder', async (event): Promise<CameraRealismFolderSelection> => {
    try {
      const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
      const options: OpenDialogOptions = {
        title: '选择需要批量降低 AI 感的图片文件夹',
        properties: ['openDirectory']
      };
      const selected = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
      const scan = await scanCameraRealismFolder(selected.filePaths[0]);
      const sessionId = randomUUID();
      cameraRealismFolderSessions.set(sessionId, {
        sourceDir: scan.sourceDir,
        items: new Map(scan.items.map((item) => [item.id, item]))
      });
      return {
        canceled: false,
        sessionId,
        sourceDir: scan.sourceDir,
        items: scan.items.map(({ sourcePath: _sourcePath, ...item }) => item)
      };
    } catch (error) {
      return { canceled: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  registerTrustedIpcHandler(
    'camera-realism:process-folder-item',
    async (_event, payload: { sessionId: string; itemId: string; strength?: number }): Promise<CameraRealismFolderProcessResult> => {
      const itemId = typeof payload?.itemId === 'string' ? payload.itemId : '';
      try {
        const sessionRecord = cameraRealismFolderSessions.get(payload?.sessionId);
        const item = sessionRecord?.items.get(itemId);
        if (!sessionRecord || !item || item.status !== 'ready') {
          throw new Error('文件夹处理会话或图片条目已失效，请重新选择文件夹。');
        }
        const realSourcePath = await fs.realpath(item.sourcePath);
        if (!isContainedFile(sessionRecord.sourceDir, realSourcePath)) {
          throw new Error('图片已离开所选文件夹，已拒绝处理。');
        }
        const stats = await fs.stat(realSourcePath);
        if (!stats.isFile() || stats.size < 4 || stats.size > maximumCameraRealismInputBytes) {
          throw new Error('图片大小无效或超过处理上限。');
        }
        sessionRecord.outputDir ||= await createCameraRealismFolderOutputDirectory(sessionRecord.sourceDir);
        const outputPath = await nextCameraRealismFolderOutputPath(sessionRecord.outputDir, item.fileName);
        const input = await fs.readFile(realSourcePath);
        const seed = randomBytes(4).readUInt32LE(0);
        const finished = await writeCameraRealismCopy(input, outputPath, {
          preset: 'natural',
          seed,
          strength: payload?.strength
        });
        return {
          ok: true,
          itemId,
          fileName: path.basename(outputPath),
          filePath: outputPath,
          outputDir: sessionRecord.outputDir,
          width: finished.width,
          height: finished.height
        };
      } catch (error) {
        return { ok: false, itemId, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  registerTrustedIpcHandler('camera-realism:close-folder-session', async (_event, sessionId: string) => {
    if (typeof sessionId !== 'string') return false;
    return cameraRealismFolderSessions.delete(sessionId);
  });

  registerTrustedIpcHandler('result:camera-realism', async (_event, payload: CameraRealismRequest): Promise<CameraRealismResponse> => {
    try {
      if (!payload || typeof payload.projectName !== 'string' || !payload.image) {
        throw new Error('没有收到可处理的结果图片。');
      }
      const resultDir = resolveContainedChild(app.getPath('desktop'), safeResultProjectName(payload.projectName));
      await ensureDir(resultDir);
      if ((await fs.lstat(resultDir)).isSymbolicLink()) throw new Error('项目结果目录不能是符号链接。');
      const input = await readResultImageInput(payload, resultDir, '相机质感');
      const nextFile = await nextCameraRealismFile(resultDir, payload.image.name);
      const seed = randomBytes(4).readUInt32LE(0);
      const finished = await writeCameraRealismCopy(input, nextFile.filePath, {
        preset: 'natural',
        seed,
        strength: payload.strength
      });
      const createdAt = new Date().toISOString();
      return {
        ok: true,
        image: {
          id: `camera-realism-${finished.seed.toString(16)}-${Date.now()}`,
          name: nextFile.fileName,
          type: 'image/jpeg',
          size: finished.buffer.length,
          width: finished.width,
          height: finished.height,
          dataUrl: jpegPreviewDataUrl(finished.buffer, finished.width, finished.height),
          path: nextFile.filePath,
          promptText: payload.image.promptText,
          dimensionAdjustment: `已生成全图相机质感副本（处理强度 ${finished.strength}），原结果未修改。`,
          createdAt,
          source: 'camera-realism'
        }
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  registerTrustedIpcHandler('result:face-naturalization', async (_event, payload: FaceNaturalizationRequest): Promise<FaceNaturalizationResponse> => {
    try {
      if (!payload || typeof payload.projectName !== 'string' || !payload.image || !payload.mask) {
        throw new Error('没有收到可处理的结果图片或人脸区域。');
      }
      const mask = payload.mask;
      if (
        typeof mask.dataUrl !== 'string' ||
        mask.dataUrl.length > Math.ceil(maximumFaceNaturalizationMaskBytes * 4 / 3) + 256 ||
        ![mask.x, mask.y, mask.width, mask.height].every(Number.isFinite) ||
        mask.width <= 0 ||
        mask.height <= 0
      ) {
        throw new Error('人脸处理区域无效。');
      }
      const decodedMask = dataUrlToBuffer(mask.dataUrl);
      if (!decodedMask.mime.startsWith('image/') || decodedMask.buffer.length > maximumFaceNaturalizationMaskBytes) {
        throw new Error('人脸处理区域只接受有效图片。');
      }
      const resultDir = resolveContainedChild(app.getPath('desktop'), safeResultProjectName(payload.projectName));
      await ensureDir(resultDir);
      if ((await fs.lstat(resultDir)).isSymbolicLink()) throw new Error('项目结果目录不能是符号链接。');
      const input = await readResultImageInput(payload, resultDir, '面部自然化');
      const originalMetadata = await sharp(input).metadata();
      const rotated = [5, 6, 7, 8].includes(originalMetadata.orientation || 1);
      const actualWidth = rotated ? originalMetadata.height : originalMetadata.width;
      const actualHeight = rotated ? originalMetadata.width : originalMetadata.height;
      if ((payload.image.width && payload.image.width !== actualWidth) || (payload.image.height && payload.image.height !== actualHeight)) {
        throw new Error('未找到与预览对应的完整原图，请重新导入原图后再进行面部自然化。');
      }
      const nextFile = await nextFaceNaturalizationFile(resultDir, payload.image.name);
      let source: Buffer | undefined;
      const sourceImage = payload.sourceImage;
      if (sourceImage && typeof sourceImage.dataUrl === 'string' && sourceImage.dataUrl.startsWith('data:image/')) {
        const decodedSource = dataUrlToBuffer(sourceImage.dataUrl);
        if (decodedSource.mime.startsWith('image/') && decodedSource.buffer.length > 32 && decodedSource.buffer.length <= 48 * 1024 * 1024) {
          source = decodedSource.buffer;
        }
      }
      const finished = await writeFaceNaturalizationCopy(input, nextFile.filePath, {
        data: decodedMask.buffer,
        x: mask.x,
        y: mask.y,
        width: mask.width,
        height: mask.height,
        source
      });
      const createdAt = new Date().toISOString();
      return {
        ok: true,
        image: {
          id: `face-naturalization-${Date.now()}`,
          name: nextFile.fileName,
          type: 'image/png',
          size: finished.buffer.length,
          width: finished.width,
          height: finished.height,
          dataUrl: jpegPreviewDataUrl(finished.buffer, finished.width, finished.height),
          path: nextFile.filePath,
          promptText: payload.image.promptText,
          dimensionAdjustment: '只在识别到的人脸皮肤上贴回主垫图的毛孔和噪点，背景和服装未修改。',
          createdAt,
          source: 'face-naturalization'
        }
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  registerTrustedIpcHandler('project:save', async (_event, project: ProjectState) => {
    const result = await dialog.showSaveDialog({
      title: '保存像锚项目',
      defaultPath: `${safeName(project.projectName)}.xiangmao.json`,
      filters: [{ name: '像锚项目', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify({ ...project, projectPath: result.filePath }, null, 2), 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  registerTrustedIpcHandler('project:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入像锚项目',
      properties: ['openFile'],
      filters: [{ name: '像锚项目', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const raw = await fs.readFile(result.filePaths[0], 'utf8');
    return { canceled: false, project: parseProjectStateJson(raw), filePath: result.filePaths[0] };
  });

  registerTrustedIpcHandler('export:text', async (_event, payload: { defaultName: string; content: string }) => {
    const result = await dialog.showSaveDialog({
      title: '导出文本',
      defaultPath: payload.defaultName,
      filters: [
        { name: 'Text', extensions: ['txt', 'md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, payload.content, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  registerTrustedIpcHandler('export:red-circle', async (_event, payload: { projectName: string; dataUrl: string }) => {
    const result = await dialog.showSaveDialog({
      title: '导出带红圈主图',
      defaultPath: `${safeName(payload.projectName)}_red_circle.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeDataUrl(result.filePath, payload.dataUrl);
    return { canceled: false, filePath: result.filePath };
  });

  registerTrustedIpcHandler('send:create-package', async (event, payload: SendPackagePayload, settings: AppSettings) => {
    const { project, prompt, redCircleDataUrl, operationGuide, generationCount } = payload;
    const automationSettings: AppSettings = settings;
    const webAiProvider = normalizeWebAiProvider(automationSettings.webAiProvider);
    const generationProvider = normalizeGenerationProvider(automationSettings.generationProvider, webAiProvider);
    if (generationProvider === 'relay') {
      await ensureRelayCredentialLoaded();
      if (!relaySessionApiKey) {
        return {
          ok: false,
          exportDir: '',
          copied: false,
          chatGptOpened: false,
          exportFolderOpened: false,
          files: [],
          error: 'API 未配置。请先粘贴自己的 API Key。'
        };
      }
    }
    const generationProviderLabel = generationProvider === 'relay'
      ? 'API'
      : webAiProvider === 'gemini' ? 'Gemini' : 'ChatGPT';
    const exportRoot = await exportRootDir();
    const exportDir = resolveContainedChild(exportRoot, `${safeName(project.projectName)}_${stamp()}`);
    await ensureDir(exportDir);

    if (!project.mainImage) throw new Error('未上传主图。');
    if (!project.maskCircle) throw new Error('请先在原图上标记红圈。');
    const faceOcclusionApplied = Boolean(
      project.faceOcclusionEnabled && project.faceOcclusionMask?.raster?.dataUrl
    );
    const targetDimensions = dimensionsFromImageAsset(project.mainImage);
    if (!targetDimensions) throw new Error('无法读取原图的像素尺寸。为确保生成结果尺寸完全一致，本轮已停止，请重新上传原图后再试。');
    const finalPromptText = appendOriginalSizeInstruction(prompt.promptText, targetDimensions);
    const mainExt = extFromMime(project.mainImage.type);
    const mainName = `00_仅本地原图备份.${mainExt}`;
    const circleName = faceOcclusionApplied
      ? '01_红圈蒙脸主垫图.png'
      : '01_红圈主垫图.png';
    const mainPath = path.join(exportDir, mainName);
    const circlePath = path.join(exportDir, circleName);
    await writeDataUrl(mainPath, project.mainImage.dataUrl);
    await writeDataUrl(circlePath, redCircleDataUrl);

    const refFiles: string[] = [];
    const automationFilePaths = [circlePath];
    for (let index = 0; index < project.referenceImages.length; index += 1) {
      const ref = project.referenceImages[index];
      const ext = extFromMime(ref.type);
      const fileName = `${String(index + 2).padStart(2, '0')}_参考图${referenceLabel(index)}.${ext}`;
      const filePath = path.join(exportDir, fileName);
      await writeDataUrl(filePath, ref.dataUrl);
      refFiles.push(fileName);
      automationFilePaths.push(filePath);
    }

    const wardrobeFiles: string[] = [];
    const wardrobeStartIndex = project.referenceImages.length + 2;
    for (let index = 0; index < project.wardrobeReferences.length; index += 1) {
      const reference = project.wardrobeReferences[index];
      const ext = extFromMime(reference.type);
      const kindLabel = reference.kind === 'clothing' ? '衣物参考图' : '配饰参考图';
      const fileName = `${String(wardrobeStartIndex + index).padStart(2, '0')}_${kindLabel}${referenceLabel(index)}.${ext}`;
      const filePath = path.join(exportDir, fileName);
      await writeDataUrl(filePath, reference.dataUrl);
      wardrobeFiles.push(fileName);
      automationFilePaths.push(filePath);
    }

    const assetCount = project.referenceImages.length + project.wardrobeReferences.length;
    const promptTxtName = `${String(assetCount + 2).padStart(2, '0')}_最终提示词.txt`;
    const promptMdName = `${String(assetCount + 3).padStart(2, '0')}_最终提示词.md`;
    const guideName = `${String(assetCount + 4).padStart(2, '0')}_${generationProviderLabel}操作说明.txt`;
    const manifestName = `${String(assetCount + 5).padStart(2, '0')}_导出清单.json`;
    const projectJsonName = `${String(assetCount + 6).padStart(2, '0')}_项目备份.xiangmao.json`;
    const zipName = `${String(assetCount + 7).padStart(2, '0')}_发送包.zip`;
    const coreRule = project.wardrobeReferences.length
      ? '人脸只在红圈内替换；穿搭只在指定服饰配饰目标区域替换；其余内容完全不变。'
      : '红圈内可编辑，红圈外完全不变。';
    const packageImageFiles = [circleName, ...refFiles, ...wardrobeFiles];
    const packageOrderText = packageImageFiles.map((file, index) => `${index + 1}. ${file}`).join('\n');

    await fs.writeFile(path.join(exportDir, promptTxtName), finalPromptText, 'utf8');
    await fs.writeFile(
      path.join(exportDir, promptMdName),
      `# ${prompt.title}\n\n## 核心规则\n\n${coreRule}\n\n## 素材文件顺序\n\n${packageOrderText}\n\n## Prompt\n\n${finalPromptText}\n\n## Negative Prompt\n\n${prompt.negativePrompt}\n`,
      'utf8'
    );
    await fs.writeFile(path.join(exportDir, guideName), operationGuide, 'utf8');
    const manifest = {
      projectName: project.projectName,
      exportedAt: new Date().toISOString(),
      mainImage: mainName,
      redCircleImage: circleName,
      referenceCount: project.referenceImages.length,
      references: refFiles,
      wardrobeReferenceCount: project.wardrobeReferences.length,
      wardrobeReferences: project.wardrobeReferences.map((reference, index) => ({
        file: wardrobeFiles[index],
        kind: reference.kind,
        target: reference.target,
        tags: reference.tags,
        note: reference.note
      })),
      automationUploadFiles: [circleName, ...refFiles, ...wardrobeFiles],
      promptVersion: prompt.id,
      outputMode: prompt.outputMode,
      wordCount: prompt.wordCount,
      outputSize: targetDimensions,
      hasNegativePrompt: Boolean(prompt.negativePrompt),
      maskCircle: project.maskCircle,
      faceOcclusionApplied,
      sendMode: settings.chatGptAutomationMode,
      softwareVersion: project.softwareVersion
    };
    await fs.writeFile(path.join(exportDir, manifestName), JSON.stringify(manifest, null, 2), 'utf8');
    await fs.writeFile(path.join(exportDir, projectJsonName), JSON.stringify(project, null, 2), 'utf8');

    const zip = new JSZip();
    zip.file(mainName, dataUrlToBuffer(project.mainImage.dataUrl).buffer);
    zip.file(circleName, dataUrlToBuffer(redCircleDataUrl).buffer);
    for (let index = 0; index < project.referenceImages.length; index += 1) {
      const ref = project.referenceImages[index];
      const zipPath = refFiles[index] || `${String(index + 2).padStart(2, '0')}_参考图${referenceLabel(index)}.png`;
      zip.file(zipPath, dataUrlToBuffer(ref.dataUrl).buffer);
    }
    for (let index = 0; index < project.wardrobeReferences.length; index += 1) {
      const reference = project.wardrobeReferences[index];
      const zipPath = wardrobeFiles[index] || `${String(wardrobeStartIndex + index).padStart(2, '0')}_穿搭参考图${referenceLabel(index)}.png`;
      zip.file(zipPath, dataUrlToBuffer(reference.dataUrl).buffer);
    }
    zip.file(promptTxtName, finalPromptText);
    zip.file(
      promptMdName,
      `# ${prompt.title}\n\n## 核心规则\n\n${coreRule}\n\n## 素材文件顺序\n\n${packageOrderText}\n\n## Prompt\n\n${finalPromptText}\n\n## Negative Prompt\n\n${prompt.negativePrompt}\n`
    );
    zip.file(guideName, operationGuide);
    zip.file(manifestName, JSON.stringify(manifest, null, 2));
    zip.file(projectJsonName, JSON.stringify(project, null, 2));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await fs.writeFile(path.join(exportDir, zipName), zipBuffer);

    let copied = false;
    let exportFolderOpened = false;
    let chatGptOpened = false;
    try {
      if (automationSettings.autoCopyPrompt) {
        clipboard.writeText(finalPromptText);
        copied = true;
      }
    } catch {
      copied = false;
    }
    try {
      const automationMode = automationSettings.chatGptAutomationMode || 'manual';
      const canAutoOpenExportFolder = automationSettings.autoOpenExportFolder && automationMode === 'manual';
      if (canAutoOpenExportFolder) {
        exportFolderOpened = (await shell.openPath(exportDir)).length === 0;
      } else if (automationSettings.autoOpenExportFolder) {
        console.info('[Send package] suppressed export folder auto-open during web AI automation', {
          exportDir,
          automationMode
        });
      }
    } catch {
      exportFolderOpened = false;
    }
    try {
      if (generationProvider !== 'relay' && (automationSettings.chatGptAutomationMode || 'manual') === 'manual') {
        await openSafeExternalUrl(
          webAiProvider === 'gemini'
            ? automationSettings.geminiUrl || defaultWebAiUrls.gemini
            : automationSettings.chatGptUrl || defaultWebAiUrls.chatgpt
        );
        chatGptOpened = true;
      }
    } catch {
      chatGptOpened = false;
    }

    let chatGptAutomation: ChatGptAutomationResult | undefined;
    if (generationProvider === 'relay') {
      const relayAttachments: RelayImageAttachment[] = [
        {
          name: circleName,
          mimeType: 'image/png',
          data: dataUrlToBuffer(redCircleDataUrl).buffer
        },
        ...project.referenceImages.map((reference, index) => ({
          name: refFiles[index],
          mimeType: reference.type,
          data: dataUrlToBuffer(reference.dataUrl).buffer
        })),
        ...project.wardrobeReferences.map((reference, index) => ({
          name: wardrobeFiles[index],
          mimeType: reference.type,
          data: dataUrlToBuffer(reference.dataUrl).buffer
        }))
      ];
      chatGptAutomation = await automateRelayBatch(
        event,
        automationSettings,
        project.projectName,
        finalPromptText,
        relayAttachments,
        generationCount ?? settings.chatGptBatchCount ?? 1,
        targetDimensions
      );
    } else if ((automationSettings.chatGptAutomationMode || 'manual') !== 'manual') {
      chatGptAutomation = await automateChatGptBatch(
        event,
        automationSettings,
        project.projectName,
        finalPromptText,
        automationFilePaths,
        generationCount ?? settings.chatGptBatchCount ?? 1,
        targetDimensions
      );
    }
    if (chatGptAutomation) {
      const providerWindow = webAiProvider === 'gemini' ? geminiWindow : chatGptWindow;
      chatGptOpened = generationProvider === 'relay'
        ? false
        : chatGptAutomation.ok || Boolean(providerWindow && !providerWindow.isDestroyed());
    }

    return {
      ok: true,
      exportDir,
      copied,
      chatGptOpened,
      exportFolderOpened,
      promptText: finalPromptText,
      files: [
        mainName,
        circleName,
        ...refFiles,
        ...wardrobeFiles,
        promptTxtName,
        promptMdName,
        guideName,
        manifestName,
        projectJsonName,
        zipName
      ],
      chatGptAutomation
    };
  });

  registerTrustedIpcHandler('api:generate', async (_event, payload?: {
    prompt?: string;
    apiKey?: string;
    model?: string;
    size?: string;
    targetDimensions?: { width?: number; height?: number };
  }) => {
    const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';
    const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
    const model = typeof payload?.model === 'string' ? payload.model.trim() : '';
    const requestedSize = typeof payload?.size === 'string' ? payload.size.trim() : '';
    if (!apiKey) return { ok: false, error: '未填写 API Key。' };
    if (apiKey.length > 4096) return { ok: false, error: 'API Key 格式无效。' };
    if (!prompt) return { ok: false, error: '提示词为空。' };
    if (prompt.length > 200_000) return { ok: false, error: '提示词过长，已停止 API 生成。' };
    if (model.length > 128 || requestedSize.length > 64) return { ok: false, error: 'API 模型或尺寸参数无效。' };
    try {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          model: model || 'gpt-image-2',
          prompt,
          size: requestedSize || '1024x1024'
        })
      });
      const json = await response.json();
      if (!response.ok) return { ok: false, error: json.error?.message || 'API 调用失败。' };
      const item = json.data?.[0];
      let sourceDataUrl = typeof item?.b64_json === 'string' ? `data:image/png;base64,${item.b64_json}` : '';
      if (!sourceDataUrl && typeof item?.url === 'string') {
        const remoteUrl = new URL(item.url);
        if (remoteUrl.protocol !== 'https:') return { ok: false, error: '接口返回了不安全的图片地址。' };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90_000);
        try {
          const imageResponse = await fetch(remoteUrl, { signal: controller.signal });
          if (!imageResponse.ok) return { ok: false, error: `下载 API 图片失败（HTTP ${imageResponse.status}）。` };
          const mime = (imageResponse.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
          if (!mime.startsWith('image/')) return { ok: false, error: '接口返回的内容不是图片。' };
          const buffer = Buffer.from(await imageResponse.arrayBuffer());
          if (!buffer.length || buffer.length > 160 * 1024 * 1024) return { ok: false, error: 'API 图片为空或超过安全处理上限。' };
          sourceDataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
        } finally {
          clearTimeout(timeoutId);
        }
      }
      if (!sourceDataUrl) return { ok: false, error: '接口没有返回图片。' };
      const requestedTarget = payload?.targetDimensions;
      const width = Math.round(Number(requestedTarget?.width));
      const height = Math.round(Number(requestedTarget?.height));
      let targetDimensions = width > 0 && width <= 32768 && height > 0 && height <= 32768 ? { width, height } : undefined;
      if (!targetDimensions) {
        const decoded = nativeImage.createFromBuffer(dataUrlToBuffer(sourceDataUrl).buffer);
        if (decoded.isEmpty()) return { ok: false, error: 'API 图片无法解码。' };
        targetDimensions = decoded.getSize();
      }
      const normalized = normalizeImageDataUrlToJpeg(sourceDataUrl, targetDimensions);
      return {
        ok: true,
        imageUrl: `data:image/jpeg;base64,${normalized.buffer.toString('base64')}`,
        width: normalized.width,
        height: normalized.height,
        size: normalized.buffer.length
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '网络错误。' };
    }
  });

  registerTrustedIpcHandler(
    'api:warm-vision-model',
    async (_event, payload: { provider?: AnalysisProvider; baseUrl?: string; model?: string }): Promise<VisionModelHealthResult> => {
      if ((payload.provider || 'ollama') === 'chatgpt') return { ok: true, model: 'ChatGPT 内置窗口', installedModels: ['ChatGPT 内置窗口'] };
      if (payload.provider === 'gemini') return { ok: true, model: 'Gemini 专属窗口', installedModels: ['Gemini 专属窗口'] };
      if ((payload.provider || 'ollama') !== 'ollama') return { ok: false, error: '当前不是 Ollama 模式。' };
      const baseUrl = normalizeBaseUrl(payload.baseUrl || 'http://127.0.0.1:11434');
      try {
        const installedModels = await ensureOllamaVisionModels(baseUrl);
        const candidates = selectOllamaVisionModels(installedModels, payload.model || 'auto', lastSuccessfulOllamaVisionModel);
        return {
          ok: candidates.length > 0,
          model: candidates[0]?.name,
          installedModels: candidates.map((model) => model.name),
          error: candidates.length ? undefined : 'Ollama 已启动，但没有检测到可用的视觉模型。'
        };
      } catch (error) {
        const detail = explainOllamaFailure(error instanceof Error ? error.message : String(error));
        return { ok: false, error: detail.message };
      }
    }
  );

  registerTrustedIpcHandler(
    'local-analysis:get-status',
    async (_event, payload?: { baseUrl?: string; model?: string }): Promise<LocalAnalysisModelStatus> => {
      const baseUrl = normalizeBaseUrl(payload?.baseUrl || 'http://127.0.0.1:11434');
      return getLocalAnalysisStatus(baseUrl, payload?.model || 'auto');
    }
  );

  registerTrustedIpcHandler(
    'local-analysis:prepare-model',
    async (event, payload?: { baseUrl?: string; model?: string }): Promise<LocalAnalysisModelStatus> => {
      const baseUrl = normalizeBaseUrl(payload?.baseUrl || 'http://127.0.0.1:11434');
      const status = await getLocalAnalysisStatus(baseUrl, payload?.model || 'auto');
      if (status.ready || status.state === 'service-missing') return status;
      try {
        return await pullLocalAnalysisModel(event, baseUrl, localAnalysisDefaultModel);
      } catch (error) {
        const message = explainOllamaFailure(error instanceof Error ? error.message : String(error)).message;
        const failed = localAnalysisStatus('error', message);
        if (!event.sender.isDestroyed()) event.sender.send('local-analysis:model-progress', failed);
        return failed;
      }
    }
  );

  async function loadDoubaoAnalysisApiKey() {
    if (doubaoAnalysisApiKey) return doubaoAnalysisApiKey;
    if (!safeStorage.isEncryptionAvailable()) return '';
    try {
      const encrypted = await fs.readFile(doubaoAnalysisCredentialPath());
      const stored = JSON.parse(safeStorage.decryptString(encrypted)) as { apiKey?: unknown };
      doubaoAnalysisApiKey = typeof stored.apiKey === 'string' ? stored.apiKey.trim() : '';
      if (doubaoAnalysisApiKey) return doubaoAnalysisApiKey;
    } catch {
      doubaoAnalysisApiKey = '';
    }
    try {
      const pendingPath = path.join(appDataDir(), 'doubao-analysis-key.pending.json');
      const pending = JSON.parse(await fs.readFile(pendingPath, 'utf8')) as { apiKey?: unknown };
      const apiKey = typeof pending.apiKey === 'string' ? pending.apiKey.trim() : '';
      if (!apiKey) return '';
      await fs.writeFile(doubaoAnalysisCredentialPath(), safeStorage.encryptString(JSON.stringify({ apiKey })));
      await fs.unlink(pendingPath);
      doubaoAnalysisApiKey = apiKey;
    } catch {
      doubaoAnalysisApiKey = '';
    }
    return doubaoAnalysisApiKey;
  }

  async function doubaoVisionText(instruction: string, imageDataUrl: string, model: string) {
    const apiKey = await loadDoubaoAnalysisApiKey();
    if (!apiKey) throw new Error('豆包分析密钥尚未保存在本机。');
    const response = await fetchJsonWithTimeout(
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageDataUrl } },
              { type: 'text', text: instruction }
            ]
          }]
        })
      },
      180_000,
      '豆包分析超过 180 秒。'
    );
    if (!response.ok) {
      const message = response.json.error?.message || response.text || `HTTP ${response.status}`;
      throw new Error(String(message).slice(0, 300));
    }
    const content = response.json.choices?.[0]?.message?.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((item) => (typeof item?.text === 'string' ? item.text : '')).join('')
        : '';
    if (!text.trim()) throw new Error('豆包没有返回分析内容。');
    return text.trim();
  }

  async function analyzeMainImageWithDoubao(
    event: IpcMainInvokeEvent,
    payload: { imageDataUrl: string; model?: string },
    instruction: string
  ): Promise<MainImageAnalysisResult> {
    const model = normalizeDoubaoAnalysisModel(payload.model);
    emitMainImageAnalysisStatus(event, {
      step: '正在使用豆包分析原图',
      detail: `${model} 正在读取场景、动作、面部朝向与光影。做图仍使用当前制作通道。`,
      level: 'info',
      model
    });
    try {
      const content = await doubaoVisionText(instruction, payload.imageDataUrl, model);
      const structuredAnalysis = parseStructuredAnalysisObject(content);
      const degraded = !structuredAnalysis;
      if (degraded && !isMeaningfulUnstructuredAnalysis(content)) throw new Error('豆包没有返回可用的图像描述。');
      const analysis = structuredAnalysis || parseAnalysisObject(content);
      emitMainImageAnalysisStatus(event, {
        step: degraded ? '原图分析已用兼容模式完成' : '原图分析完成',
        detail: '豆包分析已写入原图理解。正式做图仍走 ChatGPT。',
        level: degraded ? 'warning' : 'success',
        model
      });
      return { ok: true, analysis, model, degraded, serviceReady: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '豆包原图分析失败。';
      emitMainImageAnalysisStatus(event, { step: '豆包分析未完成', detail: message, level: 'error' });
      return { ok: false, error: message };
    }
  }

  async function analyzeWebPosesWithDoubao(
    event: IpcMainInvokeEvent,
    payload: { imageDataUrl: string; model?: string }
  ): Promise<WebPoseAnalysisResult> {
    const instruction = `你是人像摄影姿势策划师。只根据附件中实际可见的画幅、人物身体范围、服装、环境和拍摄角度，提出 8 个适合当前照片的自然网感姿势。不要猜测身份，不要生成图片，不要照抄原图姿势，不要新增道具，也不要要求补出画幅外肢体。第 1-3 条变化轻微，第 4-6 条变化适中，第 7-8 条变化明显但仍适合当前画幅。每条 description 写清身体朝向、肩颈、手臂和手部、重心、头部角度、视线与遮挡关系。只返回一个 JSON 对象，不要 Markdown、代码块或解释；固定键名为 poses、id、title、description，其他内容全部使用中文；poses 恰好 8 条，id 依次为 1 到 8：{"poses":[{"id":1,"title":"姿势短标题","description":"完整姿势描述"},{"id":2,"title":"姿势短标题","description":"完整姿势描述"},{"id":3,"title":"姿势短标题","description":"完整姿势描述"},{"id":4,"title":"姿势短标题","description":"完整姿势描述"},{"id":5,"title":"姿势短标题","description":"完整姿势描述"},{"id":6,"title":"姿势短标题","description":"完整姿势描述"},{"id":7,"title":"姿势短标题","description":"完整姿势描述"},{"id":8,"title":"姿势短标题","description":"完整姿势描述"}]}`;
    const model = normalizeDoubaoAnalysisModel(payload.model);
    emitWebPoseAnalysisStatus(event, {
      step: '正在用豆包生成 8 个网感姿势',
      detail: `${model} 只负责分析，不负责生图。`,
      level: 'info'
    });
    try {
      const text = await doubaoVisionText(instruction, payload.imageDataUrl, model);
      const suggestions = parseWebPoseSuggestions(text);
      if (!suggestions) throw new Error('豆包没有返回完整的 8 条姿势。');
      emitWebPoseAnalysisStatus(event, { step: '网感姿势分析完成', detail: '已返回 8 个新姿势。', level: 'success' });
      return { ok: true, suggestions };
    } catch (error) {
      const message = error instanceof Error ? error.message : '豆包网感姿势分析失败。';
      emitWebPoseAnalysisStatus(event, { step: '网感姿势分析未完成', detail: message, level: 'error' });
      return { ok: false, error: message, errorCode: 'doubao_pose_failed' };
    }
  }

  registerTrustedIpcHandler(
    'api:analyze-web-poses',
    async (event, payload?: { provider?: AnalysisProvider; imageDataUrl?: string; baseUrl?: string; model?: string }): Promise<WebPoseAnalysisResult> => {
      if (!payload?.imageDataUrl) return { ok: false, error: '请先上传原图。', errorCode: 'missing_image' };
      if (payload.provider === 'doubao') return analyzeWebPosesWithDoubao(event, { imageDataUrl: payload.imageDataUrl, model: payload.model });
      if (payload.provider === 'ollama') return analyzeWebPosesWithOllama(event, { imageDataUrl: payload.imageDataUrl, baseUrl: payload.baseUrl, model: payload.model });
      if (payload.provider === 'gemini') return analyzeWebPosesWithGemini(event, { imageDataUrl: payload.imageDataUrl });
      return analyzeWebPosesWithChatGpt(event, { imageDataUrl: payload.imageDataUrl });
    }
  );

  registerTrustedIpcHandler(
    'api:analyze-main-image',
    async (event, payload: { provider?: AnalysisProvider; apiKey: string; imageDataUrl: string; baseUrl?: string; model?: string }) => {
    const provider = payload.provider || 'doubao';
    if (!payload.imageDataUrl) return { ok: false, error: '请先上传原图。' };
    const instruction = `你是人像照片观察员。认真观察图片，只描述实际可见内容，不猜测身份、年龄、职业等信息。
如果图片是左右拼图：左侧全图用于观察场景和身体姿态，右侧人脸特写用于观察头部角度、表情、面部光影、妆容与肤质。
必须直接在当前聊天正文中一次性返回结果，不要创建文稿、Canvas、画布、Artifact、侧边文档或代码编辑器，也不要先回复“正在分析”之类的过渡文字。
只返回一个 JSON 对象，不要 Markdown，不要代码块，不要解释，不要英文。以下五个字段都必须填写为非空中文字符串，看不清时写“以原图可见内容为准”，绝对不要照抄空模板：
{"sceneDescription":"场景描述","poseDescription":"姿态描述","faceDirectionDescription":"面部朝向描述","lightingMakeupDescription":"光影妆容描述","precisionNotes":"编辑约束"}
sceneDescription：用1到2句写可见场景、背景、构图、拍摄质感和画质。
poseDescription：用1到2句写身体朝向、肩颈姿态、手部或道具、人物与镜头距离。
faceDirectionDescription：用1到2句写头部角度、脸部朝向、下巴、眼神、表情和嘴唇状态。
lightingMakeupDescription：用3到5句写面部光源颜色与方向、额头鼻梁脸颊的亮面、眼窝鼻翼下颌的阴影、妆容浓淡、肤色、皮肤纹理、毛孔、噪点压缩痕迹和手机拍摄清晰度。按照片里实际可见的皮肤写，不要写成磨皮、通透或棚拍质感。
必须写具体可见细节：例如室内/室外、墙面/家具/镜子/窗户/地面/背景物、人物在画面中的位置、镜头距离、画幅比例、清晰度、噪点和压缩感。不要只写“室内场景”“姿态”“侧脸”“柔和光线”这类笼统短语。
precisionNotes：必须原样填写下面这句话，不要在句子外添加引号：红圈内的人脸替换要融入原图，维持红圈内原先面部光影、手机拍摄普通画质和真实皮肤质感，红圈外完全不变，不要简单把头P过去。`;

    try {
      if (provider === 'doubao') {
        return analyzeMainImageWithDoubao(event, payload, instruction);
      }

      if (provider === 'ollama') {
        return analyzeMainImageWithOllama(event, payload, instruction);
      }

      if (provider === 'chatgpt') {
        return analyzeMainImageWithChatGpt(event, payload, instruction);
      }

      if (provider === 'gemini') {
        return analyzeMainImageWithGemini(event, payload, instruction);
      }
      return { ok: false, error: '当前分析来源不可用，请选择豆包、ChatGPT、Gemini 或本地模型。' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '原图分析失败。' };
    }
  });

  void loadDoubaoAnalysisApiKey();
}

app.on('child-process-gone', (_event, details) => {
  void appendElectronRuntimeDiagnostic('electron-child-process-gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName
  });
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  await ensureRelayCredentialLoaded();
  await createWindow();
  try {
    const rawSettings = await fs.readFile(settingsPath(), 'utf8').catch(() => '{}');
    const savedSettings = sanitizeStoredSettings(JSON.parse(rawSettings));
    const startupSettings = { ...savedSettings, chatGptBrowserBackend: 'chrome' as const };
    cachedSettings = { ...cachedSettings, ...startupSettings };
    configureChatGptPersistence(startupSettings, false);
  } catch (error) {
    console.warn('[ChatGPT session] startup persistence setup failed', error instanceof Error ? error.message : String(error));
  }
  app.on('activate', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) await createWindow();
  });
});

app.on('second-instance', () => {
  void restoreMainWindowFromTray();
});

app.on('before-quit', (event) => {
  if (isFlushingBeforeQuit) return;
  event.preventDefault();
  isFlushingBeforeQuit = true;
  isAppQuitting = true;
  void flushChatGptSessionBeforeQuit()
    .catch((error) => {
      console.warn('[ChatGPT session] final flush before quit failed', error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
