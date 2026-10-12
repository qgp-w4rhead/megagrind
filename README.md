# MEGAGRIND

Work more than Bill Gates. Do it healthily.

A comprehensive time tracking system designed for maximum productivity—168 hours a week, fully accounted for.

## Quick Start

### Prerequisites
- Node.js ^20.19.0 or >=22.12.0
- pnpm 10 (`corepack enable`)

### Installation

```bash
# Installs frontend and server dependencies (pnpm workspace)
pnpm install
```

### Running the App

```bash
# Frontend + backend together (frontend :5173, API :3000, /api proxied)
pnpm dev:all
```

Or run them separately:

```bash
# Frontend only — works standalone in local mode with localStorage
pnpm dev

# Backend only (http://localhost:3000)
pnpm server:dev
```

The Vite dev server proxies `/api/*` to `http://localhost:3000`, so no CORS or URL config is needed in dev.

## Features

## Offline-First Data Persistence

Your data is always safe, even without an internet connection. MegaGrind automatically saves everything to your browser's local storage, so you can track your time whether the server is up/accessible or down.)

When you reconnect, it seamlessly syncs to the SQLite backend. No setup required, no data lost, just continuous tracking.

Every mutation goes through a persisted sync outbox: changes are queued in localStorage first, then flushed to the backend in order with retry and backoff. A crash or reload mid-sync loses nothing — the queue survives and drains on the next launch.

## Flexible Week Rollover

Your week, your rules. Configure when your tracking week starts—whether it's Sunday midnight, Monday morning, or any time that fits your schedule. The system automatically handles sessions that cross week boundaries, ensuring your weekly statistics are always accurate and meaningful.

## Smart Progress Tracking
Stay accountable without the nag. Every 15 minutes, a gentle prompt asks: did you make progress? Hit green to confirm, red if you're stuck. After three reds, the system suggests a walk—because stepping away is often the breakthrough you need. Auto-pauses during breaks, sleep, and chores, so it only tracks when it matters.

## Intelligent Sleep Tracking
Wake up knowing you're on track. Toggle sleep tracking with one tap—the system logs start and end times, calculates daily and weekly totals, and shows exactly how you measure against your 49-hour weekly target. No manual calculations, just clear insights into your rest patterns.

## Work Session Categorization
Know where your time goes. Log work sessions by category—planning, research, development—and add task descriptions for context. See your week broken down by activity type, identify patterns, and optimize your focus areas. Built for the ambitious who want to work smarter, not just longer.

## Integrated Move Tracking
Stuck? Take a walk. The Move timer pauses your progress check automatically, so breaks don't count against your productivity streak. When the system suggests a walk after three red progress checks, one click starts tracking—keeping you accountable to both deep work and healthy movement.

## Complete Time Allocation
Every minute accounted for. Sleep, meals, chores, movement, work—track it all against configurable weekly targets. See exactly where you stand with real-time progress bars and weekly overviews. Because maximizing your 168 hours starts with knowing how you spend them.
## Configuration

Open Settings (top-left) to customize:
- Weekly hour allocations for each activity
- Week rollover day and hour
- Progress check interval and focus mode duration
- Notification preferences (browser, sound)
- Backend mode (local or remote)

## Data & Backup

- **Local mode**: All data stored in browser localStorage
- **Remote mode**: Sync with the backend server (SQLite)
- **Sync outbox**: Mutations queue in localStorage and flush FIFO with retry
- **Manual backup**: Export/import JSON with validation

## Tech Stack

- **Frontend**: Vue 3 + Vite + TypeScript + TailwindCSS + Pinia + Vue Router
- **Backend**: Hono + Node.js
- **Database**: SQLite (better-sqlite3)
- **State**: Pinia with persistence plugin
- **Tests**: Vitest + @vue/test-utils (jsdom) / node env for the server

## Routes

- `/` — Track: NowBar + launcher grid of session trackers + progress check
- `/dashboard` — Weekly overview
- `/history` — Month calendar with per-type dots and a day timeline
- `/settings` — Allocations, categories, rollover, backend

## Testing

```bash
# Frontend tests (jsdom)
pnpm test

# Backend tests (node)
pnpm test:server

# Everything
pnpm test:all
```

## License

MIT License