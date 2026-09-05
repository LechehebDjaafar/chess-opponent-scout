// clock-tracker.js — finds the two live game clocks on the page.
//
// Site markup changes without notice, so instead of hard-coding CSS
// selectors this watches for elements whose text looks like a clock
// ("3:24", "0:12.4"...) AND is actually observed ticking down over time.
// Only elements that behave like a real countdown get "locked in" as the
// two player clocks; everything else (timestamps, move lists, ads) is
// ignored automatically.

window.COS = window.COS || {};

window.COS.ClockTracker = class ClockTracker {
  constructor() {
    this.samples = new Map(); // element -> [{t, val}, ...]
    this.locked = null; // { top: el, bottom: el, baselineTop, baselineBottom }
    this.activeSide = null; // 'top' | 'bottom' | null
    this.turnStartedAt = null;
    this.moveDurations = { top: [], bottom: [] };
    this.listeners = [];
    this._timer = null;
  }

  onUpdate(cb) {
    this.listeners.push(cb);
  }

  start() {
    this.stop();
    this._timer = setInterval(() => this._tick(), 600);
    this._tick();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  swapSides() {
    if (!this.locked) return;
    const { top, bottom } = this.locked;
    this.locked.top = bottom;
    this.locked.bottom = top;
  }

  _searchRoot() {
    const boardish = document.querySelector(
      "cg-container, .board-layout-main, .layout-board, wc-chess-board, chess-board, .board, main"
    );
    let root = boardish;
    // walk up a couple of levels to include the player boxes around the board
    for (let i = 0; i < 3 && root && root.parentElement; i++) root = root.parentElement;
    return root || document.body;
  }

  _tick() {
    if (this.locked) {
      this._readLocked();
      return;
    }
    this._discover();
  }

  _discover() {
    const root = this._searchRoot();
    const els = root.querySelectorAll("*");
    const now = performance.now();
    const seen = new Set();

    for (const node of els) {
      if (node.childElementCount > 1) continue; // want leaf-ish nodes
      const text = node.textContent;
      if (!text || text.length > 8) continue;
      const val = window.COS.util.parseClockText(text);
      if (val == null) continue;
      if (!window.COS.util.isVisible(node)) continue;

      seen.add(node);
      const hist = this.samples.get(node) || [];
      hist.push({ t: now, val });
      if (hist.length > 6) hist.shift();
      this.samples.set(node, hist);
    }

    // drop stale candidates no longer present
    for (const key of this.samples.keys()) {
      if (!seen.has(key)) this.samples.delete(key);
    }

    // an element is "live" if it has decreased at least once by a plausible
    // amount between two consecutive samples
    const live = [];
    for (const [node, hist] of this.samples.entries()) {
      let decreased = false;
      for (let i = 1; i < hist.length; i++) {
        const delta = hist[i - 1].val - hist[i].val;
        if (delta > 0.05 && delta <= 6) decreased = true;
      }
      if (decreased) live.push(node);
    }

    if (live.length >= 2) {
      // pick the two whose vertical positions are most separated —
      // those are almost certainly the two player clocks
      const withRect = live.map((n) => ({ n, rect: n.getBoundingClientRect() }));
      withRect.sort((a, b) => a.rect.top - b.rect.top);
      const top = withRect[0].n;
      const bottom = withRect[withRect.length - 1].n;
      if (top !== bottom && bottom.getBoundingClientRect().top - top.getBoundingClientRect().top > 40) {
        const topVal = this.samples.get(top).at(-1).val;
        const bottomVal = this.samples.get(bottom).at(-1).val;
        this.locked = { top, bottom, baselineTop: topVal, baselineBottom: bottomVal };
        this.samples.clear();
        this._emit({ locked: true });
      }
    }
  }

  _readLocked() {
    const { top, bottom } = this.locked;
    if (!document.contains(top) || !document.contains(bottom)) {
      this.locked = null; // element got removed (game ended, view changed) — rediscover
      this._emit({ locked: false });
      return;
    }
    const topVal = window.COS.util.parseClockText(top.textContent);
    const bottomVal = window.COS.util.parseClockText(bottom.textContent);
    if (topVal == null || bottomVal == null) {
      this.locked = null;
      this._emit({ locked: false });
      return;
    }

    // figure out whose clock is currently ticking, to time moves
    const now = performance.now();
    const prevTop = this._lastTop;
    const prevBottom = this._lastBottom;
    let currentSide = this.activeSide;

    if (prevTop != null && prevBottom != null) {
      const topDropped = prevTop - topVal > 0.05;
      const bottomDropped = prevBottom - bottomVal > 0.05;
      if (topDropped && !bottomDropped) currentSide = "top";
      else if (bottomDropped && !topDropped) currentSide = "bottom";
    }

    if (currentSide !== this.activeSide) {
      if (this.activeSide && this.turnStartedAt != null) {
        const duration = (now - this.turnStartedAt) / 1000;
        if (duration > 0.4 && duration < 1800) {
          const arr = this.moveDurations[this.activeSide];
          arr.push(duration);
          if (arr.length > 12) arr.shift();
        }
      }
      this.activeSide = currentSide;
      this.turnStartedAt = now;
    }

    this._lastTop = topVal;
    this._lastBottom = bottomVal;

    this._emit({
      locked: true,
      top: topVal,
      bottom: bottomVal,
      baselineTop: this.locked.baselineTop,
      baselineBottom: this.locked.baselineBottom,
      activeSide: this.activeSide,
      moveDurations: this.moveDurations,
    });
  }

  _emit(data) {
    this.listeners.forEach((cb) => cb(data));
  }
};
