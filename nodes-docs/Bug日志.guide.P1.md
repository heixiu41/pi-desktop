# Bug日志

> 本板块记录本项目（Pi Desktop + 节点系统）开发中遇到并修复的真实 Bug，供排查复用时检索。按"现象 → 根因 → 修复 → 教训"四段式记录。

## Bug 1：Windows 弹"无法调用此类程序(gguf)" — 批处理文件编码错误
- **现象**：视觉服务自动拉起时，Windows 弹出"Windows 无法调用此类程序（gguf）"。
- **根因**：`start-qwen-vl.bat` 被 AI 工具写成 **UTF-8 编码 + LF 换行**。Windows 批处理要求 **ANSI/OEM（中文系统 GBK）+ CRLF 换行**。cmd 执行 UTF-8/LF 的 bat 时每一行都解析错乱，把乱码碎片（其中含 `.gguf` 模型文件路径）当成"程序"执行 → Windows 尝试运行 .gguf → 弹错。
- **修复**：用 Node 脚本生成 bat，强制 **CRLF 换行 + 纯 ASCII 内容（无中文注释）+ 正确反斜杠**。`cmd /c start-qwen-vl.bat` 验证正常启动。
- **教训**：写 .bat 必须 CRLF + ANSI/ASCII；避免在 bat 里写中文注释（除非 chcp 65001 且带 BOM）。用 write 工具写 bat 时注意换行符。

## Bug 2：UI 历史聊天记录打不开 / 消息不渲染 — app.js 选择器忘写 # 前缀
- **现象**：侧边栏历史记录点不了、切不了会话、聊天消息空白，无报错（但 init 没执行）。
- **根因**：`$` 是 `document.querySelector`（需要 CSS 选择器）。代码写 `$("attachBtn")` 少了 `#`（应为 `$("#attachBtn")`）→ 返回 null → `.addEventListener` 抛 TypeError → 脚本在第 1540 行中断 → 文件末尾的 `init()` 从未执行 → 所有事件处理器未注册。
- **修复**：给四个 `$("attachXxx")` 补 `#`。
- **教训**：项目里 `$` 用 `#` 前缀（原代码 `$("#msgList")`）；新写代码要核对现有约定。此类"启动期崩溃"症状是"某个功能全失效"而不是直接报错。

## Bug 3：会话加载失败（model 显示"未配置"）— main.js import 丢失
- **现象**：应用重启后"会话加载失败"，`getState()` 显示 `model: "未配置"`、无 sessionFile。
- **根因**：用 edit 工具一次性改 main.js 多处（import + 状态 + 工具注册），其中一处 oldText 没匹配导致**整个编辑被拒**；随后单独编辑补上了"状态变量"和"工具注册"，但 **import 那处被漏掉** → 用到未导入的 `createVisionTool` → ReferenceError → createAgentSession 抛错 → 会话创建失败。
- **修复**：补 `import { createVisionTool } from "./nodes/vision-tool.js";`。
- **教训**：批量编辑被拒绝后要**完整核对所有改动点是否都落地**（grep 检查 import/引用）。会话创建失败的排查点：`createAgentSession` 抛异常。

## Bug 4：vision_analyze 工具对 AI 不可用 — createAgentSession 的 tools 是硬白名单
- **现象**：AI（DeepSeek）回复"vision_analyze 工具并没有真正提供给我"，即使工具已注册。
- **根因**：`createAgentSession({ tools: [...] })` 的 `tools` 参数被映射为 **allowedToolNames（硬白名单）**；SDK 的 `_refreshToolRegistry` 按白名单过滤所有 customTools。vision_analyze 不在 `["read","bash","edit","write","download"]` 里 → 被滤掉。顺带：节点工具、知识库工具也一直被过滤，从未真正暴露给聊天 AI。
- **修复**：把全部自定义工具名（view_node_library、create_node、list_blueprints、run_blueprint、view_blueprint_result、search_knowledge、import_knowledge、vision_analyze）加进 `tools` 数组。
- **教训**：SDK 的 `tools` 不是"默认工具"而是"允许列表"，自定义工具必须显式列入。

## Bug 5：发图提示"视觉模型暂不可用" — CSP 拦截渲染进程访问本地服务
- **现象**：聊天发图后视觉描述失败（Node 环境测试正常，但浏览器渲染进程 fetch 失败）。
- **根因**：`index.html` 的 `Content-Security-Policy: default-src 'self'` 导致渲染进程（file:// 页面）fetch `http://127.0.0.1:8081` 被 CSP 拦截（不是 CORS 问题，llama-server 已开 `--cors-origins *`）。
- **修复**：CSP 增加 `connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`。
- **教训**：Electron file:// 页面访问本地服务受 CSP 限制；Node 进程无 CSP → "Node 能连、浏览器不能连"时先查 CSP。

## Bug 6：llama.cpp CUDA 13.3 在 Turing 上崩溃 — 换用 CUDA 12.4
- **现象**：RTX 2080 Ti（Turing, sm_75）跑 Qwen3-VL，连续请求后出现 `CUDA error: illegal memory access`，服务崩溃。
- **根因**：CUDA 13.x 对 Turing(sm_75) 支持不稳（老架构被逐步弃用）。
- **修复**：改用 llama.cpp 官方 **CUDA 12.4** 预编译版（bin124），稳定。
- **教训**：老 GPU（Turing/Pascal）优先用 CUDA 12.x；llama.cpp 预编译有 cu12.4 / cu13.3 分版。

## Bug 7：画布输出连线锚点错位 — 同名输入/输出端口
- **现象**：fact_deduper / source_scorer 的输出连线被画到节点左侧输入口位置。
- **根因**：画布 `sockPos(nodeId, port)` 用 `.port[data-port=X] .sock` 匹配，不区分输入/输出；当输入输出端口同名（如 `facts`）时，querySelector 命中先渲染的输入口 → 输出连线锚定错位。
- **修复**：`sockPos` 增加 `kind` 参数（outputs/inputs），选择器分别用 `.port.out[data-port]` 与 `.port:not(.out)[data-port]`（renderer/canvas.js）。
- **教训**：自定义节点输入/输出端口**禁止同名**（见《节点创建文字规范》）；引擎渲染 bug 也已在源码层修复。
