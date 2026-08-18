/* ============================================================
 * Pi 桌面 — 统一 SVG 图标库 + 动画播放工具
 * index.html / canvas.html 共用；图标均为 24×24 描边风格
 * （与下载图标 dl-ico 同一套视觉体系：stroke、currentColor）
 * ------------------------------------------------------------
 * 用法：
 *   PiIcon.svg("chat")                 → 返回 <svg class="ico ico-chat">…
 *   PiIcon.inject()                    → 填充所有 <span data-ico="xx"> 空容器
 *   PiIcon.play(el, cls, ms)           → 给图标播一次性动画（类加在 <svg> 上）
 *   PiIcon.setActive(el, bool)         → 切换常驻状态类 active
 *   PiIcon.busy(el)                    → 是否有未结束的一次性动画
 *   PiIcon.reset(el)                   → 清掉全部一次性动画类
 * ============================================================ */
(function () {
  "use strict";

  const ICONS = {
    /* 导航：聊天 */
    chat: `
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      <g class="dot"><line x1="8.5" y1="11.5" x2="8.5" y2="11.5"/></g>
      <g class="dot"><line x1="12" y1="11.5" x2="12" y2="11.5"/></g>
      <g class="dot"><line x1="15.5" y1="11.5" x2="15.5" y2="11.5"/></g>`,

    /* 导航：下载（保持 dl-ico 结构，兼容旧 CSS 动画） */
    download: `
      <g class="ico-arrow">
        <line x1="12" y1="3.5" x2="12" y2="13"/>
        <polyline points="7.5 8.5 12 13 16.5 8.5"/>
      </g>
      <rect class="ico-progress" x="5.5" y="16.8" width="13" height="3.7" rx="1.8" fill="currentColor" stroke="none"/>
      <path class="ico-tray" d="M21 15.5v3.5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-3.5"/>
      <ellipse class="ico-ripple" cx="12" cy="21.2" rx="2.6" ry="0.8" fill="currentColor" stroke="none"/>
      <polyline class="ico-check" points="8.5 12.5 11 15 15.5 10"/>`,

    /* 导航：节点（拼图块） */
    puzzle: `
      <g class="piece">
        <path d="M19.44 7.85c-.05.32.06.65.29.88l1.57 1.57c.47.47.7 1.09.7 1.7s-.23 1.24-.7 1.7l-1.61 1.62a.98.98 0 0 1-.84.27c-.47-.07-.8-.48-.97-.92a2.5 2.5 0 1 0-3.21 3.21c.44.17.85.5.92.97a.98.98 0 0 1-.27.84l-1.61 1.61a2.4 2.4 0 0 1-1.71.7 2.4 2.4 0 0 1-1.7-.7l-1.57-1.57a1.03 1.03 0 0 0-.88-.3c-.49.08-.84.51-1.02.97a2.5 2.5 0 1 1-3.24-3.24c.46-.18.89-.52.97-1.02a1.03 1.03 0 0 0-.29-.88l-1.57-1.57A2.4 2.4 0 0 1 2 12c0-.62.24-1.24.7-1.7l1.53-1.53c.24-.24.58-.35.92-.3.51.08.88.53 1.07 1.01a2.5 2.5 0 1 0 3.26-3.26c-.48-.2-.93-.56-1.01-1.07-.05-.34.06-.68.3-.92l1.53-1.53A2.4 2.4 0 0 1 12 2c.62 0 1.24.24 1.7.7l1.57 1.57c.23.23.56.34.88.29.49-.08.84-.51 1.02-.97a2.5 2.5 0 1 1 3.24 3.24c-.46.18-.9.52-.97 1.02Z"/>
      </g>`,

    /* 历史记录折叠箭头 */
    chev: `<polyline points="6 9 12 15 18 9"/>`,

    /* 刷新 */
    refresh: `
      <path class="arc" d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path class="arc" d="M3 3v5h5"/>
      <path class="arc" d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
      <path class="arc" d="M21 21v-5h-5"/>`,

    /* 垃圾桶 */
    trash: `
      <g class="lid"><path d="M3 6h18"/></g>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,

    /* 归档（盒子） */
    archive: `
      <path d="M3 7h18v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/>
      <path d="M21 7l-1.2-3.2A1 1 0 0 0 18.85 3H5.15a1 1 0 0 0-.95.8L3 7"/>
      <path d="M10 12h4"/>`,

    /* 恢复（从归档取回） */
    restore: `
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
      <path d="M3 3v5h5"/>`,

    /* 知识库（书） */
    book: `
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>`,

    /* 上传（导入） */
    upload: `
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>`,

    /* 侧边栏折叠（«） */
    collapse: `<polyline points="15 18 9 12 15 6"/>`,

    /* 加号 */
    plus: `<path class="plus-v" d="M12 5v14"/><path class="plus-h" d="M5 12h14"/>`,

    /* 停靠方向 */
    dockleft: `<path d="M19 12H5"/><path class="arr" d="m12 19-7-7 7-7"/>`,
    dockright: `<path d="M5 12h14"/><path class="arr" d="m12 5 7 7-7 7"/>`,
    docktop: `<path d="M12 19V5"/><path class="arr" d="m5 12 7-7 7 7"/>`,
    dockbottom: `<path d="M12 5v14"/><path class="arr" d="m5 12 7 7 7-7"/>`,

    /* 独立成窗口 */
    floatwin: `
      <path class="corner" d="M8 3H5a2 2 0 0 0-2 2v3"/>
      <path class="corner" d="M21 8V5a2 2 0 0 0-2-2h-3"/>
      <path class="corner" d="M3 16v3a2 2 0 0 0 2 2h3"/>
      <path class="corner" d="M16 21h3a2 2 0 0 0 2-2v-3"/>`,

    /* 关闭 */
    close: `<g class="x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></g>`,

    /* 最小化 */
    minimize: `<rect class="bar" x="4" y="10.75" width="16" height="2.5" rx="1.25" fill="currentColor" stroke="none"/>`,

    /* 停靠回主窗口 */
    dockback: `
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <path d="M3 9h18"/>
      <g class="arr"><path d="M18 15h3v3"/><path d="m21 15-5 5"/></g>`,

    /* 发送（纸飞机） */
    send: `
      <g class="plane">
        <path d="m22 2-7 20-4-9-9-4Z"/>
        <path d="M22 2 11 13"/>
      </g>`,

    /* 停止 */
    stop: `<rect x="5" y="5" width="14" height="14" rx="2.5"/>`,

    /* 运行（播放） */
    run: `<polygon class="tri" points="6 3 20 12 6 21 6 3"/>`,

    /* 调试（虫子） */
    debug: `
      <g class="bug">
        <path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/>
        <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
        <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/>
        <path d="M12 20v-9"/>
        <path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/>
        <path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
        <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/>
        <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
      </g>`,

    /* 新会话（文件+） */
    newfile: `
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <g class="plus"><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></g>`,

    /* 保存（软盘） */
    save: `
      <g class="floppy">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </g>
      <rect class="slot" x="9.5" y="3" width="5" height="4" rx="1" fill="currentColor" stroke="none" opacity="0"/>`,

    /* 面板（书） */
    lib: `
      <g class="book">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </g>`,

    /* 齿轮（配置） */
    key: `
      <circle cx="7.5" cy="15.5" r="4.5"/>
      <path d="m11 12 9.5-9.5"/>
      <path d="M16.5 6.5 19.5 9.5"/>
      <path d="m14 9 2 2"/>`,

    gear: `
      <g class="gear">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </g>`,

    /* 复制 */
    copy: `
      <rect x="8" y="2" width="8" height="4" rx="1"/>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>`,

    /* 拖动手柄（3×2 圆点） */
    grip: `
      <g class="dots">
        <line x1="9" y1="6" x2="9" y2="6"/>
        <line x1="15" y1="6" x2="15" y2="6"/>
        <line x1="9" y1="12" x2="9" y2="12"/>
        <line x1="15" y1="12" x2="15" y2="12"/>
        <line x1="9" y1="18" x2="9" y2="18"/>
        <line x1="15" y1="18" x2="15" y2="18"/>
      </g>`,

    /* 今日总结（文档 + 对勾） */
    summary: `
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <g class="lines">
        <path d="m9 13.5 1.6 1.6 3-3.1"/>
        <line x1="9" y1="18.5" x2="13" y2="18.5"/>
      </g>`,
  };

  // 图标别名 → 追加的 class（保持旧下载图标 CSS 兼容）
  const ALIAS = { download: "dl-ico" };

  /** 生成图标 SVG 字符串 */
  function svg(name, extraClass) {
    const body = ICONS[name];
    if (!body) return "";
    const cls = ["ico", "ico-" + name];
    if (ALIAS[name]) cls.push(ALIAS[name]);
    if (extraClass) cls.push(extraClass);
    return `<svg class="${cls.join(" ")}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  /** 从容器元素定位到内部的 <svg>（或本身就是 <svg>） */
  function iconEl(el) {
    if (!el) return null;
    if (el.classList && (el.classList.contains("ico") || el.classList.contains("dl-ico"))) return el;
    return el.querySelector(".ico, .dl-ico");
  }

  const ONE_SHOT = ["playing", "done", "shake", "pulse", "spin", "send", "flash"];

  /**
   * 播放一次性动画。类加在 <svg> 上（CSS 选择器以 svg 类为锚，与 test.html 一致）。
   * ms=0 表示不自动移除（常驻状态，配合 PiIcon.reset 结束）。
   */
  function play(el, cls, ms) {
    const svgEl = iconEl(el);
    if (!svgEl) return;
    ONE_SHOT.forEach((c) => svgEl.classList.remove(c));
    void svgEl.getBoundingClientRect();
    svgEl.classList.add(cls);
    clearTimeout(svgEl._icoTimer);
    if (ms) {
      svgEl._icoTimer = setTimeout(() => {
        svgEl.classList.remove(cls);
        svgEl._icoTimer = null;
      }, ms);
    }
  }

  /** 是否有未结束的一次性动画 */
  function busy(el) {
    const svgEl = iconEl(el);
    return !!(svgEl && svgEl._icoTimer);
  }

  /** 切换常驻状态（active 等） */
  function setActive(el, on) {
    const svgEl = iconEl(el);
    if (svgEl) svgEl.classList.toggle("active", !!on);
  }

  /** 清掉全部一次性动画类 */
  function reset(el) {
    const svgEl = iconEl(el);
    if (!svgEl) return;
    ONE_SHOT.forEach((c) => svgEl.classList.remove(c));
    clearTimeout(svgEl._icoTimer);
    svgEl._icoTimer = null;
  }

  /** 填充所有 <span data-ico="name"> 空容器（有子元素则跳过，可幂等） */
  function inject(root) {
    (root || document).querySelectorAll("[data-ico]").forEach((el) => {
      if (el.children.length) return;
      el.innerHTML = svg(el.dataset.ico);
    });
  }

  window.PiIcon = { svg, play, busy, setActive, reset, inject };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => inject());
  } else {
    inject();
  }
})();
