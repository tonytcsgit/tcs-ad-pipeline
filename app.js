/* TCS Ad Creation Pipeline — Timeline & Stage Board (static, no build step) */

(function () {
  "use strict";

  /* ---------------- Constants ---------------- */

  var STAGE_LABELS = {
    script: "Script",
    production: "Production",
    review: "Review / QA",
    bp_review: "At Broughton",
    done: "Done / Live",
    other: "Other",
  };

  var STAGE_COLOR_VAR = {
    script: "--script",
    production: "--prod",
    review: "--review",
    bp_review: "--bp",
    done: "--done",
    other: "--other",
  };

  // hours (working hours for bp_review)
  var SLA = {
    script: { stuck: 24 },
    production: { amber: 24, stuck: 48 },
    review: { amber: 24, stuck: 48 },
    bp_review: { amber: 24, stuck: 48, workingHours: true },
  };

  // Exact-match status -> stage, per CLAUDE.md mapping table.
  var STATUS_MAP = {
    "script in progress": "script",
    "start production": "script",
    "visuals in progress": "production",
    "working on it": "production",
    "mp3 received": "production",
    "production paused": "production",
    "video done / to be reviewed": "review",
    "some ads fixed – to be reviewed": "review",
    "some ads fixed - to be reviewed": "review",
    "new bp disclaimer in progress": "review",
    "revisions in progress": "review",
    "some ads refused - in rework": "review",
    "in review by broughton": "bp_review",
    "in review by stinar": "bp_review",
  };

  var EXCLUDED_STATUSES = ["placeholder - do not delete"];

  var DAY_MS = 24 * 60 * 60 * 1000;
  var loggedUnmapped = {};

  /* ---------------- Date helpers ---------------- */

  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Date-only fields ("YYYY-MM-DD") must be read as local calendar dates —
  // `new Date("2026-07-07")` parses as UTC midnight, which shifts a day
  // backwards/forwards once compared against local day boundaries.
  function parseDateOnly(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return parseDate(s);
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function dayStart(d) {
    var c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  }

  function addDays(d, n) {
    var c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  }

  function hoursBetween(a, b) {
    return (b.getTime() - a.getTime()) / (60 * 60 * 1000);
  }

  // Elapsed hours between a and b, counting only Mon–Fri.
  function workingHoursBetween(a, b) {
    if (b <= a) return 0;
    var hours = 0;
    var cursor = new Date(a);
    while (cursor < b) {
      var dayEnd = dayStart(addDays(cursor, 1));
      var segEnd = dayEnd < b ? dayEnd : b;
      var dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        hours += hoursBetween(cursor, segEnd);
      }
      cursor = segEnd;
    }
    return hours;
  }

  function fmtDateShort(d) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fmtDateTime(d) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function fmtDuration(hours) {
    if (hours < 24) return Math.round(hours) + "h";
    return Math.round(hours / 24) + "d";
  }

  /* ---------------- Stage derivation ---------------- */

  function deriveStage(task) {
    var status = (task.status || "").trim().toLowerCase();

    if (EXCLUDED_STATUSES.indexOf(status) !== -1) return "excluded";

    // Trust the stage the sync pipeline already derived (authoritative per data
    // contract). Only fall back to client-side derivation for legacy/sample data
    // that predates the stage field.
    var VALID_STAGES = ["script", "production", "review", "bp_review", "done", "other"];
    if (task.stage && VALID_STAGES.indexOf(task.stage) !== -1) {
      return task.stage;
    }

    if (/upload|approved|\blive\b|launched|scheduled|put back live/.test(status)) return "done";

    if (STATUS_MAP.hasOwnProperty(status)) return STATUS_MAP[status];

    if (/in review by/.test(status)) return "bp_review";

    if (task.bp_submitted && !/upload|approved|\blive\b/.test(status)) {
      return "bp_review";
    }

    if (!loggedUnmapped[status]) {
      loggedUnmapped[status] = true;
      console.warn('[pipeline] unmapped status "' + task.status + '" -> "other"', task.name);
    }
    return "other";
  }

  // Ordered known milestones -> the stage active *after* that date.
  function milestonePoints(task) {
    var pts = [];
    var s = parseDateOnly(task.script_start);
    var ps = parseDateOnly(task.prod_started);
    var pe = parseDateOnly(task.prod_end);
    var bp = parseDateOnly(task.bp_submitted);
    if (s) pts.push({ date: s, stage: "script" });
    if (ps) pts.push({ date: ps, stage: "production" });
    if (pe) pts.push({ date: pe, stage: "review" });
    if (bp) pts.push({ date: bp, stage: "bp_review" });
    pts.sort(function (a, b) {
      return a.date - b.date;
    });
    return pts;
  }

  function computeTaskMeta(task, now) {
    var stage = deriveStage(task);
    var updatedAt = parseDate(task.updated_at) || now;
    var pts = milestonePoints(task);

    var isDone = stage === "done";
    var finalEnd = isDone ? updatedAt : now;

    var barStart = pts.length ? pts[0].date : updatedAt;
    if (finalEnd < barStart) finalEnd = barStart;

    var segments = [];
    if (pts.length === 0) {
      segments.push({ stage: stage, start: barStart, end: finalEnd });
    } else {
      for (var i = 0; i < pts.length; i++) {
        var segStart = pts[i].date;
        var segEnd = i + 1 < pts.length ? pts[i + 1].date : finalEnd;
        if (segEnd < segStart) segEnd = segStart;
        segments.push({ stage: pts[i].stage, start: segStart, end: segEnd });
      }
    }

    // Time-in-current-stage: latest relevant date field, else updated_at.
    var stageEntry = null;
    if (stage === "script") stageEntry = parseDateOnly(task.script_start);
    else if (stage === "production") stageEntry = parseDateOnly(task.prod_started);
    else if (stage === "review") stageEntry = parseDateOnly(task.prod_end);
    else if (stage === "bp_review") stageEntry = parseDateOnly(task.bp_submitted);
    if (!stageEntry) stageEntry = updatedAt;

    var slaCfg = SLA[stage];
    var elapsedHours = null;
    var isStuck = false;
    var isAmber = false;
    if (slaCfg) {
      elapsedHours = slaCfg.workingHours
        ? workingHoursBetween(stageEntry, now)
        : hoursBetween(stageEntry, now);
      isStuck = elapsedHours > slaCfg.stuck;
      isAmber = slaCfg.amber != null && elapsedHours > slaCfg.amber && !isStuck;
    }

    var dueDate = parseDateOnly(task.due_date);
    var isOverdue = !!dueDate && !isDone && dayStart(now) > dayStart(dueDate);

    return {
      stage: stage,
      segments: segments,
      barStart: barStart,
      barEnd: finalEnd,
      stageEntry: stageEntry,
      elapsedHours: elapsedHours,
      isStuck: isStuck,
      isAmber: isAmber,
      isOverdue: isOverdue,
      isDone: isDone,
    };
  }

  /* ---------------- Data loading ---------------- */

  var state = {
    tasks: [],
    syncedAt: null,
    filters: {
      tort: [],
      marketer: [],
      channel: [],
      editor: [],
      priority: [],
      buyer: [],
    },
    toggles: {
      overdue: false,
      archived: false,
      done7: true, // "show done" limited to last 7 days when true
    },
    search: "",
    tab: "timeline",
  };

  var FILTER_DEFS = [
    { key: "tort", label: "Tort", getValues: function (t) { return t.tags || []; } },
    { key: "marketer", label: "Marketer", getValues: function (t) { return [t.marketer || "Unassigned"]; } },
    { key: "channel", label: "Channel", getValues: function (t) { return [t.channel || "Unset"]; } },
    { key: "editor", label: "Editor team", getValues: function (t) { return t.editors && t.editors.length ? t.editors : ["Unassigned"]; } },
    { key: "priority", label: "Priority", getValues: function (t) { return [t.priority || "None"]; } },
    { key: "buyer", label: "Buyer", getValues: function (t) { return t.buyer && t.buyer.length ? t.buyer : ["None"]; } },
  ];

  function loadData() {
    var statusLine = document.getElementById("status-line");
    fetch("data/data.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        var now = new Date();
        state.syncedAt = parseDate(json.synced_at);
        state.tasks = (json.tasks || [])
          .map(function (t) {
            var meta = computeTaskMeta(t, now);
            if (meta.stage === "excluded") return null;
            var merged = Object.create(t);
            for (var k in t) merged[k] = t[k];
            merged._meta = meta;
            return merged;
          })
          .filter(Boolean);
        statusLine.textContent = "";
        statusLine.className = "status-line";
        init();
      })
      .catch(function (err) {
        statusLine.textContent = "Failed to load data/data.json: " + err.message;
        statusLine.className = "status-line error";
        console.error(err);
      });
  }

  /* ---------------- URL state ---------------- */

  function readUrlState() {
    var params = new URLSearchParams(window.location.search);
    FILTER_DEFS.forEach(function (def) {
      var raw = params.get(def.key);
      state.filters[def.key] = raw ? raw.split(",").filter(Boolean) : [];
    });
    state.toggles.overdue = params.get("overdue") === "1";
    state.toggles.archived = params.get("archived") === "1";
    state.toggles.done7 = params.get("done") !== "0";
    state.search = params.get("q") || "";
    var tab = params.get("tab");
    if (tab === "board" || tab === "timeline") state.tab = tab;
  }

  function writeUrlState() {
    var params = new URLSearchParams();
    FILTER_DEFS.forEach(function (def) {
      if (state.filters[def.key].length) {
        params.set(def.key, state.filters[def.key].join(","));
      }
    });
    if (state.toggles.overdue) params.set("overdue", "1");
    if (state.toggles.archived) params.set("archived", "1");
    if (!state.toggles.done7) params.set("done", "0");
    if (state.search) params.set("q", state.search);
    if (state.tab !== "timeline") params.set("tab", state.tab);
    var qs = params.toString();
    var url = window.location.pathname + (qs ? "?" + qs : "");
    window.history.replaceState(null, "", url);
  }

  /* ---------------- Filtering ---------------- */

  function taskMatchesFilter(task, def) {
    var selected = state.filters[def.key];
    if (!selected.length) return true;
    var values = def.getValues(task);
    return values.some(function (v) {
      return selected.indexOf(v) !== -1;
    });
  }

  function getFilteredTasks() {
    var now = new Date();
    var sevenDaysAgo = now.getTime() - 7 * DAY_MS;
    var q = state.search.trim().toLowerCase();

    return state.tasks.filter(function (task) {
      if (!state.toggles.archived && task.archived) return false;
      if (state.toggles.overdue && !task._meta.isOverdue) return false;

      if (task._meta.isDone && state.toggles.done7) {
        var doneAt = task._meta.barEnd;
        if (doneAt && doneAt.getTime() < sevenDaysAgo) return false;
      }

      if (q && task.name.toLowerCase().indexOf(q) === -1) return false;

      for (var i = 0; i < FILTER_DEFS.length; i++) {
        if (!taskMatchesFilter(task, FILTER_DEFS[i])) return false;
      }
      return true;
    });
  }

  /* ---------------- Filter bar rendering ---------------- */

  function renderFilterBar() {
    var group = document.getElementById("filter-group");
    group.innerHTML = "";

    FILTER_DEFS.forEach(function (def) {
      var valueSet = {};
      state.tasks.forEach(function (t) {
        def.getValues(t).forEach(function (v) {
          valueSet[v] = (valueSet[v] || 0) + 1;
        });
      });
      var values = Object.keys(valueSet).sort();

      var details = document.createElement("details");
      details.className = "filter";
      var selectedCount = state.filters[def.key].length;
      if (selectedCount) details.classList.add("active");

      var summary = document.createElement("summary");
      summary.textContent = def.label + (selectedCount ? ": " + selectedCount : ": All") + " ▾";
      details.appendChild(summary);

      var menu = document.createElement("div");
      menu.className = "filter-menu";

      if (!values.length) {
        var empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No data";
        menu.appendChild(empty);
      }

      values.forEach(function (v) {
        var label = document.createElement("label");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = state.filters[def.key].indexOf(v) !== -1;
        cb.addEventListener("change", function () {
          var idx = state.filters[def.key].indexOf(v);
          if (cb.checked && idx === -1) state.filters[def.key].push(v);
          if (!cb.checked && idx !== -1) state.filters[def.key].splice(idx, 1);
          writeUrlState();
          var count = state.filters[def.key].length;
          summary.textContent = def.label + (count ? ": " + count : ": All") + " ▾";
          details.classList.toggle("active", count > 0);
          renderActiveView();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(v + " (" + valueSet[v] + ")"));
        menu.appendChild(label);
      });

      details.appendChild(menu);
      group.appendChild(details);
    });

    var toggleGroup = document.getElementById("toggle-group");
    toggleGroup.innerHTML = "";
    addChipToggle(toggleGroup, "⚠ Overdue only", state.toggles.overdue, function (v) {
      state.toggles.overdue = v;
      writeUrlState();
      renderActiveView();
    });
    addChipToggle(toggleGroup, "Show archived", state.toggles.archived, function (v) {
      state.toggles.archived = v;
      writeUrlState();
      renderActiveView();
    });
    addChipToggle(toggleGroup, "Done: last 7d only", state.toggles.done7, function (v) {
      state.toggles.done7 = v;
      writeUrlState();
      renderActiveView();
    });

    var searchBox = document.getElementById("search-box");
    searchBox.value = state.search;
  }

  function addChipToggle(container, label, on, onChange) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-toggle" + (on ? " on" : "");
    btn.textContent = label;
    btn.addEventListener("click", function () {
      var next = !btn.classList.contains("on");
      btn.classList.toggle("on", next);
      onChange(next);
    });
    container.appendChild(btn);
  }

  function clearFilters() {
    FILTER_DEFS.forEach(function (def) {
      state.filters[def.key] = [];
    });
    state.toggles.overdue = false;
    state.toggles.archived = false;
    state.toggles.done7 = true;
    state.search = "";
    writeUrlState();
    renderFilterBar();
    renderActiveView();
  }

  /* ---------------- Synced stamp ---------------- */

  function renderSyncedStamp() {
    var el = document.getElementById("synced-stamp");
    if (!state.syncedAt) {
      el.textContent = "Sync time unknown";
      return;
    }
    var mins = Math.round((Date.now() - state.syncedAt.getTime()) / 60000);
    var text;
    if (mins < 1) text = "Last synced just now";
    else if (mins < 60) text = "Last synced " + mins + "m ago";
    else text = "Last synced " + Math.round(mins / 60) + "h ago";
    el.textContent = text;
    el.classList.toggle("stale", mins > 120);
  }

  /* ---------------- Tooltip ---------------- */

  var tooltipEl;
  function showTooltip(evt, task) {
    if (!tooltipEl) tooltipEl = document.getElementById("tooltip");
    var meta = task._meta;
    var rows = [];
    if (task.script_start) rows.push(["Script start", fmtDateShort(parseDateOnly(task.script_start))]);
    if (task.prod_started) rows.push(["Production start", fmtDateShort(parseDateOnly(task.prod_started))]);
    if (task.prod_end) rows.push(["Production end", fmtDateShort(parseDateOnly(task.prod_end))]);
    if (task.bp_submitted) rows.push(["Submitted to BP", fmtDateShort(parseDateOnly(task.bp_submitted))]);
    if (task.due_date) rows.push(["Due", fmtDateShort(parseDateOnly(task.due_date))]);
    rows.push(["Status", task.status]);
    rows.push(["Stage", STAGE_LABELS[meta.stage] || meta.stage]);
    if (meta.elapsedHours != null) rows.push(["Time in stage", fmtDuration(meta.elapsedHours)]);
    rows.push(["Updated", fmtDateTime(parseDate(task.updated_at))]);

    var html = '<div class="tt-title">' + escapeHtml(task.name) + "</div>";
    rows.forEach(function (r) {
      html += '<div class="tt-row"><span>' + escapeHtml(r[0]) + "</span><span>" + escapeHtml(String(r[1])) + "</span></div>";
    });
    tooltipEl.innerHTML = html;
    tooltipEl.hidden = false;
    positionTooltip(evt);
  }

  function positionTooltip(evt) {
    if (!tooltipEl || tooltipEl.hidden) return;
    var x = evt.clientX + 16;
    var y = evt.clientY + 16;
    var vw = window.innerWidth, vh = window.innerHeight;
    var rect = tooltipEl.getBoundingClientRect();
    if (x + rect.width > vw) x = vw - rect.width - 8;
    if (y + rect.height > vh) y = vh - rect.height - 8;
    tooltipEl.style.left = x + "px";
    tooltipEl.style.top = y + "px";
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function openTask(task) {
    if (task.url) window.open(task.url, "_blank", "noopener");
  }

  /* ---------------- Timeline (Gantt) render ---------------- */

  function renderTimeline(tasks) {
    var gantt = document.getElementById("gantt");
    var now = new Date();
    var windowStart = dayStart(addDays(now, -14));
    var windowEnd = dayStart(addDays(now, 8)); // +7 full days visible, exclusive end
    var totalDays = Math.round((windowEnd - windowStart) / DAY_MS);

    gantt.style.setProperty("--ndays", totalDays);
    gantt.innerHTML = "";

    var head = document.createElement("div");
    head.className = "ghead";
    var nameHead = document.createElement("div");
    nameHead.textContent = "VIDEO";
    head.appendChild(nameHead);
    var todayIdx = Math.round((dayStart(now) - windowStart) / DAY_MS);
    for (var i = 0; i < totalDays; i++) {
      var d = addDays(windowStart, i);
      var cell = document.createElement("div");
      cell.textContent = d.getDate() === 1 || i === 0 ? fmtDateShort(d) : String(d.getDate());
      if (i === todayIdx) cell.classList.add("today-col");
      head.appendChild(cell);
    }
    gantt.appendChild(head);

    if (!tasks.length) {
      var empty = document.createElement("div");
      empty.className = "no-rows";
      empty.textContent = "No tasks match the current filters.";
      gantt.appendChild(empty);
      return;
    }

    tasks.forEach(function (task) {
      gantt.appendChild(renderGanttRow(task, windowStart, windowEnd, totalDays, todayIdx));
    });
  }

  function clampFrac(days, totalDays) {
    return Math.max(0, Math.min(totalDays, days));
  }

  function renderGanttRow(task, windowStart, windowEnd, totalDays, todayIdx) {
    var meta = task._meta;
    var row = document.createElement("div");
    row.className = "grow";

    var nameCell = document.createElement("div");
    nameCell.className = "gname";
    nameCell.innerHTML =
      escapeHtml(task.name) +
      (task.tags && task.tags[0] ? '<span class="tag">' + escapeHtml(task.tags[0]) + "</span>" : "") +
      '<span class="m">' +
      escapeHtml([task.marketer, (task.editors || [])[0]].filter(Boolean).join(" · ")) +
      "</span>";
    nameCell.addEventListener("click", function () { openTask(task); });
    nameCell.addEventListener("mouseenter", function (e) { showTooltip(e, task); });
    nameCell.addEventListener("mousemove", positionTooltip);
    nameCell.addEventListener("mouseleave", hideTooltip);
    row.appendChild(nameCell);

    var track = document.createElement("div");
    track.className = "bar-track";

    var todayLine = document.createElement("div");
    todayLine.className = "today-line";
    todayLine.style.left = "calc(" + todayIdx + " * var(--datecol))";
    track.appendChild(todayLine);

    var startFrac = clampFrac((meta.barStart - windowStart) / DAY_MS, totalDays);
    var endFrac = clampFrac((meta.barEnd - windowStart) / DAY_MS, totalDays);
    if (endFrac <= startFrac) endFrac = startFrac + 0.15;

    var bar = document.createElement("div");
    bar.className = "bar" + (meta.isOverdue ? " od" : "") + (meta.isStuck ? " stk" : "");
    bar.style.left = "calc(" + startFrac + " * var(--datecol))";
    bar.style.width = "calc(" + (endFrac - startFrac) + " * var(--datecol))";

    var totalSpan = meta.barEnd - meta.barStart || 1;
    meta.segments.forEach(function (seg) {
      var segFrac = (seg.end - seg.start) / totalSpan;
      if (segFrac <= 0) return;
      var segDiv = document.createElement("div");
      segDiv.className = "seg";
      segDiv.style.width = (segFrac * 100) + "%";
      segDiv.style.background = "var(" + (STAGE_COLOR_VAR[seg.stage] || "--other") + ")";
      bar.appendChild(segDiv);
    });

    bar.addEventListener("click", function () { openTask(task); });
    bar.addEventListener("mouseenter", function (e) { showTooltip(e, task); });
    bar.addEventListener("mousemove", positionTooltip);
    bar.addEventListener("mouseleave", hideTooltip);
    track.appendChild(bar);

    var flagText = buildFlagText(task);
    if (flagText) {
      var flag = document.createElement("div");
      flag.className = "flag";
      flag.textContent = flagText;
      flag.style.left = "calc(" + (endFrac + 0.3) + " * var(--datecol))";
      track.appendChild(flag);
    }

    row.appendChild(track);
    return row;
  }

  function buildFlagText(task) {
    var meta = task._meta;
    var parts = [];
    if (meta.isOverdue) parts.push("🔴 due " + fmtDateShort(parseDateOnly(task.due_date)));
    if (meta.isStuck) parts.push("🟠 " + fmtDuration(meta.elapsedHours) + " in " + STAGE_LABELS[meta.stage]);
    return parts.join(" · ");
  }

  /* ---------------- Stage Board render ---------------- */

  var BOARD_COLUMNS = [
    { stage: "script", icon: "📝", title: "SCRIPT" },
    { stage: "production", icon: "🎬", title: "PRODUCTION" },
    { stage: "review", icon: "🔍", title: "REVIEW / QA" },
    { stage: "bp_review", icon: "📤", title: "AT BROUGHTON" },
    { stage: "done", icon: "✅", title: "DONE / LIVE" },
  ];

  function renderBoard(tasks) {
    var board = document.getElementById("board");
    board.innerHTML = "";

    var byStage = {};
    BOARD_COLUMNS.forEach(function (c) { byStage[c.stage] = []; });
    tasks.forEach(function (t) {
      var s = t._meta.stage === "other" ? "review" : t._meta.stage;
      if (byStage[s]) byStage[s].push(t);
      else if (s === "other") byStage.review.push(t);
    });

    BOARD_COLUMNS.forEach(function (colDef) {
      var list = byStage[colDef.stage].slice();
      list.sort(function (a, b) {
        var aFlag = a._meta.isStuck || a._meta.isOverdue ? 1 : 0;
        var bFlag = b._meta.isStuck || b._meta.isOverdue ? 1 : 0;
        if (aFlag !== bFlag) return bFlag - aFlag;
        var aH = a._meta.elapsedHours != null ? a._meta.elapsedHours : hoursBetween(a._meta.stageEntry, new Date());
        var bH = b._meta.elapsedHours != null ? b._meta.elapsedHours : hoursBetween(b._meta.stageEntry, new Date());
        return bH - aH;
      });

      var col = document.createElement("div");
      col.className = "col";
      col.setAttribute("data-stage", colDef.stage);

      var hd = document.createElement("div");
      hd.className = "colhd";
      hd.innerHTML =
        "<span>" + colDef.icon + " " + colDef.title + "</span><span class=\"cnt\">" + list.length + "</span>";
      col.appendChild(hd);

      var body = document.createElement("div");
      body.className = "col-body";

      if (!list.length) {
        var empty = document.createElement("div");
        empty.className = "col-empty";
        empty.textContent = "Nothing here";
        body.appendChild(empty);
      }

      list.forEach(function (task) {
        body.appendChild(renderBoardCard(task, colDef.stage));
      });

      col.appendChild(body);
      board.appendChild(col);
    });
  }

  function renderBoardCard(task, colStage) {
    var meta = task._meta;
    var card = document.createElement("div");
    card.className = "cardi" + (meta.isStuck ? " stk" : "") + (meta.isOverdue ? " od" : "");

    var ageLabel;
    if (colStage === "done") {
      ageLabel = fmtDateShort(meta.barEnd);
    } else {
      var h = meta.elapsedHours != null ? meta.elapsedHours : hoursBetween(meta.stageEntry, new Date());
      ageLabel = fmtDuration(h) + (meta.isStuck ? " 🟠" : meta.isOverdue ? " ⚠" : "");
    }

    var subParts = [];
    if (task.marketer) subParts.push(task.marketer);
    if (colStage === "done") {
      subParts.push(task.status);
    } else if (task.editors && task.editors.length) {
      subParts.push(task.editors[0]);
    } else {
      subParts.push("unassigned");
    }
    if (colStage === "bp_review" && task.bp_submitted) {
      subParts.push("submitted " + fmtDateShort(parseDateOnly(task.bp_submitted)));
    }
    if (meta.isOverdue && task.due_date) subParts.push("due " + fmtDateShort(parseDateOnly(task.due_date)));

    var slaCfg = SLA[colStage];
    var pct = 0;
    if (slaCfg && meta.elapsedHours != null) {
      pct = Math.max(0, Math.min(100, (meta.elapsedHours / slaCfg.stuck) * 100));
    } else if (colStage === "done") {
      pct = 100;
    }
    var barColor = meta.isStuck
      ? "var(--stuck)"
      : meta.isOverdue
      ? "var(--overdue)"
      : "var(" + STAGE_COLOR_VAR[colStage] + ")";

    card.innerHTML =
      '<span class="age">' + escapeHtml(ageLabel) + "</span>" +
      '<div class="t">' + escapeHtml(task.name) + "</div>" +
      '<div class="m">' + escapeHtml(subParts.join(" · ")) +
      (task.tags && task.tags[0] ? ' <span class="tag">' + escapeHtml(task.tags[0]) + "</span>" : "") +
      "</div>" +
      (colStage !== "done"
        ? '<div class="aging"><div style="width:' + pct + '%;background:' + barColor + '"></div></div>'
        : "");

    card.addEventListener("click", function () { openTask(task); });
    card.addEventListener("mouseenter", function (e) { showTooltip(e, task); });
    card.addEventListener("mousemove", positionTooltip);
    card.addEventListener("mouseleave", hideTooltip);
    return card;
  }

  /* ---------------- Tabs / view switching ---------------- */

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      var active = btn.getAttribute("data-tab") === tab;
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.getElementById("timeline-view").hidden = tab !== "timeline";
    document.getElementById("board-view").hidden = tab !== "board";
    writeUrlState();
    renderActiveView();
  }

  function renderActiveView() {
    var filtered = getFilteredTasks();
    document.getElementById("task-count").textContent =
      filtered.length + " of " + state.tasks.length + " tasks shown";
    if (state.tab === "timeline") renderTimeline(filtered);
    else renderBoard(filtered);
  }

  /* ---------------- Init ---------------- */

  function init() {
    readUrlState();
    renderFilterBar();
    renderSyncedStamp();
    setInterval(renderSyncedStamp, 60000);

    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setTab(btn.getAttribute("data-tab")); });
    });

    var searchBox = document.getElementById("search-box");
    searchBox.addEventListener("input", function () {
      state.search = searchBox.value;
      writeUrlState();
      renderActiveView();
    });

    document.getElementById("clear-filters").addEventListener("click", clearFilters);

    document.addEventListener("click", function (evt) {
      document.querySelectorAll("details.filter[open]").forEach(function (d) {
        if (!d.contains(evt.target)) d.removeAttribute("open");
      });
    });

    setTab(state.tab);
  }

  document.addEventListener("DOMContentLoaded", loadData);
})();
