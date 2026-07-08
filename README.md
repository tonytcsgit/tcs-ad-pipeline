# TCS Ad Creation Pipeline Timeline

Static single-page dashboard visualizing the TCS video-ad creation pipeline (Gantt timeline + stage Kanban), driven by a Notion database synced to `data/data.json` by a separate local cron script.

## Deploy (GitHub Pages)

1. Push this repo to GitHub.
2. Repo → Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Done — `index.html` is the entry point. No build step, no npm.
4. The sync cron must keep committing/pushing `data/data.json` for the "Last synced" stamp to stay green (turns red after 2h).
5. Local preview: `python3 -m http.server 8741` in the repo root, open `http://localhost:8741`.

## Data contract (`data/data.json`)

```json
{
  "synced_at": "ISO timestamp",
  "tasks": [{
    "id": "notion-page-id", "url": "https://notion.so/…",
    "name": "CHLOR (1-4) (Mo)",
    "marketer": "Jordan | Morane | Charlie | null",
    "tags": ["tort tags"], "channel": "META | YT",
    "editors": ["Iqbal & Team"], "priority": "High | Medium | Low | null",
    "buyer": ["BP"], "status": "raw Notion status string",
    "stage": "script | production | review | bp_review | done | other",
    "script_start": "YYYY-MM-DD", "prod_started": "…", "prod_end": "…",
    "bp_submitted": "…", "due_date": "…",
    "updated_at": "ISO timestamp", "archived": false
  }]
}
```

Unknown statuses render grey ("other") and are logged to console, never thrown.

## Views

- **Timeline** — Gantt; bar segments colored by stage; red today line; overdue = red outline + flag, stuck = dashed orange + flag.
- **Stage Board** — Kanban: Script → Production → Review/QA → At Broughton → Done/Live. Flagged cards float to top.

## SLAs (stuck logic)

- Script 24h · Production 24h amber / 48h stuck · Review/QA 24h/48h
- BP review 24h/48h **working hours** (Sat/Sun excluded)
- Overdue = past `due_date` and not done. Missing dates → no flag.

Filters (tort/marketer/channel/editor/priority/buyer, overdue-only, archived, done-7d, search) persist in URL params.
