import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('macOS 图标只能在 Mac 上通过 sips 和 iconutil 生成。');
}

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = path.join(root, 'build', 'yaochuang-mascot-source.png');
const output = path.join(root, 'build', 'icon.icns');
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'yaochuang-icon-'));
const iconset = path.join(temporaryRoot, 'icon.iconset');
await mkdir(iconset);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(command + ' 生成图标失败。');
}

try {
  for (const size of [16, 32, 128, 256, 512]) {
    run('sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, `icon_${size}x${size}.png`)]);
    run('sips', ['-z', String(size * 2), String(size * 2), source, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)]);
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', output]);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(output);
