# ChatGPT 人工验证保护修复

日期：2026-09-19。源码版本：1.2.4。未发布、未提交、未打包、未覆盖安装。

## 已确认的问题

1. `assessChatGptPageHealth` 曾把 Just a moment / 正在验证视为空白页面。以 auth.openai.com 为标题的中文验证页又缺少可靠的 DOM 识别。
2. 页面恢复每次调用允许两次刷新；输入框恢复、查看窗口和登录检查具有不同入口，次数没有按页面共享。缺少输入框时还可能重新导航，打断人工验证。
3. AI 分析回复延迟时曾刷新已经发送的对话；查看窗口可能重启窗口；某通道的保护未统一阻断其他通道的页面操作。
4. 批次准备阶段遇到保护会进入普通失败展示；恢复只读到当前页面，未确认其他通道是否仍在验证。软件重启后后台保活还可能再次打开页面。
5. 复审发现恢复检查期间验证重新出现、其他额度限制、手动查看后的模型缓存等边界，均补充回归测试后修正。

这些是本地生产源码与失败测试确认的软件问题。没有受影响朋友的现场日志，不能断言其第一次 Cloudflare 验证必然由刷新引起；账号、网络出口和平台策略仍可能独立触发验证。

## 最小修复

- 识别人工登录地址、可见验证组件/对话框及中英文验证文案。聊天正文中的“登录”“安全验证”不作为登录按钮或验证页面。
- 复用现有保护状态机和互斥队列，没有新增依赖、第二套调度或重试框架。人工验证标记写入现有运行记录。
- 网页变更脚本和 CDP 输入/导航/附件命令统一检查保护；探测失败时不操作页面。极简直传仍不探测模型或思考强度。
- 保护被识别后不再刷新、导航、上传、发送、清理输入区、打开菜单或补点；保活和页面存储写入也停止。已经发出的网络操作不能被事后撤回。
- “查看窗口”只显示现有页面；重启后允许用户明确打开窗口一次，但不解锁任务。后台不能自行重新创建登录页面。
- 真正空白、非登录、非加载中的页面，所有后台恢复入口共用一次尝试；失败保留现场，不追加导航兜底。
- AI 分析延迟只继续读取当前对话，不刷新已经发送的页面。发送不确定不补发；现有图片结果保存与断点规则不变。
- “检查恢复”检查所有相关通道：无验证、输入框可用、页面未加载、URL 稳定。完成其他状态读取后再确认一次，防止中途重新出现验证。检查不通过继续暂停，不自动延长倒计时，不自动恢复批次。
- 成功恢复进入现有单路恢复阶段；暂停不计为任务失败。需要由用户重新开始/继续缺失任务。

## 操作次数证据

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 同一验证页面的一次自动表面恢复 | 夹具复现 2 次刷新 | 0 次 |
| 非验证空白页反复进入恢复入口 | 每次重新计算重试额度 | 同一页面合计最多 1 次 |
| 反复点击查看已有验证窗口 3 次 | 可能进入重启/页面恢复路径 | 3 次显示，0 次页面导航 |
| 三通道中一个出现验证 | 缺少统一人工验证阻断 | 夹具中所有输入、上传、导航、刷新和脚本点击均为 0 |
| 已发送 AI 分析回复延迟 | 可能重新加载对话 | 仅只读继续等待 |

以上为故障注入/生产函数证据，不是平台保护触发概率或真实做图速度的测量。

## 测试与复审

- TDD：先复现验证页 2 次刷新、缺少 challenge 标志、导航没有拒绝、恢复错误成功、准备阶段没有 paused 字段、重启恢复打开隐藏窗口、手动查看未作废配置缓存、存储写入未停止等失败，再修正实现。
- 新增 `tests/chatGptManualVerification.test.mjs`：14 项通过。使用 TypeScript AST 提取实际生产函数运行；其中验证页面和三通道使用真实 Chrome 本地页面夹具，不复制业务算法。
- `tests/chatGptBrowserPolicy.test.mjs` 新增验证页与空白页分类回归。更新两个旧源码断言，要求 AI 分析只读等待及新的人工保护入口。
- 复审使用 code-review-excellence，重点检查刷新入口、跨通道暂停、重启后的保护、恢复竞态和暂停展示；发现的边界已回到红绿循环处理。
- 最后一次源码修改后重新运行以下全部检查，退出码均为 0；全量 300/300，无失败、跳过或取消。

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 300/300 |
| `npm run verify:chatgpt-models` | 模型/思考菜单页面夹具通过 |
| `npm run verify:chatgpt-upload` | 上传页面夹具通过 |
| `npm run verify:electron-shell` | 隔离 Electron 壳层通过 |
| `npm run verify:result-persistence` | 结果持久化通过 |
| `npm run verify:web-pose-ui` | 网感姿势 UI 通过 |
| `npm run verify:adaptive-canvas` | 画布专项通过 |
| `npm run verify:face-occlusion` | 蒙脸专项通过 |
| `npm run verify:gemini` | Gemini 页面夹具通过 |
| `npm run verify:ui` | 14 张 UI 巡检通过 |
| `node scripts/verify-chatgpt-manual-verification-ui.mjs` | 人工验证暂停/恢复状态区故障注入通过 |

`git diff --check` 对本轮涉及的已跟踪源码/测试文件检查通过，仅提示仓库既有 LF/CRLF 规则；没有更改行尾配置。

## 界面验证边界

`scripts/verify-chatgpt-manual-verification-ui.mjs` 使用 D 盘隔离资料启动真实 Electron，注入状态与恢复 IPC 结果：暂停为黄色而非失败、失败数为 0、失败检查仍保留恢复入口、成功检查移除恢复入口、长文案不横向溢出、控制台无错误。

本会话没有 playwright-interactive 所需的 js_repl 工具，因此没有声称完成该技能的交互式验收；使用脚本化 Playwright Electron 故障注入替代。测试中界面通道保留 API 以禁止真实 ChatGPT 后台连接，验证的是共享任务状态区，不是远端登录或真实出图。

证据目录：`D:\Yaochuang-Workshop\TestArtifacts\1.2.4-manual-verification`。
截图：`paused-desktop.png`、`paused-compact.png`。状态区报告：`ui-report.json`。

真实账号提交数为 0，未点击验证码，未读取 Cookie/Token，未清理正式 AppData、登录资料、项目或结果。

## 修改文件

- `src/main/chatGptBrowserPolicy.ts`
- `src/main/index.ts`
- `tests/chatGptBrowserPolicy.test.mjs`
- `tests/chatGptManualVerification.test.mjs`
- `tests/automationPolicy.test.mjs`
- `tests/chatGptParallel.test.mjs`
- `scripts/verify-chatgpt-manual-verification-ui.mjs`
- `docs/MAINTENANCE_HANDOFF.md`
- 本文档。

## 残余风险与验收

- 网站安全验证由平台决定，本修复只停止软件干扰，不绕过验证、不保证不再出现验证。
- 验证 DOM/语言将来变化仍可能需要调整；页面状态无法确认时保持不操作。
- 两次读取之间页面仍可能变化，任何下一条变更指令都会重新检查；已发出的指令或请求无法撤回。
- 未做朋友设备、真实验证流程、实际批次或 macOS 现场验收。需要 Hale 在源码验收后决定是否打包，安装包不会自动包含未发布源码。
