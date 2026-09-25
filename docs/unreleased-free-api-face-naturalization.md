# 2026-09-07 自由 API 与面部自然化

## 范围

源码版本保持 1.2.4。本次在官方维护工作树增量修改，保留已有未提交改动与此前 ChatGPT 九月网页适配。不提交代码，不自动安装。没有使用真实 Key 或发起付费请求。

## 已实现

- API 基础配置为服务地址和 Key；折叠的接口设置支持协议、模型名称、图片编辑路径和模型列表路径。
- 支持 OpenAI Images multipart 与现有 Bearer 鉴权的 Gemini 流式图片协议，不声称支持任意服务商或任意 JSON 格式。模型列表仍需提供 data[].id；仅有聊天或生成接口不等于支持多图编辑。
- 服务地址保留端口及路径前缀，去掉重复的末尾 /v1 或 /v1beta。远程须 HTTPS，本机允许 HTTP；拒绝 URL 内嵌账号、查询密钥、跨域路径与上级目录。
- 默认地址为空，不再绑定原服务商。已有标准模型和香蕉模型只是协议预设，实际模型名由用户配置，不从 Key 猜测服务商。
- 地址、接口配置与 Key 一起以 safeStorage 加密保存；默认仅当前运行有效。配置不进入项目、普通 settings 或批量断点。旧的仅 Key 加密文件不做迁移，用户须重新填写地址和 Key。
- 换地址、协议、模型或路径必须重新输入 Key；任务保存配置快照，断点标识包含无密钥的接口配置指纹，避免跨服务复用任务状态。
- 带鉴权请求禁止 HTTP 重定向，避免付费 POST 被 307 再提交或转发密钥。保留直连优先、系统代理候选、已发送不确定时禁止付费重投和安全图片下载重试。
- 配置弹窗头尾固定，展开内容独立滚动，小窗口中仍能访问关闭、测试和清除操作。

## 面部自然化根因与修复

1. 识别坐标来自缩略预览，处理却读取完整原图，导致位置缩放不一致。现在显式映射到原始尺寸，宽高比不符或源文件尺寸不符时拒绝处理。
2. 输出 JPEG 会重编码背景且丢失透明度。现在保存独立 PNG，保留解码后的 sRGB 背景 RGBA，不覆盖原图。不是对原文件字节或所有原始色彩空间/元数据无损的承诺。
3. 空蒙版或越界蒙版曾被当成成功。现在准确报错，不生成假成功副本。
4. 真实全身照整图检测遗漏较小面部。新增最多五个局部放大检测窗口，仅在整图无脸时执行，沿用 MediaPipe 和原置信度门槛；识别后仅处理皮肤区域。

未改变整图相机成像模拟及其强度滑块。本功能仍是局部质感协调，不是换脸、五官重建或 AI 检测通过保证。遮挡、极小或模糊面部仍可能被明确拒绝。

## 红绿测试

- 新增 tests/freeRelayApi.test.mjs 4 项：自定义地址/端口/路径/模型、非法配置、接口断点隔离、自定义 Gemini 路径。先复现旧地址限制和重定向未禁止，再修复通过。
- 新增 tests/faceNaturalizationIntegrity.test.mjs 3 项：预览坐标映射、PNG 背景及透明度逐像素保持、空/越界蒙版拒绝。初始失败为模块缺失、JPEG 输出、未拒绝空蒙版；修复后通过。
- 实际 Electron 人像测试先复现“当前结果图没有识别到可处理的人脸”，增加有限局部识别后通过。
- 更新 cameraRealism、relayProviderIntegration、startupNotice、analysisProviderRouting、原 transport 测试与 UI 检查，使断言匹配当前配置和 PNG 输出合同。

## 新鲜验证

- npm test：278/278，退出 0；包含构建与 TypeScript 检查。
- npm run typecheck：退出 0。
- scripts/verify-free-api-face.mjs：实际 Electron + 独立资料 + 本机 API 夹具，标准和自定义香蕉各 1 次 POST，上传、提示词、保存通过；重启后配置恢复、改变地址防误发 Key、加密存储、清除通过；rendererErrors=[]。
- 本地真实人像完整处理成功：1086x1449 PNG。人像只参与本地处理；API 夹具只上传应用图标。
- 对应证据：D:/Yaochuang-Workshop/TestArtifacts/free-api-face-1788788577501，包含 basic/advanced/compact/face-result 截图及独立资料。
- verify-relay-resilience：100 个本地故障注入通过，无真实付费请求；不确定状态不重投、406 熔断、断点恢复通过。
- verify-chatgpt-model-page-fixtures：20 轮通过，退出 0。首次断言已通过但清理 Chrome 临时文件 EPERM；独立重跑后正常退出。
- verify-chatgpt-upload-page-fixtures、verify-electron-shell、run-result-persistence-verification、verify-web-pose-ui、verify-adaptive-canvas-ui、verify-face-occlusion-ui、verify-gemini-page-fixtures 均退出 0。
- verify-glass-workbench-ui：修正旧专属 API 文案断言后通过，14 张界面截图。
- Playwright 使用项目现有脚本；本次工具环境没有 js_repl，未宣称执行了 playwright-interactive REPL。截图已人工查看，配置内容无横向溢出，底部按钮可见。

## 复审和边界

按 code-review-excellence 复查协议隔离、URL/路径、鉴权重定向、断点指纹、原图不覆盖、PNG 通道、失败状态及模态框边界，没有新加依赖或第二套队列。配置操作由 UI busy 门禁约束，生成使用已确定的配置快照。

没有对任意第三方服务做真实兼容认证，也不能保证任意网络、代理或平台服务端永不失败。模型列表可用并不证明付费编辑必定成功。HTTP 明文远程接口、原生 Google x-goog-api-key 鉴权、非流式 Gemini 返回及自定义 JSON 协议不在本次支持范围。

## 主要修改文件

- src/shared/relayApiConfig.ts、relayImageModels.ts、types.ts、generationProviderPolicy.ts、analysisProviderPolicy.ts、faceNaturalizationPolicy.ts
- src/main/index.ts、lianyilianRelayTransport.ts、relayImageAdapter.ts、relayBatchJournal.ts、cameraRealism.ts
- src/preload/index.ts、src/App.tsx
- src/renderer/components/RelayApiConfigModal.tsx、DescriptionPanel.tsx、StartupNoticeModal.tsx
- src/renderer/utils/faceLandmarkMask.ts、src/styles/glass-workbench.css
- tests/freeRelayApi.test.mjs、faceNaturalizationIntegrity.test.mjs 及上述合同测试
- scripts/verify-free-api-face.mjs、verify-electron-shell.mjs、verify-glass-workbench-ui.mjs、verify-relay-resilience.mjs

## 安装包交付

- npm run dist:win、npm run verify:packaged-windows：退出 0。
- 对 release/win-unpacked/耀创工坊.exe 再执行 verify-free-api-face：两个本机模拟图片接口、配置恢复/清除、真实本地人脸处理全流程通过，rendererErrors=[]，真实付费请求为 0。
- 打包程序证据：D:/Yaochuang-Workshop/TestArtifacts/free-api-face-1788789570872。
- 发布资源扫描：47 个自有 JS/JSON/HTML 文件中密钥格式命中为 0、旧服务商 URL 为 0；包内不存在 relay-api-key.bin、auth.json 或自动化用户日志。
- 源安装器：release/Yaochuang-Workshop-1.2.4-Setup.exe。
- 桌面：D:/Hale_Files/Desktop/耀创工坊 1.2.4 一键安装包.exe；仅保留此一份产品安装器。
- 大小 137795610 字节，文件/产品版本 1.2.4，源与桌面 SHA-256 一致：F101F59D8CBC6F8CCAB9B73DCCC04D455988FB750F06892DE378AF166771960E。
- 旧源与桌面安装器复制归档到 D:/Yaochuang-Workshop/ReleaseArchive/1.2.4-pre-free-api-face-20260907，未删除正式用户数据。未自动安装、未提交代码。
