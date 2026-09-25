# 1.2.4 未发布：源码交接稳定性修复

日期：2026-09-19。保持版本，不提交、不打包、不安装，不变更正式 AppData、用户项目或浏览器登录资料。

## 范围与根因

本轮只修复可复现的边界问题，不增加依赖、队列、状态机或配置框架，不改界面和图片算法。

| 已确认问题 | 最小修复 |
| --- | --- |
| 旧 `dev` 直接打开 Electron，干净源码尚无主进程/preload 构建；Vite 换端口时还可能误连原 5173 页面 | 先构建，再用现有 Vite API 独占 5173；监听成功才启动 Electron，退出时关闭服务 |
| 源码运行默认也使用正式 Windows AppData | 非安装版默认 `.local-data/`；显式目录无效时报错，安装版原路径不变 |
| `typecheck` 只检查渲染层和 Vite，漏掉主进程/preload | 添加现有 Electron tsconfig 的无输出类型检查 |
| 同一 API taskId 并发提交覆盖旧取消控制器 | 活跃任务编号重复时在调用 transport 前拒绝 |
| transport 未响应取消、稍后返回成功时，适配器仍接受结果 | 生成、下载各自完成后再次检查取消状态；不增加生成重试 |
| Key 和 ChatGPT 保护状态在文件读取完成前就标记已加载，其他调用可能读取空状态 | 并发调用等待同一个读取 Promise，完成后才标记 |
| 清除 Key 未占用现有配置互斥标记，可能与保存配置交错 | 删除期间占用同一标记，成功/失败均在 finally 释放 |

## 红绿回归

以下 8 个新增测试均先在旧实现观察失败，再修复转绿；没有覆盖或回退工作树来制造基线。

- `relayImageAdapter.test.mjs`：重复活跃 ID；生成/下载阶段的迟到取消结果（2 项）。
- `macosCompatibility.test.mjs`：开发目录隔离、显式目录优先及相对路径拒绝（1 项）。
- `runtimeStateLoading.test.mjs`：并发 Key 加载、并发保护状态加载、清除期间互斥（3 项）。直接提取生产函数并使用受控 IO，不复制业务实现。
- `sourceWorkflow.test.mjs`：给主进程注入类型错误后公共命令必须失败；开发启动必须先构建（2 项）。
- 原人工验证测试补充新的共享读取 Promise 上下文，行为断言不变。

## 新鲜验证结果

Windows / Node.js 24.14.1：

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，含主进程/preload |
| `npm test` | 308/308 通过，0 失败/跳过 |
| `verify:electron-shell` | 通过，隔离 Electron，rendererErrors 为空 |
| `verify:chatgpt-models`、`verify:chatgpt-upload` | 通过，浏览器页面夹具 |
| `verify:gemini`、`verify:web-pose-ui` | 通过，夹具/隔离界面，不代表真实 Gemini 已可用 |
| `verify:result-persistence` | 通过 |
| `verify:adaptive-canvas`、`verify:face-occlusion` | 通过 |
| `verify:ui` | 通过，生成 14 张回归截图 |
| `verify:relay-resilience` | 100 个本地故障场景通过；报告中的 paidPosts 是模拟计数，没有真实付费生成 |
| 干净源码副本 `npm ci` | 通过，重新安装 366 个包，未复制旧依赖/构建/个人数据 |
| 干净副本 `npm run dev` | 构建及窗口通过；无个人 Key；独立数据目录；无横向溢出；正常退出后端口关闭 |
| 5173 被占用 | 明确失败，未启动 Electron 去访问其他项目 |
| `verify:mac-source` | 未通过平台前置条件：脚本明确要求 macOS，本机 Windows，不能算 Mac 验证 |

证据目录：`D:\Yaochuang-Workshop\TestArtifacts\1.2.4-source-handoff`。保留修改前的少量源码快照、测试日志、干净副本和 `clean-dev-window.png`，不随源码交付。首次开发烟测发现测试断言把未配置 maskedKey 误写为空字符串，已按实际返回 undefined 修正后重新通过；未为此修改生产接口。

当前会话缺少 playwright-interactive 所需 js_repl，实际界面验证使用现有 Playwright 脚本和隔离 Electron，不冒充交互工具验收。干净副本仅预置关闭 ChatGPT 后台保活以避免外部页面操作，没有注入 API Key。

## 修改文件

- `src/main/index.ts`、`src/main/platformPolicy.ts`、`src/main/relayImageAdapter.ts`
- `package.json`、`package-lock.json`、`.gitignore`、`scripts/dev.mjs`
- `tests/relayImageAdapter.test.mjs`、`tests/macosCompatibility.test.mjs`、`tests/chatGptManualVerification.test.mjs`
- `tests/runtimeStateLoading.test.mjs`、`tests/sourceWorkflow.test.mjs`
- `README.md`、`docs/DEVELOPMENT.md`、`docs/MAINTENANCE_HANDOFF.md`、本文

## 复审与边界

- 基于本轮修改前快照复审，未把此前大量未提交改动当成本轮改动。重复任务检查在 try/finally 外，不会误删除原任务；取消检查覆盖生成和下载；配置标记在删除失败时也释放。
- 依赖、网络协议、模型选择、图片处理、正式保存格式及任务恢复策略未重写。锁文件仅同步 Node 引擎要求，没有升级依赖。
- 已有秘密模式文件扫描未匹配到真实 Key 特征；这是有限签名检查，不是完整安全审计。分享前仍必须按 `DEVELOPMENT.md` 的清单排除真实数据、历史、截图和日志，不能直接压缩整个维护目录。
- 依赖安装仍有若干间接依赖的弃用警告。本轮不为消除警告批量升级构建链。
- 本地夹具无法证明服务商故障、系统代理/TUN、配额、最新网页变化或 Mac 环境一定可用；未提交真实付费生成。本轮不承诺零 bug。
- 当前 Windows 安装包已按本轮源码重新构建，交付副本位于 `D:\Hale_Files\Desktop\耀创工坊-1.2.4-源码与安装包\耀创工坊-1.2.4-最新版一键安装包.exe`。SHA-256 为 `6E07C22E19C2FA61021D78170B8F891D47D79786E245320A4BB115B7C3E9AB78`。本轮未安装或覆盖现有软件；macOS 安装包仍需在 Mac 上构建。
