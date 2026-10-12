# 开发与源码分享

当前源码版本：1.2.4。面向收到源码后自行修改的开发者，不代表安装包已同步更新。

## 最短启动路径

准备 Node.js 24.14.0 或更新的 24.x，在源码根目录执行：

```sh
npm ci
npm run dev
```

开发启动先构建主进程与 preload，再启动本地页面和 Electron。5173 端口被占用会明确退出，不会连接其他项目的页面；先关闭占用端口的开发服务再重试。渲染层有热更新，修改主进程或 preload 后需退出并重新运行开发命令。

不使用开发服务时：

```sh
npm run build
npm start
```

不要复制其他电脑的 `node_modules` 或构建目录，尤其不要跨 Windows / macOS 复制原生依赖。

## 数据隔离

- 源码运行默认将设置、自动保存、断点、浏览器资料和加密凭据写入源码根目录 `.local-data/`，已加入忽略清单。
- 可用 `XIANGMAO_USER_DATA_DIR` 指定可写的绝对路径。显式路径无效时直接报错，不改用正式数据目录。
- 已安装版本的数据位置没有改变。本轮不迁移、不清除已有数据。
- 首次运行不带个人 Key。API 地址和 Key 由使用者填写；需要网页流程时人工登录，需要本地分析时单独准备模型。
- 开发测试不要指定正式 AppData。真实生成可能收费，也可能触发平台保护；优先用测试夹具。

## 修改与验证

```sh
npm run typecheck
npm test
```

`typecheck` 同时检查渲染层、构建配置、Electron 主进程与 preload。测试使用 Node 内置测试运行器，不需要额外安装 Jest。

按修改范围运行 `verify:electron-shell`、`verify:relay-resilience`、`verify:chatgpt-upload`、`verify:chatgpt-models`、`verify:web-pose-ui`、`verify:result-persistence` 等已有验证。部分界面验证脚本使用 Windows 的 D 盘隔离目录，不能据此声称已在 Mac 上验证。

| 修改位置 | 职责 |
| --- | --- |
| `src/main/` | 文件、安全 IPC、API/网页调用、调度与保存 |
| `src/preload/` | 只暴露需要的 IPC 接口，不开放任意 Node 权限 |
| `src/shared/` | 类型、协议配置和纯策略函数 |
| `src/renderer/components/` | 工作台界面 |
| `src/renderer/prompt/` | 提示词组合 |
| `tests/`、`scripts/verify-*.mjs` | 单元回归与隔离界面/故障验证 |

先增加能复现问题的失败测试，再修改相应模块。不为一次小修复重写主流程，不重复实现队列或状态机。生成请求不确定时禁止自动重发；人工验证时禁止自动刷新。

## 分享清单

采用明确文件清单，**不要直接压缩整个维护目录或 Git 历史**：

- 包含 `src/`、`public/`、`build/`、`scripts/`、`tests/`、`docs/`，以及 `package.json`、`package-lock.json`、`index.html`、`vite.config.ts`、`tsconfig*.json`、`tokens.css`、README、`.gitignore` 和必要的许可/第三方声明。
- 排除 `.git`、`.local-data`、`.env*`、`node_modules`、`dist`、`dist-electron`、`release`、测试输出、截图/Trace、日志和缓存。
- 排除所有真实项目、图片、发送包、API Key、`relay-api-key.bin`、断点和浏览器登录资料，包括自定义数据目录。
- 分享前在另一个空目录重新安装、构建、启动，检查首次 API 状态未配置；不要把测试用假密钥作为默认值。
- 本仓库未在本轮新增开源许可证。分享范围与修改/再分发授权由项目负责人明确；分发第三方代码和资源时保留它们要求的许可声明。

## 平台边界

Windows 本地测试不证明 Mac 安装包可运行。Mac 接收者需在 Mac 重新 `npm ci`，执行 `verify:mac-source`，构建后按 `verify:packaged-mac` 验证，并自行处理签名、公证与系统权限。当前修复未发布新安装包。

页面升级、服务商故障、系统代理/TUN、账户配额和验证码仍可能中断任务。测试通过是当前覆盖范围的证据，不是永不出错的承诺。
