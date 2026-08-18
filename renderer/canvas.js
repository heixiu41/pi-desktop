/* Pi 节点画布 —— ComfyUI 风格节点编辑器 */
const $ = (s) => document.querySelector(s);

const canvasWrap = $("#canvasWrap");
const world = $("#world");
const edgeLayer = $("#edgeLayer");
const nodeLayer = $("#nodeLayer");
const boxSelect = $("#boxSelect");
const bpName = $("#bpName");
const runBtn = $("#runBtn");
const debugBtn = $("#debugBtn");
const stopBtn = $("#stopBtn");
const newBtn = $("#newBtn");
const saveBtn = $("#saveBtn");
const loadBtn = $("#loadBtn");
const loadMenu = $("#loadMenu");
const loadSearch = $("#loadSearch");
const loadList = $("#loadList");
const libBtn = $("#libBtn");
const closeBtn = $("#closeBtn");
const statusText = $("#statusText");
const statInfo = $("#statInfo");
const sidePanel = $("#sidePanel");
const panelResizer = $("#panelResizer");
const configModal = $("#configModal");
const ctxMenu = $("#ctxMenu");
const delSelBtn = $("#delSelBtn");

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- 状态 ---------- */
const state = {
  graph: { id: null, name: "", description: "", nodes: [], edges: [], version: 1 },
  view: { x: 60, y: 60, zoom: 1 },
  selection: new Set(),
  selectedEdge: null,
  nodeEls: new Map(), // id -> el
  runState: new Map(), // id -> { status, progressText, output, error }
  currentRunId: null,
  registry: [],
  presets: [],
  saved: [],
  models: [],
  logs: [], // run logs
  seq: 1,
  enteredNodes: new Set(), // 已播放创建动画的节点
  enteredEdges: new Set(), // 已播放创建动画的连线
};

const TYPE_COLOR = {
  text: "#7ee0c3",
  image: "#f0a35e",
  file: "#7aa2f7",
  path: "#b39df2",
  any: "#8b949e",
};

const nid = () => {
  let id;
  do {
    id = `n${state.seq++}`;
  } while (state.graph.nodes.some((n) => n.id === id));
  return id;
};
const eid = () => {
  let id;
  do {
    id = `e${state.seq++}`;
  } while (state.graph.edges.some((e) => e.id === id));
  return id;
};

/** 加载/新建蓝图后同步 id 计数器，避免与蓝图里的 n1/n2 等重复 */
function syncSeq() {
  let max = 0;
  for (const n of state.graph.nodes) {
    const m = String(n.id).match(/^n(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  for (const e of state.graph.edges) {
    const m = String(e.id).match(/^e(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  state.seq = max + 1;
}

/* ---------- 端口定义 ---------- */
function nodePorts(node) {
  if (node.type === "input")
    return { inputs: [], outputs: [{ name: "out", type: "any", label: "输出" }] };
  if (node.type === "output")
    return { inputs: [{ name: "in", type: "any", label: "输入" }], outputs: [] };
  if (node.type === "agent")
    return {
      inputs: [
        { name: "context", type: "any", label: "context" },
        { name: "files", type: "file", label: "files" },
      ],
      outputs: [{ name: "text", type: "text", label: "text" }],
    };
  if (node.type === "retrieve")
    return {
      inputs: [{ name: "query", type: "any", label: "查询" }],
      outputs: [{ name: "result", type: "text", label: "检索结果" }],
    };
  if (node.type === "conference")
    return {
      inputs: [{ name: "topic", type: "any", label: "话题" }],
      outputs: [{ name: "transcript", type: "text", label: "对话记录" }],
    };
  const custom = state.registry.find((r) => r.name === node.type);
  if (custom) return { inputs: custom.inputs, outputs: custom.outputs };
  return { inputs: [], outputs: [] };
}

/* ---------- 渲染 ---------- */
function applyView() {
  world.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`;
}

function renderNodes() {
  nodeLayer.innerHTML = "";
  state.nodeEls.clear();
  for (const node of state.graph.nodes) {
    nodeLayer.appendChild(buildNodeEl(node));
  }
}

function buildNodeEl(node) {
  const el = document.createElement("div");
  el.className = "node";
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.dataset.id = node.id;
  // 新节点播放创建动画（仅一次）
  if (!state.enteredNodes.has(node.id)) {
    el.classList.add("node-enter");
    state.enteredNodes.add(node.id);
  }
  const rs = state.runState.get(node.id) || {};
  if (rs.status) el.classList.add(`status-${rs.status}`);
  if (state.selection.has(node.id)) el.classList.add("selected");

  const { inputs, outputs } = nodePorts(node);
  const inputHtml = inputs
    .map(
      (p) => `<div class="port" data-port="${p.name}">
        <span class="sock" data-type="${p.type}"></span><span>${esc(p.label || p.name)}</span>
      </div>`
    )
    .join("");
  const outputHtml = outputs
    .map(
      (p) => `<div class="port out" data-port="${p.name}">
        <span>${esc(p.label || p.name)}</span><span class="sock" data-type="${p.type}"></span>
      </div>`
    )
    .join("");

  const progressHtml =
    rs.status === "running"
      ? `<div class="node-progress"><div class="bar"></div></div>`
      : "";
  const previewHtml =
    rs.status === "done" && rs.output
      ? `<div class="node-output-preview" title="点击展开完整输出">${esc(rs.output.slice(0, 200))}</div>`
      : "";
  const fullHtml =
    rs.status === "done" && rs.output
      ? `<div class="node-output-full">${esc(rs.output)}</div>`
      : "";
  const errHtml = rs.error
      ? `<div class="node-error">✗ ${esc(rs.error)}</div>`
      : "";
  const runningText =
    rs.status === "running" && rs.progressText
      ? `<div class="node-output-preview">${esc(rs.progressText.slice(-180))}</div>`
      : "";

  el.innerHTML = `
    <div class="node-head">
      <span class="node-title">${esc(node.title || node.type)}</span>
      <span class="node-type-tag">${esc(node.type)}</span>
      <button class="node-gear" title="配置">${PiIcon.svg("gear")}</button>
    </div>
    <div class="node-ports">
      <div class="node-inputs">${inputHtml}</div>
      <div class="node-outputs">${outputHtml}</div>
    </div>
    <div class="node-foot">
      ${progressHtml}${runningText}${previewHtml}${fullHtml}${errHtml}
    </div>`;

  el.addEventListener("pointerdown", (e) => {
    const gear = e.target.closest(".node-gear");
    if (gear) {
      e.stopPropagation();
      openConfig(node.id);
      return;
    }
    const head = e.target.closest(".node-head");
    if (head) {
      e.stopPropagation();
      selectNode(node.id, e.shiftKey);
      startNodeDrag(e);
    }
  });
  el.addEventListener("dblclick", (e) => {
    if (!e.target.closest(".node-gear")) openConfig(node.id);
  });
  el.addEventListener("click", (e) => {
    const prev = e.target.closest(".node-output-preview");
    if (prev) {
      el.classList.toggle("expanded");
      if (el.classList.contains("expanded")) {
        const full = el.querySelector(".node-output-full");
        full.scrollTop = 0;
      }
    }
  });

  state.nodeEls.set(node.id, el);
  return el;
}

function updateNodeCard(id) {
  const el = state.nodeEls.get(id);
  if (!el) return;
  const node = state.graph.nodes.find((n) => n.id === id);
  if (node) el.replaceWith(buildNodeEl(node));
}

function updateNodeCards() {
  for (const id of state.nodeEls.keys()) updateNodeCard(id);
}

function renderEdges() {
  edgeLayer.innerHTML = "";
  const svgNS = "http://www.w3.org/2000/svg";
  for (const edge of state.graph.edges) {
    const d = edgeD(edge);
    // 宽透明点击区域（优先渲染在底下）
    const hit = document.createElementNS(svgNS, "path");
    hit.setAttribute("class", "edge hit" + (state.selectedEdge === edge.id ? " selected" : ""));
    hit.dataset.id = edge.id;
    hit.setAttribute("d", d);
    hit.addEventListener("click", (e) => {
      e.stopPropagation();
      state.selectedEdge = edge.id;
      state.selection.clear();
      renderEdges();
      renderNodes();
      updateStatInfo();
    });
    hit.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.selectedEdge = edge.id;
      renderEdges();
      showCtxMenu(e.clientX, e.clientY, [
        { label: `${PiIcon.svg("trash")} 删除连线`, action: () => removeEdge(edge.id) },
      ]);
    });
    edgeLayer.appendChild(hit);
    // 可见连线
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("class", "edge" + (state.selectedEdge === edge.id ? " selected" : ""));
    path.setAttribute("d", d);
    // 新连线播放自绘动画（仅一次）
    if (!state.enteredEdges.has(edge.id)) {
      path.classList.add("edge-enter");
      state.enteredEdges.add(edge.id);
    }
    edgeLayer.appendChild(path);
  }
}

function removeEdge(id) {
  state.graph.edges = state.graph.edges.filter((x) => x.id !== id);
  if (state.selectedEdge === id) state.selectedEdge = null;
  renderEdges();
  updateStatInfo();
}

function edgeD(edge) {
  const a = sockPos(edge.from, edge.fromPort, "outputs");
  const b = sockPos(edge.to, edge.toPort, "inputs");
  if (!a || !b) return "";
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function sockPos(nodeId, port, kind) {
  const el = state.nodeEls.get(nodeId);
  if (!el) return null;
  // 输入/输出口可能同名（如 fact_deduper 的 facts），必须按 kind 限定选择器，
  // 否则 querySelector 会命中先渲染的输入口，导致输出连线锚定到输入 socket。
  const sel =
    kind === "outputs"
      ? `.port.out[data-port="${port}"] .sock`
      : kind === "inputs"
        ? `.port:not(.out)[data-port="${port}"] .sock`
        : `.port[data-port="${port}"] .sock`;
  const sock = el.querySelector(sel);
  if (!sock) return null;
  // world.getBoundingClientRect() 已包含平移/缩放变换（原点即画布原点+view 偏移），
  // 因此 socket 相对 world 原点的偏移除以 zoom 就是世界坐标，不能再减 view
  const wr = world.getBoundingClientRect();
  const r = sock.getBoundingClientRect();
  return {
    x: (r.left - wr.left + r.width / 2) / state.view.zoom,
    y: (r.top - wr.top + r.height / 2) / state.view.zoom,
  };
}

function renderAll() {
  renderNodes();
  renderEdges();
}

/* ---------- 视图交互 ---------- */
let drag = null; // {type, ...}

function screenToWorld(sx, sy) {
  const wr = canvasWrap.getBoundingClientRect();
  const rx = sx - wr.left;
  const ry = sy - wr.top;
  return { x: (rx - state.view.x) / state.view.zoom, y: (ry - state.view.y) / state.view.zoom };
}

canvasWrap.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".node") || e.target.closest(".edge")) return;
  if (e.target.closest(".sock")) return; // 由 nodeLayer 处理
  if (e.shiftKey) {
    drag = { type: "box", x0: e.clientX, y0: e.clientY };
    boxSelect.hidden = false;
  } else {
    drag = { type: "pan", lastX: e.clientX, lastY: e.clientY };
    canvasWrap.style.cursor = "grabbing";
  }
  clearSelection();
});

canvasWrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  const nz = Math.min(2.2, Math.max(0.25, state.view.zoom * factor));
  const wr = canvasWrap.getBoundingClientRect();
  const mx = e.clientX - wr.left;
  const my = e.clientY - wr.top;
  state.view.x = mx - ((mx - state.view.x) / state.view.zoom) * nz;
  state.view.y = my - ((my - state.view.y) / state.view.zoom) * nz;
  state.view.zoom = nz;
  applyView();
}, { passive: false });

window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (drag.type === "pan") {
    state.view.x += e.clientX - drag.lastX;
    state.view.y += e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    applyView();
  } else if (drag.type === "box") {
    const wr = canvasWrap.getBoundingClientRect();
    const x = Math.min(drag.x0, e.clientX) - wr.left;
    const y = Math.min(drag.y0, e.clientY) - wr.top;
    const w = Math.abs(e.clientX - drag.x0);
    const h = Math.abs(e.clientY - drag.y0);
    boxSelect.style.left = x + "px";
    boxSelect.style.top = y + "px";
    boxSelect.style.width = w + "px";
    boxSelect.style.height = h + "px";
    // 实时框选
    for (const node of state.graph.nodes) {
      const el = state.nodeEls.get(node.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const hit =
        r.left < Math.max(drag.x0, e.clientX) &&
        r.right > Math.min(drag.x0, e.clientX) &&
        r.top < Math.max(drag.y0, e.clientY) &&
        r.bottom > Math.min(drag.y0, e.clientY);
      el.classList.toggle("selected", hit);
      if (hit) state.selection.add(node.id);
      else state.selection.delete(node.id);
    }
    updateStatInfo();
  } else if (drag.type === "node") {
    const w = screenToWorld(e.clientX, e.clientY);
    const dx = w.x - drag.wx;
    const dy = w.y - drag.wy;
    drag.wx = w.x;
    drag.wy = w.y;
    for (const id of drag.ids) {
      const node = state.graph.nodes.find((n) => n.id === id);
      if (node) {
        node.x = Math.round(node.x + dx);
        node.y = Math.round(node.y + dy);
        const el = state.nodeEls.get(id);
        if (el) {
          el.style.left = node.x + "px";
          el.style.top = node.y + "px";
        }
      }
    }
    renderEdges();
  } else if (drag.type === "connect") {
    const w = screenToWorld(e.clientX, e.clientY);
    const a = sockPos(drag.from, drag.fromPort, "outputs");
    if (a) {
      const dx = Math.max(40, Math.abs(w.x - a.x) / 2);
      drag.ghost.setAttribute(
        "d",
        `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${w.x - dx} ${w.y}, ${w.x} ${w.y}`
      );
    }
  }
});

window.addEventListener("pointerup", (e) => {
  if (!drag) return;
  if (drag.type === "pan") {
    canvasWrap.style.cursor = "";
  } else if (drag.type === "box") {
    boxSelect.hidden = true;
  } else if (drag.type === "connect") {
    drag.ghost.remove();
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const sock = target?.closest(".sock");
    if (sock) {
      const portEl = sock.closest(".port");
      const nodeEl = sock.closest(".node");
      if (portEl && nodeEl && !portEl.classList.contains("out")) {
        addEdge(drag.from, drag.fromPort, nodeEl.dataset.id, portEl.dataset.port);
      }
    }
  }
  drag = null;
  updateStatInfo();
});

/* ---------- 节点操作 ---------- */
function selectNode(id, additive) {
  if (!additive) state.selection.clear();
  state.selection.add(id);
  state.selectedEdge = null;
  renderNodes();
  updateStatInfo();
}

function clearSelection() {
  state.selection.clear();
  state.selectedEdge = null;
  renderNodes();
  updateStatInfo();
}

function startNodeDrag(e) {
  const nodeEl = e.target.closest(".node");
  const ids = state.selection.has(nodeEl.dataset.id)
    ? [...state.selection]
    : [nodeEl.dataset.id];
  const w = screenToWorld(e.clientX, e.clientY);
  drag = { type: "node", ids, wx: w.x, wy: w.y };
  // 防止文本选择
  e.preventDefault();
}

function addNode(type, x, y, config) {
  const node = {
    id: nid(),
    type,
    title: defaultTitle(type),
    x: Math.round(x),
    y: Math.round(y),
    config: config || {},
  };
  state.graph.nodes.push(node);
  renderAll();
  return node;
}

function defaultTitle(type) {
  if (type === "input") return "输入";
  if (type === "output") return "输出";
  if (type === "agent") return "智能体";
  const c = state.registry.find((r) => r.name === type);
  return c?.label || type;
}

function addEdge(from, fromPort, to, toPort) {
  // 类型兼容检查
  const fPort = nodePortOf(state.graph.nodes.find((n) => n.id === from), fromPort, "outputs");
  const tPort = nodePortOf(state.graph.nodes.find((n) => n.id === to), toPort, "inputs");
  const compat =
    !fPort ||
    !tPort ||
    fPort.type === "any" ||
    tPort.type === "any" ||
    fPort.type === tPort.type;
  if (!compat) {
    statusText.textContent = `类型不兼容：${fPort?.type} → ${tPort?.type}`;
    return;
  }
  // 允许同一输入口接多条线（多路合并）；仅拒绝自身环和类型不兼容
  if (from === to) {
    statusText.textContent = "不能连接自身";
    return;
  }
  state.graph.edges.push({ id: eid(), from, fromPort, to, toPort });
  renderAll();
  statusText.textContent = "就绪";
}

function nodePortOf(node, port, kind) {
  if (!node) return null;
  const { inputs, outputs } = nodePorts(node);
  return (kind === "inputs" ? inputs : outputs).find((p) => p.name === port);
}

/* 输出口连线起始 */
nodeLayer.addEventListener("pointerdown", (e) => {
  const sock = e.target.closest(".sock");
  if (!sock) return;
  const portEl = sock.closest(".port");
  if (!portEl.classList.contains("out")) return;
  e.stopPropagation();
  const nodeEl = sock.closest(".node");
  const from = nodeEl.dataset.id;
  const fromPort = portEl.dataset.port;
  const svgNS = "http://www.w3.org/2000/svg";
  const ghost = document.createElementNS(svgNS, "path");
  ghost.setAttribute("class", "edge ghost");
  edgeLayer.appendChild(ghost);
  drag = { type: "connect", from, fromPort, ghost };
});

/* ---------- 右键菜单 ---------- */
function showCtxMenu(x, y, items) {
  ctxMenu.innerHTML = "";
  for (const it of items) {
    const el = document.createElement("div");
    el.className = "ctx-item" + (it.danger ? " danger" : "");
    el.innerHTML = it.label;
    el.addEventListener("click", () => {
      hideCtxMenu();
      it.action();
    });
    ctxMenu.appendChild(el);
  }
  ctxMenu.hidden = false;
  const rect = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
  ctxMenu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
}
function hideCtxMenu() {
  ctxMenu.hidden = true;
}
window.addEventListener("pointerdown", (e) => {
  if (!ctxMenu.hidden && !e.target.closest("#ctxMenu")) hideCtxMenu();
});
window.addEventListener("blur", hideCtxMenu);

// 节点右键菜单
nodeLayer.addEventListener("contextmenu", (e) => {
  const nodeEl = e.target.closest(".node");
  if (!nodeEl) return;
  e.preventDefault();
  e.stopPropagation();
  const id = nodeEl.dataset.id;
  const node = state.graph.nodes.find((n) => n.id === id);
  selectNode(id, false);
  showCtxMenu(e.clientX, e.clientY, [
    { label: `${PiIcon.svg("gear")} 配置节点`, action: () => openConfig(id) },
    { label: `${PiIcon.svg("copy")} 复制节点`, action: () => duplicateNode(id) },
    { label: `${PiIcon.svg("trash")} 删除节点`, action: () => deleteNodes([id]), danger: true },
  ]);
});
// 空白处右键：快捷加节点
canvasWrap.addEventListener("contextmenu", (e) => {
  if (e.target.closest(".node") || e.target.closest(".edge")) return;
  e.preventDefault();
  showCtxMenu(e.clientX, e.clientY, [
    { label: `${PiIcon.svg("plus")} 添加输入节点`, action: () => addNode("input", ...screenToWorldArr(e)) },
    { label: `${PiIcon.svg("plus")} 添加输出节点`, action: () => addNode("output", ...screenToWorldArr(e)) },
    { label: `${PiIcon.svg("plus")} 添加智能体节点`, action: () => addNode("agent", ...screenToWorldArr(e)) },
  ]);
});
function screenToWorldArr(e) {
  const w = screenToWorld(e.clientX, e.clientY);
  return [w.x - 120, w.y - 30];
}

function deleteNodes(ids) {
  const set = new Set(ids);
  state.graph.nodes = state.graph.nodes.filter((n) => !set.has(n.id));
  state.graph.edges = state.graph.edges.filter(
    (e) => !set.has(e.from) && !set.has(e.to)
  );
  for (const id of ids) {
    state.selection.delete(id);
    state.runState.delete(id);
  }
  renderAll();
  updateStatInfo();
}

function duplicateNode(id) {
  const src = state.graph.nodes.find((n) => n.id === id);
  if (!src) return;
  const copy = {
    ...structuredClone(src),
    id: nid(),
    x: src.x + 40,
    y: src.y + 40,
  };
  state.graph.nodes.push(copy);
  state.selection.clear();
  state.selection.add(copy.id);
  renderAll();
  updateStatInfo();
}

// 状态栏：删除选中（节点或连线）
delSelBtn.addEventListener("click", () => {
  if (state.selectedEdge) {
    removeEdge(state.selectedEdge);
  } else if (state.selection.size) {
    deleteNodes([...state.selection]);
  }
});

/* ---------- 键盘 ---------- */
window.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select")) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (state.selectedEdge) {
      removeEdge(state.selectedEdge);
    } else if (state.selection.size) {
      deleteNodes([...state.selection]);
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveBlueprint();
  }
});

/* ---------- 配置弹窗 ---------- */
let cfgNodeId = null;
function openConfig(id) {
  const node = state.graph.nodes.find((n) => n.id === id);
  if (!node) return;
  cfgNodeId = id;
  $("#cfgName").value = node.title || "";
  const isAgent = node.type === "agent" || state.registry.some((r) => r.name === node.type && !r.hasImplementation);
  $("#cfgAgentFields").style.display = isAgent ? "" : "none";
  $("#cfgInputFields").style.display = node.type === "input" ? "" : "none";
  $("#cfgRetrieveFields").style.display = node.type === "retrieve" ? "" : "none";
  $("#cfgConferenceFields").style.display = node.type === "conference" ? "" : "none";
  if (isAgent) {
    $("#cfgSystemPrompt").value = node.config?.systemPrompt || "";
    $("#cfgModel").value = node.config?.model ? `${node.config.model.provider}/${node.config.model.id}` : "";
    $("#cfgThinking").value = node.config?.thinkingLevel || "";
    $("#cfgTemp").value = node.config?.temperature ?? "";
    $("#cfgMaxCtx").value = node.config?.maxContext ?? "";
    $("#cfgTools").value = (node.config?.tools || []).join(", ");
    $("#cfgCarry").checked = !!node.config?.carryContext;
  }
  if (node.type === "input") {
    const c = node.config?.content;
    if (typeof c === "string") {
      $("#cfgContent").value = c;
      $("#cfgPath").value = "";
    } else if (c?.path) {
      $("#cfgContent").value = "";
      $("#cfgPath").value = c.path;
    }
  }
  if (node.type === "retrieve") {
    $("#cfgTopK").value = node.config?.k ?? 4;
  }
  if (node.type === "conference") {
    $("#cfgRounds").value = node.config?.rounds ?? 2;
    $("#cfgMaxRounds").value = node.config?.maxRounds ?? 6;
    $("#cfgJudge").value = node.config?.judge
      ? JSON.stringify(node.config.judge, null, 2)
      : "";
    $("#cfgParticipants").value = node.config?.participants
      ? JSON.stringify(node.config.participants, null, 2)
      : "";
  }
  configModal.hidden = false;
  $("#cfgTitle").textContent = `配置节点：${node.title}`;
}

function closeConfig() {
  configModal.hidden = true;
  cfgNodeId = null;
}

$("#cfgClose").addEventListener("click", closeConfig);
$("#cfgSave").addEventListener("click", () => {
  const node = state.graph.nodes.find((n) => n.id === cfgNodeId);
  if (!node) return;
  node.title = $("#cfgName").value.trim() || node.title;
  const isAgent = node.type === "agent" || state.registry.some((r) => r.name === node.type && !r.hasImplementation);
  if (isAgent) {
    const cfg = { ...(node.config || {}) };
    cfg.systemPrompt = $("#cfgSystemPrompt").value;
    const mv = $("#cfgModel").value;
    cfg.model = mv ? { provider: mv.split("/")[0], id: mv.split("/")[1] } : null;
    cfg.thinkingLevel = $("#cfgThinking").value || undefined;
    cfg.temperature = $("#cfgTemp").value === "" ? undefined : Number($("#cfgTemp").value);
    cfg.maxContext = $("#cfgMaxCtx").value === "" ? undefined : Number($("#cfgMaxCtx").value);
    cfg.tools = $("#cfgTools").value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    cfg.carryContext = $("#cfgCarry").checked;
    node.config = cfg;
  }
  if (node.type === "input") {
    const text = $("#cfgContent").value;
    const p = $("#cfgPath").value.trim();
    node.config = {
      content: p
        ? { type: "path", path: p }
        : text,
    };
  }
  if (node.type === "retrieve") {
    const k = Number($("#cfgTopK").value);
    node.config = { ...(node.config || {}), k: k > 0 ? k : 4 };
  }
  if (node.type === "conference") {
    const rounds = Number($("#cfgRounds").value);
    const maxRounds = Number($("#cfgMaxRounds").value);
    let participants = node.config?.participants;
    let judge = node.config?.judge;
    try {
      const parsed = JSON.parse($("#cfgParticipants").value || "[]");
      if (Array.isArray(parsed) && parsed.length) participants = parsed;
    } catch {
      /* 保留 */
    }
    try {
      const j = JSON.parse($("#cfgJudge").value || "null");
      if (j && typeof j === "object") judge = j;
    } catch {
      /* 保留 */
    }
    node.config = {
      ...(node.config || {}),
      rounds: rounds >= 0 ? rounds : 2,
      maxRounds: maxRounds > 0 ? maxRounds : 6,
      participants,
      judge,
    };
  }
  renderAll();
  closeConfig();
});

configModal.addEventListener("click", (e) => {
  if (e.target === configModal) closeConfig();
});

/* ---------- 工具栏 ---------- */
runBtn.addEventListener("click", () => {
  if (!state.graph.nodes.length) {
    statusText.textContent = "画布为空，先添加节点（右侧面板节点库点击添加）";
    return;
  }
  doRun(null);
});
debugBtn.addEventListener("click", () => {
  if (!state.selection.size) {
    statusText.textContent = "请先选中要调试运行的节点";
    return;
  }
  PiIcon.play(debugBtn, "pulse", 1200);
  doRun([...state.selection]);
});
stopBtn.addEventListener("click", () => {
  PiIcon.reset(runBtn);
  if (state.currentRunId) window.pi.nodeAbort(state.currentRunId);
});
newBtn.addEventListener("click", () => {
  if (state.graph.nodes.length && !confirm("丢弃当前画布，新建空白蓝图？")) return;
  state.graph = { id: null, name: "", description: "", nodes: [], edges: [], version: 1 };
  state.runState.clear();
  state.selection.clear();
  syncSeq();
  bpName.value = "";
  renderAll();
  statusText.textContent = "已新建空白蓝图";
});
saveBtn.addEventListener("click", saveBlueprint);
closeBtn.addEventListener("click", () => window.close());

function saveBlueprint() {
  state.graph.name = bpName.value.trim() || state.graph.name || "未命名蓝图";
  bpName.value = state.graph.name;
  window.pi.nodeSave(JSON.parse(JSON.stringify(state.graph))).then((res) => {
    if (res.ok) {
      PiIcon.play(saveBtn, "flash", 900); // 软盘读写灯闪烁
      state.graph.id = res.blueprint.id;
      statusText.textContent = `已保存：${res.blueprint.name}`;
      refreshBlueprints();
    } else {
      statusText.textContent = `保存失败：${res.error}`;
    }
  });
}

function doRun(selection) {
  const graph = JSON.parse(JSON.stringify(state.graph));
  graph.name = bpName.value.trim() || graph.name || "未命名蓝图";
  state.runState.clear();
  renderNodes();
  window.pi.nodeRun(graph, selection).then((res) => {
    if (!res.ok) {
      statusText.textContent = `运行失败：${res.error}`;
      return;
    }
    state.currentRunId = res.runId;
    PiIcon.play(runBtn, "pulse", 0); // 运行中：常驻脉冲
    stopBtn.hidden = false;
    statusText.textContent = `运行中（${res.runId.slice(0, 8)}）…`;
  });
}

// 运行结束后清除运行按钮脉冲（轮询 run 状态，运行/中止/出错都会结束）
function watchRunEnd(runId) {
  clearInterval(state._runWatch);
  state._runWatch = setInterval(async () => {
    const run = await window.pi.nodeGetRun(runId);
    if (!run || run.status !== "running") {
      clearInterval(state._runWatch);
      state._runWatch = null;
      PiIcon.reset(runBtn);
      stopBtn.hidden = true;
    }
  }, 1500);
}

/* ---------- 蓝图库菜单（自定义下拉 + 搜索 + 分组） ---------- */
const CATEGORY_META = {
  fix: { label: "修复流水线", icon: "🔧" },
  growth: { label: "自生长", icon: "🌱" },
  research: { label: "调研", icon: "🔍" },
  tool: { label: "工具", icon: "🛠️" },
  demo: { label: "演示", icon: "🎓" },
};

function loadBlueprint(kind, id) {
  loadMenu.hidden = true;
  window.pi.nodeLoad(id, kind === "preset").then((res) => {
    if (res?.ok && res.blueprint) {
      state.graph = res.blueprint;
      state.graph.id = state.graph.id || null;
      state.runState.clear();
      state.selection.clear();
      syncSeq();
      bpName.value = state.graph.name || "";
      renderAll();
      statusText.textContent = `已加载：${state.graph.name || id}`;
    } else {
      statusText.textContent = `加载失败：${res?.error || "未知错误"}`;
    }
  });
}

function renderLoadMenu() {
  const q = loadSearch.value.trim().toLowerCase();
  const hit = (name, desc) =>
    !q || String(name || "").toLowerCase().includes(q) || String(desc || "").toLowerCase().includes(q);
  const groups = [];
  const presets = state.presets.filter((p) => hit(p.name, p.description));
  if (presets.length) groups.push({ label: "预设", icon: "📦", items: presets.map((p) => ({ kind: "preset", id: p.id, name: p.name, desc: p.description })) });
  for (const [cat, meta] of Object.entries(CATEGORY_META)) {
    const items = state.saved
      .filter((b) => (b.category || null) === cat && hit(b.name, ""))
      .map((b) => ({ kind: "saved", id: b.id, name: b.name, desc: "" }));
    if (items.length) groups.push({ label: meta.label, icon: meta.icon, items });
  }
  const others = state.saved.filter((b) => !CATEGORY_META[b.category] && hit(b.name, ""));
  if (others.length) groups.push({ label: "其他", icon: "📄", items: others.map((b) => ({ kind: "saved", id: b.id, name: b.name, desc: "" })) });
  loadList.innerHTML = groups.length
    ? groups
        .map(
          (g) =>
            `<div class="load-group"><div class="load-group-label">${g.icon} ${esc(g.label)}<span class="load-count">${g.items.length}</span></div>` +
            g.items
              .map(
                (it) =>
                  `<button class="load-item" data-kind="${it.kind}" data-id="${esc(it.id)}"><span class="load-item-icon">${
                    it.kind === "preset" ? "📦" : ""
                  }</span><span class="load-item-name">${esc(it.name)}</span>${
                    it.desc ? `<span class="load-item-desc">${esc(it.desc)}</span>` : ""
                  }</button>`
              )
              .join("") +
            `</div>`
        )
        .join("")
    : `<div class="load-empty">${q ? "无匹配蓝图" : "暂无蓝图（保存后自动出现在这里）"}</div>`;
}

loadBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = loadMenu.hidden;
  loadMenu.hidden = !open;
  if (open) {
    loadSearch.value = "";
    renderLoadMenu();
    loadSearch.focus();
    // 防超界：仅当菜单超出视口边缘时修正，否则保持按钮居中展开
    requestAnimationFrame(() => {
      const r = loadMenu.getBoundingClientRect();
      if (r.left < 8) loadMenu.style.left = `calc(50% + ${8 - r.left}px)`;
      else if (r.right > innerWidth - 8) loadMenu.style.left = `calc(50% - ${r.right - innerWidth + 8}px)`;
    });
  }
});
loadSearch.addEventListener("input", renderLoadMenu);
loadList.addEventListener("click", (e) => {
  const item = e.target.closest(".load-item");
  if (!item) return;
  loadBlueprint(item.dataset.kind, item.dataset.id);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".load-wrap")) loadMenu.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") loadMenu.hidden = true;
});

libBtn.addEventListener("click", () => {
  const open = sidePanel.hidden;
  sidePanel.hidden = !open;
  document.body.classList.toggle("has-panel", open);
});

/* ---------- 面板拖拽调宽（记忆宽度，悬浮不挤占画布） ---------- */
let panelW = Math.max(200, Math.min(560, Number(localStorage.getItem("sidePanelW")) || 300));
sidePanel.style.width = panelW + "px";
panelResizer.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = panelW;
  const move = (ev) => {
    panelW = Math.max(200, Math.min(560, startW + (startX - ev.clientX)));
    sidePanel.style.width = panelW + "px";
  };
  const up = () => {
    localStorage.setItem("sidePanelW", String(panelW));
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

/* ---------- 右侧面板 ---------- */
document.querySelectorAll(".ptab").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".ptab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".ptab-body").forEach((x) => (x.hidden = x.id !== `tab-${b.dataset.tab}`));
  });
});

function renderLib() {
  const box = $("#tab-lib");
  box.innerHTML = "";
  const items = [
    { name: "input", label: "输入", desc: "提供初始文本/文件", tag: "内置" },
    { name: "output", label: "输出", desc: "汇总最终结果", tag: "内置" },
    { name: "retrieve", label: "检索", desc: "RAG：查询本地知识库，返回相关内容", tag: "内置" },
    { name: "conference", label: "圆桌会议", desc: "多位 AI 多轮对话，彼此能看到全部发言", tag: "内置" },
    { name: "agent", label: "智能体", desc: "系统提示词 + 模型配置，独立 Pi 会话", tag: "内置" },
    ...state.registry.map((r) => ({
      name: r.name,
      label: r.label,
      desc: r.description,
      tag: r.hasImplementation ? "函数" : "智能体",
    })),
  ];
  for (const it of items) {
    const el = document.createElement("div");
    el.className = "lib-item";
    el.innerHTML = `<div class="li-name">${esc(it.label)}</div>
      <div class="li-desc">${esc(it.desc)}</div>
      <span class="li-tag">${esc(it.tag)} · ${esc(it.name)}</span>`;
    el.addEventListener("click", () => {
      const wr = canvasWrap.getBoundingClientRect();
      const cx = (wr.width / 2 - state.view.x) / state.view.zoom - 120;
      const cy = (wr.height / 2 - state.view.y) / state.view.zoom - 40;
      addNode(it.name, cx, cy, {});
      statusText.textContent = `已添加节点：${it.label}`;
    });
    box.appendChild(el);
  }
}

function renderLogs() {
  const box = $("#tab-log");
  box.innerHTML = "";
  if (!state.logs.length) {
    box.innerHTML = '<div style="color:var(--text-dim);font-size:11px;text-align:center">暂无运行记录</div>';
    return;
  }
  for (const log of state.logs) {
    const el = document.createElement("div");
    el.className = "log-run";
    el.innerHTML = `<div class="lr-head"><span>${esc(log.name)}</span><span>${esc(log.status)}</span></div>${log.lines
      .map((l) => `<div class="lr-line ${l.cls || ""}">${esc(l.text)}</div>`)
      .join("")}`;
    box.appendChild(el);
  }
}

function refreshBlueprints() {
  window.pi.nodeGetState().then((st) => {
    state.presets = st.presets || [];
    state.saved = st.saved || [];
    renderBps();
    renderLoadMenu();
  });
}

function renderBps() {
  const box = $("#tab-bps");
  box.innerHTML = "";
  const items = [
    ...state.presets.map((p) => ({ ...p, preset: true })),
    ...state.saved.map((b) => ({ ...b, preset: false })),
  ];
  if (!items.length) {
    box.innerHTML = '<div style="color:var(--text-dim);font-size:11px;text-align:center">暂无蓝图</div>';
    return;
  }
  for (const it of items) {
    const el = document.createElement("div");
    el.className = "bp-item";
    el.innerHTML = `<span class="bp-name-txt">${esc(it.name)}${it.preset ? ' <span style="color:var(--text-dim)">(预设)</span>' : ""}</span>`;
    if (!it.preset) {
      const del = document.createElement("button");
      del.className = "bp-del";
      del.innerHTML = PiIcon.svg("trash");
      del.title = "删除";
      del.addEventListener("click", async () => {
        if (!confirm(`删除蓝图「${it.name}」？`)) return;
        await window.pi.nodeDelete(it.id);
        refreshBlueprints();
      });
      el.appendChild(del);
    }
    el.querySelector(".bp-name-txt").addEventListener("click", async () => {
      const res = await window.pi.nodeLoad(it.id, it.preset);
      if (res.ok) {
        state.graph = res.blueprint;
        state.runState.clear();
        state.selection.clear();
        syncSeq();
        bpName.value = state.graph.name || "";
        renderAll();
        statusText.textContent = `已加载：${state.graph.name || it.id}`;
      }
    });
    box.appendChild(el);
  }
}

/* ---------- 运行事件 ---------- */
function onNodeEvent(ev) {
  if (ev.blueprintId && state.graph.id && ev.blueprintId !== state.graph.id) {
    // 该运行属于另一张蓝图，只记日志
    appendLogLine(ev.runId, ev);
    return;
  }
  const rs = state.runState.get(ev.nodeId) || {};
  if (ev.type === "node-start") {
    rs.status = "running";
    rs.progressText = "";
    rs.output = "";
    rs.error = null;
  } else if (ev.type === "node-update") {
    rs.status = "running";
    rs.progressText = ev.text || "";
  } else if (ev.type === "node-end") {
    rs.status = ev.status;
    if (ev.status === "done") {
      // 从主进程取最终输出
      window.pi.nodeGetRun(ev.runId).then((run) => {
        const n = run?.nodes?.[ev.nodeId];
        if (n && n.output) {
          rs.output = n.output;
          updateNodeCard(ev.nodeId);
        }
      });
    } else {
      rs.error = ev.error || "未知错误";
    }
  }
  state.runState.set(ev.nodeId, rs);
  updateNodeCard(ev.nodeId);
  appendLogLine(ev.runId, ev);
}

function appendLogLine(runId, ev) {
  let log = state.logs.find((l) => l.runId === runId);
  if (!log) {
    log = { runId, name: ev.name || "", status: "运行中", lines: [] };
    state.logs.unshift(log);
  }
  if (ev.type === "node-start") log.lines.push({ text: `▶ ${ev.nodeTitle} 开始` });
  else if (ev.type === "node-update") log.lines.push({ text: `${ev.nodeTitle}: ${(ev.text || "").slice(-80)}` });
  else if (ev.type === "node-end")
    log.lines.push({
      text: ev.status === "done" ? `✓ ${ev.nodeTitle} 完成` : `✗ ${ev.nodeTitle} 失败：${ev.error}`,
      cls: ev.status === "done" ? "ok" : "err",
    });
  renderLogs();
}

function updateStatInfo() {
  const sel = state.selection.size;
  delSelBtn.hidden = !(state.selectedEdge || sel > 0);
  statInfo.textContent = `${state.graph.nodes.length} 节点 · ${state.graph.edges.length} 连线${sel ? ` · 选中 ${sel}` : state.selectedEdge ? " · 选中 1 条连线" : ""}`;
}

/* ---------- 初始化 ---------- */
(async () => {
  window.pi.onEvent("node:init", (d) => {
    state.registry = d.nodes || [];
    state.presets = d.presets || [];
    state.saved = d.saved || [];
    renderLib();
    refreshBlueprints();
  });
  window.pi.onEvent("node:event", onNodeEvent);
  window.pi.onEvent("node:registry", (d) => {
    state.registry = d.nodes || [];
    renderLib();
  });
  window.pi.onEvent("node:blueprints", (d) => {
    state.presets = d.presets || [];
    state.saved = d.saved || [];
    refreshBlueprints();
  });
  window.pi.onEvent("node:run-started", (d) => {
    state.currentRunId = d.runId;
    stopBtn.hidden = false;
    PiIcon.play(runBtn, "pulse", 0);
    watchRunEnd(d.runId);
  });

  const models = await window.pi.getAvailableModels();
  state.models = models;
  const modelSel = $("#cfgModel");
  modelSel.innerHTML = '<option value="">默认</option>' +
    models.map((m) => `<option value="${m.provider}/${m.id}">${esc(m.name)} (${m.provider})</option>`).join("");

  // 加载默认预设（首个运行测试更方便）
  const st = await window.pi.nodeGetState();
  state.registry = st.nodes || [];
  state.presets = st.presets || [];
  state.saved = st.saved || [];
  renderLib();
  refreshBlueprints();

  // 默认载入第一个预设
  if (st.presets?.length) {
    const res = await window.pi.nodeLoad(st.presets[0].id, true);
    if (res.ok) {
      state.graph = res.blueprint;
      state.graph.id = state.graph.id || null;
      bpName.value = state.graph.name || "";
    }
  }
  syncSeq();
  renderAll();
  updateStatInfo();
  window.pi.nodeReady();
})();

/* ============================================================
 * 演示/开发 API（通过遥控通道驱动画布：构建蓝图、连线、运行）
 * ============================================================ */
window.__nodeApi = {
  newGraph(name) {
    state.graph = {
      id: null,
      name: name || "演示蓝图",
      description: "",
      nodes: [],
      edges: [],
      version: 1,
    };
    state.runState.clear();
    state.selection.clear();
    state.enteredNodes.clear();
    state.enteredEdges.clear();
    syncSeq();
    bpName.value = state.graph.name;
    renderAll();
    return true;
  },
  addNode(type, x, y, config) {
    const n = addNode(type, x, y, config);
    return n.id;
  },
  setTitle(id, title) {
    const n = state.graph.nodes.find((x) => x.id === id);
    if (n) n.title = title;
    renderAll();
    return !!n;
  },
  configNode(id, patch) {
    const n = state.graph.nodes.find((x) => x.id === id);
    if (!n) return false;
    n.config = { ...(n.config || {}), ...patch };
    return true;
  },
  addEdge(from, fromPort, to, toPort) {
    const before = state.graph.edges.length;
    addEdge(from, fromPort, to, toPort);
    return state.graph.edges.length > before;
  },
  setInput(id, text) {
    const n = state.graph.nodes.find((x) => x.id === id);
    if (!n) return false;
    n.config = { ...(n.config || {}), content: text };
    return true;
  },
  getGraph() {
    return JSON.parse(JSON.stringify(state.graph));
  },
  async reloadNodes() {
    const res = await window.pi.nodeReload();
    if (res?.ok) {
      state.registry = (await window.pi.nodeGetState()).nodes || [];
      renderLib();
    }
    return res;
  },
  async runAndWait(timeoutMs) {
    const graph = JSON.parse(JSON.stringify(state.graph));
    graph.name = bpName.value.trim() || graph.name || "未命名蓝图";
    state.runState.clear();
    renderNodes();
    // 用 wait=true 单次往返等待完成（事件流仍实时更新节点卡片）
    const res = await window.pi.nodeRun(graph, null, true);
    if (!res.ok) throw new Error(res.error || "运行失败");
    // 兜底同步最终状态
    for (const [id, r] of Object.entries(res.resultsById || {})) {
      const cur = state.runState.get(id) || {};
      if (r.ok) {
        cur.status = "done";
        cur.output = r.output || cur.output || "";
      } else {
        cur.status = "error";
        cur.error = r.error || "运行失败";
      }
      state.runState.set(id, cur);
    }
    updateNodeCards();
    return state.graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      status: state.runState.get(n.id)?.status || "queued",
      output: state.runState.get(n.id)?.output || "",
      error: state.runState.get(n.id)?.error || null,
    }));
  },
};
