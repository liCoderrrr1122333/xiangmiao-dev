import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronExecutable = process.platform === 'win32'
  ? path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(projectRoot, 'node_modules', '.bin', 'electron');
const harness = path.join(projectRoot, 'scripts', 'result-persistence-harness');
const result = spawnSync(electronExecutable, [harness], {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: 'pipe',
  windowsHide: true,
  timeout: 90_000
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`结果保存验证失败（退出码 ${result.status ?? 'unknown'}）。`);
console.log('Result persistence verification passed.');
