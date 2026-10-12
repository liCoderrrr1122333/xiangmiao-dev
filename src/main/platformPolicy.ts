import path from 'node:path';
import { existsSync } from 'node:fs';

export type SupportedDesktopPlatform = NodeJS.Platform;

export interface BrowserExecutableCandidate {
  path: string;
  label: 'Chrome' | 'Edge';
}

function isAbsoluteForPlatform(platform: SupportedDesktopPlatform, value: string) {
  return platform === 'win32' ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
}

export function preferredAppDataDirectory(
  platform: SupportedDesktopPlatform,
  explicitDirectory = '',
  developmentDirectory = '',
  legacyDirectory = ''
) {
  const override = explicitDirectory.trim() || developmentDirectory.trim();
  if (override) {
    if (!isAbsoluteForPlatform(platform, override)) throw new Error('XIANGMAO_USER_DATA_DIR 必须是绝对路径。');
    return override;
  }
  if (legacyDirectory && existsSync(legacyDirectory)) return legacyDirectory;
  // Existing Windows installations used this fixed data root; keep it when present.
  if (platform === 'win32' && existsSync('D:\\Yaochuang-Workshop\\AppData')) {
    return 'D:\\Yaochuang-Workshop\\AppData';
  }
  return platform === 'win32' ? 'D:\\Xiangmao-Workshop\\AppData' : undefined;
}

export function browserExecutableCandidates(
  platform: SupportedDesktopPlatform,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv = process.env
): BrowserExecutableCandidate[] {
  if (platform === 'darwin') {
    return [
      { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', label: 'Chrome' },
      { path: path.posix.join(homeDirectory, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), label: 'Chrome' },
      { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', label: 'Edge' },
      { path: path.posix.join(homeDirectory, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), label: 'Edge' }
    ];
  }
  if (platform !== 'win32') return [];
  return [
    {
      path: path.win32.join(environment.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      label: 'Chrome'
    },
    {
      path: path.win32.join(environment['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      label: 'Chrome'
    },
    {
      path: path.win32.join(environment.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      label: 'Chrome'
    },
    {
      path: path.win32.join(environment['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      label: 'Edge'
    },
    {
      path: path.win32.join(environment.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
      label: 'Edge'
    },
    {
      path: path.win32.join(environment.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
      label: 'Edge'
    }
  ];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function managedDarwinBrowserProcessIds(processList: string, profileDirectory: string) {
  const profile = profileDirectory.replace(/\/+$/, '');
  const profilePattern = new RegExp(
    `--user-data-dir=(?:"${escapeRegex(profile)}"|'${escapeRegex(profile)}'|${escapeRegex(profile)})(?:\\s|$)`
  );
  const ids = processList
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .filter((match) => /Google Chrome|Microsoft Edge/.test(match[2]) && profilePattern.test(match[2]))
    .map((match) => Number(match[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid);
  return [...new Set(ids)];
}
