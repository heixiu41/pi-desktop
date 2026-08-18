# Pi Desktop

把 Pi 编码代理做成 Windows 桌面应用：基于 **Electron + Pi SDK**，含聊天、受管下载、历史会话、知识库 RAG、ComfyUI 风格多智能体节点画布。

> 详细使用手册见 `nodes-docs/Pi桌面应用使用指南.guide.P0.md`（已同步到 `~/.pi/nodes-docs/`，AI 会读取）。

## 🚀 启动
- 双击 `启动Pi桌面应用.bat` 或 `重启Pi桌面应用.bat`（后者先关旧再启新，仅处理本应用进程）
- 或 `npm start`

## ✨ 启动动画（加载窗口平滑放大）
启动时显示**加载窗口**（`renderer/splash.html`，420×300 无边框透明窗口）：
- π Logo 呼吸光晕 + 双旋转光环 + 流动加载条，实时显示初始化进度（检测环境 → 模型 → 节点 → 知识库 → 蓝图 → 会话 → 就绪 ✓）
- 初始化完成后播放**平滑放大**：加载窗口一次性就位到主窗口尺寸，内容用 GPU transform 从屏幕中心平滑扩大（560ms easeOutCubic，无逐帧窗口操作、无撕裂）
- 放大完成 → 主窗口就位 → 加载窗口淡出，主界面浮现

## ⚙️ API 配置界面（侧边栏「API 配置」）
侧边栏新增 **API 配置** 页面，功能完整：
- **连接状态总览**：API Key 状态（掩码显示）、Provider、默认模型、环境变量、可用模型数
- **API Key 管理**：选择 Provider、输入/显示切换、保存（写 `~/.pi/agent/auth.json` 并立即重建模型运行时）、**测试连接**（实测 /v1/models，显示延迟与模型数）、**从环境变量填入**
- **默认模型**：下拉应用 + 模型卡片一键点击应用（写 settings.json + 切换当前会话）
- **环境信息**：三个配置文件路径、环境变量状态、工作目录
- 保存 Key 后自动刷新模型列表（session:models 广播），所有操作均有结果反馈（聊天区通知 + 页面提示）

## 🔧 自动检测与自动配置（新电脑免配置）
应用启动时自动执行（`auto-config.js`）：
- **检测**本机 `~/.pi/agent/` 下的 `auth.json`（API Key）、`models-store.json`（模型清单）、`settings.json`（默认模型）及运行时目录是否完整
- **缺失时自动补齐**：创建 `~/.pi/{agent,nodes,nodes-docs,blueprints,kb,summary}` 目录，从 `bootstrap/agent/` 模板复制模型与设置配置
- **API Key 安全三路**（项目内不存 Key）：
  1. 本机已有有效 Key → 不动
  2. 设置环境变量 `DEEPSEEK_API_KEY` → 启动自动生成 `auth.json`（**新电脑推荐**）
  3. 都没有 → 写入占位文件，聊天区提示手动配置
- 检测/配置结果输出到启动日志，并在聊天区显示通知

## ✨ 功能总览

| 模块 | 说明 |
|------|------|
| 🏠 主页 | 大输入框、进行中的节点任务、最近聊天；左上角 π Logo 回主页 |
| 💬 聊天 | 流式回复 / Markdown / 思考折叠 / 工具卡片 / 模型切换 / 新会话 |
| ⬇ 下载 | 受管下载（进度/暂停/继续/停止/重试）；可停靠上下左右或独立窗口 |
| 🕘 历史 | 会话右键菜单：加载/归档/恢复/删除；归档区 `~/.pi/agent/sessions-archive/` |
| 📚 知识库 | RAG：导入文件/文本、检索、文档管理（本地嵌入模型） |
| 🧩 节点 | ComfyUI 风格画布：节点/连线/并行/循环/传导/动画 |
| 📋 总结 | 今日活动小结（自动/手动） |

## 🧩 节点系统（核心）

**画布**：独立窗口。平移/缩放/框选/多选/右键菜单/双击配置/Delete 删除；**创建动画**（节点缩放淡入、连线自绘）。

**节点类型**：`input` 输入 / `output` 输出 / `agent` 智能体（含**传导模式 carryContext**）/ `retrieve` RAG 检索 / `conference` 圆桌会议（多轮共享对话 + **AI 主持人判定循环终止**）/ 自定义节点（JSON 声明 + JS 实现，放 `~/.pi/nodes/` 或项目 `.pi/nodes/`）。

**执行模型**：拓扑排序，无依赖分支自动并行；调试运行选中节点（◉）；停止（■）。

**蓝图**：新建/保存/加载（`~/.pi/blueprints/`）；预设：规划→执行→审查链、并行调研、代码审查。

**AI 工具**：`view_node_library` / `create_node` / `list_blueprints` / `run_blueprint` / `view_blueprint_result` / `search_knowledge` / `import_knowledge` / `download`。

## 🛠 开发遥控（AI 驱动演示/调试）
主进程轮询 `~/.pi/dev-cmd.jsonl`（`{"id","target":"main"|"canvas","code"}`），执行后结果写 `~/.pi/dev-result.jsonl`。画布暴露 `window.__nodeApi`（`newGraph/addNode/addEdge/configNode/setInput/runAndWait`）。改渲染器代码重载画布即可；改主进程引擎需重启。

## 📁 关键目录
- `~/.pi/agent/sessions/` 会话 · `~/.pi/agent/sessions-archive/` 归档 · `~/.pi/blueprints/` 蓝图
- `~/.pi/nodes/` 自定义节点 · `~/.pi/nodes-docs/` AI 说明书（带标记标准）· `~/.pi/kb/` 知识库（模型+索引）
- `nodes/` 引擎（注册表/蓝图/工具/系统提示词）· `renderer/` 界面 · `embed-worker.mjs` 嵌入子进程
- `bootstrap/agent/` 自动配置模板（models/settings + auth 占位）· `auto-config.js` 自动检测与配置模块

> 🔐 项目内**不含真实 API Key**：新电脑请设置环境变量 `DEEPSEEK_API_KEY`，或启动后按提示编辑 `~/.pi/agent/auth.json`。

## ⚠️ 注意
- 下载/嵌入模型走受管下载（显示在下载面板）；嵌入 worker 用 `windowsHide` 避免 node.exe 弹窗
- 改主进程（`main.js`、`nodes/blueprint-manager.js` 等）需重启应用；改渲染器（`renderer/*`）重载对应窗口即可
