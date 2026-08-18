/**
 * vision-tool —— 自定义 AI 工具：让纯文本模型（如 DeepSeek）按需分析用户上传的图片。
 * 当 AI 需要看图时，会自动调用 vision_analyze → Qwen3-VL（llama-server:8081）分析。
 * 自愈：服务未启动自动拉起；请求失败时仅在确认服务已崩溃才重启重试，避免误杀。
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";

const SYSTEM_PROMPT =
  "你是图像内容描述器。客观、中立、结构化地描述图片内容（物体/人物/场景/文字/空间关系/氛围）。规范：只用第三人称陈述，禁止第一人称；只描述画面中可见内容，禁止推测；直接输出描述正文。先一句话概括，再分条列出要点。";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 探测视觉服务是否就绪（已加载完成可服务） */
async function isHealthy(server) {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`${server}/health`, { signal: ctl.signal });
    clearTimeout(to);
    return r.status === 200;
  } catch {
    return false;
  }
}

/** 服务未启动（或无响应）时自动拉起；最多等 ~2 分钟直到加载完成 */
async function ensureServer(server) {
  if (await isHealthy(server)) return true;
  try {
    const bat = path.join(os.homedir(), "Desktop", "llama-cpp", "start-qwen-vl.bat");
    spawn("cmd.exe", ["/c", bat], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await isHealthy(server)) return true;
  }
  return false;
}

/** 杀掉已崩溃的 llama-server 进程 */
function killServer() {
  try {
    execFile("taskkill", ["/F", "/IM", "llama-server.exe"], { windowsHide: true }, () => {});
  } catch {
    /* ignore */
  }
}

/** 一次视觉分析请求（服务需已就绪） */
async function analyzeOnce(server, imagePath, question) {
  const buf = await readFile(imagePath);
  if (buf.length > MAX_IMAGE_BYTES) {
    return `图片过大（${(buf.length / 1024 / 1024).toFixed(1)}MB），超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 上限，无法分析。`;
  }
  const b64 = buf.toString("base64");
  const ext = path.extname(imagePath).toLowerCase().replace(".", "");
  const mime = ext === "jpg" || ext === "jpeg" ? "jpeg" : ext === "webp" ? "webp" : "png";
  const resp = await fetch(`${server}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3-vl",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: question || "描述这张图片的内容。" },
            { type: "image_url", image_url: { url: `data:image/${mime};base64,${b64}` } },
          ],
        },
      ],
      max_tokens: 600,
    }),
  });
  if (!resp.ok) return `视觉服务返回 HTTP ${resp.status}。`;
  const j = await resp.json();
  return j.choices?.[0]?.message?.content?.trim() || "（视觉模型未返回内容）";
}

/** 带自愈的重试：请求失败时仅在确认服务已崩溃才杀并重启，避免误杀 */
async function analyzeWithRetry(server, imagePath, question) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (!(await ensureServer(server))) {
        return "视觉服务未能启动，请检查 llama-server 是否正常。";
      }
      return await analyzeOnce(server, imagePath, question);
    } catch (e) {
      if (attempt === 1) {
        const up = await isHealthy(server);
        if (!up) killServer(); // 仅服务确实挂了才杀，否则保留
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return `视觉分析失败：${e?.message || e}（已重试一次仍失败）`;
    }
  }
  return "视觉分析失败。";
}

export function createVisionTool({ getImagePath, server = "http://127.0.0.1:8081" }) {
  return defineTool({
    name: "vision_analyze",
    label: "分析图片",
    description:
      "分析用户上传的图片内容。当用户上传了图片且你需要查看/分析图片时，自动调用本工具；返回图片内容的文字描述。多模态模型可直接看图，无需调用本工具。",
    parameters: Type.Object({
      question: Type.Optional(
        Type.String({ description: "针对图片的具体分析问题（可选，缺省为客观描述图片内容）" })
      ),
    }),
    execute: async ({ question }) => {
      const imagePath = getImagePath();
      if (!imagePath) {
        return "没有可分析的图片（用户可能尚未上传图片）。";
      }
      return await analyzeWithRetry(server, imagePath, question);
    },
  });
}
