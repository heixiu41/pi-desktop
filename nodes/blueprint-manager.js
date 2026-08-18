/**
 * 蓝图管理器：图模型、拓扑排序执行引擎、预设、保存/加载
 * 智能体节点 = 独立 AgentSession；自定义函数节点 = JS 实现
 */
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, writeFile, unlink, stat, watch } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const BLUEPRINTS_DIR = path.join(os.homedir(), ".pi", "blueprints");
const DEFAULT_AGENT_TOOLS = ["read", "bash", "edit", "write", "download"];
const MAX_PROGRESS_TEXT = 2000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/* ---------------- 内置预设 ---------------- */

export const PRESETS = [
  {
    id: "plan-execute-review",
    name: "规划→执行→审查链",
    description: "串行链式：先规划，再执行，最后审查，适合实现类任务",
    blueprint: {
      name: "规划→执行→审查链",
      description: "planner 制定计划，worker 执行，reviewer 审查",
      nodes: [
        { id: "n1", type: "input", title: "任务输入", x: 0, y: 180, config: { content: "" } },
        { id: "n2", type: "agent", title: "规划者 planner", x: 320, y: 60,
          config: { systemPrompt: "你是规划者。基于输入任务，输出一份清晰、可执行的实施计划（步骤列表、涉及文件、验收标准）。只输出计划本身。", thinkingLevel: "medium" } },
        { id: "n3", type: "agent", title: "执行者 worker", x: 640, y: 60,
          config: { systemPrompt: "你是执行者。严格按上游计划执行任务：先读取相关文件了解现状，再实施修改。执行完成后简要汇报做了什么。", thinkingLevel: "medium" } },
        { id: "n4", type: "agent", title: "审查者 reviewer", x: 960, y: 60,
          config: { systemPrompt: "你是审查者。审查上游执行结果：检查是否有遗漏、错误、潜在问题，输出审查结论与改进建议。", thinkingLevel: "medium" } },
        { id: "n5", type: "output", title: "最终结果", x: 1280, y: 180, config: {} },
      ],
      edges: [
        { id: "e1", from: "n1", fromPort: "out", to: "n2", toPort: "context" },
        { id: "e2", from: "n2", fromPort: "text", to: "n3", toPort: "context" },
        { id: "e3", from: "n3", fromPort: "text", to: "n4", toPort: "context" },
        { id: "e4", from: "n4", fromPort: "text", to: "n5", toPort: "in" },
      ],
    },
  },
  {
    id: "parallel-research",
    name: "并行调研",
    description: "多个 worker 并行研究同一问题的不同角度，合并汇总",
    blueprint: {
      name: "并行调研",
      description: "三个研究员并行调研不同角度，output 合并",
      nodes: [
        { id: "n1", type: "input", title: "研究问题", x: 0, y: 200, config: { content: "" } },
        { id: "n2", type: "agent", title: "研究员A（背景）", x: 320, y: 0,
          config: { systemPrompt: "你是研究员。从「背景与现状」角度研究输入问题，输出 300 字以内调研结论。", thinkingLevel: "low" } },
        { id: "n3", type: "agent", title: "研究员B（方案）", x: 320, y: 180,
          config: { systemPrompt: "你是研究员。从「可行方案与对比」角度研究输入问题，输出 300 字以内调研结论。", thinkingLevel: "low" } },
        { id: "n4", type: "agent", title: "研究员C（风险）", x: 320, y: 360,
          config: { systemPrompt: "你是研究员。从「风险与注意事项」角度研究输入问题，输出 300 字以内调研结论。", thinkingLevel: "low" } },
        { id: "n5", type: "output", title: "综合结论", x: 700, y: 180, config: {} },
      ],
      edges: [
        { id: "e1", from: "n1", fromPort: "out", to: "n2", toPort: "context" },
        { id: "e2", from: "n1", fromPort: "out", to: "n3", toPort: "context" },
        { id: "e3", from: "n1", fromPort: "out", to: "n4", toPort: "context" },
        { id: "e4", from: "n2", fromPort: "text", to: "n5", toPort: "in" },
        { id: "e5", from: "n3", fromPort: "text", to: "n5", toPort: "in" },
        { id: "e6", from: "n4", fromPort: "text", to: "n5", toPort: "in" },
      ],
    },
  },
  {
    id: "code-review",
    name: "代码审查流水线",
    description: "审查代码问题并给出修复方案",
    blueprint: {
      name: "代码审查流水线",
      description: "analyzer 静态审查，fixer 产出修复方案",
      nodes: [
        { id: "n1", type: "input", title: "代码路径/内容", x: 0, y: 160, config: { content: "" } },
        { id: "n2", type: "agent", title: "审查员 analyzer", x: 340, y: 40,
          config: { systemPrompt: "你是代码审查员。审查输入（可能是代码内容或路径，若是路径请先 read 读取）。输出问题清单：严重程度、位置、原因、建议。", thinkingLevel: "medium" } },
        { id: "n3", type: "agent", title: "修复方案 fixer", x: 680, y: 40,
          config: { systemPrompt: "你是修复专家。基于上游审查问题清单，输出具体修复方案：需要修改的文件、修改要点、关键代码片段。", thinkingLevel: "medium" } },
        { id: "n4", type: "output", title: "审查报告", x: 1020, y: 160, config: {} },
      ],
      edges: [
        { id: "e1", from: "n1", fromPort: "out", to: "n2", toPort: "context" },
        { id: "e2", from: "n2", fromPort: "text", to: "n3", toPort: "context" },
        { id: "e3", from: "n3", fromPort: "text", to: "n4", toPort: "in" },
      ],
    },
  },
];

/* ---------------- 图算法 ---------------- */

/** 拓扑排序 + 分层（同层可并行）。带 loop/back 标记的边视为回边，拓扑时忽略；前向边成环才抛错。 */
export function analyzeGraph(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  // 回边（loop 边）：不参与拓扑，由执行器做迭代循环
  const loopEdges = graph.edges.filter((e) => e.loop || e.back);
  const fwdEdges = graph.edges.filter((e) => !(e.loop || e.back));
  const indeg = new Map();
  const adj = new Map();
  const preds = new Map();
  for (const n of graph.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
    preds.set(n.id, []);
  }
  for (const e of fwdEdges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    adj.get(e.from).push(e.to);
    preds.get(e.to).push(e.from);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }
  const queue = [...indeg.keys()].filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of adj.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error("蓝图存在循环依赖，无法执行（若需循环请给回边加 loop:true 标记）");
  }
  // 分层：level[n] = max(level[pred]) + 1
  const level = new Map();
  for (const id of order) {
    let lv = 0;
    for (const p of preds.get(id)) lv = Math.max(lv, (level.get(p) ?? -1) + 1);
    level.set(id, lv);
  }
  const levels = [];
  for (const id of order) {
    const lv = level.get(id);
    (levels[lv] ??= []).push(id);
  }
  return { order, levels, byId, loopEdges, fwdEdges };
}

/* ---------------- 蓝图管理器 ---------------- */

export class BlueprintManager extends EventEmitter {
  constructor({ registry, modelRuntime, cwd, downloadTool, ragEngine }) {
    super();
    this.registry = registry;
    this.modelRuntime = modelRuntime;
    this.cwd = cwd;
    this.downloadTool = downloadTool;
    this.ragEngine = ragEngine;
    this.blueprints = new Map(); // id -> {id,name,modified,blueprint}
    this.runs = new Map(); // runId -> run
    this.lastResults = new Map(); // blueprintId -> node results 缓存（调试用）
  }

  async init() {
    await mkdir(BLUEPRINTS_DIR, { recursive: true });
    await this._loadSaved();
    // 蓝图库热更新：后台监听目录变化（不阻塞 init），防抖重扫并广播
    this._startWatch();
  }

  /** 后台目录监听：for await 在独立任务中运行，避免阻塞 init/setup */
  _startWatch() {
    try {
      const w = watch(BLUEPRINTS_DIR, { persistent: false });
      (async () => {
        for await (const ev of w) {
          if (!ev?.filename?.endsWith(".json")) continue;
          clearTimeout(this._bpReloadTimer);
          this._bpReloadTimer = setTimeout(async () => {
            try {
              await this._loadSaved();
              this.emit("blueprints");
            } catch {
              /* 忽略重扫失败 */
            }
          }, 600);
        }
      })().catch(() => {
        /* 监听不可用则退回手动刷新 */
      });
    } catch {
      /* 目录监听不可用则退回手动刷新 */
    }
  }

  blueprintsDir() {
    return BLUEPRINTS_DIR;
  }

  presetList() {
    return PRESETS.map(({ id, name, description }) => ({ id, name, description, preset: true }));
  }

  blueprintList() {
    return [...this.blueprints.values()]
      .sort((a, b) => b.modified - a.modified)
      .map(({ id, name, modified, blueprint }) => ({ id, name, modified, category: blueprint?.category || null, preset: false }));
  }

  getPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    return p ? structuredClone(p.blueprint) : null;
  }

  getSaved(id) {
    const b = this.blueprints.get(id);
    return b ? structuredClone(b.blueprint) : null;
  }

  /** 按名称（预设名或已保存名）或 id 找蓝图 */
  findBlueprint(nameOrId) {
    const p = PRESETS.find((x) => x.id === nameOrId || x.name === nameOrId);
    if (p) return structuredClone(p.blueprint);
    const b = this.blueprints.get(nameOrId);
    if (b) return structuredClone(b.blueprint);
    const byName = [...this.blueprints.values()].find((x) => x.name === nameOrId);
    if (byName) return structuredClone(byName.blueprint);
    return null;
  }

  async _loadSaved() {
    this.blueprints.clear(); // 重扫前清空，反映删除/归档
    try {
      const files = await readdir(BLUEPRINTS_DIR);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const raw = await readFile(path.join(BLUEPRINTS_DIR, f), "utf-8");
          const bp = JSON.parse(raw);
          if (bp?.id && Array.isArray(bp?.nodes)) {
            this.blueprints.set(bp.id, {
              id: bp.id,
              name: bp.name || bp.id,
              modified: Date.now(),
              blueprint: bp,
            });
          }
        } catch {
          /* 忽略坏文件 */
        }
      }
    } catch {
      /* 目录不存在 */
    }
  }

  async saveBlueprint(bp) {
    if (!bp || !Array.isArray(bp.nodes)) throw new Error("蓝图结构无效");
    bp.id = bp.id || `blueprint-${crypto.randomUUID().slice(0, 8)}`;
    bp.name = bp.name || "未命名蓝图";
    bp.version = 1;
    const file = path.join(BLUEPRINTS_DIR, `${bp.id}.json`);
    await writeFile(file, JSON.stringify(bp, null, 2), "utf-8");
    this.blueprints.set(bp.id, {
      id: bp.id,
      name: bp.name,
      modified: Date.now(),
      blueprint: structuredClone(bp),
    });
    this.emit("blueprints");
    return structuredClone(bp);
  }

  async deleteBlueprint(id) {
    const b = this.blueprints.get(id);
    if (!b) return false;
    this.blueprints.delete(id);
    try {
      await unlink(path.join(BLUEPRINTS_DIR, `${id}.json`));
    } catch {
      /* ignore */
    }
    this.emit("blueprints");
    return true;
  }

  getRun(runId) {
    return this.runs.get(runId);
  }

  /* ---------------- 运行 ---------------- */

  /** 启动运行。返回 { runId, promise } */
  run({ blueprint, selection, inputs }) {
    const graph = structuredClone(blueprint);
    // 应用 inputs 到 input 节点
    if (inputs && typeof inputs === "object") {
      for (const n of graph.nodes) {
        if (n.type === "input" && inputs[n.title] !== undefined) {
          n.config = { ...(n.config || {}), content: String(inputs[n.title]) };
        }
      }
    }
    const runId = crypto.randomUUID();
    const run = {
      id: runId,
      blueprintId: graph.id || null,
      name: graph.name || "未命名",
      graph,
      selection: selection || null,
      status: "running",
      aborted: false,
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      nodes: new Map(), // nodeId -> { status, progressText, output, error }
      results: {},
      abortControllers: new Set(),
      _resolve: null,
      _reject: null,
    };
    run.promise = new Promise((res, rej) => {
      run._resolve = res;
      run._reject = rej;
    });
    this.runs.set(runId, run);
    const resolveWith = () => ({
      runId,
      status: run.status,
      error: run.error,
      results: summarizeResults(run),
      resultsById: run.results,
    });
    this._execute(run)
      .then(() => {
        run.status = run.aborted ? "aborted" : "done";
        run.finishedAt = Date.now();
        this.emit("run-end", run);
        run._resolve(resolveWith());
      })
      .catch((err) => {
        run.status = run.aborted ? "aborted" : "error";
        run.error = err?.message || String(err);
        run.finishedAt = Date.now();
        this.emit("run-end", run);
        run._resolve(resolveWith());
      });
    this.emit("run-start", run);
    return { runId, run };
  }

  abort(runId) {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return;
    run.aborted = true;
    for (const ctrl of run.abortControllers) ctrl.abort();
    run.abortControllers.clear();
  }

  async _execute(run) {
    const { graph, selection } = run;
    const { levels, byId, loopEdges, fwdEdges } = analyzeGraph(graph);
    const outputs = new Map(); // nodeId -> { portName: value }
    // 调试运行：使用缓存的上游结果
    if (selection?.length) {
      const cache = this.lastResults.get(graph.id) || {};
      for (const [nodeId, res] of Object.entries(cache)) {
        if (selection.includes(nodeId)) continue;
        if (res.output) outputs.set(nodeId, { text: res.output });
      }
    }

    // ---- loop 支持：回边 → 循环体子图 + 迭代轮次 ----
    const loopTargets = loopEdges.map((e) => e.to).filter((id) => byId.has(id));
    const loopBody = new Set();
    if (loopTargets.length) {
      const fwdAdj = new Map();
      for (const e of fwdEdges) {
        if (!byId.has(e.from) || !byId.has(e.to)) continue;
        let s = fwdAdj.get(e.from);
        if (!s) fwdAdj.set(e.from, (s = new Set()));
        s.add(e.to);
      }
      const stack = [...loopTargets];
      while (stack.length) {
        const id = stack.pop();
        if (loopBody.has(id)) continue;
        loopBody.add(id);
        for (const nx of fwdAdj.get(id) || []) stack.push(nx);
      }
    }
    // 循环体分层：直接用全图 level（回边不参与 level 计算）过滤循环体节点
    const bodyLevels = levels.map((lvl) => lvl.filter((id) => loopBody.has(id))).filter((l) => l.length);
    const maxRounds = Math.max(1, Math.min(10,
      Number(graph.loopRounds) || loopEdges.reduce((m, e) => Math.max(m, Number(e.maxRounds) || 3), 3)));

    // {round}/{prevRound} 模板替换（config 与 input content，每轮不同）
    const deepReplace = (v, round, prevRound) => {
      if (typeof v === "string") {
        return v.split("{round}").join(String(round)).split("{prevRound}").join(String(prevRound));
      }
      if (Array.isArray(v)) return v.map((x) => deepReplace(x, round, prevRound));
      if (v && typeof v === "object") {
        const o = {};
        for (const [k, val] of Object.entries(v)) o[k] = deepReplace(val, round, prevRound);
        return o;
      }
      return v;
    };

    // 执行一层节点（round 为当前轮次）
    const execBatch = async (round, level) => {
      const batch = level.filter((id) => !selection || selection.includes(id));
      if (!batch.length) return;
      await Promise.all(
        batch.map(async (nodeId) => {
          if (run.aborted) throw new Error("运行已中止");
          const nodeRaw = byId.get(nodeId);
          const node = { ...nodeRaw, config: deepReplace(nodeRaw.config || {}, round, round - 1) };
          // 收集输入（同一输入口允许多条连线 → 合并为数组）
          const inputs = {};
          for (const e of graph.edges) {
            if (e.to === nodeId) {
              const v = outputs.get(e.from)?.[e.fromPort];
              if (v == null) continue;
              if (inputs[e.toPort] === undefined) inputs[e.toPort] = v;
              else if (Array.isArray(inputs[e.toPort])) inputs[e.toPort].push(v);
              else inputs[e.toPort] = [inputs[e.toPort], v];
            }
          }
          if (run.aborted) throw new Error("运行已中止");
          run.nodes.set(nodeId, { status: "running", progressText: round > 1 ? `第 ${round} 轮` : "", output: "", error: null });
          this._emitNode(run, nodeId, node, "node-start", { round });
          try {
            const out = await this._executeNode(run, node, inputs);
            outputs.set(nodeId, out);
            run.results[nodeId] = { output: stringifyValue(out), ok: true, round };
            run.nodes.set(nodeId, { status: "done", progressText: round > 1 ? `第 ${round} 轮` : "", output: stringifyValue(out), error: null });
            this._emitNode(run, nodeId, node, "node-end", { status: "done", round });
          } catch (err) {
            const msg = err?.message || String(err);
            run.results[nodeId] = { output: "", ok: false, error: msg, round };
            run.nodes.set(nodeId, { status: "error", progressText: round > 1 ? `第 ${round} 轮` : "", output: "", error: msg });
            this._emitNode(run, nodeId, node, "node-end", { status: "error", error: msg, round });
            throw err;
          }
        })
      );
    };

    // 第 1 轮：执行全图（按前向拓扑）
    for (const level of levels) {
      await execBatch(1, level);
    }
    // 第 2..N 轮：只重跑循环体子图（回边数据已在 outputs，天然供下一轮使用）
    for (let round = 2; round <= maxRounds && loopBody.size; round++) {
      if (run.aborted) break;
      this._emitNode(run, null, null, "node-update", { text: `loop 迭代第 ${round}/${maxRounds} 轮` });
      for (const level of bodyLevels) {
        await execBatch(round, level);
      }
    }
    // 缓存本次结果（调试用）
    if (graph.id) this.lastResults.set(graph.id, { ...run.results });
  }

  async _executeNode(run, node, inputs) {
    if (node.type === "input") {
      const c = node.config?.content;
      if (typeof c === "string") return { out: { type: "text", text: c } };
      if (c?.type === "file" || c?.type === "image" || c?.type === "path") return { out: { type: c.type, path: c.path, text: c.path } };
      return { out: { type: "text", text: "" } };
    }
    if (node.type === "output") {
      const values = Object.values(inputs).flat(Infinity);
      const parts = values
        .filter(Boolean)
        .map((v) => valueToText(v))
        .filter(Boolean);
      return { in: { type: "text", text: parts.join("\n\n---\n\n") } };
    }
    // 检索节点（RAG）
    if (node.type === "retrieve") {
      const qv = inputs.query ?? inputs.context;
      const query = Array.isArray(qv)
        ? qv.map((v) => valueToText(v)).filter(Boolean).join("\n")
        : valueToText(qv);
      if (!query) throw new Error("检索节点缺少查询输入");
      const k = Math.max(1, Math.min(20, Number(node.config?.k) || 4));
      if (!this.ragEngine) throw new Error("知识库未就绪");
      const results = await this.ragEngine.search(query, k);
      const hits = results.length
        ? results
            .map((r, i) => `【${i + 1}】（相关度 ${r.score}，来源：${r.docName}）\n${r.text}`)
            .join("\n\n---\n\n")
        : "（知识库无匹配结果）";
      // 把原查询一并输出，方便下游智能体知道要回答什么
      const text = `查询：${query}\n\n知识库检索结果：\n${hits}`;
      return { result: { type: "text", text } };
    }
    // 圆桌会议节点（多轮对话，参与者彼此可见）
    if (node.type === "conference") {
      return await this._runConference(run, node, inputs);
    }
    // 自定义节点
    const custom = this.registry.get(node.type);
    if (custom) {
      if (custom.implementationPath) {
        const impl = await this.registry.loadImplementation(custom);
        if (impl?.execute) {
          const res = await impl.execute(
            inputs,
            node.config || {},
            { run, node, log: (text) => this._emitNode(run, node.id, node, "node-update", { text: String(text) }) }
          );
          return normalizeCustomOutput(res, custom);
        }
      }
      // 无实现 → 智能体行为（用声明里的 systemPrompt）
      return await this._runAgent(run, node, inputs, {
        systemPrompt: custom.systemPrompt || node.config?.systemPrompt,
        tools: custom.tools,
      });
    }
    // 内置 agent
    return await this._runAgent(run, node, inputs, {});
  }

  /** 圆桌会议：多位参与者多轮对话，共享对话记录，彼此可见。支持 AI 主持人判定循环终止 */
  async _runConference(run, node, inputs) {
    const cfg = node.config || {};
    const judge = cfg.judge || null;
    const fixedRounds = Math.max(0, Number(cfg.rounds) || (judge ? 0 : 2));
    const maxRounds = Math.max(1, Math.min(10, Number(cfg.maxRounds) || (judge ? 6 : fixedRounds)));
    const topic = Array.isArray(inputs.topic)
      ? inputs.topic.map((v) => valueToText(v)).filter(Boolean).join("\n")
      : valueToText(inputs.topic) || "（未提供话题）";
    const participants =
      Array.isArray(cfg.participants) && cfg.participants.length
        ? cfg.participants
        : [{ name: "嘉宾A", systemPrompt: "你是一位嘉宾，参与圆桌讨论，观点鲜明。" }];

    const sessions = [];
    const transcript = [];
    let judgeSession = null;
    const stopReason = judge ? "主持人判定结束" : "固定轮数结束";
    try {
      for (const p of participants) {
        const loader = new DefaultResourceLoader({
          cwd: this.cwd,
          agentDir: getAgentDir(),
          systemPromptOverride: () => p.systemPrompt,
        });
        await loader.reload();
        const result = await createAgentSession({
          cwd: this.cwd,
          agentDir: getAgentDir(),
          resourceLoader: loader,
          sessionManager: SessionManager.inMemory(this.cwd),
          thinkingLevel: cfg.thinkingLevel || "low",
          tools: ["read", "grep", "find", "ls"],
        });
        sessions.push({ p, session: result.session });
      }
      if (judge) {
        const jLoader = new DefaultResourceLoader({
          cwd: this.cwd,
          agentDir: getAgentDir(),
          systemPromptOverride: () => judge.systemPrompt,
        });
        await jLoader.reload();
        const jResult = await createAgentSession({
          cwd: this.cwd,
          agentDir: getAgentDir(),
          resourceLoader: jLoader,
          sessionManager: SessionManager.inMemory(this.cwd),
          thinkingLevel: cfg.thinkingLevel || "low",
          tools: ["read", "grep", "find", "ls"],
        });
        judgeSession = jResult.session;
      }

      const totalRounds = judge ? maxRounds : fixedRounds;
      let actual = 0;
      for (let r = 1; r <= totalRounds; r++) {
        actual = r;
        for (const s of sessions) {
          const history = transcript.length
            ? transcript.map((m) => `【${m.name}】${m.text}`).join("\n\n")
            : "（还没有人发言）";
          const context = `讨论话题：${topic}\n\n到目前为止的对话记录：\n${history}\n\n现在是第 ${r} 轮，轮到你（${s.p.name}）发言。请接着聊：回应别人、提出新观点、插科打诨都行。`;
          const reply = await this._promptForText(s.session, context, run, node, s.p.name, r);
          transcript.push({ name: s.p.name, text: reply, round: r });
        }
        // AI 主持人判定是否结束
        if (judgeSession) {
          const history = transcript
            .map((m) => `【${m.name}】${m.text}`)
            .join("\n\n");
          const jText = `对话记录（第 ${r} 轮结束）：\n${history}\n\n请判定：如果认为对话还有新内容可聊，回复以「继续」开头并补充一句点评；如果应该收尾，回复以「结束」开头并给出最终结语（不超过 150 字）。`;
          const verdict = await this._promptForText(judgeSession, jText, run, node, judge.name || "主持人", r);
          transcript.push({ name: judge.name || "主持人", text: verdict, round: r });
          if (verdict.includes("结束") || verdict.startsWith("结束")) {
            break;
          }
        }
      }

      const output =
        `【圆桌会议】话题：${topic}\n（${participants.length} 位参与者 · 实际 ${actual} 轮 · ${stopReason}）\n\n` +
        transcript
          .map((m) => `【${m.name}】第 ${m.round} 轮\n${m.text}`)
          .join("\n\n---\n\n");
      return { transcript: { type: "text", text: output } };
    } finally {
      for (const s of sessions) {
        try {
          s.session.dispose();
        } catch {
          /* ignore */
        }
      }
      if (judgeSession) {
        try {
          judgeSession.dispose();
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** 单次发言：向会话发提示并取回完整回复文本 */
  async _promptForText(session, text, run, node, name, round) {
    let acc = "";
    const handler = (ev) => {
      if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
        acc += ev.assistantMessageEvent.delta;
      }
    };
    const unsub = session.subscribe(handler);
    try {
      await session.prompt(text, { streamingBehavior: undefined });
    } finally {
      unsub?.();
      // 从消息里取最后一个助手回复作为本轮发言
      const msgs = session.messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "assistant") {
          const blocks = msgs[i].content || [];
          const t = blocks
            .filter((b) => b?.type === "text")
            .map((b) => b.text || "")
            .join("");
          if (t.trim()) {
            acc = t;
            break;
          }
        }
      }
      this._emitNode(run, node.id, node, "node-update", {
        text: `${name}（第 ${round} 轮）：${acc.slice(-160)}`,
      });
    }
    return acc.trim() || "（本轮未发言）";
  }

  async _runAgent(run, node, inputs, decl) {
    const cfg = node.config || {};
    const systemPrompt =
      cfg.systemPrompt || decl.systemPrompt || "你是 Pi 节点系统中的智能体节点，根据输入完成任务。";
    const cwd = this.cwd;

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: () => systemPrompt,
    });
    await loader.reload();

    const model =
      cfg.model?.provider && cfg.model?.id
        ? this.modelRuntime.getModel(cfg.model.provider, cfg.model.id)
        : undefined;

    const settingsManager = SettingsManager.inMemory(
      cfg.maxContext
        ? { compaction: { enabled: true, thresholdTokens: cfg.maxContext } }
        : {}
    );

    const result = await createAgentSession({
      cwd,
      agentDir: getAgentDir(),
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
      model,
      thinkingLevel: cfg.thinkingLevel,
      tools: cfg.tools || decl.tools || DEFAULT_AGENT_TOOLS,
      customTools: this.downloadTool ? [this.downloadTool] : [],
    });
    const session = result.session;

    const ctrl = new AbortController();
    run.abortControllers.add(ctrl);
    const onAbort = () => session.abort().catch(() => {});
    ctrl.signal.addEventListener("abort", onAbort, { once: true });

    let text = "";
    let lastEmit = 0;
    session.subscribe((ev) => {
      if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
        text += ev.assistantMessageEvent.delta;
        const now = Date.now();
        if (now - lastEmit > 300 || text.length % 400 < 40) {
          lastEmit = now;
          this._emitNode(run, node.id, node, "node-update", {
            text: text.slice(-MAX_PROGRESS_TEXT),
          });
        }
      }
    });

    try {
      const { text: inputText, images } = await buildInputMessage(inputs, node);
      await session.prompt(inputText, {
        streamingBehavior: undefined,
        images: images?.length ? images : undefined,
      });
      // 最终回答：取最后一个含文本的助手消息，排除思考块与过程叙述（工具调用中间的日志）
      let reply = text.trim() || "(无输出)";
      const msgs = session.messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "assistant") {
          const t = (msgs[i].content || [])
            .filter((b) => b?.type === "text")
            .map((b) => b.text || "")
            .join("")
            .trim();
          if (t) {
            reply = t;
            break;
          }
        }
      }
      // 传导模式：把上游对话记录 + 本轮发言一起传给下游，实现跨节点多轮传导
      if (cfg.carryContext) {
        return {
          text: {
            type: "text",
            text: `${inputText}\n\n【${node.title || "本轮"}】\n${reply}`,
          },
        };
      }
      return { text: { type: "text", text: reply } };
    } finally {
      ctrl.signal.removeEventListener("abort", onAbort);
      run.abortControllers.delete(ctrl);
      try {
        session.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  _emitNode(run, nodeId, node, type, extra) {
    this.emit(type, {
      runId: run.id,
      blueprintId: run.blueprintId,
      name: run.name,
      nodeId,
      nodeType: node?.type,
      nodeTitle: node?.title,
      ...extra,
    });
    this.emit("node-event", {
      type,
      runId: run.id,
      blueprintId: run.blueprintId,
      name: run.name,
      nodeId,
      nodeType: node?.type,
      nodeTitle: node?.title,
      ...extra,
    });
  }
}

/* ---------------- 工具函数 ---------------- */

async function buildInputMessage(inputs, node) {
  const parts = [];
  const imageContent = [];
  const pushValue = async (portName, value) => {
    if (!value) return;
    if (value.type === "image" && value.path) {
      parts.push(`### 输入「${portName}」（图片路径）\n${value.path}`);
      try {
        const st = await stat(value.path);
        if (st.size > 0 && st.size <= MAX_IMAGE_BYTES) {
          const buf = await readFile(value.path);
          const ext = path.extname(value.path).toLowerCase();
          const mediaType =
            ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".gif" ? "image/gif" : "image/png";
          imageContent.push({ type: "image", source: { type: "base64", mediaType, data: buf.toString("base64") } });
        }
      } catch {
        /* 图片读取失败则只给路径 */
      }
    } else if (value.type === "path" || value.type === "file") {
      parts.push(`### 输入「${portName}」（${value.type}路径）\n${value.path || value.text || ""}`);
    } else {
      parts.push(`### 输入「${portName}」\n${valueToText(value)}`);
    }
  };
  for (const [portName, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      for (const v of value) await pushValue(portName, v);
    } else {
      await pushValue(portName, value);
    }
  }
  let message = parts.join("\n\n") || "(空输入)";
  if (node.title) message = `（节点「${node.title}」收到的输入）\n` + message;
  return { text: message, images: imageContent };
}

function valueToText(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v.type === "fact") {
    return [
      `事实：${v.claim || ""}`,
      v.data !== undefined ? `数据：${v.data}${v.unit || ""}` : "",
      v.source ? `来源：${v.source}${v.date ? `（${v.date}）` : ""}` : "",
      v.confidence ? `置信度：${v.confidence}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (v.type === "searchresult") {
    return `${v.title || ""}\n${v.url || ""}\n${v.snippet || ""}`;
  }
  return v.text || v.path || JSON.stringify(v);
}

function stringifyValue(v) {
  if (!v) return "";
  const text = Object.values(v)[0];
  return valueToText(text);
}

function normalizeCustomOutput(res, def) {
  const out = {};
  for (const port of def.outputs) {
    const v = res?.[port.name];
    if (v === undefined || v === null) continue;
    out[port.name] = typeof v === "string" ? { type: port.type || "text", text: v } : v;
  }
  if (!Object.keys(out).length) {
    out[def.outputs[0]?.name || "out"] = { type: "text", text: "" };
  }
  return out;
}

function summarizeResults(run) {
  const res = {};
  for (const [nodeId, r] of Object.entries(run.results)) {
    const node = run.graph.nodes.find((n) => n.id === nodeId);
    res[node?.title || nodeId] = r;
  }
  return res;
}
