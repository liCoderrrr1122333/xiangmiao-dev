import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { normalizeRelayApiConfig } from '../dist-electron/shared/relayApiConfig.js';
import * as runtime from '../dist-electron/shared/chatGptAutomationRuntimePolicy.js';

const source = fs.readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
function loadFunction(name, context) {
  const node = ast.statements.find(node => node.name?.text === name);
  assert.ok(node, name);
  const js = ts.transpileModule(node.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return vm.runInNewContext(`${js};${name}`, context);
}

test('concurrent credential users all wait for the saved configuration to load', async () => {
  let complete;
  let reads = 0;
  const diskRead = new Promise(resolve => { complete = resolve; });
  const context = {
    relayCredentialLoaded: false, relayCredentialLoadPromise: undefined,
    relaySessionApiKey: '', relaySessionConfig: undefined, relayCredentialRemembered: false,
    safeStorage: { isEncryptionAvailable: () => true, decryptString: value => value },
    fs: { readFile: () => { reads++; return diskRead; } }, relayCredentialPath: () => 'fixture',
    normalizeRelayApiConfig
  };
  const load = loadFunction('ensureRelayCredentialLoaded', context);
  const first = load();
  let secondReturned = false;
  const second = load().then(() => { secondReturned = true; });
  try {
    await new Promise(setImmediate);
    assert.equal(secondReturned, false, 'no caller should see a partially loaded key');
  } finally {
    complete(JSON.stringify({ config: { baseUrl: 'https://example.test' }, apiKey: 'fixture-key' }));
    await Promise.all([first, second]);
  }
  assert.equal(reads, 1);
  assert.equal(context.relaySessionApiKey, 'fixture-key');
});

test('concurrent startup checks cannot pass before persisted manual protection is read', async () => {
  let complete;
  const diskRead = new Promise(resolve => { complete = resolve; });
  const context = {
    ...runtime, chatGptSafetyStateLoaded: false, chatGptRuntimeLoadPromise: undefined,
    chatGptManualVerificationRequired: false, lastChatGptSubmissionStartedAt: 0,
    chatGptConversationAccessBlockedUntil: 0, chatGptSubmissionSafetyBlockedUntil: 0,
    chatGptSubmissionSafetyReason: '', chatGptRuntimeSamples: [], chatGptSubmissionsSinceRest: 0,
    chatGptProtectionState: runtime.createChatGptProtectionState(), chatGptProtectionDetectionTimestamps: [],
    fs: { readFile: () => diskRead }, chatGptRuntimeStatePath: () => 'fixture',
    appendChatGptAutomationDiagnostic: async () => {}
  };
  const load = loadFunction('loadChatGptRuntimeState', context);
  const first = load();
  let secondReturned = false;
  const second = load().then(() => { secondReturned = true; });
  try {
    await new Promise(setImmediate);
    assert.equal(secondReturned, false);
  } finally {
    complete(JSON.stringify({ version: 1, manualVerificationRequired: true, protectionState: { phase: 'PROTECTION_PAUSED' } }));
    await Promise.all([first, second]);
  }
  assert.equal(context.chatGptManualVerificationRequired, true);
  assert.equal(context.chatGptProtectionState.phase, 'PROTECTION_PAUSED');
});

test('clearing a key excludes concurrent configuration changes until deletion completes', async () => {
  let complete;
  const deletion = new Promise(resolve => { complete = resolve; });
  const context = {
    relayCredentialChanging: false, activeRelayAdapter: null, chatGptAutomationRunning: false,
    ensureRelayCredentialLoaded: async () => {}, fs: { unlink: () => deletion },
    relayCredentialPath: () => 'fixture', relaySessionApiKey: 'fixture-key',
    relaySessionConfig: {}, relayCredentialRemembered: true,
    relayApiStatus: message => ({ message }), resetRelayConfiguredAdapter: () => {}
  };
  const clear = loadFunction('clearRelayCredential', context);
  const pending = clear();
  try {
    await new Promise(setImmediate);
    assert.equal(context.relayCredentialChanging, true);
    assert.equal((await clear()).ok, false);
  } finally { complete(); await pending; }
  assert.equal(context.relayCredentialChanging, false);
  assert.equal(context.relaySessionApiKey, '');
});
