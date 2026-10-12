# macOS 验收清单

当前源码已做第一轮 macOS 适配；正式 DMG 仍需在目标 Mac 上验证。先阅读 [macOS 交接说明](docs/MACOS_HANDOFF.md)、[开发说明](docs/DEVELOPMENT.md)和当前工作树状态。

1. 确认本机 CPU 架构与 Node.js 版本，执行 `npm ci`、`npm test` 和 `npm run verify:mac-source`。
2. 验证首次启动和重启、主图及参考图导入、红圈、提示词、结果归档、批量相机质感、面部自然化和自配 API 单张流程。生成请求可能收费，测试时优先用隔离夹具。
3. 如需验证 ChatGPT 网页路线，使用专属浏览器资料，由测试者手动完成登录和安全验证。只做最小任务，检查普通浏览器不会被关闭，登录资料与用户数据不会进入安装包。
4. 验证通过后运行 `npm run dist:mac` 和 `npm run verify:packaged-mac`，记录 DMG 路径、大小、SHA-256、macOS 版本、架构和失败截图。
5. 没有 Developer ID 证书时，只将产物标为未签名测试包；签名、公证与 Gatekeeper 验证另行完成。

API Key、项目图片、断点、日志和浏览器资料不得混入分发包。真实账号、真实服务商和付费请求的覆盖范围要与夹具验证分开说明。
