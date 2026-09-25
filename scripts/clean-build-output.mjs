import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const outputDirectories = ['dist', 'dist-electron'];

for (const directoryName of outputDirectories) {
  const target = path.resolve(projectRoot, directoryName);
  if (path.dirname(target) !== projectRoot) {
    throw new Error(`Refusing to clean an unexpected build path: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}
