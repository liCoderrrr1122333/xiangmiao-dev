import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSafelyRetryGeminiSend,
  classifyGeminiFailure,
  hasGeminiSendBeenAccepted,
  selectGeminiImageCandidate,
  selectGeminiFailureText,
  selectGeminiTextResult
} from '../src/main/geminiAutomationPolicy.ts';

test('Gemini result selection uses the pre-send image baseline instead of unrelated DOM response indices', () => {
  const selected = selectGeminiImageCandidate(new Set(['https://example.test/old.png']), [
    {
      responseIndex: 0,
      imageIndex: 0,
      src: 'https://example.test/old.png',
      width: 1024,
      height: 1024,
      alt: 'old result',
      visible: true
    },
    {
      responseIndex: 0,
      imageIndex: 1,
      src: 'https://example.test/new.png',
      width: 1280,
      height: 1024,
      alt: 'AI generated professional desktop application icon',
      visible: true
    }
  ]);
  assert.equal(selected?.src, 'https://example.test/new.png');
});

test('Gemini only retries an unaccepted send when the original composer is provably intact', () => {
  const baseline = { userMessageCount: 2, responseCount: 3, href: 'https://gemini.google.com/app/fixture' };
  assert.equal(canSafelyRetryGeminiSend(baseline, {
    composerTextLength: 120,
    attachmentCount: 2,
    userMessageCount: 2,
    responseCount: 3,
    busy: false,
    href: baseline.href
  }), true);
  assert.equal(canSafelyRetryGeminiSend(baseline, {
    composerTextLength: 120,
    attachmentCount: 2,
    userMessageCount: 3,
    responseCount: 3,
    busy: false,
    href: baseline.href
  }), false, 'a new user message means the first send may already have been accepted');
  assert.equal(canSafelyRetryGeminiSend(baseline, {
    composerTextLength: 120,
    attachmentCount: 2,
    userMessageCount: 2,
    responseCount: 4,
    busy: false,
    href: baseline.href
  }), false, 'a new response must prevent duplicate submission');
  assert.equal(canSafelyRetryGeminiSend(baseline, {
    composerTextLength: 120,
    attachmentCount: 2,
    userMessageCount: 2,
    responseCount: 3,
    busy: false,
    href: 'https://gemini.google.com/app/new-conversation'
  }), false, 'a route change is observable send progress');
});

test('Gemini failures stop waiting as soon as the page gives a terminal reason', () => {
  assert.deepEqual(classifyGeminiFailure('Gemini 暂不支持当前地区。'), {
    code: 'region-blocked',
    global: true,
    retryable: false
  });
  assert.deepEqual(classifyGeminiFailure('你已达到 Gemini 的使用上限，请稍后再试。'), {
    code: 'quota-exceeded',
    global: true,
    retryable: false
  });
  assert.deepEqual(classifyGeminiFailure('请求过于频繁，请稍后重试。'), {
    code: 'rate-limited',
    global: false,
    retryable: true
  });
  assert.deepEqual(classifyGeminiFailure('我目前无法为你生成这张图片。'), {
    code: 'generation-failed',
    global: false,
    retryable: true
  });
  assert.deepEqual(classifyGeminiFailure('我只是一个语言模型，不具备这方面的信息或能力，因此没法帮到你。'), {
    code: 'generation-failed',
    global: false,
    retryable: false
  });
  assert.deepEqual(classifyGeminiFailure('由于您没有附带或上传需要分析的人像照片拼图，无法直接观察。'), {
    code: 'attachment-missing',
    global: false,
    retryable: true
  });
  assert.equal(classifyGeminiFailure('这是本轮正常的图片说明。'), undefined);
});

test('Gemini send acceptance requires observable page progress instead of a click alone', () => {
  const baseline = { userMessageCount: 2, responseCount: 2, href: 'https://gemini.google.com/app' };
  assert.equal(
    hasGeminiSendBeenAccepted(baseline, {
      composerTextLength: 20,
      attachmentCount: 1,
      userMessageCount: 2,
      responseCount: 2,
      busy: false,
      href: baseline.href
    }),
    false
  );
  assert.equal(
    hasGeminiSendBeenAccepted(baseline, {
      composerTextLength: 0,
      attachmentCount: 1,
      userMessageCount: 3,
      responseCount: 2,
      busy: true,
      href: baseline.href
    }),
    false,
    'a transient busy shell on the fresh entry route is not a persisted conversation'
  );
  assert.equal(
    hasGeminiSendBeenAccepted(baseline, {
      composerTextLength: 0,
      attachmentCount: 0,
      userMessageCount: 3,
      responseCount: 3,
      busy: true,
      href: 'https://gemini.google.com/app/fixture-conversation'
    }),
    true,
    'a fresh Gemini send is accepted only after the conversation route is persisted'
  );
  assert.equal(
    hasGeminiSendBeenAccepted(
      { userMessageCount: 2, responseCount: 2, href: 'https://gemini.google.com/app/existing' },
      {
        composerTextLength: 0,
        attachmentCount: 0,
        userMessageCount: 3,
        responseCount: 2,
        busy: false,
        href: 'https://gemini.google.com/app/existing'
      }
    ),
    true,
    'an existing conversation can prove acceptance with a new top-level user message'
  );
});

test('Gemini text analysis only accepts a new model response after the send baseline', () => {
  const selected = selectGeminiTextResult(
    { responseCount: 3 },
    [
      { index: 1, text: '旧回复' },
      { index: 2, text: '用户提示词回显', userEcho: true },
      { index: 3, text: '{"sceneDescription":"室内"}', streaming: false }
    ]
  );
  assert.equal(selected?.text, '{"sceneDescription":"室内"}');
  assert.equal(selectGeminiTextResult({ responseCount: 3 }, [{ index: 2, text: '旧回复' }]), undefined);
});

test('Gemini failure detection ignores responses that predate the current send baseline', () => {
  const candidates = [
    { index: 0, text: 'You have reached your usage limit.' },
    { index: 1, text: 'The current request is still generating.', streaming: true }
  ];
  assert.equal(selectGeminiFailureText({ responseCount: 1 }, candidates, ''), 'The current request is still generating.');
  assert.equal(selectGeminiFailureText({ responseCount: 2 }, candidates, ''), '');
  assert.equal(selectGeminiFailureText({ responseCount: 2 }, candidates, 'Network error'), 'Network error');
});
