import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { chromium } from 'playwright-core';
import * as policy from '../src/main/chatGptBrowserPolicy.ts';
import * as runtime from '../src/shared/chatGptAutomationRuntimePolicy.ts';

const source = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
function load(names, context) {
  const selected = ast.statements.filter(node => names.some(name =>
    node.name?.text === name || node.declarationList?.declarations.some(d => d.name.text === name)));
  assert.equal(selected.length, names.length, 'all production functions must exist');
  const js = ts.transpileModule(selected.map(n => n.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return vm.runInNewContext(`${js}\n({${names.join(',')}})`, context);
}

test('surface recovery never reloads authentication or challenge pages', async () => {
  for (const url of ['https://chatgpt.com/', 'https://auth.openai.com/log-in']) {
    let mutations = 0;
    const surface = { health: { usable: false, blank: false, manualIntervention: true } };
    const context = {
      ...policy, sleep: async () => {}, appendChatGptAutomationDiagnostic: async () => {},
      chatGptWindowDiagnosticSnapshot: () => ({}), keepChatGptWindowInBackground: () => {},
      reloadChatGptIgnoringHttpCache: async () => { mutations++; return true; },
      loadChatGptUrlRecoverably: async () => { mutations++; },
      waitForUsableChatGptSurface: async () => surface,
      observeChatGptManualIntervention: async () => true,
      chatGptManualVerificationRequired: false
    };
    const { recoverChatGptSurface } = load(['recoverChatGptSurface'], context);
    const result = await recoverChatGptSurface({ webContents: { getURL: () => url } }, url, 'login-check', surface);
    assert.equal(mutations, 0);
    assert.equal(result.attempts, 0);
  }
});

test('Chinese verification DOM is recognized without exporting body text or mistaking an assistant reply', async () => {
  const { chatGptPageProbeScript } = load(['chatGptPageProbeScript'], {});
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>auth.openai.com</title><main><h1>auth.openai.com</h1><h2>正在进行安全验证</h2><div id="challenge-stage">正在验证...</div></main>');
    const probe = await page.evaluate(chatGptPageProbeScript);
    assert.equal(probe.challengeVisible, true);
    assert.equal('bodyText' in probe, false);
    await page.setContent('<article data-message-author-role="assistant">正在进行安全验证 Cloudflare</article><form><textarea placeholder="Message ChatGPT"></textarea></form>');
    assert.equal((await page.evaluate(chatGptPageProbeScript)).challengeVisible, false);
    await page.setContent('<article data-message-author-role="assistant"><button>Log in</button></article><form><textarea>请分析登录页面</textarea></form>');
    assert.equal((await page.evaluate(chatGptPageProbeScript)).loginSurface, false, 'prompt and assistant content are not login controls');
    await page.setContent('<form><textarea></textarea></form><div role="dialog">Verify you are human</div>');
    assert.equal((await page.evaluate(chatGptPageProbeScript)).challengeVisible, true);
  } finally { await browser.close(); }
});

test('navigation and cache reload cannot interrupt a manual challenge', async () => {
  const paused = new Error('manual-verification');
  let mutations = 0;
  const win = { loadURL: async () => { mutations++; }, webContents: {
    getURL: () => 'https://auth.openai.com/', debugger: {
      isAttached: () => true, sendCommand: async () => { mutations++; }
    }
  } };
  const fns = load(['loadChatGptUrlRecoverably', 'reloadChatGptIgnoringHttpCache'], {
    assertChatGptPageOperationAllowed: async () => { throw paused; },
    chatGptNavigationTimeoutMs: 1000, withTimeout: p => p, console,
    isRecoveredChatGptNavigationAbort: () => false
  });
  await assert.rejects(fns.loadChatGptUrlRecoverably(win, 'https://chatgpt.com/', 'test'), /manual-verification/);
  await assert.rejects(fns.reloadChatGptIgnoringHttpCache(win, 'test'), /manual-verification/);
  assert.equal(mutations, 0);
});

test('composer recovery must check the challenge before Escape, hiding or navigation', async () => {
  let mutations = 0;
  const recover = load(['recoverChatGptComposerInBackgroundUnsafe'], {
    assertChatGptPageOperationAllowed: async () => { throw new Error('manual-verification'); },
    appendChatGptAutomationDiagnostic: async () => {}, chatGptWindowDiagnosticSnapshot: () => ({}),
    emitAutomationStatus: () => {}, keepChatGptWindowInBackground: () => { mutations++; },
    dismissOpenMenus: async () => { mutations++; },
    waitForChatGptComposer: async () => ({ composerReady: true }),
    isAutomationComposerReady: () => true
  }).recoverChatGptComposerInBackgroundUnsafe;
  await assert.rejects(recover({}, { webContents: {} }, 'https://chatgpt.com/'), /manual-verification/);
  assert.equal(mutations, 0);
});

test('manual recovery cannot resume when a sibling lane still requires verification', async () => {
  const context = {
    ...runtime, chatGptProtectionState: runtime.createChatGptProtectionState({ phase: 'PROTECTION_PAUSED' }),
    chatGptManualVerificationRequired: true, chatGptManualVerificationMessage: 'manual-verification',
    chatGptConversationAccessBlockedUntil: 0,
    confirmChatGptManualPagesReady: async () => false,
    emitAutomationStatus: () => {}, evalInPageWithTimeout: async () => ({ quotaExceeded: false, pageLimited: false }),
    chatGptQuotaSnapshotScript: '', chatGptConversationAccessRecoveryScript: () => '',
    waitForStableChatGptProbe: async () => ({ composerReady: true }), sleep: async () => {},
    isAutomationComposerReady: () => true, persistChatGptRuntimeState: async () => {},
    appendChatGptAutomationDiagnostic: async () => {}
  };
  const f = load(['recoverChatGptConversationAccessAfterCooldown'], context).recoverChatGptConversationAccessAfterCooldown;
  const result = await f({}, {}, { manual: true });
  assert.equal(result.ok, false);
  assert.equal(context.chatGptManualVerificationRequired, true);
  assert.equal(context.chatGptProtectionState.phase, 'PROTECTION_PAUSED');
});

test('viewing the existing window repeatedly never replaces the page or closes verification', async () => {
  let shown = 0, navigations = 0;
  const win = { isDestroyed: () => false, webContents: { getURL: () => 'https://auth.openai.com/' } };
  const verifiedConfig = new Map([[win.webContents, 'old-model']]);
  const context = {
    resolveChatGptBrowserBackend: () => 'chrome', shouldUseExternalChatGpt: () => false,
    chatGptWindow: win, chatGptTaskTabs: [], chatGptManualVerificationRequired: true,
    chatGptManualVerificationMessage: 'manual-verification', chatGptChromeLoginInterventionActive: true,
    observeChatGptManualIntervention: async () => ({ health: { manualIntervention: true } }),
    showAndConfirmChatGptWindow: async w => { assert.equal(w, win); shown++; return true; },
    getChatGptWindow: async () => { navigations++; return win; },
    chatGptAutomationRunning: false, chatGptAnalysisRunning: false,
    chatGptVerifiedConfigByPage: verifiedConfig
  };
  const f = load(['showChatGptWindowForInspection'], context).showChatGptWindowForInspection;
  for (let i = 0; i < 3; i++) assert.equal((await f('https://chatgpt.com/')).ok, true);
  assert.equal(shown, 3);
  assert.equal(navigations, 0);
  assert.equal(verifiedConfig.has(win.webContents), false, 'manual inspection invalidates cached model confirmation');
});

test('one challenge freezes all three lanes, permits read-only results, and requires stable manual recovery', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const pages = [];
    const mutations = [];
    for (let lane = 0; lane < 3; lane++) {
      const page = await browser.newPage();
      await page.setContent('<form><textarea></textarea></form><article>saved result</article>');
      pages.push(page);
    }
    const windows = pages.map((page, lane) => ({
      isDestroyed: () => false,
      webContents: {
        getURL: () => `https://chatgpt.com/c/lane-${lane}`,
        isLoading: () => false,
        executeJavaScript: script => page.evaluate(script),
        debugger: { sendCommand: async method => { mutations.push({ lane, method }); } }
      }
    }));
    const context = {
      ...policy, ...runtime,
      chatGptWindow: windows[0], chatGptTaskTabs: windows.slice(1),
      chatGptManualVerificationRequired: false, chatGptChromeLoginInterventionActive: false,
      chatGptManualVerificationMessage: 'manual-verification',
      chatGptProtectionState: runtime.createChatGptProtectionState(),
      chatGptGuardedContents: new WeakSet(), chatGptConversationAccessBlockedUntil: 0,
      loadChatGptRuntimeState: async () => {}, persistChatGptRuntimeState: async () => {},
      appendChatGptAutomationDiagnostic: async () => {}, emitAutomationStatus: () => {},
      ChatGptProtectionPausedError: Error, sleep: async () => {},
      evalInPageWithTimeout: (wc, script) => wc.executeJavaScript(script),
      chatGptQuotaSnapshotScript: '({quotaExceeded:false})',
      chatGptConversationAccessRecoveryScript: () => '({pageLimited:false})',
      waitForStableChatGptProbe: async () => ({ composerReady: true }), isAutomationComposerReady: () => true
    };
    const f = load(['chatGptPageProbeScript', 'probeChatGptPage', 'observeChatGptManualIntervention',
      'assertChatGptPageOperationAllowed', 'installChatGptInteractionGuard', 'confirmChatGptManualPagesReady',
      'recoverChatGptConversationAccessAfterCooldown', 'evalChatGptMutation'], context);
    for (const win of windows) f.installChatGptInteractionGuard(win.webContents);
    await pages[1].setContent('<h2>正在进行安全验证</h2><div id="challenge-stage">正在验证</div>');
    await assert.rejects(windows[1].webContents.debugger.sendCommand('Input.dispatchMouseEvent'), /manual-verification/);
    for (const win of windows) {
      for (const method of ['Page.reload', 'Page.navigate', 'Input.dispatchKeyEvent', 'DOM.setFileInputFiles']) {
        await assert.rejects(win.webContents.debugger.sendCommand(method), /manual-verification/);
      }
      await assert.rejects(f.evalChatGptMutation(win.webContents, 'document.body.click()'), /manual-verification/);
    }
    assert.equal(mutations.length, 0);
    assert.equal(await windows[0].webContents.executeJavaScript('document.querySelector("article").textContent'), 'saved result');
    assert.equal((await f.recoverChatGptConversationAccessAfterCooldown({}, windows[0].webContents, { manual: true })).ok, false);
    await pages[1].setContent('<form><textarea></textarea></form>');
    assert.equal((await f.recoverChatGptConversationAccessAfterCooldown({}, windows[0].webContents)).ok, false, 'closing the challenge cannot auto-resume');
    assert.equal((await f.recoverChatGptConversationAccessAfterCooldown({}, windows[0].webContents, { manual: true })).ok, true);
    assert.equal(context.chatGptProtectionState.phase, 'RECOVERING_ONE_LANE');
    assert.equal(context.chatGptManualVerificationRequired, false);
    await windows[0].webContents.debugger.sendCommand('Input.dispatchKeyEvent');
    assert.equal(mutations.length, 1);
  } finally { await browser.close(); }
});

test('all background blank-page recovery entrances share one attempt per page', async () => {
  let reloads = 0;
  const surface = { health: { usable: false, blank: true, manualIntervention: false } };
  const f = load(['recoverChatGptSurface'], {
    ...policy, chatGptManualVerificationRequired: false, chatGptSurfaceRecoveryAttempted: new WeakSet(),
    keepChatGptWindowInBackground: () => {}, sleep: async () => {},
    appendChatGptAutomationDiagnostic: async () => {}, chatGptWindowDiagnosticSnapshot: () => ({}),
    reloadChatGptIgnoringHttpCache: async () => { reloads++; return true; },
    waitForUsableChatGptSurface: async () => surface
  }).recoverChatGptSurface;
  const win = { webContents: { getURL: () => 'https://chatgpt.com/', isLoading: () => false } };
  for (const scope of ['inspection', 'login-check', 'login-check']) await f(win, 'https://chatgpt.com/', scope, surface);
  assert.equal(reloads, 1);
});

test('a challenge detected during batch preparation is reported as paused, not failed', async () => {
  const batch = ast.statements.find(n => n.name?.text === 'automateChatGptBatch');
  const block = batch.body.statements.findLast(ts.isTryStatement).catchClause.block.getText(ast);
  const js = ts.transpileModule(`async function catchBatch(error: unknown) ${block}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const statuses = [];
  const context = { chatGptManualVerificationRequired: true, ChatGptProtectionPausedError: Error,
    savedImagesByTask: new Map(), completedTaskIndices: new Set(), mode: 'auto-send', total: 3,
    lastResult: undefined, failedAttempts: 0, event: {}, path: {},
    emitAutomationStatus: (_e, s) => statuses.push(s) };
  const f = vm.runInNewContext(`${js};catchBatch`, context);
  const result = await f(new Error('manual-verification'));
  assert.equal(result.paused, true);
  assert.equal(result.protectionPaused, true);
  assert.equal(result.error, undefined);
  assert.equal(statuses[0].level, 'warning');
});

test('restart restores the manual verification latch without creating a timed retry', async () => {
  const context = {
    ...runtime, chatGptSafetyStateLoaded: false, chatGptRuntimeLoadPromise: undefined, chatGptManualVerificationRequired: false,
    lastChatGptSubmissionStartedAt: 0, chatGptConversationAccessBlockedUntil: 0,
    chatGptSubmissionSafetyBlockedUntil: 0, chatGptSubmissionSafetyReason: '',
    chatGptRuntimeSamples: [], chatGptSubmissionsSinceRest: 0, chatGptProtectionDetectionTimestamps: [],
    chatGptProtectionState: runtime.createChatGptProtectionState(),
    fs: { readFile: async () => JSON.stringify({ version: 1, manualVerificationRequired: true,
      protectionState: { phase: 'PROTECTION_PAUSED' } }) },
    chatGptRuntimeStatePath: () => 'fixture-only', appendChatGptAutomationDiagnostic: async () => {},
    chatGptManualVerificationMessage: 'manual-verification', ChatGptProtectionPausedError: Error
  };
  const f = load(['loadChatGptRuntimeState', 'assertChatGptAutomationStartAllowed'], context);
  await assert.rejects(f.assertChatGptAutomationStartAllowed(), /manual-verification/);
  assert.equal(context.chatGptManualVerificationRequired, true);
  assert.equal(context.chatGptConversationAccessBlockedUntil, 0);
});

test('a returning challenge or another quota limit keeps the manual pause latched', async () => {
  for (const scenario of ['challenge-returned', 'other-quota']) {
    let checks = 0;
    const context = {
      ...runtime, chatGptProtectionState: runtime.createChatGptProtectionState({ phase: 'PROTECTION_PAUSED' }),
      chatGptManualVerificationRequired: true, chatGptManualVerificationMessage: 'manual-verification',
      chatGptConversationAccessBlockedUntil: 0,
      confirmChatGptManualPagesReady: async () => ++checks === 1,
      emitAutomationStatus: () => {},
      evalInPageWithTimeout: async () => ({ quotaExceeded: scenario === 'other-quota', message: 'image quota', pageLimited: false }),
      isChatGptConversationAccessLimitedMessage: () => false,
      chatGptQuotaSnapshotScript: '', chatGptConversationAccessRecoveryScript: () => '',
      waitForStableChatGptProbe: async () => ({ composerReady: true }), sleep: async () => {},
      isAutomationComposerReady: () => true, persistChatGptRuntimeState: async () => {},
      appendChatGptAutomationDiagnostic: async () => {}
    };
    const f = load(['recoverChatGptConversationAccessAfterCooldown'], context).recoverChatGptConversationAccessAfterCooldown;
    const result = await f({}, {}, { manual: true });
    assert.equal(result.ok, false, scenario);
    assert.equal(result.paused, true, scenario);
    assert.equal(context.chatGptManualVerificationRequired, true, scenario);
    assert.equal(context.chatGptProtectionState.phase, 'PROTECTION_PAUSED', scenario);
  }
});

test('recovery check after restart does not open a hidden browser', async () => {
  let handler;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'registerTrustedIpcHandler' &&
        node.arguments[0]?.text === 'chatgpt:check-protection-recovery') handler = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler);
  let opened = 0;
  const context = {
    loadChatGptRuntimeState: async () => {}, chatGptManualVerificationRequired: true,
    chatGptManualVerificationMessage: 'manual-verification', chatGptWindow: undefined,
    chatGptProtectionState: { phase: 'PROTECTION_PAUSED' }, chatGptConversationAccessBlockedUntil: 0,
    getChatGptWindow: async () => { opened++; return { webContents: {} }; },
    recoverChatGptConversationAccessAfterCooldown: async () => ({ ok: true })
  };
  const js = ts.transpileModule(`const handler = ${handler.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const result = await vm.runInNewContext(`${js};handler`, context)({}, { url: 'https://chatgpt.com/' });
  assert.equal(opened, 0);
  assert.equal(result.ok, false);
  assert.equal(result.protectionPaused, true);
});

test('a verification page reached during surface loading immediately latches the pause', async () => {
  let observed = 0;
  const probe = { url: 'https://auth.openai.com/log-in', title: 'auth.openai.com', challengeVisible: true };
  const f = load(['waitForUsableChatGptSurface'], {
    ...policy, probeChatGptPage: async () => probe, sleep: async () => {},
    observeChatGptManualIntervention: async () => { observed++; return { probe, health: policy.assessChatGptPageHealth(probe) }; }
  }).waitForUsableChatGptSurface;
  const result = await f({ webContents: { getURL: () => probe.url } });
  assert.equal(observed, 1);
  assert.equal(result.health.manualIntervention, true);
});

test('background window acquisition and page-storage writes respect persisted verification', async () => {
  const context = {
    chatGptManualVerificationRequired: false, chatGptManualVerificationMessage: 'manual-verification',
    loadChatGptRuntimeState: async () => { context.chatGptManualVerificationRequired = true; },
    ChatGptProtectionPausedError: Error, resolveChatGptBrowserBackend: () => 'chrome',
    chatGptWindow: undefined, chatGptWindowReadyPromise: Promise.resolve({}),
    chatGptWindowReadyBackend: 'chrome', chatGptWindowReadyChromeMode: 'background'
  };
  const acquire = load(['getChatGptWindow'], context).getChatGptWindow;
  await assert.rejects(acquire('https://chatgpt.com/', 'chrome', 'background'), /manual-verification/);
  let writes = 0;
  const persist = load(['persistChatGptPageStorage'], {
    chatGptManualVerificationRequired: true, console, chatGptStorageTimeoutMs: 1000,
    evalInPageWithTimeout: async () => { writes++; },
    observeChatGptManualIntervention: async () => ({ health: { manualIntervention: true } })
  }).persistChatGptPageStorage;
  await persist({});
  assert.equal(writes, 0);
});
