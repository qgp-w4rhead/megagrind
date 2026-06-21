# MEGAGRIND

Work more than Bill Gates. Do it healthily.

A comprehensive time tracking system designed for maximum productivity—168 hours a week, fully accounted for.

## Quick Start

### Prerequisites
- Node.js ^20.19.0 or >=22.12.0

### Installation

```bash
# Install frontend dependencies
npm install

# Install server dependencies
npm run server:install
```

### Running the App

- For local-only mode, just run `npm run dev`—the frontend works standalone with localStorage.

```bash
# Start frontend (http://localhost:5173)
npm run dev
```

```bash
# Start server in another terminal (http://localhost:3000)
npm run server:dev
```

For local-only mode, just run `npm run dev`—the frontend works standalone with localStorage.

## Features

## Offline-First Data Persistence

Your data is always safe, even without an internet connection. MegaGrind automatically saves everything to your browser's local storage, so you can track your time whether the server is up/accessible or down.)

When you reconnect, it seamlessly syncs to your preferred backend (SQLite or MongoDB). No setup required, no data lost, just continuous tracking.

The database is optional, thanks to a abstraction layer that allows the switch between all 3 options.

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
- **Remote mode**: Sync with backend server (SQLite or MongoDB)
- **Auto-backup**: Every 5 minutes when changes are made
- **Manual backup**: Export/import JSON with validation
- **Multi-tab sync**: Automatic synchronization across browser tabs

## Tech Stack

- **Frontend**: Vue 3 + Vite + TypeScript + TailwindCSS + Pinia
- **Backend**: Hono + Node.js
- **Database**: SQLite or MongoDB (optional)
- **State**: Pinia with persistence plugin

## License

MIT License