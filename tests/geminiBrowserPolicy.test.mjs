import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessGeminiPageHealth,
  classifyGeminiNavigation,
  dedupeGeminiModelOptions,
  isConfirmedGeminiLogin,
  isConfirmedGeminiLogout,
  isSameGeminiModel,
  parseGeminiModelOptionLabel
} from '../src/main/geminiBrowserPolicy.ts';

test('Gemini navigation keeps Google sign-in as a manual boundary', () => {
  assert.equal(classifyGeminiNavigation('https://gemini.google.com/app'), 'trusted-gemini');
  assert.equal(classifyGeminiNavigation('https://accounts.google.com/v3/signin'), 'google-oauth');
  assert.equal(classifyGeminiNavigation('about:blank'), 'blank');
  assert.equal(classifyGeminiNavigation('https://example.com/'), 'external');
});

test('Gemini login requires account evidence and rejects explicit sign-out surfaces', () => {
  assert.equal(isConfirmedGeminiLogin({ composerReady: true, accountReady: true, loginVisible: false }), true);
  assert.equal(isConfirmedGeminiLogin({ composerReady: true, accountReady: true, regionBlocked: true }), false);
  assert.equal(isConfirmedGeminiLogin({ composerReady: true, accountReady: false, loginVisible: true }), false);
  assert.equal(isConfirmedGeminiLogout({ loginVisible: true, accountReady: false, authUrl: false }), true);
  assert.equal(isConfirmedGeminiLogout({ loginVisible: true, accountReady: true, authUrl: false }), false);
});

test('Gemini page health accepts rendered login and composer surfaces but rejects blank shells', () => {
  assert.equal(assessGeminiPageHealth({ url: 'https://gemini.google.com/app', bodyTextLength: 0 }).usable, false);
  assert.equal(
    assessGeminiPageHealth({
      url: 'https://gemini.google.com/app',
      bodyTextLength: 120,
      composerReady: true,
      loginVisible: true
    }).usable,
    true
  );
  assert.equal(
    assessGeminiPageHealth({ url: 'https://accounts.google.com/v3/signin', bodyTextLength: 60 }).loginSurface,
    true
  );
  assert.equal(
    assessGeminiPageHealth({
      url: 'https://gemini.google.com/',
      bodyTextLength: 180,
      regionBlocked: true
    }).serviceBlocked,
    true
  );
});

test('Gemini model catalog is read from the live menu without hardcoded model names', () => {
  assert.deepEqual(parseGeminiModelOptionLabel('3.5 Flash-Lite\n极速回答'), {
    label: '3.5 Flash-Lite',
    description: '极速回答'
  });
  assert.equal(parseGeminiModelOptionLabel('登录即可使用所有模型\n体验最新 Flash'), undefined);
  assert.deepEqual(parseGeminiModelOptionLabel('已选中\n3.5 Flash-Lite\n极速回答'), {
    label: '3.5 Flash-Lite',
    description: '极速回答'
  });
  assert.equal(isSameGeminiModel('Flash-Lite', '3.5 Flash-Lite'), true);
  assert.equal(isSameGeminiModel('2.5 Pro', '3.1 Pro'), false);
  assert.equal(isSameGeminiModel('3.1 Pro', '3.1 Pro'), true);
  assert.equal(isSameGeminiModel('3.1 Pro', '3.6 Flash'), false);
  assert.deepEqual(
    dedupeGeminiModelOptions([
      { id: 'one', label: '3.5 Flash-Lite', current: true },
      { id: 'two', label: ' 3.5 Flash-Lite ', current: false },
      { id: 'three', label: '3.1 Pro', current: false }
    ]).map((option) => option.id),
    ['one', 'three']
  );
});
