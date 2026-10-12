import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeChatGptWindow } from '../dist-electron/main/chromeChatGpt.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.resolve(repoDir, '.tmp');
const profileDir = path.resolve(tempRoot, 'chrome-window-live-test');

if (!profileDir.startsWith(`${tempRoot}${path.sep}`)) {
  throw new Error(`Refusing to use an unsafe temporary profile path: ${profileDir}`);
}

const encodePowerShell = (script) => Buffer.from(script, 'utf16le').toString('base64');
const escapePowerShellLiteral = (value) => value.replaceAll("'", "''");

function runPowerShell(script) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)],
    { encoding: 'utf8', windowsHide: true }
  ).trim();
}

function buildWindowProbe(action = '') {
  return `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class XiangmaoWindowProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
}
'@
$profile = '${escapePowerShellLiteral(profileDir)}'
$managedPids = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -like "*--user-data-dir=$profile*" } |
  ForEach-Object { [int]$_.ProcessId })
$windows = New-Object 'System.Collections.Generic.List[object]'
[XiangmaoWindowProbe]::EnumWindows({
  param($handle, $parameter)
  $processId = [uint32]0
  [XiangmaoWindowProbe]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
  if ($managedPids -notcontains [int]$processId) { return $true }
  $className = New-Object System.Text.StringBuilder 128
  [XiangmaoWindowProbe]::GetClassName($handle, $className, $className.Capacity) | Out-Null
  if ($className.ToString() -ne 'Chrome_WidgetWin_1') { return $true }
  $title = New-Object System.Text.StringBuilder 512
  [XiangmaoWindowProbe]::GetWindowText($handle, $title, $title.Capacity) | Out-Null
  $rect = New-Object XiangmaoWindowProbe+RECT
  [XiangmaoWindowProbe]::GetWindowRect($handle, [ref]$rect) | Out-Null
  $style = [XiangmaoWindowProbe]::GetWindowLong($handle, -16)
  $windows.Add([pscustomobject]@{
    Handle = $handle.ToInt64()
    ProcessId = $processId
    Title = $title.ToString()
    Visible = [XiangmaoWindowProbe]::IsWindowVisible($handle)
    Caption = (($style -band 0x00C00000) -eq 0x00C00000)
    ThickFrame = (($style -band 0x00040000) -eq 0x00040000)
    Left = $rect.Left
    Top = $rect.Top
    Right = $rect.Right
    Bottom = $rect.Bottom
  })
  return $true
}, [IntPtr]::Zero) | Out-Null
${action}
$windows | ConvertTo-Json -Compress
`;
}

function readWindows() {
  const output = runPowerShell(buildWindowProbe());
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function moveMainWindowOffscreen() {
  runPowerShell(
    buildWindowProbe(`
$mainWindow = $windows | Where-Object Caption | Select-Object -First 1
if (-not $mainWindow) { throw 'No captioned dedicated Chrome window was found.' }
[XiangmaoWindowProbe]::SetWindowPos(
  [IntPtr]$mainWindow.Handle,
  [IntPtr]::Zero,
  -1025,
  0,
  1058,
  896,
  0x0004
) | Out-Null
`)
  );
}

fs.mkdirSync(tempRoot, { recursive: true });
fs.rmSync(profileDir, { recursive: true, force: true });

let browserWindow;
try {
  browserWindow = await createChromeChatGptWindow({
    profileDir,
    url: 'https://chatgpt.com/',
    mode: 'visible'
  });
  const initialVisibilityConfirmed = await browserWindow.waitForVisibility();
  await wait(300);

  const initialWindows = readWindows();
  const initialMain = initialWindows.find((window) => window.Caption);
  if (!initialMain?.Visible || !initialMain.ThickFrame) {
    throw new Error(`The initial Chrome main window is not a normal draggable window: ${JSON.stringify(initialWindows)}`);
  }

  moveMainWindowOffscreen();
  await wait(300);
  browserWindow.show();
  const recoveryVisibilityConfirmed = await browserWindow.waitForVisibility();
  await wait(300);

  const recoveredWindows = readWindows();
  const recoveredMain = recoveredWindows.find((window) => window.Caption);
  const visibleHelpers = recoveredWindows.filter((window) => !window.Caption && window.Visible);
  const recovered =
    recoveredMain?.Visible &&
    recoveredMain.ThickFrame &&
    recoveredMain.Left >= 0 &&
    recoveredMain.Top >= 0 &&
    visibleHelpers.length === 0;

  let visibilityCyclePasses = 0;
  if (recovered) {
    for (let round = 1; round <= 20; round += 1) {
      browserWindow.hide();
      const hidden = await browserWindow.waitForVisibility();
      browserWindow.show();
      const shown = await browserWindow.waitForVisibility();
      if (!hidden || !shown || browserWindow.isDestroyed()) break;
      visibilityCyclePasses = round;
    }
  }

  console.log(
    JSON.stringify(
      {
        initialVisibilityConfirmed,
        recoveryVisibilityConfirmed,
        initialWindows,
        recoveredWindows,
        recovered,
        visibleHelperCount: visibleHelpers.length,
        visibilityCyclePasses
      },
      null,
      2
    )
  );
  if (!initialVisibilityConfirmed || !recoveryVisibilityConfirmed || !recovered || visibilityCyclePasses !== 20) {
    process.exitCode = 1;
  }
} finally {
  browserWindow?.close();
  await wait(2000);
  fs.rmSync(profileDir, { recursive: true, force: true });
}
