import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assessChatGptPageHealth,
  canUseChatGptComposer,
  classifyChatGptPageCapabilities,
  classifyChatGptNavigation,
  isConfirmedChatGptLogin,
  isConfirmedChatGptLogout,
  resolveChatGptModelDiscovery
} from '../src/main/chatGptBrowserPolicy.ts';
import {
  scoreChatGptPageTarget,
  selectBestChatGptPageTargetCandidate
} from '../dist-electron/main/chromeChatGpt.js';

test('Google OAuth is separated from trusted embedded ChatGPT navigation', () => {
  assert.equal(classifyChatGptNavigation('https://accounts.google.com/o/oauth2/v2/auth?client_id=x'), 'google-oauth');
  assert.equal(classifyChatGptNavigation('https://chatgpt.com/auth/login'), 'trusted-chatgpt');
  assert.equal(classifyChatGptNavigation('https://auth.openai.com/authorize'), 'trusted-chatgpt');
  assert.equal(classifyChatGptNavigation('about:blank'), 'blank');
  assert.equal(classifyChatGptNavigation('https://example.com/'), 'external');
});

test('dedicated Chrome selects a useful ChatGPT or OAuth page instead of a blank tab', () => {
  assert.ok(
    scoreChatGptPageTarget('https://chatgpt.com/c/123', 'https://chatgpt.com/') >
      scoreChatGptPageTarget('about:blank', 'https://chatgpt.com/')
  );
  assert.ok(
    scoreChatGptPageTarget('https://accounts.google.com/v3/signin', 'https://accounts.google.com/v3/signin') >
      scoreChatGptPageTarget('https://chatgpt.com/', 'https://accounts.google.com/v3/signin')
  );
  assert.ok(
    scoreChatGptPageTarget('https://chatgpt.com/', 'https://chatgpt.com/') >
      scoreChatGptPageTarget('chrome://newtab/', 'https://chatgpt.com/')
  );
});

test('an active composer page wins over a stale ChatGPT tab with an equally useful URL', () => {
  const selected = selectBestChatGptPageTargetCandidate(
    [
      {
        id: 'stale-conversation',
        url: 'https://chatgpt.com/c/stale',
        visible: false,
        composerReady: false,
        bodyTextLength: 8000
      },
      {
        id: 'active-home',
        url: 'https://chatgpt.com/',
        visible: true,
        composerReady: true,
        bodyTextLength: 5000
      }
    ],
    'https://chatgpt.com/'
  );

  assert.equal(selected?.id, 'active-home');
});

test('composer capability is independent from the model picker layout', () => {
  assert.deepEqual(
    classifyChatGptPageCapabilities({
      composerReady: true,
      protected: false,
      loginRequired: false,
      explicitModelPicker: false,
      thinkingLevelPicker: false,
      thinkingToggle: true
    }),
    {
      pageState: 'ready',
      modelMode: 'automatic',
      thinkingMode: 'toggle'
    }
  );

  assert.deepEqual(
    classifyChatGptPageCapabilities({
      composerReady: true,
      protected: false,
      loginRequired: false,
      explicitModelPicker: true,
      thinkingLevelPicker: true,
      thinkingToggle: false
    }),
    {
      pageState: 'ready',
      modelMode: 'explicit',
      thinkingMode: 'levels'
    }
  );
});

test('a ready free-account composer is usable without a model picker', () => {
  assert.deepEqual(
    resolveChatGptModelDiscovery({
      composerReady: true,
      explicitModelPicker: false,
      modelCount: 0
    }),
    {
      ok: true,
      modelMode: 'automatic',
      message: '当前账号使用 ChatGPT 自动模型；输入框可用，不需要模型选择器。'
    }
  );

  assert.deepEqual(
    resolveChatGptModelDiscovery({
      composerReady: true,
      explicitModelPicker: true,
      modelCount: 3
    }),
    {
      ok: true,
      modelMode: 'explicit',
      message: '已读取 3 个当前账号可用模型。'
    }
  );
});

test('blank ChatGPT surfaces are rejected before a window is shown', () => {
  assert.deepEqual(
    assessChatGptPageHealth({
      url: 'https://chatgpt.com/',
      title: '',
      bodyTextLength: 0,
      htmlLength: 40
    }),
    {
      usable: false,
      blank: true,
      loginSurface: false,
      composerReady: false,
      manualIntervention: false
    }
  );
  assert.equal(
    assessChatGptPageHealth({
      url: 'https://chatgpt.com/',
      htmlLength: 1000,
      composerReady: true
    }).usable,
    true
  );
  assert.equal(
    assessChatGptPageHealth({
      url: 'https://chatgpt.com/',
      title: '请稍候…',
      htmlLength: 9000
    }).usable,
    false
  );
  assert.equal(
    assessChatGptPageHealth({
      url: 'https://chatgpt.com/',
      title: 'ChatGPT: Chat, Work, Create & Code with AI',
      bodyTextLength: 0,
      htmlLength: 9000
    }).usable,
    false
  );
});

test('human verification is never treated as a blank page to reload', () => {
  for (const input of [
    { url: 'https://chatgpt.com/', title: 'Just a moment...' },
    { url: 'https://auth.openai.com/', title: 'auth.openai.com', challengeVisible: true },
    { url: 'https://chatgpt.com/', challengeVisible: true, composerReady: true }
  ]) {
    const health = assessChatGptPageHealth({ bodyTextLength: 100, ...input });
    assert.equal(health.blank, false, 'verification must not enter blank-page recovery');
    assert.equal(health.manualIntervention, true);
    assert.equal(health.usable, false);
  }
  const auth = assessChatGptPageHealth({ url: 'https://auth.openai.com/log-in', bodyTextLength: 0 });
  assert.equal(auth.manualIntervention, true, 'even a hydrating auth page must be left alone');
  assert.equal(auth.blank, false);
});

test('an authenticated session wins over transient login controls', () => {
  const transientHydrationState = {
    loginText: false,
    composerReady: false,
    accountReady: true,
    sessionAuthenticated: true,
    sessionUnauthenticated: false
  };
  assert.equal(isConfirmedChatGptLogin(transientHydrationState), true);
  assert.equal(isConfirmedChatGptLogout(transientHydrationState), false);
});

test('logout requires an explicit unauthenticated session or auth page', () => {
  assert.equal(
    isConfirmedChatGptLogout({
      loginText: true,
      composerReady: false,
      sessionAuthenticated: false,
      sessionUnauthenticated: false,
      authUrl: false
    }),
    false
  );
  assert.equal(
    isConfirmedChatGptLogout({
      loginText: true,
      composerReady: false,
      sessionAuthenticated: false,
      sessionUnauthenticated: true
    }),
    true
  );
  assert.equal(
    canUseChatGptComposer({
      loginText: false,
      composerReady: true,
      accountReady: false
    }),
    true
  );
});

test('dedicated Chrome keeps a persistent profile and hides headed automation natively', async () => {
  const chromeSource = await readFile(new URL('../src/main/chromeChatGpt.ts', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

  assert.match(chromeSource, /--remote-debugging-port=\$\{requestedPort\}/);
  assert.doesNotMatch(chromeSource, /--remote-debugging-port=0/);
  assert.doesNotMatch(chromeSource, /--headless=new/);
  assert.doesNotMatch(chromeSource, /--start-minimized/);
  assert.match(chromeSource, /--hide-crash-restore-bubble/);
  assert.match(chromeSource, /--disable-features=CalculateNativeWinOcclusion/);
  assert.match(chromeSource, /setNativeBrowserWindowVisibility/);
  assert.match(chromeSource, /EnumWindows/);
  assert.match(chromeSource, /Chrome_WidgetWin_1/);
  assert.match(chromeSource, /ShowWindow\(\$handle, 0\)/);
  assert.match(chromeSource, /SystemParametersInfo\(0x0030/);
  assert.match(chromeSource, /SetWindowPos\(\$handle/);
  assert.match(chromeSource, /\$visibleWidth -lt 320/);
  assert.match(chromeSource, /GetWindowLongPtr\(\$candidate, -16\)/);
  assert.match(chromeSource, /\$windowStyle -band 0x00C00000/);
  assert.match(chromeSource, /\$mainHandles\.Add\(\$candidate\)/);
  assert.match(chromeSource, /-not \$mainHandles\.Contains\(\$handle\)[\s\S]*ShowWindow\(\$handle, 0\)/);
  assert.match(chromeSource, /visible \? '\$mainHandles' : '\$allHandles'/);
  assert.match(
    chromeSource,
    /queueVisibility\(visible: boolean\)[\s\S]*setWindowState\('normal'\)[\s\S]*send\('Page\.bringToFront'\)[\s\S]*setNativeBrowserWindowVisibility[\s\S]*wait\(350\)[\s\S]*setNativeBrowserWindowVisibility/
  );
  assert.match(chromeSource, /generation !== this\.visibilityGeneration/);
  assert.match(chromeSource, /this\.visibilityTask = this\.visibilityTask/);
  assert.doesNotMatch(chromeSource, /--window-position=-32000,-32000/);
  assert.match(
    chromeSource,
    /setNativeBrowserWindowVisibility\(browserProfileDir, executable\.label, options\.mode === 'visible'\)[\s\S]*findPageTarget/
  );
  assert.doesNotMatch(chromeSource, /MainWindowHandle/);
  assert.match(chromeSource, /--user-data-dir=\$\{browserProfileDir\}/);
  assert.match(chromeSource, /chromium\.launchPersistentContext/);
  assert.doesNotMatch(chromeSource, /--disable-blink-features=AutomationControlled/);
  assert.match(chromeSource, /ignoreDefaultArgs: \['--enable-automation'\]/);
  assert.match(chromeSource, /resolveBrowserProfileDir/);
  assert.match(chromeSource, /\$\{path\.basename\(profileDir\)\}-Edge/);
  assert.match(chromeSource, /resetManagedChromeRuntime/);
  assert.match(chromeSource, /terminateManagedProfileProcesses/);
  assert.match(mainSource, /installEmbeddedChatGptNavigationGuards/);
  assert.match(mainSource, /switchEmbeddedGoogleLoginToChrome/);
  assert.match(mainSource, /transitionDedicatedChromeToBackground/);
  assert.match(mainSource, /fetch\('\/api\/auth\/session'/);
  assert.match(mainSource, /chatGptLoginConfirmationCount = 3/);
  assert.match(mainSource, /waitForStableChatGptProbe/);
  assert.match(mainSource, /monitorDedicatedChromeLogin/);
  assert.match(
    mainSource,
    /classifyChatGptNavigation\(win\.webContents\.getURL\(\)\) === 'google-oauth'[\s\S]*continue/
  );
  assert.match(mainSource, /google-login-manual-guard/);
  assert.match(mainSource, /检查登录不会刷新页面、点击验证步骤或抢占前台/);
  assert.match(mainSource, /dedicated Chrome hidden in place after successful login/);
  assert.match(mainSource, /canReuseChromeAcrossVisibilityModes/);
  assert.match(mainSource, /if \(win\.isVisible\(\)\) win\.hide\(\)/);
  assert.match(
    chromeSource,
    /process\.platform === 'darwin'[\s\S]*setWindowState\('minimized'\)[\s\S]*setNativeBrowserWindowVisibility/
  );
  assert.match(mainSource, /button\[data-testid="login-button"\]/);
  assert.match(mainSource, /Input\.dispatchMouseEvent/);
  assert.match(mainSource, /openDedicatedChromeLoginSurface/);
  assert.match(mainSource, /reject non-essential\|reject all\|拒绝非必需/);
  assert.match(mainSource, /waitForUsableChatGptSurface/);
  assert.match(mainSource, /Network\.clearBrowserCache/);
  assert.match(mainSource, /Page\.reload', \{ ignoreCache: true \}/);
  assert.match(mainSource, /requestedChromeMode === 'visible'/);
  assert.match(mainSource, /showAndConfirmChatGptWindow/);
  assert.match(mainSource, /chrome-window-reveal-failed/);
  assert.match(
    mainSource,
    /if \(isConfirmedChatGptLogout\(recovered\)\) \{[\s\S]*outcome: 'confirmed-logout'[\s\S]*return recovered/
  );
  assert.match(mainSource, /chatGptSurfaceRecoveryAttempted/);
  assert.doesNotMatch(mainSource, /composer-navigation-fallback/);
  assert.match(
    mainSource,
    /if \(!isAutomationComposerReady\(composerState\) && !isConfirmedChatGptLogout\(composerState\)\)/
  );
  const checkLoginSource = mainSource.slice(
    mainSource.indexOf('async function checkChatGptLogin('),
    mainSource.indexOf('function extractOutputText(')
  );
  assert.doesNotMatch(checkLoginSource, /showAndConfirmChatGptWindow/);
  assert.doesNotMatch(checkLoginSource, /openChromeFallback/);
  assert.match(checkLoginSource, /foregroundAction: 'none'/);
  assert.match(mainSource, /chatgpt:recover-window/);
  assert.match(mainSource, /window-recovery-started/);
  assert.match(mainSource, /recoveryAvailable: true/);
});
