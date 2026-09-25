import { create } from 'zustand';
import type { AppSettings } from '../../shared/types';

export const defaultSettings: AppSettings = {
  acknowledgedNoticeVersion: 0,
  theme: 'dark',
  fontSize: 'medium',
  defaultLanguage: 'zh',
  defaultOutputMode: 'regional',
  defaultProtectionStrength: 10,
  autoSave: true,
  rememberRecentProjects: true,
  includeNegativePrompt: true,
  exportRedCirclePreview: true,
  chatGptOpenMode: 'auto',
  generationProvider: 'relay',
  webAiProvider: 'chatgpt',
  chatGptUrl: 'https://chatgpt.com/',
  geminiUrl: 'https://gemini.google.com/app',
  autoOpenExportFolder: false,
  autoCopyPrompt: true,
  autoExportGuide: true,
  chatGptAutomationMode: 'auto-send',
  chatGptAutomationDelaySeconds: 0,
  chatGptBatchCount: 1,
  chatGptModel: 'follow-current',
  geminiModel: 'follow-current',
  chatGptParallelism: 1,
  chatGptWorkMode: 'quality',
  chatGptLoginFallback: 'auto-window',
  chatGptBrowserBackend: 'chrome',
  chatGptKeepAliveEnabled: true,
  relayOriginalUnderstandingEnabled: false,
  apiModeEnabled: false,
  apiProvider: 'ollama',
  apiBaseUrl: 'http://127.0.0.1:11434',
  apiKeySessionOnly: '',
  apiModel: 'gpt-image-2',
  apiVisionModel: 'auto',
  apiSize: '1024x1024',
  apiQuality: 'auto',
  apiCount: 1,
  motionMode: 'full'
};

interface SettingsStore {
  settings: AppSettings;
  setSettings: (settings: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: defaultSettings,
  setSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } }))
}));
