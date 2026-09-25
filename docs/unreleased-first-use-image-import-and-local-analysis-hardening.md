# 耀创工坊 1.2.4 首次使用、手机图片导入与本地分析加固

日期：2026-08-26  
状态：源码已修复并完成验证，未升级版本、未打包、未安装

## 问题现象

- 部分群友上传手机自拍或参考图时没有反应。浏览器提供的 MIME 不稳定，HEIC/HEIF 也不能由工作台直接解码。
- 本地 AI 分析和网感姿势偶发长时间等待或失败，尤其是首次加载视觉模型时。
- 第一次启动软件会在用户尚未选择网页路线时准备专属 Chrome，增加窗口、登录和网络状态干扰。
- 旧 UI 验证脚本仍假定图片可绕过 Electron 直接读取，且假定首装默认显示 ChatGPT 模型控件，与当前可信导入和本地分析 + API 首装路线不一致。

## 真实根因

1. 原图片入口分别依赖 `File.type` 和浏览器解码能力，不能可靠识别 MIME 为空的手机图片，也没有统一 HEIC/HEIF 解码边界。
2. 本地网感姿势原超时为 150 秒；实测 `gemma3:4b` 首轮在约 151.54 秒才返回完整 8 项 JSON，软件刚好在有效结果到达前终止并继续尝试更慢的后备模型。
3. 本地视觉请求使用 `keep_alive: 0`，AI 分析与网感姿势之间会重复卸载和加载模型。
4. 首装默认路线和启动阶段仍可能触发网页 Provider 维护逻辑，即使用户只打算使用本地分析与 API 做图。
5. 部分专项脚本仍模拟旧环境，缺少新的 `image:normalize-import` 测试桥接或没有显式选择自己要验收的 Provider。

## 解决方式

- 新增统一图片导入策略和可信 Electron IPC。主图、人脸参考图、穿搭参考图以及结果归档入口统一支持 JPG、JPEG、PNG、WebP、HEIC 和 HEIF。
- JPG、PNG、WebP 只读取编码与像素尺寸，原始文件字节不重编码、不压缩；HEIC/HEIF 在受限 Worker 中解码为无损 PNG，保持原始宽高。
- 图片导入限制为 25MB、1.2 亿像素；损坏文件在写入项目之前返回明确错误，不留下半加载状态。
- 本地视觉模型优先使用已实测响应更稳定的 `gemma3:4b`，随后才尝试其他已安装视觉模型；AI 分析与网感姿势统一采用 180 秒上限并保温 10 分钟。
- 网感姿势最大输出限制为 900 token，避免完整 8 项结果被无意义长输出拖过超时边界。
- 首装默认改为“本地模型分析 + 耀创工坊专属 API 做图”；启动时不再探测登录或模型，也不自动打开专属 Chrome。只有用户明确选择 ChatGPT 做图或 ChatGPT 分析后，才维护网页会话。
- 首次使用公告补充本地模型、用户自有 API Key、可选网页路线和手机图片格式说明。
- 更新 UI、画布、Electron 壳层和网感姿势专项夹具，使每个脚本显式验证自己的 Provider 场景，不降低产品的可信 IPC 边界。

## 首次使用实测

- 使用全新隔离用户目录启动 Electron，未读取或改写正式 `D:\Yaochuang-Workshop\AppData`。
- 首屏为本地分析 + API 路线；API 未配置状态清楚可见。启动 6 秒后没有为该隔离资料创建专属 Chrome 进程，也没有生成 ChatGPT 自动化日志。
- 真实 HEIC 文件成功导入，耗时约 6.762 秒，像素尺寸保持为 4032x3024。
- 对同一真实 HEIC 执行本地 AI 分析成功，约 76 秒后四个字段全部回填。
- 本地网感姿势返回恰好 8 项；第 4 项选择成功并写入隔离自动保存。
- 截图与状态证据：
  - `D:\Yaochuang-Workshop\TestArtifacts\1.2.4-first-user-final3c\01-first-launch-notice.png`
  - `D:\Yaochuang-Workshop\TestArtifacts\1.2.4-first-user-final3c\02-default-local-api-route.png`
  - `D:\Yaochuang-Workshop\TestArtifacts\1.2.4-first-user-final3c\03-real-heic-imported.png`
  - `D:\Yaochuang-Workshop\TestArtifacts\1.2.4-first-user-final3c\04-local-ai-analysis-complete.png`
  - `D:\Yaochuang-Workshop\TestArtifacts\1.2.4-first-user-final3c\05-web-pose-8-options-selected-4.png`

## 验证结果

- `npm run typecheck`：通过。
- `npm test`：265/265 通过。
- `npm run verify:startup-notice`：通过。
- `npm run verify:ui`：通过，14 张截图。
- `npm run verify:adaptive-canvas`：通过，1024、1280、1366、1440、1920、2560 及真实 Electron。
- `npm run verify:electron-shell`：通过，无渲染控制台错误。
- `npm run verify:face-occlusion`：通过。
- `npm run verify:result-persistence`：通过。
- `npm run verify:chatgpt-models`：首次隔离 Chrome 冷启动发生一次瞬态退出，随后全量重跑通过，包括 20 轮菜单循环。
- `npm run verify:chatgpt-upload`：通过。
- `npm run verify:gemini`：通过。
- `npm run verify:web-pose-ui`：通过。
- `npm run verify:relay-resilience`：100/100 故障注入通过。
- 标准图片字节保真、损坏图片拒绝专项：4/4 通过。

## 验证边界与残余风险

- 真实图片、本地 Ollama 和源码 Electron 使用的是隔离用户目录；ChatGPT/Gemini 使用页面夹具，没有用真实账号连续发送消息制造限流。
- 本地视觉模型耗时取决于 CPU、GPU、内存和模型是否已下载。当前机器首次完整分析约 76 秒，不应承诺所有电脑都同速。
- HEIC/HEIF 必须解码为工作台可用的无损 PNG，因此文件字节会变化，但像素宽高不变；JPG、PNG、WebP 不会被重新编码。
- 隔离 Chrome 冷启动出现过一次瞬态退出，现有启动器可切换后备传输；后续发布验收仍需保留一次真实安装环境冷启动检查。
- 本轮没有升级版本、生成安装包、覆盖安装或提交代码，等待 Hale 验收源码结果后再进入发布。

## 经验教训

- 手机图片兼容不能只靠文件扩展名或浏览器 MIME；统一可信导入入口才能保证所有面板行为一致。
- 超时必须依据真实首轮耗时设置，并限制输出规模；只增加等待而不处理模型卸载和输出上限仍会反复超时。
- 首装默认路线应与无需网页登录的最小可用路径一致，网页自动化只能在用户明确选择后启动。
- 验证脚本应显式声明 Provider 和 IPC 夹具，不能依赖不断变化的产品默认值。
