# 历史维护交接基线

> 当前产品名为“像锚”。本文件保留当时的产品名、安装包路径、验收人称呼和版本记录，作为历史证据；当前 macOS 验收步骤见根目录 `MACOS_VALIDATION.md`。

更新时间：2026-09-19

## 2026-09-19 源码与 Windows 安装包交付

- 已按当前工作树重新构建 Windows x64 安装器，版本 `1.2.4`，SHA-256：`6E07C22E19C2FA61021D78170B8F891D47D79786E245320A4BB115B7C3E9AB78`。
- 桌面交付目录：`D:\Hale_Files\Desktop\耀创工坊-1.2.4-源码与安装包`。其中 `Windows版源码` 和 `macOS版源码` 是同一套 315 文件跨平台源码副本；源码目录已排除依赖、构建输出、Git 历史、密钥、浏览器资料和用户数据。
- 本次仅整理交付，没有安装或覆盖现有软件，没有删除旧安装包和正式用户资料。macOS 安装包仍须在 Mac 上重新安装依赖、构建并验证。

## 2026-09-19 源码分享前小范围加固

- 版本仍为 `1.2.4`，未提交、打包或安装。保留此前人工验证暂停修复和所有未提交正式改动，不迁移、不清理正式数据。
- 修复源码首次启动缺少 Electron 构建、开发/正式数据混用、主进程漏检、API 重复任务与迟到取消结果、首次配置/保护状态读取竞态及清除 Key 互斥。
- 未新增依赖或框架；开发默认 `.local-data/`，5173 被占用即停止。接收源码者先读 `docs/DEVELOPMENT.md`，不要把整个维护目录连同个人数据直接分享。
- 新鲜验证：308/308 测试通过，类型检查和 10 个现有验证入口通过，干净源码副本重新安装与开发启动通过。`verify:mac-source` 被 macOS 平台前置条件阻止，不能记作通过；未验证真实付费生成。
- 文件清单、红绿记录、验证范围与证据位置见 `docs/unreleased-source-handoff-hardening.md`。下面的安装包信息仍是历史基线，不包含两次 2026-09-19 未发布修复。

## 2026-09-19 未发布源码修复

- 版本保持 `1.2.4`。本轮只修复 ChatGPT 人工登录/Cloudflare 验证被自动恢复打断的问题，没有提交、打包、安装或改动正式用户数据。下面的安装包信息是历史发布基线，不包含本轮修复。
- 验证页与真正空白页分离；人工验证进入现有 `PROTECTION_PAUSED` 并持久保存。暂停期间禁止导航、刷新、上传、发送、模型菜单和补点；查看窗口只显示原页面。非验证空白页共用每页一次恢复预算。
- 人工完成验证后主动点击“检查恢复”，以所有相关通道连续稳定的只读检查为准，恢复先单路；关闭提示、后台轮询或重启软件均不会自行解锁。已发送任务仍可只读等待和保存，不重复发送。
- 新增生产函数/真实浏览器页面夹具和隔离 Electron 状态区验证；红绿证据、完整回归结果、验证边界见 `docs/unreleased-chatgpt-manual-verification-guard.md`。未使用真实账号制造验证，也不承诺消除平台侧安全验证。

## 2026-09-19 时点的旧版交付基线

- 产品：耀创工坊 Windows Electron 桌面应用。
- 当前正式源码版本：`1.2.4`；当前最新一键安装包版本：`1.2.4`。
- 源码工作树：`D:\Yaochuang-Workshop\Worktrees\yaochuang-0.1.2-from-0.1.1`。
- 当前分支：`feature/0.6.0-gemini-web-provider`。
- 工作树包含大量尚未提交的正式改动；禁止 reset、checkout 覆盖或丢弃这些改动。
- 2026-09-12 已将白板占位图防误保存修复与此前自由 API、面部自然化修复和 ChatGPT 九月网页适配重新打包为 `1.2.4`，已放桌面，未自动安装。正式 `D:\Yaochuang-Workshop\AppData` 中的真实登录资料、用户项目和已有结果均未清理或改写。
- 当前安装包源文件：`release\Yaochuang-Workshop-1.2.4-Setup.exe`。
- 安装包大小：`137796930` 字节；安装器文件版本和产品版本均为 `1.2.4`。
- SHA-256：`7925542BBEF454D4D2BAE281DDD527A82335EF743A4BEC66BD092B79E7D4A4A4`。
- 桌面交付副本：`D:\Hale_Files\Desktop\耀创工坊 1.2.4 一键安装包.exe`。
- 上一份同版本源码安装器和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\1.2.4-pre-upstream-rejection-hotfix-20260826-061159`；本次构建中间物归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.2.4-upstream-rejection-hotfix-build-artifacts-20260826-061928`，桌面和源码 `release` 均只保留最新安装器。
- 旧 `0.6.9` 发布包移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.9` 保留；没有删除用户桌面项目目录、快捷方式或正式数据。
- `0.6.11` 源安装包、blockmap 和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.11`；桌面只保留 0.6.12 最新一键安装包。
- `0.6.12` 源安装包、blockmap 和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.12`；桌面现在只保留 0.6.13 最新一键安装包。
- `0.6.13` 源安装包、blockmap 和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.13`；桌面现在只保留 0.6.14 最新一键安装包。
- `0.6.14` 源安装包、blockmap 和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.14`；桌面现在只保留 0.6.15 最新一键安装包。
- `0.6.15` 发布物已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.15`；桌面现在只保留 0.6.16 最新一键安装包。
- `0.6.16` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.16-build-artifacts`；源码 `release` 目录只保留正式安装器。
- `0.6.16` 的源安装包和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.16`；桌面现在只保留 0.6.17 最新一键安装包。
- `0.6.17` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.17-build-artifacts`；源码 `release` 目录只保留 0.6.17 正式安装器。
- `0.6.17` 的源安装包和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.17`；桌面现在只保留 0.6.18 最新一键安装包。
- `0.6.18` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.18-build-artifacts`；源码 `release` 目录只保留 0.6.18 正式安装器。
- `0.6.18` 的源安装包和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.18`；桌面现在只保留 0.6.19 最新一键安装包。
- `0.6.19` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.19-build-artifacts`；源码 `release` 目录只保留 0.6.19 正式安装器。
- `0.6.19` 的源安装包和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.19`；桌面现在只保留 0.6.20 最新一键安装包。
- `0.6.20` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.20-build-artifacts`；源码 `release` 目录只保留 0.6.20 正式安装器。
- `0.6.20` 的源安装包和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.20`；桌面现在只保留 0.6.21 最新一键安装包。
- `0.6.21` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.21-build-artifacts`。
- `0.6.21` 源安装包已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.21`；桌面现在只保留 0.6.22 最新一键安装包。
- `0.6.22` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.22-build-artifacts`；源码 `release` 目录只保留 0.6.22 正式安装器。
- `0.6.22` 的源安装包和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.22`；桌面现在只保留 0.6.23 最新一键安装包。
- `0.6.23` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.23-build-artifacts`。
- `0.6.23` 的源安装包已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.23`；`0.6.24` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.24-build-artifacts`；源码 `release` 和桌面均只保留 0.6.24 安装包。
- `0.6.24` 源安装包已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.24`；`0.6.25` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.25-build-artifacts`；源码 `release` 和桌面均只保留 0.6.25 安装包。
- `0.6.25` 源安装包和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.25`；1.1.1 图标迭代包保存在 `1.1.1-pre-final-icon-20260816`、`1.1.1-final-icon-build-artifacts` 和 `1.1.1-pre-qq-white-frame-20260816`；最终 QQ 白底比例构建中间物位于 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.1-qq-white-frame-build-artifacts`。
- `1.1.1` 最终源安装包和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.1`；首版、冷却热修和图标迭代包继续保留；`1.1.2` 速度与保护发布前安装器归档到 `1.1.2-pre-speed-protection-20260821-191122`，构建中间物归档到 `1.1.2-speed-protection-build-artifacts-20260821-191941`。
- `1.1.2` 正式安装器、blockmap、解包产物和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.2-pre-1.1.3-camera-realism-20260822-224459`；桌面只保留 `1.1.3` 最新安装包。
- `1.1.3` 的解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.3-camera-realism-build-artifacts-20260822-230205`；源码 `release` 目录只保留正式安装器。
- `1.1.3` 源安装器和桌面副本已移到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.3-pre-1.1.4-selectable-camera-realism-batch-20260823-000140`；`1.1.4` 解包程序、blockmap 和构建调试清单已移到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.4-selectable-camera-realism-batch-build-artifacts-20260823-001647`；源码 `release` 与桌面均只保留 `1.1.4` 最新安装器。
- `1.1.5` 新增局部人脸自然化处理；`1.1.4` 安装器和解包产物仍保留在当前 `release` 目录，`1.1.5` 为当前最新安装器。
- 2026-08-24 将页面能力识别、极简直传和任意文件夹批量降 AI 感纳入 `1.1.5` 同版本安装器；上一份同版本安装器、blockmap 和桌面副本已归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.5-pre-runtime-capability-direct-folder-20260824-000233`。
- 2026-08-24 连一连中转站 Key-only 接入完成后重新构建并覆盖安装 `1.1.5`；上一份同版本安装器归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.5-pre-relay-key-only-20260824-144427`。覆盖前正式 AppData 备份到 `D:\Yaochuang-Workshop\ManualTestBackups\before-1.1.5-relay-key-only-overwrite-20260824-144427\AppData`，源、备份及安装后均为 `2620` 个文件、`450617751` 字节。
- 2026-08-24 中转站 `terminated` 热修重新构建 `1.1.5`；上一份同版本安装器、blockmap、解包目录和桌面副本归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.5-pre-relay-terminated-hotfix-20260824-160000`。该热修包随后已覆盖安装，正式 AppData 保留；本次 URL 返回后续源码修复尚未打包。
- 2026-08-24 中转站保真输出完成：主垫图只在原始像素上补边、不提前降采样；返回后逆裁并等比归一，服务原始结果逐字节另存，正式归档为无损 PNG。上一份同版本安装器和桌面副本归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.5-pre-relay-lossless-preservation-20260824-181308`；新安装包已放桌面，未覆盖安装。
- 清洁安装 0.6.13 前的项目、登录资料和任务 `1-6、9` 断点已保存在 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.13-clean-install-20260813-212503`；不得删除、改写或用隔离测试污染该备份。
- `0.6.13` 在 0.6.12 的真实轨道修复上增加一次有限菜单重开，处理并行标签页重建输入区时首次强度入口点击偶发未生效的问题。
- `0.6.14` 新增穿搭提示词范围规则：检测到衣物或配饰参考图后，一键生成提示词只继承原图理解中的光影、妆容与画质，不再带入场景、姿态和面部朝向描述；已生成最新一键安装包。
- `0.6.15` 修复正式做图附件策略：ChatGPT 与 Gemini 只上传红圈蒙脸主垫图及参考素材，未遮挡原图只留作本地备份；发送前新增一键蒙脸硬门禁。
- `0.6.16` 增加清晰的金色“提示词自定义微调”入口和大尺寸编辑弹窗；微调严格继承当前一键生成提示词，取消不写回，保存才更新为自定义草稿。
- `0.6.17` 新增 ChatGPT 后台“网感姿势”分析、8 条金色列表、姿势选择签名与旧草稿失效门禁；同时正式发布主参考图发型优先和提示词冲突清理。
- `0.6.18` 修复保存自定义微调后切换网感姿势会生成空白自定义草稿的问题；一键生成现在显式恢复系统模式，并移除冗余的“生成与导出选项”折叠行。
- `0.6.19` 删除顶栏旧副标题，将穿搭素材面板明确命名为“穿搭参考图”，并把单张任务主按钮收敛为“开始做图”。
- `0.6.20` 将身份、主参考图发型、穿搭和网感姿势收敛为四种互斥提示词分支；删除重复优先级和干扰项，并同步操作指南与 UI 验收。
- `0.6.22` 将一键蒙脸改为可选项；红圈仍然必填，未蒙脸时上传红圈主垫图，蒙脸时继续上传红圈蒙脸主垫图，未标注原图始终只在本地备份。
- `0.6.23` 修复 ChatGPT 对话记录访问限流：发送确认只在 30 秒后最多执行一次对话接口兜底，AI 分析接口兜底降为 30 秒；识别“请求过于频繁”后立即停批并保存断点，不再补发或三路重试。
- `0.6.24` 完全移除 ChatGPT 私有对话记录读取；三路仅串行模型确认、附件上传和发送，实际提交至少间隔 30 秒，发送确认后继续并行出图；标签页错峰建立并增加五分钟访问保护冷却。
- `0.6.25` 针对用户电脑的 `app.asar ERR_FAILED (-2)` 与 GPU sandbox 崩溃改为非 ASAR 发布，并只禁用 Windows GPU sandbox；统一替换新紫黑镜头角色图标。三路 ChatGPT 删除不确定发送补点，将提交间隔提高到 60 秒，并在发送结果无法确认时停止新任务、保留断点。
- `1.1.1` 按 Hale 指定升级正式版本并重做完整图标链：紫黑镜头吉祥物采用短腿、放大头部和表情、贴身香槟金轮廓与纯白大圆角底板，最终主体约占底板 94%，完整露出头顶、双拳和双脚；白底 alpha 边界与桌面 QQ 图标逐像素同尺寸，七档 ICO、托盘、favicon、应用和安装器保持一致。
- `1.1.2` 将 ChatGPT 批量做图升级为状态驱动流程：同页配置复用、GPT-5.5 低/中/高三种模式、100 张任务、最近 10 项自适应节奏、十张休息、限流五分钟零点击冷却、v5 断点和实时运行监控；没有接入不受官方支持的 composer `/` 切模型路径。
- `1.1.2` 同版本图标更新使用 Hale 指定的机器人头像作为唯一视觉源；最终移除红环外白色方形背景，红环和机器人在 32px 下的可见占比与微信开发者工具图标处于同一量级，应用、安装器、快捷方式、托盘、favicon 和工作台统一生成并验证。
- 0.6.13 手测产生的 828 个用户数据文件、专属登录资料和桌面测试项目已完整移到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.14-clean-install-20260813-234707`，原始与备份均为 `139808501` 字节。
- 0.6.14 手测现场已保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.15-clean-install-20260814-003359`；AppData 为 801 个文件、124266665 字节，桌面项目为 2 个文件、620170 字节。
- 0.6.15 手测现场已完整保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.16-clean-install-20260814-013035`，共 793 个文件、128333922 字节。
- 0.6.16 手测现场已完整保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.17-clean-install-20260814-030758\AppData`，共 799 个文件、114107190 字节。
- 0.6.18 手测现场已保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.19-clean-install-20260814-040823`；关闭前 AppData 为 825 个文件、127476943 字节，应用退出后 5 个运行时临时文件自行消失，最终持久备份为 820 个文件、127413277 字节；桌面测试项目为 2 个文件、724977 字节。
- 0.6.19 手测现场已保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.20-clean-install-20260814-050229`；最终 AppData 为 800 个文件、151381806 字节，桌面测试项目为 3 个文件、1940780 字节。
- 0.6.20 手测现场已保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.21-clean-install-20260814-061852`；关闭前 AppData 为 693 个文件、113558383 字节，应用退出后最终持久备份为 691 个文件、113929432 字节；本轮没有新增桌面项目文件。
- 0.6.21 手测现场已保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.22-clean-install-20260814-105327`；AppData 为 1120 个文件、187761654 字节，并备份了两个桌面测试项目。
- 0.6.22 手测现场已保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.23-clean-install-20260814-233742`；AppData 为 1149 个文件、355472813 字节，桌面测试项目为 23 个文件、12306445 字节，备份总计 1172 个文件、367779258 字节。
- 0.6.24 手测现场已保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-0.6.25-clean-install-20260815-225217`；正式 AppData 为 881 个文件、149482501 字节，桌面项目与文件为 5 个文件、258161721 字节；项目、断点和专属 Chrome 登录资料均未永久删除。
- 1.1.1 手测现场已保存到 `D:\Yaochuang-Workshop\ManualTestBackups\before-1.1.2-clean-install-20260816-191436\AppData`，共 1317 个文件、251458838 字节；卸载返回 0，正式安装目录、AppData、快捷方式和专属 Chrome 进程均不存在，普通 Chrome 未被关闭。

## 当前最新维护项

- 2026-09-12 完成 `1.2.4` macOS 源码第一轮适配：移除 Mac 对 Windows 固定 AppData/D 盘导出目录的依赖，补充 macOS Chrome/Edge 发现、专属浏览器最小化与精确进程清理、ICNS 生成、当前架构 DMG 配置及源码/打包后自检脚本。Windows 侧 `typecheck`、全量 `285/285`、平台策略 `9/9`、Electron 壳层、ChatGPT 模型/上传夹具、100 组 API 故障注入与结果持久化均通过；真实 `.app`、DMG、签名、公证和 Gatekeeper 必须在目标 Mac 验证，不能提前声称已发布。交接见 `docs/MACOS_HANDOFF.md`，现行验收清单见根目录 `MACOS_VALIDATION.md`。

- 2026-09-12 修复 ChatGPT 生成中的白板占位图被提前保存：旧逻辑只看尺寸、解码和字节数，且在生成控件持续 20 秒时可强制视为稳定；同尺寸白色 Canvas 因此可能被保存为 JPG。现在使用现有 sharp 对解码像素做轻量内容就绪检查，要求生成状态结束、非空非近乎纯色，并连续两次确认相同的非占位像素内容；保存前再次检查，并复用最后一次通过校验的快照。
- 新增 src/main/chatGptImageReadiness.ts 与 tests/chatGptImageReadiness.test.mjs，更新 ChatGPT 结果完整性测试。定向测试 25/25、完整 npm test 280/280、构建/typecheck、Electron 壳层、结果持久化和打包 Windows 兼容性均通过。没有修改 UI、提示词、上传、并行、原图、红圈、参考图、结果归档、断点或用户数据；本次保持 1.2.4，安装器已重新打包并放至桌面，未安装、未提交。详细记录见 docs/unreleased-chatgpt-blank-result-save-hotfix.md。

- 2026-09-07 自由 API 已完成：用户填写服务地址和 Key，折叠接口设置可修改协议、模型、图片编辑路径和模型列表路径。没有内置地址/Key；配置加密保存，更改目标需重新粘贴 Key；原来的仅 Key 配置需要重新填写一次，不做隐式迁移。支持当前 OpenAI multipart 和 Bearer Gemini 流式图片协议，不承诺任意 API 均兼容。
- 面部自然化修复预览与原图坐标不一致、JPEG 重编码背景/丢透明度、空/越界蒙版假成功，以及真实全身照小脸漏检。输出为独立无损 PNG；整图未识别时最多五个局部识别，不降低置信度，不修改整图降 AI 感算法。
- 本次全量 `278/278`、typecheck、100 场 API 本地故障注入及相关 UI/自动化回归通过。源码与打包 Windows 程序均实际完成标准/自定义香蕉本机夹具生成保存、配置重启恢复和 1086x1449 真实本地人像自然化；rendererErrors=[]，真实付费请求为 0。14 张 UI 巡检通过。首次模型验证清理临时目录 EPERM 后独立重跑退出 0。
- 新包已放桌面并核对源/副本 SHA-256 一致，桌面只保留该一份安装器；上一份源/桌面包保存在 `D:\Yaochuang-Workshop\ReleaseArchive\1.2.4-pre-free-api-face-20260907`。未安装、未提交。详细修改清单、证据、协议与图像限制见 `docs/unreleased-free-api-face-naturalization.md`。

- 2026-09-07 未发布源码适配 ChatGPT 新版网页：识别 `section[data-turn="assistant"]`，修复助手计数为 0 导致约 60 秒 `no-signal` 提前结束；模型菜单按“选择模型”可访问名称展开，排除 inert/非活动面板，识别“最新”选项并读取当前滑块状态说明。保持极简直传零模型探测、发送门禁、互斥队列、断点和图片保存规则。
- 网页适配阶段新增 5 项先红后绿回归，当时全量 `271/271`，相关专项通过。真实网页只做结构核对，没有提交新的真实做图任务；该阶段未单独打包，现在已包含在顶部记录的 9 月 7 日自由 API 安装包中。详细证据与验证边界：`docs/unreleased-chatgpt-september-page-adaptation.md`。

- 2026-08-26 根据真实香蕉批次 `0/3` 现场修复 406 处理：日志证明直连已到达 API，但香蕉上游在约 19 秒后返回明确拒绝；旧客户端把同一任务自动付费重投一次，才显示成“连续两次拒绝”。现在首个 406 即停止该模型的新任务并熔断 120 秒，同一任务不会自动重投；后续任务和失败任务均保留在事务断点，再次点击只继续缺失任务。
- API 错误现保留脱敏服务端 `message/type/code/request-id`，任务日志增加模型、分辨率、附件数量和总字节数，不记录 Key、提示词或图片内容。批次状态明确提示可稍后重试或手动改用标准图片，软件不会静默切换模型。
- 定向 API/事务测试 `26/26`、全量 `266/266`、API 故障注入 `100/100`、typecheck、结果保存、Electron 壳层和 UI 14 张截图全部通过。没有使用真实 Key 或发起付费生成；香蕉上游是否继续返回 406 仍需服务商恢复或 Hale 手测确认。本轮保持 `1.2.4`，打包 Windows 程序实际启动通过，最新安装包为 `137792052` 字节，SHA-256 `CA3FCBF0514358F86B49D05992AB012C86431D9694F88328536D747D3551057A`；未自动安装、未提交。维护记录：`docs/1.2.4-relay-upstream-rejection-hotfix.md`。

- 2026-08-26 在关闭 TUN 后完成 API 直连复核：保留旧代理环境变量和显式清空代理环境变量两种情况下，模型、标准图片和香蕉生图端点均在约半秒内返回预期鉴权响应；证明 DNS、TLS 和直连 HTTP 路径可达。API 核心 `30/30`、故障注入 `100/100`、全量 `265/265` 及全部相关 Electron/UI 专项通过。本轮没有发现新的可复现软件缺陷，没有修改业务实现、升级、安装或付费调用。随后按 Hale 要求重新打包，打包 Windows 程序实际启动通过。维护记录：`docs/unreleased-relay-direct-network-revalidation.md`。
- 最新 `1.2.4` 安装包大小 `137791615` 字节，文件版本与产品版本均为 `1.2.4`，SHA-256 `FA7C5A6BCF49EB6BEAFD000331D5306C68E8D9DF978F391E21DE29F89ABE561C`。桌面与源码 `release` 均只保留一份最新正式安装器；旧活动安装器归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.2.4-pre-direct-network-rebuild-20260826-013321`，新构建中间物归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.2.4-direct-network-rebuild-build-artifacts-20260826-013505`。

- `1.2.4` 未发布源码修复统一了手机图片导入：主图、人脸参考图、穿搭参考图和结果归档入口支持 JPG/JPEG/PNG/WebP/HEIC/HEIF。标准图片原字节保留；HEIC/HEIF 在受限 Worker 中解码为无损 PNG，并保持像素宽高；损坏图片在写入项目之前明确拒绝。
- 本地 AI 分析和网感姿势根据实测耗时调整：优先 `gemma3:4b`、模型保温 10 分钟、请求上限 180 秒，网感姿势限制为 900 token。真实 HEIC 4032x3024 导入、本地四字段分析和 8 项姿势选择均在隔离 Electron 中完成。
- 首装默认改为“本地模型分析 + 耀创工坊专属 API 做图”，启动不再自动探测或打开 ChatGPT；只有明确选择网页路线后才维护专属 Chrome。`npm test` 265/265，typecheck、启动公告、UI、六档画布、Electron 壳层、蒙脸、保存、ChatGPT 模型/上传、Gemini、网感姿势及 API 100 轮故障注入均通过。维护记录：`docs/unreleased-first-use-image-import-and-local-analysis-hardening.md`。
- 本轮保持 `1.2.4`，未重新打包、未安装、未提交；当前正式安装包信息仍以本文件顶部记录为准。

- `1.2.4` 为 API 批次新增原子事务断点：付费 POST 前记录 `submitting`，结果原子保存后记录 `saved`；异常重启会把遗留提交标成待确认，不自动重复扣费，再次点击只继续缺失任务并恢复已保存序号。
- 标准图片和香蕉生图统一使用模型级 406 保护：首个明确拒绝不自动重投，立即短时熔断 120 秒，熔断期间不会再发送付费请求。连接断流仍进入待确认，不伪装成可安全自动重试。
- `npm test` `266/266`、API 故障注入 `100/100`，typecheck、UI、Electron、结果保存等专项通过。验证只使用本地夹具和隔离用户目录，没有真实付费调用。维护记录：`docs/1.2.4-relay-transaction-resilience.md` 与 `docs/1.2.4-relay-upstream-rejection-hotfix.md`。
- `1.2.4` 安装包大小 `136348107` 字节，文件版本和产品版本均为 `1.2.4`，SHA-256 `6C2D9C4F7A937E69FFD96C2593B2787050285A255F77817D5FE953C4A1E31F98`；桌面副本哈希一致，本轮未自动安装、未提交。

- `1.2.3` 修复 API 两类现场故障：标准图片同步结果出现 `UND_ERR_SOCKET` 或香蕉流式结果断线时，当前付费任务不自动重提、进入待确认，下一任务切换备用网络通道；香蕉 `HTTP 406 openai_error` 独立归类为上游拒绝，保持直连并只做一次 3 秒后的安全重试，连续 406 才停止派发新任务。
- API 批量监控现区分失败与待确认；鉴权、限流和连续上游拒绝只停止新任务，已经发送的其他通道继续等待和保存。定向 API 测试 `20/20`、`npm test` `251/251` 通过，本轮未使用真实 Key 发起付费请求。维护记录：`docs/1.2.3-relay-result-recovery-hotfix.md`。

- `1.2.3` 修复“网页输入框可用但软件仍无法 AI 分析或启动自动化”的状态脱节：用户主动点击 ChatGPT“检查登录”时，在冷却结束、登录有效且输入框可用的前提下执行一次受控恢复核验；后台启动检查仍不会自动解除保护。
- 历史 `doubao`、`openai` 或未知分析来源统一归一为 ChatGPT，避免升级用户进入界面不存在的分析路由。没有改动附件、提示词、模型、保存、断点和并行策略。
- `npm test` `247/247`，typecheck、UI、Electron、ChatGPT 模型/上传、Gemini、网感姿势、结果保存、六档画布和可选蒙脸专项通过。维护记录：`docs/1.2.3-ai-analysis-and-automation-recovery-hotfix.md`。
- `1.2.3` 安装包大小 `136344562` 字节，文件版本和产品版本均为 `1.2.3`，SHA-256 `41C4E2961A2DFD2E3AFF215177A97C606FC8352056FD8371D6B3952F08BE1B5E`；打包 Windows 程序实际启动通过，本轮未自动安装。

- 2026-08-25 新增 API 图片模型选择：`标准图片` 继续使用 `gpt-image-2` 的 `/v1/images/edits`，`香蕉生图` 使用 `gemini-3.1-flash-image-preview` 的原生 Gemini 流式接口。连接检查、批量任务、主面板摘要和配置弹窗均跟随当前选择，两个模型之间不静默切换。
- 真实手测曾出现香蕉任务 1 在约 39 秒后接收结果时 `ECONNRESET`、任务 2 随后约 2 秒内连续失败；同一配置稍后可连续 `2/2` 成功，确认是长响应连接间歇中断和异常通道复用，不是 Key、模型或协议持续无效。
- 香蕉结果改为通过 `streamGenerateContent?alt=sse` 逐事件读取：完整图片到达后即保留；图片前断线不重提付费 POST，下一任务切换另一条现有网络通道并重新确认连接能力。
- 新增图片到达后断线保留、断线后通道切换两项 TDD 回归；`npm run typecheck` 与 `npm test` `246/246` 通过。真实 Key 未进入源码、项目、设置、断点、日志或测试；本次热修没有再次发起付费生成。维护记录：`docs/unreleased-relay-banana-image-model.md`。
- Electron 壳层、结果持久化和打包 Windows 启动专项通过；最终安装包大小 `136344940` 字节，SHA-256 `BF14CA3DD68297EF35C74FF91968752B620FA7469AD28ED2F4A3FE3C62947DAC`，已同版本覆盖安装并启动。桌面只保留最新 `1.2.2` 安装包，旧桌面安装器归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.2.2-pre-banana-stream-hotfix-20260825`。

- `1.2.2` 修复 API 网络单路径问题：默认先直连，仅在连接级故障时回退 Electron/Windows 系统代理；直连成功时代理调用为 0，401/403、429 和模型未开放不会误触发网络切换。成功能力检查按 Key 指纹在当前运行中复用，付费生成 POST 保持至多一次提交。
- API 模式新增默认关闭、自动折叠的“使用原图理解”。关闭时一键提示词直接依据主垫图，不读取四段原图分析和旧网感姿势；开启后恢复原有 AI 分析与网感姿势，切换会使旧提示词失效。检查清单同步隐藏无关分析建议。
- `npm test` `242/242`，typecheck、UI、Electron、ChatGPT 模型/上传、Gemini、网感姿势、结果保存、六档画布、可选蒙脸和打包 Windows 启动专项全部通过。直连/代理切换使用故障注入验证，未使用真实 Key 或付费请求。维护记录：`docs/1.2.2-relay-network-and-optional-analysis.md`。
- `1.2.2` 安装包大小 `136343015` 字节，文件版本和产品版本均为 `1.2.2`，SHA-256 `810C7B534F246DA13BEC1CA06230AF2C5214874C19424121B4C33ED3B6C15831`；桌面副本哈希一致，本轮未覆盖安装、未提交。

- `1.2.1` 删除不稳定的豆包网页分析前置链路，以本地 Ollama 视觉模型承担 AI 分析和网感姿势；新增服务/模型检测、官方安装入口、`qwen2.5vl:3b` 下载进度与错误状态。当前电脑已实际检测到多套可用视觉模型，本轮未额外下载。
- 制作通道改为可收起摘要，API 配置只保留在制作通道；并行选择整行铺满，结果归档操作重排为两项批处理与紧凑“全部”入口。Gemini 继续灰显。
- `npm test` 237/237，typecheck、UI、Electron、ChatGPT 模型/上传、Gemini、网感姿势、结果保存、六档画布、可选蒙脸和打包 Windows 启动专项全部通过。维护记录：`docs/1.2.1-local-analysis-and-workflow-ui.md`。
- `1.2.1` 安装包大小 `136341611` 字节，文件版本和产品版本均为 `1.2.1`，SHA-256 `3EE99BAB4B74E296FD39AB29F34D396246CCD101EE5A04D0507D30E55698DA65`；桌面副本哈希一致，本轮未覆盖安装、未提交。

- `1.2.0` 同版本豆包热修收紧输入区残留附件判定，空白输入区的普通图片、上传入口和文件输入框不再造成“无法确认已经清空”误报；真实文本和真实附件卡片仍阻止发送，发送状态不确定时仍不补点。
- “查看豆包”现在明确请求可见窗口，缓存窗口同步显示，并通过 Windows `BringWindowToTop` 恢复到耀创工坊上方；专属 Chrome 窗口恢复与 20 轮显隐循环通过。
- Gemini 在制作通道和分析来源中均灰显禁用并提示适配中；ChatGPT、豆包网页和耀创工坊专属 API 保持可用。上一份同版本安装器已归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.2.0-pre-doubao-composer-window-hotfix-20260824-202904`，新安装器大小 `136345432` 字节，SHA-256 为 `C3B7BB3147A0C7DD621170C1C50606ED07F6705541EA559583FECFFF94DA6946`。维护记录：`docs/1.2.0-doubao-composer-window-hotfix.md`。
- `1.2.0` 将最终做图通道前置到 AI 分析之前，明确组合 `ChatGPT / Gemini / API` 做图与 `ChatGPT / Gemini / 豆包网页`分析来源；新增独立豆包网页分析与网感姿势适配器，API 做图不再阻断网页分析。
- 用户可见 API 文案统一为“API”或“耀创工坊专属 API”，连接成功状态为“API 已连接，当前分组已开放 gpt-image-2。”；旧服务商显示名不再进入软件界面、状态或错误提示。
- `npm test` 236/236，typecheck、UI、Electron、ChatGPT 模型/上传、Gemini、网感姿势、结果保存、六档画布、可选蒙脸和打包 Windows 启动专项全部通过。维护记录：`docs/1.2.0-provider-first-doubao-api-branding.md`。
- `1.2.0` 安装包大小 `136344887` 字节，SHA-256 `FAB8BCFC676EB6B5D76D5A65622E347A8E03E500C67B94F4EC38BF29E17CF162`；桌面副本哈希一致，本轮未覆盖安装、未提交。

- 2026-08-24 将 `camera-realism-code-only.zip` 的完整主成像链路移植到现有 TypeScript + `sharp` 处理器：桶形畸变、明暗染色、宽/细细节、光晕、暗角、色差、边缘柔化和局部方差颗粒均已接入；没有引入 Python 运行时。
- “批量降 AI 感”金色窗口新增 10–100 处理强度滑块，默认 50 对应自然参数，100 对应强烈参数；结果归档和任意文件夹批处理共用该强度。
- 每张图在主进程生成独立随机种子，没有沿用 ZIP 的固定种子；输出仍保持原尺寸、另存副本、单张失败不阻断整批。
- TDD 定向测试先为 `9 通过 / 4 失败`，实现后 `13/13`；`npm test` `222/222`，typecheck、UI、Electron、六档画布、可选蒙脸、结果保存、ChatGPT 模型/附件、Gemini 和网感姿势专项全部通过。维护记录：`docs/1.1.5-camera-realism-full-finish-strength.md`。
- 最新同版本桌面安装包已更新，大小 `136334073` 字节，SHA-256 `F23FD87D4950525B9764D73897CB043FAF79901CB4988AC3BCBA5501FD1020BF`；打包后 Windows 启动专项通过，已覆盖安装供 Hale 手测，未提交。

- 2026-08-24 完成未发布源码优化：ChatGPT 正式做图改为每通道复用独立对话，单路、二路、三路只建立 1、2、3 个初始会话；每个会话完成 4 张后轮换，只接受本轮基线后的新回复和新图片。
- 正常提交间隔最低 60 秒，发生保护后的恢复阶段最低 120 秒；冷却结束不再自动继续，网页“知道了”不会清除软件保护状态。人工检查确认页面稳定后先单路，连续成功 3 张恢复二路，再成功 3 张才恢复三路；一小时内第三次保护改为人工恢复。
- 新增独立“中转站 API” Provider、安全配置窗口和 `RelayImageAdapter` 契约。2026-08-24 已根据连一连公开端点及其链接的 `Wei-Shaw/sub2api` 开源协议接通固定传输层：`gpt-image-2`、同步 `/v1/images/edits`、multipart 多图、URL/Base64 结果。配置窗口只需粘贴自己的 Key；记住本机时使用 Electron `safeStorage`，密钥不进入设置、项目、断点或日志。
- 2026-08-24 中转站 4 张批次第 4 张出现裸 `terminated`：根因是同步图片接口在读取大体积 Base64 响应体时长连接被提前关闭。第一版热修曾优先尝试异步提交，但真实连一连部署返回 `404`，证明该部署没有启用上游异步图片存储能力；当前实现已删除这条无效探测。
- 中转站 1/2/3 路结果继续保持原图精确像素尺寸并进入原有结果归档；普通单张失败不阻断整批，401/403 与 429 会停止批次，不回退 ChatGPT/Gemini。第一版热修后 `npm run typecheck`、`npm test` `228/228`、Electron 壳层和结果持久化专项通过；新增任务阶段脱敏日志，不记录 Key、提示词或图片。该热修随后已覆盖安装。维护记录：`docs/unreleased-conversation-reuse-protection-relay-provider.md`。
- 2026-08-24 双路中转站现场再次出现 `0/2`：任务 1 在 `430ms` 内无 HTTP 响应并报裸 `fetch failed`，任务 2 回落同步 Base64 长连接后在 `190554ms` 连接中断，另一次尝试还返回 Key 分组未启用图片生成。当前实现删除未启用异步端点探测，改为正式 `/v1/images/edits` 请求 URL 结果；URL 下载底层中断只重试 1 次 GET，生成 POST 不重试；网络错误展开标准原因，批次开始前检查 `/v1/models` 是否包含 `gpt-image-2`。`npm run typecheck`、定向 11/11、`npm test` 229/229、Electron 壳层、结果持久化及打包 Windows 启动专项通过；未使用真实 Key 或扣费请求，未升级、未提交。
- 本次 URL 返回热修安装包大小 `136335325` 字节，SHA-256 为 `5C8C38E04D530E083ADA16D55F52D96CF878FA00EB422F0574A0D59A0BD1D65C`；文件版本 `1.1.5`、产品版本 `1.1.5.0`。上一份同版本安装器与构建产物归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.5-pre-relay-url-hotfix-20260824-164922`；覆盖安装前正式 AppData 备份到 `D:\Yaochuang-Workshop\ManualTestBackups\before-1.1.5-relay-url-overwrite-20260824-165243\AppData`，安装前源数据与备份均为 `2671` 个文件、`465383696` 字节，覆盖安装后保持一致。已安装程序包含当前 URL 返回、嵌套网络错误分类和批次前模型权限检查，窗口启动并响应正常。
- 2026-08-24 修复中转站尺寸损伤：旧路径把 `1024x1536` 直接拉到 `1279x1706`，宽高倍率不同并再编码为 JPG；新路径使用原像素补边、映射逆裁、等比归一、原始字节另存和无损 PNG 归档。TDD 覆盖逐像素原图一致、原始文件逐字节一致和精确尺寸；`npm test` 231/231，全部专项验证通过。服务名显示改为“API”，配置状态改为“可使用 API 做图”。

- 2026-08-23 完成未发布源码修复：专属 Chrome 目标页选择改为综合 URL、活动输入框、页面可见性和正文状态；免费版无模型菜单被识别为自动模型，不再误报页面异常，Plus/Pro 三级菜单保持原路径。
- 新增“极简直传”：模型与思考强度 DOM 查询和点击均为 0，沿用网页当前设置；页面、附件、发送和结果保存安全门禁保持不变。
- Electron 主窗口新增 `did-fail-load`、`render-process-gone`、`child-process-gone` 本地诊断与可见失败页；没有证据时不全局关闭 GPU。专属 Chrome 已移除不受支持的 `AutomationControlled` 参数。
- “批量降 AI 感”支持导入任意本地文件夹，1/20/100 张、损坏图隔离、伪 HEIC 拒绝、独立随机种子、不覆盖原图和外部结果不入项目归档均通过验证。
- `npm test` 为 `209/209`；Electron、UI、六档画布、ChatGPT 模型/附件、AI 分析/网感姿势、可选蒙脸、结果保存和 Gemini 专项全部通过。未操作真实账号批量发送；版本仍为 `1.1.5`，未提交、未安装。2026-08-24 已重建安装包并通过打包程序专项验证。维护记录：`docs/unreleased-runtime-capability-direct-folder-batch.md`。

- 2026-08-23 发布 `1.1.5` 局部人脸自然化：复用现有 MediaPipe 人脸定位和皮肤分割，只在识别到的人脸区域做低强度纹理、色彩和局部噪点统一，背景、服装和原结果保持不变。
- 入口位于结果归档标题栏，固定为“批量降 AI 感”金色主按钮在前、“批量面部自然化”深色次按钮在后、“查看全部”最后；批量自然化默认全选，支持逐张勾选、全选、清空和进度显示。
- 每张自然化结果作为新图片加入归档并另存 `*_面部自然化.jpg`；没有可靠人脸的单张任务会记录失败原因，不阻止其他选中图片继续处理。
- `npm run typecheck`、`npm test` `198/198`、`npm run verify:ui`、`npm run verify:packaged-windows`、`npm run verify:electron-shell` 均通过；实际结果归档按钮截图保存于 `D:\Hale_Files\Documents\ChatGPT\学习及了解最新GitHub\output\playwright\face-naturalization-real-ui-empty.png`。
- `1.1.5` 已在后续同版本更新中覆盖安装；正式 `D:\Yaochuang-Workshop\AppData` 已在安装前完整备份并保持不变。维护记录：`docs/1.1.5-face-naturalization.md`。

- 2026-08-23 发布 `1.1.4` 可选择批量降 AI 感：打开结果选择窗口后可逐张勾选、全选或清空，按选择顺序逐张处理并显示进度；原图完整保留，单张失败不阻止其余已选图片。
- 打包程序隔离验证导入 3 张、取消第 2 张并处理 2 张，归档由 3 增至 5，只生成第 1、3 张副本，控制台错误为 0。当前已安装的 `1.1.3` 未被覆盖，正式 AppData 未改动。
- `1.1.3` 首次发布结果归档“一键降 AI 感”：允许全图像素与细节变化，但始终保留原结果并另存 `*_相机质感.jpg`；不同输入使用不同的哈希派生颗粒种子，不复用固定纹理。该功能不进入 ChatGPT/Gemini 上传与生成链路，也不承诺通过特定 AI 检测器。
- 新增 `sharp 0.35.3` 运行依赖及可信 IPC。入口移动到“结果归档”标题栏、“查看全部”左侧，并采用金色边框；结果卡片内不再重复显示按钮。全尺寸本地读取限于当前桌面项目目录并校验真实路径，手动导入回退到自身图片数据；保存执行临时文件、JPEG/尺寸校验和原子重命名。
- 当前正式源码和安装程序包含 ChatGPT 自动化修订：工作模式跟随网页当前模型、同页配置复用、12/20/30 秒自适应提交节奏、60 秒无进展与 180 秒硬截止，以及独立持久的 `PROTECTION_PAUSED` 访问保护状态。
- 保护期间零点击；到期只自动检查一次，仍受保护时等待人工检查。恢复后先单路，再二路，连续健康后才恢复用户选择的三路；已发送任务继续只读等待和保存，未发送任务保留断点。
- 2026-08-22 源码热修 AI 分析与网感姿势：后台发送点击只有在输入、附件、消息计数和页面状态共同证明完全无效时才补点一次；明确未发送不再写五分钟安全锁或假待恢复记录。网感姿势移除 JSON 键名与“不要英文”的冲突，稳定无效回复不再空等四分钟。
- `1.1.4` 已通过 `197/197` 全量测试、全部非真实账号专项验证、打包 Windows 启动验证和可选择批量处理端到端验证；已生成桌面安装器，未覆盖安装。

## 1.1.5 最新正式安装包

- “批量降 AI 感”继续作为结果归档标题栏的主操作；“批量面部自然化”是同一结果选择流程中的局部后处理入口，不改变批量降 AI 感的入口和行为。
- MediaPipe 在 renderer 中对每张结果图识别人脸，生成只覆盖面部皮肤的透明处理蒙版；主进程用 `sharp` 做轻度中值降噪、肤色饱和度统一和低比例混合，输出保持原始像素尺寸。
- 自然化链路不会替换身份、修复错误五官或保证每张图达到“原图一样完美”；它只改善已经生成的人脸与当前画面之间的局部融合感，无法可靠识别时会停止该张并保留原图。
- `npm run typecheck` 通过；最新 `npm test` 为 `231/231`；UI、Electron 壳层、六档画布、结果持久化、可选蒙脸、ChatGPT 模型与上传、Gemini、网感姿势和打包 Windows 启动专项全部通过。
- 安装器大小 `136337878` 字节，SHA-256 为 `8BD9A3931BBE44BC58E279A26C4ABF73B2AD09F0B401ADB4D662FE766F0EA8FB`；安装器文件版本/产品版本为 `1.1.5`/`1.1.5`，解包应用为 `1.1.5`/`1.1.5.0`。本轮仅更新桌面安装包，没有覆盖安装。
- 桌面副本：`D:\Hale_Files\Desktop\耀创工坊 1.1.5 一键安装包.exe`；源文件与桌面副本哈希一致，桌面只保留该最新安装包。
- 维护记录：`docs/1.1.5-face-naturalization.md`、`docs/unreleased-runtime-capability-direct-folder-batch.md`、`docs/unreleased-conversation-reuse-protection-relay-provider.md`。

## 1.1.4 历史正式安装包

- “批量降 AI 感”位于结果归档标题栏、“查看全部”左侧；点击后显示全部归档候选，默认全选，支持逐张勾选、全选和清空。
- 按选中顺序逐张处理，显示完成进度；每张成功结果作为新图片加入归档，原结果始终保留，单张失败不会取消其余选择。
- `npm run typecheck` 通过；`npm test` 为 `197/197`；UI、六档画布、Electron 壳层、可选蒙脸、结果保存、ChatGPT 模型与附件、Gemini、网感姿势以及打包 Windows 启动专项全部通过。
- 打包程序隔离复测中，导入 3 张并取消第 2 张后只处理 2 张，归档增至 5 张，只保存 `batch-source-1_相机质感.jpg` 和 `batch-source-3_相机质感.jpg`，控制台错误为 0。
- 安装器大小 `136315124` 字节，SHA-256 为 `70A5F48A71CBFB073CEABB3309216DB12839249016EEA2E1A18D3C5D4E3665EF`；安装器文件/产品版本均为 `1.1.4`。
- Microsoft Defender 定向扫描未发现威胁，安装器仍未配置商业代码签名；本轮未提交、未覆盖安装，正式 AppData 与当前已安装 `1.1.3` 保持不变。
- 维护记录：`docs/1.1.4-selectable-camera-realism-batch.md`。

## 1.1.3 历史正式安装包

- “一键降 AI 感”位于结果归档标题栏、“查看全部”左侧，使用金色边框；对最新结果生成独立相机质感副本，不覆盖原图。
- 使用 `sharp 0.35.3` 在本机完成全图相机质感处理；不同输入采用不同哈希派生颗粒种子，输出保持原始像素尺寸。
- `npm run typecheck` 通过；`npm test` 为 `197/197`；UI、六档画布、Electron 壳层、可选蒙脸、结果保存、ChatGPT 模型与附件、Gemini、网感姿势以及打包 Windows 启动专项全部通过。
- 已安装程序隔离复测中，导入 1 张结果并点击按钮后归档增至 2 张，生成独立 `*_相机质感.jpg`，控制台错误为 0。
- 安装器大小 `136313934` 字节，SHA-256 为 `6E8B96F162A449FA1A47F7D738F7262865EE051A9B0F1299D1A4B98EFF3857A8`；安装器文件/产品版本均为 `1.1.3`，安装应用产品版本为 `1.1.3.0`。
- 覆盖安装前正式 AppData 已完整备份到 `D:\Yaochuang-Workshop\ManualTestBackups\before-1.1.3-camera-realism-overwrite-20260822-225529\AppData`，源与备份均为 `1888` 个文件、`296099744` 字节。
- 静默覆盖安装返回 `0`；安装过程中正式 AppData 文件数和总字节数均未变化。Microsoft Defender 定向扫描未发现威胁，安装器仍未配置商业代码签名；本轮未提交代码。
- 维护记录：`docs/1.1.3-one-click-camera-realism.md`。

## 1.1.2 历史正式安装包

- ChatGPT 模型与思考强度采用页面级可验证配置状态；默认跟随网页当前模型，快速、均衡、稳定高质只控制低、中、高思考强度，相同配置不再为每张图重复点击。
- 批量上限为 100 张；健康、降速、恢复提交节奏分别为 12/20/30 秒，三路标签页启动每路错峰 10 秒，每完成 10 张仍自动休息 120 秒。
- 生成等待加入 60 秒无信号提前停止、回复结束无图片 15 秒观察和不可续期的 180 秒硬截止；访问保护冷却截止时间不能被重复提示向后顺延。
- 已发送但结果未知的通道进入 `MANUAL_REVIEW` 并退出当前 worker，不再给其他健康通道安装全局五分钟锁；运行面板分别显示待执行、待确认、完成和失败。
- 2026-08-17 同版本热修补齐冷却恢复门禁：到期后最多确认一次旧访问保护弹窗，页面恢复才继续；仍受限时停止并保留断点，不再滚动顺延五分钟。多路恢复共享一次检查。
- 2026-08-17 同版本图标更新：以 Hale 指定的机器人图片为唯一主图，移除红环外白色方形背景并等比放大到接近微信开发者工具图标的桌面占比，生成七档透明 ICO，并同步安装器、主程序、快捷方式、托盘、favicon 和工作台。
- 思考强度门禁补齐 `Home` 键无效短滑块的轨道定位和有限归零，仍然只有准确读回目标档位才允许上传。
- `npm run typecheck` 通过；`npm test` 为 `194/194`；六档画布、Electron 壳层、可选蒙脸、结果保存、ChatGPT 模型与附件、Gemini、网感姿势及打包 Windows 启动专项全部通过。
- 打包 EXE 运行时为 1.1.2，`resources/app` 存在、`app.asar` 不存在，GPU 兼容开关启用、renderer 沙箱保持启用。
- 当前安装器大小 `129910918` 字节，SHA-256 为 `EA56ECE0B8A86DB53ED561023DC2D492C5292B78633F349CEAC4ABDB5CACC1B9`；安装器文件/产品版本均为 `1.1.2`。
- 维护记录：`docs/1.1.2-chatgpt-adaptive-batch-automation.md`、`docs/1.1.2-chatgpt-cooldown-recovery-hotfix.md`、`docs/1.1.2-robot-icon-refresh.md`、`docs/unreleased-chatgpt-automation-speed-and-protection.md`、`docs/unreleased-ai-analysis-web-pose-send-hotfix.md`。
- 本轮覆盖安装前正式 AppData 已完整备份到 `D:\Yaochuang-Workshop\ManualTestBackups\before-1.1.2-speed-protection-overwrite-20260821-191428\AppData`；源与备份均为 `1416` 个文件、`171066933` 字节。
- 同版本静默覆盖安装返回 0；安装目录主进程与本次解包构建 SHA-256 一致，应用窗口响应正常，安装前后 AppData 文件数和总字节数一致；本轮未提交代码。
- 2026-08-22 再次同版本覆盖安装前，正式 AppData 已完整备份到 `D:\Yaochuang-Workshop\ManualTestBackups\before-1.1.2-ai-analysis-web-pose-overwrite-20260822-132214\AppData`，源与备份均为 `1424` 个文件、`172664804` 字节；上一安装器归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.2-pre-ai-analysis-web-pose-hotfix-20260822-132214`。
- 最新覆盖安装返回 0；安装目录主进程 SHA-256 为 `6D33406B883638FF952F57022390C330933C49B0ABD4197A9B9751B2A8736C5F`，与本次构建一致；主窗口启动后响应正常。Microsoft Defender 定向扫描未发现威胁，安装器仍未配置商业代码签名。
- 2026-08-22 保护暂停与恢复修复发布前，上一安装器和构建产物归档到 `D:\Yaochuang-Workshop\ReleaseArchive\1.1.2-pre-protection-pause-release-20260822-203834`；正式 AppData 备份到 `D:\Yaochuang-Workshop\ManualTestBackups\before-1.1.2-protection-pause-overwrite-20260822-204145\AppData`，源与备份均为 `1868` 个文件、`269467403` 字节。
- 本次静默覆盖安装返回 `0`；安装过程中正式 AppData 未变化。安装目录主进程与解包构建 SHA-256 均为 `643AFAC4713AEDEED9552D3E7B80992451AEA839032087200A84117AB0AA30D8`，主窗口启动后响应正常；Microsoft Defender 定向扫描匹配威胁数为 `0`，本轮未提交代码。

## 1.1.1 历史正式安装包

- 去除旧图标整块黑色场景背景，采用短腿、放大头部与表情的紫黑镜头吉祥物；最终主体约占白色底板 94%，完整露出头顶、双拳和双脚，金色轮廓直接贴合主体。
- 白色大圆角底板直接使用桌面 QQ 图标的 alpha 尺寸轮廓：256 像素下均覆盖 `0,0-255,255`，顶边和左边区间同为 `46-209`；没有复制企鹅、红围巾或快捷方式箭头。
- 同一透明主图生成 16、24、32、48、64、128、256 七档 ICO，并同步应用、安装器、快捷方式、托盘、favicon 和工作台。
- `npm run typecheck` 通过；`npm test` 为 `169/169`；UI、六档画布、Electron 壳层、可选蒙脸、结果保存、ChatGPT 模型与附件、Gemini、网感姿势以及打包 Windows 启动专项全部通过。
- 打包 EXE 运行时为 1.1.1，`resources/app` 存在、`app.asar` 不存在，GPU 兼容开关启用、renderer 沙箱保持启用，控制台错误为 0。
- 安装器大小 `130512176` 字节，SHA-256 为 `6AB3807C5821B625BDE80301BF0810B787BCD0B8777FF2EAC73D2DA5FA92FC59`；Defender 新增检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/1.1.1-icon-identity-refresh.md`。
- 本轮未提交、未自动安装；该版本已由 1.1.2 取代，最终安装包已移入归档。

## 0.6.25 历史正式安装包

- 用户现场的失败组合是 `resources/app.asar/dist/index.html` 报 `ERR_FAILED (-2)` 并伴随 GPU sandbox 崩溃，而解包应用配合 `--disable-gpu-sandbox` 可以正常启动。
- electron-builder 改为 `asar: false`，Windows 仅添加 `disable-gpu-sandbox`；没有使用 `no-sandbox`，主 renderer 继续保持沙箱、上下文隔离和禁用 Node 集成。
- 应用、安装器、快捷方式、托盘、favicon 和工作台统一使用 Hale 提供的紫黑镜头角色图，多分辨率 ICO 覆盖 16 至 256 像素。
- 0.6.24 真实日志证明三路问题由不确定发送后的自动补点、批次重试和继续分配叠加造成；0.6.25 删除所有发送补点，提交间隔提高到 60 秒，不确定发送触发五分钟保护并停止新任务，已发送通道仍可继续保存。
- `npm run typecheck` 通过；`npm test` 为 `168/168`；UI、六档画布、Electron 壳层、可选蒙脸、结果保存、ChatGPT 模型与附件、Gemini、网感姿势以及打包 Windows 启动专项全部通过。
- 打包 EXE 确认 `resources/app` 存在、`app.asar` 不存在，运行时为 0.6.25，`disable-gpu-sandbox=true`、`no-sandbox=false`，renderer 控制台错误为 0。
- 安装器大小 `130378945` 字节，SHA-256 为 `41C4D93CD0EC0B60674D20B635C36DFBEF090045E0FF13B1E78FCB895A789A82`；Defender 新增检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.25-windows-startup-icon-and-parallel-safety.md`。
- 本轮未提交、未自动安装；0.6.24 手测数据已备份，旧版已卸载，桌面只保留 0.6.25 安装包，等待 Hale 手动首次安装验证。

## 0.6.24 历史正式安装包

- 新装 0.6.23 的现场日志证明三路任务在同一秒完成上传和发送，并在同一秒收到对话记录访问限制；此前的低频私有会话接口仍会访问被保护目标。
- 已完全移除 `/backend-api/conversation/...` 与 textdocs 读取；三路只串行发送前阶段，发送确认后立即释放提交锁并保持并行生成。标签页按 10 秒错峰，实际提交至少间隔 30 秒。
- 页面检测到对话访问限制后进入五分钟冷却，等待通道直接停止，不再继续点击模型、附件或发送控件；断点与首个真实错误继续保留。
- `npm run typecheck` 通过；`npm test` 为 `167/167`；UI、六档画布、Electron 壳层、可选蒙脸、结果保存、ChatGPT 模型与附件夹具、Gemini 夹具和网感姿势专项均通过。
- 解包应用运行时为 0.6.24，并再次通过六档画布与网感姿势验证；打包代码不存在私有会话接口。真实账号仍处于服务端保护期，本轮没有继续实发请求，未冒充真实账号端到端通过。
- 安装器大小 `128275859` 字节，SHA-256 为 `13107755C38371DC8D1151979B520376AE998A0BA8A5493CEA2459CD3FE65027`；Defender 未发现威胁，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.24-chatgpt-submission-burst-protection.md`。
- 本轮未提交、未自动安装或卸载；当前已安装程序和正式 AppData 保持原样，桌面只保留 0.6.24 一键安装包。

## 0.6.23 历史正式安装包

- 真实根因是发送确认与 AI 分析每 2.5 秒读取 ChatGPT 对话接口，限流弹窗未被识别后又触发补发和任务重试，叠加造成“暂时限制访问对话记录”。
- 发送确认改为 DOM 优先、30 秒后最多一次对话接口兜底；AI 分析接口兜底改为 30 秒。检测到对话访问限制后立即停批、冻结首个错误并保存断点。
- `npm run typecheck` 通过；`npm test` 为 `165/165`；UI、六档画布、Electron 壳层、可选蒙脸、结果保存、ChatGPT 模型与附件夹具、Gemini 夹具和网感姿势专项均通过。
- 解包应用再次通过六档画布和网感姿势验证；真实账号当前已被 ChatGPT 限制，本轮没有继续请求真实资料。隔离空资料的已安装脚本在账号模型刷新处超时，未冒充真实账号端到端通过。
- 安装器大小 `128276907` 字节，SHA-256 为 `F8E03B057723996792B7A82344ECE05C7F244F225CA5D29D4BD51A599787FEF8`；Defender 新增检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.23-chatgpt-conversation-rate-limit-hotfix.md`。
- 本轮未提交、未自动安装；0.6.22 手测数据已备份，旧版已卸载，桌面只保留 0.6.23 安装包，等待 Hale 手动首次安装验证。

## 0.6.22 历史正式安装包

- 将“一键蒙脸”从发送硬门禁改为可选建议项；用户只画红圈也可生成提示词并开始做图。
- 未蒙脸时只上传红圈主垫图，蒙脸时继续上传红圈蒙脸主垫图；未标注原图始终不进入 ChatGPT/Gemini 自动化附件。
- `npm run typecheck` 通过；`npm test` 为 `164/164`；UI、六档画布、Electron 壳层、一键蒙脸、结果保存、ChatGPT 模型与附件夹具、Gemini 夹具和网感姿势专项均通过。
- 解包应用使用隔离资料再次验证未蒙脸发送准备、深浅主题和 1024/1580 宽度；运行时版本为 `0.6.22`，截图位于 `D:\Yaochuang-Workshop\TestArtifacts\0.6.22-packaged-ui`。
- 安装器大小 `128275622` 字节，SHA-256 为 `D4336AF22A6F7B36BFDCE30F57E733DBFC4A854FF7C8583CEC94EDAAE382FD73`；Defender 新增检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.22-optional-face-occlusion.md`。
- 本轮未提交、未自动安装；0.6.21 手测数据已备份，旧版已卸载，桌面只保留 0.6.22 安装包，等待 Hale 手动首次安装验证。

## 0.6.21 历史正式安装包

- 发布上一轮 Superpowers 健康审计确认的状态一致性修复：素材或有效分析变化后旧区域提示词立即失效，替换主图会清理派生状态，已发送快照不会在重启后复活，迟到的旧图分析不会覆盖新主图。
- `npm run typecheck` 通过；`npm test` 为 `163/163`；UI、六档画布、Electron 壳层、一键蒙脸、结果保存、ChatGPT 模型与附件夹具、Gemini 夹具和网感姿势专项均通过。
- 解包应用使用隔离资料再次通过深浅主题、网感姿势和 1024/1580 宽度验证，控制台错误为 0；截图位于 `D:\Yaochuang-Workshop\TestArtifacts\0.6.21-packaged-ui`。
- 安装器大小 `128276397` 字节，SHA-256 为 `F90CFA978B7AA89B375DFF8B8C10505E2E9BDD954B8C524F8F038AE889242D8A`；Defender 匹配检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.20-superpowers-health-audit.md`、`docs/0.6.21-prompt-state-consistency-hotfix.md`。
- 本轮未提交、未自动安装；旧版和正式手测数据已备份清理，桌面只保留 0.6.21 安装包，等待 Hale 手动安装验证。

## 0.6.20 历史正式安装包

- 将正式提示词重组为职责单一的稳定段落，删除多个“最高优先级”、重复素材说明和旧 `Image 2.0` 标记。
- 四种互斥组合覆盖有无穿搭参考图、有无网感姿势；身份只来自全部人脸参考图中的目标男生，发型只来自人脸主参考图。
- 有穿搭参考图时，原图理解只继承光影、妆容与画质；无穿搭时完整恢复原图理解和主垫图原有穿搭。选择网感姿势时只替换原姿态。
- `npm test` 为 `158/158`；UI、六档画布、Electron 壳层、一键蒙脸、结果保存、ChatGPT 模型与附件夹具、Gemini 夹具和网感姿势均通过。
- 源码 UI 与打包应用均验证提示词条件分支、深浅主题、1024/1580 宽度和控制台错误为 0。
- 安装器大小 `128276633` 字节，SHA-256 为 `5F549CB282F610C3C8DC8EB4D2E1A5A4B7F8624B126AB6A9ACFD2632AF172FF7`；Defender 匹配检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.20-prompt-source-priority-cleanup.md`。
- 本轮未提交、未自动安装；0.6.19 手测数据已备份，旧版已卸载，桌面只保留 0.6.20 安装包，等待 Hale 手动安装验证。

## 0.6.19 历史正式安装包

- 删除“Image 2.0 区域锁定工作台”副标题，顶栏只保留“耀创工坊”。
- 将衣物配饰素材面板标题改为“穿搭参考图”，上传按钮仍保留原有动作名称。
- 单张任务空闲主按钮由 Provider 实现描述改为“开始做图”；批量、暂停、重新生成和状态反馈保持不变。
- `npm test` 为 `157/157`；UI、六档画布、Electron 壳层、一键蒙脸、结果保存、ChatGPT 模型与附件、Gemini 和网感姿势均通过。
- 源码 UI 与打包后的应用均确认三处新文案，深浅主题、1024/1580 宽度和控制台错误为 0。
- 安装器大小 `128277007` 字节，SHA-256 为 `6177CEC9650F85080E1C6486BE8380462A7BCC461DDBDD42506E92924162DECE`；Defender 未发现威胁，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.19-workbench-copy-cleanup.md`。
- 本轮未提交、未自动安装；旧版与正式数据已备份清理，桌面只保留 0.6.19 安装包，等待 Hale 手动安装验证。

## 0.6.18 历史正式安装包

- 真实根因：保存提示词微调后项目模式停留在 `custom`，网感姿势变化只让旧草稿失效；一键生成继续沿用该模式，`PromptBuilder` 因而按设计返回等待手填的空白自定义草稿。
- 修复：一键生成显式将模式恢复为 `regional` 并重建包含最新网感姿势的系统提示词；自定义只由金色微调窗口保存产生。
- 删除右栏重复的“生成与导出选项”折叠行及模式切换器；保留主流程生成、标题栏复制、金色微调、发送快照和结果归档。
- `npm test` 为 `156/156`；UI、网感姿势完整状态链、六档画布、Electron 壳层、一键蒙脸、结果保存、ChatGPT 模型与附件、Gemini 均通过。
- 源码 Electron 与打包应用均通过“姿势 4 -> 保存自定义 -> 切换姿势 7 -> 一键重新生成”的真实交互路径，重新生成结果为非空“区域编辑定制版”，控制台错误为 0。
- 安装器大小 `128277128` 字节，SHA-256 为 `D15286CE999A5BB54C9EE4CC2829DA2D7669983473D364BE66CADC98EDE1E8BA`；Defender 新增检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.18-web-pose-regeneration-mode-hotfix.md`。
- 本轮未提交、未自动安装；当前运行的 0.6.17 和正式 AppData 保持原样，等待 Hale 从桌面手动覆盖安装 0.6.18。

## 0.6.17 历史正式安装包

- 新增`网感姿势`：ChatGPT 后台根据原图返回恰好 8 条适配当前画幅与环境的姿势；主按钮可刷新，下方箭头展开金色实色选择列表。
- 选中姿势后旧提示词立即失效，重新生成后才可发送；姿势授权只开放身体、肩颈、手臂、手部和必要衣物褶皱，背景、其他人物、构图、镜头、画幅、环境光和像素尺寸继续受保护。
- `AI 分析`和`网感姿势`在深浅主题均使用金色边框；动效复审确认没有 `transition: all`、`ease-in`、`scale(0)` 或布局属性动画。
- 人脸参考图正式负责人物身份与发型，主参考图唯一决定发型；旧的原图头发锁已从完整提示词链清除。
- `npm test` 为 `155/155`；UI、六档画布、Electron 壳层、首次公告、一键蒙脸、结果保存、ChatGPT 模型与附件、Gemini 和网感姿势专项均通过。
- 源码 Electron 与打包后的 `win-unpacked` 均通过网感姿势列表、选择、草稿失效、重新生成、深浅主题和 1024/1580 宽度验证。
- 安装器大小 `128277743` 字节，SHA-256 为 `71DAA3C129D941F1CC85913AFC9535F9CA1DD993B4B272D320DAB4BF93222E3C`；Defender 匹配检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.17-web-pose-and-hairstyle-priority.md`。
- 本轮未提交、未自动安装；0.6.16 已卸载，正式 AppData、开始菜单和桌面快捷方式均不存在，桌面只保留 0.6.17 最新安装包。

## 0.6.16 历史正式安装包

- 现象：提示词编辑入口层级太弱，使用者难以发现；右栏内嵌编辑器过窄，不适合通读和修改长提示词。
- 根因：编辑能力与导出等次级操作共用低对比折叠标题，同时缺少打开、取消和保存之间的事务边界。
- 修复：新增金色双线与几何角纹入口、“进入微调”按钮和居中大尺寸编辑弹窗；入口仅在已有一键生成提示词时启用。
- 打开时复制当前提示词；取消、关闭、遮罩和 `Escape` 均不写回，只有“保存修改”才更新草稿并标记为自定义。
- 原有生成模式、复制、导出、重新生成、提示词快照以及 ChatGPT/Gemini 自动化保持不变。
- `npm test` 为 `150/150`；UI、六档画布、Electron 壳层、首次公告、一键蒙脸、结果保存、ChatGPT 模型和附件夹具、Gemini 夹具均通过。
- 打包应用已验证深浅主题、生成前禁用、生成后继承、取消回滚、保存写回、穿搭提示词范围、无横向溢出和控制台错误为 0。
- 安装器大小 `128274361` 字节，SHA-256 为 `28FE61D05C67C4CD7EFC4D3C7D81DFA9431E8C0C36C4465FE2893586439CA574`；Defender 新增检出 0，签名状态为 `NotSigned`。
- 维护记录：`docs/0.6.16-prompt-adjustment-workspace.md`。
- 本轮未提交、未自动安装；系统已整理成未安装状态，桌面只保留 0.6.16 最新一键安装包。
- 打包验证生成的临时 AppData 已移到 `D:\Yaochuang-Workshop\TestArtifacts\0.6.16-packaged-prompt-adjustment\test-appdata-20260814-0134`，不会被首次安装继承。

## 0.6.15 最新正式安装包

- 现象：正式做图上传红圈蒙脸图和穿搭参考图时，后台仍额外上传未遮挡原图。
- 根因：统一发送包沿用 0.6.9 的双主图策略，明确把 `mainPath` 和 `circlePath` 同时加入自动化文件数组；衣物参考图面板本身没有重复上传原图。
- 修复：自动化只上传 `01_红圈蒙脸主垫图` 及人脸、衣物和配饰参考图；原图仅作为 `00_仅本地原图备份`，并将一键蒙脸设为发送前硬门禁。
- `npm test` 为 `150/150`；UI、六档画布、Electron 壳层、一键蒙脸、结果保存、ChatGPT 模型与附件夹具和 Gemini 夹具通过。
- 打包程序的无穿搭与有穿搭 manifest 均确认 `rawOriginalInAutomation=false`；截图位于 `D:\Yaochuang-Workshop\TestArtifacts\0.6.15-packaged-attachment-policy\masked-send-ready.png`。
- 安装器大小 `128271832` 字节，SHA-256 为 `CFBFA3B91E6352CA454E81FDC55BBA689A9B755DA5514F285CEECFA4CFA9C783`；Defender 新增检出 0。
- 维护记录：`docs/0.6.15-masked-main-attachment-policy.md`。
- 本轮未提交、未自动安装；系统已整理成未安装状态，桌面只保留 0.6.15 最新一键安装包。

## 0.6.14 最新正式安装包

- 现象：穿搭参考图存在时，原图理解四段内容仍被完整写入提示词，旧穿搭相关描述可能与新参考素材竞争。
- 根因：`PromptBuilder` 的原图理解合并函数无条件拼接四个分析字段，没有读取衣物配饰参考状态。
- 修复：`wardrobeReferences` 非空时只拼入 `lightingMakeupDescription`；清空穿搭参考后恢复完整四段分析。
- 新增真实 `PromptBuilder` 行为回归，并在现有工作台 UI 验证中通过上传、圈选和一键生成检查最终文本。
- `npm test` 为 `149/149`；UI、六档画布、Electron 壳层、一键蒙脸、附件夹具、Gemini 夹具和结果保存验证通过。
- `npm run dist:win` 通过；打包程序使用 D 盘隔离资料通过批量重新生成工作流，版本为 0.6.14，控制台错误为 0。
- Defender 定向扫描新增检出 0；安装器大小 `128271656` 字节，SHA-256 为 `71425E42531BCA6F4F7323FF4F4088E429132B858455BA76B53CA93EF90D3E4D`。
- 维护记录：`docs/0.6.14-wardrobe-analysis-prompt-scope.md`。
- 本轮未提交、未自动安装；系统已整理成未安装状态，桌面只保留 0.6.14 最新一键安装包。

## 已有能力

- 原图导入、原图像素尺寸保持、画布拖动与鼠标位置缩放。
- 红圈区域编辑、红圈外保护、可选一键蒙脸、人脸参考图和衣物配饰参考图。
- ChatGPT 与 Gemini 网页服务商、账号实际可用模型读取和模型选择。
- AI 原图分析回填、提示词草稿编辑、点击做图时冻结发送快照。
- 专属真实 Chrome、持久化登录目录、后台登录检查、查看窗口与有限自动恢复。
- 1/2/3 路并行生成、独立任务状态、失败识别、结果保存与断点续做。
- Windows NSIS 安装和旧版本升级兼容。

## 0.6.2 上一版修复

- 兼容 ChatGPT 新版“质量入口 -> 高级 -> 模型”三级菜单。
- 真实账号已读取 `GPT-5.6 Sol`、`GPT-5.5`、`o3`。
- 指定模型发送前二次确认，不能静默降级。
- 画布 viewport 使用 `{ passive: false, capture: true }` 的 wheel 监听；画布内只缩放图片，左栏不再跟随滚动。
- 正式安装版验证：模型列表可见，画布滚轮后左栏 `scrollTop = 0`，检查登录与查看窗口正常。

## 0.6.3 最新正式版本

- 已在源码中完成以 Apple 内容优先、克制材质、系统字体、即时反馈和空间一致性为原则的工作台优化。
- 顶栏和画布工具改为低噪声图标命令；主画布保持第一视觉焦点；普通面板和长文本使用稳定实色。
- 深色、浅色、跟随系统、栏位收起、设置弹窗、长文本、动态状态和 1024-2560 宽度已通过视觉验证。
- `review-animations` 首审发现的问题已修复，复审结论为 Approve。
- `npm test` 为 `131/131`；本文件“验证基线”中的 UI、画布、壳层、蒙脸、持久化、ChatGPT 模型、Gemini 和 Chrome 脚本均已重新通过。
- 修复启动时快速切换 ChatGPT/Gemini 后，旧 Provider 的延迟登录检查覆盖新模型列表的竞态。
- 真实账号已读取 ChatGPT 三个模型和 Gemini 四个模型；已安装版分别以两个 Provider 复测通过，最终恢复为 Gemini。
- 已完成 NSIS 打包、Defender 扫描、0.6.2 -> 0.6.3 升级安装和用户数据指纹核对。
- 维护记录：`docs/0.6.3-apple-principled-workbench-ui.md`。
- 最终截图：`D:\Yaochuang-Workshop\TestArtifacts\0.6.3-apple-ui-final`。
- 正式安装包和已安装程序均为 `0.6.3`；工作树仍未提交，等待 Hale 使用验收。

## 0.6.4 自动化修复

- 修复 Gemini 当前 `send-button-container` / “发送”按钮无法点击的问题，并保留发送接受确认和一次安全重试。
- Gemini 原图分析只在四个核心字段完整后回填；兼容 `response-selection-panel` 双回复和当前 `message-content` 正文，排除合并祖先、用户回显与空页脚。
- 修复 Gemini 待恢复 URL 过早保存；改读页面内真实 `/app/<会话ID>`，异常退出时再次刷新。
- Gemini 附件必须有真实预览并稳定六轮；仅 file-input 事件不能算上传成功，多附件改为逐张上传、逐张确认。
- Gemini 新页面不再依赖已消失的“制作图片”菜单，按当前官方流程使用附件 + 直接生成提示；Gemini 明确表示未收到附件时仍只在新对话有界重试一次。
- 修复 ChatGPT 已切换到 `GPT-5.5` 却误报不可用：兼容输入区 `5.5` 简写、父级模型值和 CDP 可信菜单点击。
- 指定 ChatGPT 模型仍必须在上传前确认，不允许静默切换或降级。
- 新增 Gemini 地区限制识别；当前真实网络返回 `regionBlocked=true`，程序会快速提示，不再把落地页营销内容当模型回复。
- 批量调度器将 Gemini 地区限制视为全局失败，首次出现即停止并保留缺失任务，不再连续重试。
- 真实 `GPT-5.5` 一张图流程已通过：`uploaded=true`、`sent=true`、完成 `1/1`，结果按原图 `1115x1159` 保存。
- 真实 Gemini 原图分析已完成附件缺失恢复、新上传、发送、完整五字段回填和对话清理；字段长度 `56 / 38 / 41 / 85 / 60`，待恢复文件已清除。
- 真实 Gemini 做图已补验通过：`3.6 Flash` 在直接提示流程中返回结果；断点恢复保存得到 `1024x1024` / `560320` 字节 PNG，未重发提示词；修复后新对话端到端再跑以一次上传、可信发送和 `blob:` 落盘自动保存 `1024x1024` / `617967` 字节 PNG。
- 发送确认改为顶层消息证据并要求 `/app` 新对话持久化 URL，`busy=true` 不再单独算成功；“只是语言模型”类拒绝会快速失败。
- Gemini 结果保存新增已渲染 `blob:` 原像素读取，并允许用户正常生成 `icon/logo` 内容。
- 维护记录：`docs/0.6.3-web-provider-automation-reliability.md`。
- 上述热修复已升版并打包为 `0.6.4`；维护记录：`docs/0.6.4-web-provider-automation-release.md`。
- 安装包后续 Gemini 对齐热修复记录：`docs/0.6.4-gemini-chatgpt-flow-parity-hotfix.md`。
- `app.asar` 共 396 项，没有测试目录、临时目录、设置、自动保存或 Chrome 登录资料；解包程序产品版本为 `0.6.4.0`。
- Microsoft Defender 自定义扫描针对安装包的检测数为 `0`；安装器未配置商业代码签名证书。
- 该版本已经由 `0.6.5` 取代，旧安装包已从发布目录和桌面移除。

## 0.6.5 上一版正式安装包

- 将 `0.6.4` 安装包之后的 Gemini 发送接受、完整回复筛选、会话持久化确认和 `blob:` 结果保存修复正式纳入安装包。
- 真实 Gemini 分析和做图均已通过；端到端结果为 `1024x1024` / `617967` 字节 PNG，断点恢复结果为 `1024x1024` / `560320` 字节 PNG。
- `npm test` 为 `137/137`；Gemini、ChatGPT 模型、Electron 壳层、画布、蒙脸、结果保存、UI 和 Chrome 验证全部通过。
- 解包后的 `0.6.5` 应用分别用真实 ChatGPT 和 Gemini 登录资料复测，模型读取、画布滚轮隔离、登录检查、查看窗口和渲染器错误均通过。
- `app.asar` 共 396 项，内置版本为 `0.6.5`，没有测试、临时或用户数据；解包程序产品版本为 `0.6.5.0`。
- Microsoft Defender 自定义扫描检出 `0`；安装器未配置商业代码签名证书。
- 维护记录：`docs/0.6.5-gemini-flow-release.md`。
- 本轮不安装；系统已安装程序实测仍为 `0.6.4.0`，用户数据和登录资料保持不变。

## 0.6.6 最新正式安装包

- 修复 Gemini 点击上传菜单后 Windows 原生“打开”窗口抢先弹出，自动化因此无法继续注入文件、写入提示词、发送和出图的问题。
- 上传前先通过 CDP 拦截文件选择动作，再执行 `DOM.setFileInputFiles`；不支持拦截时跳过危险点击并转入 CDP 拖放后备。
- 兼容当前 `[data-test-id*="uploaded-img"]` 附件结构，附件证据限定在当前编辑器，并移除普通页面图片造成的宽泛误判。
- 分析、生成、重试和清理使用 `about:blank -> Gemini /app` 新会话装载，降低旧附件与旧会话状态污染。
- 页面夹具现在真实执行 `input.click()`，旧代码可稳定复现卡死，修复后上传、发送、双回复和三路并行通过。
- `npm test` 为 `138/138`；Gemini、ChatGPT 模型、Electron 壳层、六档画布、蒙脸、结果保存、UI 和 Chrome 验证全部通过。
- 真实 ChatGPT 账号读取四个模型并回填；当前真实 Gemini 网络被地区限制落地页阻断，程序正确识别 `regionBlocked=true`，本轮未声称完成真实 Gemini 上传或出图。
- 解包 `0.6.6` 使用真实 ChatGPT 登录资料通过模型读取、画布滚轮隔离、登录检查、查看窗口和渲染器错误验证。
- `app.asar` 共 396 项，内置版本为 `0.6.6`，没有项目测试目录、临时目录或用户数据；解包程序产品版本为 `0.6.6.0`。
- Microsoft Defender 定向扫描新增检出 `0`；安装器未配置商业代码签名证书。
- 维护记录：`docs/0.6.6-gemini-file-chooser-hotfix.md`。
- 本轮不安装；系统已安装程序仍为 `0.6.5.0`，等待 Hale 亲手安装验收。

## 0.6.7 上一版正式安装包

- 新增 `CURRENT_NOTICE_VERSION = 1` 和 `acknowledgedNoticeVersion` 本地公告版本机制；旧设置缺失或版本较低时显示，确认当前版本后后续启动不再显示。
- 设置判定完成前使用固定启动层；公告显示时主工作台保持原布局但处于 `inert`，不会先闪出可操作界面。
- 公告只有“我已确认，进入耀创工坊”一个操作；Escape、遮罩和主界面快捷键均不能绕过。
- 只有 `settings.json` 写入成功后才关闭公告；写入失败保留弹窗并允许重试，不改变其他设置。
- 启动登录检查和本地视觉模型预热延后到公告确认后执行一次，避免外部流程抢在公告前出现。
- UI 使用三段纵向检查、低饱和 ChatGPT 推荐提示、现有 Lucide 图标和主题 token；深色、浅色、`1024 x 600` 与 reduced motion 已验证。
- `npm test` 为 `141/141`；公告首次/二次启动、旧版本、写入失败、壳层、画布、蒙脸、批量再生成、结果持久化和 11 张 UI 状态验证通过。
- 视觉 QA：`design-qa.md`，最终结果 `passed`；维护记录：`docs/0.6.7-versioned-startup-notice.md`。
- `npm run dist:win` 成功；安装包大小 `128270401` 字节，SHA-256 为 `1C0A2D849B1F3E58A29A1B47374A2766145D298F0CDA46391022D88CB40F9FAC`。
- `app.asar` 共 `397` 项，内置版本 `0.6.7`，没有测试、临时或用户数据；解包程序产品版本为 `0.6.7.0`。
- Microsoft Defender 定向扫描检出 `0`；安装器未配置商业代码签名证书。
- 该发布轮次未安装、未提交；当时系统已安装程序仍为 `0.6.6.0`，等待 Hale 亲手安装验收。

## 0.6.8 上一版正式安装包

- 修复 GPT-5.5 和 GPT-5.6 模型已选中，但思考强度滑杆可能仍停留在“标准”而继续做图的问题。
- 模型确认与强度确认拆为两个独立门禁；显式模型和“跟随当前模型”均在附件上传前进入同一高档确认逻辑。
- 新增精确 `low / medium / high / extreme / unknown` 分类，不会把“极高”或“高级”菜单文字误判为“高”。
- 通过 CDP 可信鼠标和键盘事件操作滑杆，逐步读取真实状态；关闭菜单后再次确认，无法确认时在上传提示词和图片前停止。
- GPT-5.5 与 GPT-5.6 Sol/Terra/Luna 启用该策略；Gemini、o3 和其他模型保持原流程。
- `npm test` 为 `142/142`；GPT 页面夹具从标准到高、20 轮菜单循环、真实 GPT-5.5/5.6 高档、真实模型读取、公告、壳层、画布、蒙脸、批量、结果保存、Gemini、UI 和 Chrome 验证全部通过。
- 真实 Gemini 当前可进入编辑器但处于未登录状态，程序正确保留人工登录边界；本轮未声称完成真实 Gemini 上传或出图。
- `npm run dist:win` 成功；安装包大小 `128271046` 字节，SHA-256 为 `E997FB1E692209A26F935D467BCA4D0DA4915348569D1FCB38746A46053FD6E5`。
- `app.asar` 共 `398` 项，内置版本 `0.6.8`，包含高档门禁模块且没有测试、临时目录或用户数据；解包程序产品版本为 `0.6.8.0`。
- 解包程序以隔离 `userData` 普通启动成功；Playwright 对打包 EXE 的调试握手失败，源码隔离 Electron 首次/二次启动验证仍完整通过。
- Microsoft Defender 定向扫描未发现威胁；安装器未配置商业代码签名证书。
- 真实设置哈希保持不变；完整应用模型 UI 验证触发自动保存轮换，新旧内容仅 `softwareVersion` 从 `0.6.7` 更新为 `0.6.8`，其他项目字段一致。
- 维护记录：`docs/0.6.8-chatgpt-high-reasoning-gate.md`。
- 本轮未安装、未提交；最终现场复核的系统当前已安装程序为 `0.6.7.0`，等待 Hale 亲手安装 `0.6.8` 验收。

## 0.6.9 上一版正式安装包

- 正式做图附件顺序改为无标记原图、红圈定位图、人脸参考图和衣物配饰参考图；导出 manifest 与操作说明保持一致。
- 附件改为逐张上传并等待独立可见预览稳定；文件控件自身不再算成功证据，外围隐藏文件控件不能被选中。
- 当前 composer 没有可用文件控件时立即切换经真实页面验证的 CDP 拖放；慢上传仍有进度时继续等待，不重复注入。
- 菜单关闭与发送使用可信 CDP 输入；提示词写入后再次核对附件数量、上传进度和发送按钮。
- 真实 ChatGPT 三附件发送前验证通过：`attachmentCount=3`、`sendEnabled=true`，测试消息未发送。
- 真实 ChatGPT AI 分析完成上传、发送、回复读取和四字段回填，约 60 秒；字段长度 `84 / 80 / 75 / 179`，按钮恢复可用，渲染器错误为 0。
- `npm test` 为 `143/143`；UI、六档画布、Electron 外壳、首次公告、蒙脸、结果保存、ChatGPT 模型、Gemini 和 Chrome 恢复验证全部通过。
- `npm run dist:win` 成功；安装包大小 `128271575` 字节，SHA-256 为 `6C00E63BEB9F39EC1FF9CC0F5853BAA83A0A77791F122D5B221154FC77D9736B`。
- `app.asar` 共 `398` 项，内置版本 `0.6.9`，没有测试、临时目录、设置、自动保存或 Chrome 登录资料；解包程序产品版本为 `0.6.9.0`。
- 解包 0.6.9 使用隔离 D 盘数据在 1024 至 2560 宽度启动通过；Microsoft Defender 定向扫描检出 0。
- 安装器没有商业代码签名证书；本轮未安装、未提交，当前系统已安装程序仍为 `0.6.8.0`，等待 Hale 手动安装验收。
- 维护记录：`docs/0.6.9-chatgpt-attachment-and-analysis-hotfix.md`。

## 0.6.10 上一版正式安装包

- 修复批次级状态错误继承初始化 `第 1/20 张` 前缀；任务内进度仍保留真实任务编号。
- 最终汇总先显示首个真实失败任务及原因，再显示完成数量和压缩后的缺失范围，例如 `1-20`。
- 账号失效、验证码、明确额度耗尽、指定模型不可用、`high/高` 无法确认和地区限制继续安全停批；不会静默切换模型或降低思考强度。
- 单个附件、页面状态、结果识别或保存失败只留下对应任务供断点续做，其他健康通道继续执行原有有限重试和任务分配。
- 修复多个并行通道同时限流时的降级竞态；只有真正以单路开始后仍明确限流才停止批次。
- 断点中已完成任务不会重复生成或覆盖；结果已保存但断点写入失败时为保护数据完整性停止批次。
- 新增任务编号、通道、失败阶段、分类、重试决定与停批原因的脱敏诊断事件。
- `npm test` 为 `148/148`；UI、六档画布、Electron 外壳、公告、蒙脸、结果持久化、ChatGPT 模型/附件、Gemini 和 Chrome 恢复全部通过。
- 0.6.10 解包程序使用 D 盘隔离资料启动通过，批量再生成、版本读取、1024 至 2560 宽度和控制台均正常。
- `npm run dist:win` 成功；安装包大小 `128272691` 字节，SHA-256 为 `756813DA4352503A75155A0A369D7EF2605D9C099875B7E08B798526CC2609DA`。
- `app.asar` 共 `398` 项，内置版本 `0.6.10`，没有测试、临时目录或用户数据；解包程序产品版本为 `0.6.10.0`。
- Microsoft Defender 定向扫描新增检测 0；安装器未配置商业代码签名证书。
- 本轮未运行真实登录账号的 20 张付费任务，也未抢占正在运行的用户 Chrome；自动化夹具、隔离 Electron 和历史真实 2 路成功日志的边界已在维护记录中明确说明。
- 本轮未安装、未提交；系统当前已安装程序保持 `0.6.9.0`，等待 Hale 手动安装验收。
- 维护记录：`docs/0.6.10-chatgpt-batch-diagnostics-hotfix.md`。

## 0.6.11 上一版正式安装包

- Hale 使用 0.6.10 执行真实 20 张、3 路 GPT-5.5 批次，任务 1-6 成功保存；任务 7 在附件上传前因无法重新确认“高”而安全停止。
- 根因是思考强度控制虽然读取了滑块真实 `min/max/step`，但旧实现最多只遍历 12 个位置，无法覆盖 ChatGPT 任务间重建后出现的 `0-100/step=1` 细粒度滑块。
- 对细粒度滑块先使用可信鼠标事件采样中高区间，并以页面明确标签逐次确认；后备键盘遍历扩大到最多 120 个位置，覆盖常见连续滑块。
- 关闭菜单后再次确认最终仍为“高”；不会误用“极高”、未知强度、静默模型切换或强度降级。
- 真实断点仍为版本 4、总数 20、已完成 `1-6`；安装后再次点击应只续做任务 `7-20`。
- `npm test` 为 `148/148`；`0-100` 细粒度滑块、原四档模型菜单、20 轮循环、附件、结果保存、Electron、Gemini、六档画布、蒙脸、11 张 UI 状态和启动公告均通过。
- 本轮没有抢占真实专属 Chrome，也没有自动执行任务 7-20；真实续做结果等待 Hale 手动安装后验收。
- `npm run dist:win` 成功；安装包大小 `128272568` 字节，SHA-256 为 `780EE5886FD1C404F168A8E617CFA8333EF0AD431147D350E24536A1681F478F`。
- 安装器文件版本和产品版本均为 `0.6.11`；解包程序文件版本为 `0.6.11`、产品版本为 `0.6.11.0`。
- `app.asar` 共 `398` 项，内置版本 `0.6.11`，没有测试、临时目录、用户设置、断点或 Chrome 登录资料。
- 解包程序使用 D 盘隔离资料启动通过，批量重新生成入口可用，控制台错误 0；Microsoft Defender 定向扫描新增检出 0。
- 桌面只保留最新 `D:\Hale_Files\Desktop\耀创工坊 0.6.11 一键安装包.exe`；0.6.10 桌面副本、源安装包和 blockmap 已移动到 `D:\Yaochuang-Workshop\ReleaseArchive\0.6.10`。
- 维护记录：`docs/0.6.11-chatgpt-fine-grained-reasoning-hotfix.md`。

## 0.6.12 上一版正式安装包

- Hale 在 0.6.11 中继续真实 GPT-5.5 20 张、3 路批次时，任务 7-9 均在附件上传前再次因无法确认“高”停止；断点仍准确保留任务 1-6。
- 真实控件并非 0.6.11 判断的连续滑块，而是 `0-4/step=1` 五档滑块；0.6.11 根因判断已在原维护文档中标注更正。
- 真实根因是三级菜单只退出两层、退场滑块仍有尺寸但不可交互，以及 `role=slider` 只是移动拇指而非完整轨道。
- 菜单关闭覆盖四层，候选控件必须可接收鼠标事件；轨道坐标从合理父层获取，入口展开使用有限状态探测。
- 真实登录 GPT-5.5 已主动预设为“极高”，正式控制函数一次切到“高”，关闭菜单后复核仍为高；未上传、未填写提示词、未发送、未生成图片。
- 真实断点验证前后 SHA-256 均为 `7038C19178CA3EC67B77C93625BFFE5DF9823E7BACBDCD1D8405D1F899B7FFBC`，用户续做现场未变。
- `npm test` 为 `148/148`；五档父轨道、三级菜单退场、连续滑块、20 轮循环、附件、Gemini、结果保存、Electron、画布、蒙脸、UI 和启动公告验证通过。
- 安装包大小 `128271951` 字节，SHA-256 为 `FDEC6E2B4DA067F40372AB5DCA505DD483A442172BDFBFB28A8BA391E53A607F`。
- 安装器文件版本和产品版本均为 `0.6.12`；解包程序文件版本为 `0.6.12`、产品版本为 `0.6.12.0`。
- `app.asar` 共 `398` 项，内置版本 `0.6.12`，没有顶层项目测试、临时目录、设置、断点或 Chrome 登录资料。
- 解包程序以 D 盘隔离资料通过批量重新生成入口检查，控制台错误 0；Defender 定向扫描未发现威胁。
- 本轮不安装、不提交；系统已安装程序仍为 `0.6.11.0`，等待 Hale 手动安装并从任务 7 续做。
- 维护记录：`docs/0.6.12-chatgpt-reasoning-menu-lifecycle-hotfix.md`。

## 0.6.13 上一版正式安装包

- Hale 使用 0.6.12 继续真实 20 张、3 路 GPT-5.5 批次时，任务 7、8 在上传前报“没有找到思考强度滑块”，同批任务 9 成功保存。
- 根因收敛为并行标签页重建输入区时首次强度入口点击偶发没有展开菜单；模型、账号和滑块结构没有整体失效。
- 首次探测不到滑块时，只重新读取入口坐标并有限重开一次；第二次仍失败则继续在上传前安全停止。
- 新回归夹具稳定复现“第一次点击被吞掉”；修复后第二次打开成功并从“极高”切到“高”。
- 真实 GPT-5.5 无发送验证为 `before=extreme`、`after=high`、`steps=1`。
- 真实断点验证前后 SHA-256 均为 `7DABAD26F91EB0D56E6B71F0668D75143B18F191E4031C2D58E8FF0E5D42E2F8`，已完成任务仍为 `1-6、9`。
- `npm test` 为 `148/148`；ChatGPT 模型与附件、结果保存、Gemini、Electron、画布、蒙脸、UI 和启动公告验证通过。
- 本轮没有重构批量系统，没有改变错误分类、并行数、附件、提示词、发送或保存流程。
- 安装包大小 `128273174` 字节，SHA-256 为 `AEB331EC2335B96B8E5C9926E80475BB94D89B7F44DEF5B48446BED4C87F8844`；安装器与解包程序版本均为 0.6.13。
- `app.asar` 共 398 项且不含顶层用户数据；解包批量入口和 Defender 定向扫描通过。
- 本轮不安装、不提交；等待 Hale 手动安装并继续缺失任务 `7-8、10-20`。
- 维护记录：`docs/0.6.13-chatgpt-reasoning-menu-open-retry.md`。

## 验证基线

### 1.1.2 正式修复：ChatGPT 保护暂停与分析链路稳定性（2026-08-22）

- 该轮版本为 `1.1.2`；当时已重新打包并同版本覆盖安装，未提交代码，正式 AppData 已在安装前完整备份且安装过程保持不变。
- 正式脱敏日志确认保护触发前约 92 秒内依次提交 AI 分析、网感姿势和正式做图；另有一次页面恢复因无总超时持续约 39 分 21 秒。后一现象不是生成图片等待超时。
- 新增持久 `PROTECTION_PAUSED` 与单路、二路恢复阶段；保护不是失败或待人工确认。冷却期零点击，到期只检查一次，仍受保护时等待人工“检查恢复”且不滚动五分钟。
- 已发送任务继续只读等待和保存；未发送任务保留断点。恢复后先单路成功，再二路，连续健康后恢复用户选择的三路。
- AI 分析、网感姿势和正式做图均在页面操作前执行保护门禁，共享页面任务槽、发送间隔和连续提交休息预算。
- 同页相同模型/思考强度直接复用；CDP 菜单关闭限制 `1.5s`，完整输入框后台恢复限制 `65s`。
- `npm test` 为 `194/194`；本任务要求的 typecheck、ChatGPT 上传/模型、Electron、结果保存、网感姿势、画布、蒙脸和 Gemini 回归均通过。
- Playwright Interactive 使用隔离 D 盘资料验证保护状态和人工恢复入口；截图位于 `D:\Yaochuang-Workshop\TestArtifacts\playwright-protection-1.1.2\protection-paused-1506x892.png`。
- 未使用真实账号制造保护，未执行真实 10 张付费批次；“平台不再限流”和真实优化后耗时都不能在本轮声明。维护详情见 `docs/unreleased-chatgpt-automation-speed-and-protection.md` 与 `docs/unreleased-ai-analysis-web-pose-send-hotfix.md`。

- `npm run typecheck`：通过。
- `npm test`：`149/149` 通过。
- `npm run verify:startup-notice`：首次显示、确认持久化、第二次隐藏、旧版本重现、写入失败保留、交互阻断及深浅主题通过。
- `npm run verify:chatgpt-models`：GPT-5.6 Sol 和 GPT-5.5 从标准到高、五档拇指/父轨道、三级菜单逐层退出、连续滑块和 20 轮循环通过。
- `npm run verify:chatgpt-reasoning-live`：真实 GPT-5.5 主动预设为“极高”后确认 `before=extreme`、`after=high`、`steps=1`；未上传图片、填写提示词或发送。
- `npm run verify:chatgpt-upload`：外围文件控件隔离、真实附件预览计数、上传进度门禁和可信发送通过。
- `npm run verify:chatgpt-upload-live`：真实登录页面按正式顺序得到 3 个独立附件预览，发送按钮可用且未发送测试消息。
- `npm run verify:chatgpt-analysis-live`：真实分析发送与四字段回填完整通过，按钮恢复可用。
- `npm run verify:chatgpt-live`：历史真实登录页面模型读取与 UI 回填通过。
- `npm run verify:gemini-live`：当前真实页面可进入编辑器但处于未登录状态，识别为人工登录边界；本轮未执行真实上传或出图。`0.6.5` 的真实分析、做图和 `blob:` 保存结果仅作为历史回归证据保留。
- `npm run verify:adaptive-canvas`：多分辨率、画布覆盖层和画布外滚动通过。
- `npm run verify:chrome`：管道主通道、固定端口后备、窗口恢复及 20 轮循环通过。
- `npm run verify:gemini`、`npm run verify:electron-shell` 通过。
- 解包 `0.6.6` 的 `scripts\verify-installed-release.mjs` 历史上已使用真实 ChatGPT 登录资料验证模型列表、画布滚轮隔离、登录检查、查看窗口及渲染错误。
- `0.6.12` 的 `npm run dist:win`、解包隔离启动、批量再生成、`app.asar` 版本与内容检查、Microsoft Defender 定向扫描通过；本轮没有安装，也未声称完成真实任务 7-20 的付费生成。

## 版本演进记录

详细版本记录全部保存在 `docs`：

- `0.1.4` 至 `0.1.10`：商业发布、登录恢复、自动化和窗口恢复基础。
- `0.2.1` 至 `0.2.4`：Chrome pipe、UI、批量再生成和稳定性。
- `0.3.0` 至 `0.3.1`：提示词快照、并行和模型菜单。
- `0.4.0` 至 `0.4.3`：后期处理试验、画布适配、一键蒙脸和图片方向。
- `0.5.0` 至 `0.5.1`：移除不可用后期处理并恢复直接保存，强化 Chrome 恢复。
- `0.6.0`：Gemini 网页服务商与隔离适配器。
- `0.6.1`：玻璃工作台、Gemini 上传和模型菜单热修复。
- `0.6.2`：ChatGPT 三级模型菜单与画布滚轮热修复。
- `0.6.3`：Apple 原则工作台 UI 深度优化、Provider 启动切换竞态修复和正式安装包发布。
- `0.6.4`：ChatGPT/Gemini 上传、发送、模型确认、完整回复回填、地区限制熔断和断点可靠性修复。
- `0.6.5`：正式纳入 Gemini 直接出图、会话持久化确认、`blob:` 结果保存和 ChatGPT 模型简写兼容，并生成唯一桌面一键安装包。
- `0.6.6`：修复 Gemini 原生文件选择框卡死，补齐当前附件组件识别、新会话隔离和真实 `input.click()` 回归，并生成唯一桌面一键安装包。
- `0.6.7`：新增可版本化首次启动环境检查公告、保存失败保护、主界面交互阻断和深浅主题响应式验证，并生成唯一桌面一键安装包供 Hale 手动安装验收。
- `0.6.8`：新增 GPT-5.5 与全部 GPT-5.6 分支的发送前“高”思考强度门禁、标准档到高档真实操作回归和唯一桌面一键安装包。
- `0.6.9`：修复 ChatGPT 正式做图原图遗漏、附件控件误判、上传假成功和 AI 分析卡住，新增真实三附件与真实分析回填回归，并生成桌面一键安装包。
- `0.6.10`：修复 ChatGPT 批次状态误报、首错丢失、局部任务错误停批和并行限流降级竞态，强化断点续做与脱敏诊断，并生成桌面一键安装包。
- `0.6.11`：扩展细粒度思考强度滑块的有界遍历；后续真实复测确认该根因判断不完整。
- `0.6.12`：修复 ChatGPT 三级菜单生命周期、退场滑块误认和拇指/父轨道分离，完成真实 GPT-5.5“极高到高”无发送验证并生成桌面一键安装包。
- `0.6.13`：修复并行标签页首次强度入口点击偶发未生效，采用一次重新取坐标后的有限重开并生成桌面一键安装包。
- `0.6.14`：检测到衣物配饰参考图时，一键生成提示词只继承原图理解中的光影、妆容与画质；完成源码、隔离回归、正式安装包和首次安装现场清理。
- `0.6.15`：正式做图只上传红圈蒙脸主垫图及参考素材，未遮挡原图仅本地保存；新增发送前蒙脸门禁并生成唯一桌面一键安装包。
- `0.6.16` 至 `0.6.21`：增加提示词金色微调、网感姿势、发型与穿搭优先级，并完成文案、提示词分支和状态一致性修复。
- `0.6.22`：一键蒙脸改为可选项；只画红圈也可使用红圈主垫图做图，未标注原图继续仅本地备份。
- `0.6.23` 至 `0.6.25`：移除 ChatGPT 私有对话读取和不确定发送补点，增加限流熔断、三路提交错峰、非 ASAR Windows 启动兼容和统一应用图标。
- `1.1.1`：重做完整图标链，统一纯白大圆角底板、放大吉祥物和贴身金色轮廓。
- `1.1.2`：模型与思考强度改为页面级可复用配置，新增三种 GPT-5.5 模式、100 张任务、最近 10 项自适应节奏、限流持久冷却、v5 断点和运行监控。
- `1.2.3`：修复过期访问保护状态阻断 AI 分析与自动化，并清理旧分析来源造成的无效路由。

## 后续维护规则

1. 每次开始先读取本文件、`git status`、`package.json` 和本次涉及的版本文档。
2. 先复现和定位根因，再小步修改；不得用无限等待、隐藏错误或整体回退掩盖问题。
3. 不得破坏用户项目、结果、设置、提示词历史、专属 Chrome 登录资料和数据兼容。
4. Google 登录、验证码、人机验证和账号安全步骤始终由用户手动操作。
5. 每次发布必须更新版本文档，记录现象、根因、解决方式、验证结果和经验教训。
6. 正式安装包必须经过源码测试、真实网页测试、打包、升级安装和已安装程序复测。
7. 不要承诺绝对不会出错；关键流程必须保留超时、日志、有限重试、熔断和可读恢复入口。

## 新任务启动状态

新维护任务首次打开时只确认已读取本基线并等待 Hale 的下一条需求，不主动安装、删除、提交或修改代码。
