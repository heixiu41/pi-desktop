<div align="center">

# π Pi Desktop

**基于 Electron + Pi SDK 的多智能体桌面应用**

聊天 · 受管下载 · 知识库 RAG · ComfyUI 风格节点画布 · 今日总结

![Electron](https://img.shields.io/badge/Electron-43.3-47848F?logo=electron&logoColor=white)
![Pi SDK](https://img.shields.io/badge/Pi%20SDK-0.84.1-5E8BFF)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## 📖 简介

Pi Desktop 把 [Pi 编码代理](https://github.com/earendil-works/pi-coding-agent) 封装成 Windows 桌面应用，提供图形化界面来完成复杂 AI 工作流：

- **多智能体协作**：ComfyUI 风格的节点画布，让多个 AI 智能体并行/串联协作
- **知识库增强**：本地 RAG 检索，让 AI 基于你的文档回答问题
- **全功能聊天**：流式输出、Markdown、思考过程折叠、工具调用可视化
- **零配置迁移**：自动检测环境、自动完成配置，拷到任何电脑即用

> ⚡ 核心亮点：**节点系统** —— 像搭积木一样编排 AI 智能体工作流，支持并行执行、圆桌会议、上下文传导。

---

## ✨ 功能特性

| 模块 | 说明 |
|------|------|
| 🏠 **主页** | 大输入框、进行中的节点任务、最近聊天；左上角 π Logo 一键回主页 |
| 💬 **聊天** | 流式回复 / Markdown / 思考折叠 / 工具卡片 / 模型切换 / 新会话 / 图片识别 |
| 🧩 **节点画布** | ComfyUI 风格：节点、连线、自动并行、圆桌会议、上下文传导、创建动画 |
| 📚 **知识库** | 本地 RAG：导入文件/文本、向量化索引、语义检索（本地嵌入模型） |
| ⬇️ **受管下载** | 进度/暂停/继续/停止/重试；可停靠窗口四周或独立成窗 |
| 🕘 **历史记录** | 会话右键菜单：加载/归档/恢复/删除 |
| ⚙️ **API 配置** | 图形化管理 API Key：保存/测试连接/切换模型/环境变量 |
| 🔧 **自动配置** | 启动自动检测环境，缺失配置自动补齐（新电脑免配置） |
| 📋 **今日总结** | 自动/手动生成当日活动小结 |
| ✨ **启动动画** | 加载窗口平滑放大衔接主界面 |

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 22
- **Windows 10/11**（当前版本面向 Windows）

### 安装与启动

```bash
# 1. 克隆仓库
git clone https://github.com/heixiu41/pi-desktop.git
cd pi-desktop

# 2. 安装依赖
npm install

# 3. 启动
npm start
# 或直接双击「启动Pi桌面应用.bat」
```

> 也可不克隆仓库：下载发布包，解压后双击 `启动Pi桌面应用.bat` 即可。

### 配置 API Key

应用基于 DeepSeek API（OpenAI 兼容），首次使用需配置 Key，**任选一种**：

**方式一：环境变量（推荐）**

设置系统环境变量 `DEEPSEEK_API_KEY=sk-xxx`，启动时应用自动读取并生成配置，无需任何手动操作。

**方式二：界面配置**

启动后 → 侧边栏「**API 配置**」→ 输入 Key → **保存** → **测试连接** 验证 → 选择默认模型 → **应用**。

**方式三：手动编辑**

编辑 `~/.pi/agent/auth.json`：

```json
{
  "deepseek": {
    "type": "api_key",
    "key": "sk-你的Key"
  }
}
```

> 🔐 项目源码中**不包含任何真实 API Key**，可放心公开与分发。

---

## 🧩 节点系统（核心）

### 什么是节点系统？

节点系统是 Pi Desktop 的核心能力：每个节点是一个**独立 AI 智能体**（或数据源/处理器），用连线组成**有向无环图**，应用按拓扑排序自动执行——互不依赖的节点**并行运行**，高效完成复杂任务。

```
示例：并行调研工作流

   ┌──────────┐
   │  input   │  初始问题
   └────┬─────┘
        │
   ┌────┴────┐
   │  agent  │  智能体A：调研技术方案
   │  agent  │  智能体B：调研市场行情   ← 并行执行
   │  agent  │  智能体C：调研竞品
   └────┬────┘
        │
   ┌────┴────┐
   │  agent  │  汇总智能体：整合三路结果
   └────┬────┘
        │
   ┌────┴────┐
   │ output  │  最终报告
   └─────────┘
```

### 内置节点类型

| 类型 | 说明 |
|------|------|
| `input` | 输入节点：提供初始文本/文件 |
| `output` | 输出节点：汇总最终结果 |
| `agent` | 智能体节点：独立会话，可配置提示词/模型/思考级别/工具 |
| `retrieve` | RAG 检索节点：查询知识库，命中片段传给下游 |
| `conference` | 圆桌会议：多参与者多轮对话，可选 AI 主持人判定终止 |
| 自定义 | JSON 声明 + JS 实现，扩展任意功能（`~/.pi/nodes/`） |

### 关键能力

- **自动并行**：无依赖分支同时执行
- **传导模式**（carryContext）：节点间传递完整对话记录，串联多轮深度推理
- **调试运行**：只运行选中节点，上游使用缓存结果
- **蓝图**：保存/加载工作流，内置预设（规划→执行→审查、并行调研、代码审查）
- **画布操作**：平移/缩放/框选/右键菜单/双击配置

---

## 📚 知识库（RAG）

- 导入 **txt / md** 等文档（文件或粘贴文本）
- 本地嵌入模型（`Xenova/bge-small-zh-v1.5`）向量化，数据不出本机
- 语义检索增强回答：提问时 AI 自动检索相关知识库内容
- 文档管理：查看/删除文档，测试检索效果

---

## 🔧 自动配置机制

应用启动时自动执行 `auto-config.js`：

1. **检测** `~/.pi/agent/` 下配置（API Key / 模型清单 / 默认设置）与运行时目录
2. **补齐**：自动创建目录，从 `bootstrap/agent/` 模板恢复模型与设置
3. **API Key 三路安全策略**：已有配置 → 环境变量 → 界面手动配置

因此把项目文件夹拷贝到任何新电脑，`npm install` 后即可运行，无需手动搭建环境。

---

## 📁 目录结构

```
pi-desktop/
├── main.js                    # Electron 主进程（窗口/引擎/IPC）
├── preload.js                 # 预加载脚本（安全桥接）
├── auto-config.js             # 自动检测与配置模块
├── bootstrap/agent/           # 自动配置模板（无真实 Key）
├── download-manager.js        # 受管下载
├── download-tool.js           # 下载工具
├── rag-engine.js              # 知识库 RAG 引擎
├── embed-worker.mjs           # 嵌入子进程（向量化）
├── summary.js                 # 今日总结
├── nodes/                     # 节点系统引擎
│   ├── node-registry.js       # 节点注册表
│   ├── blueprint-manager.js   # 蓝图管理/执行
│   ├── ai-tools.js            # AI 工具
│   ├── kb-tools.js            # 知识库工具
│   ├── system-prompt.js       # 系统提示词
│   └── vision-tool.js         # 视觉工具
├── nodes-docs/                # AI 说明书（分类/重要级标记）
├── renderer/                  # 界面
│   ├── index.html / app.js / style.css     # 主界面
│   ├── canvas.html / canvas.js / canvas.css # 节点画布
│   └── splash.*               # 启动动画
└── package.json
```

**运行时数据**（不在项目内，位于用户目录）：

```
~/.pi/agent/          # 配置（auth/models/settings）与会话
~/.pi/nodes/          # 自定义节点
~/.pi/blueprints/     # 保存的蓝图
~/.pi/kb/             # 知识库（模型+索引）
```

---

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| [Electron](https://www.electronjs.org/) | 桌面应用框架 |
| [Pi Coding Agent SDK](https://github.com/earendil-works/pi-coding-agent) | AI 智能体会话引擎 |
| [Xenova Transformers.js](https://github.com/xenova/transformers.js) | 本地嵌入模型（RAG） |
| marked + DOMPurify | Markdown 渲染与安全过滤 |
| DeepSeek API | 模型服务（OpenAI 兼容） |

---

## ❓ 常见问题

**Q：启动后提示"未检测到 API Key"？**
设置环境变量 `DEEPSEEK_API_KEY` 后重启，或打开「API 配置」页面填入 Key。

**Q：节点画布打不开？**
点击侧边栏「节点」会自动打开画布窗口；若未出现，检查是否被弹窗拦截。

**Q：知识库导入慢？**
首次使用需要下载本地嵌入模型（显示在下载面板），之后导入即时完成。

**Q：如何让 AI 协作完成多步骤任务？**
直接在聊天中说「创建 xxx 蓝图并运行」，AI 会读取说明书自动规划并执行；或手动在画布编排节点。

**Q：修改代码后不生效？**
主进程（`main.js`、`nodes/*`）修改后需重启应用；渲染进程（`renderer/*`）重载窗口即可。

---

## 🤝 贡献

欢迎提交 Issue 与 PR：

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/xxx`）
3. 提交修改（`git commit -m "feat: xxx"`）
4. 推送分支并提交 Pull Request

---

## 📄 许可证

本项目基于 **MIT License** 开源。

---

<div align="center">
  <sub>π Pi Desktop · 用节点编排智能 · Powered by Electron & Pi SDK</sub>
</div>
