import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeDiagnosticRecord } from '../dist-electron/main/diagnosticRedaction.js';

test('diagnostic records preserve operational context while redacting credentials', () => {
  const sanitized = sanitizeDiagnosticRecord({
    pageUrl: 'https://chatgpt.com/c/example?access_token=top-secret#private',
    authorization: 'Bearer top-secret',
    nested: {
      cookie: 'session=top-secret',
      message: 'request failed for hale@example.com: Bearer another-secret at https://example.com/path?token=hidden',
      sourcePath: 'C:\\Users\\黄尧\\AppData\\Local\\Temp\\private.jpg',
      fileUrl: 'file:///C:/Users/%E9%BB%84%E5%B0%A7/private.jpg',
      accountId: 'account-12345'
    },
    taskIndex: 3
  });

  assert.equal(sanitized.pageUrl, 'https://chatgpt.com/c/example');
  assert.equal(sanitized.authorization, '[redacted]');
  assert.deepEqual(sanitized.nested, {
    cookie: '[redacted]',
    message: 'request failed for [redacted-email]: Bearer [redacted] at https://example.com/path',
    sourcePath: 'C:\\Users\\[redacted]\\AppData\\Local\\Temp\\private.jpg',
    fileUrl: 'file:///C:/Users/[redacted]/private.jpg',
    accountId: '[redacted]'
  });
  assert.equal(sanitized.taskIndex, 3);
});
