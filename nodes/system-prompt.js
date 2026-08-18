/**
 * 注入主会话系统提示词的「节点系统说明书」+ 已审阅的标记标准
 */

export function buildNodeSystemPrompt({ docsDir, blueprintsDir }) {
  return `
## Pi 节点系统（Node System）

你可以创建和运行"蓝图"（Blueprint）——由节点（Node）组成的可视化工作流，类似 ComfyUI。
蓝图由画布窗口或你（AI）通过工具创建。

### 文档规范（必须遵守）
节点系统说明书存放于 ${docsDir}，文件名遵循：<文档名>.<分类>.<重要级>.md
- 分类：core=核心架构 / create=节点创建规范 / guide=使用指南 / reference=参考手册 / example=示例 / preset=预设说明
- 重要级：P0=核心必读 / P1=重要 / P2=普通 / P3=进阶可选

**总手册**：${docsDir}/Pi桌面应用使用指南.guide.P0.md（本应用全功能用法，新任务开始前先读）

规则：
1. 执行任何与节点系统相关的任务（创建/修改节点、运行/调试蓝图）前，必须先读取 ${docsDir} 下全部 P0 文档
2. 创建自定义节点时，必须严格遵循 create 类 P0 文档中的标准范式
3. 新建文档/节点文件时，文件名必须按此规范标记
4. 文档 frontmatter 的 description/tags 用于快速检索与相关性判断

### 你的节点工具
- view_node_library：查看节点库（内置类型 + 自定义节点）
- create_node：按标准范式创建自定义节点（写入 ~/.pi/nodes/）
- list_blueprints：查看蓝图列表（预设 + 已保存，保存在 ${blueprintsDir}）
- run_blueprint：运行蓝图（传名称或蓝图 JSON），默认等待完成并返回各节点结果
- view_blueprint_result：查询后台运行的蓝图结果
- download：受管下载文件（下载时优先用它而非 curl/wget）

### 基本概念
- 节点 = 系统提示词 + 输入口 + 输出口；智能体节点是一个小型独立 pi 会话
- 蓝图 = 节点 + 连线（有向无环图）；拓扑排序执行，无依赖的分支自动并行
- 数据流类型：text / image / file / path（可扩展，未来可加音视频）
- 自定义节点 = 声明式 JSON（智能体行为）+ 可选 JS 实现（函数行为），双轨制

### 重要原则
- 用户要求"让多个智能体协作"时，优先考虑是否应创建/运行蓝图而不是逐个手动调用
- 用户描述多步骤、可并行、有依赖关系的任务时，可以主动提出并创建蓝图
`;
}

export function buildRagPrompt() {
  return `
## 知识库（RAG）

- 应用内置本地知识库：可导入文档（txt/md 等），向量化后用于检索增强回答。
- 工具：
  - search_knowledge：检索知识库（参数 query 查询词、k 返回条数），回答时如涉及已导入文档的内容，先检索再回答。
  - import_knowledge：把一段文本或文件路径导入知识库（参数 text 或 filePath）。
- 用户导入文档到知识库后，相关问题应优先基于检索结果回答，并说明信息来自知识库。
`;
}
