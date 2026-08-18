/**
 * Pi 自定义工具：download —— 让 Pi 的下载行为走统一的受管管道。
 * 进度会显示在应用侧边栏"下载"页，支持暂停/继续/停止。
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { fmtBytes } from "./format.js";

const PROGRESS_INTERVAL = 800;

/** 向聊天工具卡片推送实时进度 */
function pushProgress(task, onUpdate) {
  const pct =
    task.total && task.total > 0
      ? Math.round((task.received / task.total) * 100)
      : null;
  const size = `${fmtBytes(task.received)}${
    pct != null ? ` / ${fmtBytes(task.total)}（${pct}%）` : ""
  }`;
  const speed = task.speed > 0 ? `，速度 ${fmtBytes(task.speed)}/s` : "";
  onUpdate?.({
    content: [{ type: "text", text: `正在下载 ${task.filename}\n已下载 ${size}${speed}` }],
    details: {},
  });
}

/** 把下载结果转成工具返回值 */
function describeResult(result) {
  if (result.ok) {
    return {
      content: [
        { type: "text", text: `下载完成：${result.path}（${fmtBytes(result.size)}）` },
      ],
      details: { path: result.path, size: result.size },
    };
  }
  if (result.paused) {
    return {
      content: [
        {
          type: "text",
          text: `下载已暂停：${result.filename}。可在侧边栏"下载"页点击"继续"恢复，恢复后文件仍会继续下载。`,
        },
      ],
      details: { paused: true },
    };
  }
  if (result.stopped) {
    return {
      content: [
        {
          type: "text",
          text: `下载已停止：${result.filename}（可在侧边栏"下载"页重新下载）。`,
        },
      ],
      details: { stopped: true },
    };
  }
  return {
    content: [{ type: "text", text: `下载失败：${result.error || "未知错误"}` }],
    details: {},
  };
}

export function createDownloadTool(dm) {
  return defineTool({
    name: "download",
    label: "下载文件",
    description:
      "下载一个文件到本地磁盘。下载文件时请优先使用本工具而不是 curl/wget：下载进度会实时显示在应用的下载管理界面中，并支持暂停、继续和停止。",
    promptSnippet: "download(url, outputPath?, filename?) — 下载文件（受管，支持进度与暂停/停止）",
    promptGuidelines: [
      "下载文件时使用 download 工具，把完整 URL 传给 url 参数。",
      "如用户指定保存位置，用绝对路径传入 outputPath；否则用系统下载文件夹。",
      "需要自定义文件名时用 filename 参数（含扩展名）。",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "文件的完整链接（http/https）" }),
      outputPath: Type.Optional(
        Type.String({ description: "保存目录的绝对路径；缺省为系统下载文件夹" })
      ),
      filename: Type.Optional(
        Type.String({ description: "保存的文件名（含扩展名）；缺省取自 URL" })
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const task = dm.add({
        url: params.url,
        dest: params.outputPath,
        filename: params.filename,
        source: "tool",
      });

      const timer = setInterval(
        () => pushProgress(task, onUpdate),
        PROGRESS_INTERVAL
      );
      const onAbort = () => dm.stop(task.id);
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const result = await task.promise;
        return describeResult(result);
      } finally {
        clearInterval(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}
