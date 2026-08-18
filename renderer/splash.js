/* Pi Desktop — 加载窗口（Splash）：初始化进度 + 平滑放大
 * 放大：内容双轴 scale 平滑放大（GPU），无图标移动、无圆角。
 * 两阶段：zoom（放大）→ fade（淡出，主窗口已在下方）
 */
(function () {
  "use strict";

  const statusEl = document.getElementById("splashStatus");
  const content = document.getElementById("splashContent");
  const wrap = document.getElementById("splashLogoWrap");
  const uiEls = document.querySelectorAll(".splash-ring, .splash-title, .splash-bar, .splash-status");

  function setStatus(text, cls) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "splash-status" + (cls ? " " + cls : "");
  }

  // 初始化进度（主进程推送）
  if (window.pi?.onEvent) {
    window.pi.onEvent("splash:status", (d) => {
      setStatus(d?.text, d?.cls);
    });

    // 窗口放大前准备：预置初始缩放比例（避免放大瞬间闪帧）
    window.pi.onEvent("splash:prepare", (d) => {
      const root = document.documentElement;
      if (typeof d?.sx === "number" && d.sx > 0 && d.sx < 1) {
        root.style.setProperty("--zoom-sx", String(d.sx));
      }
      if (typeof d?.sy === "number" && d.sy > 0 && d.sy < 1) {
        root.style.setProperty("--zoom-sy", String(d.sy));
      }
    });

    // 阶段 1：平滑放大（内容从屏幕中心扩大）
    window.pi.onEvent("splash:zoom", (d) => {
      if (!content) return;
      const sx0 = typeof d?.sx === "number" && d.sx > 0 ? d.sx : 1;
      const sy0 = typeof d?.sy === "number" && d.sy > 0 ? d.sy : sx0;
      const dur = typeof d?.duration === "number" ? d.duration : 560;

      // 文字/光环淡出（缩放期间只留界面主体）
      uiEls.forEach((el) => {
        el.style.transition = "opacity .22s ease";
        el.style.opacity = "0";
      });

      content.style.transformOrigin = "50% 50%";
      const easeOut = (t) => 1 - Math.pow(1 - t, 3);
      const t0 = performance.now();

      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = easeOut(t);
        const sx = sx0 + (1 - sx0) * e;
        const sy = sy0 + (1 - sy0) * e;
        content.style.transform = `scale(${sx}, ${sy})`;
        if (t < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    // 阶段 2：整体淡出（主窗口已在下方显示）
    window.pi.onEvent("splash:fade", (d) => {
      if (!content) return;
      const dur = typeof d?.duration === "number" ? d.duration : 260;
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        content.style.opacity = String(1 - t);
        if (t < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  // 兜底：2.5 秒内没有收到任何推送也至少显示一个状态
  setTimeout(() => {
    if (statusEl && statusEl.textContent === "正在启动…") {
      setStatus("正在加载…");
    }
  }, 2500);
})();
