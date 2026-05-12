/**
 * LeetRecall — Submission Detector (Content Script)
 * 
 * Detects accepted submissions on LeetCode problem pages using:
 * 1. DOM MutationObserver (primary)
 * 2. Fetch/XHR interception (fallback)
 * 
 * Sends detected acceptances to the service worker.
 */

(function () {
  'use strict';

  let lastDetectedSlug = null;
  let debounceTimer = null;
  const DEBOUNCE_MS = 3000; // Prevent duplicate detections within 3 seconds

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
    const html = node.innerHTML || '';

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
    const slug = Extractor.getSlug();
    if (!slug) return;

    // Debounce — prevent duplicate detections
    if (slug === lastDetectedSlug && debounceTimer) {
      return;
    }

    lastDetectedSlug = slug;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
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
          showNotification(problemInfo.title);
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

  // ─── In-Page Notification ──────────────────────────────────────

  function showNotification(title) {
    // Create a small toast notification on the page
    const toast = document.createElement('div');
    toast.className = 'leetrecall-toast';
    toast.innerHTML = `
      <div class="leetrecall-toast-icon">🧠</div>
      <div class="leetrecall-toast-content">
        <div class="leetrecall-toast-title">LeetRecall</div>
        <div class="leetrecall-toast-message">Tracked: ${title}</div>
      </div>
    `;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('leetrecall-toast-show');
    });

    // Remove after 3 seconds
    setTimeout(() => {
      toast.classList.add('leetrecall-toast-hide');
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  }

  // ─── Start Observing ──────────────────────────────────────────

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log('[LeetRecall] Content script loaded — watching for submissions');
})();
