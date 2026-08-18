/**
 * 总结管理器：自动总结"今天干了些什么"
 * - 配置（开关 + 频率）与历史总结持久化在 ~/.pi/summary/summary.json
 * - 到点自动调用独立 Pi 会话生成今日小结（不打断当前聊天会话）
 * - 数据由外部注入的 collectToday() 回调提供（会话历史 + 下载 + 蓝图运行）
 */
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const SUMMARY_DIR = path.join(os.homedir(), ".pi", "summary");
const SUMMARY_FILE = path.join(SUMMARY_DIR, "summary.json");
const DEFAULT_CONFIG = { enabled: false, frequencyMs: 4 * 3600 * 1000, strength: "medium" };
const MAX_ITEMS = 30;
const CHECK_MAX = 30 * 60 * 1000; // 定时检查周期上限（保证触发精度）

/** 总结强度：控制详细程度 + 思考级别 */
export const SUMMARY_STRENGTHS = {
  brief: {
    label: "简短",
    thinkingLevel: "off",
    prompt: `你是一个「今日工作小结」生成器。用户会给你今天的活动记录（对话、下载、蓝图运行等）。

请用简体中文写一篇非常简短的小结，要求：
1. 只用一句话概括今天主要做了什么，再列出最多 5 个要点（每个不超过 12 字）；
2. 只基于给定记录，不要编造；
3. 总长度控制在 80 字以内；
4. 以 Markdown 输出，标题用 ##，要点用 - 。`,
  },
  medium: {
    label: "标准",
    thinkingLevel: "low",
    prompt: `你是一个「今日工作小结」生成器。用户会给你今天的活动记录（对话、下载、蓝图运行等）。

请用简体中文写一篇简洁、有条理的今日小结，要求：
1. 结构：先一段「今日概览」（一两句话总述），再用分类要点（对话/下载/蓝图/其他）列出关键内容；
2. 只基于给定记录，不要编造不存在的细节；某类没记录就跳过；
3. 语言精炼，要点式呈现，长度控制在 300 字以内；
4. 以 Markdown 输出，标题用 ##，要点用 - 。

不要输出与总结无关的内容。`,
  },
  detailed: {
    label: "详细",
    thinkingLevel: "high",
    prompt: `你是一个「今日工作小结」生成器。用户会给你今天的活动记录（对话、下载、蓝图运行等）。

请用简体中文写一篇详尽的今日小结，要求：
1. 结构：先一段「今日概览」，再按「对话 / 下载 / 蓝图 / 其他」分类展开，保留关键数据（消息数、目录、文件大小、任务状态、蓝图节点数等）；
2. 每个分类下用要点列出，尽量保留原始细节；
3. 最后加一段「小结与建议」：概括今日进展，并给出 1-2 条可执行的后续建议；
4. 只基于给定记录，不要编造；某类没记录就跳过；
5. 长度控制在 500-800 字；
6. 以 Markdown 输出，标题用 ##，要点用 - 。

不要输出与总结无关的内容。`,
  },
};

export class SummaryManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.modelRuntime  ModelRuntime 实例（取默认模型）
   * @param {() => string} opts.cwd     当前工作目录 getter
   * @param {() => Promise<string>} opts.collectToday 收集今日活动文本
   */
  constructor({ modelRuntime, cwd, collectToday }) {
    super();
    this.modelRuntime = modelRuntime;
    this.getCwd = typeof cwd === "function" ? cwd : () => cwd;
    this.collectToday = collectToday;
    this.config = { ...DEFAULT_CONFIG };
    this.items = [];
    this.running = false;
    this.timer = null;
    this.bootCheck = null;
  }

  async init() {
    await this._load();
    this._schedule();
    // 启动约 1 分钟后检查一次（若已到点且开启）
    this.bootCheck = setTimeout(() => this._maybeAuto(), 60_000);
    this.bootCheck?.unref?.();
  }

  /* ---------- 持久化 ---------- */

  async _load() {
    try {
      const raw = await readFile(SUMMARY_FILE, "utf-8");
      const data = JSON.parse(raw);
      this.config = { ...DEFAULT_CONFIG, ...(data.config || {}) };
      this.items = Array.isArray(data.items) ? data.items : [];
    } catch {
      /* 首次运行或文件损坏 */
    }
  }

  async _save() {
    await mkdir(SUMMARY_DIR, { recursive: true });
    await writeFile(
      SUMMARY_FILE,
      JSON.stringify({ config: this.config, items: this.items }, null, 2),
      "utf-8"
    );
  }

  /* ---------- 状态 / 配置 ---------- */

  getState() {
    return {
      config: { ...this.config },
      running: this.running,
      items: [...this.items]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((i) => ({ ...i })),
    };
  }

  _emit() {
    this.emit("update", this.getState());
  }

  async setConfig(patch) {
    if (typeof patch?.enabled === "boolean") this.config.enabled = patch.enabled;
    if (
      typeof patch?.frequencyMs === "number" &&
      patch.frequencyMs >= 15 * 60 * 1000
    ) {
      this.config.frequencyMs = patch.frequencyMs;
    }
    if (typeof patch?.strength === "string" && SUMMARY_STRENGTHS[patch.strength]) {
      this.config.strength = patch.strength;
    }
    await this._save();
    this._schedule();
    this._emit();
    return this.getState();
  }

  async deleteItem(id) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length !== before) {
      await this._save();
      this._emit();
      return { ok: true };
    }
    return { ok: false, error: "未找到该总结" };
  }

  /* ---------- 定时器 ---------- */

  _schedule() {
    clearInterval(this.timer);
    this.timer = null;
    if (!this.config.enabled) return;
    const check = Math.min(this.config.frequencyMs, CHECK_MAX);
    this.timer = setInterval(() => this._maybeAuto(), check);
    this.timer.unref?.();
  }

  async _maybeAuto() {
    if (!this.config.enabled || this.running) return;
    const lastAuto = this.items
      .filter((i) => i.source === "auto")
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const lastAt = lastAuto?.createdAt || 0;
    if (Date.now() - lastAt >= this.config.frequencyMs) {
      await this.generate("auto");
    }
  }

  /* ---------- 生成总结 ---------- */

  /** 生成一篇总结。source: "auto"|"manual"；strength 缺省用配置值 */
  async generate(source = "manual", strength = null) {
    if (this.running) return { ok: false, error: "已有总结正在生成中" };
    const level = SUMMARY_STRENGTHS[strength] ? strength : this.config.strength;
    this.running = true;
    this.emit("status", { running: true });
    try {
      const data = await this.collectToday();
      const content = await this._askPi(data, level);
      const item = {
        id: `s${Date.now()}`,
        createdAt: Date.now(),
        source,
        strength: level,
        content: content || "（无内容）",
      };
      this.items.push(item);
      if (this.items.length > MAX_ITEMS) this.items = this.items.slice(-MAX_ITEMS);
      await this._save();
      this._emit();
      return { ok: true, item };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      this.running = false;
      this.emit("status", { running: false });
      this._emit();
    }
  }

  /** 用独立 AgentSession 生成总结（不替换/不打断当前会话） */
  async _askPi(dataText, strength) {
    const def = SUMMARY_STRENGTHS[strength] || SUMMARY_STRENGTHS.medium;
    const cwd = this.getCwd();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: () => def.prompt,
    });
    await loader.reload();

    const result = await createAgentSession({
      cwd,
      agentDir: getAgentDir(),
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      tools: [],
      thinkingLevel: def.thinkingLevel,
    });
    const session = result.session;

    let text = "";
    const unsub = session.subscribe((ev) => {
      if (
        ev.type === "message_update" &&
        ev.assistantMessageEvent.type === "text_delta"
      ) {
        text += ev.assistantMessageEvent.delta;
      }
    });

    try {
      await session.prompt(dataText, { streamingBehavior: undefined });
      return text.trim() || "(无输出)";
    } finally {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      try {
        session.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  dispose() {
    clearInterval(this.timer);
    clearTimeout(this.bootCheck);
    this.timer = null;
    this.bootCheck = null;
  }
}
