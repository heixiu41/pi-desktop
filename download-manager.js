/**
 * 下载管理器：统一管理所有下载任务（Pi 工具触发的 + 侧边栏手动添加的）。
 * 支持：进度跟踪、速度计算、暂停/继续（Range 断点续传）、停止、失败重试。
 */
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const DEFAULT_DIR = path.join(os.homedir(), "Downloads");
const MAX_REDIRECTS = 10;
const UA = "pi-desktop/1.0";
const SPEED_INTERVAL = 500;
const CLEANUP_DELAY = 150; // 等流关闭后再删除部分文件

const ACTIVE_STATUS = new Set(["downloading", "queued"]);

function isActive(task) {
  return ACTIVE_STATUS.has(task.status);
}

function sanitizeFilename(name) {
  let n = (name || "download").trim();
  // Windows 非法字符
  n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  n = n.replace(/[. ]+$/g, "");
  if (!n) n = "download";
  if (n.length > 180) {
    const ext = path.extname(n);
    n = n.slice(0, 180 - ext.length) + ext;
  }
  return n;
}

function defaultFilename(url) {
  try {
    const u = new URL(url);
    const seg = decodeURIComponent(u.pathname.split("/").pop() || "");
    return sanitizeFilename(seg) || "download";
  } catch {
    return "download";
  }
}

export class DownloadManager extends EventEmitter {
  constructor({ dir = DEFAULT_DIR } = {}) {
    super();
    this.defaultDir = dir;
    this.tasks = new Map();
  }

  /** 添加并开始一个下载任务，返回任务对象（含 promise） */
  add({ url, dest, filename, source = "manual" }) {
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("缺少下载链接");
    }
    let u;
    try {
      u = new URL(url.trim());
    } catch {
      throw new Error(`无效的链接: ${url}`);
    }
    if (!/^https?:$/.test(u.protocol)) {
      throw new Error("仅支持 http/https 链接");
    }

    const dir = dest ? path.resolve(dest) : this.defaultDir;
    const name = sanitizeFilename(filename || defaultFilename(u.href));
    const fullPath = path.join(dir, name);

    const task = {
      id: crypto.randomUUID(),
      url: u.href,
      filename: name,
      dir,
      fullPath,
      status: "downloading", // queued | downloading | paused | completed | failed | stopped
      received: 0,
      total: null,
      percent: null,
      speed: 0,
      error: null,
      source,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      promise: null,
      _resolve: null,
      _reject: null,
      _abort: null,
      _stream: null,
      _speedTimer: null,
      _lastBytes: 0,
      _lastTime: 0,
      _runId: 0, // 下载轮次（暂停/停止后重新开始会递增，用于忽略旧轮次的异步错误）
    };
    task.promise = new Promise((resolve, reject) => {
      task._resolve = resolve;
      task._reject = reject;
    });

    this.tasks.set(task.id, task);
    this._run(task);
    this._emit("started", task);
    return task;
  }

  pause(id) {
    const task = this.tasks.get(id);
    if (!task || !isActive(task)) return;
    task.status = "paused";
    this._cleanup(task, { ok: false, paused: true, filename: task.filename });
    this._stopSpeedTimer(task);
    this._emit("paused", task);
  }

  /** 暂停后继续（从断点续传，服务端不支持 Range 则自动从头开始） */
  resume(id) {
    const task = this.tasks.get(id);
    if (!task || task.status !== "paused") return;
    task.status = "downloading";
    task.error = null;
    task.updatedAt = Date.now();
    this._run(task);
    this._emit("started", task);
  }

  /** 停止并删除未完成的部分文件 */
  stop(id) {
    const task = this.tasks.get(id);
    if (!task || task.status === "completed") return;
    const wasActive = isActive(task);
    task.status = "stopped";
    this._cleanup(
      task,
      { ok: false, stopped: true, filename: task.filename },
      { deleteFile: true }
    );
    this._stopSpeedTimer(task);
    if (wasActive) this._emit("stopped", task);
  }

  /** 失败/停止后重试（失败保留断点；停止则从头下载） */
  retry(id) {
    const task = this.tasks.get(id);
    if (!task || (task.status !== "failed" && task.status !== "stopped")) return;
    if (task.status === "stopped") task.received = 0;
    task.status = "downloading";
    task.error = null;
    task.speed = 0;
    task.updatedAt = Date.now();
    this._run(task);
    this._emit("started", task);
  }

  get(id) {
    return this.tasks.get(id);
  }

  /** 删除任务：中止下载并清理未完成的部分文件；已完成的文件保留 */
  remove(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (isActive(task)) {
      // 先标记为 stopped，避免 _run 的 catch 把它误标成 failed
      task.status = "stopped";
      this._cleanup(
        task,
        { ok: false, removed: true, filename: task.filename },
        { deleteFile: true }
      );
    }
    this._stopSpeedTimer(task);
    this.tasks.delete(id);
    this._emit("change", task);
    return task;
  }

  list() {
    return [...this.tasks.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((task) => this.toJSON(task));
  }

  // ---------- 内部 ----------

  /** 序列化为渲染进程使用的纯数据结构 */
  toJSON(task) {
    const pct =
      task.total && task.total > 0
        ? Math.min(100, Math.round((task.received / task.total) * 100))
        : null;
    return {
      id: task.id,
      url: task.url,
      filename: task.filename,
      dir: task.dir,
      fullPath: task.fullPath,
      status: task.status,
      received: task.received,
      total: task.total,
      percent: pct,
      speed: task.speed,
      error: task.error,
      source: task.source,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  _emit(event, task) {
    this.emit(event, task);
    this.emit("change", task);
  }

  /** 结束任务的下载 promise，并中止请求（可选删除未完成的部分文件） */
  _cleanup(task, result, { deleteFile = false } = {}) {
    this._settle(task, result);
    this._abortRequest(task);
    if (deleteFile) {
      setTimeout(() => unlink(task.fullPath).catch(() => {}), CLEANUP_DELAY);
    }
  }

  _settle(task, result) {
    const resolve = task._resolve;
    task._resolve = null;
    if (resolve) resolve(result);
  }

  _abortRequest(task) {
    if (task._abort) {
      task._abort.abort();
      task._abort = null;
    }
    if (task._stream) {
      try {
        task._stream.end();
      } catch {
        /* ignore */
      }
      task._stream = null;
    }
  }

  _startSpeedTimer(task) {
    task._lastBytes = task.received;
    task._lastTime = Date.now();
    task._speedTimer = setInterval(() => {
      const now = Date.now();
      const dt = (now - task._lastTime) / 1000;
      if (dt <= 0) return;
      const instant = (task.received - task._lastBytes) / dt;
      task.speed = task.speed === 0 ? instant : task.speed * 0.7 + instant * 0.3;
      task._lastBytes = task.received;
      task._lastTime = now;
      this._emit("change", task);
    }, SPEED_INTERVAL);
  }

  _stopSpeedTimer(task) {
    if (task._speedTimer) {
      clearInterval(task._speedTimer);
      task._speedTimer = null;
    }
    task.speed = 0;
  }

  async _run(task) {
    task.redirects = 0; // 每轮下载重置重定向计数
    const runId = ++task._runId;
    try {
      await mkdir(task.dir, { recursive: true });
      this._startSpeedTimer(task);

      let url = task.url;
      for (;;) {
        const r = await this._requestOnce(task, url);
        if (r.done) break;
        url = r.redirect;
      }

      this._stopSpeedTimer(task);
      this._complete(task);
    } catch (err) {
      // 该轮下载已被暂停/停止后重新开始的下载取代，忽略其异步错误
      if (task._runId !== runId) return;
      this._stopSpeedTimer(task);
      this._fail(task, err);
    }
  }

  _complete(task) {
    if (task.status !== "downloading") return;
    task.status = "completed";
    task.updatedAt = Date.now();
    this._settle(task, {
      ok: true,
      path: task.fullPath,
      filename: task.filename,
      size: task.received,
    });
    this._emit("completed", task);
  }

  _fail(task, err) {
    // 用户主动暂停/停止时，Promise 已由 pause/stop 处理
    if (task.status === "paused" || task.status === "stopped") return;
    task.status = "failed";
    task.error =
      err?.name === "AbortError" ? "请求被中断" : err?.message || String(err);
    task.updatedAt = Date.now();
    this._settle(task, {
      ok: false,
      error: task.error,
      filename: task.filename,
    });
    this._emit("failed", task);
  }

  /** 发起一次 HTTP 请求：成功返回 { done: true }，重定向返回 { redirect: url } */
  _requestOnce(task, url) {
    return new Promise((resolve, reject) => {
      const headers = { "User-Agent": UA, "Accept-Encoding": "identity" };
      // 有部分数据时请求断点续传；服务端不支持（返回 200）则自动从头下载
      if (task.received > 0) {
        headers["Range"] = `bytes=${task.received}-`;
      }

      const ac = new AbortController();
      task._abort = ac;
      const request = url.startsWith("https:") ? httpsRequest : httpRequest;

      const req = request(url, { headers, signal: ac.signal }, (res) => {
        const status = res.statusCode;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (++task.redirects > MAX_REDIRECTS) {
            reject(new Error("重定向次数过多"));
            return;
          }
          resolve({ redirect: new URL(res.headers.location, url).toString() });
          return;
        }
        if (status >= 400) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        if (status === 206) {
          const cr = String(res.headers["content-range"] || "");
          const total = parseInt(cr.split("/")[1], 10);
          if (Number.isFinite(total) && total > 0) task.total = total;
        } else {
          // 200：服务端忽略了 Range（或不支持），从头下载
          if (task.received > 0) task.received = 0;
          const len = parseInt(res.headers["content-length"] || "0", 10);
          task.total = Number.isFinite(len) && len > 0 ? len : null;
        }

        const ws = createWriteStream(task.fullPath, {
          flags: task.received > 0 ? "a" : "w",
        });
        task._stream = ws;
        let settled = false;
        const done = (err, value) => {
          if (settled) return;
          settled = true;
          err ? reject(err) : resolve(value);
        };

        ws.on("error", done);
        res.on("error", done);
        res.on("data", (chunk) => {
          task.received += chunk.length;
          task.updatedAt = Date.now();
        });
        res.on("end", () => ws.end());
        ws.on("finish", () => done(null, { done: true }));
        res.pipe(ws);
      });

      req.on("error", reject);
      req.end();
    });
  }
}
