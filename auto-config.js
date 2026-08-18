// auto-config.js
// Pi 环境自动检测 + 自动配置模块
// 用途：应用启动时检测本机 Pi 配置（~/.pi/agent 等），缺失时自动补齐，
//       实现"任何电脑拷过去即用"。
//
// ⚠️ 安全设计：项目内不存放真实 API Key。auth.json 按以下优先级处理：
//   1. 本机已有有效 auth.json          → 不动
//   2. 环境变量 DEEPSEEK_API_KEY        → 自动生成 auth.json（推荐，适合新电脑）
//   3. 均无                            → 写入占位模板，提示用户手动配置
//
// 检测项：
//   - ~/.pi/agent/auth.json          API Key 是否有效
//   - ~/.pi/agent/models-store.json  模型清单是否存在
//   - ~/.pi/agent/settings.json      默认模型设置
//   - ~/.pi/{nodes,nodes-docs,blueprints,kb}  运行时目录
//   - 系统 PATH 中的 pi 命令（信息展示，不阻塞）

import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** 运行时目录（相对 ~/.pi/），缺失自动创建 */
const RUNTIME_DIRS = [
  "agent",
  "agent/sessions",
  "agent/sessions-archive",
  "nodes",
  "nodes-docs",
  "blueprints",
  "kb",
  "summary",
];

/** 配置模板文件名（对应 ~/.pi/agent/ 下） */
const CONFIG_FILES = ["models-store.json", "settings.json"];

/** 从环境变量读取 API Key（按优先级） */
function apiKeyFromEnv() {
  return process.env.DEEPSEEK_API_KEY || process.env.PI_API_KEY || "";
}

/** 生成 auth.json 内容（provider 固定 deepseek，与默认设置一致） */
function buildAuthJson(apiKey) {
  return JSON.stringify(
    { deepseek: { type: "api_key", key: String(apiKey || "").trim() } },
    null,
    2
  );
}

/** 检测系统 PATH 中是否存在 pi 命令（Windows: where / 其他: which） */
function detectPiCommand() {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const r = spawnSync(cmd, ["pi"], { encoding: "utf-8", timeout: 5000 });
    const found = r.status === 0 && String(r.stdout || "").trim().length > 0;
    return { found, path: found ? String(r.stdout).trim().split(/\r?\n/)[0] : "" };
  } catch {
    return { found: false, path: "" };
  }
}

/** 解析 auth.json，返回 { ok, providers } */
async function checkAuth(authPath) {
  try {
    const o = JSON.parse(await readFile(authPath, "utf-8"));
    const entries = Object.entries(o).filter(
      ([, v]) => v && (v.type === "api_key" || v.key) && String(v.key || "").trim()
    );
    return { ok: entries.length > 0, providers: entries.map(([p]) => p) };
  } catch {
    return { ok: false, providers: [] };
  }
}

/** 解析 models-store.json，返回 { ok, count } */
async function checkModels(modelsPath) {
  try {
    const o = JSON.parse(await readFile(modelsPath, "utf-8"));
    let count = 0;
    for (const p of Object.values(o)) {
      if (Array.isArray(p?.models)) count += p.models.length;
    }
    return { ok: count > 0, count };
  } catch {
    return { ok: false, count: 0 };
  }
}

/** 解析 settings.json，返回 { ok, provider, model } */
async function checkSettings(settingsPath) {
  try {
    const o = JSON.parse(await readFile(settingsPath, "utf-8"));
    return {
      ok: !!(o.defaultProvider && o.defaultModel),
      provider: o.defaultProvider || "",
      model: o.defaultModel || "",
    };
  } catch {
    return { ok: false, provider: "", model: "" };
  }
}

/**
 * 检测本机 Pi 配置状态（只读，不修改任何文件）
 * @returns {Promise<object>} 完整检测报告
 */
export async function detectPiConfig(agentDir) {
  const dir = agentDir || getAgentDir();
  const authPath = path.join(dir, "auth.json");
  const modelsPath = path.join(dir, "models-store.json");
  const settingsPath = path.join(dir, "settings.json");
  const homePi = path.join(os.homedir(), ".pi");

  const [auth, models, settings] = await Promise.all([
    checkAuth(authPath),
    checkModels(modelsPath),
    checkSettings(settingsPath),
  ]);

  const checks = {
    auth: { ...auth, path: authPath },
    models: { ...models, path: modelsPath },
    settings: { ...settings, path: settingsPath },
  };

  // 运行时目录
  const dirs = {};
  for (const d of RUNTIME_DIRS) {
    dirs[d] = existsSync(path.join(homePi, d));
  }

  // pi 命令（仅信息展示）
  const piCommand = detectPiCommand();

  const missing = [];
  if (!auth.ok) missing.push("auth.json（API Key）");
  if (!models.ok) missing.push("models-store.json（模型清单）");
  if (!settings.ok) missing.push("settings.json（默认模型）");
  for (const [d, ok] of Object.entries(dirs)) {
    if (!ok) missing.push(`~/.pi/${d}`);
  }

  const present = [];
  if (auth.ok) present.push(`auth.json（${auth.providers.join("/")}）`);
  if (models.ok) present.push(`models-store.json（${models.count} 个模型）`);
  if (settings.ok) present.push(`settings.json（${settings.provider}/${settings.model}）`);
  for (const [d, ok] of Object.entries(dirs)) {
    if (ok) present.push(`~/.pi/${d}`);
  }

  return {
    agentDir: dir,
    valid: missing.length === 0,
    missing,
    present,
    checks,
    dirs,
    piCommand,
  };
}

/**
 * 自动检测 + 自动配置：缺失项自动补齐，auth.json 走安全三路逻辑（见文件头注释）
 * @param {object} opts
 * @param {string} opts.templatesDir  模板目录（内含 models-store.json / settings.json / auth.json 占位）
 * @param {string} [opts.agentDir]    目标 agent 目录（缺省用 SDK 默认 ~/.pi/agent）
 * @returns {Promise<object>} { configured, needManualConfig, actions, report, ...detect }
 */
export async function ensurePiConfig({ templatesDir, agentDir } = {}) {
  const dir = agentDir || getAgentDir();
  const homePi = path.join(os.homedir(), ".pi");
  const actions = [];

  // 1. 创建运行时目录（含 agent 下的会话目录）
  for (const d of RUNTIME_DIRS) {
    const p = path.join(homePi, d);
    if (!existsSync(p)) {
      try {
        await mkdir(p, { recursive: true });
        actions.push(`创建 ~/.pi/${d}`);
      } catch (err) {
        console.error(`[auto-config] 创建目录失败 ~/.pi/${d}:`, err?.message);
      }
    }
  }

  // 2. auth.json：安全三路（已有有效配置 → 环境变量 → 占位提示手动）
  const authPath = path.join(dir, "auth.json");
  const authCheck = await checkAuth(authPath);
  let needManualConfig = false;
  if (!authCheck.ok) {
    const envKey = apiKeyFromEnv();
    if (envKey) {
      // 环境变量自动生成（不写入项目文件）
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(authPath, buildAuthJson(envKey), "utf-8");
        actions.push(`写入 ~/.pi/agent/auth.json（来自环境变量 ${envKey.startsWith("sk-") ? envKey.slice(0, 7) + "…" : ""}）`);
      } catch (err) {
        console.error(`[auto-config] 写入 auth.json 失败:`, err?.message);
        needManualConfig = true;
      }
    } else if (templatesDir && existsSync(templatesDir)) {
      // 占位模板（key 为空），提示用户手动配置；已写入过则不再重复写
      try {
        const placeholder = path.join(templatesDir, "auth.json");
        let already = false;
        if (existsSync(authPath) && existsSync(placeholder)) {
          const [cur, tpl] = await Promise.all([
            readFile(authPath, "utf-8"),
            readFile(placeholder, "utf-8"),
          ]);
          already = cur.trim() === tpl.trim();
        }
        if (!already) {
          await mkdir(dir, { recursive: true });
          await copyFile(placeholder, authPath);
          actions.push(`写入 ~/.pi/agent/auth.json（占位，待填入 API Key）`);
        }
        needManualConfig = true;
      } catch (err) {
        console.error(`[auto-config] 写入 auth 占位失败:`, err?.message);
        needManualConfig = true;
      }
    } else {
      needManualConfig = true;
    }
  }

  // 3. 其余配置模板（models-store / settings，不含敏感信息，缺失即补）
  if (templatesDir && existsSync(templatesDir)) {
    for (const f of CONFIG_FILES) {
      const dest = path.join(dir, f);
      const src = path.join(templatesDir, f);
      if (!existsSync(dest) && existsSync(src)) {
        try {
          await copyFile(src, dest);
          actions.push(`写入 ~/.pi/agent/${f}（项目模板）`);
        } catch (err) {
          console.error(`[auto-config] 复制模板失败 ${f}:`, err?.message);
        }
      }
    }
  } else {
    console.warn(`[auto-config] 模板目录不存在: ${templatesDir}`);
  }

  // 4. 复检
  const detect = await detectPiConfig(dir);
  let report;
  if (needManualConfig) {
    report =
      "Pi 环境已就绪，但缺少 API Key：请设置环境变量 DEEPSEEK_API_KEY（推荐）后重启，或编辑 ~/.pi/agent/auth.json 填入 Key";
  } else if (detect.valid) {
    report = actions.length
      ? `Pi 自动配置完成 ✓（${actions.join("；")}），现可正常接入`
      : "Pi 配置已就绪 ✓（自动检测通过，无需变更）";
  } else {
    report = `Pi 配置仍不完整：缺少 ${detect.missing.join("、")}（模板目录未提供或写入失败）`;
  }

  return { ...detect, actions, report, configured: actions.length > 0, needManualConfig };
}
