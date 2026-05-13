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

  // ─── Active Time Tracking ─────────────────────────────────────
  
  let activeTimeMs = 0;
  let lastActiveTimestamp = Date.now();
  let isTrackingActive = true;

  function loadTimeTracker(slug) {
    chrome.storage.local.get(['leetrecall_time'], (result) => {
      const times = result.leetrecall_time || {};
      activeTimeMs = times[slug] || 0;
      lastActiveTimestamp = Date.now();
    });
  }

  function saveTimeTracker(slug) {
    if (!slug) return;
    chrome.storage.local.get(['leetrecall_time'], (result) => {
      const times = result.leetrecall_time || {};
      times[slug] = activeTimeMs;
      chrome.storage.local.set({ leetrecall_time: times });
    });
  }

  function clearTimeTracker(slug) {
    chrome.storage.local.get(['leetrecall_time'], (result) => {
      const times = result.leetrecall_time || {};
      delete times[slug];
      chrome.storage.local.set({ leetrecall_time: times });
    });
  }

  function updateActiveTime() {
    if (isTrackingActive) {
      activeTimeMs += (Date.now() - lastActiveTimestamp);
    }
    lastActiveTimestamp = Date.now();
  }

  function pauseTracking() {
    if (!isTrackingActive) return;
    updateActiveTime();
    isTrackingActive = false;
    saveTimeTracker(currentSlug);
  }

  function resumeTracking() {
    if (isTrackingActive) return;
    lastActiveTimestamp = Date.now();
    isTrackingActive = true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseTracking();
    else resumeTracking();
  });

  window.addEventListener('blur', pauseTracking);
  window.addEventListener('focus', resumeTracking);

  setInterval(() => {
    if (isTrackingActive) {
      updateActiveTime();
      saveTimeTracker(currentSlug);
    }
  }, 10000);

  // ─── SPA Navigation Detection ─────────────────────────────────

  function getCurrentSlug() {
    const parts = window.location.pathname.split('/');
    const idx = parts.indexOf('problems');
    return idx !== -1 ? parts[idx + 1] : '';
  }

  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const newSlug = getCurrentSlug();
      if (newSlug && newSlug !== currentSlug) {
        pauseTracking(); // save old
        currentSlug = newSlug;
        
        // Reset state
        isLocked = false;
        lastDetectedSlug = null;
        submissionInFlight = false;
        pageReady = false;
        setTimeout(() => { pageReady = true; }, PAGE_LOAD_GRACE_MS);
        
        // Load time tracker for new slug
        activeTimeMs = 0;
        loadTimeTracker(newSlug);
        resumeTracking();
        
        console.log(`[LeetRecall] Navigated to: ${newSlug}`);
      }
    }
  });

  urlObserver.observe(document.body, { childList: true, subtree: true });
  currentSlug = getCurrentSlug();
  if (currentSlug) {
    loadTimeTracker(currentSlug);
  }

  // ─── Fetch Interception (PRIMARY detection) ────────────────────
  // This is the most reliable method — it fires when LeetCode's
  // submission API actually returns status_msg or statusDisplay.

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    // 1. Intercept the outbound request to detect submission start
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const options = args[1] || {};
      
      if (url.includes('/submit')) {
        submissionInFlight = true;
        setTimeout(() => { submissionInFlight = false; }, 30000);
      } else if (url.includes('/graphql') && typeof options.body === 'string') {
        // Detect GraphQL submit mutation
        if (options.body.includes('"submitCode"') || options.body.includes('"questionSubmit"')) {
          submissionInFlight = true;
          console.log('[LeetRecall] Network submit detected (GraphQL)');
          setTimeout(() => { submissionInFlight = false; }, 30000);
        }
      }
    } catch (e) {
      // Ignore outbound inspection errors
    }

    const response = await originalFetch.apply(this, args);

    // 2. Intercept the inbound response to get the result
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      if (url.includes('/check/') || url.includes('/graphql') || url.includes('/submit')) {
        const clone = response.clone();
        clone.json().then((data) => {
          // REST API format
          if (data?.status_msg && data?.state !== 'PENDING' && data?.state !== 'STARTED') {
            if (submissionInFlight) {
              submissionInFlight = false;
              processStatus(data.status_msg);
            }
            return;
          }

          // GraphQL format
          if (submissionInFlight) {
            const jsonStr = JSON.stringify(data);
            const match = jsonStr.match(/"(?:statusDisplay|status_msg)"\s*:\s*"([^"]+)"/);
            if (match && match[1]) {
              const status = match[1];
              if (status !== 'Pending' && status !== 'Judging') {
                submissionInFlight = false;
                processStatus(status);
              }
            }
          }
        }).catch(() => { /* ignore non-JSON */ });
      }
    } catch (e) {
      // Silently fail — don't break LeetCode
    }

    return response;
  };

  // ─── Click & Keyboard Detection (Fallback for setting submissionInFlight) ─
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-e2e-locator="console-submit-button"]') || e.target.closest('button') || e.target.closest('[role="button"]');
    if (btn) {
      const text = btn.textContent.toLowerCase();
      const locator = btn.getAttribute('data-e2e-locator') || '';
      if (text.includes('submit') || locator.includes('submit')) {
        submissionInFlight = true;
        setTimeout(() => { submissionInFlight = false; }, 30000);
      }
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      submissionInFlight = true;
      setTimeout(() => { submissionInFlight = false; }, 30000);
    }
  }, true);

  // ─── DOM Observer (BACKUP — only when submission is in flight) ─

  const observer = new MutationObserver((mutations) => {
    // Only check DOM if page is loaded AND a submission is in flight
    if (!pageReady || !submissionInFlight) return;

    // Fast global check on any mutation if submission is in flight
    const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
    if (resultEl) {
      const txt = resultEl.textContent.trim();
      if (txt && !txt.includes('Pending') && !txt.includes('Judging')) {
        submissionInFlight = false;
        processStatus(txt);
        return;
      }
    }
  });

  function processStatus(rawText) {
    let status = rawText;
    if (status.startsWith('Accepted')) status = 'Accepted';
    else if (status.startsWith('Wrong Answer')) status = 'Wrong Answer';
    else if (status.startsWith('Time Limit Exceeded')) status = 'Time Limit Exceeded';
    else if (status.startsWith('Memory Limit Exceeded')) status = 'Memory Limit Exceeded';
    else if (status.startsWith('Runtime Error')) status = 'Runtime Error';
    else if (status.startsWith('Compile Error')) status = 'Compile Error';
    
    onSubmissionResult(status);
  }

  function checkForSubmissionResult(node) {
    // First try the explicit data attribute — check the node itself AND its descendants
    let resultEl = null;
    if (node.matches && node.matches('[data-e2e-locator="submission-result"]')) {
      resultEl = node;
    } else if (node.querySelector) {
      resultEl = node.querySelector('[data-e2e-locator="submission-result"]');
    }

    if (resultEl) {
      submissionInFlight = false;
      processStatus(resultEl.textContent.trim() || 'Completed');
      return;
    }

    // Fallback based on text content since structure changes often
    const text = node.textContent || '';
    
    // Check for Accepted + Runtime/Memory benchmarks globally
    if (text.includes('Accepted') && !text.includes('Not Accepted')) {
      if (document.body.innerText.includes('Runtime') || document.body.innerText.includes('Memory')) {
        submissionInFlight = false;
        processStatus('Accepted');
        return;
      }
    }

    // Check for common failure strings prominently displayed
    const failures = ['Wrong Answer', 'Time Limit Exceeded', 'Memory Limit Exceeded', 'Runtime Error', 'Compile Error', 'Output Limit Exceeded'];
    for (const failure of failures) {
      if (text === failure || text.startsWith(failure + '\n') || text.startsWith(failure + ' ')) {
        submissionInFlight = false;
        processStatus(failure);
        return;
      }
    }
  }

  // ─── Core Handler ─────────────────────────────────────────────

  function onSubmissionResult(status) {
    // Guard: bail if extension was reloaded and this script is stale
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }

    const slug = Extractor.getSlug();
    if (!slug) return;

    // Hard lock — one celebration/toast per problem per 15 seconds
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
    problemInfo.status = status;
    updateActiveTime(); // Make sure active time is totally up to date
    problemInfo.timeSpentMs = activeTimeMs;
    console.log(`[LeetRecall] Submission result: ${status} for ${problemInfo.title}. Time spent: Math.round(${activeTimeMs} / 1000)s`);

    chrome.runtime.sendMessage(
      { type: 'PROBLEM_SUBMITTED', data: problemInfo },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[LeetRecall] Error sending message:', chrome.runtime.lastError);
          return;
        }
        if (response?.success) {
          if (status === 'Accepted') {
            showCelebration(problemInfo.title, response.isNew);
            // Clear timer so a future spaced repetition review starts fresh
            clearTimeTracker(slug);
            activeTimeMs = 0;
            lastActiveTimestamp = Date.now();
          } else {
            showFailureToast(problemInfo.title, status);
          }
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

  function showFailureToast(title, status) {
    const existing = document.querySelector('.leetrecall-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'leetrecall-toast';
    // Style differently for failure
    toast.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    toast.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(239, 68, 68, 0.1)';

    toast.innerHTML = `
      <div class="leetrecall-toast-icon" style="color: #ef4444; animation: none;">📝</div>
      <div class="leetrecall-toast-content">
        <div class="leetrecall-toast-title" style="color: #ef4444;">Attempt Logged</div>
        <div class="leetrecall-toast-message">${status} · Open extension to add notes</div>
      </div>
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('leetrecall-toast-show'));

    setTimeout(() => {
      toast.classList.add('leetrecall-toast-hide');
      setTimeout(() => toast.remove(), 400);
    }, 5000);
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

  // ─── Review Notes Panel ──────────────────────────────────────────
  // Shows notes from previous attempts when visiting a due problem.
  // This is the "close the loop" feature for deliberate practice.

  async function checkForReviewNotes() {
    const slug = Extractor.getSlug();
    if (!slug) return;

    // Guard: bail if extension was reloaded
    if (!chrome.runtime?.id) return;

    // Remove any existing panel
    const existing = document.querySelector('.leetrecall-notes-panel');
    if (existing) existing.remove();

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'GET_PREVIOUS_NOTES', data: { slug } },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false });
              return;
            }
            resolve(res || { success: false });
          }
        );
      });

      if (!response.success || !response.notes || response.notes.length === 0) return;
      if (!response.isDue) return; // Only show for due problems

      showReviewNotesPanel(response);
    } catch (e) {
      console.error('[LeetRecall] Error loading review notes:', e);
    }
  }

  function showReviewNotesPanel(data) {
    const panel = document.createElement('div');
    panel.className = 'leetrecall-notes-panel';

    const attemptDate = new Date(data.previousAttempt.date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });

    panel.innerHTML = `
      <div class="leetrecall-notes-header">
        <div class="leetrecall-notes-title">
          <span class="leetrecall-notes-icon">📋</span>
          <span>Previous Notes</span>
        </div>
        <div class="leetrecall-notes-actions">
          <button class="leetrecall-notes-minimize" title="Minimize">─</button>
          <button class="leetrecall-notes-close" title="Dismiss">✕</button>
        </div>
      </div>
      <div class="leetrecall-notes-body">
        <div class="leetrecall-notes-meta">
          ${attemptDate} · Rated: ${data.previousAttempt.ratingLabel} · Attempt #${data.previousAttempt.attemptNumber}
        </div>
        <div class="leetrecall-notes-list">
          ${data.notes.map((note, i) => `
            <label class="leetrecall-note-item">
              <input type="checkbox" class="leetrecall-note-cb">
              <span class="leetrecall-note-check"></span>
              <span class="leetrecall-note-text">${escapeHtmlContent(note)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Animate in
    requestAnimationFrame(() => {
      panel.classList.add('leetrecall-notes-panel-show');
    });

    // Wire up interactions
    panel.querySelector('.leetrecall-notes-close').addEventListener('click', () => {
      panel.classList.add('leetrecall-notes-panel-hide');
      setTimeout(() => panel.remove(), 300);
    });

    panel.querySelector('.leetrecall-notes-minimize').addEventListener('click', () => {
      const body = panel.querySelector('.leetrecall-notes-body');
      const btn = panel.querySelector('.leetrecall-notes-minimize');
      const isMinimized = body.style.display === 'none';
      body.style.display = isMinimized ? 'block' : 'none';
      btn.textContent = isMinimized ? '─' : '□';
      btn.title = isMinimized ? 'Minimize' : 'Expand';
    });

    // Checkbox strikethrough
    panel.querySelectorAll('.leetrecall-note-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.closest('.leetrecall-note-item').classList.toggle('checked', cb.checked);
      });
    });

    // Make panel draggable
    makeDraggable(panel, panel.querySelector('.leetrecall-notes-header'));
  }

  function makeDraggable(element, handle) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
      // Don't drag if clicking a button
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      handle.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      element.style.left = `${startLeft + dx}px`;
      element.style.top = `${startTop + dy}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        handle.style.cursor = 'grab';
      }
    });
  }

  function escapeHtmlContent(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Check for review notes on initial load (with delay for page to settle)
  setTimeout(() => {
    checkForReviewNotes();
  }, 2000);

  // Also check when navigating to a new problem (SPA)
  const originalCheckNotes = checkForReviewNotes;
  const originalUrlObserverCallback = urlObserver._callback || (() => {});

  // Patch into URL change detection to also check notes
  let lastNoteCheckSlug = '';
  setInterval(() => {
    const s = getCurrentSlug();
    if (s && s !== lastNoteCheckSlug) {
      lastNoteCheckSlug = s;
      // Small delay to let page content load
      setTimeout(() => checkForReviewNotes(), 2000);
    }
  }, 1000);

  // ─── Start Observing ──────────────────────────────────────────

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('[LeetRecall] Content script loaded — watching for submissions');
})();

