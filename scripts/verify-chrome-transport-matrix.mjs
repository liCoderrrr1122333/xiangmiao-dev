import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeChatGptWindow } from '../dist-electron/main/chromeChatGpt.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.resolve(repoDir, '.tmp');
const unicodeSegment = String.fromCodePoint(0x8000, 0x521b);
const pipeProfile = path.join(tempRoot, `chrome-transport-${unicodeSegment}-${process.pid}`);
const fixedProfile = path.join(tempRoot, `chrome-fixed-${process.pid}`);
const fallbackProfile = path.join(tempRoot, `chrome-fallback-${process.pid}`);

for (const profileDir of [pipeProfile, fixedProfile, fallbackProfile]) {
  if (!profileDir.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error(`Refusing to use an unsafe temporary profile path: ${profileDir}`);
  }
}

fs.mkdirSync(pipeProfile, { recursive: true });
fs.writeFileSync(path.join(pipeProfile, 'DevToolsActivePort'), '1\n/stale', 'utf8');
fs.writeFileSync(path.join(pipeProfile, 'XiangmaoDevToolsPort'), '1', 'utf8');

const diagnostics = [];
let pipeWindow;
let fixedWindow;
let fallbackWindow;
const childWindows = [];
let occupiedServer;
try {
  pipeWindow = await createChromeChatGptWindow({
    profileDir: pipeProfile,
    url: 'about:blank',
    mode: 'background',
    onDiagnostic: (event, payload) => diagnostics.push({ event, payload })
  });
  const hiddenConfirmed = await pipeWindow.waitForVisibility();
  const webdriver = await pipeWindow.webContents.executeJavaScript('navigator.webdriver', true);
  const pipeChildOne = await pipeWindow.createTab?.('about:blank');
  const pipeChildTwo = await pipeWindow.createTab?.('about:blank');
  if (!pipeChildOne || !pipeChildTwo) throw new Error('Pipe transport did not expose isolated tab creation.');
  childWindows.push(pipeChildOne, pipeChildTwo);
  await pipeWindow.webContents.executeJavaScript('globalThis.__xiangmaoLane = "root"', true);
  await pipeChildOne.webContents.executeJavaScript('globalThis.__xiangmaoLane = "lane-2"', true);
  await pipeChildTwo.webContents.executeJavaScript('globalThis.__xiangmaoLane = "lane-3"', true);
  const pipeTabValues = await Promise.all(
    [pipeWindow, pipeChildOne, pipeChildTwo].map((window) =>
      window.webContents.executeJavaScript('globalThis.__xiangmaoLane', true)
    )
  );
  pipeChildOne.destroy();
  await wait(350);
  const pipeChildCloseKeepsRoot =
    pipeChildOne.isDestroyed() &&
    !pipeWindow.isDestroyed() &&
    !pipeChildTwo.isDestroyed() &&
    (await pipeWindow.webContents.executeJavaScript('globalThis.__xiangmaoLane', true)) === 'root';
  pipeWindow.show();
  pipeWindow.focus();
  const shownConfirmed = await pipeWindow.waitForVisibility();

  const freePortServer = http.createServer();
  await new Promise((resolve) => freePortServer.listen(0, '127.0.0.1', resolve));
  const fixedPort = freePortServer.address().port;
  await new Promise((resolve) => freePortServer.close(resolve));
  const fixedDiagnostics = [];
  fixedWindow = await createChromeChatGptWindow({
    profileDir: fixedProfile,
    url: 'about:blank',
    mode: 'background',
    port: fixedPort,
    onDiagnostic: (event, payload) => fixedDiagnostics.push({ event, payload })
  });
  const fixedChild = await fixedWindow.createTab?.('about:blank');
  if (!fixedChild) throw new Error('Fixed-port transport did not expose isolated tab creation.');
  childWindows.push(fixedChild);
  await fixedChild.webContents.executeJavaScript('globalThis.__xiangmaoLane = "fixed-child"', true);
  fixedChild.destroy();
  await wait(350);
  const fixedChildCloseKeepsRoot =
    fixedChild.isDestroyed() &&
    !fixedWindow.isDestroyed() &&
    (await fixedWindow.webContents.executeJavaScript('document.readyState', true)) !== '';

  occupiedServer = http.createServer((_request, response) => {
    response.writeHead(404);
    response.end('occupied');
  });
  await new Promise((resolve) => occupiedServer.listen(0, '127.0.0.1', resolve));
  const occupiedPort = occupiedServer.address().port;
  const fallbackDiagnostics = [];
  fallbackWindow = await createChromeChatGptWindow({
    profileDir: fallbackProfile,
    url: 'about:blank',
    mode: 'background',
    port: occupiedPort,
    onDiagnostic: (event, payload) => fallbackDiagnostics.push({ event, payload })
  });

  const pipeReady = diagnostics.find((item) => item.event === 'chrome-launch-ready');
  const fixedReady = fixedDiagnostics.find((item) => item.event === 'chrome-launch-ready');
  const fixedFailure = fallbackDiagnostics.find(
    (item) => item.event === 'chrome-launch-attempt-failed' && item.payload.transport === 'fixed'
  );
  const fallbackReady = fallbackDiagnostics.find((item) => item.event === 'chrome-launch-ready');
  const result = {
    pipePrimary: pipeReady?.payload.transport === 'pipe',
    webdriver,
    hiddenConfirmed,
    shownConfirmed,
    pipeTabIsolation: pipeTabValues.join('|') === 'root|lane-2|lane-3',
    pipeChildCloseKeepsRoot,
    fixedTransport: fixedReady?.payload.transport === 'fixed',
    fixedChildCloseKeepsRoot,
    fixedPortCollisionDetected: Boolean(fixedFailure),
    fixedPortFallback: fallbackReady?.payload.transport === 'pipe',
    browser: pipeWindow.browserLabel,
    unicodeProfile: pipeProfile
  };
  result.passed =
    result.pipePrimary &&
    webdriver === false &&
    hiddenConfirmed &&
    shownConfirmed &&
    result.pipeTabIsolation &&
    result.pipeChildCloseKeepsRoot &&
    result.fixedTransport &&
    result.fixedChildCloseKeepsRoot &&
    result.fixedPortCollisionDetected &&
    result.fixedPortFallback;
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  for (const childWindow of childWindows.reverse()) childWindow.destroy();
  fallbackWindow?.destroy();
  fixedWindow?.destroy();
  pipeWindow?.destroy();
  if (occupiedServer) {
    await new Promise((resolve) => occupiedServer.close(resolve));
  }
  await wait(1800);
  for (const profileDir of [pipeProfile, fixedProfile, fallbackProfile]) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}
