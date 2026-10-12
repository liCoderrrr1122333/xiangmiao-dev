import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const executablePath = process.env.XIANGMAO_TEST_EXECUTABLE;
const artifacts = `D:/Xiangmao-Workshop/TestArtifacts/free-api-face-${Date.now()}`;
const userData = path.join(artifacts, 'user-data');
const desktop = path.join(artifacts, 'desktop');
await mkdir(userData, { recursive: true });
await mkdir(desktop, { recursive: true });
const fixtureKey = 'fake-local-fixture-only-5821';
const output = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#759ba1' } }).png().toBuffer();
const calls = [];
const server = createServer(async (req, res) => {
  for await (const _chunk of req) { /* Consume uploaded fixture images without logging them. */ }
  calls.push({ method: req.method, path: req.url });
  if (req.headers.authorization !== `Bearer ${fixtureKey}`) { res.writeHead(401); res.end('{}'); return; }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'gpt-image-2' }, { id: 'fixture-banana' }] }));
  else if (req.url === '/v1/images/edits') res.end(JSON.stringify({ data: [{ b64_json: output.toString('base64') }] }));
  else if (req.url === '/custom/fixture-banana:streamGenerateContent?alt=sse') {
    res.setHeader('content-type', 'text/event-stream');
    res.end('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: output.toString('base64') } }] } }] }) + '\n\n');
  } else { res.writeHead(404); res.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let app;
let page;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath, args: executablePath ? [] : [root], cwd: root, env: { ...process.env, XIANGMAO_USER_DATA_DIR: userData } });
  await app.evaluate(({ app }, desktop) => app.setPath('desktop', desktop), desktop);
  page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.locator('#root').waitFor();
  const notice = page.getByRole('button', { name: '我已确认，进入像锚' });
  if (await notice.waitFor({state:'visible',timeout:5000}).then(()=>true).catch(()=>false)) {
    await notice.click();
    await notice.waitFor({state:'detached'});
  }
}
async function openConfig() {
  await closePreview();
  const route = page.getByRole('button', {name:/制作通道/});
  if (await route.getAttribute('aria-expanded') === 'false') await route.click();
  await page.getByRole('button', {name:/^(配置 API|API 已配置)$/}).click();
  return page.getByRole('dialog', {name:'配置自由 API'});
}
async function closePreview() {
  const close=page.getByRole('button',{name:'关闭预览',exact:true});
  if(await close.isVisible()) await close.click();
}
async function assertVisibleFit(dialog) {
  const metrics = await dialog.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:innerWidth, height:innerHeight, overflow:el.scrollWidth > el.clientWidth + 1 };
  });
  assert.ok(metrics.left >= 0 && metrics.top >= 0 && metrics.right <= metrics.width && metrics.bottom <= metrics.height);
  assert.equal(metrics.overflow, false);
}
try {
  await launch();
  let dialog = await openConfig();
  assert.equal(await dialog.getByLabel('服务地址（Base URL）').inputValue(), '');
  assert.equal(await dialog.getByLabel('API Key', {exact:true}).inputValue(), '');
  await dialog.getByLabel('服务地址（Base URL）').fill(baseUrl + '/v1/');
  await dialog.getByLabel('API Key', {exact:true}).fill(fixtureKey);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', {name:'保存并测试'}).click();
  await dialog.getByText(/API 已连接/).waitFor();
  await assertVisibleFit(dialog);
  await page.screenshot({path:path.join(artifacts,'api-basic.png')});
  const stored = await readFile(path.join(userData, 'relay-api-key.bin'));
  assert.equal(stored.includes(Buffer.from(fixtureKey)), false);
  assert.equal(stored.includes(Buffer.from(baseUrl)), false);
  await app.close();
  await launch();
  dialog = await openConfig();
  assert.equal(await dialog.getByLabel('服务地址（Base URL）').inputValue(), baseUrl);
  assert.equal(await dialog.getByLabel('API Key', {exact:true}).inputValue(), '');
  await dialog.getByLabel('服务地址（Base URL）').fill('https://uncontacted.example.test');
  await dialog.getByRole('button', {name:'测试连接',exact:true}).click();
  await dialog.getByText(/重新粘贴该服务/).waitFor();
  assert.equal(calls.length,1,'editing a destination cannot silently forward a remembered key');
  await dialog.getByLabel('服务地址（Base URL）').fill(baseUrl);
  await dialog.getByRole('button', {name:'关闭 API 配置'}).click();

  const fixtureImage = path.join(root,'public','xiangmao-unified-v2.png');
  await page.locator('#main-upload-input').setInputFiles(fixtureImage);
  await page.getByTitle('绘制红圈').click();
  const canvas = await page.locator('.canvas-wrap canvas').boundingBox();
  await page.mouse.move(canvas.x+canvas.width*.35, canvas.y+canvas.height*.25);
  await page.mouse.down();
  await page.mouse.move(canvas.x+canvas.width*.65, canvas.y+canvas.height*.65,{steps:6});
  await page.mouse.up();
  await page.getByText('红圈已锁定',{exact:true}).waitFor();
  await page.locator('#ref-upload-input').setInputFiles(fixtureImage);
  await page.getByRole('button',{name:'一键生成提示词',exact:true}).click();
  await page.getByRole('button',{name:/开始做图/}).click();
  await page.getByText('API 批量生成完成，已保存 1 张。',{exact:true}).waitFor({timeout:45000});
  assert.equal(calls.filter(c=>c.method==='POST').length,1);

  dialog = await openConfig();
  await dialog.locator('summary').click();
  await dialog.getByRole('radio',{name:/香蕉生图/}).click();
  await dialog.getByLabel('模型名称',{exact:true}).fill('fixture-banana');
  await dialog.getByLabel('图片编辑接口路径',{exact:true}).fill('/custom/{model}:streamGenerateContent');
  await dialog.getByLabel('API Key',{exact:true}).fill(fixtureKey);
  await dialog.getByRole('button',{name:'保存并测试'}).click();
  await dialog.getByText(/API 已连接/).waitFor();
  await assertVisibleFit(dialog);
  await page.screenshot({path:path.join(artifacts,'api-advanced.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,740));
  await assertVisibleFit(dialog);
  await page.screenshot({path:path.join(artifacts,'api-compact.png')});
  await dialog.getByRole('button',{name:'关闭 API 配置'}).click();
  await page.getByRole('button',{name:'一键生成提示词',exact:true}).click();
  await page.getByRole('button',{name:/重新生成/}).click();
  await page.waitForFunction(() => !document.querySelector('.chatgpt-generate-button')?.disabled,undefined,{timeout:45000});
  // A successful journal is removed; verify the second output was saved.
  await new Promise((resolve,reject)=>{
    const started=Date.now(); const check=async()=>{
      try { const files=await readdir(desktop,{recursive:true});
        if(calls.filter(c=>c.method==='POST').length===2 && files.filter(f=>/项目_\d+\.png$/.test(f)).length===2) return resolve();
      } catch {}
      if(Date.now()-started>45000) return reject(new Error('banana fixture batch did not save'));
      setTimeout(check,200);
    }; void check();
  });
  assert.equal(calls.filter(c=>c.method==='POST').length,2);
  await closePreview();

  // Exercise actual MediaPipe and IPC with an existing local portrait fixture, never a remote upload.
  await page.getByTitle('查看全部结果',{exact:true}).click();
  await page.locator('#result-upload-input').setInputFiles('D:/Xiangmao-Workshop/TestArtifacts/1.1.5-camera-realism-strength/strength-10.jpg');
  await page.getByRole('button',{name:'关闭预览',exact:true}).waitFor({timeout:10000});
  await closePreview();
  await page.getByRole('button',{name:'提示词',exact:true}).click();
  await page.getByRole('button',{name:'批量面部自然化',exact:true}).click();
  const faceDialog=page.getByRole('dialog',{name:'批量面部自然化'});
  await faceDialog.getByRole('button',{name:'清空',exact:true}).click();
  await faceDialog.locator('label').filter({has:page.locator('img[alt*="strength-10"]')}).locator('input[type=checkbox]').check();
  await faceDialog.getByRole('button',{name:/批量处理/}).click();
  await faceDialog.waitFor({state:'detached',timeout:60000});
  console.log(await page.locator('body').innerText().then(text=>text.split('\n').filter(line=>/面部自然化完成|首个原因/.test(line)).join('\n')));
  await page.screenshot({path:path.join(artifacts,'face-result.png')});
  const files=await readdir(desktop,{recursive:true});
  assert.ok(files.some(f=>f.endsWith('_面部自然化.png')),'real portrait must produce a face PNG');
  const savedFace=files.find(f=>f.endsWith('_面部自然化.png'));
  const meta=await sharp(path.join(desktop,savedFace)).metadata();
  assert.equal(meta.width,1086); assert.equal(meta.height,1449);
  const settings=await readFile(path.join(userData,'settings.json'),'utf8');
  assert.equal(settings.includes(fixtureKey),false);
  const log=await readFile(path.join(userData,'logs','chatgpt-automation.ndjson'),'utf8');
  assert.equal(log.includes(fixtureKey),false);
  dialog=await openConfig();
  await dialog.getByRole('button',{name:'清除密钥'}).click();
  await dialog.getByText('自由 API 配置和密钥已清除。').waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,artifacts,runtime:executablePath?'packaged':'source',realPaidRequests:0,localFixturePosts:2,faceSize:[meta.width,meta.height],rendererErrors:errors}));
} catch(error) {
  if(page) await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});
  console.error(JSON.stringify({artifacts,error:error.message}));
  process.exitCode=1;
} finally {
  if(app) await app.close();
  await new Promise(resolve=>server.close(resolve));
}
