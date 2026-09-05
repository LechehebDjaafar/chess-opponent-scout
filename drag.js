// drag.js — drag-to-reposition for the dashboard panel, with the position
// remembered across page loads (per site).

window.COS = window.COS || {};

window.COS.makeDraggable = function makeDraggable(panelEl, handleEl, storageKey) {
  chrome.storage.local.get(storageKey, (data) => {
    const pos = data[storageKey];
    if (pos && typeof pos.right === "number" && typeof pos.bottom === "number") {
      panelEl.style.right = pos.right + "px";
      panelEl.style.bottom = pos.bottom + "px";
      panelEl.style.left = "auto";
      panelEl.style.top = "auto";
    }
  });

  let dragging = false;
  let startX = 0,
    startY = 0,
    startRight = 0,
    startBottom = 0;

  handleEl.style.cursor = "grab";

  handleEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    handleEl.style.cursor = "grabbing";
    const rect = panelEl.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let right = startRight - dx;
    let bottom = startBottom - dy;
    right = Math.max(4, Math.min(window.innerWidth - 60, right));
    bottom = Math.max(4, Math.min(window.innerHeight - 60, bottom));
    panelEl.style.right = right + "px";
    panelEl.style.bottom = bottom + "px";
    panelEl.style.left = "auto";
    panelEl.style.top = "auto";
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handleEl.style.cursor = "grab";
    const right = parseFloat(panelEl.style.right) || 0;
    const bottom = parseFloat(panelEl.style.bottom) || 0;
    chrome.storage.local.set({ [storageKey]: { right, bottom } });
  });
};
