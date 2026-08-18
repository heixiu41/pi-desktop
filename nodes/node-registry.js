/**
 * 节点注册表：扫描 ~/.pi/nodes/（用户级）+ <项目>/.pi/nodes/（项目级）
 * 加载 JSON 声明 + 可选 JS 实现（ESM）
 */
import { EventEmitter } from "node:events";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

export const USER_NODES_DIR = path.join(os.homedir(), ".pi", "nodes");

/** 端口类型注册表（可扩展） */
export const TYPES = ["text", "image", "file", "path", "fact", "searchresult", "any"];

export function isValidType(t) {
  return TYPES.includes(t);
}

export function isTypeCompatible(from, to) {
  if (!from || !to) return false;
  return from === to || from === "any" || to === "any";
}

const NAME_RE = /^[a-z][a-z0-9_]*$/;
export function isValidNodeName(name) {
  return typeof name === "string" && NAME_RE.test(name) && name.length <= 40;
}

export class NodeRegistry extends EventEmitter {
  constructor({ projectDir } = {}) {
    super();
    this.projectDir = projectDir || null;
    this.nodes = new Map(); // name -> definition
    this.errors = []; // 加载错误列表
  }

  async init() {
    await this.reload();
  }

  dirs() {
    const dirs = [USER_NODES_DIR];
    if (this.projectDir) dirs.push(path.join(this.projectDir, ".pi", "nodes"));
    return dirs;
  }

  async reload() {
    const nodes = new Map();
    const errors = [];
    for (const dir of this.dirs()) {
      let files = [];
      try {
        files = await readdir(dir, { withFileTypes: true });
      } catch {
        continue; // 目录不存在
      }
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".json")) continue;
        const filePath = path.join(dir, f.name);
        try {
          const raw = await readFile(filePath, "utf-8");
          const def = JSON.parse(raw);
          const err = validateDefinition(def, filePath);
          if (err) {
            errors.push({ path: filePath, error: err });
            continue;
          }
          def.filePath = filePath;
          def.dir = dir;
          def.source = dir === USER_NODES_DIR ? "user" : "project";
          // 预加载 JS 实现
          if (def.implementation) {
            const implPath = path.join(dir, def.implementation);
            def.implementationPath = implPath;
          }
          nodes.set(def.name, def);
        } catch (e) {
          errors.push({ path: filePath, error: e?.message || String(e) });
        }
      }
    }
    this.nodes = nodes;
    this.errors = errors;
    this.emit("change", this.list());
  }

  /** 加载某个节点的 JS 实现（带缓存破坏） */
  async loadImplementation(def) {
    if (!def.implementationPath) return null;
    const url = pathToFileURL(def.implementationPath).href + `?t=${Date.now()}`;
    const mod = await import(url);
    return mod.default || null;
  }

  get(name) {
    return this.nodes.get(name);
  }

  list() {
    return [...this.nodes.values()].map((d) => ({
      name: d.name,
      label: d.label,
      description: d.description,
      category: d.category || "agent",
      inputs: d.inputs,
      outputs: d.outputs,
      source: d.source,
      hasImplementation: !!d.implementationPath,
      systemPrompt: d.systemPrompt ? d.systemPrompt.slice(0, 200) : "",
    }));
  }

  /** AI 创建节点（create_node 工具调用） */
  async create(def, code) {
    const err = validateDefinition(def, "<create_node>");
    if (err) throw new Error(err);
    await mkdir(USER_NODES_DIR, { recursive: true });
    await writeFile(
      path.join(USER_NODES_DIR, `${def.name}.json`),
      JSON.stringify(def, null, 2),
      "utf-8"
    );
    if (code) {
      if (typeof code !== "string" || !code.includes("export default")) {
        throw new Error("JS 实现必须包含 export default");
      }
      await writeFile(
        path.join(USER_NODES_DIR, `${def.name}.js`),
        code,
        "utf-8"
      );
      def.implementation = `${def.name}.js`;
      await writeFile(
        path.join(USER_NODES_DIR, `${def.name}.json`),
        JSON.stringify(def, null, 2),
        "utf-8"
      );
    }
    await this.reload();
    return this.get(def.name);
  }
}

export function validateDefinition(def, filePath) {
  if (!def || typeof def !== "object") return "节点声明必须是 JSON 对象";
  if (!isValidNodeName(def.name)) {
    return `name 非法（需小写英文+下划线）: ${def?.name}`;
  }
  if (!Array.isArray(def.inputs) || def.inputs.length === 0) {
    return "inputs 不能为空";
  }
  if (!Array.isArray(def.outputs) || def.outputs.length === 0) {
    return "outputs 不能为空";
  }
  const seenIn = new Set();
  for (const p of def.inputs) {
    if (!p || typeof p.name !== "string" || !p.name) {
      return "输入端口缺少 name";
    }
    if (seenIn.has(p.name)) return `输入端口名重复: ${p.name}`;
    seenIn.add(p.name);
    if (!isValidType(p.type)) return `端口类型非法: ${p.type}`;
  }
  const seenOut = new Set();
  for (const p of def.outputs) {
    if (!p || typeof p.name !== "string" || !p.name) {
      return "输出端口缺少 name";
    }
    if (seenOut.has(p.name)) return `输出端口名重复: ${p.name}`;
    seenOut.add(p.name);
    if (!isValidType(p.type)) return `端口类型非法: ${p.type}`;
  }
  if (def.implementation && typeof def.implementation !== "string") {
    return "implementation 必须是文件名";
  }
  return null;
}
