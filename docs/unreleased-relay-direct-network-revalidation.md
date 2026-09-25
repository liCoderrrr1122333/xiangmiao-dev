# API 直连与完整回归复核

日期：2026-08-26  
版本：`1.2.4`（版本未变更）

## 现象

Hale 关闭 Windows TUN 模式后，要求重新核对耀创工坊 API 做图的网络路径、任务安全边界和相关功能回归，避免把旧代理状态、上游异常或软件缺陷混在一起判断。

## 现场证据

- Windows WinHTTP 当前为直接访问，不使用代理服务器。
- 当前 Codex 进程仍继承了旧的 `127.0.0.1:6524` 代理环境变量，但 `NODE_USE_ENV_PROXY` 未开启。
- 在保留旧代理环境变量和显式清空代理环境变量两种情况下，Node 直连 `https://www.lianyilian.top/v1/models` 均在约半秒内收到预期的 `401 INVALID_API_KEY`，证明 DNS、TCP、TLS 和目标服务 HTTP 链路可达。
- 标准图片 `/v1/images/edits` 与香蕉生图流式端点均在约半秒内收到预期的鉴权拒绝，两个实际请求入口在 TUN 关闭后均可直连。
- 正式 AppData 没有可用的持久 API Key；本轮没有读取、恢复或复用聊天中出现过的 Key，也没有发起付费图片生成。

## 实现复核

- API 传输顺序为 Node 直连优先，只有连接级故障才回退 Electron 系统网络通道。
- 已验证的 Key、模型和网络通道在当前运行中复用，不会每张图片重复探测。
- 付费 POST 的返回状态不确定时不会自动重复提交；任务进入待确认，下一任务才切换备用网络通道。
- 图片 URL 下载中断只重试一次 GET，不会重新生成或重复扣费。
- 401/403、429、模型分组未开放、406 上游拒绝、连接重置和下载失败保持独立错误分类。
- API Key 不进入普通设置、项目、断点、日志或安装包；仅会话使用，或经 Electron `safeStorage` 加密后记住本机。

## 验证结果

- `npm run typecheck`：通过。
- `npm test`：`265/265` 通过。
- API 核心定向测试：`30/30` 通过。
- `npm run verify:relay-resilience`：`100/100` 故障场景通过。
- `npm run verify:electron-shell`、`verify:ui`、`verify:adaptive-canvas`、`verify:result-persistence`、`verify:face-occlusion`、`verify:startup-notice`、`verify:packaged-windows`：通过。
- `verify:chatgpt-models`、`verify:chatgpt-upload`、`verify:web-pose-ui`、`verify:gemini`：通过。
- Electron 与 UI 验收没有新增页面错误或渲染错误。

## 结论与边界

本轮没有发现新的可复现软件缺陷，因此没有修改 API 业务实现。关闭 TUN 后，耀创工坊的直连优先路径可用，旧代理环境变量不会接管当前 Node 直连请求。

无法承诺第三方 API 永不出现上游 406、限流、余额不足、模型分组关闭、服务端连接重置或运营商网络波动。软件能够负责的是：开始前明确检查、失败原因准确分类、付费提交不盲目重试、结果与断点安全保存。真实付费端到端生成仍需用户在应用内重新输入一枚有效且已开放对应图片模型的 Key 后进行最小手测。

## 安装包交付

- 按 Hale 后续要求重新生成 `1.2.4` Windows NSIS 一键安装包，打包后的 Windows 程序实际启动验证通过。
- 安装包大小：`137791615` 字节。
- 文件版本与产品版本：`1.2.4`。
- SHA-256：`FA7C5A6BCF49EB6BEAFD000331D5306C68E8D9DF978F391E21DE29F89ABE561C`。
- 桌面路径：`D:\Hale_Files\Desktop\耀创工坊 1.2.4 一键安装包.exe`。
- 桌面和源码 `release` 目录均只保留一份最新正式安装器；旧安装器与构建中间物已移至 D 盘 `ReleaseArchive`，没有触碰用户项目、AppData、结果或登录资料。
- 本轮没有自动安装，也没有提交代码。

## 经验

- TUN 开关与应用实际网络路径必须分开核验；环境变量存在不等于 Node `fetch` 正在使用它。
- `401` 无扣费探测可证明网络和接口入口可达，但不能替代有效 Key、余额、模型权限和真实生成验证。
- 没有可复现缺陷时应保留现有实现，不以额外重试或更长等待掩盖第三方服务波动。
