import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installerGuid = 'e162eeba-303c-5fe2-92ee-e44a002caae8';

test('renamed product keeps the installer GUID and preserves application data', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '1.2.4');
  assert.equal(pkg.build.appId, 'studio.xiangmao.workshop');
  assert.equal(pkg.build.productName, '像锚');
  assert.equal(pkg.author, '李佳康');
  assert.equal(pkg.build.nsis.guid, installerGuid);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
});

test('upgrade installer checks exact 32-bit identities and stops on uninstall failure', async () => {
  const installer = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  assert.match(installer, /ReadRegStr \$R0 \$\{ROOT_KEY\} "\$\{UNINSTALL_REGISTRY_KEY\}" "UninstallString"/);
  assert.match(installer, /ReadRegStr \$R1 \$\{ROOT_KEY\} "\$\{UNINSTALL_REGISTRY_KEY\}" "Publisher"/);
  assert.match(installer, /\$R1 != "hale & hael"/);
  assert.match(installer, /\$R9 != "耀创工坊"/);
  assert.match(installer, /耀创工坊\.exe/);
  assert.match(installer, /\/KEEP_APP_DATA --updated/);
  assert.match(installer, /安装已停止，未创建第二个安装副本/);
  assert.doesNotMatch(installer, /D:\\Xiangmao-Workshop\\AppData/i);
  assert.doesNotMatch(installer, /RMDir\s+\/r/i);
});
