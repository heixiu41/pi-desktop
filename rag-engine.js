/**
 * RAG 引擎：本地知识库
 * - 模型：Xenova/bge-small-zh-v1.5（本地 ONNX，通过受管下载拉取 → 显示在下载面板）
 * - 向量：自建余弦相似度索引，JSON 持久化到 ~/.pi/kb/
 * - 支持：导入文本/文件 → 分块 → 嵌入 → 检索
 */
import { EventEmitter } from "node:events";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  unlink,
  access,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface as readlineCreateInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, "embed-worker.mjs");

const KB_DIR = path.join(os.homedir(), ".pi", "kb");
const MODELS_DIR = path.join(KB_DIR, "models");
const INDEX_FILE = path.join(KB_DIR, "index.json");
const EMBED_MODEL = "Xenova/bge-small-zh-v1.5";
const HF_MIRROR = "https://hf-mirror.com/";
const MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_quantized.onnx",
];
const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 80;

export class RagEngine extends EventEmitter {
  constructor({ downloadManager }) {
    super();
    this.downloadManager = downloadManager;
    this.docs = []; // {id, name, source, updated, chunks}
    this.chunks = []; // {id, docId, text, vec}
    this.modelReady = false;
    this.modelError = null;
  }

  async init() {
    await mkdir(MODELS_DIR, { recursive: true });
    await this._loadIndex();
    this.modelReady = await this.ensureModel();
  }

  status() {
    return {
      modelReady: this.modelReady,
      modelError: this.modelError,
      model: EMBED_MODEL,
      docCount: this.docs.length,
      chunkCount: this.chunks.length,
    };
  }

  /* ---------- 模型 ---------- */

  /** 检查/下载模型文件（走受管下载 → 显示在下载面板） */
  async ensureModel() {
    const modelDir = path.join(MODELS_DIR, EMBED_MODEL);
    const missing = [];
    for (const f of MODEL_FILES) {
      try {
        await access(path.join(modelDir, f));
      } catch {
        missing.push(f);
      }
    }
    if (!missing.length) {
      this.emit("status", { modelReady: true });
      return true;
    }
    this.emit("status", { downloading: true, text: "正在下载嵌入模型…" });
    try {
      for (const f of missing) {
        const url = `${HF_MIRROR}${EMBED_MODEL}/resolve/main/${f}`;
        const task = this.downloadManager.add({
          url,
          dest: path.dirname(path.join(modelDir, f)),
          filename: path.basename(f),
          source: "model",
        });
        const r = await task.promise;
        if (!r.ok) throw new Error(`模型文件 ${f} 下载失败：${r.error || ""}`);
      }
      this.modelReady = true;
      this.modelError = null;
      this.emit("status", { modelReady: true, downloading: false });
      return true;
    } catch (err) {
      this.modelError = err?.message || String(err);
      this.emit("status", { modelReady: false, downloading: false, error: this.modelError });
      return false;
    }
  }

  async _getWorker() {
    if (this._worker) return this._worker;
    const child = spawn(process.env.NODE_BIN || "node", [WORKER_SCRIPT], {
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true, // Windows：隐藏子进程控制台窗口（避免 node.exe 弹出闪烁）
    });
    this._worker = child;
    this._pending = new Map();
    this._msgId = 0;
    const rl = readlineCreateInterface({ input: child.stdout });
    rl.on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const p = this._pending.get(msg.id);
      if (!p) return;
      this._pending.delete(msg.id);
      if (msg.type === "error") p.reject(new Error(msg.error));
      else p.resolve(msg);
    });
    child.on("exit", () => {
      this._worker = null;
      for (const p of this._pending.values()) p.reject(new Error("嵌入进程已退出"));
      this._pending.clear();
    });
    return child;
  }

  async embed(texts) {
    const w = await this._getWorker();
    const id = ++this._msgId;
    const res = await new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      w.stdin.write(JSON.stringify({ id, type: "embed", texts }) + "\n");
    });
    return res.vecs;
  }

  /* ---------- 索引 ---------- */

  async _loadIndex() {
    try {
      const raw = await readFile(INDEX_FILE, "utf-8");
      const data = JSON.parse(raw);
      this.docs = data.docs || [];
      this.chunks = data.chunks || [];
    } catch {
      this.docs = [];
      this.chunks = [];
    }
  }

  async _persist() {
    await mkdir(KB_DIR, { recursive: true });
    await writeFile(
      INDEX_FILE,
      JSON.stringify({ docs: this.docs, chunks: this.chunks }),
      "utf-8"
    );
  }

  /* ---------- 导入 ---------- */

  async importText({ name, content, source }) {
    const text = String(content || "").trim();
    if (!text) throw new Error("内容为空");
    const doc = {
      id: crypto.randomUUID().slice(0, 8),
      name: name || `文档 ${this.docs.length + 1}`,
      source: source || "text",
      updated: Date.now(),
    };
    const pieces = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
    if (!pieces.length) throw new Error("无法分块");
    const vecs = await this.embed(pieces);
    for (let i = 0; i < pieces.length; i++) {
      this.chunks.push({
        id: `${doc.id}-${i}`,
        docId: doc.id,
        text: pieces[i],
        vec: vecs[i],
      });
    }
    doc.chunks = pieces.length;
    this.docs.push(doc);
    await this._persist();
    this.emit("change", this.status());
    return { id: doc.id, name: doc.name, chunks: pieces.length };
  }

  async importFile(filePath) {
    const buf = await readFile(filePath);
    let content;
    // 尝试按文本解码
    content = buf.toString("utf-8");
    if (content.includes("\uFFFD") && content.length > 0) {
      content = buf.toString("gbk");
    }
    const name = path.basename(filePath);
    return this.importText({ name, content, source: filePath });
  }

  async deleteDoc(docId) {
    this.docs = this.docs.filter((d) => d.id !== docId);
    this.chunks = this.chunks.filter((c) => c.docId !== docId);
    await this._persist();
    this.emit("change", this.status());
  }

  /* ---------- 检索 ---------- */

  async search(query, k = 4) {
    const q = String(query || "").trim();
    if (!q) return [];
    if (!this.modelReady) {
      throw new Error("嵌入模型尚未就绪");
    }
    const [qvec] = await this.embed([q]);
    // 归一化向量点积 = 余弦相似度
    const scored = this.chunks
      .filter((c) => Array.isArray(c.vec) && c.vec.length)
      .map((c) => ({ ...c, score: dot(qvec, c.vec) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k);
    return top.map((c) => ({
      text: c.text,
      score: +c.score.toFixed(4),
      docId: c.docId,
      docName: this.docs.find((d) => d.id === c.docId)?.name || "",
    }));
  }

  /* ---------- 清单 ---------- */

  listDocs() {
    return this.docs.map((d) => ({
      id: d.id,
      name: d.name,
      source: d.source,
      updated: new Date(d.updated).toISOString(),
      chunks: d.chunks || 0,
    }));
  }
}

/* ---------- 工具函数 ---------- */

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 分块：按段落合并到目标长度，块间带重叠；超长段落再硬切 */
export function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/);
  const chunks = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
  };
  for (const p of paras) {
    const para = p.trim();
    if (!para) continue;
    if (para.length > size) {
      // 超长段落硬切
      flush();
      cur = "";
      for (let i = 0; i < para.length; i += size - overlap) {
        chunks.push(para.slice(i, i + size).trim());
      }
      continue;
    }
    if (cur && (cur + "\n\n" + para).length > size) {
      flush();
      cur = cur.slice(-overlap) + "\n\n" + para;
    } else {
      cur = cur ? cur + "\n\n" + para : para;
    }
  }
  flush();
  return chunks.filter(Boolean);
}
