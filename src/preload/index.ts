import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  CameraRealismRequest,
  CameraRealismResponse,
  CameraRealismFolderProcessResult,
  CameraRealismFolderSelection,
  FaceNaturalizationRequest,
  FaceNaturalizationResponse,
  ChatGptBrowserBackend,
  ChatGptAutomationLifecycleEvent,
  ChatGptAutomationResultEvent,
  ChatGptAutomationStatus,
  ChatGptLoginStatus,
  FaceLandmarkerAssetBundle,
  ImageImportRequest,
  ImageImportResult,
  LocalAnalysisModelStatus,
  MainImageAnalysisStatus,
  ProjectState,
  RelayApiActionResult,
  RelayApiStatus,
  SendPackagePayload,
  WebPoseAnalysisStatus
} from '../shared/types.js';
import type { AnalysisProvider } from '../shared/analysisProviderPolicy.js';
import type { WebAiProvider } from '../shared/webAiProviderPolicy.js';

contextBridge.exposeInMainWorld('masklock', {
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  saveProject: (project: ProjectState) => ipcRenderer.invoke('project:save', project),
  importProject: () => ipcRenderer.invoke('project:import'),
  exportTextFile: (payload: { defaultName: string; content: string }) => ipcRenderer.invoke('export:text', payload),
  exportRedCircleImage: (payload: { projectName: string; dataUrl: string }) => ipcRenderer.invoke('export:red-circle', payload),
  applyCameraRealism: (payload: CameraRealismRequest): Promise<CameraRealismResponse> => ipcRenderer.invoke('result:camera-realism', payload),
  chooseCameraRealismFolder: (): Promise<CameraRealismFolderSelection> => ipcRenderer.invoke('camera-realism:choose-folder'),
  processCameraRealismFolderItem: (payload: { sessionId: string; itemId: string; strength?: number }): Promise<CameraRealismFolderProcessResult> => ipcRenderer.invoke('camera-realism:process-folder-item', payload),
  closeCameraRealismFolderSession: (sessionId: string): Promise<boolean> => ipcRenderer.invoke('camera-realism:close-folder-session', sessionId),
  applyFaceNaturalization: (payload: FaceNaturalizationRequest): Promise<FaceNaturalizationResponse> => ipcRenderer.invoke('result:face-naturalization', payload),
  createSendPackage: (payload: SendPackagePayload, settings: AppSettings) => ipcRenderer.invoke('send:create-package', payload, settings),
  pauseChatGptBatch: () => ipcRenderer.invoke('chatgpt:pause-batch'),
  checkChatGptProtectionRecovery: (payload: { url: string; backend?: ChatGptBrowserBackend }) => ipcRenderer.invoke('chatgpt:check-protection-recovery', payload),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  readRecentAutoSave: () => ipcRenderer.invoke('autosave:read'),
  writeRecentAutoSave: (project: ProjectState) => ipcRenderer.invoke('autosave:write', project),
  loadFaceLandmarkerAssets: (): Promise<FaceLandmarkerAssetBundle> => ipcRenderer.invoke('face-landmarker:load-assets'),
  normalizeImageImport: (payload: ImageImportRequest): Promise<ImageImportResult> =>
    ipcRenderer.invoke('image:normalize-import', payload),
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:write', settings),
  getRelayApiStatus: (): Promise<RelayApiStatus> => ipcRenderer.invoke('relay:get-status'),
  configureRelayApiKey: (payload: { apiKey: string; remember: boolean; config: import('../shared/relayApiConfig.js').RelayApiConfig }): Promise<RelayApiActionResult> =>
    ipcRenderer.invoke('relay:configure-key', payload),
  clearRelayApiKey: (): Promise<RelayApiActionResult> => ipcRenderer.invoke('relay:clear-key'),
  testRelayApiConnection: (payload: { model: string }): Promise<RelayApiActionResult> =>
    ipcRenderer.invoke('relay:test-connection', payload),
  recoverLegacyPostProcessingResults: () => ipcRenderer.invoke('legacy-results:recover-post-processing'),
  checkChatGptLogin: (payload: { url: string; fallbackToChrome?: boolean; openMode?: AppSettings['chatGptOpenMode']; openExternal?: boolean; backend?: ChatGptBrowserBackend }) => ipcRenderer.invoke('chatgpt:check-login', payload),
  showChatGptWindow: (payload: { url: string; openMode?: AppSettings['chatGptOpenMode']; backend?: ChatGptBrowserBackend }) => ipcRenderer.invoke('chatgpt:show-window', payload),
  recoverChatGptWindow: (payload: { url: string; openMode?: AppSettings['chatGptOpenMode']; backend?: ChatGptBrowserBackend }) => ipcRenderer.invoke('chatgpt:recover-window', payload),
  listChatGptModels: (payload: { url: string; backend?: ChatGptBrowserBackend }) => ipcRenderer.invoke('chatgpt:list-models', payload),
  checkWebAiLogin: (payload: { provider: WebAiProvider; url: string; backend?: ChatGptBrowserBackend; reconcileProtection?: boolean }) => ipcRenderer.invoke('web-ai:check-login', payload),
  showWebAiWindow: (payload: { provider: WebAiProvider; url: string; backend?: ChatGptBrowserBackend }) => ipcRenderer.invoke('web-ai:show-window', payload),
  recoverWebAiWindow: (payload: { provider: WebAiProvider; url: string; backend?: ChatGptBrowserBackend }) => ipcRenderer.invoke('web-ai:recover-window', payload),
  listWebAiModels: (payload: { provider: WebAiProvider; url: string; backend?: ChatGptBrowserBackend }) => ipcRenderer.invoke('web-ai:list-models', payload),
  apiGenerate: (payload: {
    prompt: string;
    apiKey: string;
    model: string;
    size: string;
    targetDimensions?: { width: number; height: number };
  }) => ipcRenderer.invoke('api:generate', payload),
  apiWarmVisionModel: (payload: { provider: AnalysisProvider; baseUrl?: string; model?: string }) => ipcRenderer.invoke('api:warm-vision-model', payload),
  getLocalAnalysisModelStatus: (payload: { baseUrl?: string; model?: string }): Promise<LocalAnalysisModelStatus> => ipcRenderer.invoke('local-analysis:get-status', payload),
  prepareLocalAnalysisModel: (payload: { baseUrl?: string; model?: string }): Promise<LocalAnalysisModelStatus> => ipcRenderer.invoke('local-analysis:prepare-model', payload),
  apiAnalyzeMainImage: (payload: { provider: AnalysisProvider; apiKey: string; imageDataUrl: string; baseUrl?: string; model?: string }) =>
    ipcRenderer.invoke('api:analyze-main-image', payload),
  apiAnalyzeWebPoses: (payload: { provider: AnalysisProvider; imageDataUrl: string; baseUrl?: string; model?: string }) => ipcRenderer.invoke('api:analyze-web-poses', payload),
  onMainImageAnalysisStatus: (callback: (status: MainImageAnalysisStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: MainImageAnalysisStatus) => callback(status);
    ipcRenderer.on('main-image-analysis:status', listener);
    return () => ipcRenderer.removeListener('main-image-analysis:status', listener);
  },
  onChatGptAutomationStatus: (callback: (status: ChatGptAutomationStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ChatGptAutomationStatus) => callback(status);
    ipcRenderer.on('chatgpt-automation:status', listener);
    return () => ipcRenderer.removeListener('chatgpt-automation:status', listener);
  },
  onWebPoseAnalysisStatus: (callback: (status: WebPoseAnalysisStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: WebPoseAnalysisStatus) => callback(status);
    ipcRenderer.on('web-pose-analysis:status', listener);
    return () => ipcRenderer.removeListener('web-pose-analysis:status', listener);
  },
  onLocalAnalysisModelProgress: (callback: (status: LocalAnalysisModelStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: LocalAnalysisModelStatus) => callback(status);
    ipcRenderer.on('local-analysis:model-progress', listener);
    return () => ipcRenderer.removeListener('local-analysis:model-progress', listener);
  },
  onChatGptAutomationLifecycle: (callback: (event: ChatGptAutomationLifecycleEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, lifecycle: ChatGptAutomationLifecycleEvent) => callback(lifecycle);
    ipcRenderer.on('chatgpt-automation:lifecycle', listener);
    return () => ipcRenderer.removeListener('chatgpt-automation:lifecycle', listener);
  },
  onChatGptAutomationResult: (callback: (result: ChatGptAutomationResultEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: ChatGptAutomationResultEvent) => callback(result);
    ipcRenderer.on('chatgpt-automation:result', listener);
    return () => ipcRenderer.removeListener('chatgpt-automation:result', listener);
  },
  onChatGptBrowserBackendChanged: (callback: (backend: ChatGptBrowserBackend) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, backend: ChatGptBrowserBackend) => callback(backend);
    ipcRenderer.on('chatgpt-browser:backend-changed', listener);
    return () => ipcRenderer.removeListener('chatgpt-browser:backend-changed', listener);
  },
  onChatGptLoginStatusChanged: (callback: (status: ChatGptLoginStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ChatGptLoginStatus) => callback(status);
    ipcRenderer.on('chatgpt-login:status-changed', listener);
    return () => ipcRenderer.removeListener('chatgpt-login:status-changed', listener);
  }
});
