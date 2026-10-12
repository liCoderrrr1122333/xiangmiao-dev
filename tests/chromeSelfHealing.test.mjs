import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  buildChromeLaunchPlan,
  ChromeChatGptStartupError,
  resolveBrowserProfileDir
} from '../dist-electron/main/chromeChatGpt.js';

test('dedicated browser startup errors have a stable recovery code', () => {
  const error = new ChromeChatGptStartupError('startup failed');
  assert.equal(error.name, 'ChromeChatGptStartupError');
  assert.equal(error.code, 'XIANGMAO_CHROME_STARTUP_FAILED');
});

test('dedicated Chrome prefers a local pipe and keeps fixed-port startup as fallback', () => {
  assert.deepEqual(buildChromeLaunchPlan(), [
    { strategy: 'pipe', requestedPort: undefined },
    { strategy: 'fixed', requestedPort: undefined }
  ]);
  assert.deepEqual(buildChromeLaunchPlan(43210), [
    { strategy: 'fixed', requestedPort: 43210 },
    { strategy: 'pipe', requestedPort: undefined }
  ]);
});

test('Chrome and Edge never share the same persistent login profile', () => {
  const chromeProfile = path.join('D:\\AppData', 'ChatGPT-Chrome');
  assert.equal(resolveBrowserProfileDir(chromeProfile, 'Chrome'), chromeProfile);
  assert.equal(
    resolveBrowserProfileDir(chromeProfile, 'Edge'),
    path.join('D:\\AppData', 'ChatGPT-Chrome-Edge')
  );
});

test('dedicated browser lifecycle cleans only its exact profile and retries startup', async () => {
  const source = await readFile(new URL('../src/main/chromeChatGpt.ts', import.meta.url), 'utf8');

  assert.match(source, /Get-CimInstance Win32_Process/);
  assert.match(source, /System32\\\\WindowsPowerShell\\\\v1\.0\\\\powershell\.exe/);
  assert.match(source, /findPowerShellExecutable\(\)/);
  assert.match(source, /\$pattern = '--user-data-dir=/);
  assert.match(source, /\[regex\]::Escape\(\$profile\)/);
  assert.match(source, /\$_.Name -eq 'chrome\.exe' -or \$_.Name -eq 'msedge\.exe'/);
  assert.match(source, /Stop-Process -Id \$processId -Force/);
  assert.match(source, /SingletonLock/);
  assert.match(source, /XiangmaoChromePid/);
  assert.match(source, /lock files must stay intact if process ownership is unknown/);
  assert.match(source, /chromeStartupAttemptsPerBrowser = 2/);
  assert.match(source, /for \(const executable of executables\)/);
  assert.match(source, /buildChromeLaunchPlan/);
  assert.match(source, /launchChromeWithPipe/);
  assert.match(source, /chromium\.launchPersistentContext/);
  assert.match(source, /ignoreDefaultArgs: \['--enable-automation'\]/);
  assert.doesNotMatch(source, /--disable-blink-features=AutomationControlled/);
  assert.match(source, /chromiumSandbox: true/);
  assert.match(source, /findAvailablePort\(\)/);
  assert.match(source, /waitForChrome\(resolvedPort, chromeProcess/);
  assert.match(source, /chromeProcess\.once\('error'/);
  assert.match(source, /chromeProcess\.once\('exit'/);
  assert.match(source, /exited before opening its local control port/);
  assert.match(source, /visibilityGeneration/);
  assert.match(source, /queueVisibility\(false\)/);
  assert.match(source, /queueVisibility\(true\)/);
  assert.match(source, /waitForVisibility\(\)/);
  assert.match(source, /resolveBrowserProfileDir/);
  assert.match(source, /chrome-launch-attempt-failed/);
  assert.match(source, /ChromeChatGptStartupError/);
});

test('login controls expose progress and never surface raw connection failures', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const queueSource = await readFile(new URL('../src/main/chatGptControlQueue.ts', import.meta.url), 'utf8');
  const recoveryScript = await readFile(new URL('../scripts/verify-chrome-window-recovery.mjs', import.meta.url), 'utf8');

  assert.match(appSource, /isOpeningChatGptWindow/);
  assert.match(appSource, /isCheckingChatGptLogin/);
  assert.match(appSource, /正在修复并打开 \$\{activeProviderLabel\} 专属 Chrome/);
  assert.match(appSource, /isOpeningChatGptWindow \? '打开中' : '查看窗口'/);
  assert.match(appSource, /isCheckingChatGptLogin \? '检查中' : '检查登录'/);
  assert.match(appSource, /aria-busy=/);
  assert.match(appSource, /if \(chatGptWindowOpenPromiseRef\.current\) \{\s*await chatGptWindowOpenPromiseRef\.current/);
  assert.match(appSource, /finally \{\s*setIsOpeningChatGptWindow\(false\)/);
  assert.match(mainSource, /describeChatGptWindowFailure/);
  assert.match(mainSource, /依次尝试无端口本地管道、兼容端口、Chrome 与 Edge/);
  assert.match(mainSource, /inspection-open-failed/);
  assert.match(mainSource, /login-check-failed/);
  assert.match(mainSource, /runChatGptControlOperation\('check-login'/);
  assert.match(mainSource, /runChatGptControlOperation\(\s*'show-window'/);
  assert.match(mainSource, /runChatGptControlOperation\('recover-window'/);
  assert.match(mainSource, /runChatGptControlOperation\('list-models'/);
  assert.match(mainSource, /automation-window-not-visible/);
  assert.match(mainSource, /recoveryReason: 'automation-active'/);
  assert.match(mainSource, /软件没有刷新或切换当前任务页面/);
  assert.match(mainSource, /为避免打开模型菜单干扰当前标签页，请在任务结束后刷新模型/);
  assert.match(queueSource, /private readonly inFlight = new Map/);
  assert.match(queueSource, /this\.tail\.catch\(\(\) => undefined\)\.then\(operation\)/);
  assert.match(queueSource, /runSingleFlight<T>/);
  assert.match(queueSource, /runExclusive<T>/);
  assert.match(queueSource, /waitForSingleFlight\(key: string\)/);
  assert.match(queueSource, /waitForSingleFlights\(keys: readonly string\[\]\)/);
  assert.match(mainSource, /isInFlight\('recover-window'\) \? 'serialized' : 'single-flight'/);
  assert.match(mainSource, /acquireChatGptTaskSlot\('generation'\)/);
  assert.match(mainSource, /acquireChatGptTaskSlot\('analysis'\)/);
  assert.match(mainSource, /chatGptControlQueue\.runExclusive\(async \(\) =>/);
  assert.match(
    mainSource,
    /chatGptControlQueue\.waitForSingleFlights\(\[\s*'show-window',\s*'gemini:show-window'\s*\]\)/
  );
  assert.match(mainSource, /if \(cancelled\) return \{ acquired: false as const, blocker: 'expired' as const \}/);
  assert.match(mainSource, /if \(slotSet\) \{\s*if \(purpose === 'generation'\) chatGptAutomationRunning = false/);
  assert.match(recoveryScript, /round <= 20/);
  assert.match(recoveryScript, /visibilityCyclePasses !== 20/);
  assert.doesNotMatch(
    mainSource,
    /return \{ ok: false, loggedIn: false, needsLogin: false, message: rawMessage/
  );
});
