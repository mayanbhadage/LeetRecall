/**
 * LeetRecall — Submission Detector (Content Script)
 * 
 * Detects accepted submissions on LeetCode problem pages using:
 * 1. DOM MutationObserver (primary)
 * 2. Fetch/XHR interception (fallback)
 * 
 * Handles SPA navigation (LeetCode is a React SPA).
 * Shows celebration animation on first accepted submission.
 */

(function () {
  'use strict';

  let lastDetectedSlug = null;
  let isLocked = false;         // Hard lock to prevent any re-entry
  const DEBOUNCE_MS = 10000;    // Block duplicate detections for 10 seconds
  let currentSlug = null;       // Track current problem for SPA navigation

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
        // Reset lock when navigating to a new problem
        isLocked = false;
        lastDetectedSlug = null;
        console.log(`[LeetRecall] Navigated to: ${newSlug}`);
      }
    }
  });

  urlObserver.observe(document.body, { childList: true, subtree: true });
  currentSlug = getCurrentSlug();

  // ─── Primary: DOM Observer ─────────────────────────────────────

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Check added nodes
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            checkForAccepted(node);
          }
        }
      }

      // Check attribute/text changes on existing nodes
      if (mutation.target && mutation.target.nodeType === Node.ELEMENT_NODE) {
        checkForAccepted(mutation.target);
      }
    }
  });

  function checkForAccepted(node) {
    const text = node.textContent || '';

    // Look for the "Accepted" result — LeetCode shows this in green
    const isAccepted =
      // Text content check
      (text.includes('Accepted') && !text.includes('Not Accepted')) ||
      // Check for success-colored elements
      node.querySelector?.('[class*="text-green"], [class*="success"], [data-e2e-locator="submission-result"]');

    if (!isAccepted) return;

    // Verify it's a submission result, not just the word "Accepted" elsewhere
    const resultIndicators = [
      '[data-e2e-locator="submission-result"]',
      '[class*="submit"]',
      '[class*="result"]',
      '[class*="status"]',
    ];

    let isSubmissionResult = false;

    // Check if this node or its parent matches result indicators
    for (const selector of resultIndicators) {
      if (
        node.matches?.(selector) ||
        node.querySelector?.(selector) ||
        node.closest?.(selector)
      ) {
        isSubmissionResult = true;
        break;
      }
    }

    // Also check if the "Accepted" text appears with runtime/memory stats
    // which is a strong indicator of a submission result
    if (!isSubmissionResult && (text.includes('Runtime') || text.includes('Memory'))) {
      isSubmissionResult = true;
    }

    // Check for green-colored "Accepted" text specifically
    if (!isSubmissionResult) {
      const greenElements = node.querySelectorAll?.('[class*="green"], [class*="success"]') || [];
      for (const el of greenElements) {
        if (el.textContent.includes('Accepted')) {
          isSubmissionResult = true;
          break;
        }
      }
    }

    if (isSubmissionResult) {
      onAccepted();
    }
  }

  function onAccepted() {
    // Guard: bail if extension was reloaded and this script is stale
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }

    const slug = Extractor.getSlug();
    if (!slug) return;

    // Hard lock — block ALL duplicate detections
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
    console.log('[LeetRecall] Detected accepted submission:', problemInfo.title);

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

  // ─── Fallback: Fetch Interception ──────────────────────────────

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      // Monitor submission check endpoints
      if (url.includes('/submissions/') || url.includes('/check/')) {
        const clone = response.clone();
        clone.json().then((data) => {
          if (data?.status_msg === 'Accepted' || data?.state === 'SUCCESS') {
            if (data.status_msg === 'Accepted') {
              onAccepted();
            }
          }
        }).catch(() => { /* ignore parsing errors for non-JSON responses */ });
      }
    } catch (e) {
      // Silently fail — don't break LeetCode
    }

    return response;
  };

  // ─── Celebration Animation ─────────────────────────────────────

  function showCelebration(title, isNew) {
    // Remove any existing toast/celebration to prevent stacking
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

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('leetrecall-toast-show');
    });

    // Remove after 4 seconds
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

    // Clean up after animation
    setTimeout(() => overlay.remove(), 3500);
  }

  // ─── Start Observing ──────────────────────────────────────────

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log('[LeetRecall] Content script loaded — watching for submissions');
})();
