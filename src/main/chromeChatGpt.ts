import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import CDP from 'chrome-remote-interface';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { browserExecutableCandidates, managedDarwinBrowserProcessIds } from './platformPolicy.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ChromeChatGptMode = 'visible' | 'background';

export interface ChatGptDebuggerLike {
  isAttached: () => boolean;
  attach: (protocolVersion?: string) => void;
  detach: () => void;
  sendCommand: (method: string, commandParams?: Record<string, unknown>) => Promise<unknown>;
}

export interface ChatGptSessionLike {
  fetch: (
    input: string | URL,
    init?: RequestInit & {
      referrer?: string;
    }
  ) => Promise<Response>;
}

export interface ChatGptWebContentsLike {
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>;
  getURL: () => string;
  isLoading: () => boolean;
  once: (event: 'did-finish-load', listener: (...args: unknown[]) => void) => unknown;
  debugger: ChatGptDebuggerLike;
  session: ChatGptSessionLike;
}

export interface ChatGptWindowLike {
  readonly webContents: ChatGptWebContentsLike;
  readonly browserLabel?: 'Chrome' | 'Edge';
  readonly mode?: ChromeChatGptMode;
  loadURL: (url: string) => Promise<unknown>;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  restore: () => void;
  minimize: () => void;
  hide: () => void;
  show: () => void;
  showInactive: () => void;
  focus: () => void;
  flashFrame: (flag: boolean) => void;
  setFocusable: (focusable: boolean) => void;
  waitForVisibility?: () => Promise<boolean>;
  createTab?: (url: string) => Promise<ChatGptWindowLike>;
  on: (event: 'close' | 'closed', listener: (...args: unknown[]) => void) => unknown;
  close: () => void;
  destroy: () => void;
}

interface ChromeChatGptOptions {
  profileDir: string;
  url: string;
  mode: ChromeChatGptMode;
  port?: number;
  onDiagnostic?: (event: string, payload: Record<string, unknown>) => void | Promise<void>;
}

interface ChromeExecutable {
  path: string;
  label: 'Chrome' | 'Edge';
}

interface ChromePageTarget {
  id: string;
  url: string;
}

export interface ChatGptPageTargetCandidate extends ChromePageTarget {
  visible?: boolean;
  composerReady?: boolean;
  bodyTextLength?: number;
}

interface ChromeProtocolClient {
  send: <T = unknown>(method: string, commandParams?: Record<string, unknown>) => Promise<T>;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  close: () => Promise<void>;
}

const managedPortFileName = 'XiangmaoDevToolsPort';
const managedModeFileName = 'XiangmaoChromeMode';
const managedPidFileName = 'XiangmaoChromePid';
const chromeDevToolsActivePortFileName = 'DevToolsActivePort';
const profileLockFileNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
const chromeStartupAttemptsPerBrowser = 2;
const chromeFixedPortStartupTimeoutMs = 15000;
const chromePipeStartupTimeoutMs = 30000;

export class ChromeChatGptStartupError extends Error {
  readonly code = 'XIANGMAO_CHROME_STARTUP_FAILED';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ChromeChatGptStartupError';
  }
}

function encodePowerShellCommand(command: string) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function findPowerShellExecutable() {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windowsRoot, 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
    path.join(windowsRoot, 'Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe')
  ];
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || 'powershell.exe';
}

async function setNativeBrowserWindowVisibility(
  profileDir: string,
  browserLabel: ChromeExecutable['label'],
  visible: boolean
) {
  if (process.platform !== 'win32') return true;
  const executableName = browserLabel === 'Chrome' ? 'chrome.exe' : 'msedge.exe';
  const escapedProfile = profileDir.replace(/'/g, "''");
  const showCommand = visible
    ? `
    [NativeWindow]::ShowWindow($handle, 9) | Out-Null
    $windowRect = New-Object NativeWindow+RECT
    $workArea = New-Object NativeWindow+RECT
    if (
      [NativeWindow]::GetWindowRect($handle, [ref]$windowRect) -and
      [NativeWindow]::SystemParametersInfo(0x0030, 0, [ref]$workArea, 0)
    ) {
      $workWidth = [Math]::Max(1, $workArea.Right - $workArea.Left)
      $workHeight = [Math]::Max(1, $workArea.Bottom - $workArea.Top)
      $windowWidth = [Math]::Max(1, $windowRect.Right - $windowRect.Left)
      $windowHeight = [Math]::Max(1, $windowRect.Bottom - $windowRect.Top)
      $visibleWidth = [Math]::Max(
        0,
        [Math]::Min($windowRect.Right, $workArea.Right) - [Math]::Max($windowRect.Left, $workArea.Left)
      )
      $visibleHeight = [Math]::Max(
        0,
        [Math]::Min($windowRect.Bottom, $workArea.Bottom) - [Math]::Max($windowRect.Top, $workArea.Top)
      )
      $titleBarVisible =
        $windowRect.Top -ge $workArea.Top -and
        $windowRect.Top -lt ($workArea.Bottom - 48) -and
        $windowRect.Left -lt ($workArea.Right - 160) -and
        $windowRect.Right -gt ($workArea.Left + 160)
      if ($visibleWidth -lt 320 -or $visibleHeight -lt 160 -or -not $titleBarVisible) {
        $targetWidth = [Math]::Min([Math]::Max($windowWidth, 960), [Math]::Max(640, $workWidth - 32))
        $targetHeight = [Math]::Min([Math]::Max($windowHeight, 700), [Math]::Max(480, $workHeight - 16))
        $targetX = $workArea.Left + [Math]::Max(0, [Math]::Floor(($workWidth - $targetWidth) / 2))
        $targetY = $workArea.Top + [Math]::Max(0, [Math]::Floor(($workHeight - $targetHeight) / 2))
        [NativeWindow]::SetWindowPos($handle, [IntPtr]::Zero, $targetX, $targetY, $targetWidth, $targetHeight, 0x0004) | Out-Null
      }
    }
    [NativeWindow]::ShowWindow($handle, 5) | Out-Null
    [NativeWindow]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, 0, 0, 0x0003) | Out-Null
    [NativeWindow]::BringWindowToTop($handle) | Out-Null
    [NativeWindow]::SetForegroundWindow($handle) | Out-Null
    `
    : '[NativeWindow]::ShowWindow($handle, 0) | Out-Null';
  const command = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern long GetWindowLongPtr(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action, uint parameter, ref RECT value, uint flags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$profile = [IO.Path]::GetFullPath('${escapedProfile}').TrimEnd('\\')
$pattern = '--user-data-dir="?' + [regex]::Escape($profile) + '"?(?:\\s|$)'
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  $managedPids = @(Get-CimInstance Win32_Process -Filter "Name = '${executableName}'" |
    Where-Object { [string]$_.CommandLine -match $pattern } |
    ForEach-Object { [int]$_.ProcessId })
  $allHandles = New-Object 'System.Collections.Generic.List[System.IntPtr]'
  $mainHandles = New-Object 'System.Collections.Generic.List[System.IntPtr]'
  [NativeWindow]::EnumWindows({
    param($candidate, $lParam)
    $processId = [uint32]0
    [NativeWindow]::GetWindowThreadProcessId($candidate, [ref]$processId) | Out-Null
    if ($managedPids -notcontains [int]$processId) { return $true }
    $className = New-Object System.Text.StringBuilder 128
    [NativeWindow]::GetClassName($candidate, $className, $className.Capacity) | Out-Null
    if ($className.ToString() -eq 'Chrome_WidgetWin_1') {
      $allHandles.Add($candidate)
      $windowStyle = [uint64][NativeWindow]::GetWindowLongPtr($candidate, -16)
      if (($windowStyle -band 0x00C00000) -eq 0x00C00000) {
        $mainHandles.Add($candidate)
      }
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  ${
    visible
      ? `foreach ($handle in $allHandles) {
    if (-not $mainHandles.Contains($handle)) {
      [NativeWindow]::ShowWindow($handle, 0) | Out-Null
    }
  }`
      : ''
  }
  foreach ($handle in ${visible ? '$mainHandles' : '$allHandles'}) {
    ${showCommand}
  }
  if (${visible ? '$mainHandles' : '$allHandles'}.Count -gt 0) { exit 0 }
  Start-Sleep -Milliseconds 100
}
exit 3
`;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (visibleStateApplied: boolean) => {
      if (settled) return;
      settled = true;
      resolve(visibleStateApplied);
    };
    const helper = spawn(
      findPowerShellExecutable(),
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShellCommand(command)],
      { stdio: 'ignore', windowsHide: true }
    );
    const timeout = setTimeout(() => {
      if (!helper.killed) helper.kill();
      finish(false);
    }, 5000);
    helper.once('exit', (exitCode) => {
      clearTimeout(timeout);
      finish(exitCode === 0);
    });
    helper.once('error', () => {
      clearTimeout(timeout);
      finish(false);
    });
  });
}

function findExecutablePathsFromWindows(executableName: 'chrome.exe' | 'msedge.exe') {
  if (process.platform !== 'win32') return [];
  const paths: string[] = [];
  const registryKeys = [
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`
  ];
  for (const key of registryKeys) {
    const result = spawnSync('reg.exe', ['query', key, '/ve'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.status !== 0 || !result.stdout) continue;
    const match = result.stdout.match(/REG_\w+\s+(.+?\.exe)\s*$/im);
    if (match?.[1]) paths.push(match[1].trim().replace(/^"(.*)"$/, '$1'));
  }
  const whereResult = spawnSync('where.exe', [executableName], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (whereResult.status === 0 && whereResult.stdout) {
    paths.push(
      ...whereResult.stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
    );
  }
  return paths;
}

function findChromeExecutables(): ChromeExecutable[] {
  const candidates: ChromeExecutable[] = [
    ...browserExecutableCandidates(process.platform, os.homedir()),
    ...findExecutablePathsFromWindows('chrome.exe').map(
      (executablePath): ChromeExecutable => ({ path: executablePath, label: 'Chrome' })
    ),
    ...findExecutablePathsFromWindows('msedge.exe').map(
      (executablePath): ChromeExecutable => ({ path: executablePath, label: 'Edge' })
    )
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.path.toLowerCase();
    if (!candidate.path || seen.has(key) || !fsSync.existsSync(candidate.path)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveBrowserProfileDir(profileDir: string, browserLabel: ChromeExecutable['label']) {
  if (browserLabel === 'Chrome') return profileDir;
  return path.join(path.dirname(profileDir), `${path.basename(profileDir)}-Edge`);
}

function cookieMatchesUrl(cookie: { domain: string; path: string; secure: boolean; expires: number }, targetUrl: URL) {
  const domain = cookie.domain.replace(/^\./, '').toLowerCase();
  const host = targetUrl.hostname.toLowerCase();
  return (
    (host === domain || host.endsWith(`.${domain}`)) &&
    targetUrl.pathname.startsWith(cookie.path || '/') &&
    (!cookie.secure || targetUrl.protocol === 'https:') &&
    (cookie.expires <= 0 || cookie.expires * 1000 > Date.now())
  );
}

class ChromeChatGptWindow implements ChatGptWindowLike {
  readonly webContents: ChatGptWebContentsLike;
  readonly browserLabel: ChromeExecutable['label'];
  readonly mode: ChromeChatGptMode;
  private readonly windowEvents = new EventEmitter();
  private readonly contentsEvents = new EventEmitter();
  private readonly client: ChromeProtocolClient;
  private readonly targetId: string;
  private readonly userAgent: string;
  private readonly profileDir: string;
  private readonly closeBrowser?: () => Promise<void>;
  readonly createTab?: (url: string) => Promise<ChatGptWindowLike>;
  private chromeProcess?: ChildProcess;
  private currentUrl: string;
  private loading = false;
  private minimized: boolean;
  private destroyed = false;
  private closedEmitted = false;
  private visibilityGeneration = 0;
  private visibilityTask: Promise<boolean> = Promise.resolve(true);

  constructor(
    client: ChromeProtocolClient,
    target: ChromePageTarget,
    browserLabel: ChromeExecutable['label'],
    mode: ChromeChatGptMode,
    userAgent: string,
    profileDir: string,
    chromeProcess?: ChildProcess,
    closeBrowser?: () => Promise<void>,
    createTab?: (url: string) => Promise<ChatGptWindowLike>
  ) {
    this.client = client;
    this.targetId = target.id;
    this.browserLabel = browserLabel;
    this.mode = mode;
    this.userAgent = userAgent;
    this.profileDir = profileDir;
    this.chromeProcess = chromeProcess;
    this.closeBrowser = closeBrowser;
    this.createTab = createTab;
    this.currentUrl = target.url;
    this.minimized = mode === 'background';

    const debuggerAdapter: ChatGptDebuggerLike = {
      isAttached: () => !this.destroyed,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: (method, commandParams = {}) => this.client.send(method, commandParams)
    };

    const sessionAdapter: ChatGptSessionLike = {
      fetch: async (input, init = {}) => {
        const targetUrl = new URL(String(input));
        const cookieResult = await this.client.send<{
          cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; expires: number }>;
        }>('Storage.getCookies');
        const cookieHeader = cookieResult.cookies
          .filter((cookie) => cookieMatchesUrl(cookie, targetUrl))
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join('; ');
        const headers = new Headers(init.headers);
        if (cookieHeader) headers.set('Cookie', cookieHeader);
        if (!headers.has('User-Agent')) headers.set('User-Agent', this.userAgent);
        if (init.referrer && !headers.has('Referer')) headers.set('Referer', init.referrer);
        const { referrer: _referrer, ...fetchInit } = init;
        return fetch(targetUrl, { ...fetchInit, headers });
      }
    };

    this.webContents = {
      executeJavaScript: async <T>(code: string, userGesture = false) => {
        const result = await this.client.send<{
          result: { value?: T };
          exceptionDetails?: {
            exception?: { description?: string };
            text?: string;
          };
        }>('Runtime.evaluate', {
          expression: code,
          awaitPromise: true,
          returnByValue: true,
          userGesture
        });
        if (result.exceptionDetails) {
          const message =
            result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text ||
            'Chrome page script failed.';
          throw new Error(message);
        }
        return result.result.value as T;
      },
      getURL: () => this.currentUrl,
      isLoading: () => this.loading,
      once: (event, listener) => {
        this.contentsEvents.once(event, listener);
        return this.webContents;
      },
      debugger: debuggerAdapter,
      session: sessionAdapter
    };

    this.client.on('Page.frameStartedLoading', () => {
      this.loading = true;
    });
    this.client.on('Page.frameNavigated', ({ frame }: { frame: { parentId?: string; url: string } }) => {
      if (!frame.parentId) this.currentUrl = frame.url;
    });
    const markPageLoaded = () => {
      this.loading = false;
      this.contentsEvents.emit('did-finish-load');
    };
    this.client.on('Page.domContentEventFired', markPageLoaded);
    this.client.on('Page.loadEventFired', markPageLoaded);
    this.client.on('disconnect', () => {
      this.destroyed = true;
      this.emitClosed();
    });
    this.chromeProcess?.once('exit', () => {
      this.destroyed = true;
      this.emitClosed();
    });
  }

  async initialize() {
    await Promise.all([
      this.client.send('Page.enable'),
      this.client.send('Runtime.enable'),
      this.client.send('DOM.enable'),
      this.client.send('Storage.getCookies')
    ]);
    if (this.mode === 'visible') this.show();
    else {
      this.minimized = true;
      if (process.platform === 'darwin') {
        await this.setWindowState('minimized').catch(() => undefined);
      } else {
        await setNativeBrowserWindowVisibility(this.profileDir, this.browserLabel, false);
      }
    }
  }

  async loadURL(url: string) {
    if (this.destroyed) throw new Error('Dedicated Chrome is already closed.');
    this.loading = true;
    const loaded = new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 15000);
      this.contentsEvents.once('did-finish-load', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const result = await this.client.send<{ errorText?: string }>('Page.navigate', { url });
    if (result.errorText) throw new Error(`Dedicated Chrome navigation failed: ${result.errorText}`);
    await loaded;
    this.currentUrl = await this.webContents.executeJavaScript<string>('location.href', true).catch(() => url);
    return true;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isMinimized() {
    return this.minimized;
  }

  isVisible() {
    return !this.minimized && !this.destroyed;
  }

  restore() {
    this.show();
  }

  minimize() {
    this.hide();
  }

  hide() {
    this.minimized = true;
    this.queueVisibility(false);
  }

  show() {
    if (this.destroyed) return;
    this.minimized = false;
    this.queueVisibility(true);
  }

  showInactive() {
    this.show();
  }

  focus() {
    this.show();
  }

  flashFrame(_flag: boolean) {
    // CDP does not expose taskbar flashing.
  }

  setFocusable(_focusable: boolean) {
    // The visible real browser must remain focusable for login challenges.
  }

  waitForVisibility() {
    return this.visibilityTask;
  }

  on(event: 'close' | 'closed', listener: (...args: unknown[]) => void) {
    this.windowEvents.on(event, listener);
    return this;
  }

  close() {
    if (this.destroyed) return;
    this.windowEvents.emit('close');
    void this.shutdown();
  }

  destroy() {
    this.close();
  }

  private async setWindowState(windowState: 'normal' | 'minimized') {
    if (this.destroyed) return;
    const { windowId } = await this.client.send<{ windowId: number }>('Browser.getWindowForTarget', {
      targetId: this.targetId
    });
    await this.client.send('Browser.setWindowBounds', { windowId, bounds: { windowState } });
  }

  private queueVisibility(visible: boolean) {
    const generation = ++this.visibilityGeneration;
    this.visibilityTask = this.visibilityTask
      .catch(() => false)
      .then(async () => {
        if (this.destroyed || generation !== this.visibilityGeneration) return false;
        if (!visible) {
          if (process.platform === 'darwin') {
            await this.setWindowState('minimized').catch(() => undefined);
            return true;
          }
          return setNativeBrowserWindowVisibility(this.profileDir, this.browserLabel, false);
        }
        await this.setWindowState('normal').catch(() => undefined);
        if (this.destroyed || generation !== this.visibilityGeneration) return false;
        await this.client.send('Page.bringToFront').catch(() => undefined);
        if (this.destroyed || generation !== this.visibilityGeneration) return false;
        const firstReveal = await setNativeBrowserWindowVisibility(this.profileDir, this.browserLabel, true);
        if (this.destroyed || generation !== this.visibilityGeneration) return false;
        await wait(350);
        if (this.destroyed || generation !== this.visibilityGeneration) return false;
        const secondReveal = await setNativeBrowserWindowVisibility(this.profileDir, this.browserLabel, true);
        return firstReveal || secondReveal;
      })
      .catch(() => false);
  }

  private async shutdown() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visibilityGeneration += 1;
    try {
      if (this.closeBrowser) await this.closeBrowser();
      else await this.client.send('Browser.close');
    } catch {
      // The user may already have closed the dedicated browser.
    }
    try {
      await this.client.close();
    } catch {
      // Closing the browser also closes the CDP socket.
    }
    if (this.chromeProcess && !this.chromeProcess.killed) this.chromeProcess.kill();
    this.emitClosed();
  }

  notifyExternalClose() {
    this.destroyed = true;
    this.visibilityGeneration += 1;
    this.emitClosed();
  }

  private emitClosed() {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.windowEvents.emit('closed');
  }
}

function createRemoteInterfaceProtocolClient(client: CDP.Client): ChromeProtocolClient {
  return {
    send: (method, commandParams = {}) =>
      (
        client.send.bind(client) as unknown as (
          name: string,
          params?: Record<string, unknown>
        ) => Promise<unknown>
      )(method, commandParams) as Promise<any>,
    on: (event, listener) => client.on(event, listener),
    close: () => client.close()
  };
}

function createPlaywrightProtocolClient(session: CDPSession): ChromeProtocolClient {
  return {
    send: (method, commandParams = {}) => session.send(method as any, commandParams as any) as Promise<any>,
    on: (event, listener) => session.on(event as any, listener),
    close: () => session.detach().catch(() => undefined)
  };
}

function readManagedPort(profileDir: string) {
  try {
    const value = Number(fsSync.readFileSync(path.join(profileDir, managedPortFileName), 'utf8').trim());
    return Number.isInteger(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function readManagedMode(profileDir: string): ChromeChatGptMode | undefined {
  try {
    const value = fsSync.readFileSync(path.join(profileDir, managedModeFileName), 'utf8').trim();
    return value === 'visible' || value === 'background' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function buildChromeLaunchPlan(explicitPort?: number) {
  if (Number.isInteger(explicitPort) && (explicitPort as number) > 0) {
    return [
      { strategy: 'fixed' as const, requestedPort: explicitPort as number },
      { strategy: 'pipe' as const, requestedPort: undefined }
    ];
  }
  return [
    { strategy: 'pipe' as const, requestedPort: undefined },
    { strategy: 'fixed' as const, requestedPort: undefined }
  ];
}

async function findAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate a local port for dedicated Chrome.'));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForChrome(port: number, chromeProcess: ChildProcess, timeoutMs = chromeFixedPortStartupTimeoutMs) {
  const startedAt = Date.now();
  let lastError: unknown;
  let spawnError: Error | undefined;
  let earlyExit: { code: number | null; signal: NodeJS.Signals | null; at: number } | undefined;
  chromeProcess.once('error', (error) => {
    spawnError = error;
  });
  chromeProcess.once('exit', (code, signal) => {
    earlyExit = { code, signal, at: Date.now() };
  });
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await CDP.Version({ port });
    } catch (error) {
      lastError = error;
      if (spawnError) {
        throw new Error(`Dedicated browser process could not start: ${spawnError.message}`, {
          cause: spawnError
        });
      }
      if (!earlyExit && chromeProcess.exitCode !== null) {
        earlyExit = { code: chromeProcess.exitCode, signal: chromeProcess.signalCode, at: Date.now() - 1000 };
      }
      if (earlyExit && Date.now() - earlyExit.at >= 900) {
        throw new Error(
          `Dedicated browser exited before opening its local control port (code=${String(
            earlyExit.code
          )}, signal=${String(earlyExit.signal)}).`,
          { cause: error }
        );
      }
      await wait(250);
    }
  }
  throw new Error('Dedicated browser did not open its local control port before startup timed out.', {
    cause: lastError
  });
}

async function runHiddenPowerShell(command: string, timeoutMs = 12000) {
  if (process.platform !== 'win32') return { exitCode: 0, stdout: '', stderr: '' };
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
    const helper = spawn(
      findPowerShellExecutable(),
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShellCommand(command)],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    helper.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    helper.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timeout = setTimeout(() => {
      if (!helper.killed) helper.kill();
      resolve({ exitCode: null, stdout, stderr: `${stderr}\nPowerShell helper timed out.`.trim() });
    }, timeoutMs);
    helper.once('exit', (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
    helper.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
  });
}

function removeManagedFiles(profileDir: string, fileNames: string[]) {
  for (const fileName of fileNames) {
    try {
      fsSync.rmSync(path.join(profileDir, fileName), { force: true, recursive: true });
    } catch {
      // Chrome may release a profile lock slightly after its root process exits.
    }
  }
}

async function terminateManagedProfileProcesses(profileDir: string) {
  if (process.platform === 'darwin') {
    const processList = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
    if (processList.status !== 0) {
      throw new Error('Unable to inspect the dedicated browser process on macOS.');
    }
    const pids = managedDarwinBrowserProcessIds(processList.stdout || '', profileDir);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < 2500) {
      const running = pids.some((pid) => {
        try { process.kill(pid, 0); return true; } catch { return false; }
      });
      if (!running) break;
      await wait(100);
    }
    const remainingList = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
    const remaining = remainingList.status === 0
      ? managedDarwinBrowserProcessIds(remainingList.stdout || '', profileDir)
      : [];
    for (const pid of remaining) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    return pids;
  }
  if (process.platform !== 'win32') return [];
  const escapedProfile = profileDir.replace(/'/g, "''");
  const result = await runHiddenPowerShell(`
$ErrorActionPreference = 'Stop'
$profile = [IO.Path]::GetFullPath('${escapedProfile}').TrimEnd('\\')
$pattern = '--user-data-dir="?' + [regex]::Escape($profile) + '"?(?:\\s|$)'
$managed = @(Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and
    ([string]$_.CommandLine -match $pattern)
  })
$pids = @($managed | ForEach-Object { [int]$_.ProcessId })
foreach ($processId in $pids) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
if ($pids.Count -gt 0) {
  Wait-Process -Id $pids -Timeout 8 -ErrorAction SilentlyContinue
}
$pids -join ','
`);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to clean the dedicated browser process: ${result.stderr.trim() || 'unknown error'}`);
  }
  return result.stdout
    .trim()
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function stopSpawnedBrowser(chromeProcess: ChildProcess | undefined) {
  if (!chromeProcess || chromeProcess.killed || chromeProcess.exitCode !== null) return;
  chromeProcess.kill();
  const startedAt = Date.now();
  while (chromeProcess.exitCode === null && Date.now() - startedAt < 2500) {
    await wait(100);
  }
}

async function resetManagedChromeRuntime(profileDir: string) {
  try {
    const terminatedPids = await terminateManagedProfileProcesses(profileDir);
    await wait(terminatedPids.length > 0 ? 450 : 80);
    removeManagedFiles(profileDir, [
      managedPortFileName,
      managedModeFileName,
      managedPidFileName,
      chromeDevToolsActivePortFileName,
      ...profileLockFileNames
    ]);
    return terminatedPids;
  } catch (error) {
    // Metadata is safe to discard, but lock files must stay intact if process ownership is unknown.
    removeManagedFiles(profileDir, [
      managedPortFileName,
      managedModeFileName,
      managedPidFileName,
      chromeDevToolsActivePortFileName
    ]);
    throw error;
  }
}

export function scoreChatGptPageTarget(candidateUrl: string, targetUrl: string) {
  const candidate = candidateUrl.toLowerCase();
  const target = targetUrl.toLowerCase();
  const targetIsGoogle = target.includes('accounts.google.com');
  const targetIsGemini = target.includes('gemini.google.com');
  if (candidate === target) return 1000;
  if (candidate.includes('gemini.google.com')) return targetIsGemini ? 930 : targetIsGoogle ? 720 : 650;
  if (candidate.includes('chatgpt.com')) return targetIsGemini ? 650 : targetIsGoogle ? 700 : 900;
  if (candidate.includes('auth.openai.com') || candidate.includes('openai.com')) {
    return targetIsGoogle ? 800 : 850;
  }
  if (candidate.includes('accounts.google.com')) return targetIsGoogle ? 950 : 800;
  if (candidate.startsWith('devtools://') || candidate.startsWith('chrome://')) return -100;
  if (!candidate || candidate === 'about:blank') return 0;
  return 100;
}

function scoreChatGptPageTargetCandidate(
  candidate: ChatGptPageTargetCandidate,
  targetUrl: string
) {
  const base = scoreChatGptPageTarget(candidate.url, targetUrl);
  const targetIsChatGpt = targetUrl.toLowerCase().includes('chatgpt.com');
  if (!targetIsChatGpt || !candidate.url.toLowerCase().includes('chatgpt.com')) return base;
  return base +
    (candidate.composerReady ? 500 : 0) +
    (candidate.visible ? 120 : 0) +
    (Number(candidate.bodyTextLength) > 8 ? 20 : 0);
}

export function selectBestChatGptPageTargetCandidate<T extends ChatGptPageTargetCandidate>(
  candidates: T[],
  targetUrl: string
) {
  return candidates.reduce<T | undefined>((best, candidate) => {
    if (!best) return candidate;
    return scoreChatGptPageTargetCandidate(candidate, targetUrl) >
      scoreChatGptPageTargetCandidate(best, targetUrl)
      ? candidate
      : best;
  }, undefined);
}

const pageCapabilityExpression = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const composerReady = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
    .some((element) => visible(element) && !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true');
  return {
    visible: document.visibilityState === 'visible',
    composerReady,
    bodyTextLength: Math.min(100000, (document.body?.innerText || '').trim().length)
  };
})()`;

async function inspectPlaywrightPageCandidate(page: Page): Promise<ChatGptPageTargetCandidate & { page: Page }> {
  const snapshot = await page.evaluate(pageCapabilityExpression).catch(() => ({
    visible: false,
    composerReady: false,
    bodyTextLength: 0
  })) as { visible: boolean; composerReady: boolean; bodyTextLength: number };
  return { id: page.url(), url: page.url(), page, ...snapshot };
}

async function selectPlaywrightPage(pages: Page[], targetUrl: string) {
  const candidates = await Promise.all(pages.map(inspectPlaywrightPageCandidate));
  return selectBestChatGptPageTargetCandidate(candidates, targetUrl)?.page;
}

async function inspectRemotePageCandidate(port: number, target: ChromePageTarget) {
  const client = await CDP({ port, target: target.id });
  try {
    const evaluated = await client.Runtime.evaluate({
      expression: pageCapabilityExpression,
      returnByValue: true
    });
    const value = evaluated?.result?.value || {};
    return {
      ...target,
      visible: value.visible === true,
      composerReady: value.composerReady === true,
      bodyTextLength: Number(value.bodyTextLength) || 0
    } satisfies ChatGptPageTargetCandidate;
  } catch {
    return target;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function findPageTarget(port: number, targetUrl: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 18000) {
    const targets = await CDP.List({ port });
    const pageTargets = targets.filter((target) => target.type === 'page');
    const inspected = await Promise.all(
      pageTargets.map((target) => inspectRemotePageCandidate(port, { id: target.id, url: target.url }))
    );
    const selected = selectBestChatGptPageTargetCandidate(inspected, targetUrl);
    if (selected && scoreChatGptPageTarget(selected.url, targetUrl) >= 0) {
      return selected;
    }
    await CDP.New({ port, url: targetUrl }).catch(() => undefined);
    await wait(350);
  }
  throw new Error('Dedicated Chrome started, but no controllable page was found.');
}

function assertProfileDirectoryWritable(profileDir: string) {
  fsSync.mkdirSync(profileDir, { recursive: true });
  const probePath = path.join(profileDir, `.xiangmao-write-probe-${process.pid}-${Date.now()}`);
  try {
    fsSync.writeFileSync(probePath, 'ok', 'utf8');
  } finally {
    fsSync.rmSync(probePath, { force: true });
  }
}

async function launchChromeWithPipe(
  executable: ChromeExecutable,
  profileDir: string,
  options: ChromeChatGptOptions
) {
  let context: BrowserContext | undefined;
  const managedWindows = new Set<ChromeChatGptWindow>();
  const earlyHide =
    options.mode === 'background'
      ? setNativeBrowserWindowVisibility(profileDir, executable.label, false)
      : Promise.resolve(true);
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: executable.path,
      headless: false,
      viewport: null,
      chromiumSandbox: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--profile-directory=Default',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-crash-restore-bubble',
        '--disable-session-crashed-bubble',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...(process.platform === 'win32' ? ['--disable-features=CalculateNativeWinOcclusion'] : []),
        ...(options.mode === 'background' ? ['--mute-audio'] : [])
      ],
      timeout: chromePipeStartupTimeoutMs
    });
    await earlyHide;
    const wrapPage = async (page: Page, root: boolean): Promise<ChromeChatGptWindow> => {
      const session = await context!.newCDPSession(page);
      const protocolClient = createPlaywrightProtocolClient(session);
      const [version, targetInfo] = await Promise.all([
        protocolClient.send<{ userAgent?: string }>('Browser.getVersion'),
        protocolClient.send<{ targetInfo: { targetId: string; url: string } }>('Target.getTargetInfo')
      ]);
      const createTab = async (url: string) => {
        if (!context) throw new Error('Dedicated Chrome context is already closed.');
        const childPage = await context.newPage();
        const childWindow = await wrapPage(childPage, false);
        await childWindow.loadURL(url);
        return childWindow;
      };
      const window = new ChromeChatGptWindow(
        protocolClient,
        {
          id: targetInfo.targetInfo.targetId,
          url: targetInfo.targetInfo.url || page.url()
        },
        executable.label,
        options.mode,
        version.userAgent || '',
        profileDir,
        undefined,
        root ? () => context!.close() : () => page.close(),
        createTab
      );
      managedWindows.add(window);
      window.on('closed', () => managedWindows.delete(window));
      await window.initialize();
      return window;
    };
    const page = await selectPlaywrightPage(context.pages(), options.url || 'https://chatgpt.com/') ||
      (await context.newPage());
    const window = await wrapPage(page, true);
    context.on('close', () => {
      for (const managedWindow of managedWindows) managedWindow.notifyExternalClose();
      managedWindows.clear();
    });
    return window;
  } catch (error) {
    await context?.close().catch(() => undefined);
    throw error;
  }
}

export async function createChromeChatGptWindow(options: ChromeChatGptOptions) {
  const executables = findChromeExecutables();
  if (executables.length === 0) {
    throw new Error('Google Chrome or Microsoft Edge is required for dedicated browser mode.');
  }
  const failures: Array<{
    browser: ChromeExecutable['label'];
    attempt: number;
    strategy: 'pipe' | 'fixed' | 'profile';
    message: string;
  }> = [];
  const touchedProfileDirs = new Set<string>();
  for (const executable of executables) {
    const browserProfileDir = resolveBrowserProfileDir(options.profileDir, executable.label);
    touchedProfileDirs.add(browserProfileDir);
    fsSync.mkdirSync(browserProfileDir, { recursive: true });
    const stalePort = readManagedPort(browserProfileDir);
    const staleMode = readManagedMode(browserProfileDir);
    const terminatedPids = await resetManagedChromeRuntime(browserProfileDir).catch(async (error) => {
      await options.onDiagnostic?.('chrome-runtime-cleanup-failed', {
        browser: executable.label,
        executable: executable.path,
        message: error instanceof Error ? error.message : String(error),
        profileDir: browserProfileDir
      });
      return [];
    });
    await options.onDiagnostic?.('chrome-runtime-prepared', {
      browser: executable.label,
      executable: executable.path,
      profileDir: browserProfileDir,
      stalePort: stalePort || 0,
      staleMode: staleMode || 'unknown',
      terminatedPids
    });
    try {
      assertProfileDirectoryWritable(browserProfileDir);
    } catch (error) {
      const message = `Dedicated browser profile is not writable: ${
        error instanceof Error ? error.message : String(error)
      }`;
      failures.push({ browser: executable.label, attempt: 0, strategy: 'profile', message });
      await options.onDiagnostic?.('chrome-profile-unwritable', {
        browser: executable.label,
        executable: executable.path,
        profileDir: browserProfileDir,
        message
      });
      continue;
    }

    const launchPlan = buildChromeLaunchPlan(executable === executables[0] ? options.port : undefined);
    for (
      let attempt = 1;
      attempt <= Math.min(chromeStartupAttemptsPerBrowser, launchPlan.length);
      attempt += 1
    ) {
      if (attempt > 1) {
        await resetManagedChromeRuntime(browserProfileDir).catch(() => undefined);
      }
      const plan = launchPlan[attempt - 1];
      const requestedPort =
        plan.strategy === 'fixed'
          ? plan.requestedPort === undefined
            ? await findAvailablePort()
            : plan.requestedPort
          : 0;
      const modeArgs = options.mode === 'background' ? ['--new-window', '--mute-audio'] : ['--new-window'];
      const platformArgs = process.platform === 'win32'
        ? ['--disable-features=CalculateNativeWinOcclusion']
        : [];
      let chromeProcess: ChildProcess | undefined;
      let client: CDP.Client | undefined;
      let resolvedPort = requestedPort;
      try {
        removeManagedFiles(browserProfileDir, [chromeDevToolsActivePortFileName]);
        await options.onDiagnostic?.('chrome-launch-attempt', {
          browser: executable.label,
          executable: executable.path,
          profileDir: browserProfileDir,
          attempt,
          transport: plan.strategy,
          requestedPort,
          pid: 0,
          mode: options.mode
        });
        if (plan.strategy === 'pipe') {
          const window = await launchChromeWithPipe(executable, browserProfileDir, options);
          fsSync.writeFileSync(path.join(browserProfileDir, managedModeFileName), options.mode, 'utf8');
          removeManagedFiles(browserProfileDir, [managedPortFileName, chromeDevToolsActivePortFileName]);
          await options.onDiagnostic?.('chrome-launch-ready', {
            browser: executable.label,
            executable: executable.path,
            profileDir: browserProfileDir,
            attempt,
            transport: plan.strategy,
            requestedPort: 0,
            port: 0,
            pid: 0
          });
          return window;
        }
        chromeProcess = spawn(
          executable.path,
          [
            `--remote-debugging-port=${requestedPort}`,
            '--remote-allow-origins=*',
            `--user-data-dir=${browserProfileDir}`,
            '--profile-directory=Default',
            '--no-first-run',
            '--no-default-browser-check',
            '--hide-crash-restore-bubble',
            '--disable-session-crashed-bubble',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            ...platformArgs,
            ...modeArgs,
            options.url || 'https://chatgpt.com/'
          ],
          {
            detached: false,
            stdio: 'ignore',
            windowsHide: options.mode === 'background'
          }
        );
        if (chromeProcess.pid) {
          fsSync.writeFileSync(path.join(browserProfileDir, managedPidFileName), String(chromeProcess.pid), 'utf8');
        }
        const version = await waitForChrome(resolvedPort, chromeProcess, chromeFixedPortStartupTimeoutMs);
        fsSync.writeFileSync(path.join(browserProfileDir, managedPortFileName), String(resolvedPort), 'utf8');
        fsSync.writeFileSync(path.join(browserProfileDir, managedModeFileName), options.mode, 'utf8');
        await setNativeBrowserWindowVisibility(browserProfileDir, executable.label, options.mode === 'visible');
        const target = await findPageTarget(resolvedPort, options.url || 'https://chatgpt.com/');
        const wrapTarget = async (pageTarget: ChromePageTarget, root: boolean): Promise<ChromeChatGptWindow> => {
          const targetClient = await CDP({ port: resolvedPort, target: pageTarget.id });
          if (root) client = targetClient;
          const protocolClient = createRemoteInterfaceProtocolClient(targetClient);
          const createTab = async (url: string) => {
            const childTarget = await CDP.New({ port: resolvedPort, url });
            return wrapTarget({ id: childTarget.id, url: childTarget.url }, false);
          };
          const window = new ChromeChatGptWindow(
            protocolClient,
            pageTarget,
            executable.label,
            options.mode,
            version['User-Agent'],
            browserProfileDir,
            root ? chromeProcess : undefined,
            root ? undefined : () => CDP.Close({ port: resolvedPort, id: pageTarget.id }).then(() => undefined),
            createTab
          );
          await window.initialize();
          return window;
        };
        const window = await wrapTarget(target, true);
        await options.onDiagnostic?.('chrome-launch-ready', {
          browser: executable.label,
          executable: executable.path,
          profileDir: browserProfileDir,
          attempt,
          transport: plan.strategy,
          requestedPort,
          port: resolvedPort,
          pid: chromeProcess.pid || 0
        });
        return window;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ browser: executable.label, attempt, strategy: plan.strategy, message });
        console.warn('[Dedicated Chrome] launch attempt failed', {
          browser: executable.label,
          executable: executable.path,
          attempt,
          transport: plan.strategy,
          requestedPort,
          resolvedPort,
          message
        });
        await options.onDiagnostic?.('chrome-launch-attempt-failed', {
          browser: executable.label,
          executable: executable.path,
          profileDir: browserProfileDir,
          attempt,
          transport: plan.strategy,
          requestedPort,
          resolvedPort,
          processExitCode: chromeProcess?.exitCode ?? null,
          processSignal: chromeProcess?.signalCode ?? null,
          devToolsActivePortPresent: fsSync.existsSync(
            path.join(browserProfileDir, chromeDevToolsActivePortFileName)
          ),
          message
        });
        await client?.close().catch(() => undefined);
        await stopSpawnedBrowser(chromeProcess);
      }
    }
  }
  for (const profileDir of touchedProfileDirs) {
    await resetManagedChromeRuntime(profileDir).catch(() => undefined);
  }
  const lastFailure = failures.at(-1);
  throw new ChromeChatGptStartupError(
    `Dedicated Chrome could not start after ${failures.length} attempts${
      lastFailure ? `; last failure: ${lastFailure.message}` : ''
    }.`
  );
}
