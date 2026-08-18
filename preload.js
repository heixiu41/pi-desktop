const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pi", {
  send: (text) => ipcRenderer.send("pi:send", text),
  abort: () => ipcRenderer.send("pi:abort"),
  newSession: () => ipcRenderer.send("pi:new-session"),
  pickCwd: () => ipcRenderer.invoke("pi:pick-cwd"),
  getAvailableModels: () => ipcRenderer.invoke("pi:get-available-models"),
  setModel: (provider, id) => ipcRenderer.send("pi:set-model", { provider, id }),
  setThinking: (level) => ipcRenderer.send("pi:set-thinking", level),
  getState: () => ipcRenderer.invoke("pi:get-state"),
  getSystemPrompt: () => ipcRenderer.invoke("pi:get-system-prompt"),
  setSystemPrompt: (prompt) => ipcRenderer.invoke("pi:set-system-prompt", prompt),
  openExternal: (url) => ipcRenderer.invoke("pi:open-external", url),
  onEvent: (channel, cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  ready: () => ipcRenderer.send("pi:ready"),

  // 下载管理
  dlList: () => ipcRenderer.invoke("dl:list"),
  dlAdd: (opts) => ipcRenderer.invoke("dl:add", opts),
  dlPause: (id) => ipcRenderer.send("dl:pause", id),
  dlResume: (id) => ipcRenderer.send("dl:resume", id),
  dlStop: (id) => ipcRenderer.send("dl:stop", id),
  dlRetry: (id) => ipcRenderer.send("dl:retry", id),
  dlRemove: (id) => ipcRenderer.send("dl:remove", id),
  dlOpenFolder: (id) => ipcRenderer.send("dl:open-folder", id),
  dlPickDest: () => ipcRenderer.invoke("dl:pick-dest"),

  // 历史记录
  getHistory: () => ipcRenderer.invoke("session:history"),
  loadSession: (path) => ipcRenderer.invoke("session:load", path),
  deleteSession: (path) => ipcRenderer.invoke("session:delete", path),
  archiveSession: (path) => ipcRenderer.invoke("session:archive", path),
  restoreSession: (path) => ipcRenderer.invoke("session:restore", path),

  // 停靠面板
  dlFloat: () => ipcRenderer.send("dl:float"),
  dlFocusFloat: () => ipcRenderer.send("dl:focus-float"),
  dlMinimize: () => ipcRenderer.send("dl:minimize"),

  // 节点画布
  nodeOpen: () => ipcRenderer.send("node:open"),
  nodeReady: () => ipcRenderer.send("node:ready"),
  nodeReload: () => ipcRenderer.invoke("node:reload-nodes"),
  homeGetRuns: () => ipcRenderer.invoke("home:get-runs"),
  nodeGetState: () => ipcRenderer.invoke("node:get-state"),
  nodeSave: (bp) => ipcRenderer.invoke("node:save-blueprint", bp),
  nodeLoad: (id, preset) => ipcRenderer.invoke("node:load-blueprint", { id, preset }),
  nodeDelete: (id) => ipcRenderer.invoke("node:delete-blueprint", id),
  nodeRun: (blueprint, selection, wait) => ipcRenderer.invoke("node:run", { blueprint, selection, wait }),
  nodeAbort: (runId) => ipcRenderer.send("node:run-abort", runId),
  nodeGetRun: (runId) => ipcRenderer.invoke("node:get-run", runId),

  // 知识库（RAG）
  kbList: () => ipcRenderer.invoke("kb:list"),
  kbStatus: () => ipcRenderer.invoke("kb:status"),
  kbImportFile: (path) => ipcRenderer.invoke("kb:import-file", path),
  kbImportText: (name, text) => ipcRenderer.invoke("kb:import-text", { name, text }),
  kbDelete: (id) => ipcRenderer.invoke("kb:delete", id),
  kbSearch: (query, k) => ipcRenderer.invoke("kb:search", { query, k }),
  kbPickFile: () => ipcRenderer.invoke("kb:pick-file"),

  // 今日总结
  summaryGetState: () => ipcRenderer.invoke("summary:get-state"),
  summarySetConfig: (config) => ipcRenderer.invoke("summary:set-config", config),
  summaryRunNow: () => ipcRenderer.invoke("summary:run-now"),
  summaryDelete: (id) => ipcRenderer.invoke("summary:delete", id),

  // API 配置
  apiGetState: () => ipcRenderer.invoke("api:get-state"),
  apiSaveKey: (provider, key) => ipcRenderer.invoke("api:save-key", { provider, key }),
  apiTest: (provider, key) => ipcRenderer.invoke("api:test", { provider, key }),
  apiSetDefaultModel: (provider, modelId) =>
    ipcRenderer.invoke("api:set-default-model", { provider, modelId }),
  apiGetEnvKey: () => ipcRenderer.invoke("api:env-key"),
});
