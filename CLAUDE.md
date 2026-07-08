# TCS Ad Creation Pipeline Timeline

## What this is
A static single-page web app (GitHub Pages) visualizing the video-ad creation pipeline for the TCS marketing team, driven by a Notion database ("Ad Creation Process") synced to `data/data.json` by a local cron script (already handled — do NOT build the sync; consume `data/data.json`).

## Views (two tabs)
1. **Timeline (default, "Variant A")** — Gantt-style. Time on X axis, one row per video/task. Bar segments colored by stage duration (Script / Production / Review / At BP). Red vertical "today" line. Overdue = solid red outline on bar + red flag annotation; Stuck = dashed orange outline + flag. Reference mockup: `mockups/mock_a.html` (dark theme — keep it).
2. **Stage Board ("Variant B")** — Kanban by stage: Script → Production → Review/QA → At Broughton → Done/Live. Cards show video name, marketer, editor team, tort tag, time-in-stage, aging bar toward SLA. Overdue/stuck cards float to top with colored left borders. Reference mockup: `mockups/mock_b.html` (light theme in mock — restyle to match A's dark theme for consistency).

## Data contract (data/data.json)
```json
{
  "synced_at": "2026-07-08T09:30:00Z",
  "tasks": [
    {
      "id": "notion-page-id",
      "url": "https://notion.so/...",
      "name": "CHLOR (1-4) (Mo)",
      "marketer": "Morane",            // Marketer CBO select: Jordan | Morane | Charlie | null
      "tags": ["CHLOR"],                // tort tags
      "channel": "META",                // META | YT
      "editors": ["Iqbal & Team"],
      "priority": "High",               // High | Medium | Low | null
      "buyer": ["BP"],
      "status": "In review by Broughton", // raw Notion status string
      "stage": "bp_review",             // derived: script | production | review | bp_review | done | other
      "script_start": "2026-07-06",
      "prod_started": "2026-07-06",
      "prod_end": "2026-07-06",
      "bp_submitted": "2026-07-06",
      "due_date": "2026-07-02",
      "updated_at": "2026-07-07T18:00:00Z",
      "archived": false
    }
  ]
}
```
A sample file with ~30 realistic tasks is at `data/data.json` — build against it.

## Stage mapping (raw Notion Status → stage)
- script: "Script in progress", "Start production" (no prod_started yet)
- production: "Visuals in progress", "Working on it", "MP3 received", "Production paused"
- review: "Video done / To be reviewed", "Some ads fixed – to be reviewed", "New BP disclaimer in progress", "Revisions in progress", "some ads refused - In rework"
- bp_review: "In review by Broughton", "In review by Stinar" (or bp_submitted set and not done)
- done: uploaded/approved/live statuses
- Exclude entirely: "Placeholder - DO NOT DELETE"
- Unknown statuses → "other" (render grey, don't crash). Log unmapped statuses to console.

## SLAs (for stuck/overdue logic) — from Andrew
- Script: 24 hours
- Production: 24–48 hours (amber at 24h, red/stuck at 48h)
- BP review: 24–48 **working hours** (skip Sat/Sun when computing elapsed)
- Review/QA (internal): 24h amber, 48h stuck
- Overdue = past `due_date` and not done.
- Stuck = time-in-current-stage exceeds the stage's max SLA.
- Time-in-stage: derive from the latest relevant date field (stage entry date); fall back to `updated_at` if dates missing. Missing data → no flag (never false-positive).

## Filters (both views, shared state, URL-persisted ?tort=&marketer=&channel=...)
- Tort (from tags), Marketer, Channel (META/YT), Editor team, Priority, Buyer
- Toggles: "Overdue only", "Show archived" (default off), "Show done" (default: last 7 days of done)
- Text search box on task name.

## Interactions
- Click bar/card → open Notion page (task.url) in new tab.
- Hover → tooltip with full stage history (dates) and status.
- "Last synced Xm ago" stamp top-right from synced_at; turns red if > 2 hours.

## Tech constraints
- Static: single index.html + css + vanilla JS (or lightweight lib inlined). NO build step, NO npm — must work by opening index.html and on GitHub Pages.
- Dark theme per mock_a. Responsive enough for a laptop; phones = usable scroll, not priority.
- Timeline window: default trailing 14 days + 7 forward, horizontal scroll for more.
- Keep it fast for ~500 tasks.

## Definition of done
- `index.html` renders both tabs correctly from `data/data.json`
- Filters work and combine; URL params restore state
- Overdue/stuck logic matches SLA spec incl. working-days rule for BP review
- No console errors; unmapped statuses logged not thrown
- README.md with 5-line deploy note (GitHub Pages) and data contract summary
