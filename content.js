// ═══════════════════════════════════════════════════════════════════════
//  X Like Ratio — Content Script
//  Displays like-to-view ratio on X timeline posts
// ═══════════════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ── Logging ──────────────────────────────────────────────────────────
  const PREFIX = "[X-Like-Ratio]";
  const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
  const CURRENT_LOG_LEVEL = LOG_LEVELS.INFO;

  function log(level, ...args) {
    if (level >= CURRENT_LOG_LEVEL) {
      const tag =
        level === LOG_LEVELS.DEBUG
          ? "DEBUG"
          : level === LOG_LEVELS.INFO
          ? "INFO"
          : level === LOG_LEVELS.WARN
          ? "WARN"
          : "ERROR";
      console[level >= LOG_LEVELS.WARN ? "warn" : "log"](
        `${PREFIX} [${tag}]`,
        ...args
      );
    }
  }

  // ── State ────────────────────────────────────────────────────────────
  let observer = null;
  let currentUrl = location.href;
  let processedCount = 0;
  let errorCount = 0;
  const MARKER = "data-xlr-processed";
  const MAX_ERRORS_BEFORE_RESET = 20;

  // ── Page detection ──────────────────────────────────────────────────
  // We operate on timelines AND individual tweet/status pages
  function isSupportedPage() {
    const path = location.pathname;
    const supportedPatterns = [
      /^\/home$/,                  // Home timeline
      /^\/i\/lists\//,             // List timelines
      /^\/search/,                 // Search results
      /^\/[^/]+$/,                 // User profile root (e.g., /BenjDicken)
      /^\/[^/]+\/with_replies$/,   // User profile replies tab
      /^\/[^/]+\/likes$/,          // User profile likes tab
      /^\/[^/]+\/media$/,          // User profile media tab
      /^\/[^/]+\/status\/.+/,      // Individual tweet / status pages
    ];
    // Exclude known non-tweet paths
    const excludePatterns = [
      /^\/settings/,
      /^\/messages/,
      /^\/notifications/,
      /^\/i\/bookmarks/,
      /^\/compose/,
    ];

    for (const ex of excludePatterns) {
      if (ex.test(path)) return false;
    }
    for (const pat of supportedPatterns) {
      if (pat.test(path)) return true;
    }
    return false;
  }

  // ── Parsing ─────────────────────────────────────────────────────────
  // The action bar group element has an aria-label like:
  //   "6 reposts, 40 likes, 19 bookmarks, 1588 views"
  // Fields with 0 count may be omitted. Parse them all.
  function parseAriaLabel(ariaLabel) {
    const metrics = {
      replies: 0,
      reposts: 0,
      likes: 0,
      bookmarks: 0,
      views: 0,
    };

    if (!ariaLabel) return null;

    const parts = ariaLabel.split(",").map((s) => s.trim());
    for (const part of parts) {
      const match = part.match(/^(\d+)\s+(.+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const label = match[2].toLowerCase();
        if (label.includes("repl")) metrics.replies = num;
        else if (label.includes("repost") || label.includes("retweet"))
          metrics.reposts = num;
        else if (label.includes("like")) metrics.likes = num;
        else if (label.includes("bookmark")) metrics.bookmarks = num;
        else if (label.includes("view")) metrics.views = num;
      }
    }

    return metrics;
  }

  // ── Ratio tier classification ───────────────────────────────────────
  function getTier(ratio) {
    // ratio is likes/views as a fraction
    if (ratio < 0.01) return "cold"; //  < 1%
    if (ratio < 0.03) return "cool"; //  1–3%
    if (ratio < 0.06) return "warm"; //  3–6%
    if (ratio < 0.10) return "hot";  //  6–10%
    return "fire";                   //  10%+
  }

  // ── Format helpers ──────────────────────────────────────────────────
  function formatRatio(ratio) {
    const pct = ratio * 100;
    if (pct < 0.1) return "<0.1%";
    if (pct < 1) return pct.toFixed(1) + "%";
    if (pct < 10) return pct.toFixed(1) + "%";
    return pct.toFixed(0) + "%";
  }

  function formatNumber(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toString();
  }

  // ── Badge creation ──────────────────────────────────────────────────
  function createBadge(metrics) {
    if (metrics.views === 0) return null;

    const ratio = metrics.likes / metrics.views;
    const tier = getTier(ratio);
    const ratioText = formatRatio(ratio);

    const container = document.createElement("div");
    container.className = "xlr-ratio-container";

    const badge = document.createElement("span");
    badge.className = `xlr-ratio-badge xlr-tier-${tier}`;
    badge.setAttribute(
      "data-xlr-tooltip",
      `${formatNumber(metrics.likes)} likes / ${formatNumber(metrics.views)} views`
    );

    // Heart SVG icon
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("class", "xlr-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<path fill="currentColor" d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/>`;

    const text = document.createElement("span");
    text.textContent = ratioText;

    badge.appendChild(icon);
    badge.appendChild(text);
    container.appendChild(badge);

    return container;
  }

  // ── Core processing ─────────────────────────────────────────────────
  function processTweet(article) {
    try {
      // Find the action bar group
      const group = article.querySelector('[role="group"][aria-label]');
      if (!group) {
        log(LOG_LEVELS.DEBUG, "No action group found in article");
        return;
      }

      // Already processed?
      if (group.hasAttribute(MARKER)) return;

      const ariaLabel = group.getAttribute("aria-label");
      const metrics = parseAriaLabel(ariaLabel);

      if (!metrics) {
        log(LOG_LEVELS.DEBUG, "Could not parse aria-label:", ariaLabel);
        return;
      }

      if (metrics.views === 0) {
        log(LOG_LEVELS.DEBUG, "No views on tweet, skipping");
        group.setAttribute(MARKER, "no-views");
        return;
      }

      const badge = createBadge(metrics);
      if (!badge) {
        group.setAttribute(MARKER, "no-badge");
        return;
      }

      // Universal insertion: find the like button, walk up to the group's
      // direct child wrapper, and insert the badge right after it.
      // This works for both timeline and status page layouts:
      //   Timeline: reply | retweet | like | [BADGE] | views | bookmark | share
      //   Status:   reply | retweet | like | [BADGE] | bookmark | share
      const likeBtn = group.querySelector(
        '[data-testid="like"], [data-testid="unlike"]'
      );

      if (likeBtn) {
        // Walk up from the like button to find the direct child of group
        let likeWrapper = likeBtn;
        while (
          likeWrapper.parentElement &&
          likeWrapper.parentElement !== group
        ) {
          likeWrapper = likeWrapper.parentElement;
        }

        if (likeWrapper.parentElement === group) {
          group.insertBefore(badge, likeWrapper.nextSibling);
          log(
            LOG_LEVELS.DEBUG,
            "Inserted badge after like button wrapper"
          );
        } else {
          // Fallback: append to group
          group.appendChild(badge);
          log(LOG_LEVELS.DEBUG, "Fallback: appended badge to group");
        }
      } else {
        group.appendChild(badge);
        log(LOG_LEVELS.DEBUG, "No like button found, appended badge to group");
      }

      group.setAttribute(MARKER, "done");
      processedCount++;
      log(
        LOG_LEVELS.DEBUG,
        `Processed tweet #${processedCount}: ${metrics.likes}/${metrics.views} = ${formatRatio(metrics.likes / metrics.views)}`
      );
    } catch (err) {
      errorCount++;
      log(LOG_LEVELS.ERROR, "Error processing tweet:", err);
      if (errorCount >= MAX_ERRORS_BEFORE_RESET) {
        log(LOG_LEVELS.WARN, "Too many errors, resetting extension state");
        resetState();
      }
    }
  }

  function processAllTweets() {
    if (!isSupportedPage()) {
      log(LOG_LEVELS.DEBUG, "Not a supported page, skipping");
      return;
    }

    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    let newCount = 0;
    articles.forEach((article) => {
      const group = article.querySelector('[role="group"][aria-label]');
      if (group && !group.hasAttribute(MARKER)) {
        processTweet(article);
        newCount++;
      }
    });
    if (newCount > 0) {
      log(LOG_LEVELS.INFO, `Processed ${newCount} new tweets (total: ${processedCount})`);
    }
  }

  // ── Update existing badges when counts change ───────────────────────
  function updateExistingBadges() {
    if (!isSupportedPage()) return;

    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    articles.forEach((article) => {
      const group = article.querySelector('[role="group"][aria-label]');
      if (!group || group.getAttribute(MARKER) !== "done") return;

      const ariaLabel = group.getAttribute("aria-label");
      const metrics = parseAriaLabel(ariaLabel);
      if (!metrics || metrics.views === 0) return;

      const existingBadge = article.querySelector(".xlr-ratio-container");
      if (!existingBadge) return;

      const ratio = metrics.likes / metrics.views;
      const tier = getTier(ratio);
      const ratioText = formatRatio(ratio);

      const badge = existingBadge.querySelector(".xlr-ratio-badge");
      if (badge) {
        badge.className = `xlr-ratio-badge xlr-tier-${tier}`;
        badge.setAttribute(
          "data-xlr-tooltip",
          `${formatNumber(metrics.likes)} likes / ${formatNumber(metrics.views)} views`
        );
        const textSpan = badge.querySelector("span:not(.xlr-icon)");
        if (textSpan) textSpan.textContent = ratioText;
      }
    });
  }

  // ── MutationObserver ────────────────────────────────────────────────
  function startObserver() {
    if (observer) {
      log(LOG_LEVELS.DEBUG, "Observer already running");
      return;
    }

    const target = document.body;
    if (!target) {
      log(LOG_LEVELS.WARN, "document.body not available, retrying in 500ms");
      setTimeout(startObserver, 500);
      return;
    }

    observer = new MutationObserver((mutations) => {
      // Debounce: batch processing
      let hasNewContent = false;
      let hasAttributeChange = false;

      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          hasNewContent = true;
        }
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "aria-label"
        ) {
          hasAttributeChange = true;
        }
      }

      if (hasNewContent) {
        requestAnimationFrame(processAllTweets);
      }
      if (hasAttributeChange) {
        requestAnimationFrame(updateExistingBadges);
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });

    log(LOG_LEVELS.INFO, "MutationObserver started");
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
      log(LOG_LEVELS.INFO, "MutationObserver stopped");
    }
  }

  // ── Navigation detection ────────────────────────────────────────────
  // X is a SPA — URL changes without full page reload
  function watchNavigation() {
    // Poll for URL changes (pushState/replaceState don't fire events reliably)
    setInterval(() => {
      if (location.href !== currentUrl) {
        const oldUrl = currentUrl;
        currentUrl = location.href;
        log(LOG_LEVELS.INFO, `Navigation: ${oldUrl} → ${currentUrl}`);
        handleNavigation();
      }
    }, 500);

    // Also listen for popstate (back/forward buttons)
    window.addEventListener("popstate", () => {
      setTimeout(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          log(LOG_LEVELS.INFO, `Popstate navigation → ${currentUrl}`);
          handleNavigation();
        }
      }, 100);
    });
  }

  function handleNavigation() {
    if (isSupportedPage()) {
      log(LOG_LEVELS.INFO, "On supported page, activating");
      startObserver();
      // Process tweets that are already on page
      setTimeout(processAllTweets, 300);
      setTimeout(processAllTweets, 1000);
    } else {
      log(LOG_LEVELS.INFO, "Not a supported page, deactivating observer");
      stopObserver();
    }
  }

  // ── Reset / reload state ────────────────────────────────────────────
  function resetState() {
    log(LOG_LEVELS.WARN, "Resetting extension state");
    stopObserver();

    // Remove all badges
    document.querySelectorAll(".xlr-ratio-container").forEach((el) => el.remove());

    // Remove processed markers
    document.querySelectorAll(`[${MARKER}]`).forEach((el) => {
      el.removeAttribute(MARKER);
    });

    processedCount = 0;
    errorCount = 0;

    // Restart
    setTimeout(() => {
      handleNavigation();
    }, 500);
  }

  // ── Visibility change handling ──────────────────────────────────────
  // If the user switches tabs and comes back, reprocess
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      log(LOG_LEVELS.DEBUG, "Tab became visible, reprocessing");
      setTimeout(processAllTweets, 300);
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────
  function init() {
    log(LOG_LEVELS.INFO, "X Like Ratio extension loaded");
    log(LOG_LEVELS.INFO, `Current page: ${location.href}`);
    log(LOG_LEVELS.INFO, `Is supported page: ${isSupportedPage()}`);

    watchNavigation();
    handleNavigation();
  }

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
