# X Like Ratio 💙

A Chrome extension that displays the **like-to-view ratio** on X (Twitter) timeline posts. Quickly gauge engagement quality at a glance.

![Chrome Extension](https://img.shields.io/badge/Manifest-V3-blue) ![Platform](https://img.shields.io/badge/Platform-X%20%2F%20Twitter-black)

## What it does

For every tweet on your timeline, the extension calculates `likes ÷ views` and displays a color-coded percentage badge directly in the tweet's action bar (between the view count and bookmark button).

### Engagement Tiers

| Ratio | Color | Tier |
|-------|-------|------|
| < 1% | Gray | 🥶 Cold |
| 1–3% | Blue | 🧊 Cool |
| 3–6% | Green | 🌤️ Warm |
| 6–10% | Pink | 🔥 Hot |
| 10%+ | Orange | 🌋 Fire |

### Hover for Details

Hovering over the badge reveals a tooltip with the exact like and view counts.

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the `x-like-ratio` folder
5. Navigate to [x.com](https://x.com) — ratio badges appear automatically on timeline tweets

## Where it Works

The extension activates on **timeline views only**:

- ✅ Home timeline (`/home`)
- ✅ User profiles (`/@username`)
- ✅ User profile tabs (replies, likes, media)
- ✅ List timelines
- ✅ Search results
- ❌ Individual tweet pages (intentionally excluded)
- ❌ DMs, notifications, settings

## How it Parses Tweet Data

The extension reads the `aria-label` attribute from each tweet's action bar group element, which X renders in the format:

```
"6 reposts, 40 likes, 19 bookmarks, 1588 views"
```

This provides **exact counts** (not the abbreviated "1.5K" display values), ensuring accurate ratio calculation. No API calls, no authentication, no network requests — it's entirely DOM-based.

## Debugging

Open the browser console (`F12` → Console tab) and filter for `[X-Like-Ratio]`. The extension logs:

- **INFO**: Page navigation, tweet processing counts, activation/deactivation
- **WARN**: Reset events, observer issues
- **ERROR**: Individual tweet processing failures

The extension automatically resets its state after 20 consecutive errors, removing all badges and reprocessing from scratch.

## Architecture

```
x-like-ratio/
├── manifest.json    # Chrome Manifest V3 config
├── content.js       # Core logic — DOM parsing, badge injection, navigation handling
├── styles.css       # Badge styling with tier colors and tooltip
├── icons/           # Extension icons (16, 48, 128px)
└── README.md
```

**Key design decisions:**
- **MutationObserver** watches for new tweets as you scroll (infinite scroll support)
- **SPA navigation detection** via URL polling (X uses pushState, no page reloads)
- **Automatic deactivation** when navigating away from timelines
- **State reset** on excessive errors (graceful degradation)
- **No permissions required** beyond host access to x.com

## License

MIT
