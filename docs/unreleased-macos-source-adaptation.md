# 1.2.4 macOS 源码适配

日期：2026-09-12

## 现象

现有工程虽然有 `dist:mac` 命令，但主进程固定使用 Windows 数据目录，专属 Chrome 只识别 `.exe`，后台窗口和残留进程处理也只有 Windows 实现；同时缺少可生成的 ICNS 图标和 Mac 实机验收入口。

## 根因

早期打包配置只声明了 DMG target，没有把运行时路径、浏览器发现、窗口生命周期、图标生成和平台验收一起纳入 macOS 边界。

## 修改

- 新增集中但克制的 `platformPolicy`，只承载数据目录、Chrome 候选路径和专属进程识别。
- macOS 使用系统应用数据与文稿目录，发现标准 Chrome/Edge 应用。
- 专属浏览器通过 CDP 最小化，并只结束带精确专属资料目录参数的浏览器进程。
- 增加 ICNS 生成、当前架构 DMG 命名、源码启动验证和打包后启动验证。
- 增加 Mac 构建交接文档及可直接交给另一台 Mac 上 Codex 的提示词。

## 验证边界

Windows 侧可以验证 TypeScript、单元测试、打包配置和 Windows 回归；不能验证 macOS 图形进程、系统权限、签名、公证与 Gatekeeper。DMG 必须在真实 Mac 上构建并执行 `verify:mac-source`、`verify:packaged-mac` 后才可称为 Mac 候选包。

## Windows 侧新鲜验证

- `npm run typecheck`：通过。
- `npm test`：`285/285` 通过。
- macOS/Windows 平台策略专项：`9/9` 通过。
- Electron 主壳层：通过，`rendererErrors=[]`。
- ChatGPT 模型页面夹具：通过，连续 20 轮菜单生命周期正常。
- ChatGPT 上传页面夹具：通过，附件、发送与保护提示门禁正常。
- API 韧性故障注入：100 组通过，没有对不确定付费请求自动补发。
- 结果持久化：通过，尺寸、方向与恢复门禁正常。
- 源码密钥格式扫描：0 命中。
