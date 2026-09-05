// utils.js — small shared helpers used by the other content-script files.
window.COS = window.COS || {};

window.COS.util = (function () {
  function parseClockText(raw) {
    const text = (raw || "").trim();
    let m = text.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/); // H:MM:SS
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    m = text.match(/^(\d{1,2}):([0-5]\d)\.(\d)$/); // M:SS.d (low-time display)
    if (m) return (+m[1]) * 60 + (+m[2]) + (+m[3]) / 10;
    m = text.match(/^(\d{1,2}):([0-5]\d)$/); // M:SS
    if (m) return (+m[1]) * 60 + (+m[2]);
    return null;
  }

  function formatSeconds(total) {
    if (total == null) return "--:--";
    const s = Math.max(0, Math.round(total));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.appendChild(c);
    return n;
  }

  function isVisible(elm) {
    const rect = elm.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(elm);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  return { parseClockText, formatSeconds, el, isVisible };
})();
