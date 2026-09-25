import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  explainOllamaFailure,
  isSameOllamaModel,
  parseOllamaJsonObject,
  selectOllamaVisionModels
} from '../dist-electron/main/ollamaVisionPolicy.js';

const installedModels = [
  { name: 'qwen2.5:3b', size: 1_900_000_000, capabilities: ['completion', 'tools'] },
  { name: 'minicpm-v:latest', size: 5_500_000_000, capabilities: ['completion', 'vision'] },
  { name: 'moondream:latest', size: 1_700_000_000, capabilities: ['completion', 'vision'] },
  { name: 'gemma3:4b', size: 3_300_000_000, capabilities: ['completion', 'vision'] },
  { name: 'llava:7b', size: 4_700_000_000, capabilities: ['completion', 'vision'] }
];

test('automatic Ollama selection prefers the verified responsive local model and excludes text-only models', () => {
  const selected = selectOllamaVisionModels(installedModels, 'auto');
  assert.deepEqual(selected.map((model) => model.name), ['gemma3:4b', 'minicpm-v:latest', 'llava:7b', 'moondream:latest']);
  assert.equal(selected.some((model) => model.name === 'qwen2.5:3b'), false);
});

test('an explicit installed model is honored before automatic fallbacks', () => {
  const selected = selectOllamaVisionModels(installedModels, 'llava:7b', 'gemma3:4b');
  assert.equal(selected[0].name, 'llava:7b');
  assert.equal(selected[1].name, 'gemma3:4b');
});

test('latest aliases resolve to the installed Ollama model', () => {
  assert.equal(isSameOllamaModel('minicpm-v', 'minicpm-v:latest'), true);
  const selected = selectOllamaVisionModels(installedModels, 'minicpm-v');
  assert.equal(selected[0].name, 'minicpm-v:latest');
});

test('Ollama out-of-memory errors are diagnosed instead of reported as a stopped service', () => {
  const result = explainOllamaFailure('llama-server reported out-of-memory: failed to allocate buffer', 'minicpm-v:latest');
  assert.equal(result.code, 'out_of_memory');
  assert.match(result.message, /内存不足/);
  assert.doesNotMatch(result.message, /未启动/);
});

test('Ollama JSON with a Chinese closing quote is repaired without losing analysis fields', () => {
  const parsed = parseOllamaJsonObject(
    '{"sceneDescription":"室内场景","poseDescription":"身体前倾","faceDirectionDescription":"头部侧向","lightingMakeupDescription":"柔和顶光","precisionNotes":"保持原图。”}\u00a0'
  );
  assert.equal(parsed.sceneDescription, '室内场景');
  assert.equal(parsed.precisionNotes, '保持原图。');
});

test('local analysis and web pose reuse the successful visual model instead of unloading it after every request', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const analysis = source.slice(
    source.indexOf('async function analyzeMainImageWithOllama('),
    source.indexOf('async function analyzeMainImageWithChatGpt(')
  );
  const pose = source.slice(
    source.indexOf('async function analyzeWebPosesWithOllama('),
    source.indexOf('async function analyzeWebPosesWithGemini(')
  );
  assert.match(analysis, /keep_alive: '10m'/);
  assert.match(pose, /keep_alive: '10m'/);
  assert.doesNotMatch(analysis + pose, /keep_alive: 0/);
});

test('local visual requests keep a measured first-run completion window without excessive pose output', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const analysis = source.slice(
    source.indexOf('async function analyzeMainImageWithOllama('),
    source.indexOf('async function analyzeMainImageWithChatGpt(')
  );
  const pose = source.slice(
    source.indexOf('async function analyzeWebPosesWithOllama('),
    source.indexOf('async function analyzeWebPosesWithGemini(')
  );
  assert.match(analysis, /180_000/);
  assert.match(pose, /180_000/);
  assert.match(pose, /num_predict: 900/);
});
