# LeetRecall

> 🧠 Spaced repetition for LeetCode. Auto-track accepted submissions and master problems with Anki-style reviews.

## Features

- **Auto-Tracking** — Detects accepted submissions on LeetCode automatically
- **Spaced Repetition** — SM-2 algorithm (same foundation as Anki) schedules when to re-solve each problem  
- **Confidence Rating** — 4-button Anki-style rating: Again · Hard · Good · Easy
- **Dashboard** — Visual progress, streak tracking, difficulty breakdown
- **Daily Queue** — See what's due for review today
- **Export/Import** — Back up and restore your data

## Installation (Developer Mode)

1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select this project folder
5. Navigate to any LeetCode problem and start solving!

## How It Works

1. You solve a problem on LeetCode → the extension auto-detects "Accepted"
2. The problem is saved with metadata (title, difficulty, tags)
3. Rate your confidence (Again / Hard / Good / Easy)
4. SM-2 algorithm schedules when you should re-solve it
5. Extension badge shows how many problems are due today
6. Dashboard gives you full visibility — progress, streaks, all problems

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks, no build step)
- SM-2 Spaced Repetition Algorithm
- `chrome.storage.local` for offline-first data persistence

## License

MIT
