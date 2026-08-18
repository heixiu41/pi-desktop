import { app, BrowserWindow, ipcMain, dialog, shell, screen } from "electron";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { unlink, rename, mkdir, readdir, open, stat, writeFile, copyFile, readFile } from "node:fs/promises";
import { createInterface as readlineCreateInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { DownloadManager } from "./download-manager.js";
import { createDownloadTool } from "./download-tool.js";
import { fmtBytes } from "./format.js";
import { NodeRegistry } from "./nodes/node-registry.js";
import { BlueprintManager } from "./nodes/blueprint-manager.js";
import { createNodeTools } from "./nodes/ai-tools.js";
import { createVisionTool } from "./nodes/vision-tool.js";
import { buildNodeSystemPrompt, buildRagPrompt } from "./nodes/system-prompt.js";
import { RagEngine } from "./rag-engine.js";
import { createKnowledgeTools } from "./nodes/kb-tools.js";
import { SummaryManager } from "./summary.js";
import { ensurePiConfig } from "./auto-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 虚拟机/远程桌面环境下禁用硬件加速，避免窗口白屏
app.disableHardwareAcceleration();

let mainWindow = null;
let dockWindow = null;
let nodeWindow = null;
let splashWindow = null; // 加载窗口（启动放大动画）
let modelRuntime = null;
let setupPromise = null;

// 节点系统
let nodeRegistry = null;
let blueprintManager = null;
let nodeAiTools = [];
let ragEngine = null;
let kbTools = [];
let currentImagePath = null; // 用户最近上传的图片（供 vision_analyze 工具使用）
let customSystemPrompt = ""; // 用户自定义系统提示词（UI 可编辑，叠加在节点系统提示词之后）
const CUSTOM_PROMPT_FILE = path.join(os.homedir(), ".pi", "system-prompt.txt");
const NODE_DOCS_SRC = path.join(__dirname, "nodes-docs");
const NODE_DOCS_DEST = path.join(os.homedir(), ".pi", "nodes-docs");

// 今日总结
let summaryManager = null;

const current = {
  session: null,
  cwd: os.homedir(),
  loader: null,
};

// ---------- 下载管理 ----------

const downloadManager = new DownloadManager({
  dir: path.join(os.homedir(), "Downloads"),
});
const downloadTool = createDownloadTool(downloadManager);

const DL_NOTICE = {
  started: { text: (t) => `⬇ 开始下载：${t.filename}`, cls: "" },
  completed: {
    text: (t) => `✓ 下载完成：${t.filename}（${fmtBytes(t.received)}）→ ${t.dir}`,
    cls: "success",
  },
  failed: {
    text: (t) => `✗ 下载失败：${t.filename}（${t.error || "未知错误"}）`,
    cls: "error",
  },
  paused: { text: (t) => `⏸ 已暂停：${t.filename}`, cls: "" },
  stopped: { text: (t) => `⛔ 已停止：${t.filename}`, cls: "" },
};

// 手动下载的完成/失败在聊天区显示通知；Pi 触发的下载以工具卡片展示，不重复通知
for (const event of Object.keys(DL_NOTICE)) {
  downloadManager.on(event, (task) => {
    if (task.source !== "manual") return;
    broadcast("download:chat-notice", {
      text: DL_NOTICE[event].text(task),
      cls: DL_NOTICE[event].cls,
    });
  });
}
downloadManager.on("change", () => {
  broadcast("download:list", { tasks: downloadManager.list() });
});

// ---------- 窗口消息 ----------

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/** 广播到主窗口 + 独立下载窗口 */
function broadcast(channel, data) {
  send(channel, data);
  if (dockWindow && !dockWindow.isDestroyed()) {
    dockWindow.webContents.send(channel, data);
  }
}

function sessionError(message) {
  send("session:error", { message });
}

// ---------- 消息序列化 ----------

/** 提取消息中的纯文本块（过滤 toolCall/thinking 等非文本块） */
function textOf(blocks) {
  return (blocks || [])
    .filter((b) => !b || typeof b === "string" || b.type === "text")
    .map((b) => (typeof b === "string" ? b : b?.text || ""))
    .join("\n");
}

function serializeAssistantBlock(block) {
  if (block.type === "toolCall") {
    return {
      type: "toolCall",
      id: block.id,
      name: block.name,
      arguments:
        typeof block.arguments === "string"
          ? block.arguments
          : JSON.stringify(block.arguments || {}, null, 2),
    };
  }
  if (block.type === "thinking") {
    return { type: "thinking", text: block.thinking || "" };
  }
  return { type: "text", text: block.text || "" };
}

/** 把 AgentMessage 序列化成渲染进程用的简单结构 */
function serializeMessages(messages) {
  return (messages || []).map((message) => {
    if (message.role === "user") {
      const content = Array.isArray(message.content)
        ? message.content
        : [message.content];
      return {
        role: message.role,
        timestamp: message.timestamp,
        content: textOf(content),
      };
    }
    if (message.role === "assistant") {
      return {
        role: message.role,
        timestamp: message.timestamp,
        content: (message.content || []).map(serializeAssistantBlock),
      };
    }
    if (message.role === "toolResult") {
      return {
        role: message.role,
        timestamp: message.timestamp,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        isError: message.isError,
        content: textOf(message.content),
      };
    }
    return { role: message.role, timestamp: message.timestamp, content: "" };
  });
}

function serializeEventMessage(message) {
  return serializeMessages([message])[0];
}

// ---------- 会话事件 ----------

// 每个会话的 UI 推送订阅（detach 后台时解除）
const sessionUiUnsubs = new Map(); // session -> unsubscribe

// 被切到后台继续执行的会话：key = sessionFile（或 sessionId）
const detachedSessions = new Map(); // key -> { session, doneUnsub }

function subscribeSession(session) {
  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const e = event.assistantMessageEvent;
        if (e.type === "text_delta") {
          send("session:delta", { kind: "text", delta: e.delta });
        } else if (e.type === "thinking_delta") {
          send("session:delta", { kind: "thinking", delta: e.delta });
        } else if (e.type === "toolcall_delta") {
          send("session:delta", { kind: "toolcall", delta: e.delta });
        }
        break;
      }
      case "message_end":
        send("session:message-end", {
          message: serializeEventMessage(event.message),
        });
        break;
      case "tool_execution_start":
        send("session:tool-start", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_update":
        send("session:tool-update", {
          toolCallId: event.toolCallId,
          partial: event.partialResult?.content?.[0]?.text ?? "",
        });
        break;
      case "tool_execution_end":
        send("session:tool-end", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result?.content?.[0]?.text ?? "",
          isError: !!event.isError,
        });
        break;
      case "agent_start":
        send("session:agent-start", {});
        break;
      case "agent_settled":
        send("session:agent-settled", {});
        break;
      case "queue_update":
        send("session:queue", {
          steering: event.steering,
          followUp: event.followUp,
        });
        break;
      case "compaction_start":
        send("session:notice", { kind: "compaction", text: "正在压缩上下文…" });
        break;
      case "compaction_end":
        send("session:notice", { kind: "compaction-end", text: "" });
        break;
      case "auto_retry_start":
        send("session:notice", {
          kind: "retry",
          text: `自动重试中 (${event.attempt}/${event.maxAttempts})…`,
        });
        break;
      case "auto_retry_end":
        send("session:notice", { kind: "retry-end", text: "" });
        break;
      case "extension_error":
        send("session:error", { message: `扩展错误: ${event.error}` });
        break;
      default:
        break;
    }
  });
  sessionUiUnsubs.set(session, unsubscribe);
  return unsubscribe;
}

/** 解除某会话向 UI 推送流式事件（后台继续时用） */
function unsubscribeSessionUi(session) {
  const unsub = sessionUiUnsubs.get(session);
  if (unsub) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
    sessionUiUnsubs.delete(session);
  }
}

/**
 * 切换会话时处理旧会话：
 * - 正在执行 → 解除 UI 推送，放到后台继续跑完（不截断，消息会自动持久化到会话文件）
 * - 空闲     → 直接释放
 */
function releaseCurrentSession() {
  if (!current.session) return;
  const session = current.session;
  current.session = null;
  if (session.isStreaming) {
    unsubscribeSessionUi(session);
    const key = session.sessionFile || `__detached_${session.sessionId}`;
    if (detachedSessions.has(key)) return;
    send("app:notice", {
      text: "⏸ 已切换到其他会话，原对话在后台继续执行…",
      cls: "",
    });
    // 后台完成：通知 + 自动释放资源
    const doneUnsub = session.subscribe((ev) => {
      if (ev.type === "agent_settled") {
        doneUnsub();
        detachedSessions.delete(key);
        try {
          session.dispose();
        } catch {
          /* ignore */
        }
        send("app:notice", {
          text: `✓ 后台对话已执行完成，切回该会话即可查看结果`,
          cls: "success",
        });
      }
    });
    detachedSessions.set(key, { session, doneUnsub });
  } else {
    try {
      session.dispose();
    } catch {
      /* ignore */
    }
  }
}

// ---------- 会话生命周期 ----------

async function createPiSession(cwd, sessionFile) {
  // 旧会话：正在执行则后台继续，空闲则释放（不再截断正在进行的对话）
  releaseCurrentSession();

  // 目标会话正在后台执行 → 复用同一实例（切回可继续看到流式进度）
  if (sessionFile && detachedSessions.has(sessionFile)) {
    const d = detachedSessions.get(sessionFile);
    detachedSessions.delete(sessionFile);
    try {
      d.doneUnsub();
    } catch {
      /* ignore */
    }
    current.session = d.session;
    subscribeSession(d.session);
    return d.session;
  }

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    systemPromptOverride: (base) =>
      (base || "") +
      "\n" +
      buildNodeSystemPrompt({
        docsDir: NODE_DOCS_DEST,
        blueprintsDir: blueprintManager?.blueprintsDir() || "~/.pi/blueprints",
      }) +
      "\n" +
      buildRagPrompt() +
      (customSystemPrompt
        ? "\n\n## 用户自定义提示词（UI 设置）\n" + customSystemPrompt
        : ""),
  });
  await loader.reload();
  current.loader = loader;

  const result = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    resourceLoader: loader,
    sessionManager: sessionFile
      ? SessionManager.open(sessionFile)
      : SessionManager.create(cwd),
    customTools: [downloadTool, ...nodeAiTools, ...kbTools, createVisionTool({ getImagePath: () => currentImagePath })],
    tools: [
      "read", "bash", "edit", "write", "download",
      // 自定义工具（必须出现在 allowedToolNames，否则被 _refreshToolRegistry 过滤）
      "view_node_library", "create_node", "list_blueprints", "run_blueprint", "view_blueprint_result",
      "search_knowledge", "import_knowledge",
      "vision_analyze",
    ],
  });

  current.session = result.session;
  subscribeSession(result.session);
  return result.session;
}

function sessionSnapshot() {
  const session = current.session;
  return {
    cwd: current.cwd,
    modelName: session?.model?.name ?? session?.model?.id ?? "未配置",
    modelProvider: session?.model?.provider ?? "",
    thinkingLevel: session?.thinkingLevel ?? "",
    isStreaming: !!session?.isStreaming,
    sessionFile: session?.sessionFile ?? null,
    messages: serializeMessages(session?.messages),
  };
}

function sendInit() {
  send("session:init", sessionSnapshot());
}

// ---------- 今日总结：数据收集 ----------

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const fmtClock = (t) =>
  new Date(t).toLocaleTimeString("zh-CN", { hour12: false });

/** 汇总今天的活动：会话历史 + 下载 + 蓝图运行/保存 */
async function collectTodayData() {
  const start = startOfToday();
  const lines = [];

  // 1) 今日会话历史
  try {
    const all = await SessionManager.listAll();
    const today = all
      .filter((s) => s.modified >= start || s.created >= start)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, 30);
    if (today.length) {
      lines.push("## 今日对话");
      for (const s of today) {
        const title = (s.firstMessage || s.name || "（空会话）")
          .replace(/\s+/g, " ")
          .slice(0, 80);
        lines.push(
          `- [${fmtClock(s.modified)}] ${title}（${s.messageCount} 条消息 · ${s.cwd || "?"}）`
        );
      }
    }
  } catch {
    /* 忽略 */
  }

  // 2) 今日下载
  try {
    const dls = downloadManager
      .list()
      .filter((t) => (t.createdAt || 0) >= start || (t.updatedAt || 0) >= start);
    if (dls.length) {
      lines.push("## 今日下载");
      for (const t of dls) {
        const size = t.total
          ? `${fmtBytes(t.received)} / ${fmtBytes(t.total)}`
          : fmtBytes(t.received);
        lines.push(`- ${t.filename}：${t.status}（${size}）`);
      }
    }
  } catch {
    /* 忽略 */
  }

  // 3) 今日蓝图运行（本次进程内记录）
  try {
    const runs = blueprintManager?.runs
      ? [...blueprintManager.runs.values()].filter((r) => (r.startedAt || 0) >= start)
      : [];
    if (runs.length) {
      lines.push("## 今日蓝图运行");
      for (const r of runs) {
        const done = [...(r.nodes?.values() || [])].filter(
          (x) => x.status === "done"
        ).length;
        const st =
          r.status === "done"
            ? "完成"
            : r.status === "error"
              ? "出错"
              : r.status === "aborted"
                ? "中止"
                : "运行中";
        lines.push(`- 「${r.name}」${st}（${r.nodes?.size || 0} 节点，完成 ${done}）`);
      }
    }
    const todaySaved = (blueprintManager?.blueprintList?.() || []).filter(
      (b) => (b.modified || 0) >= start
    );
    if (todaySaved.length) {
      lines.push("## 今日保存的蓝图");
      for (const b of todaySaved) lines.push(`- ${b.name}`);
    }
  } catch {
    /* 忽略 */
  }

  return lines.length ? lines.join("\n") : "今天还没有任何活动记录。";
}

// ---------- IPC：今日总结 ----------

ipcMain.handle("summary:get-state", () =>
  summaryManager ? summaryManager.getState() : { config: { enabled: false }, items: [], running: false }
);

ipcMain.handle("summary:set-config", (_e, patch) => {
  if (!summaryManager) return { config: { enabled: false }, items: [], running: false };
  return summaryManager.setConfig(patch || {});
});

ipcMain.handle("summary:run-now", () =>
  summaryManager ? summaryManager.generate("manual") : { ok: false, error: "总结模块未就绪" }
);

ipcMain.handle("summary:delete", (_e, id) =>
  summaryManager ? summaryManager.deleteItem(id) : { ok: false, error: "总结模块未就绪" }
);

async function setup() {
  // 🔧 自动检测 + 自动配置 Pi 环境（新电脑免手动配置；auth.json 走安全三路：已有配置/环境变量/占位提示）
  splashStatus("正在检测 Pi 环境…");
  try {
    const autoCfg = await ensurePiConfig({
      templatesDir: path.join(__dirname, "bootstrap", "agent"),
    });
    console.log("[auto-config] " + autoCfg.report);
    if (autoCfg.needManualConfig) {
      send("app:notice", {
        text: `⚠️ 未检测到 API Key：请设置环境变量 DEEPSEEK_API_KEY 后重启（推荐），或编辑 ~/.pi/agent/auth.json 填入 Key`,
        cls: "error",
      });
    } else if (autoCfg.actions.length > 0) {
      send("app:notice", { text: `🔧 ${autoCfg.report}`, cls: "success" });
    } else if (!autoCfg.valid) {
      send("app:notice", {
        text: `⚠️ ${autoCfg.report}`, cls: "error",
      });
    }
  } catch (err) {
    console.error("[auto-config] 执行失败:", err);
  }
  splashStatus("正在初始化模型…");
  modelRuntime = await ModelRuntime.create();
  splashStatus("正在同步节点说明书…");
  await bootstrapNodeDocs();
  splashStatus("正在加载节点系统…");
  nodeRegistry = new NodeRegistry({ projectDir: current.cwd });
  await nodeRegistry.init();

  // 知识库（RAG）先建，蓝图管理器需要它
  splashStatus("正在初始化知识库…");
  ragEngine = new RagEngine({ downloadManager });
  await ragEngine.init();
  kbTools = createKnowledgeTools({ ragEngine });
  ragEngine.on("status", () => send("kb:status", ragEngine.status()));
  ragEngine.on("change", () => {
    send("kb:list", { docs: ragEngine.listDocs() });
    send("kb:status", ragEngine.status());
  });

  splashStatus("正在加载蓝图与工具…");
  blueprintManager = new BlueprintManager({
    registry: nodeRegistry,
    modelRuntime,
    cwd: current.cwd,
    downloadTool,
    ragEngine,
  });
  await blueprintManager.init();
  nodeAiTools = createNodeTools({ registry: nodeRegistry, blueprintManager });

  // 今日总结
  splashStatus("正在准备今日总结…");
  summaryManager = new SummaryManager({
    modelRuntime,
    cwd: () => current.cwd,
    collectToday: collectTodayData,
  });
  summaryManager.on("update", (state) => send("summary:update", state));
  summaryManager.on("status", (s) => send("summary:status", s));
  await summaryManager.init();

  // 节点事件 → 画布窗口 / 聊天通知 / 主页
  blueprintManager.on("blueprints", () =>
    sendNode("node:blueprints", {
      presets: blueprintManager.presetList(),
      saved: blueprintManager.blueprintList(),
    })
  );
  blueprintManager.on("node-event", (ev) => {
    sendNode("node:event", ev);
    throttleHomeRuns();
  });
  blueprintManager.on("run-start", () => sendHomeRuns());
  blueprintManager.on("run-end", (run) => {
    sendHomeRuns();
    const statusText =
      run.status === "done"
        ? "运行完成"
        : run.status === "aborted"
          ? "已中止"
          : `运行出错（${run.error || ""}）`;
    send("session:blueprint", {
      text: `🧩 蓝图「${run.name}」${statusText}`,
      cls: run.status === "done" ? "success" : run.status === "aborted" ? "" : "error",
    });
  });
  nodeRegistry.on("change", (nodes) => sendNode("node:registry", { nodes }));

  splashStatus("正在创建会话…");
  await createPiSession(current.cwd);
  splashStatus("就绪 ✓", "done");
}

ipcMain.on("pi:ready", async () => {
  try {
    await setupPromise;
    sendInit();
    sendHistory();
  } catch {
    /* 错误已在 setup 中上报 */
  }
});

// ---------- IPC：历史记录 ----------

// 历史会话缓存（path -> SessionInfo），供加载时取会话 cwd 等
let historyCache = new Map();

// 归档目录：放在 sessions/ 之外，避免被 SessionManager.listAll 扫到
const SESSIONS_DIR = path.join(getAgentDir(), "sessions");
const ARCHIVE_DIR = path.join(getAgentDir(), "sessions-archive");

function encodeSessionDir(cwd) {
  return `--${String(cwd || "").replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** 读取会话文件头部（第一行 JSON） */
async function readSessionHeader(filePath) {
  try {
    const handle = await open(filePath, "r");
    try {
      let line = "";
      for await (const chunk of handle.createReadStream({ start: 0, end: 8192 })) {
        line += chunk;
        if (line.includes("\n")) break;
        if (line.length > 4096) break;
      }
      const firstLine = line.split("\n")[0];
      const o = JSON.parse(firstLine);
      return {
        id: o.id,
        cwd: o.cwd || "",
        name: o.name || "",
        timestamp: o.timestamp || "",
      };
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

/** 轻量解析归档会话：消息数 + 首条用户消息 + 最近修改时间 */
async function lightSessionInfo(filePath) {
  const header = await readSessionHeader(filePath);
  if (!header) return null;
  let messageCount = 0;
  let firstMessage = "";
  let lastTs = header.timestamp ? Date.parse(header.timestamp) || 0 : 0;
  try {
    const st = await stat(filePath);
    lastTs = Math.max(lastTs, st.mtimeMs);
  } catch {
    /* ignore */
  }
  try {
    const handle = await open(filePath, "r");
    try {
      const rl = readlineCreateInterface({ input: handle.createReadStream() });
      for await (const line of rl) {
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (o.type !== "message") {
          if (o.timestamp) {
            const t = Date.parse(o.timestamp);
            if (!isNaN(t)) lastTs = Math.max(lastTs, t);
          }
          continue;
        }
        messageCount++;
        if (o.timestamp) {
          const t = Date.parse(o.timestamp);
          if (!isNaN(t)) lastTs = Math.max(lastTs, t);
        }
        if (!firstMessage && o.message?.role === "user") {
          const c = o.message.content;
          firstMessage =
            typeof c === "string"
              ? c
              : Array.isArray(c)
                ? c.filter((b) => b?.type === "text").map((b) => b.text).join("\n")
                : "";
        }
      }
    } finally {
      handle.close();
    }
  } catch {
    /* 解析失败仍返回头部信息 */
  }
  return {
    path: filePath,
    id: header.id,
    name: header.name || "",
    cwd: header.cwd || "",
    created: header.timestamp || "",
    modified: new Date(lastTs).toISOString(),
    messageCount,
    firstMessage,
  };
}

async function listArchived() {
  try {
    const files = await readdir(ARCHIVE_DIR);
    const list = [];
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const info = await lightSessionInfo(path.join(ARCHIVE_DIR, f));
      if (info) list.push({ ...info, archived: true, current: false });
    }
    return list.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  } catch {
    return [];
  }
}

async function archiveSession(filePath) {
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const dest = path.join(ARCHIVE_DIR, path.basename(filePath));
  if (dest !== filePath) await rename(filePath, dest);
  return dest;
}

async function restoreSession(archivePath) {
  const header = await readSessionHeader(archivePath);
  if (!header?.cwd) throw new Error("无法读取该会话的工作目录");
  const destDir = path.join(SESSIONS_DIR, encodeSessionDir(header.cwd));
  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(archivePath));
  await rename(archivePath, dest);
  return { path: dest, cwd: header.cwd };
}

function isArchivedPath(p) {
  return p.startsWith(ARCHIVE_DIR + path.sep);
}

async function listSessions() {
  try {
    const all = await SessionManager.listAll();
    const list = all
      .sort((a, b) => b.modified - a.modified)
      .slice(0, 60)
      .map((s) => ({
        path: s.path,
        id: s.id,
        name: s.name || "",
        cwd: s.cwd || "",
        created: s.created.toISOString(),
        modified: s.modified.toISOString(),
        messageCount: s.messageCount,
        firstMessage: s.firstMessage || "",
        current: current.session?.sessionFile === s.path,
      }));
    historyCache = new Map(list.map((i) => [i.path, i]));
    return list;
  } catch (err) {
    console.error("列出历史会话失败:", err);
    return [];
  }
}

function sendHistory() {
  Promise.all([listSessions(), listArchived()]).then(([sessions, archived]) => {
    broadcast("session:history", { sessions, archived });
  });
}

ipcMain.handle("session:history", async () => {
  const [sessions, archived] = await Promise.all([listSessions(), listArchived()]);
  return { sessions, archived };
});

ipcMain.handle("session:load", async (_e, sessionPath) => {
  if (typeof sessionPath !== "string" || !sessionPath.endsWith(".jsonl")) {
    return { ok: false, error: "无效的会话路径" };
  }
  try {
    let targetPath = sessionPath;
    if (isArchivedPath(sessionPath)) {
      // 归档会话：先恢复再加载
      const restored = await restoreSession(sessionPath);
      targetPath = restored.path;
      current.cwd = restored.cwd;
    } else {
      const info = historyCache.get(sessionPath);
      const sessionCwd =
        info?.cwd && existsSync(info.cwd) ? info.cwd : current.cwd;
      current.cwd = sessionCwd;
    }
    await createPiSession(current.cwd, targetPath);
    sendInit();
    sendHistory();
    return { ok: true };
  } catch (err) {
    sessionError(`加载会话失败: ${err?.message ?? err}`);
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle("session:delete", async (_e, sessionPath) => {
  if (typeof sessionPath !== "string" || !sessionPath.endsWith(".jsonl")) {
    return { ok: false, error: "无效的会话路径" };
  }
  if (current.session?.sessionFile === sessionPath) {
    return { ok: false, error: "不能删除当前正在使用的会话" };
  }
  try {
    await unlink(sessionPath);
    historyCache.delete(sessionPath);
    sendHistory();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle("session:archive", async (_e, sessionPath) => {
  if (typeof sessionPath !== "string" || !sessionPath.endsWith(".jsonl")) {
    return { ok: false, error: "无效的会话路径" };
  }
  if (current.session?.sessionFile === sessionPath) {
    return { ok: false, error: "不能归档当前正在使用的会话" };
  }
  try {
    const dest = await archiveSession(sessionPath);
    historyCache.delete(sessionPath);
    sendHistory();
    return { ok: true, archivedPath: dest };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle("session:restore", async (_e, sessionPath) => {
  if (typeof sessionPath !== "string" || !sessionPath.endsWith(".jsonl")) {
    return { ok: false, error: "无效的会话路径" };
  }
  try {
    const restored = await restoreSession(sessionPath);
    sendHistory();
    return { ok: true, path: restored.path, cwd: restored.cwd };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});

// ---------- IPC：会话 ----------

ipcMain.on("pi:send", async (_e, payload) => {
  const session = current.session;
  const text = typeof payload === "string" ? payload : payload?.text;
  const imageData = typeof payload === "object" && payload?.imageData ? String(payload.imageData) : null;
  const aside = typeof payload === "object" && payload?.aside ? String(payload.aside) : null;
  if (!session || typeof text !== "string" || !text.trim()) return;

  // 用户上传图片：保存到临时目录，供 vision_analyze 工具读取
  let hasImage = false;
  if (imageData) {
    const saved = await saveImageAttachment(imageData);
    if (saved) {
      currentImagePath = saved;
      hasImage = true;
    }
  }

  // 上下文旁注：图片提示（引导模型用 vision_analyze 工具）+ 其他 aside，不混入用户文本
  if (hasImage || aside) {
    const hint = hasImage
      ? "用户上传了一张图片。如需查看图片内容，请调用 vision_analyze 工具分析。"
      : "";
    const content = [hint, aside].filter(Boolean).join("\n");
    if (content) {
      try {
        await session.sendCustomMessage(
          { customType: "vision", content, display: null },
          { deliverAs: "nextTurn" }
        );
      } catch (e) {
        /* 旁注失败不影响主消息 */
      }
    }
  }

  send("session:user", { text });
  session
    .prompt(text, {
      streamingBehavior: session.isStreaming ? "steer" : undefined,
    })
    .catch((err) => {
      // 会话可能已被切到后台/释放，只有仍是当前会话才报错
      if (current.session === session) {
        sessionError(`发送失败: ${err?.message ?? err}`);
      }
    });
});

/** 保存 base64 dataURL 图片到 ~/.pi/attachments/，返回文件路径 */
async function saveImageAttachment(dataUrl) {
  try {
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl || "");
    if (!m) return null;
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const dir = path.join(os.homedir(), ".pi", "attachments");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
    await writeFile(file, Buffer.from(m[2], "base64"));
    return file;
  } catch (e) {
    console.error("saveImageAttachment failed", e);
    return null;
  }
}

ipcMain.on("pi:abort", () => {
  current.session?.abort().catch(() => {});
});

ipcMain.on("pi:new-session", async () => {
  try {
    await createPiSession(current.cwd);
    sendInit();
    sendHistory();
  } catch (err) {
    sessionError(`新建会话失败: ${err?.message ?? err}`);
  }
});

ipcMain.handle("pi:pick-cwd", async () => {
  const win = mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: "选择 Pi 的工作目录",
    defaultPath: current.cwd,
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const newCwd = res.filePaths[0];
  try {
    current.cwd = newCwd;
    await createPiSession(newCwd);
    sendInit();
    sendHistory();
    return newCwd;
  } catch (err) {
    sessionError(`切换目录失败: ${err?.message ?? err}`);
    return null;
  }
});

ipcMain.handle("pi:get-available-models", async () => {
  try {
    const models = await modelRuntime.getAvailable();
    return models.map((m) => ({
      provider: m.provider,
      id: m.id,
      name: m.name,
      reasoning: !!m.reasoning,
    }));
  } catch {
    return [];
  }
});

// ---------- API 配置（api:get-state / save-key / test / set-default-model） ----------

/** 掩码显示 API Key（保留头 7 尾 4） */
function maskKey(key) {
  const s = String(key || "");
  if (s.length <= 10) return s.slice(0, 2) + "…" + s.slice(-2);
  return s.slice(0, 7) + "…" + s.slice(-4);
}

/** 安全读 JSON 文件（不存在/解析失败返回 null） */
async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** 模型列表快照（含上下文窗口，供 API 配置页展示） */
async function availableModelsSnapshot() {
  try {
    const models = await modelRuntime.getAvailable();
    return models.map((m) => ({
      provider: m.provider,
      id: m.id,
      name: m.name,
      reasoning: !!m.reasoning,
      contextWindow: m.contextWindow || 0,
    }));
  } catch {
    return [];
  }
}

/** 用给定 Key 实测 provider 连通性（不写入任何配置，调用 OpenAI 兼容 /models 端点） */
async function testProviderConnection(provider, apiKey) {
  // 从 models-store 读取 provider 的 baseUrl；找不到则用 DeepSeek 默认
  let baseUrl = "";
  const store = await readJsonSafe(path.join(getAgentDir(), "models-store.json"));
  baseUrl = store?.[provider]?.models?.[0]?.baseUrl || "";
  if (!baseUrl) baseUrl = "https://api.deepseek.com";
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    const latency = Date.now() - t0;
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const ids = (data?.data || []).map((m) => m.id);
      return { ok: true, latency, models: ids };
    }
    let msg = `HTTP ${res.status}`;
    try {
      const e = await res.json();
      msg = e?.error?.message || msg;
    } catch { /* keep */ }
    return { ok: false, latency, error: msg };
  } catch (err) {
    return { ok: false, latency: Date.now() - t0, error: err?.message || String(err) };
  }
}

/** 读取当前 API 配置完整状态（供配置页展示） */
ipcMain.handle("api:get-state", async () => {
  const agentDir = getAgentDir();
  const auth = await readJsonSafe(path.join(agentDir, "auth.json"));
  const settings = await readJsonSafe(path.join(agentDir, "settings.json"));
  const store = await readJsonSafe(path.join(agentDir, "models-store.json"));
  const entries = Object.entries(auth || {}).filter(([, v]) => v?.key);
  const providerList = Object.keys(store || {}).length
    ? Object.keys(store)
    : entries.map(([p]) => p);
  return {
    providers: providerList,
    authOk: entries.length > 0,
    authProvider: entries[0]?.[0] || "",
    keyMasked: entries[0]?.[1]?.key ? maskKey(entries[0][1].key) : "",
    hasKey: entries.length > 0,
    defaultProvider: settings?.defaultProvider || "",
    defaultModel: settings?.defaultModel || "",
    models: await availableModelsSnapshot(),
    envKeySet: !!(process.env.DEEPSEEK_API_KEY || process.env.PI_API_KEY),
    authPath: path.join(agentDir, "auth.json"),
    settingsPath: path.join(agentDir, "settings.json"),
    modelsPath: path.join(agentDir, "models-store.json"),
  };
});

/** 保存 API Key：写 auth.json → 重建模型运行时 → 刷新当前会话模型 → 广播模型列表 */
ipcMain.handle("api:save-key", async (_e, { provider, key }) => {
  try {
    const p = String(provider || "deepseek").trim() || "deepseek";
    const k = String(key || "").trim();
    if (!k) return { ok: false, error: "API Key 不能为空" };
    const authPath = path.join(getAgentDir(), "auth.json");
    const auth = (await readJsonSafe(authPath)) || {};
    auth[p] = { type: "api_key", key: k };
    await writeFile(authPath, JSON.stringify(auth, null, 2), "utf-8");
    // 重建模型运行时（重新读取 auth）
    modelRuntime = await ModelRuntime.create();
    // 尝试刷新当前会话的模型（新 Key 对新会话必然生效）
    try {
      if (current.session) {
        const settings = await readJsonSafe(path.join(getAgentDir(), "settings.json"));
        const m = settings?.defaultModel;
        const model = m ? modelRuntime.getModel(p, m) || modelRuntime.getModel(settings?.defaultProvider, m) : null;
        if (model) await current.session.setModel(model);
      }
    } catch { /* 会话刷新失败不影响配置保存 */ }
    const models = await availableModelsSnapshot();
    broadcast("session:models", { models });
    send("session:state", sessionSnapshot());
    return { ok: true, models, masked: maskKey(k) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

/** 测试连接：用给定 Key 实测（不保存）；Key 为空时自动用已保存的 Key 或环境变量 */
ipcMain.handle("api:test", async (_e, { provider, key }) => {
  const p = String(provider || "deepseek").trim() || "deepseek";
  let k = String(key || "").trim();
  if (!k) {
    const auth = await readJsonSafe(path.join(getAgentDir(), "auth.json"));
    k = auth?.[p]?.key || "";
  }
  if (!k) k = process.env.DEEPSEEK_API_KEY || process.env.PI_API_KEY || "";
  if (!k) return { ok: false, error: "请先填写 API Key（或先保存 Key）" };
  return testProviderConnection(p, k);
});

/** 读取环境变量中的 API Key（供“从环境变量填入”） */
ipcMain.handle("api:env-key", () => {
  const k = process.env.DEEPSEEK_API_KEY || process.env.PI_API_KEY || "";
  return { set: !!k, key: k };
});

/** 设置默认模型：写 settings.json + 切换当前会话模型 */
ipcMain.handle("api:set-default-model", async (_e, { provider, modelId }) => {
  try {
    const p = String(provider || "").trim();
    const m = String(modelId || "").trim();
    if (!p || !m) return { ok: false, error: "参数不完整" };
    const settingsPath = path.join(getAgentDir(), "settings.json");
    const settings = (await readJsonSafe(settingsPath)) || {};
    settings.defaultProvider = p;
    settings.defaultModel = m;
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    if (current.session) {
      const model = modelRuntime?.getModel(p, m);
      if (model) await current.session.setModel(model);
    }
    send("session:state", sessionSnapshot());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.on("pi:set-model", (_e, { provider, id }) => {
  if (!modelRuntime || !current.session) return;
  try {
    const model = modelRuntime.getModel(provider, id);
    if (!model) {
      sessionError(`找不到模型 ${provider}/${id}`);
      return;
    }
    current.session
      .setModel(model)
      .then(() => send("session:state", sessionSnapshot()))
      .catch((err) => sessionError(`切换模型失败: ${err?.message ?? err}`));
  } catch (err) {
    sessionError(`切换模型失败: ${err?.message ?? err}`);
  }
});

ipcMain.on("pi:set-thinking", (_e, level) => {
  if (!current.session) return;
  try {
    current.session.setThinkingLevel(level);
    send("session:state", sessionSnapshot());
  } catch (err) {
    sessionError(`设置思考级别失败: ${err?.message ?? err}`);
  }
});

ipcMain.handle("pi:get-state", () => sessionSnapshot());

ipcMain.handle("pi:get-system-prompt", async () => {
  if (!customSystemPrompt) {
    try {
      customSystemPrompt = await readFile(CUSTOM_PROMPT_FILE, "utf-8");
    } catch {
      customSystemPrompt = "";
    }
  }
  return customSystemPrompt;
});

ipcMain.handle("pi:set-system-prompt", async (_e, prompt) => {
  customSystemPrompt = String(prompt || "");
  try {
    await writeFile(CUSTOM_PROMPT_FILE, customSystemPrompt, "utf-8");
  } catch {
    /* 持久化失败不影响运行 */
  }
  if (current.loader) {
    await current.loader.reload();
  }
  return { ok: true, prompt: customSystemPrompt };
});

ipcMain.handle("pi:open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    shell.openExternal(url);
  }
});

// ---------- IPC：下载管理 ----------

ipcMain.handle("dl:list", () => ({ tasks: downloadManager.list() }));

ipcMain.handle("dl:add", (_e, opts) => {
  try {
    const task = downloadManager.add({
      url: opts?.url,
      dest: opts?.dest,
      filename: opts?.filename,
    });
    return { ok: true, task: downloadManager.toJSON(task) };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.on("dl:pause", (_e, id) => downloadManager.pause(id));
ipcMain.on("dl:resume", (_e, id) => downloadManager.resume(id));
ipcMain.on("dl:stop", (_e, id) => downloadManager.stop(id));
ipcMain.on("dl:retry", (_e, id) => downloadManager.retry(id));
ipcMain.on("dl:remove", (_e, id) => downloadManager.remove(id));

ipcMain.on("dl:open-folder", (_e, id) => {
  const task = downloadManager.get(id);
  if (!task) return;
  if (task.status === "completed" && task.fullPath) {
    shell.showItemInFolder(task.fullPath);
  } else if (task.dir) {
    shell.openPath(task.dir);
  }
});

ipcMain.handle("dl:pick-dest", async () => {
  const win = mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: "选择下载保存目录",
    defaultPath: downloadManager.defaultDir,
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

// ---------- 下载面板：独立窗口 ----------

function openDockWindow() {
  if (dockWindow && !dockWindow.isDestroyed()) {
    dockWindow.focus();
    return;
  }
  dockWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 320,
    minHeight: 380,
    title: "Pi 下载管理",
    frame: false, // 无边框：用面板头部（app-region: drag）拖拽移动窗口
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  dockWindow.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: { view: "float" },
  });
  // 初始推送一次当前下载列表
  dockWindow.webContents.once("did-finish-load", () => {
    dockWindow.webContents.send("download:list", {
      tasks: downloadManager.list(),
    });
  });
  dockWindow.on("closed", () => {
    dockWindow = null;
    broadcast("dock:unfloat", {});
  });
}

ipcMain.on("dl:float", () => openDockWindow());

ipcMain.on("dl:focus-float", () => {
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.focus();
});

ipcMain.on("dl:minimize", () => {
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.minimize();
});

// ---------- 节点画布窗口 ----------

/** 发送到画布窗口 */
function sendNode(channel, data) {
  if (nodeWindow && !nodeWindow.isDestroyed()) {
    nodeWindow.webContents.send(channel, data);
  }
}

// ---------- 主页：进行中的节点任务 ----------

function activeRunsList() {
  if (!blueprintManager) return [];
  return [...blueprintManager.runs.values()]
    .filter((r) => r.status === "running")
    .map((r) => ({
      runId: r.id,
      name: r.name,
      startedAt: r.startedAt,
      done: [...r.nodes.values()].filter((n) => n.status === "done").length,
      error: [...r.nodes.values()].filter((n) => n.status === "error").length,
      total: r.graph.nodes.length,
      nodes: [...r.nodes.entries()].map(([id, n]) => ({
        id,
        status: n.status,
        title: r.graph.nodes.find((x) => x.id === id)?.title || id,
      })),
    }));
}

function sendHomeRuns() {
  send("home:runs", { runs: activeRunsList() });
}

let homeRunsTimer = null;
function throttleHomeRuns() {
  if (homeRunsTimer) return;
  homeRunsTimer = setTimeout(() => {
    homeRunsTimer = null;
    sendHomeRuns();
  }, 400);
}

ipcMain.handle("home:get-runs", () => ({ runs: activeRunsList() }));

/** 说明书文档：首次启动时同步到 ~/.pi/nodes-docs/ */
async function bootstrapNodeDocs() {
  try {
    await mkdir(NODE_DOCS_DEST, { recursive: true });
    const files = await readdir(NODE_DOCS_SRC);
    for (const f of files) {
      const dest = path.join(NODE_DOCS_DEST, f);
      if (!existsSync(dest)) {
        await copyFile(path.join(NODE_DOCS_SRC, f), dest);
      }
    }
  } catch (err) {
    console.error("同步节点文档失败:", err);
  }
}

function openNodeWindow() {
  if (nodeWindow && !nodeWindow.isDestroyed()) {
    nodeWindow.focus();
    return;
  }
  nodeWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Pi 节点画布",
    backgroundColor: "#0c1015",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  nodeWindow.loadFile(path.join(__dirname, "renderer", "canvas.html"));
  nodeWindow.on("closed", () => {
    nodeWindow = null;
  });
}

ipcMain.on("node:open", () => openNodeWindow());

ipcMain.on("node:focus", () => {
  if (nodeWindow && !nodeWindow.isDestroyed()) nodeWindow.focus();
});

// 画布窗口就绪后推送初始状态
ipcMain.on("node:ready", async () => {
  if (!blueprintManager || !nodeRegistry) return;
  sendNode("node:init", {
    presets: blueprintManager.presetList(),
    saved: blueprintManager.blueprintList(),
    nodes: nodeRegistry.list(),
    blueprintsDir: blueprintManager.blueprintsDir(),
  });
});

// 热重载节点注册表（新增/修改 ~/.pi/nodes/ 下的节点后调用，无需重启）
ipcMain.handle("node:reload-nodes", async () => {
  if (!nodeRegistry) return { ok: false, error: "注册表未初始化" };
  await nodeRegistry.reload();
  return { ok: true, count: nodeRegistry.list().length, nodes: nodeRegistry.list().map((n) => n.name) };
});

ipcMain.handle("node:get-state", async () => ({
  presets: blueprintManager?.presetList() || [],
  saved: blueprintManager?.blueprintList() || [],
  nodes: nodeRegistry?.list() || [],
  blueprintsDir: blueprintManager?.blueprintsDir() || "",
}));

ipcMain.handle("node:save-blueprint", async (_e, bp) => {
  try {
    const saved = await blueprintManager.saveBlueprint(bp);
    return { ok: true, blueprint: saved };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("node:load-blueprint", async (_e, { id, preset }) => {
  const bp = preset
    ? blueprintManager.getPreset(id)
    : blueprintManager.getSaved(id);
  if (!bp) return { ok: false, error: "未找到该蓝图" };
  return { ok: true, blueprint: bp };
});

ipcMain.handle("node:delete-blueprint", async (_e, id) => {
  try {
    return { ok: await blueprintManager.deleteBlueprint(id) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("node:run", async (_e, payload) => {
  const { blueprint, selection, wait } = payload || {};
  if (!blueprint || !Array.isArray(blueprint?.nodes)) {
    return {
      ok: false,
      error: "蓝图参数无效：需要完整蓝图对象 { nodes:[...], edges:[...] }（示例见 nodes-docs 开发接口参考）",
    };
  }
  try {
    const { runId, run } = blueprintManager.run({
      blueprint,
      selection: Array.isArray(selection) && selection.length ? selection : null,
    });
    sendNode("node:run-started", {
      runId,
      name: run.name,
      blueprintId: blueprint?.id || null,
    });
    if (wait) {
      const res = await run.promise;
      return { ok: true, runId, ...res };
    }
    return { ok: true, runId };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.on("node:run-abort", (_e, runId) => blueprintManager?.abort(runId));

ipcMain.handle("node:get-run", (_e, runId) => {
  const run = blueprintManager?.getRun(runId);
  if (!run) {
    return { found: false, error: `未找到运行 ${runId}（运行可能已过期或从未开始）` };
  }
  return {
    found: true,
    status: run.status,
    name: run.name,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    nodes: Object.fromEntries(
      [...run.nodes.entries()].map(([id, n]) => [id, { ...n }])
    ),
    resultsById: run.results,
  };
});

// ---------- 知识库（RAG）IPC ----------

ipcMain.handle("kb:list", () => ({ docs: ragEngine?.listDocs() || [] }));

ipcMain.handle("kb:status", () => ragEngine?.status() || {});

ipcMain.handle("kb:import-file", async (_e, filePath) => {
  try {
    const result = await ragEngine.importFile(filePath);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("kb:import-text", async (_e, { name, text }) => {
  try {
    const result = await ragEngine.importText({ name, content: text });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("kb:delete", async (_e, docId) => {
  try {
    await ragEngine.deleteDoc(docId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("kb:search", async (_e, { query, k }) => {
  try {
    const results = await ragEngine.search(query, k || 4);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// 知识库界面：导入文件对话框
ipcMain.handle("kb:pick-file", async () => {
  const win = mainWindow;
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: "选择要导入知识库的文件",
    properties: ["openFile"],
    filters: [
      { name: "文档", extensions: ["txt", "md", "markdown", "json", "csv", "log", "py", "js", "ts", "html", "css"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

// ---------- 窗口 ----------

const MAIN_BOUNDS = { width: 1180, height: 820 }; // 主窗口最终尺寸
const SPLASH_BOUNDS = { width: 420, height: 300 }; // 加载窗口尺寸

function createWindow() {
  mainWindow = new BrowserWindow({
    width: MAIN_BOUNDS.width,
    height: MAIN_BOUNDS.height,
    minWidth: 860,
    minHeight: 600,
    title: "Pi Desktop",
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    show: false, // 不自动显示：由加载窗口放大过渡接管显示时机
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------- 加载窗口（Splash）与放大衔接过渡 ----------

const BOOT_MIN_MS = 2600; // 加载窗口最短展示时长（动画节奏较慢，让 Logo/进度充分展示）
let bootStartedAt = 0;

function createSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  splashWindow = new BrowserWindow({
    width: SPLASH_BOUNDS.width,
    height: SPLASH_BOUNDS.height,
    frame: false,
    transparent: true, // 透明：放大时只有内容可见，视觉 = 窗口本身在放大
    hasShadow: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, "renderer", "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow?.show());
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
}

/** 向加载窗口推送初始化状态（窗口未就绪则忽略） */
function splashStatus(text, cls) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send("splash:status", { text, cls });
  }
}

/**
 * 加载窗口放大衔接过渡（平滑版）：
 * 1. 预发 splash:prepare 设置初始缩放比例（媒体查询生效后无闪帧）
 * 2. 加载窗口 + 主窗口一次性 setBounds 到最终位置（不再逐帧操作窗口）
 * 3. 渲染进程 rAF + GPU transform 播放：内容平滑放大，同时 π 图标沿直线轨迹
 *    持续移动到主页图标位置（终点像素级对齐）→ 背景淡出 → 关闭加载窗口
 */
async function playZoomTransition() {
  const splash = splashWindow;
  const win = mainWindow;
  if (!splash || !win || splash.isDestroyed() || win.isDestroyed()) return;

  // 主窗口最终 bounds（屏幕居中，外尺寸含边框）
  const wa = screen.getPrimaryDisplay().workArea;
  const to = {
    x: wa.x + Math.round((wa.width - MAIN_BOUNDS.width) / 2),
    y: wa.y + Math.round((wa.height - MAIN_BOUNDS.height) / 2),
    width: MAIN_BOUNDS.width,
    height: MAIN_BOUNDS.height,
  };

  // 主窗口就位（暂不显示），读取其内容区 bounds（加载窗口无边框，须放大到内容区尺寸才能完全匹配）
  win.setBounds(to);
  const cb = win.getContentBounds();

  // 双轴初始缩放：以内容区尺寸为基准（宽度/高度分别计算）
  const sx0 = SPLASH_BOUNDS.width / cb.width; // 420/1164 ≈ 0.361
  const sy0 = SPLASH_BOUNDS.height / cb.height; // 300/781 ≈ 0.384
  // 1. 预置初始缩放（此时窗口还是 420×300，媒体查询未生效，无视觉影响）
  splash.webContents.send("splash:prepare", { sx: sx0, sy: sy0 });
  await new Promise((r) => setTimeout(r, 50));
  // 2. 加载窗口就位到主窗口内容区（无边框窗口，setBounds 即内容区尺寸）
  splash.setBounds(cb);
  // 3. 播放平滑放大（内容从屏幕中心扩大，最终与主窗口内容完全匹配）
  splash.webContents.send("splash:zoom", { sx: sx0, sy: sy0, duration: 1000 });
  // 4. 放大完成后：主窗口显示（被全尺寸加载窗口盖住）→ 淡出
  await new Promise((r) => setTimeout(r, 1020));
  win.show();
  splash.webContents.send("splash:fade", { duration: 420 });
  await new Promise((r) => setTimeout(r, 460));
  closeSplash();
}

app.whenReady().then(() => {
  bootStartedAt = Date.now();
  createSplash();
  createWindow();
  setupPromise = setup()
    .catch((err) => {
      splashStatus(`初始化失败：${err?.message ?? err}`, "error");
      sessionError(
        `Pi 初始化失败: ${err?.message ?? err}（请检查 ~/.pi/agent 下的配置和 API Key）`
      );
    })
    .finally(() => {
      // 保证加载窗口至少展示 BOOT_MIN_MS，再播放放大衔接过渡
      const remain = BOOT_MIN_MS - (Date.now() - bootStartedAt);
      setTimeout(() => playZoomTransition(), Math.max(0, remain));
    });
});

app.on("window-all-closed", () => {
  app.quit();
});

// ---------- 开发遥控通道 ----------
// 轮询命令文件，在指定窗口执行 JS 并写回结果（供外部调试/演示驱动，无需重启）
const DEV_CMD_FILE = path.join(os.homedir(), ".pi", "dev-cmd.jsonl");
const DEV_RESULT_FILE = path.join(os.homedir(), ".pi", "dev-result.jsonl");

async function devPoll() {
  try {
    const { readFile, writeFile, appendFile } = await import("node:fs/promises");
    let raw;
    try {
      raw = await readFile(DEV_CMD_FILE, "utf-8");
    } catch {
      return;
    }
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    await writeFile(DEV_CMD_FILE, "", "utf-8"); // 先清空，避免重复执行
    for (const line of lines) {
      let cmd;
      try {
        cmd = JSON.parse(line);
      } catch {
        continue;
      }
      if (!cmd?.id || typeof cmd?.code !== "string") continue;
      let result;
      try {
        if (cmd.target === "canvas") {
          if (!nodeWindow || nodeWindow.isDestroyed()) throw new Error("画布窗口未打开");
          result = await nodeWindow.webContents.executeJavaScript(cmd.code);
        } else if (cmd.target === "main") {
          if (!mainWindow || mainWindow.isDestroyed()) throw new Error("主窗口未打开");
          result = await mainWindow.webContents.executeJavaScript(cmd.code);
        } else {
          throw new Error(`未知 target: ${cmd.target}`);
        }
      } catch (err) {
        result = { __error: err?.message || String(err) };
      }
      try {
        await appendFile(
          DEV_RESULT_FILE,
          JSON.stringify({ id: cmd.id, result }) + "\n",
          "utf-8"
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

setInterval(devPoll, 600);

process.on("uncaughtException", (err) => {
  console.error("uncaught:", err);
});
