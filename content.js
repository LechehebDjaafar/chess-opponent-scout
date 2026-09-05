// content.js — orchestrates the dashboard: opponent scouting stats, the
// live clock readout, the time-pressure alarm, and the opponent "state"
// badge. Runs on lichess.org and chess.com.

(function () {
  const { el, formatSeconds } = window.COS.util;

  const platform = location.hostname.includes("lichess.org")
    ? "lichess"
    : location.hostname.includes("chess.com")
    ? "chesscom"
    : null;
  if (!platform) return;

  const MY_NAME_KEY = platform === "lichess" ? "myUsernameLichess" : "myUsernameChesscom";
  const DEFAULT_ALARM_PCT = 35;

  let panel = null;
  let clockTracker = null;
  let lastGameKey = null;
  let alarmActive = false;
  let alarmThresholdPct = DEFAULT_ALARM_PCT;

  chrome.storage.sync.get({ alarmThresholdPct: DEFAULT_ALARM_PCT }, (data) => {
    alarmThresholdPct = data.alarmThresholdPct;
  });

  // ---------- game-page detection (SPA navigation, no full reloads) ----------

  function currentGameKey() {
    const path = location.pathname;
    if (platform === "lichess") {
      const m = path.match(/^\/([A-Za-z0-9]{8})(?:\/(white|black))?\/?$/);
      return m ? m[1] : null;
    }
    const m = path.match(/\/game\/(live|daily)\/(\d+)/) || path.match(/\/(live|daily)\/game\/(\d+)/);
    return m ? `${m[1]}-${m[2]}` : null;
  }

  setInterval(() => {
    const key = currentGameKey();
    if (key && key !== lastGameKey) {
      lastGameKey = key;
      onNewGameDetected();
    } else if (!key && lastGameKey) {
      lastGameKey = null;
      if (clockTracker) clockTracker.stop();
    }
  }, 1200);

  function onNewGameDetected() {
    alarmActive = false;
    openPanel({ autoOpened: true });
  }

  // ---------- opponent-name guessing (best effort, always editable) ----------

  function guessFromTitle() {
    const m = document.title.match(/([A-Za-z0-9_\-]{2,30})\s+(?:vs\.?|-|–)\s+([A-Za-z0-9_\-]{2,30})/i);
    return m ? [m[1], m[2]] : null;
  }

  function guessFromDom() {
    try {
      let names = [];
      if (platform === "lichess") {
        document
          .querySelectorAll(".ruser a.user-link, .ruser-top a.user-link, .ruser-bottom a.user-link")
          .forEach((n) => n.textContent.trim() && names.push(n.textContent.trim()));
      } else {
        document
          .querySelectorAll('[class*="username" i], [data-test*="username" i]')
          .forEach((n) => {
            const t = n.textContent.trim();
            if (/^[A-Za-z0-9_\-]{2,30}$/.test(t)) names.push(t);
          });
      }
      names = [...new Set(names)];
      return names.length >= 2 ? names.slice(0, 2) : null;
    } catch (e) {
      return null;
    }
  }

  async function guessOpponent() {
    const stored = await chrome.storage.sync.get(MY_NAME_KEY);
    const mine = (stored[MY_NAME_KEY] || "").toLowerCase().trim();
    const candidates = guessFromDom() || guessFromTitle();
    if (!candidates) return "";
    if (!mine) return candidates[0];
    return candidates.find((n) => n.toLowerCase() !== mine) || "";
  }

  // ---------- launcher ----------

  const launcher = el("div", { id: "cos-launcher", title: "Chess Opponent Scout" });
  launcher.textContent = "♞";
  document.documentElement.appendChild(launcher);
  launcher.addEventListener("click", () => {
    if (panel) closePanel();
    else openPanel({ autoOpened: false });
  });

  function closePanel() {
    if (clockTracker) {
      clockTracker.stop();
      clockTracker = null;
    }
    if (panel) panel.remove();
    panel = null;
  }

  // ---------- dashboard ----------

  async function openPanel(opts) {
    if (panel) return;
    const platformLabel = platform === "lichess" ? "Lichess" : "Chess.com";

    panel = el("div", { id: "cos-panel" });

    const head = el("div", { class: "cos-head" }, [
      el("span", { class: "cos-title", text: `لوحة الرصد — ${platformLabel}` }),
      el("span", { class: "cos-headicons" }, [
        el("span", { class: "cos-gear", text: "⚙", title: "الإعدادات" }),
        el("span", { class: "cos-close", text: "✕", title: "إغلاق" }),
      ]),
    ]);
    panel.appendChild(head);

    const body = el("div", { class: "cos-body" });
    panel.appendChild(body);
    document.documentElement.appendChild(panel);

    window.COS.makeDraggable(panel, head, `pos_${platform}`);

    head.querySelector(".cos-close").addEventListener("mousedown", (e) => e.stopPropagation());
    head.querySelector(".cos-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel();
    });
    head.querySelector(".cos-gear").addEventListener("mousedown", (e) => e.stopPropagation());
    head.querySelector(".cos-gear").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSettings(body);
    });

    // -- settings row (hidden by default) --
    const settingsRow = el("div", { class: "cos-settings-row cos-hidden" });
    settingsRow.appendChild(el("label", { class: "cos-field-label", text: "نسبة إنذار الوقت (%)" }));
    const settingsInputRow = el("div", { class: "cos-input-row" });
    const thresholdInput = el("input", { type: "text", inputmode: "numeric" });
    thresholdInput.value = alarmThresholdPct;
    const saveBtn = el("button", { class: "cos-btn cos-btn-small", text: "حفظ" });
    settingsInputRow.appendChild(thresholdInput);
    settingsInputRow.appendChild(saveBtn);
    settingsRow.appendChild(settingsInputRow);
    settingsRow.appendChild(
      el("div", {
        class: "cos-hint",
        text: "إذا أصبح وقتك أقل من وقت الخصم بهذه النسبة، تظهر لك رسالة تنبيه.",
      })
    );
    saveBtn.addEventListener("click", () => {
      const v = parseFloat(thresholdInput.value);
      if (!isNaN(v) && v > 0 && v < 100) {
        alarmThresholdPct = v;
        chrome.storage.sync.set({ alarmThresholdPct: v });
      }
    });
    body.appendChild(settingsRow);

    // -- alarm banner (hidden until triggered) --
    const alarmBanner = el("div", { class: "cos-alarm cos-hidden" });
    body.appendChild(alarmBanner);

    // -- live clock section --
    const clockSection = el("div", { class: "cos-section" });
    clockSection.appendChild(el("div", { class: "cos-section-title", text: "الوقت المباشر" }));
    const clockStatus = el("div", { class: "cos-hint", text: "بصدد رصد الساعة تلقائياً…" });
    clockSection.appendChild(clockStatus);

    const clockRow = el("div", { class: "cos-clockrow cos-hidden" });
    const oppClock = buildClockBlock("الخصم");
    const meClock = buildClockBlock("أنت");
    clockRow.appendChild(oppClock.root);
    clockRow.appendChild(meClock.root);
    clockSection.appendChild(clockRow);

    const swapRow = el("div", { class: "cos-swaprow cos-hidden" });
    const swapBtn = el("button", { class: "cos-link-btn", text: "الاتجاهات معكوسة؟ اضغط للتبديل" });
    swapRow.appendChild(swapBtn);
    clockSection.appendChild(swapRow);

    const badgeRow = el("div", { class: "cos-badgerow cos-hidden" });
    const oppBadge = buildBadge("حالة الخصم");
    const meBadge = buildBadge("وتيرتك");
    badgeRow.appendChild(oppBadge.root);
    badgeRow.appendChild(meBadge.root);
    clockSection.appendChild(badgeRow);

    body.appendChild(clockSection);

    // -- opponent name + scout --
    const scoutSection = el("div", { class: "cos-section" });
    scoutSection.appendChild(el("div", { class: "cos-field-label", text: "اسم الخصم" }));
    const inputRow = el("div", { class: "cos-input-row" });
    const nameInput = el("input", { type: "text", placeholder: "username" });
    const goBtn = el("button", { class: "cos-btn", text: "تحليل" });
    inputRow.appendChild(nameInput);
    inputRow.appendChild(goBtn);
    scoutSection.appendChild(inputRow);
    scoutSection.appendChild(
      el("div", { class: "cos-hint", text: "التخمين التلقائي غير مضمون — تأكد من الاسم أو عدّله." })
    );
    const status = el("div", { class: "cos-status" });
    scoutSection.appendChild(status);
    body.appendChild(scoutSection);

    const results = el("div", { class: "cos-results" });
    body.appendChild(results);

    // -- wire up scouting --
    const runScout = () => {
      const username = nameInput.value.trim();
      if (!username) {
        status.className = "cos-status cos-error";
        status.textContent = "اكتب اسم مستخدم الخصم أولاً.";
        return;
      }
      scout(username, status, results, goBtn);
    };
    goBtn.addEventListener("click", runScout);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runScout();
    });

    const guessed = await guessOpponent();
    nameInput.value = guessed;
    if (guessed) runScout();
    else if (!opts.autoOpened) {
      nameInput.focus();
    }

    // -- wire up live clock --
    swapBtn.addEventListener("click", () => {
      if (clockTracker) clockTracker.swapSides();
    });

    clockTracker = new window.COS.ClockTracker();
    clockTracker.onUpdate((data) => {
      if (!data.locked) {
        clockRow.classList.add("cos-hidden");
        swapRow.classList.add("cos-hidden");
        badgeRow.classList.add("cos-hidden");
        clockStatus.classList.remove("cos-hidden");
        clockStatus.textContent = "بصدد رصد الساعة تلقائياً…";
        return;
      }
      clockStatus.classList.add("cos-hidden");
      clockRow.classList.remove("cos-hidden");
      swapRow.classList.remove("cos-hidden");
      badgeRow.classList.remove("cos-hidden");

      const meVal = data.bottom;
      const oppVal = data.top;
      updateClockBlock(oppClock, oppVal, data.activeSide === "top");
      updateClockBlock(meClock, meVal, data.activeSide === "bottom");

      if (data.moveDurations) {
        const oppState = window.COS.evaluateState({
          remaining: oppVal,
          baseline: data.baselineTop,
          moveDurations: data.moveDurations.top,
        });
        const meState = window.COS.evaluateState({
          remaining: meVal,
          baseline: data.baselineBottom,
          moveDurations: data.moveDurations.bottom,
        });
        updateBadge(oppBadge, oppState);
        updateBadge(meBadge, meState);
      }

      checkAlarm(meVal, oppVal, alarmBanner);
    });
    clockTracker.start();
  }

  function buildClockBlock(label) {
    const root = el("div", { class: "cos-clock" }, [
      el("div", { class: "cos-clock-label", text: label }),
      el("div", { class: "cos-clock-time", text: "--:--" }),
    ]);
    return { root, timeEl: root.querySelector(".cos-clock-time") };
  }

  function updateClockBlock(block, seconds, active) {
    block.timeEl.textContent = formatSeconds(seconds);
    block.root.classList.toggle("cos-clock-active", !!active);
    block.root.classList.toggle("cos-clock-low", seconds != null && seconds < 20);
  }

  function buildBadge(label) {
    const root = el("div", { class: "cos-badge" }, [
      el("div", { class: "cos-badge-label", text: label }),
      el("div", { class: "cos-badge-value", text: "—" }),
      el("div", { class: "cos-badge-detail" }),
    ]);
    return {
      root,
      valueEl: root.querySelector(".cos-badge-value"),
      detailEl: root.querySelector(".cos-badge-detail"),
    };
  }

  function updateBadge(badge, state) {
    badge.valueEl.textContent = state.label;
    badge.detailEl.textContent = state.detail;
    badge.root.className = `cos-badge cos-state-${state.key}`;
  }

  function checkAlarm(meVal, oppVal, banner) {
    if (meVal == null || oppVal == null || oppVal <= 0) return;
    const behindPct = ((oppVal - meVal) / oppVal) * 100;
    const shouldAlarm = behindPct >= alarmThresholdPct;

    if (shouldAlarm && !alarmActive) {
      alarmActive = true;
      chrome.runtime.sendMessage({
        type: "COS_NOTIFY",
        title: "⏱ تنبيه وقت",
        message: `أنت متأخر عن خصمك بأكثر من ${Math.round(alarmThresholdPct)}% من الوقت. عدّل سرعتك.`,
      });
    } else if (!shouldAlarm) {
      alarmActive = false;
    }

    if (shouldAlarm) {
      banner.classList.remove("cos-hidden");
      banner.textContent = `⚠ أنت متأخر بالوقت عن خصمك بنسبة ${Math.round(behindPct)}% — عدّل سرعتك.`;
    } else {
      banner.classList.add("cos-hidden");
    }
  }

  function toggleSettings(body) {
    const row = body.querySelector(".cos-settings-row");
    row.classList.toggle("cos-hidden");
  }

  function scout(username, status, results, goBtn) {
    goBtn.disabled = true;
    results.innerHTML = "";
    status.className = "cos-status";
    status.textContent = "جارٍ جلب آخر 100 مباراة…";

    chrome.runtime.sendMessage({ type: "SCOUT_REQUEST", username, platform }, (res) => {
      goBtn.disabled = false;
      if (chrome.runtime.lastError) {
        status.className = "cos-status cos-error";
        status.textContent = "خطأ في الاتصال بالإضافة. أعد تحميل الصفحة.";
        return;
      }
      if (!res || !res.ok) {
        status.className = "cos-status cos-error";
        status.textContent = errorMessage(res && res.error);
        return;
      }
      status.textContent = "";
      renderStats(results, username, res.stats);
    });
  }

  function errorMessage(code) {
    switch (code) {
      case "player_not_found":
        return "لم يتم العثور على هذا اللاعب.";
      case "no_games":
        return "لا توجد مباريات كافية لهذا اللاعب.";
      case "empty_username":
        return "اكتب اسم مستخدم صحيح.";
      default:
        return "تعذّر جلب البيانات. حاول مرة أخرى.";
    }
  }

  function trendLabel(trend) {
    if (trend === "improving") return { arrow: "▲", text: "في تحسّن" };
    if (trend === "declining") return { arrow: "▼", text: "في تراجع" };
    return { arrow: "▬", text: "مستقر" };
  }

  function openingRow(o, kind) {
    const scoreText =
      kind === "weak" ? `${o.losses}-${o.wins} (خسر ${o.lossRate}%)` : `${o.wins}-${o.losses} (فاز ${o.winRate}%)`;
    return el("div", { class: `cos-opening-row cos-${kind}` }, [
      el("span", { class: "cos-opening-name", text: o.name }),
      el("span", { class: "cos-opening-score", text: scoreText }),
    ]);
  }

  function renderStats(container, username, stats) {
    container.innerHTML = "";

    const summarySection = el("div", { class: "cos-section" });
    summarySection.appendChild(
      el("div", { class: "cos-section-title", text: `آخر ${stats.total} مباراة — ${username}` })
    );

    const record = el("span", { class: "cos-record" });
    record.innerHTML = `<b class="cos-w">${stats.wins}ف</b> · <b class="cos-l">${stats.losses}خ</b> · <b class="cos-d">${stats.draws}ت</b>`;
    const summary = el("div", { class: "cos-summary" }, [
      el("span", { class: "cos-winrate", text: `${stats.winRate}%` }),
      record,
    ]);
    summarySection.appendChild(summary);

    const t = trendLabel(stats.trend);
    const trendEl = el("div", { class: `cos-trend cos-${stats.trend}` }, [
      el("span", { class: "cos-arrow", text: t.arrow }),
      el("span", { text: `${t.text} (${stats.olderRate}% → ${stats.recentRate}%)` }),
    ]);
    summarySection.appendChild(trendEl);
    container.appendChild(summarySection);

    const weakSection = el("div", { class: "cos-section" });
    weakSection.appendChild(el("div", { class: "cos-section-title", text: "أضعف افتتاحاته (يخسر بها كثيراً)" }));
    if (stats.weakOpenings.length) {
      stats.weakOpenings.forEach((o) => weakSection.appendChild(openingRow(o, "weak")));
    } else {
      weakSection.appendChild(el("div", { class: "cos-empty", text: "لا توجد بيانات كافية." }));
    }
    container.appendChild(weakSection);

    const strongSection = el("div", { class: "cos-section" });
    strongSection.appendChild(el("div", { class: "cos-section-title", text: "أقوى افتتاحاته (تجنّبها)" }));
    if (stats.strongOpenings.length) {
      stats.strongOpenings.forEach((o) => strongSection.appendChild(openingRow(o, "strong")));
    } else {
      strongSection.appendChild(el("div", { class: "cos-empty", text: "لا توجد بيانات كافية." }));
    }
    container.appendChild(strongSection);
  }
})();
