# 像锚 1.2.4 macOS 构建交接

更新时间：2026-09-12

## 当前结论

- 这份源码已完成 Windows 侧的 macOS 静态适配和跨平台回归。
- Windows 无法真实启动 `.app`、生成可信的 `.dmg` 或验证 Gatekeeper，因此这些结论必须在目标 Mac 上重新验证。
- 当前版本保持 `1.2.4`。不要因平台适配自行升级版本。
- 源码包不包含 API Key、用户项目、结果、断点、日志、专属 Chrome 登录资料或 `AppData`。

## 已完成的 macOS 适配

- macOS 使用 Electron 默认的 `Application Support` 数据目录；不再尝试 Windows 的固定 AppData 路径。
- 导出文件写入 macOS 的“文稿/像锚/Exports”。
- 支持发现 `/Applications` 与用户 `Applications` 下的 Google Chrome 和 Microsoft Edge。
- 专属浏览器后台模式使用 CDP 最小化窗口；结束进程时只匹配像锚专属 `user-data-dir`，不触碰普通浏览器。
- Windows 专用 GPU 参数和窗口控制不会在 macOS 执行。
- 构建前由 macOS 自带的 `sips` 和 `iconutil` 从维护图标生成 `build/icon.icns`。
- DMG 同时包含应用入口和 `/Applications` 拖放入口，文件名带版本与 CPU 架构。

## 在 Mac 上先做什么

1. 确认架构：`uname -m`。`arm64` 是 Apple 芯片，`x86_64` 是 Intel。
2. 使用与本机架构一致的 Node.js，进入解压后的源码目录。
3. 执行：

```bash
npm ci
npm test
npm run verify:mac-source
```

4. 只有上面全部通过后再构建：

```bash
npm run dist:mac
npm run verify:packaged-mac
```

5. 成品位于 `release/Xiangmao-Workshop-1.2.4-<arch>.dmg`。

## 必须人工检查

- 首次启动、关闭、再次启动均无黑屏。
- 上传主图、红圈、参考图、提示词生成、结果归档、批量降 AI 感和面部自然化。
- 自由 API 配置、测试连接、单张生成、保存原始比例；只使用测试 Key 或最小真实请求。
- 安装 Google Chrome 后，检查专属 Chrome 登录、AI 分析、网感姿势和一次最小 ChatGPT 自动化流程。
- 普通 Chrome 不应被关闭；专属浏览器的显示与隐藏应正常。
- Apple 芯片和 Intel 安装包不能互相假定兼容；在哪种机器构建就明确标注哪种架构。

## 签名与分享边界

- 源码中没有 Apple 开发者证书、签名密码或公证凭证。
- 未签名 DMG 适合开发者本人验证，发给其他人时可能被 Gatekeeper 拦截。
- 正式分发应在拥有 Apple Developer Program 资质的 Mac 上完成 Developer ID 签名与 Apple 公证。
- 不要通过关闭系统安全机制、批量移除隔离属性或其他绕过方式伪装正式发布。

## 失败时保留证据

- 不删除源码或用户数据，不执行 `git reset`、`git clean` 或覆盖回退。
- 保留完整命令输出、macOS 版本、CPU 架构、失败截图和 Electron 控制台错误。
- 区分源码启动失败、打包失败、签名失败、Gatekeeper 拦截和真实网页/API 故障。
