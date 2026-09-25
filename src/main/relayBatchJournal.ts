import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const RELAY_BATCH_JOURNAL_VERSION = 1;
const RELAY_BATCH_JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RelayBatchTaskPhase =
  | 'prepared'
  | 'submitting'
  | 'saved'
  | 'uncertain'
  | 'failed'
  | 'cancelled';

export interface RelayBatchJournalTask {
  taskNumber: number;
  phase: RelayBatchTaskPhase;
  updatedAt: number;
  laneId?: number;
  requestId?: string;
  errorCode?: string;
  message?: string;
  savedPath?: string;
  sequence?: number;
}

export interface RelayBatchJournal {
  version: 1;
  jobKey: string;
  total: number;
  model: string;
  resultSequenceStart: number;
  targetDimensions: { width: number; height: number };
  tasks: RelayBatchJournalTask[];
  createdAt: number;
  updatedAt: number;
}

export interface RelayBatchJournalInput {
  jobKey: string;
  total: number;
  model: string;
  resultSequenceStart: number;
  targetDimensions: { width: number; height: number };
}

export interface RelayBatchJobKeyInput {
  endpointIdentity?: string;
  projectName: string;
  prompt: string;
  total: number;
  model: string;
  targetDimensions: { width: number; height: number };
  attachments: Array<{ name: string; data: Buffer }>;
}

const validPhases = new Set<RelayBatchTaskPhase>([
  'prepared',
  'submitting',
  'saved',
  'uncertain',
  'failed',
  'cancelled'
]);

function writeLengthPrefixed(hash: crypto.Hash, value: string | Buffer) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(data.length));
  hash.update(length);
  hash.update(data);
}

export function buildRelayBatchJobKey(input: RelayBatchJobKeyInput) {
  const hash = crypto.createHash('sha256');
  writeLengthPrefixed(hash, input.endpointIdentity || '');
  writeLengthPrefixed(hash, input.projectName);
  writeLengthPrefixed(hash, input.prompt);
  writeLengthPrefixed(hash, String(input.total));
  writeLengthPrefixed(hash, input.model);
  writeLengthPrefixed(hash, `${input.targetDimensions.width}x${input.targetDimensions.height}`);
  for (const attachment of input.attachments) {
    writeLengthPrefixed(hash, attachment.name);
    writeLengthPrefixed(hash, attachment.data);
  }
  return hash.digest('hex');
}

export function createRelayBatchJournal(
  input: RelayBatchJournalInput,
  now = Date.now()
): RelayBatchJournal {
  return {
    version: RELAY_BATCH_JOURNAL_VERSION,
    jobKey: input.jobKey,
    total: input.total,
    model: input.model,
    resultSequenceStart: input.resultSequenceStart,
    targetDimensions: { ...input.targetDimensions },
    tasks: Array.from({ length: input.total }, (_, index) => ({
      taskNumber: index + 1,
      phase: 'prepared' as const,
      updatedAt: now
    })),
    createdAt: now,
    updatedAt: now
  };
}

export function transitionRelayBatchTask(
  journal: RelayBatchJournal,
  taskNumber: number,
  phase: RelayBatchTaskPhase,
  patch: Partial<Omit<RelayBatchJournalTask, 'taskNumber' | 'phase' | 'updatedAt'>> = {},
  now = Date.now()
): RelayBatchJournal {
  if (!Number.isInteger(taskNumber) || taskNumber < 1 || taskNumber > journal.total) {
    throw new Error(`Invalid relay task number: ${taskNumber}`);
  }
  return {
    ...journal,
    tasks: journal.tasks.map((task) => task.taskNumber === taskNumber
      ? { ...task, ...patch, taskNumber, phase, updatedAt: now }
      : { ...task }),
    updatedAt: now
  };
}

export function relayBatchResumePlan(
  input: RelayBatchJournal,
  now = Date.now(),
  options: { retryUncertain?: boolean } = {}
) {
  let journal = input;
  for (const task of input.tasks) {
    if (task.phase === 'submitting') {
      journal = transitionRelayBatchTask(journal, task.taskNumber, 'uncertain', {
        errorCode: 'RESULT_UNCERTAIN',
        message: '上次运行在提交后中断，无法确认服务端是否已生成结果。'
      }, now);
    }
  }

  const completedTaskNumbers: number[] = [];
  const uncertainTaskNumbers: number[] = [];
  const pendingTaskNumbers: number[] = [];
  for (const task of journal.tasks) {
    if (task.phase === 'saved') completedTaskNumbers.push(task.taskNumber);
    if (task.phase === 'uncertain') uncertainTaskNumbers.push(task.taskNumber);
    if (
      ['prepared', 'failed', 'cancelled'].includes(task.phase)
      || (options.retryUncertain && task.phase === 'uncertain')
    ) {
      pendingTaskNumbers.push(task.taskNumber);
    }
  }

  return { journal, completedTaskNumbers, uncertainTaskNumbers, pendingTaskNumbers };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isRelayBatchJournal(value: unknown, now: number): value is RelayBatchJournal {
  if (!value || typeof value !== 'object') return false;
  const journal = value as Partial<RelayBatchJournal>;
  if (journal.version !== RELAY_BATCH_JOURNAL_VERSION) return false;
  if (typeof journal.jobKey !== 'string' || !/^[a-f0-9]{64}$/.test(journal.jobKey)) return false;
  if (!isPositiveInteger(journal.total) || typeof journal.model !== 'string') return false;
  if (!isPositiveInteger(journal.resultSequenceStart)) return false;
  if (!journal.targetDimensions || !isPositiveInteger(journal.targetDimensions.width)
    || !isPositiveInteger(journal.targetDimensions.height)) return false;
  if (!Array.isArray(journal.tasks) || journal.tasks.length !== journal.total) return false;
  if (typeof journal.createdAt !== 'number' || typeof journal.updatedAt !== 'number') return false;
  if (now - journal.updatedAt > RELAY_BATCH_JOURNAL_MAX_AGE_MS || journal.updatedAt > now + 60_000) return false;

  return journal.tasks.every((task, index) => (
    task
    && task.taskNumber === index + 1
    && validPhases.has(task.phase)
    && typeof task.updatedAt === 'number'
  ));
}

export async function writeRelayBatchJournalAtomically(
  filePath: string,
  journal: RelayBatchJournal
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(journal, null, 2), 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function readRelayBatchJournal(filePath: string, now = Date.now()) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    return isRelayBatchJournal(parsed, now) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
