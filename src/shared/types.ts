import type { WebAiProvider } from './webAiProviderPolicy.js';
import type { GenerationProvider } from './generationProviderPolicy.js';
import type { AnalysisProvider } from './analysisProviderPolicy.js';

export type ThemeMode = 'dark' | 'light' | 'system';
export type OutputMode = 'regional' | 'custom';
export type LegacyOutputMode = 'compact' | 'standard' | 'strict';
export type StoredOutputMode = OutputMode | LegacyOutputMode;
export type PromptLanguage = 'zh' | 'en' | 'bilingual';
export type ChatGptOpenMode = 'auto' | 'desktop-first' | 'browser-first' | 'browser-only';
export type SendMode = 'standard-upload' | 'regional-edit';
export type ApiProvider = AnalysisProvider;
export type MotionMode = 'full' | 'reduced' | 'off';
export type ChatGptAutomationMode = 'manual' | 'upload-review' | 'auto-send';
export type ChatGptLoginFallback = 'auto-window' | 'chrome';
export type ChatGptBrowserBackend = 'embedded' | 'chrome';
export type ChatGptParallelism = 1 | 2 | 3;
export type ChatGptWorkMode = 'quality' | 'balanced' | 'fast' | 'direct';
export type WardrobeReferenceKind = 'clothing' | 'accessory';

export interface WebPoseSuggestion {
  id: number;
  title: string;
  description: string;
}

export interface ImageAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  width?: number;
  height?: number;
  dataUrl: string;
  path?: string;
  sequence?: number;
  promptText?: string;
  dimensionWarning?: string;
  dimensionAdjustment?: string;
  createdAt?: string;
  source?: 'legacy-post-processing' | 'camera-realism' | 'face-naturalization';
}

export interface ImageImportRequest {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface NormalizedImageImport {
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  dataUrl: string;
  sourceFormat: string;
  converted: boolean;
}

export type ImageImportResult =
  | { ok: true; image: NormalizedImageImport }
  | { ok: false; error: string };

export interface CameraRealismRequest {
  projectName: string;
  image: ImageAsset;
  strength?: number;
}

export interface CameraRealismResponse {
  ok: boolean;
  image?: ImageAsset;
  error?: string;
}

export interface CameraRealismFolderItem {
  id: string;
  fileName: string;
  size: number;
  width?: number;
  height?: number;
  previewDataUrl?: string;
  status: 'ready' | 'error';
  error?: string;
}

export interface CameraRealismFolderSelection {
  canceled: boolean;
  sessionId?: string;
  sourceDir?: string;
  items?: CameraRealismFolderItem[];
  error?: string;
}

export interface CameraRealismFolderProcessResult {
  ok: boolean;
  itemId: string;
  fileName?: string;
  filePath?: string;
  outputDir?: string;
  width?: number;
  height?: number;
  error?: string;
}

export interface FaceNaturalizationRaster {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceNaturalizationRequest {
  projectName: string;
  image: ImageAsset;
  mask: FaceNaturalizationRaster;
}

export interface FaceNaturalizationResponse {
  ok: boolean;
  image?: ImageAsset;
  error?: string;
}

export interface LegacyPostProcessingRecovery {
  found: boolean;
  sourceDir: string;
  recoveredImages: ImageAsset[];
  skippedCount: number;
  needsAttention?: boolean;
  message?: string;
}

export interface MaskCircle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceOcclusionPoint {
  x: number;
  y: number;
}

export interface FaceOcclusionRaster {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceOcclusionMask {
  points: FaceOcclusionPoint[];
  raster?: FaceOcclusionRaster;
}

export interface FaceLandmarkerAssetBundle {
  model: Uint8Array;
  segmenterModel: Uint8Array;
}

export interface ReferenceImage extends ImageAsset {
  tags: string[];
  note: string;
  isPrimary: boolean;
}

export interface WardrobeReference extends ImageAsset {
  kind: WardrobeReferenceKind;
  target: string;
  tags: string[];
  note: string;
}

export interface SliderSettings {
  identitySimilarity: number;
  blendNaturalness: number;
  originalPreservation: number;
  skinRealism: number;
  makeupRestoration: number;
  outsideProtection: number;
}

export interface PromptResult {
  id: string;
  title: string;
  promptText: string;
  negativePrompt: string;
  checklist: string[];
  outputMode: StoredOutputMode;
  wordCount: number;
  createdAt: string;
  usedForSend?: boolean;
  wardrobeSignature?: string;
  webPoseSignature?: string;
}

export interface SendHistoryRecord {
  id: string;
  provider?: GenerationProvider;
  sentAt: string;
  projectName: string;
  mainImageName: string;
  circleImageName: string;
  referenceCount: number;
  wardrobeReferenceCount?: number;
  outputMode: StoredOutputMode;
  wordCount: number;
  copied: boolean;
  chatGptOpened: boolean;
  exportFolderOpened: boolean;
  exportDir: string;
  promptText: string;
  note: string;
  resultAttached: boolean;
  revisionGenerated: boolean;
}

export interface ResultArchiveItem {
  id: string;
  image: ImageAsset;
  sendHistoryId?: string;
  promptId?: string;
  sequence?: number;
  fileName?: string;
  filePath?: string;
  promptText?: string;
  addedAt: string;
  note: string;
  score: {
    identitySimilarity: number;
    blendNaturalness: number;
    outsidePreservation: number;
    lightingConsistency: number;
    skinRealism: number;
    aiFeeling: number;
  };
  needsRevision: boolean;
  success: boolean;
}

export interface AppSettings {
  acknowledgedNoticeVersion: number;
  theme: ThemeMode;
  fontSize: 'small' | 'medium' | 'large';
  defaultLanguage: PromptLanguage;
  defaultOutputMode: OutputMode;
  defaultProtectionStrength: number;
  autoSave: boolean;
  rememberRecentProjects: boolean;
  includeNegativePrompt: boolean;
  exportRedCirclePreview: boolean;
  chatGptOpenMode: ChatGptOpenMode;
  generationProvider: GenerationProvider;
  webAiProvider: WebAiProvider;
  chatGptUrl: string;
  geminiUrl: string;
  autoOpenExportFolder: boolean;
  autoCopyPrompt: boolean;
  autoExportGuide: boolean;
  chatGptAutomationMode: ChatGptAutomationMode;
  chatGptAutomationDelaySeconds: number;
  chatGptBatchCount: number;
  chatGptModel: string;
  geminiModel: string;
  chatGptParallelism: ChatGptParallelism;
  chatGptWorkMode: ChatGptWorkMode;
  chatGptLoginFallback: ChatGptLoginFallback;
  chatGptBrowserBackend: ChatGptBrowserBackend;
  chatGptKeepAliveEnabled: boolean;
  relayOriginalUnderstandingEnabled: boolean;
  apiModeEnabled: boolean;
  apiProvider: ApiProvider;
  apiBaseUrl: string;
  apiKeySessionOnly: string;
  apiModel: string;
  apiVisionModel: string;
  apiSize: string;
  apiQuality: string;
  apiCount: number;
  motionMode: MotionMode;
}

export interface ProjectState {
  softwareVersion: string;
  projectName: string;
  projectPath?: string;
  mainImage?: ImageAsset;
  maskCircle?: MaskCircle;
  faceOcclusionEnabled: boolean;
  faceOcclusionMask?: FaceOcclusionMask;
  referenceImages: ReferenceImage[];
  wardrobeReferences: WardrobeReference[];
  webPoseSuggestions: WebPoseSuggestion[];
  selectedWebPose?: WebPoseSuggestion;
  sceneDescription: string;
  poseDescription: string;
  faceDirectionDescription: string;
  lightingMakeupDescription: string;
  lockedElements: string[];
  customLockedElements: string[];
  sliders: SliderSettings;
  consentConfirmed: boolean;
  outputMode: OutputMode;
  language: PromptLanguage;
  sendMode: SendMode;
  promptDraft?: PromptResult;
  promptHistory: PromptResult[];
  sendHistory: SendHistoryRecord[];
  resultArchive: ResultArchiveItem[];
}

export interface ValidationItem {
  id: string;
  label: string;
  level: 'required' | 'recommended';
  status: 'ok' | 'warn' | 'block';
}

export interface SendPackagePayload {
  project: ProjectState;
  prompt: PromptResult;
  redCircleDataUrl: string;
  operationGuide: string;
  generationCount?: number;
}

export interface SendPackageResult {
  ok: boolean;
  exportDir: string;
  copied: boolean;
  chatGptOpened: boolean;
  exportFolderOpened: boolean;
  files: string[];
  promptText?: string;
  chatGptAutomation?: ChatGptAutomationResult;
  error?: string;
}

export interface ChatGptAutomationStatus {
  step: string;
  detail?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
  batchIndex?: number;
  batchTotal?: number;
  taskIndex?: number;
  laneId?: number;
  completedCount?: number;
  failedCount?: number;
  manualReviewCount?: number;
  pendingCount?: number;
  elapsedMs?: number;
  averageDurationMs?: number;
  cooldownUntil?: number;
  pacingMode?: 'normal' | 'balanced' | 'slow' | 'rest' | 'cooldown';
  protectionPaused?: boolean;
  effectiveParallelism?: number;
}

export interface RelayApiStatus {
  config?: import('./relayApiConfig.js').RelayApiConfig;
  configured: boolean;
  remembered: boolean;
  maskedKey?: string;
  protocolReady: boolean;
  message: string;
}

export interface RelayApiActionResult extends RelayApiStatus {
  ok: boolean;
  error?: string;
}

export interface ChatGptAutomationResultEvent {
  image: ImageAsset;
  completedCount: number;
  requestedCount: number;
  taskIndex?: number;
  laneId?: number;
}

export interface ChatGptAutomationResult {
  mode: ChatGptAutomationMode;
  ok: boolean;
  sent: boolean;
  uploaded: boolean;
  message: string;
  error?: string;
  savedImage?: ImageAsset;
  savedImages?: ImageAsset[];
  savedPath?: string;
  sequence?: number;
  resultDir?: string;
  requestedCount?: number;
  completedCount?: number;
  paused?: boolean;
  protectionPaused?: boolean;
  failedAttempts?: number;
  manualReviewCount?: number;
  taskIndex?: number;
  laneId?: number;
}

export interface ChatGptLoginStatus {
  ok: boolean;
  loggedIn: boolean;
  needsLogin: boolean;
  usable?: boolean;
  message: string;
  url?: string;
  error?: string;
  backend?: ChatGptBrowserBackend;
  recoveryAvailable?: boolean;
  recoveryReason?: string;
  recoveryAttempts?: number;
  protectionPaused?: boolean;
  provider?: WebAiProvider;
}

export type AutoSaveRecoveryStatus = 'empty' | 'loaded' | 'recovered-backup' | 'corrupt';

export interface AutoSaveReadResult {
  project: ProjectState | null;
  status: AutoSaveRecoveryStatus;
  message?: string;
  backupPath?: string;
  corruptPath?: string;
}

export interface ChatGptAutomationLifecycleEvent {
  sequence: number;
  running: boolean;
  batchIndex?: number;
  batchTotal?: number;
}

export interface ChatGptWindowActionResult {
  ok: boolean;
  message: string;
  url?: string;
  error?: string;
  backend?: ChatGptBrowserBackend;
  recoveryAvailable?: boolean;
  recoveryReason?: string;
  recoveryAttempts?: number;
}

export interface ChatGptModelOption {
  id: string;
  label: string;
  current: boolean;
}

export interface ChatGptModelCatalog {
  ok: boolean;
  currentModel?: string;
  models: ChatGptModelOption[];
  modelMode?: 'explicit' | 'automatic';
  refreshedAt: string;
  message: string;
  error?: string;
  provider?: WebAiProvider;
}

export interface MainImageAnalysis {
  sceneDescription: string;
  poseDescription: string;
  faceDirectionDescription: string;
  lightingMakeupDescription: string;
  precisionNotes: string;
}

export interface MainImageAnalysisStatus {
  step: string;
  detail?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
  model?: string;
}

export interface MainImageAnalysisResult {
  ok: boolean;
  analysis?: MainImageAnalysis;
  error?: string;
  errorCode?: string;
  model?: string;
  attemptedModels?: string[];
  fallbackUsed?: boolean;
  degraded?: boolean;
  serviceReady?: boolean;
}

export interface WebPoseAnalysisStatus {
  step: string;
  detail?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

export interface WebPoseAnalysisResult {
  ok: boolean;
  suggestions?: WebPoseSuggestion[];
  error?: string;
  errorCode?: string;
}

export interface VisionModelHealthResult {
  ok: boolean;
  model?: string;
  installedModels?: string[];
  error?: string;
}

export interface LocalAnalysisModelStatus {
  state: 'ready' | 'service-missing' | 'model-missing' | 'downloading' | 'error';
  ready: boolean;
  serviceReady: boolean;
  model?: string;
  installedModels: string[];
  message: string;
  progress?: number;
  downloadUrl?: string;
}

export interface ElectronApi {
  windowMinimize: () => Promise<boolean>;
  windowToggleMaximize: () => Promise<boolean>;
  windowClose: () => Promise<boolean>;
  saveProject: (project: ProjectState) => Promise<{ canceled: boolean; filePath?: string }>;
  importProject: () => Promise<{ canceled: boolean; project?: ProjectState; filePath?: string }>;
  exportTextFile: (payload: { defaultName: string; content: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  exportRedCircleImage: (payload: { projectName: string; dataUrl: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  applyCameraRealism: (payload: CameraRealismRequest) => Promise<CameraRealismResponse>;
  chooseCameraRealismFolder: () => Promise<CameraRealismFolderSelection>;
  processCameraRealismFolderItem: (payload: { sessionId: string; itemId: string; strength?: number }) => Promise<CameraRealismFolderProcessResult>;
  closeCameraRealismFolderSession: (sessionId: string) => Promise<boolean>;
  applyFaceNaturalization: (payload: FaceNaturalizationRequest) => Promise<FaceNaturalizationResponse>;
  createSendPackage: (payload: SendPackagePayload, settings: AppSettings) => Promise<SendPackageResult>;
  pauseChatGptBatch: () => Promise<{ ok: boolean; message: string }>;
  checkChatGptProtectionRecovery: (payload: { url: string; backend?: ChatGptBrowserBackend }) => Promise<{ ok: boolean; message: string; protectionPaused?: boolean }>;
  openExternal: (url: string) => Promise<boolean>;
  openPath: (path: string) => Promise<boolean>;
  copyText: (text: string) => Promise<boolean>;
  readRecentAutoSave: () => Promise<AutoSaveReadResult>;
  writeRecentAutoSave: (project: ProjectState) => Promise<boolean>;
  loadFaceLandmarkerAssets: () => Promise<FaceLandmarkerAssetBundle>;
  normalizeImageImport: (payload: ImageImportRequest) => Promise<ImageImportResult>;
  readSettings: () => Promise<Partial<AppSettings>>;
  writeSettings: (settings: AppSettings) => Promise<boolean>;
  getRelayApiStatus: () => Promise<RelayApiStatus>;
  configureRelayApiKey: (payload: { apiKey: string; remember: boolean; config: import('./relayApiConfig.js').RelayApiConfig }) => Promise<RelayApiActionResult>;
  clearRelayApiKey: () => Promise<RelayApiActionResult>;
  testRelayApiConnection: (payload: { model: string }) => Promise<RelayApiActionResult>;
  recoverLegacyPostProcessingResults: () => Promise<LegacyPostProcessingRecovery>;
  checkChatGptLogin: (payload: { url: string; fallbackToChrome?: boolean; openMode?: ChatGptOpenMode; openExternal?: boolean; backend?: ChatGptBrowserBackend }) => Promise<ChatGptLoginStatus>;
  showChatGptWindow: (payload: { url: string; openMode?: ChatGptOpenMode; backend?: ChatGptBrowserBackend }) => Promise<ChatGptWindowActionResult>;
  recoverChatGptWindow: (payload: { url: string; openMode?: ChatGptOpenMode; backend?: ChatGptBrowserBackend }) => Promise<ChatGptWindowActionResult>;
  listChatGptModels: (payload: { url: string; backend?: ChatGptBrowserBackend }) => Promise<ChatGptModelCatalog>;
  checkWebAiLogin: (payload: { provider: WebAiProvider; url: string; backend?: ChatGptBrowserBackend; reconcileProtection?: boolean }) => Promise<ChatGptLoginStatus>;
  showWebAiWindow: (payload: { provider: WebAiProvider; url: string; backend?: ChatGptBrowserBackend }) => Promise<ChatGptWindowActionResult>;
  recoverWebAiWindow: (payload: { provider: WebAiProvider; url: string; backend?: ChatGptBrowserBackend }) => Promise<ChatGptWindowActionResult>;
  listWebAiModels: (payload: { provider: WebAiProvider; url: string; backend?: ChatGptBrowserBackend }) => Promise<ChatGptModelCatalog>;
  apiGenerate: (payload: {
    prompt: string;
    apiKey: string;
    model: string;
    size: string;
    targetDimensions?: { width: number; height: number };
  }) => Promise<{ ok: boolean; imageUrl?: string; width?: number; height?: number; size?: number; error?: string }>;
  apiWarmVisionModel: (payload: { provider: ApiProvider; baseUrl?: string; model?: string }) => Promise<VisionModelHealthResult>;
  getLocalAnalysisModelStatus: (payload: { baseUrl?: string; model?: string }) => Promise<LocalAnalysisModelStatus>;
  prepareLocalAnalysisModel: (payload: { baseUrl?: string; model?: string }) => Promise<LocalAnalysisModelStatus>;
  apiAnalyzeMainImage: (payload: {
    provider: ApiProvider;
    apiKey: string;
    imageDataUrl: string;
    baseUrl?: string;
    model?: string;
  }) => Promise<MainImageAnalysisResult>;
  apiAnalyzeWebPoses: (payload: { provider: ApiProvider; imageDataUrl: string; baseUrl?: string; model?: string }) => Promise<WebPoseAnalysisResult>;
  onMainImageAnalysisStatus: (callback: (status: MainImageAnalysisStatus) => void) => () => void;
  onWebPoseAnalysisStatus: (callback: (status: WebPoseAnalysisStatus) => void) => () => void;
  onLocalAnalysisModelProgress: (callback: (status: LocalAnalysisModelStatus) => void) => () => void;
  onChatGptAutomationStatus: (callback: (status: ChatGptAutomationStatus) => void) => () => void;
  onChatGptAutomationLifecycle: (callback: (event: ChatGptAutomationLifecycleEvent) => void) => () => void;
  onChatGptAutomationResult: (callback: (result: ChatGptAutomationResultEvent) => void) => () => void;
  onChatGptBrowserBackendChanged: (callback: (backend: ChatGptBrowserBackend) => void) => () => void;
  onChatGptLoginStatusChanged: (callback: (status: ChatGptLoginStatus) => void) => () => void;
}
