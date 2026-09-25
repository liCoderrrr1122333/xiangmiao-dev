# 发给 Mac 上 Codex 的提示词

你正在一台 macOS 电脑上接手“耀创工坊 1.2.4”Electron 桌面应用。源码已经由 Windows 维护端完成第一轮 macOS 静态适配。请先读取 `docs/MACOS_HANDOFF.md`、`docs/MAINTENANCE_HANDOFF.md`、`package.json` 和当前源码状态，再在本机完成真实 macOS 验证与 DMG 构建。

要求：

1. 不升级版本，不提交代码，不删除或回退现有改动。
2. 先运行 `npm ci`、`npm test`、`npm run verify:mac-source`，失败时先诊断根因并增加失败测试，再做最小修复。
3. 验证首次启动、重启、主图与参考图导入、红圈、提示词、结果归档、批量降 AI 感、面部自然化和自由 API 单张流程。
4. 安装了 Google Chrome 时，再验证专属 Chrome 的显示、隐藏、登录、AI 分析、网感姿势和一次最小自动化任务。禁止连续发送大量真实消息制造平台保护。
5. 普通 Chrome 不能被关闭，API Key、登录资料、用户项目、结果和日志不能进入安装包。
6. 验证通过后运行 `npm run dist:mac` 和 `npm run verify:packaged-mac`。
7. 明确报告本机是 Apple 芯片还是 Intel、生成的 DMG 路径、文件大小和 SHA-256。
8. 如果没有 Developer ID 证书，只能把产物标记为“未签名测试包”；不得声称已完成正式签名或 Apple 公证，也不得绕过 Gatekeeper。
9. 最终只保留一份本机架构对应的最新 DMG，并汇报修改文件、测试证据、尚未验证的真实账号/API 边界和残余风险。

不要过度工程化，不要重写 Windows 已经可用的业务流程。优先修复 macOS 上能够稳定复现的真实问题。
