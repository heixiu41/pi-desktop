/**
 * 嵌入 worker —— 独立系统 node 子进程，负责加载 transformers 模型并计算向量。
 * 通过 stdin/stdout JSONL 与主进程通信，规避 Electron 主进程的原生模块兼容风险。
 */
import { pipeline, env } from "@xenova/transformers";
import readline from "node:readline";
import path from "node:path";
import os from "node:os";

const MODEL = "Xenova/bge-small-zh-v1.5";
const MODELS_DIR = path.join(os.homedir(), ".pi", "kb", "models");
env.localModelPath =
  "file:///" + MODELS_DIR.split(path.sep).join("/").replace(/^\/+/, "") + "/";
env.allowRemoteModels = false;

let extractor = null;
async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", MODEL);
  }
  return extractor;
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.type === "ping") {
    process.stdout.write(JSON.stringify({ id: req.id, type: "pong", pid: process.pid }) + "\n");
    return;
  }
  if (req.type === "embed") {
    try {
      const e = await getExtractor();
      const out = await e(req.texts || [], { pooling: "mean", normalize: true });
      const data = Array.from(out.data);
      const dim = out.dims[out.dims.length - 1];
      const vecs = [];
      for (let i = 0; i < out.dims[0]; i++) {
        vecs.push(data.slice(i * dim, (i + 1) * dim));
      }
      process.stdout.write(JSON.stringify({ id: req.id, type: "vecs", vecs }) + "\n");
    } catch (err) {
      process.stdout.write(
        JSON.stringify({ id: req.id, type: "error", error: String(err?.message || err) }) + "\n"
      );
    }
  }
});
process.stdin.on("end", () => process.exit(0));
