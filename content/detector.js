/**
 * LeetRecall — Submission Detector (Content Script)
 * 
 * Detects accepted submissions on LeetCode problem pages using:
 * 1. Fetch interception (PRIMARY — most reliable, fires exactly once)
 * 2. DOM MutationObserver (BACKUP — only active after a submit click)
 * 
 * Handles SPA navigation (LeetCode is a React SPA).
 * Shows celebration animation on accepted submission.
 */

(function () {
  'use strict';

  let lastDetectedSlug = null;
  let isLocked = false;
  const DEBOUNCE_MS = 15000;      // Block duplicate detections for 15 seconds
  let currentSlug = null;
  let submissionInFlight = false;  // Only DOM-observe after user actually submits
  const PAGE_LOAD_GRACE_MS = 5000; // Ignore DOM mutations during initial page load
  let pageReady = false;

  // Don't react to DOM until page has settled
  setTimeout(() => { pageReady = true; }, PAGE_LOAD_GRACE_MS);

  // ─── SPA Navigation Detection ─────────────────────────────────

  function getCurrentSlug() {
    const parts = window.location.pathname.split('/');
    const idx = parts.indexOf('problems');
    return idx !== -1 ? parts[idx + 1] : '';
  }

  // Monitor URL changes for SPA navigation
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const newSlug = getCurrentSlug();
      if (newSlug && newSlug !== currentSlug) {
        currentSlug = newSlug;
        // Reset state when navigating to a new problem
        isLocked = false;
        lastDetectedSlug = null;
        submissionInFlight = false;
        pageReady = false;
        setTimeout(() => { pageReady = true; }, PAGE_LOAD_GRACE_MS);
        console.log(`[LeetRecall] Navigated to: ${newSlug}`);
      }
    }
  });

  urlObserver.observe(document.body, { childList: true, subtree: true });
  currentSlug = getCurrentSlug();

  // ─── Fetch Interception (PRIMARY detection) ────────────────────
  // This is the most reliable method — it fires when LeetCode's
  // submission API actually returns status_msg: "Accepted".

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      // Detect when user submits (submission is in flight)
      if (url.includes('/submit')) {
        submissionInFlight = true;
        console.log('[LeetRecall] Submission detected via API');
        // Auto-clear after 30s in case we miss the result
        setTimeout(() => { submissionInFlight = false; }, 30000);
      }

      // Monitor submission check endpoints
      if (url.includes('/check/')) {
        const clone = response.clone();
        clone.json().then((data) => {
          if (data?.status_msg === 'Accepted') {
            submissionInFlight = false;
            onAccepted();
          }
        }).catch(() => { /* ignore non-JSON */ });
      }
    } catch (e) {
      // Silently fail — don't break LeetCode
    }

    return response;
  };

  // ─── DOM Observer (BACKUP — only when submission is in flight) ─

  const observer = new MutationObserver((mutations) => {
    // Only check DOM if page is loaded AND a submission is in flight
    if (!pageReady || !submissionInFlight) return;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            checkForAccepted(node);
          }
        }
      }
    }
  });

  function checkForAccepted(node) {
    const text = node.textContent || '';

    // Must contain "Accepted" but not "Not Accepted"
    if (!text.includes('Accepted') || text.includes('Not Accepted')) return;

    // Must also contain runtime/memory stats (strong signal of a fresh result)
    const hasBenchmarks = text.includes('Runtime') || text.includes('Memory');
    
    // Or contain the specific submission result element
    const hasResultEl = node.querySelector?.('[data-e2e-locator="submission-result"]');

    if (hasBenchmarks || hasResultEl) {
      submissionInFlight = false;
      onAccepted();
    }
  }

  // ─── Core Handler ─────────────────────────────────────────────

  function onAccepted() {
    // Guard: bail if extension was reloaded and this script is stale
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }

    const slug = Extractor.getSlug();
    if (!slug) return;

    // Hard lock — one celebration per problem per 15 seconds
    if (isLocked && slug === lastDetectedSlug) {
      return;
    }

    isLocked = true;
    lastDetectedSlug = slug;
    setTimeout(() => {
      isLocked = false;
      lastDetectedSlug = null;
    }, DEBOUNCE_MS);

    // Extract problem info and send to service worker
    const problemInfo = Extractor.extractAll();
    console.log('[LeetRecall] ✅ Accepted submission:', problemInfo.title);

    chrome.runtime.sendMessage(
      { type: 'PROBLEM_ACCEPTED', data: problemInfo },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[LeetRecall] Error sending message:', chrome.runtime.lastError);
          return;
        }
        if (response?.success) {
          showCelebration(problemInfo.title, response.isNew);
        }
      }
    );
  }

  // ─── Celebration Animation ─────────────────────────────────────

  function showCelebration(title, isNew) {
    // Remove any existing toast/celebration
    const existing = document.querySelector('.leetrecall-toast');
    if (existing) existing.remove();
    const existingOverlay = document.querySelector('.leetrecall-confetti-overlay');
    if (existingOverlay) existingOverlay.remove();

    // Create confetti burst
    createConfetti();

    // Create toast notification
    const toast = document.createElement('div');
    toast.className = 'leetrecall-toast';
    toast.innerHTML = `
      <div class="leetrecall-toast-icon">🧠</div>
      <div class="leetrecall-toast-content">
        <div class="leetrecall-toast-title">LeetRecall${isNew ? ' ✨' : ''}</div>
        <div class="leetrecall-toast-message">${isNew ? 'Tracked' : 'Updated'}: ${title}</div>
      </div>
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('leetrecall-toast-show');
    });

    setTimeout(() => {
      toast.classList.add('leetrecall-toast-hide');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  function createConfetti() {
    const overlay = document.createElement('div');
    overlay.className = 'leetrecall-confetti-overlay';
    document.body.appendChild(overlay);

    const colors = ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#a855f7', '#fbbf24'];
    const shapes = ['●', '■', '▲', '★'];

    for (let i = 0; i < 40; i++) {
      const particle = document.createElement('div');
      particle.className = 'leetrecall-confetti-particle';
      particle.textContent = shapes[Math.floor(Math.random() * shapes.length)];
      particle.style.cssText = `
        left: ${Math.random() * 100}%;
        color: ${colors[Math.floor(Math.random() * colors.length)]};
        animation-delay: ${Math.random() * 0.5}s;
        animation-duration: ${1.5 + Math.random() * 1.5}s;
        font-size: ${8 + Math.random() * 14}px;
      `;
      overlay.appendChild(particle);
    }

    setTimeout(() => overlay.remove(), 3500);
  }

  // ─── Start Observing ──────────────────────────────────────────

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('[LeetRecall] Content script loaded — watching for submissions');
})();
