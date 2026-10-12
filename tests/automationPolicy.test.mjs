import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  chatGptMaxAttemptsPerImage,
  chatGptMinimumSubmissionIntervalMs,
  chatGptParallelLaneStartupIntervalMs,
  hasCompleteUploadEvidence,
  hasExactImageDimensions,
  planImageNormalization,
  nextStableUploadPollCount,
  resolveContainedChild,
  requiredChatGptSubmissionDelay,
  sanitizeWindowsFileName,
  scoreChatGptAnalysisCandidate,
  selectBestChatGptAnalysisCandidate,
  shouldRetryChatGptNoOpSend,
  shouldRetryChatGptBatchItem,
  shouldAcceptChatGptAnalysis,
  shouldRejectSettledStructuredResponse,
  shouldUseChatGptAnalysisTimeoutFallback
} from '../dist-electron/main/automationPolicy.js';

const emptyEvidence = {
  evidenceCount: 0,
  nameHits: 0,
  previewCount: 0,
  removeButtonCount: 0,
  fileInputCount: 0
};

test('ChatGPT submissions and parallel tabs use explicit bounded pacing', () => {
  assert.equal(chatGptMinimumSubmissionIntervalMs, 60_000);
  assert.equal(chatGptParallelLaneStartupIntervalMs, 10_000);
  assert.equal(requiredChatGptSubmissionDelay(0, 100_000), 0);
  assert.equal(requiredChatGptSubmissionDelay(100_000, 105_000), 55_000);
  assert.equal(requiredChatGptSubmissionDelay(100_000, 160_000), 0);
  assert.equal(requiredChatGptSubmissionDelay(100_000, 99_000), 60_000);
});

test('ChatGPT retries one send only when the first click is proven to be a no-op', () => {
  const baseline = { userMessageCount: 4, messageNodeCount: 10 };
  const confirmedNoOp = {
    accepted: false,
    terminalFailure: '',
    composerTextLength: 938,
    attachmentCount: 1,
    userMessageCount: 4,
    messageNodeCount: 10,
    pageChanged: false,
    stopVisible: false,
    busyCount: 0
  };

  assert.equal(shouldRetryChatGptNoOpSend(baseline, confirmedNoOp), true);
  assert.equal(shouldRetryChatGptNoOpSend(baseline, { ...confirmedNoOp, userMessageCount: 5 }), false);
  assert.equal(shouldRetryChatGptNoOpSend(baseline, { ...confirmedNoOp, composerTextLength: 0 }), false);
  assert.equal(shouldRetryChatGptNoOpSend(baseline, { ...confirmedNoOp, busyCount: 1 }), false);
  assert.equal(shouldRetryChatGptNoOpSend(baseline, { ...confirmedNoOp, pageChanged: true }), false);
  assert.equal(shouldRetryChatGptNoOpSend(baseline, { ...confirmedNoOp, terminalFailure: '请求过于频繁' }), false);
});

test('ChatGPT stops waiting once a final structured response is clearly invalid', () => {
  const settledInvalid = {
    hasResponseText: true,
    hasStructuredResponse: false,
    generationActive: false,
    stableForMs: 5_000
  };

  assert.equal(shouldRejectSettledStructuredResponse(settledInvalid), true);
  assert.equal(shouldRejectSettledStructuredResponse({ ...settledInvalid, stableForMs: 4_999 }), false);
  assert.equal(shouldRejectSettledStructuredResponse({ ...settledInvalid, generationActive: true }), false);
  assert.equal(shouldRejectSettledStructuredResponse({ ...settledInvalid, hasStructuredResponse: true }), false);
  assert.equal(shouldRejectSettledStructuredResponse({ ...settledInvalid, hasResponseText: false }), false);
});

test('upload evidence requires every requested attachment to render in the composer', () => {
  assert.equal(
    hasCompleteUploadEvidence(emptyEvidence, {
      ...emptyEvidence,
      expectedCount: 3,
      previewCount: 2,
      evidenceCount: 2
    }),
    false
  );
  assert.equal(
    hasCompleteUploadEvidence(emptyEvidence, {
      ...emptyEvidence,
      expectedCount: 3,
      fileInputCount: 3,
      evidenceCount: 0
    }),
    false
  );
  assert.equal(
    hasCompleteUploadEvidence(emptyEvidence, {
      ...emptyEvidence,
      expectedCount: 3,
      previewCount: 3,
      evidenceCount: 3
    }),
    true
  );
});

test('upload errors never count as success', () => {
  assert.equal(
    hasCompleteUploadEvidence(emptyEvidence, {
      ...emptyEvidence,
      expectedCount: 1,
      previewCount: 1,
      evidenceCount: 1,
      uploadErrorText: 'upload failed'
    }),
    false
  );
});

test('Windows project names cannot escape the desktop folder', () => {
  assert.equal(sanitizeWindowsFileName('..'), '像锚项目');
  assert.equal(sanitizeWindowsFileName('CON'), '_CON');
  assert.equal(sanitizeWindowsFileName('项目:一.'), '项目_一');
  assert.throws(() => resolveContainedChild('C:\\Users\\hale\\Desktop', '..'));
});

test('every generated result with different dimensions is normalized to the original image size', () => {
  assert.equal(planImageNormalization({ width: 1024, height: 1024 }, { width: 1080, height: 1920 }), 'resize-exact');
  assert.equal(planImageNormalization({ width: 512, height: 512 }, { width: 1024, height: 1024 }), 'resize-exact');
  assert.equal(planImageNormalization({ width: 2048, height: 2048 }, { width: 1024, height: 1024 }), 'resize-exact');
  assert.equal(planImageNormalization({ width: 1086, height: 1448 }, { width: 1279, height: 1706 }), 'resize-exact');
  assert.equal(planImageNormalization({ width: 1024, height: 1024 }, { width: 1024, height: 1024 }), 'none');
  assert.equal(hasExactImageDimensions({ width: 1279, height: 1706 }, { width: 1279, height: 1706 }), true);
  assert.equal(hasExactImageDimensions({ width: 1280, height: 1706 }, { width: 1279, height: 1706 }), false);
});

test('upload evidence must stay complete after progress indicators disappear', () => {
  const uploading = {
    ...emptyEvidence,
    expectedCount: 1,
    previewCount: 1,
    evidenceCount: 1,
    busyCount: 1
  };
  const ready = { ...uploading, busyCount: 0 };
  assert.equal(nextStableUploadPollCount(emptyEvidence, uploading, 0), 0);
  assert.equal(nextStableUploadPollCount(emptyEvidence, ready, 0), 1);
  assert.equal(nextStableUploadPollCount(emptyEvidence, ready, 1), 2);
  assert.equal(nextStableUploadPollCount(emptyEvidence, { ...ready, previewCount: 0, evidenceCount: 0 }, 2), 0);
});

test('a missing batch item has a strict three-attempt ceiling', () => {
  assert.equal(chatGptMaxAttemptsPerImage, 3);
  assert.equal(shouldRetryChatGptBatchItem({ attempts: 1, permanentFailure: false, pauseRequested: false }), true);
  assert.equal(shouldRetryChatGptBatchItem({ attempts: 2, permanentFailure: false, pauseRequested: false }), true);
  assert.equal(shouldRetryChatGptBatchItem({ attempts: 3, permanentFailure: false, pauseRequested: false }), false);
  assert.equal(shouldRetryChatGptBatchItem({ attempts: 1, permanentFailure: true, pauseRequested: false }), false);
  assert.equal(shouldRetryChatGptBatchItem({ attempts: 1, permanentFailure: false, pauseRequested: true }), false);
});

test('automation never reads ChatGPT conversation history through private backend endpoints', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /backend-api\/conversation/);
  assert.doesNotMatch(source, /chatGptConversationSnapshotScript/);
});

test('automation source keeps the result-integrity safeguards enabled', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const persistence = await readFile(new URL('../src/main/imagePersistence.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /earlyCandidateKeys/);
  assert.match(source, /data-xiangmao-upload-target/);
  assert.match(source, /data-xiangmao-before-send-image/);
  assert.match(source, /isPreexistingNode/);
  assert.match(source, /isInNewResponse/);
  assert.match(source, /preexisting-node/);
  assert.match(source, /candidateIsPreferred/);
  assert.match(source, /not-assistant-associated/);
  assert.match(source, /chatgpt-automation:result/);
  assert.match(source, /writeGeneratedImageAtomically/);
  assert.match(source, /normalizeImageDataUrlToJpeg/);
  assert.match(persistence, /assertVerifiedJpeg\(await fs\.readFile\(temporaryPath\), target/);
  assert.match(persistence, /assertVerifiedJpeg\(await fs\.readFile\(filePath\), target/);
  assert.match(persistence, /jpegQuality = 96/);
  assert.doesNotMatch(source, /recordStagedPostProcessingItem|reservePostProcessingResultFiles/);
  assert.match(source, /生成完成，已按原图尺寸保存/);
  assert.match(source, /const generationControlActive = snapshot\.busy \|\| snapshot\.stopVisible/);
  assert.match(source, /const pageSettled = !generationControlActive/);
  assert.doesNotMatch(source, /stableForMs >= 20000/);
  assert.match(source, /inspectGeneratedImageBuffer/);
  assert.match(source, /nextGeneratedImageReadinessState/);
  assert.match(source, /dataUrl: readableImage\.dataUrl/);
  assert.match(source, /generated-candidate-unreadable/);
  assert.match(source, /generated-image-timeout/);
  assert.doesNotMatch(source, /const nextStableKey = `\$\{candidate\.sourceType\}\|\$\{candidate\.fingerprint\}.*candidate\.domSignature/);
});

test('all automation-critical page evaluation calls are bounded', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const rawCalls = [...source.matchAll(/\bevalInPage(?:<[^>]+>)?\(/g)];
  assert.equal(rawCalls.length, 2, 'only the evalInPage declaration and its bounded wrapper may call evalInPage');
  assert.match(source, /chatGptMaxAttemptsPerImage/);
  assert.doesNotMatch(source, /canSafelyRetryChatGptSend/);
  assert.match(source, /chatgpt-batch-checkpoint\.json/);
  assert.match(source, /本次不会重复发送/);
  assert.match(source, /未能成功生成\.\{0,20\}\(\?:图片\|图像\)/);
});

test('send acceptance tolerates ChatGPT attachment previews that linger after submit', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const acceptanceSource = source.match(
    /async function waitForChatGptSendAcceptance[\s\S]*?async function waitForChatGptAnalysisResponse/
  )[0];
  const sendSnapshotSource = source.match(
    /const sendAcceptedSnapshotScript[\s\S]*?const chatGptQuotaSnapshotScript/
  )[0];
  assert.match(source, /const promptCleared = Boolean\(textbox\) && !composerText/);
  assert.match(source, /acceptedReason = newUserMessage/);
  assert.match(source, /accepted: Boolean\(acceptedReason\)/);
  assert.doesNotMatch(source, /post-acceptance trusted retry result/);
  assert.match(source, /triggerChatGptSend/);
  assert.match(sendSnapshotSource, /\[role="dialog"\]/);
  assert.match(sendSnapshotSource, /请求过于频繁/);
  assert.match(sendSnapshotSource, /terminalFailure/);
  assert.doesNotMatch(acceptanceSource, /conversationFallbackChecked|readChatGptConversationSnapshot/);
  assert.doesNotMatch(acceptanceSource, />= 2500/);
  assert.doesNotMatch(source, /const composerCleared = Boolean\(textbox\) && !composerText && attachmentCount === 0/);
});

test('ChatGPT analysis accepts complete JSON even when a stale generation control remains', () => {
  assert.equal(
    shouldAcceptChatGptAnalysis({
      hasUsefulText: true,
      hasStructuredAnalysis: true,
      generationActive: true,
      stableForMs: 0
    }),
    true
  );
});

test('ChatGPT analysis waits for unstructured text to settle', () => {
  assert.equal(
    shouldAcceptChatGptAnalysis({
      hasUsefulText: true,
      hasStructuredAnalysis: false,
      generationActive: false,
      stableForMs: 700
    }),
    false
  );
  assert.equal(
    shouldAcceptChatGptAnalysis({
      hasUsefulText: true,
      hasStructuredAnalysis: false,
      generationActive: false,
      stableForMs: 1800
    }),
    true
  );
});

test('ChatGPT analysis timeout keeps useful text instead of reporting a false failure', () => {
  assert.equal(shouldUseChatGptAnalysisTimeoutFallback({ hasUsefulText: true }), true);
  assert.equal(shouldUseChatGptAnalysisTimeoutFallback({ hasUsefulText: false }), false);
});

test('ChatGPT analysis candidate ranking ignores prompt echoes and transient thinking nodes', () => {
  const promptEcho = {
    text: '{"sceneDescription":"场景描述","poseDescription":"姿态描述","faceDirectionDescription":"面部朝向描述","lightingMakeupDescription":"光影妆容描述"}',
    source: 'conversation-turn',
    domIndex: 10,
    isNew: true,
    assistantAssociated: false,
    userAssociated: true,
    composerAssociated: false,
    promptEcho: true,
    structuredFieldHits: 4,
    pendingOnly: false
  };
  const thinking = {
    ...promptEcho,
    text: '正在思考',
    domIndex: 11,
    assistantAssociated: true,
    userAssociated: false,
    promptEcho: false,
    structuredFieldHits: 0,
    pendingOnly: true
  };
  const answer = {
    ...promptEcho,
    text: '{"sceneDescription":"人物坐在室内座椅上，背景有瓷砖墙和桌面物品。","poseDescription":"人物侧坐并靠向椅背，肩颈自然。","faceDirectionDescription":"头部转向画面左侧，视线平静。","lightingMakeupDescription":"冷白光从左前方照亮面部，鼻梁和脸颊有亮面，下颌保留阴影和真实肤质。"}',
    source: 'conversation-turn',
    domIndex: 12,
    assistantAssociated: true,
    userAssociated: false,
    promptEcho: false,
    structuredFieldHits: 4,
    pendingOnly: false
  };

  assert.equal(scoreChatGptAnalysisCandidate(promptEcho), Number.NEGATIVE_INFINITY);
  assert.equal(scoreChatGptAnalysisCandidate(thinking), Number.NEGATIVE_INFINITY);
  assert.equal(selectBestChatGptAnalysisCandidate([promptEcho, thinking, answer]), answer);
});

test('ChatGPT analysis prefers a structured assistant reply over longer unrelated text', () => {
  const unrelated = {
    text: '这是一个很长的页面说明文字。'.repeat(120),
    source: 'message-testid',
    domIndex: 20,
    isNew: false,
    assistantAssociated: false,
    userAssociated: false,
    composerAssociated: false,
    promptEcho: false,
    structuredFieldHits: 0,
    pendingOnly: false
  };
  const answer = {
    ...unrelated,
    text: '{"sceneDescription":"室内生活场景","poseDescription":"人物侧坐","faceDirectionDescription":"面部朝向左侧","lightingMakeupDescription":"冷白光和自然淡妆"}',
    source: 'assistant-testid',
    domIndex: 21,
    isNew: true,
    assistantAssociated: true,
    structuredFieldHits: 4
  };

  assert.equal(selectBestChatGptAnalysisCandidate([unrelated, answer]), answer);
});

test('ChatGPT analysis prefers the complete conversation response when the visible DOM is stale', () => {
  const staleDom = {
    text: '已完成 sceneDescription 分析',
    source: 'assistant-role',
    domIndex: 3,
    isNew: true,
    assistantAssociated: true,
    userAssociated: false,
    composerAssociated: false,
    promptEcho: false,
    structuredFieldHits: 1,
    pendingOnly: false
  };
  const conversationResponse = {
    ...staleDom,
    text: '{"sceneDescription":"室内人物坐在座椅上，背景可见墙面与桌面。","poseDescription":"人物身体侧坐并靠向椅背，肩颈自然。","faceDirectionDescription":"头部朝向画面左侧，视线平静。","lightingMakeupDescription":"冷白光从左前方照亮面部，鼻梁和脸颊保留亮面，下颌保留真实阴影与肤质。"}',
    source: 'conversation-api',
    domIndex: 100001,
    structuredFieldHits: 4
  };

  assert.equal(selectBestChatGptAnalysisCandidate([staleDom, conversationResponse]), conversationResponse);
});

test('ChatGPT analysis accepts structured text from a non-composer artifact or canvas', () => {
  const composer = {
    text: '{"sceneDescription":"模板","poseDescription":"模板","faceDirectionDescription":"模板","lightingMakeupDescription":"模板"}',
    source: 'canvas',
    domIndex: 10,
    isNew: true,
    assistantAssociated: false,
    userAssociated: false,
    composerAssociated: true,
    promptEcho: false,
    structuredFieldHits: 4,
    pendingOnly: false
  };
  const artifact = {
    ...composer,
    text: '{"sceneDescription":"室内生活场景，背景可见墙面与家具。","poseDescription":"人物坐在座椅上，肩颈自然。","faceDirectionDescription":"头部朝向画面左侧，表情平静。","lightingMakeupDescription":"冷白光从左前方照亮面部，保留真实肤质和轻微噪点。"}',
    source: 'artifact',
    domIndex: 11,
    assistantAssociated: true,
    composerAssociated: false
  };

  assert.equal(scoreChatGptAnalysisCandidate(composer), Number.NEGATIVE_INFINITY);
  assert.equal(selectBestChatGptAnalysisCandidate([composer, artifact]), artifact);
});

test('ChatGPT analysis source keeps all reply candidates, the best earlier snapshot, and a longer response window', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(source, /selectBestChatGptAnalysisCandidate/);
  assert.match(source, /conversation-turn/);
  assert.match(source, /let bestSnapshot/);
  assert.match(source, /analysis-no-usable-text/);
  assert.match(source, /chatGptAnalysisRunning/);
  assert.match(source, /async function analyzeMainImageWithChatGpt[\s\S]*?resetChatGptComposer\(event, win, automationUrl, 'analysis'\)/);
  assert.match(source, /async function automateChatGptSend[\s\S]*?resetChatGptComposer\(event, win, automationUrl\)/);
  assert.match(source, /chatGptAnalysisInitialWaitMs = 240_000/);
  assert.match(source, /chatGptAnalysisRecoveryWaitMs = 180_000/);
  assert.match(source, /canContinueReadOnlyChatGptAnalysis/);
  assert.doesNotMatch(source, /analysis-result-navigation-fallback|analysis-result-recovery/);
  assert.match(source, /analysis-primary-wait-incomplete/);
  assert.match(source, /analysis-conversation-preserved-for-recovery/);
  assert.match(source, /recoverPendingChatGptAnalysis/);
  assert.match(source, /chatgpt-analysis-pending\.json/);
  assert.match(source, /不会重复上传或发送/);
  assert.match(source, /不要创建文稿、Canvas、画布、Artifact/);
  assert.match(source, /accepting useful text after UI completion timeout/);
  assert.doesNotMatch(
    source,
    /chatGptConversationSnapshotScript|backend-api\/conversation|conversation-api-user-message/
  );
  assert.doesNotMatch(source, /activateImageModeScript|verifyImageModeScript|正在确认 ChatGPT 图片入口|已选择创建图片模式/);
});

test('wardrobe references stay separated and are included in automation', async () => {
  const [mainSource, promptSource, panelSource] = await Promise.all([
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/prompt/wardrobePrompt.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/components/WardrobeReferencePanel.tsx', import.meta.url), 'utf8')
  ]);
  assert.match(mainSource, /const wardrobeFiles: string\[\] = \[\]/);
  assert.match(mainSource, /const automationFilePaths = \[circlePath\]/);
  assert.match(mainSource, /automationUploadFiles: \[circleName, \.\.\.refFiles, \.\.\.wardrobeFiles\]/);
  assert.doesNotMatch(mainSource, /const automationFilePaths = \[mainPath, circlePath\]/);
  assert.doesNotMatch(mainSource, /automationUploadFiles: \[mainName, circleName/);
  assert.match(mainSource, /01_红圈蒙脸主垫图\.png/);
  assert.match(mainSource, /请完整读取附件文件名和下方提示词中定义的素材职责/);
  assert.match(mainSource, /const geminiAttachmentOrder = files\.map/);
  assert.match(mainSource, /async function automateGeminiSend[\s\S]*?const promptForComposer = `本轮附件顺序如下/);
  assert.doesNotMatch(mainSource, /第 1 张是无标记原图/);
  assert.match(mainSource, /automationFilePaths\.push\(filePath\)/);
  assert.match(mainSource, /if \(files\.length > 1\)/);
  assert.match(mainSource, /for \(let index = 0; index < files\.length; index \+= 1\)/);
  assert.match(mainSource, /\(confirmation\?\.busyCount \|\| 0\) > 0/);
  assert.match(promptSource, /不要混用人脸参考图和穿搭参考图的职责/);
  assert.match(promptSource, /穿搭参考图是对应服饰外观的唯一基准/);
  assert.match(panelSource, /className="panel wardrobe-panel"/);
});

test('red-circle-only sending stays available without uploading the unmarked original', async () => {
  const [appSource, mainSource] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  ]);
  const sendFlow = appSource.match(/async function sendToChatGPT\(\)[\s\S]*?\n  async function exportRedCircle/)[0];
  const packageFlow = mainSource.match(
    /registerTrustedIpcHandler\('send:create-package'[\s\S]*?registerTrustedIpcHandler\('api:generate'/
  )[0];

  assert.doesNotMatch(sendFlow, /!project\.faceOcclusionEnabled|!project\.faceOcclusionMask/);
  assert.match(sendFlow, /const faceOcclusionApplied = Boolean\(/);
  assert.match(sendFlow, /faceOcclusionApplied \? project\.faceOcclusionMask : undefined/);
  assert.match(sendFlow, /const circleImageName = faceOcclusionApplied\s*\? '01_红圈蒙脸主垫图\.png'\s*:\s*'01_红圈主垫图\.png'/);
  assert.match(sendFlow, /circleImageName,/);
  assert.match(packageFlow, /if \(!project\.maskCircle\) throw new Error\('请先在原图上标记红圈。'\)/);
  assert.doesNotMatch(packageFlow, /尚未完成一键蒙脸|为避免上传未遮挡原图/);
  assert.match(packageFlow, /const faceOcclusionApplied = Boolean\(/);
  assert.match(packageFlow, /const circleName = faceOcclusionApplied\s*\? '01_红圈蒙脸主垫图\.png'\s*:\s*'01_红圈主垫图\.png'/);
  assert.match(packageFlow, /const automationFilePaths = \[circlePath\]/);
  assert.doesNotMatch(packageFlow, /const automationFilePaths = \[mainPath, circlePath\]/);
  assert.match(packageFlow, /automationUploadFiles: \[circleName, \.\.\.refFiles, \.\.\.wardrobeFiles\]/);
});
