/* Pi Desktop renderer — 聊天界面逻辑 */

const $ = (sel) => document.querySelector(sel);

// 顶部栏 / 输入区
const msgList = $("#msgList");
const input = $("#input");
const sendBtn = $("#sendBtn");
const abortBtn = $("#abortBtn");
const newBtn = $("#newBtn");
const cwdBtn = $("#cwdBtn");
const cwdText = $("#cwdText");
const sideCwd = $("#sideCwd");
const sidebar = $("#sidebar");
const sideResize = $("#sideResize");
const statusEl = $("#status");
const modelSelect = $("#modelSelect");
const thinkingSelect = $("#thinkingSelect");
const sideToggle = $("#sideToggle");
const promptBtn = $("#promptBtn");
const promptPanel = $("#promptPanel");
const promptText = $("#promptText");
const promptSaveBtn = $("#promptSaveBtn");
const promptCloseBtn = $("#promptCloseBtn");
const promptStatus = $("#promptStatus");

// 侧边栏 / 下载停靠面板
const chatView = $("#chatView");
const summaryView = $("#summaryView");
const sumEnabled = $("#sumEnabled");
const sumFreq = $("#sumFreq");
const sumRunBtn = $("#sumRunBtn");
const sumList = $("#sumList");
const sumStatus = $("#sumStatus");
const sumHint = $("#sumHint");
const sumStrength = $("#sumStrength");
const dockArea = $("#dockArea");
const dockPanel = $("#dockPanel");
const dockHandle = $("#dockHandle");
const floatControls = $("#floatControls");
const dlBadge = $("#dlBadge");
const dlCount = $("#dlCount");
const dlList = $("#dlList");
const dlEmpty = $("#dlEmpty");
const addDlBtn = $("#addDlBtn");
const addDlPanel = $("#addDlPanel");
const dlUrl = $("#dlUrl");
const dlName = $("#dlName");
const dlDest = $("#dlDest");
const dlDestBtn = $("#dlDestBtn");
const dlStartBtn = $("#dlStartBtn");
const dlNavIco = $("#dlNavIco");
const dlHeadIco = $("#dlHeadIco");
const dlStartIco = $("#dlStartIco");
const dockFloatBtn = $("#dockFloatBtn");
const dockMinBtn = $("#dockMinBtn");
const dockCloseBtn = $("#dockCloseBtn");
const dockDockBtn = $("#dockDockBtn");
const floatCloseBtn = $("#floatCloseBtn");

// API 配置
const apiView = $("#apiView");
const apiStatus = $("#apiStatus");
const apiOverview = $("#apiOverview");
const apiProvider = $("#apiProvider");
const apiKeyInput = $("#apiKeyInput");
const apiKeyToggle = $("#apiKeyToggle");
const apiSaveBtn = $("#apiSaveBtn");
const apiTestBtn = $("#apiTestBtn");
const apiEnvBtn = $("#apiEnvBtn");
const apiKeyHint = $("#apiKeyHint");
const apiModelSelect = $("#apiModelSelect");
const apiApplyModelBtn = $("#apiApplyModelBtn");
const apiModelList = $("#apiModelList");
const apiEnvInfo = $("#apiEnvInfo");
const apiRefreshBtn = $("#apiRefreshBtn");

const navItems = document.querySelectorAll(".nav-item");
const dockSideBtns = document.querySelectorAll(".dock-side-btn");

// 历史记录
const historyList = $("#historyList");
const historyHead = $("#historyHead");
const historyRefreshBtn = $("#historyRefreshBtn");

// 主页
const homeView = $("#homeView");
const homeInput = $("#homeInput");
const homeSendBtn = $("#homeSendBtn");
const homeRunsSection = $("#homeRunsSection");
const homeRuns = $("#homeRuns");
const homeChats = $("#homeChats");
const sideBrand = $(".side-brand");

// 知识库（RAG）
const kbView = $("#kbView");
const kbStatus = $("#kbStatus");
const kbDocCount = $("#kbDocCount");
const kbDocList = $("#kbDocList");
const kbImportBtn = $("#kbImportBtn");
const kbImportPanel = $("#kbImportPanel");
const kbName = $("#kbName");
const kbText = $("#kbText");
const kbImportTextBtn = $("#kbImportTextBtn");
const kbQuery = $("#kbQuery");
const kbSearchBtn = $("#kbSearchBtn");
const kbResults = $("#kbResults");

// 独立窗口模式（?view=float）
const isFloat = new URLSearchParams(location.search).get("view") === "float";

const state = {
  items: [],
  currentAssistantId: null,
  toolCards: new Map(), // toolCallId -> { cardEl, argsEl, resultEl, stateEl, resultText }
  pendingCount: 0,
  cwd: "",
  availableModels: [],
  // 下载
  downloads: new Map(), // id -> task
  dlCards: new Map(), // id -> { el, bar, pctEl, infoEl, badgeEl, nameEl }
  // 停靠面板
  view: "chat",
  dockSide: localStorage.getItem("dock-side") || "right",
  dockSize: parseInt(localStorage.getItem("dock-size"), 10) || 340,
  floating: false,
  // 主页
  homeRuns: [],
  historySessions: [],
  historyArchived: [],
};

let idSeq = 0;
const nextId = () => `item-${++idSeq}`;
const now = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

/* ---------- markdown ---------- */
if (window.marked) {
  marked.setOptions({ gfm: true, breaks: true });
}
function renderMarkdown(text) {
  if (!window.marked) return escapeHtml(text);
  const html = marked.parse(text || "");
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const esc = escapeHtml;

/* ---------- scrolling ---------- */
function nearBottom() {
  return msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight < 120;
}
function scrollToBottom(force = false) {
  if (force || nearBottom()) msgList.scrollTop = msgList.scrollHeight;
}

/* ---------- status ---------- */
function setStatus(text, cls = "") {
  statusEl.textContent = text || "";
  statusEl.className = "status " + cls;
}

/* ---------- items ---------- */
/* 批量渲染辅助：加载长会话时用 DocumentFragment 挂载 + 抑制滚动，避免逐条重排卡顿 */
let batchTarget = null; // DocumentFragment，批量渲染期间挂载到这里
let suppressScroll = false;
function appendToMsgList(el) {
  (batchTarget || msgList).appendChild(el);
}
function maybeScroll() {
  if (!suppressScroll) scrollToBottom();
}

/* 分块渲染会话消息：小会话同步 + DocumentFragment 一次挂载；大会话每 50 条让出主线程 */
async function renderMessages(messages) {
  const total = (messages || []).length;
  if (!total) return;
  const frag = document.createDocumentFragment();
  batchTarget = frag;
  suppressScroll = true;
  const renderOne = (m) => {
    if (m.role === "user") {
      const item = makeUserItem(m.content || "");
      appendToMsgList(item.el);
      state.items.push(item);
    } else if (m.role === "assistant") {
      const item = makeAssistantItem();
      rebuildAssistant(item, m.content || []);
    } else if (m.role === "toolResult") {
      attachToolResult(m.toolCallId, m.content || "", !!m.isError);
    }
  };
  if (total <= 60) {
    for (const m of messages) renderOne(m);
  } else {
    const chunk = 50;
    for (let i = 0; i < total; i += chunk) {
      const end = Math.min(i + chunk, total);
      for (let j = i; j < end; j++) renderOne(messages[j]);
      await new Promise((r) => setTimeout(r, 0)); // 让出主线程，保持 UI 响应
    }
  }
  msgList.appendChild(frag);
  batchTarget = null;
  suppressScroll = false;
}

function makeUserItem(text) {
  const el = document.createElement("div");
  el.className = "msg user";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `<span class="role-tag">我</span><span>${now()}</span>`;
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;
  el.append(meta, body);
  return { id: nextId(), type: "user", el, bodyEl: body };
}

function makeThinkingBlock(text) {
  const details = document.createElement("details");
  details.className = "thinking";
  const summary = document.createElement("summary");
  summary.textContent = "思考过程";
  const body = document.createElement("div");
  body.className = "thinking-body";
  body.textContent = text || "";
  details.append(summary, body);
  return { details, bodyEl: body };
}

function makeToolCard(toolCallId, name, argsText, resultText) {
  const details = document.createElement("details");
  details.className = "tool-card";
  const summary = document.createElement("summary");
  summary.innerHTML = `<span class="tool-name"></span><span class="tool-state"></span>`;
  summary.querySelector(".tool-name").textContent = name;
  const stateEl = summary.querySelector(".tool-state");
  const body = document.createElement("div");
  body.className = "tool-body";
  const argsEl = document.createElement("div");
  argsEl.className = "tool-args";
  argsEl.textContent = argsText || "";
  const resultEl = document.createElement("div");
  resultEl.className = "tool-result";
  resultEl.textContent = resultText || "";
  body.append(argsEl, resultEl);
  details.append(summary, body);
  return { cardEl: details, argsEl, resultEl, stateEl };
}

function makeAssistantItem() {
  const el = document.createElement("div");
  el.className = "msg assistant streaming";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `<span class="role-tag">Pi</span><span>${now()}</span>`;
  const body = document.createElement("div");
  body.className = "body";
  el.append(meta, body);
  appendToMsgList(el);
  const item = {
    id: nextId(),
    type: "assistant",
    el,
    bodyEl: body,
    textArea: null, // markdown 渲染区域
    thinkingBlock: null,
    thinkingText: "",
    text: "",
    completed: false,
  };
  state.items.push(item);
  state.currentAssistantId = item.id;
  maybeScroll();
  return item;
}

function ensureAssistant() {
  if (state.currentAssistantId) {
    const item = state.items.find((i) => i.id === state.currentAssistantId);
    if (item && !item.completed) return item;
  }
  return makeAssistantItem();
}

function ensureTextArea(item) {
  if (!item.textArea) {
    item.textArea = document.createElement("div");
    item.textArea.className = "text-area";
    item.bodyEl.appendChild(item.textArea);
  }
  return item.textArea;
}

function ensureThinking(item) {
  if (!item.thinkingBlock) {
    const t = makeThinkingBlock("");
    item.thinkingBlock = t;
    item.bodyEl.appendChild(t.details);
  }
  return item.thinkingBlock;
}

/* 增量追加流式文本（原始文本，提高性能）
 * 流式期间默认纯文本（平滑无跳动）；停顿一定时长后锁定为 markdown 模式，
 * 之后保持 markdown 不再切回纯文本——避免 textContent/innerHTML 交替导致“抽搐”。
 */
function appendDelta(kind, delta) {
  const item = ensureAssistant();
  if (kind === "text") {
    item.text += delta;
    ensureTextArea(item);
    if (item.mdMode) {
      scheduleMdRender(item); // 已进入 markdown：节流渲染，保持格式
    } else {
      item.textArea.textContent = item.text;
      scheduleMarkdownRender(item); // 停顿后转 markdown
    }
  } else if (kind === "thinking") {
    item.thinkingText += delta;
    ensureThinking(item);
    item.thinkingBlock.bodyEl.textContent = item.thinkingText;
  }
  scrollToBottom();
}

let mdTimer = null;
let mdTimerItem = null;
/* 纯文本 → markdown 的延迟转换：停顿足够久（如段落/代码块间隙）才格式化，
 * 避免流式过程中频繁全量重渲染导致的跳动 */
function scheduleMarkdownRender(item) {
  if (mdTimer) return;
  mdTimerItem = item;
  mdTimer = setTimeout(() => {
    mdTimer = null;
    const cur = mdTimerItem;
    mdTimerItem = null;
    if (cur && cur.textArea && cur.text && !cur.mdMode) {
      cur.mdMode = true;
      cur.textArea.innerHTML = renderMarkdown(cur.text);
    }
    scrollToBottom();
  }, 350);
}

let mdThrottle = null;
let mdThrottleItem = null;
/* markdown 模式下的节流渲染（不阻塞快速流式，且不会切回纯文本） */
function scheduleMdRender(item) {
  if (mdThrottle) return;
  mdThrottleItem = item;
  mdThrottle = setTimeout(() => {
    mdThrottle = null;
    const cur = mdThrottleItem;
    mdThrottleItem = null;
    if (cur && cur.textArea && cur.text) {
      cur.textArea.innerHTML = renderMarkdown(cur.text);
    }
    scrollToBottom();
  }, 120);
}

/* 消息结束：用最终内容重建 assistant 消息体（复用已渲染的 textArea，避免结束瞬间闪烁） */
function rebuildAssistant(item, blocks) {
  const kept = item.textArea;
  item.textArea = null;
  let finalText = "";

  for (const b of blocks || []) {
    if (b.type === "thinking") {
      if (!item.thinkingBlock) {
        const t = makeThinkingBlock(b.text);
        item.thinkingBlock = t;
        item.bodyEl.appendChild(t.details);
      } else {
        item.thinkingBlock.bodyEl.textContent = b.text;
      }
    } else if (b.type === "toolCall") {
      if (!state.toolCards.has(b.id)) {
        const card = makeToolCard(b.id, b.name, b.arguments, "");
        state.toolCards.set(b.id, card);
        item.bodyEl.appendChild(card.cardEl);
      } else {
        const card = state.toolCards.get(b.id);
        if (b.arguments && card.argsEl.textContent !== b.arguments) {
          card.argsEl.textContent = b.arguments;
        }
      }
    } else {
      finalText += b.text || "";
    }
  }

  item.text = finalText;
  item.completed = true;
  item.el.classList.remove("streaming");
  if (finalText) {
    if (kept) {
      item.textArea = kept;
      // 复用节点（不重建，避免闪烁）；appendChild 会把它移到末尾，保持 思考/工具卡 在前、正文在后
      item.bodyEl.appendChild(kept);
    } else {
      ensureTextArea(item);
    }
    item.textArea.innerHTML = renderMarkdown(finalText);
  } else if (kept && kept.isConnected) {
    kept.remove();
  }
  scrollToBottom();
}

function addNotice(text, cls = "") {
  const el = document.createElement("div");
  el.className = "notice " + cls;
  el.textContent = text;
  msgList.appendChild(el);
  scrollToBottom();
}

function attachToolResult(toolCallId, resultText, isError) {
  const card = state.toolCards.get(toolCallId);
  if (!card) return;
  card.resultEl.textContent = resultText;
  card.stateEl.textContent = isError ? "✗ 出错" : "✓ 完成";
  card.stateEl.className = "tool-state" + (isError ? " error" : "");
  maybeScroll();
}

/* ---------- 视图切换（聊天 / 下载停靠面板） ---------- */
function switchView(view) {
  state.view = view;
  navItems.forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
  apiView.hidden = true; // 默认隐藏 API 视图，api 分支再显示（修复切走后残留）
  if (view === "home") {
    dockArea.hidden = true;
    homeView.hidden = false;
    refreshHome();
    setTimeout(() => homeInput.focus(), 50);
  } else {
    homeView.hidden = true;
    dockArea.hidden = false;
  }
  if (view === "downloads") {
    PiIcon.play(dlNavIco, "playing", 1100);
    if (state.floating) {
      window.pi.dlFocusFloat();
      return;
    }
    dockPanel.hidden = false;
    chatView.hidden = false;
    summaryView.hidden = true;
    setTimeout(() => input.blur(), 0);
  } else if (view === "nodes") {
    // 节点画布：独立窗口，导航不保持选中态
    navItems.forEach((b) => b.classList.toggle("active", b.dataset.view === "chat"));
    chatView.hidden = false;
    summaryView.hidden = true;
    window.pi.nodeOpen();
    setTimeout(() => input.focus(), 50);
  } else if (view === "summary") {
    dockPanel.hidden = true;
    chatView.hidden = true;
    summaryView.hidden = false;
    refreshSummary();
  } else if (view === "kb") {
    dockPanel.hidden = true;
    chatView.hidden = true;
    summaryView.hidden = true;
    kbView.hidden = false;
    refreshKb();
  } else if (view === "api") {
    dockPanel.hidden = true;
    chatView.hidden = true;
    summaryView.hidden = true;
    kbView.hidden = true;
    apiView.hidden = false;
    refreshApi();
  } else {
    kbView.hidden = true;
    dockPanel.hidden = true;
    chatView.hidden = false;
    summaryView.hidden = true;
    if (view !== "home") setTimeout(() => input.focus(), 50);
  }
}

/* ---------- 主页 ---------- */

function refreshHome() {
  renderHomeRuns(state.homeRuns);
  renderHomeChats(state.historySessions);
}

function renderHomeRuns(runs) {
  homeRuns.innerHTML = "";
  const list = runs || [];
  homeRunsSection.hidden = !list.length;
  if (!list.length) return;
  for (const r of list) {
    const el = document.createElement("div");
    el.className = "home-run-card";
    const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
    const errText = r.error ? ` · ${r.error} 个出错` : "";
    el.innerHTML = `
      <div class="home-run-ico">🧩</div>
      <div class="home-run-body">
        <div class="home-run-name">${esc(r.name)}</div>
        <div class="home-run-progress"><div class="bar" style="width:${pct}%"></div></div>
        <div class="home-run-meta">${r.done}/${r.total} 节点完成${errText}</div>
      </div>
      <span class="home-run-status">运行中</span>`;
    el.addEventListener("click", () => window.pi.nodeOpen());
    homeRuns.appendChild(el);
  }
}

function renderHomeChats(sessions) {
  homeChats.innerHTML = "";
  const list = (sessions || []).slice(0, 8);
  if (!list.length) {
    homeChats.innerHTML = `<div class="home-empty">还没有历史会话，在下方输入框开始第一段对话吧</div>`;
    return;
  }
  for (const s of list) {
    const el = document.createElement("div");
    el.className = "home-chat-item";
    el.innerHTML = `
      <div class="home-chat-ico">💬</div>
      <div class="home-chat-body">
        <div class="home-chat-title">${esc((s.name || s.firstMessage || "（空会话）").slice(0, 46))}</div>
        <div class="home-chat-sub">${esc(fmtTime(s.modified))} · ${s.messageCount} 条消息${s.current ? " · 当前" : ""}</div>
      </div>`;
    el.addEventListener("click", () => loadHistoryItem(s.path));
    homeChats.appendChild(el);
  }
}

// Logo → 回主页
sideBrand.addEventListener("click", () => switchView("home"));

// 主页大输入框
function homeSend() {
  const text = homeInput.value.trim();
  if (!text) return;
  switchView("chat");
  input.value = text;
  homeInput.value = "";
  autoResize();
  send();
}
homeSendBtn.addEventListener("click", homeSend);
homeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    homeSend();
  }
});
homeInput.addEventListener("input", () => {
  homeInput.style.height = "auto";
  homeInput.style.height = Math.min(homeInput.scrollHeight, 200) + "px";
});

navItems.forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

/* ---------- 停靠面板：方向 / 大小 / 拖拽 ---------- */
function isColDock(side) {
  return side === "top" || side === "bottom";
}

function applyDockSide(side) {
  state.dockSide = side;
  localStorage.setItem("dock-side", side);
  dockPanel.classList.remove("dock-left", "dock-right", "dock-top", "dock-bottom");
  dockPanel.classList.add("dock-" + side);
  dockArea.classList.toggle("dock-col", isColDock(side));
  dockPanel.style.order = side === "left" || side === "top" ? "0" : "1";
  chatView.style.order = side === "left" || side === "top" ? "1" : "0";
  dockHandle.className = isColDock(side) ? "row" : "col";
  dockSideBtns.forEach((b) =>
    b.classList.toggle("active", b.dataset.side === side)
  );
  applyDockSize();
}

function applyDockSize() {
  const col = isColDock(state.dockSide);
  if (col) {
    dockPanel.style.height = state.dockSize + "px";
    dockPanel.style.width = "";
  } else {
    dockPanel.style.width = state.dockSize + "px";
    dockPanel.style.height = "";
  }
  localStorage.setItem("dock-size", String(state.dockSize));
}

function setDockSize(size) {
  const col = isColDock(state.dockSide);
  const max = col ? dockArea.clientHeight : dockArea.clientWidth;
  state.dockSize = Math.max(180, Math.min(size, max * 0.7));
  applyDockSize();
}

dockSideBtns.forEach((b) =>
  b.addEventListener("click", () => applyDockSide(b.dataset.side))
);

// 拖拽调大小
let dragging = false;
function onDockMove(e) {
  if (!dragging) return;
  const r = dockArea.getBoundingClientRect();
  let size;
  if (state.dockSide === "left") size = e.clientX - r.left;
  else if (state.dockSide === "right") size = r.right - e.clientX;
  else if (state.dockSide === "top") size = e.clientY - r.top;
  else size = r.bottom - e.clientY;
  setDockSize(size);
}
dockHandle.addEventListener("pointerdown", (e) => {
  dragging = true;
  e.preventDefault();
  document.body.classList.add("resizing");
  document.addEventListener("pointermove", onDockMove);
});
document.addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove("resizing");
  document.removeEventListener("pointermove", onDockMove);
});

/* ---------- 独立窗口 ---------- */
dockFloatBtn.addEventListener("click", () => {
  state.floating = true;
  dockPanel.hidden = true;
  window.pi.dlFloat();
});
dockMinBtn.addEventListener("click", () => window.pi.dlMinimize());
dockCloseBtn.addEventListener("click", () => switchView("chat"));
dockDockBtn.addEventListener("click", () => window.close());
floatCloseBtn.addEventListener("click", () => window.close());

/* ---------- 侧边栏折叠 / 拖拽调宽 ---------- */
const SIDE_W_MIN = 130;
const SIDE_W_MAX = 320;
let sideWidth =
  parseInt(localStorage.getItem("sidebar-width"), 10) || 190;

function applySideWidth(w) {
  const n = Math.max(SIDE_W_MIN, Math.min(w, SIDE_W_MAX));
  sidebar.style.width = n + "px";
  sidebar.style.flexBasis = n + "px";
  return n;
}

function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  sideToggle.title = collapsed ? "展开侧边栏" : "收起侧边栏";
  if (collapsed) {
    // 清内联宽度，让 CSS 的 52px 折叠规则生效
    sidebar.style.width = "";
    sidebar.style.flexBasis = "";
  } else {
    // 展开时恢复用户拖拽过的宽度
    applySideWidth(sideWidth);
  }
}
sideToggle.addEventListener("click", () => {
  applySidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
});
applySidebarCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
if (!document.body.classList.contains("sidebar-collapsed")) {
  applySideWidth(sideWidth);
}

// 拖拽调宽（复用 dockHandle 的 pointer 拖拽模式）
let sideDragging = false;
function onSideMove(e) {
  if (!sideDragging) return;
  const w = applySideWidth(e.clientX);
  sideWidth = w;
}
sideResize.addEventListener("pointerdown", (e) => {
  sideDragging = true;
  e.preventDefault();
  document.body.classList.add("sidebar-resizing");
  // 折叠状态下拖拽 → 自动展开（宽度按鼠标位置计算）
  if (document.body.classList.contains("sidebar-collapsed")) {
    applySidebarCollapsed(false);
  }
  document.addEventListener("pointermove", onSideMove);
});
document.addEventListener("pointerup", () => {
  if (!sideDragging) return;
  sideDragging = false;
  document.body.classList.remove("sidebar-resizing");
  document.removeEventListener("pointermove", onSideMove);
  localStorage.setItem("sidebar-width", String(sideWidth));
});

/* ---------- 下载图标动画（内联 SVG + CSS，由 icons.js 提供） ---------- */

/* ---------- 下载管理 ---------- */
const DL_STATUS_TEXT = {
  downloading: "下载中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
};

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
function fmtSpeed(n) {
  return n > 0 ? `${fmtBytes(n)}/s` : "";
}

function activeDlCount() {
  let n = 0;
  for (const t of state.downloads.values()) {
    if (t.status === "downloading" || t.status === "paused") n++;
  }
  return n;
}

function dlActionsHtml(task) {
  const act = (name, label, cls = "", title = "") =>
    `<button class="btn${cls ? ` ${cls}` : ""}" data-act="${name}" data-id="${task.id}"${title ? ` title="${title}"` : ""}>${label}</button>`;
  const buttons = [];
  if (task.status === "downloading") {
    buttons.push(act("pause", "暂停", "pause"), act("stop", "停止", "stop"));
  } else if (task.status === "paused") {
    buttons.push(act("resume", "继续", "resume"), act("stop", "停止", "stop"));
  } else if (task.status === "failed" || task.status === "stopped") {
    buttons.push(
      act("retry", task.status === "failed" ? "重试" : "重新下载", "resume"),
      act("open", "打开目录")
    );
  } else if (task.status === "completed") {
    buttons.push(act("open", "打开文件"), act("open-dir", "打开目录"));
  }
  buttons.push(act("remove", "删除", "del", "删除任务（保留文件）"));
  return buttons.join("");
}

function updateDlCard(task) {
  let card = state.dlCards.get(task.id);
  if (!card) {
    const el = document.createElement("div");
    el.className = "dl-card";
    el.innerHTML = `
      <div class="dl-card-head">
        <span class="dl-name"></span>
        <span class="dl-badge"></span>
      </div>
      <div class="dl-url-line"><a href="#"></a></div>
      <div class="dl-progress"><div class="bar"></div></div>
      <div class="dl-info">
        <span class="dl-size"></span>
        <span class="dl-speed"></span>
        <span class="dl-error"></span>
      </div>
      <div class="dl-actions"></div>
    `;
    card = {
      el,
      nameEl: el.querySelector(".dl-name"),
      badgeEl: el.querySelector(".dl-badge"),
      urlEl: el.querySelector(".dl-url-line a"),
      bar: el.querySelector(".bar"),
      prog: el.querySelector(".dl-progress"),
      sizeEl: el.querySelector(".dl-size"),
      speedEl: el.querySelector(".dl-speed"),
      errEl: el.querySelector(".dl-error"),
      actEl: el.querySelector(".dl-actions"),
    };
    dlList.appendChild(el);
    state.dlCards.set(task.id, card);
  }

  card.nameEl.textContent = task.filename;
  card.nameEl.title = task.fullPath;
  card.badgeEl.textContent = DL_STATUS_TEXT[task.status] || task.status;
  card.badgeEl.className = `dl-badge ${task.status}`;
  card.urlEl.textContent = task.url;
  card.urlEl.href = task.url;

  const indeterminate = task.status === "downloading" && task.percent == null;
  card.prog.classList.toggle("indeterminate", indeterminate);
  if (task.percent != null) {
    card.bar.style.width = task.percent + "%";
  } else {
    card.bar.style.width = "0%";
  }

  const sizeText = task.total
    ? `${fmtBytes(task.received)} / ${fmtBytes(task.total)}`
    : fmtBytes(task.received);
  card.sizeEl.textContent = task.total
    ? `${sizeText}（${task.percent}%）`
    : sizeText;
  card.speedEl.textContent =
    task.status === "downloading" ? fmtSpeed(task.speed) : "";
  card.errEl.textContent = task.error ? `错误: ${task.error}` : "";

  card.actEl.innerHTML = dlActionsHtml(task);
}

function renderDownloads(tasks) {
  const seen = new Set();
  let justCompleted = false;
  for (const t of tasks || []) {
    const prev = state.downloads.get(t.id);
    if (prev && prev.status !== "completed" && t.status === "completed") {
      justCompleted = true;
    }
    state.downloads.set(t.id, t);
    seen.add(t.id);
    updateDlCard(t);
  }
  // 移除已不存在的任务卡片
  for (const id of [...state.dlCards.keys()]) {
    if (!seen.has(id)) {
      state.dlCards.get(id).el.remove();
      state.dlCards.delete(id);
      state.downloads.delete(id);
    }
  }
  const count = state.downloads.size;
  dlEmpty.hidden = count > 0;
  dlList.hidden = count === 0;
  dlCount.textContent = count ? `共 ${count} 个任务` : "";
  const active = activeDlCount();
  dlBadge.hidden = active === 0;
  dlBadge.textContent = active;
  syncDlIcon(justCompleted);
}

// 侧边栏/标题图标：有进行中任务→进度呼吸；任务完成→对勾弹出
function syncDlIcon(justCompleted = false) {
  if (justCompleted) {
    PiIcon.setActive(dlNavIco, false);
    PiIcon.setActive(dlHeadIco, false);
    PiIcon.play(dlNavIco, "done", 1700);
    PiIcon.play(dlHeadIco, "done", 1700);
    setTimeout(syncDlIcon, 1750); // 对勾动画结束后再同步 active 状态
    return;
  }
  const hasActive = activeDlCount() > 0;
  // 对勾动画播放中不叠加呼吸状态，等其结束后再同步
  if (PiIcon.busy(dlNavIco)) return;
  PiIcon.setActive(dlNavIco, hasActive);
  PiIcon.setActive(dlHeadIco, hasActive);
}

// 下载操作（事件委托）
dlList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (act === "pause") window.pi.dlPause(id);
  else if (act === "resume") window.pi.dlResume(id);
  else if (act === "stop") window.pi.dlStop(id);
  else if (act === "retry") window.pi.dlRetry(id);
  else if (act === "remove") window.pi.dlRemove(id);
  else if (act === "open" || act === "open-dir") window.pi.dlOpenFolder(id);
});

addDlBtn.addEventListener("click", () => {
  addDlPanel.hidden = !addDlPanel.hidden;
  if (!addDlPanel.hidden) dlUrl.focus();
});
dlDestBtn.addEventListener("click", async () => {
  const dir = await window.pi.dlPickDest();
  if (dir) dlDest.value = dir;
});
dlStartBtn.addEventListener("click", startManualDownload);
dlUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startManualDownload();
});

async function startManualDownload() {
  const url = dlUrl.value.trim();
  if (!url) {
    addNotice("请先输入下载链接", "error");
    dlUrl.focus();
    return;
  }
  PiIcon.play(dlStartIco, "playing", 1100);
  const res = await window.pi.dlAdd({
    url,
    filename: dlName.value.trim() || undefined,
    dest: dlDest.value.trim() || undefined,
  });
  if (!res.ok) {
    addNotice(`添加下载失败：${res.error}`, "error");
    PiIcon.play(dlStartIco, "shake", 500);
    return;
  }
  PiIcon.play(dlStartIco, "done", 1600);
  dlUrl.value = "";
  dlName.value = "";
  switchView("downloads");
  addDlPanel.hidden = true;
}

/* ---------- 历史记录 ---------- */
function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

function renderHistory(sessions, archived) {
  state.historySessions = sessions || [];
  state.historyArchived = archived || [];
  historyList.innerHTML = "";
  const list = sessions || [];
  const arch = archived || [];
  if (!list.length && !arch.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无历史会话";
    historyList.appendChild(empty);
    return;
  }
  for (const s of list) {
    historyList.appendChild(buildHistoryItem(s, false));
  }
  if (arch.length) {
    // 归档分区头
    const divider = document.createElement("div");
    divider.className = "history-archived-head";
    divider.innerHTML = `<span class="history-chev">▾</span>📦 归档（${arch.length}）`;
    divider.addEventListener("click", () => {
      const body = divider.nextElementSibling;
      if (body) {
        body.hidden = !body.hidden;
        divider.querySelector(".history-chev").textContent = body.hidden ? "▸" : "▾";
      }
    });
    historyList.appendChild(divider);
    const archBox = document.createElement("div");
    archBox.className = "history-archived";
    for (const s of arch) {
      archBox.appendChild(buildHistoryItem(s, true));
    }
    historyList.appendChild(archBox);
  }
}

function buildHistoryItem(s, archived) {
  const item = document.createElement("div");
  item.className = "history-item" + (s.current ? " current" : "") + (archived ? " archived" : "");
  item.dataset.path = s.path;
  item.title = "右键菜单：加载 / 归档 / 删除";

  const title = document.createElement("div");
  title.className = "history-item-title";
  title.textContent =
    (s.name || s.firstMessage || "（空会话）").slice(0, 40);
  title.title = s.firstMessage || s.name || "";

  const sub = document.createElement("div");
  sub.className = "history-item-sub";
  sub.textContent = `${fmtTime(s.modified)} · ${s.messageCount} 条消息`;

  item.append(title, sub);
  return item;
}

/* ---------- 历史会话操作 ---------- */

async function loadHistoryItem(path) {
  const res = await window.pi.loadSession(path);
  if (!res.ok) {
    addNotice(`加载失败：${res.error}`, "error");
    return;
  }
  // 无论当前在哪个视图，加载历史会话后都切回聊天界面
  switchView("chat");
}

async function archiveHistoryItem(path) {
  const res = await window.pi.archiveSession(path);
  if (!res.ok) addNotice(`归档失败：${res.error}`, "error");
  else addNotice("已归档该会话");
}

async function restoreHistoryItem(path) {
  const res = await window.pi.restoreSession(path);
  if (!res.ok) addNotice(`恢复失败：${res.error}`, "error");
  else addNotice("已恢复该会话");
}

async function deleteHistoryItem(path) {
  const ok = confirm("确定删除该历史会话？此操作不可恢复。");
  if (!ok) return;
  const res = await window.pi.deleteSession(path);
  if (!res.ok) addNotice(`删除失败：${res.error}`, "error");
}

/* ---------- 历史记录右键菜单 ---------- */

const ctxMenu = $("#ctxMenu");

function showCtxMenu(x, y, items) {
  ctxMenu.innerHTML = "";
  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement("div");
      sep.className = "ctx-sep";
      ctxMenu.appendChild(sep);
      continue;
    }
    const el = document.createElement("div");
    el.className = "ctx-item" + (it.danger ? " danger" : "");
    if (it.icon) el.innerHTML = PiIcon.svg(it.icon) + `<span>${it.label}</span>`;
    else el.textContent = it.label;
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

historyList.addEventListener("contextmenu", (e) => {
  const item = e.target.closest(".history-item");
  if (!item) return;
  e.preventDefault();
  const path = item.dataset.path;
  const archived = item.classList.contains("archived");
  const current = item.classList.contains("current");
  const items = [];
  if (archived) {
    items.push({ icon: "download", label: "恢复并加载", action: () => loadHistoryItem(path) });
    items.push({ icon: "restore", label: "仅恢复", action: () => restoreHistoryItem(path) });
  } else {
    items.push({ icon: "download", label: current ? "重新加载会话" : "加载会话", action: () => loadHistoryItem(path) });
    items.push({ icon: "archive", label: "归档", action: () => archiveHistoryItem(path) });
  }
  items.push({ sep: true });
  items.push({ icon: "trash", label: "删除", danger: true, action: () => deleteHistoryItem(path) });
  showCtxMenu(e.clientX, e.clientY, items);
});

// 点击主体：归档会话点击 = 恢复并加载；普通会话点击 = 加载
historyList.addEventListener("click", (e) => {
  const item = e.target.closest(".history-item");
  if (!item) return;
  if (item.classList.contains("current")) return;
  loadHistoryItem(item.dataset.path);
});

// 刷新 / 折叠展开
historyRefreshBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  PiIcon.play(historyRefreshBtn, "spin", 700);
  const res = await window.pi.getHistory();
  renderHistory(res.sessions || [], res.archived || []);
});
historyHead.addEventListener("click", () => {
  historyHead.parentElement.classList.toggle("collapsed");
});

/* ---------- 今日总结 ---------- */
const SUM_FREQ_TEXT = {
  1800000: "30 分钟",
  3600000: "1 小时",
  7200000: "2 小时",
  14400000: "4 小时",
  28800000: "8 小时",
  86400000: "1 天",
};
const SUM_STRENGTH_TEXT = {
  brief: "简短",
  medium: "标准",
  detailed: "详细",
};

function fmtSummaryTime(t) {
  try {
    const d = new Date(t);
    const sameDay = new Date().toDateString() === d.toDateString();
    return `${sameDay ? "今天" : d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return "";
  }
}

/** 粗略把 Markdown 转纯文本（用于折叠时的一行摘要） */
function mdToText(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[|*_~>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setStrengthUI(strength) {
  sumStrength.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.strength === strength)
  );
}

function renderSummary(state) {
  const cfg = state?.config || {};
  sumEnabled.checked = !!cfg.enabled;
  if (cfg.frequencyMs && sumFreq.querySelector(`option[value="${cfg.frequencyMs}"]`)) {
    sumFreq.value = String(cfg.frequencyMs);
  }
  sumFreq.disabled = !cfg.enabled;
  setStrengthUI(cfg.strength || "medium");
  const stText = SUM_STRENGTH_TEXT[cfg.strength] || "标准";
  sumHint.textContent = cfg.enabled
    ? `开启中 · 每 ${SUM_FREQ_TEXT[cfg.frequencyMs] || "（自定义间隔）"}自动生成 · 强度：${stText}`
    : `自动总结已关闭 · 当前强度：${stText}`;
  setSummaryStatus(state?.running);

  sumList.innerHTML = "";
  const items = state?.items || [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "summary-empty";
    empty.innerHTML =
      "还没有总结。<br>点击「立即总结」生成今天的活动小结，或开启自动总结按频率定时生成。";
    sumList.appendChild(empty);
    return;
  }

  for (const it of items) {
    const expanded = state.sumExpanded?.has(it.id);
    const el = document.createElement("div");
    el.className = "summary-item" + (expanded ? " expanded" : "");
    el.dataset.id = it.id;

    const head = document.createElement("div");
    head.className = "si-head";

    const ico = document.createElement("span");
    ico.className = "si-ico";
    ico.innerHTML = PiIcon.svg("summary");

    const time = document.createElement("span");
    time.className = "si-time";
    time.textContent = fmtSummaryTime(it.createdAt);

    const srcTag = document.createElement("span");
    srcTag.className = "si-tag " + (it.source || "manual");
    srcTag.textContent = it.source === "auto" ? "自动" : "手动";

    const stTag = document.createElement("span");
    stTag.className = "si-tag " + (it.strength || "medium");
    stTag.textContent = SUM_STRENGTH_TEXT[it.strength] || "标准";

    const preview = document.createElement("span");
    preview.className = "si-preview";
    preview.title = "点击展开全文";
    preview.textContent = mdToText(it.content).slice(0, 46) || "（空内容）";

    const chev = document.createElement("span");
    chev.className = "si-chev";
    chev.textContent = "▾";

    const del = document.createElement("button");
    del.className = "si-del";
    del.title = "删除此总结";
    del.textContent = "✕";
    del.dataset.id = it.id;

    head.append(ico, time, srcTag, stTag, preview, chev, del);

    const body = document.createElement("div");
    body.className = "si-body";
    body.hidden = !expanded;
    body.innerHTML = renderMarkdown(it.content || "");

    el.append(head, body);
    sumList.appendChild(el);
  }
}

function setSummaryStatus(running) {
  sumStatus.textContent = running ? "正在生成今日小结…" : "";
  sumStatus.className = "summary-status" + (running ? " running" : "");
  sumRunBtn.disabled = !!running;
  if (running) PiIcon.play(sumRunBtn, "pulse", 0);
  else PiIcon.reset(sumRunBtn);
}

async function refreshSummary() {
  renderSummary(await window.pi.summaryGetState());
}

sumEnabled.addEventListener("change", async () => {
  const cfg = { enabled: sumEnabled.checked, frequencyMs: Number(sumFreq.value) };
  renderSummary(await window.pi.summarySetConfig(cfg));
  addNotice(sumEnabled.checked ? "已开启自动总结" : "已关闭自动总结");
});
sumFreq.addEventListener("change", async () => {
  renderSummary(
    await window.pi.summarySetConfig({
      enabled: sumEnabled.checked,
      frequencyMs: Number(sumFreq.value),
    })
  );
});
// 总结强度：切换即保存，本次及之后的总结都用该强度
sumStrength.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-strength]");
  if (!btn) return;
  renderSummary(
    await window.pi.summarySetConfig({
      enabled: sumEnabled.checked,
      frequencyMs: Number(sumFreq.value),
      strength: btn.dataset.strength,
    })
  );
});
sumRunBtn.addEventListener("click", async () => {
  setSummaryStatus(true);
  const res = await window.pi.summaryRunNow();
  if (!res?.ok) {
    addNotice(`生成总结失败：${res?.error || "未知错误"}`, "error");
    setSummaryStatus(false);
  }
  // 完成后由 summary:update 事件刷新
});
sumList.addEventListener("click", async (e) => {
  const del = e.target.closest(".si-del");
  if (del) {
    e.stopPropagation();
    await window.pi.summaryDelete(del.dataset.id);
    return;
  }
  const item = e.target.closest(".summary-item");
  if (!item) return;
  const body = item.querySelector(".si-body");
  if (!body) return;
  const expanded = item.classList.toggle("expanded");
  body.hidden = !expanded;
  if (expanded) {
    if (!state.sumExpanded) state.sumExpanded = new Set();
    state.sumExpanded.add(item.dataset.id);
  } else {
    state.sumExpanded?.delete(item.dataset.id);
  }
});

/* ---------- 知识库（RAG） ---------- */

function renderKbStatus(s) {
  const st = s || {};
  if (!st.modelReady) {
    kbStatus.textContent = st.downloading
      ? "正在下载嵌入模型…（见下载面板）"
      : "嵌入模型未就绪" + (st.modelError ? `：${st.modelError}` : "");
    kbStatus.className = "kb-status" + (st.downloading ? " busy" : " err");
  } else {
    kbStatus.textContent = `模型就绪 · ${st.chunkCount || 0} 个片段`;
    kbStatus.className = "kb-status ok";
  }
}

function renderKbDocs(docs) {
  const list = docs || [];
  kbDocCount.textContent = list.length;
  kbDocList.innerHTML = "";
  if (!list.length) {
    kbDocList.innerHTML = `<div class="kb-empty">还没有文档，点「导入文件」或粘贴文本</div>`;
    return;
  }
  for (const d of list) {
    const el = document.createElement("div");
    el.className = "kb-doc";
    el.innerHTML = `
      <div class="kb-doc-body">
        <div class="kb-doc-name">${esc(d.name)}</div>
        <div class="kb-doc-meta">${esc(fmtTime(d.updated))} · ${d.chunks} 个片段</div>
      </div>
      <button class="kb-doc-del" title="删除" data-id="${d.id}">🗑</button>`;
    kbDocList.appendChild(el);
  }
}

function renderKbResults(results) {
  kbResults.innerHTML = "";
  const list = results || [];
  if (!list.length) {
    kbResults.innerHTML = `<div class="kb-empty">输入问题后点击「检索」</div>`;
    return;
  }
  for (const r of list) {
    const el = document.createElement("div");
    el.className = "kb-hit";
    el.innerHTML = `<div class="kb-hit-meta">相关度 ${r.score} · 来源：${esc(r.docName || "未知")}</div>
      <div class="kb-hit-text">${esc(r.text)}</div>`;
    kbResults.appendChild(el);
  }
}

async function refreshKb() {
  const [st, docs] = await Promise.all([window.pi.kbStatus(), window.pi.kbList()]);
  renderKbStatus(st);
  renderKbDocs(docs.docs || []);
}

async function kbImportFile() {
  const filePath = await window.pi.kbPickFile();
  if (!filePath) return;
  const res = await window.pi.kbImportFile(filePath);
  if (!res.ok) {
    addNotice(`导入失败：${res.error}`, "error");
    return;
  }
  addNotice(`已导入「${res.result.name}」（${res.result.chunks} 片段）`, "success");
  refreshKb();
}

async function kbImportText() {
  const text = kbText.value.trim();
  if (!text) {
    addNotice("请输入要导入的文本", "error");
    return;
  }
  const res = await window.pi.kbImportText(kbName.value.trim() || undefined, text);
  if (!res.ok) {
    addNotice(`导入失败：${res.error}`, "error");
    return;
  }
  kbText.value = "";
  kbName.value = "";
  addNotice(`已导入「${res.result.name}」（${res.result.chunks} 片段）`, "success");
  refreshKb();
}

async function kbSearch() {
  const q = kbQuery.value.trim();
  if (!q) return;
  kbResults.innerHTML = `<div class="kb-empty">检索中…</div>`;
  const res = await window.pi.kbSearch(q, 5);
  if (!res.ok) {
    kbResults.innerHTML = `<div class="kb-empty">检索失败：${esc(res.error)}</div>`;
    return;
  }
  renderKbResults(res.results);
}

kbImportBtn.addEventListener("click", () => {
  kbImportPanel.hidden = !kbImportPanel.hidden;
});

/* ---------- API 配置 ---------- */

function apiSetStatus(text, cls) {
  apiStatus.textContent = text || "";
  apiStatus.className = "api-status" + (cls ? " " + cls : "");
}

function apiHint(text, cls) {
  apiKeyHint.textContent = text || "";
  apiKeyHint.className = "api-hint" + (cls ? " " + cls : "");
}

function renderApiOverview(st) {
  const defaultKey = st.defaultProvider
    ? `${st.defaultProvider}/${st.defaultModel}`
    : "（未设置）";
  apiOverview.innerHTML = `
    <div class="api-ov-item">
      <span class="api-ov-label">API Key</span>
      <span class="api-ov-value ${st.hasKey ? "ok" : "err"}">${st.hasKey ? esc(st.keyMasked) : "未配置"}</span>
    </div>
    <div class="api-ov-item">
      <span class="api-ov-label">Provider</span>
      <span class="api-ov-value">${esc(st.authProvider || "—")}</span>
    </div>
    <div class="api-ov-item">
      <span class="api-ov-label">默认模型</span>
      <span class="api-ov-value">${esc(defaultKey)}</span>
    </div>
    <div class="api-ov-item">
      <span class="api-ov-label">环境变量 DEEPSEEK_API_KEY</span>
      <span class="api-ov-value ${st.envKeySet ? "ok" : "err"}">${st.envKeySet ? "已设置" : "未设置"}</span>
    </div>
    <div class="api-ov-item">
      <span class="api-ov-label">可用模型</span>
      <span class="api-ov-value">${st.models.length} 个</span>
    </div>`;
}

function renderApiModels(models, defaultKey) {
  // 默认模型下拉
  apiModelSelect.innerHTML = "";
  const hasDefault = models.some((m) => `${m.provider}/${m.id}` === defaultKey);
  if (!hasDefault) addOption(apiModelSelect, "", "（请选择模型）");
  for (const m of models) {
    addOption(apiModelSelect, `${m.provider}/${m.id}`, `${m.name} (${m.provider})`);
  }
  if (hasDefault) apiModelSelect.value = defaultKey;

  // 模型卡片列表（点击直接应用）
  apiModelList.innerHTML = "";
  if (!models.length) {
    apiModelList.innerHTML = `<div class="api-note">暂无可用模型 —— 请先保存 API Key（或设置环境变量后重启）</div>`;
    return;
  }
  for (const m of models) {
    const key = `${m.provider}/${m.id}`;
    const el = document.createElement("div");
    el.className = "api-model" + (key === defaultKey ? " active" : "");
    const ctx = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : "";
    el.innerHTML = `
      <span class="api-model-id">${esc(m.id)}</span>
      <span class="api-model-name">${esc(m.name)}</span>
      <span class="api-model-meta">${m.reasoning ? '<span class="reasoning">推理</span> ' : ""}${esc(ctx)}</span>`;
    el.title = `点击设为默认模型`;
    el.addEventListener("click", async () => {
      apiModelSelect.value = key;
      const res = await window.pi.apiSetDefaultModel(m.provider, m.id);
      if (res.ok) {
        apiHint(`✓ 已应用默认模型 ${key}`, "ok");
        refreshApi();
      } else {
        apiHint(`应用失败：${res.error}`, "err");
      }
    });
    apiModelList.appendChild(el);
  }
}

function renderApiEnv(st) {
  apiEnvInfo.innerHTML = `
    <div class="api-env-row"><span class="api-env-key">auth.json</span><span class="api-env-val">${esc(st.authPath)}</span></div>
    <div class="api-env-row"><span class="api-env-key">settings.json</span><span class="api-env-val">${esc(st.settingsPath)}</span></div>
    <div class="api-env-row"><span class="api-env-key">models-store.json</span><span class="api-env-val">${esc(st.modelsPath)}</span></div>
    <div class="api-env-row"><span class="api-env-key">环境变量</span><span class="api-env-val ${st.envKeySet ? "ok" : "err"}">DEEPSEEK_API_KEY ${st.envKeySet ? "已设置（启动时自动使用）" : "未设置"}</span></div>
    <div class="api-env-row"><span class="api-env-key">工作目录</span><span class="api-env-val">${esc(state.cwd || "")}</span></div>`;
}

async function refreshApi() {
  apiSetStatus("加载中…", "busy");
  try {
    const st = await window.pi.apiGetState();
    state.apiState = st;
    // Provider 下拉
    apiProvider.innerHTML = "";
    const providers = st.providers.length ? st.providers : ["deepseek"];
    for (const p of providers) addOption(apiProvider, p, p);
    if (st.authProvider) apiProvider.value = st.authProvider;
    // Key 输入框占位提示（不自动回填已存 Key，避免误改）
    apiKeyInput.placeholder = st.hasKey
      ? `已保存：${st.keyMasked}（留空则不修改）`
      : "sk-…（保存到 ~/.pi/agent/auth.json）";
    apiKeyInput.type = "password";
    apiKeyToggle.textContent = "显示";
    renderApiOverview(st);
    renderApiModels(st.models, st.defaultProvider ? `${st.defaultProvider}/${st.defaultModel}` : "");
    renderApiEnv(st);
    apiSetStatus(st.hasKey ? `已连接（${st.authProvider}）` : "未配置 API Key", st.hasKey ? "ok" : "err");
  } catch (err) {
    apiSetStatus("加载失败", "err");
    apiOverview.innerHTML = `<div class="api-note">获取配置失败：${esc(err?.message || err)}</div>`;
  }
}

async function apiSaveKey() {
  const provider = apiProvider.value || "deepseek";
  const key = apiKeyInput.value.trim();
  if (!key) {
    apiHint("请输入 API Key（留空可取消）", "err");
    return;
  }
  apiSaveBtn.disabled = true;
  apiHint("保存中…", "busy");
  try {
    const res = await window.pi.apiSaveKey(provider, key);
    if (res.ok) {
      apiKeyInput.value = "";
      apiHint(`✓ 已保存（${res.masked}），模型运行时已刷新`, "ok");
      addNotice(`🔑 API Key 已保存（${res.masked}）`, "success");
      refreshApi();
    } else {
      apiHint(`保存失败：${res.error}`, "err");
      addNotice(`API Key 保存失败：${res.error}`, "error");
    }
  } finally {
    apiSaveBtn.disabled = false;
  }
}

async function apiTest() {
  const provider = apiProvider.value || "deepseek";
  const key = apiKeyInput.value.trim(); // 为空则主进程自动用已保存的 Key 测试
  apiTestBtn.disabled = true;
  apiHint("测试连接中…", "busy");
  try {
    const res = await window.pi.apiTest(provider, key);
    if (res.ok) {
      apiHint(`✓ 连接成功（${res.latency}ms），发现 ${res.models.length} 个模型`, "ok");
    } else {
      apiHint(`✗ 连接失败（${res.latency}ms）：${res.error}`, "err");
    }
  } finally {
    apiTestBtn.disabled = false;
  }
}

apiSaveBtn.addEventListener("click", apiSaveKey);
apiTestBtn.addEventListener("click", apiTest);
apiRefreshBtn.addEventListener("click", refreshApi);

apiKeyToggle.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
  apiKeyToggle.textContent = showing ? "显示" : "隐藏";
});

apiEnvBtn.addEventListener("click", async () => {
  const { set, key } = await window.pi.apiGetEnvKey();
  if (!set || !key) {
    apiHint("未检测到环境变量 DEEPSEEK_API_KEY", "err");
    return;
  }
  apiKeyInput.value = key;
  apiHint("已从环境变量填入，点击「保存 Key」即可生效", "ok");
});

apiApplyModelBtn.addEventListener("click", async () => {
  const v = apiModelSelect.value;
  if (!v) {
    apiHint("请先选择模型", "err");
    return;
  }
  const i = v.indexOf("/");
  const provider = v.slice(0, i);
  const modelId = v.slice(i + 1);
  apiApplyModelBtn.disabled = true;
  try {
    const res = await window.pi.apiSetDefaultModel(provider, modelId);
    if (res.ok) {
      apiHint(`✓ 已应用默认模型 ${v}，当前会话已切换`, "ok");
      refreshApi();
    } else {
      apiHint(`应用失败：${res.error}`, "err");
    }
  } finally {
    apiApplyModelBtn.disabled = false;
  }
});
kbImportTextBtn.addEventListener("click", kbImportText);
kbSearchBtn.addEventListener("click", kbSearch);
kbQuery.addEventListener("keydown", (e) => {
  if (e.key === "Enter") kbSearch();
});
kbDocList.addEventListener("click", async (e) => {
  const del = e.target.closest(".kb-doc-del");
  if (!del) return;
  if (!confirm("删除该文档及其索引？")) return;
  await window.pi.kbDelete(del.dataset.id);
  refreshKb();
});

/* ---------- 事件处理 ---------- */
const handlers = {
  "session:init": async (d) => {
    state.cwd = d.cwd || "";
    msgList.innerHTML = "";
    state.items = [];
    state.toolCards = new Map();
    state.currentAssistantId = null;

    cwdText.textContent = state.cwd;
    cwdText.title = state.cwd;
    sideCwd.textContent = state.cwd;
    sideCwd.title = state.cwd;

    const messages = d.messages || [];
    if (messages.length > 60) {
      setStatus(`正在加载会话（${messages.length} 条消息）…`, "");
    }
    await renderMessages(messages);
    // 恢复流式中的会话（后台继续执行）：最后一条是 assistant 消息时继续接收增量，并显示停止按钮
    if (d.isStreaming) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "assistant") {
        const lastAsst = [...state.items].reverse().find((i) => i.type === "assistant");
        if (lastAsst) {
          lastAsst.completed = false;
          lastAsst.el.classList.add("streaming");
          state.currentAssistantId = lastAsst.id;
        }
      }
    }
    abortBtn.hidden = !d.isStreaming;
    syncModelUI(d);
    setStatus(d.isStreaming ? "正在处理…" : "就绪", d.isStreaming ? "" : "idle");
    scrollToBottom(true);
  },

  "session:user": (d) => {
    const item = makeUserItem(d.text || "");
    msgList.appendChild(item.el);
    state.items.push(item);
    scrollToBottom(true);
  },

  "session:delta": (d) => appendDelta(d.kind, d.delta),

  "session:message-end": (d) => {
    const m = d.message;
    if (m.role === "assistant") {
      const item = state.items.find((i) => i.id === state.currentAssistantId);
      if (item) rebuildAssistant(item, m.content || []);
      state.currentAssistantId = null;
    } else if (m.role === "toolResult") {
      attachToolResult(m.toolCallId, m.content || "", !!m.isError);
    }
  },

  "session:tool-start": (d) => {
    const item = ensureAssistant();
    const argsText =
      typeof d.args === "string" ? d.args : JSON.stringify(d.args ?? {}, null, 2);
    const card = makeToolCard(d.toolCallId, d.toolName, argsText, "");
    card.stateEl.textContent = "运行中…";
    state.toolCards.set(d.toolCallId, card);
    item.bodyEl.appendChild(card.cardEl);
    scrollToBottom();
  },

  "session:tool-update": (d) => {
    const card = state.toolCards.get(d.toolCallId);
    if (card) {
      card.resultEl.textContent = d.partial || "";
      scrollToBottom();
    }
  },

  "session:tool-end": (d) => {
    attachToolResult(d.toolCallId, d.result || "", !!d.isError);
  },

  "session:agent-start": () => {
    abortBtn.hidden = false;
    PiIcon.play(abortBtn, "pulse", 0); // 常驻脉冲，直到会话结束
    setStatus("正在处理…");
  },

  "session:agent-settled": () => {
    state.pendingCount = 0;
    PiIcon.reset(abortBtn);
    abortBtn.hidden = true;
    setStatus("就绪", "idle");
  },

  "session:queue": (d) => {
    state.pendingCount = (d.steering?.length || 0) + (d.followUp?.length || 0);
    if (state.pendingCount > 0) {
      setStatus(`排队中（${state.pendingCount} 条待处理）`);
    }
  },

  "session:notice": (d) => {
    if (d.kind === "compaction") addNotice(d.text, "compaction");
    else if (d.kind === "compaction-end") {
      addNotice("上下文已压缩", "compaction");
    } else if (d.kind === "retry") setStatus(d.text);
    else if (d.kind === "retry-end") setStatus("就绪", "idle");
  },

  "session:error": (d) => {
    addNotice(d.message || "发生错误", "error");
    setStatus("出错", "error");
  },

  "session:state": (d) => {
    abortBtn.hidden = !d.isStreaming;
    syncModelUI(d);
  },

  "session:models": (d) => {
    state.availableModels = d.models || [];
    refreshApi();
  },

  "download:list": (d) => {
    renderDownloads(d.tasks || []);
  },

  "download:chat-notice": (d) => {
    addNotice(d.text || "", d.cls || "");
  },

  "session:history": (d) => {
    renderHistory(d.sessions || [], d.archived || []);
  },

  "session:blueprint": (d) => {
    addNotice(d.text || "", d.cls || "");
  },

  "app:notice": (d) => {
    addNotice(d.text || "", d.cls || "");
  },

  "summary:update": (d) => {
    if (state.view === "summary") renderSummary(d);
  },

  "summary:status": (d) => {
    if (state.view === "summary") setSummaryStatus(!!d?.running);
  },

  "home:runs": (d) => {
    state.homeRuns = d.runs || [];
    if (state.view === "home") renderHomeRuns(state.homeRuns);
  },

  "kb:status": (d) => renderKbStatus(d),

  "kb:list": (d) => renderKbDocs(d.docs || []),

  "dock:unfloat": () => {
    state.floating = false;
    if (state.view === "downloads") dockPanel.hidden = false;
  },
};

function addOption(select, value, label) {
  if ([...select.options].some((o) => o.value === value)) return;
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
}

function syncModelUI(d) {
  const currentKey = d.modelProvider
    ? `${d.modelProvider}/${d.modelName}`
    : d.modelName;
  if (!modelSelect.options.length) {
    addOption(modelSelect, currentKey, currentKey || "未配置");
  }
  for (const m of state.availableModels) {
    addOption(modelSelect, `${m.provider}/${m.id}`, `${m.name} (${m.provider})`);
  }
  if (currentKey) {
    addOption(modelSelect, currentKey, currentKey);
    modelSelect.value = currentKey;
  }
  if (d.thinkingLevel) thinkingSelect.value = d.thinkingLevel;
}

/* ---------- 交互 ---------- */
// 聊天视觉桥：上传图片 → 本地 Qwen3-VL（llama-server）生成描述 → 注入消息给 DeepSeek
let attachedImage = null; // { dataUrl }
const attachBtn = $("#attachBtn");
const attachFile = $("#attachFile");
const attachChip = $("#attachChip");
const attachPreview = $("#attachPreview");
const attachClearBtn = $("#attachClearBtn");

// 统一的“附加图片”入口：文件选择 / 拖拽共用
function setAttached(dataUrl) {
  if (!dataUrl) {
    attachedImage = null;
    attachChip.hidden = true;
    attachPreview.src = "";
    return;
  }
  attachedImage = { dataUrl };
  attachPreview.src = dataUrl;
  attachChip.hidden = false;
}

attachBtn.addEventListener("click", () => attachFile.click());
attachClearBtn.addEventListener("click", () => setAttached(null));
attachFile.addEventListener("change", () => {
  const file = attachFile.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setAttached(reader.result);
  reader.readAsDataURL(file);
  attachFile.value = "";
});

// 拖拽上传图片（全窗口生效）
const dropTarget = document.body;
dropTarget.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  dropTarget.classList.add("drag-over");
});
dropTarget.addEventListener("dragleave", () => dropTarget.classList.remove("drag-over"));
dropTarget.addEventListener("drop", (e) => {
  e.preventDefault();
  dropTarget.classList.remove("drag-over");
  const file = e.dataTransfer.files?.[0];
  if (file && file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = () => setAttached(reader.result);
    reader.readAsDataURL(file);
  }
});

async function send() {
  let text = input.value.trim();
  input.value = "";
  autoResize();
  if (attachedImage) {
    // 图片随消息发出：DeepSeek 按需调用 vision_analyze 工具看图；多模态模型可直接看图
    if (!text) text = "请查看我上传的图片。";
    window.pi.send({ text, imageData: attachedImage.dataUrl });
    setAttached(null);
    input.focus();
    return;
  }
  if (!text) return;
  PiIcon.play(sendBtn, "send", 900); // 纸飞机飞出
  window.pi.send(text);
  input.focus();
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}

sendBtn.addEventListener("click", send);
abortBtn.addEventListener("click", () => window.pi.abort());
newBtn.addEventListener("click", () => window.pi.newSession());

// 自定义系统提示词面板
promptBtn.addEventListener("click", async () => {
  const opening = promptPanel.hidden;
  promptPanel.hidden = !opening;
  if (opening) {
    promptStatus.textContent = "";
    try {
      promptText.value = await window.pi.getSystemPrompt();
    } catch (e) {
      promptText.value = "";
      promptStatus.textContent = "读取失败: " + (e?.message || e);
    }
    promptText.focus();
  }
});
promptCloseBtn.addEventListener("click", () => {
  promptPanel.hidden = true;
});
promptSaveBtn.addEventListener("click", async () => {
  promptStatus.textContent = "保存中…";
  try {
    await window.pi.setSystemPrompt(promptText.value);
    promptStatus.textContent = "已保存 ✓（对新消息生效）";
    setTimeout(() => { promptStatus.textContent = ""; }, 2500);
  } catch (e) {
    promptStatus.textContent = "保存失败: " + (e?.message || e);
  }
});
cwdBtn.addEventListener("click", async () => {
  const cwd = await window.pi.pickCwd();
  if (cwd) {
    cwdText.textContent = cwd;
    cwdText.title = cwd;
    addNotice(`工作目录已切换到 ${cwd}`);
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
input.addEventListener("input", autoResize);

modelSelect.addEventListener("change", () => {
  const [provider, id] = modelSelect.value.split("/");
  if (provider && id) window.pi.setModel(provider, id);
});
thinkingSelect.addEventListener("change", () => {
  window.pi.setThinking(thinkingSelect.value);
});

/* 点击链接用系统浏览器打开 */
msgList.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (a && /^https?:\/\//.test(a.href)) {
    e.preventDefault();
    window.pi.openExternal(a.href);
  }
});

/* ---------- 启动 ---------- */
async function init() {
  // 独立窗口模式：占满窗口，无侧边栏/聊天
  if (isFloat) {
    document.body.classList.add("float-mode");
    document.title = "Pi 下载管理";
    dockPanel.hidden = false;
    floatControls.hidden = false; // 显示悬浮控制按钮（停靠回主窗/最小化/关闭）
  } else {
    applyDockSide(state.dockSide);
    switchView("home");
  }

  // 注册所有 IPC 事件处理器（key 即通道名）
  Object.entries(handlers).forEach(([channel, handler]) => {
    window.pi.onEvent(channel, handler);
  });

  const models = await window.pi.getAvailableModels();
  state.availableModels = models;
  const snap = await window.pi.getState();
  syncModelUI(snap);
  setStatus("正在启动…");
  const dl = await window.pi.dlList();
  renderDownloads(dl.tasks || []);
  const history = await window.pi.getHistory();
  renderHistory(history.sessions || [], history.archived || []);
  const homeRuns = await window.pi.homeGetRuns();
  state.homeRuns = homeRuns.runs || [];
  refreshKb();
  renderSummary(await window.pi.summaryGetState());
  if (!isFloat) window.pi.ready();
}

init();
