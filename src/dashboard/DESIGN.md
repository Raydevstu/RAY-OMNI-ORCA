# DESIGN.md — orch dashboard

Local read-only dashboard for one project root. No new dependencies (node:http + node:sqlite only), no CDN, single page, hand-drawn SVG charts. Light palette: Cloud Canvas (`#fafafa` bg, `#ffffff` surface, `#2563eb` primary, `#0f172a` text).

## Run

`orch dashboard --root DIR [--port 7687]` binds 127.0.0.1 only, prints the URL, serves until Ctrl-C.

## Pages (sidebar, 248px)

1. Overview — 30-day activity bars (events/day), gate frequency bars, tasks-by-status list.
2. Tasks — table: id, goal, status, created, execution bound or not.
3. Approvals — donut (approved/denied/pending), table with decision time, gate list.
4. Verification — pass/fail list with checks and findings per run.
5. Benchmarks — last 7 days vs prior 7 days: tasks started, approval rate, median decision ms, verify pass rate, gate hits. Grouped bars plus signed deltas.

## API (all GET JSON, read-only)

- /api/overview, /api/tasks, /api/confirmations, /api/verifications
- /api/activity?days=30, /api/benchmark

## Data notes

- verify_changes persists a trimmed run row into verification_runs (previously write-only schema, never written). Best-effort, never fails verification.
- All values served are already redacted at write time; dashboard adds no new persistence.
- Empty states are plain text rows, never placeholder charts.
