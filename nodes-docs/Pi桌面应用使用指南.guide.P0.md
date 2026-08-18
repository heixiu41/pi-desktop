---
title: Pi 桌面应用使用指南
description: Pi Desktop 全功能使用手册：节点画布、圆桌会议循环、传导模式、知识库 RAG、AI 工具、开发遥控。新任务开始前必读。
tags: [guide, pi-desktop, node-system, rag, all]
---

# Pi 桌面应用使用指南（guide.P0）

> 本文是 Pi Desktop 的**总使用手册**。任何涉及本应用的任务（构建蓝图、运行节点、知识库、驱动应用）前，请先通读本文，并按标记规范读取相关 P0/P1 文档。

## 1. 应用是什么

**Pi Desktop** 是基于 Electron + Pi SDK 的桌面应用，包含：聊天、受管下载、历史会话（归档）、今日总结、主页、知识库（RAG）、**多智能体节点画布**（ComfyUI 风格）。

## 2. 主窗口与侧边栏

| 区域 | 功能 |
|------|------|
| 主页 | 大输入框（回车发消息并切入聊天）、进行中的节点任务、最近的聊天；左上角 **π Logo 点击回主页** |
| 聊天 | 流式回复、Markdown、思考折叠、工具卡片 |
| 下载 | 受管下载：进度/暂停/继续/停止/重试，可停靠上下左右或独立窗口 |
| 节点 | 打开节点画布（独立窗口） |
| 知识库 | RAG：导入文件/文本、文档列表、测试检索、模型状态 |
| 总结 | 今日活动小结（自动/手动） |
| 历史记录 | 会话列表；**右键**菜单：加载/归档/恢复/删除；归档存 `~/.pi/agent/sessions-archive/` |

## 3. 节点画布（核心）

### 3.1 画布操作
- 平移=拖拽空白；缩放=滚轮；框选=Shift+拖拽；多选=Shift+点击
- 连线：从**输出口拖到输入口**（类型需兼容）；右键菜单可删除/复制/配置节点
- 配置：**双击节点**打开弹窗；选中后 Delete 删除
- **创建动画**：新节点缩放淡入、新连线自绘

### 3.2 内置节点类型
| 类型 | 用途 |
|------|------|
| `input` | 提供初始文本/文件（config.content） |
| `output` | 汇总最终结果（可多路输入） |
| `agent` | 智能体节点：系统提示词/模型/思考级别/上下文上限/工具白名单/**传导模式** |
| `retrieve` | RAG 检索：查询→命中知识库片段（config.k 返回条数） |
| `conference` | 圆桌会议：多参与者多轮对话，**彼此可见全部发言**，可选 **AI 主持人判定循环终止** |
| 自定义 | `~/.pi/nodes/` 或项目 `.pi/nodes/` 下 JSON 声明 + JS 实现 |

### 3.3 执行模型
- **拓扑排序**：有依赖等待，无依赖分支**自动并行**
- **调试运行**（◉）：只跑选中节点，上游用上次缓存
- **停止**：中止所有进行中的智能体会话
- **传导模式（carryContext）**：agent 节点开启后，输出=上游完整对话记录+本轮发言，串成链可实现**跨节点多轮传导**
- **圆桌会议（conference）**：内部为每位参与者建独立会话+共享记录，每轮全员发言；配置 `judge`（AI 主持人）后由主持人每轮判定「继续/结束」，实现**AI 驱动的循环收敛**（maxRounds 为安全上限）

### 3.4 蓝图管理
- 新建/保存（`~/.pi/blueprints/`）/加载；内置预设：规划→执行→审查链、并行调研、代码审查
- 演示蓝图：`blueprint-demo-parallel`（并行智能体）、`blueprint-demo-rag`（RAG 链路）

## 4. 知识库（RAG）
- 模型：Xenova/bge-small-zh-v1.5（本地 ONNX，走受管下载，**下载会显示在下载面板**）
- 嵌入运行在独立 node 子进程（`embed-worker.mjs`，windowsHide 隐藏弹窗）
- 数据：`~/.pi/kb/index.json`；导入文件/文本→分块（700字/80重叠）→向量化→余弦检索

## 5. AI 可用工具
| 工具 | 说明 |
|------|------|
| `view_node_library` | 查看节点库（内置+自定义） |
| `create_node` | 按标准范式创建自定义节点（写 `~/.pi/nodes/`） |
| `list_blueprints` | 查看蓝图（预设+已保存） |
| `run_blueprint` | 运行蓝图（名称/ID/JSON），等待完成返回各节点结果 |
| `view_blueprint_result` | 查询后台运行结果 |
| `search_knowledge` / `import_knowledge` | 知识库检索/导入 |
| `download` | 受管下载（显示在下载面板） |

**使用原则**：多智能体/多步骤/可并行任务→优先建蓝图；涉及知识库→先检索再答；下载→用 download 工具。

## 6. 开发遥控通道（AI 驱动应用）
主进程每 600ms 轮询 `~/.pi/dev-cmd.jsonl`（JSONL：`{"id","target":"main"|"canvas","code"}`），在指定窗口执行 JS 并追加结果到 `~/.pi/dev-result.jsonl`。
- 画布窗口暴露 `window.__nodeApi`：`newGraph/addNode/addEdge/setTitle/configNode/setInput/getGraph/runAndWait`
- **无需重启**即可驱动应用做演示/调试；改主进程引擎代码仍需要重启加载

## 7. 常见操作路径
- **演示多智能体**：建 `input → 多个 agent(并行) → 汇总 agent → output`，点运行
- **多轮对话**：`input → conference(participants+judge)`，主持人自动判停
- **节点链多轮传导**：一串 agent 节点全部开 `carryContext`，记录逐节点传递
- **RAG 问答**：`input → retrieve → agent → output`
- **让 AI 干活**：聊天里说"创建 xxx 蓝图并运行"，AI 会读本文档+create.P0 后执行
