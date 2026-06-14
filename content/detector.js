/**
 * LeetRecall — Submission Detector (Content Script)
 * 
 * Detects accepted submissions on LeetCode problem pages using:
 * 1. Fetch interception (PRIMARY — most reliable, fires exactly once)
 * 2. Bounded DOM checks (BACKUP — only after a submit click)
 * 
 * Handles SPA navigation (LeetCode is a React SPA).
 * Shows celebration animation on accepted submission.
 */

(function () {
  'use strict';

  console.log('[LeetRecall] Detector script loaded on:', window.location.pathname);

  let lastDetectedSlug = null;
  let isLocked = false;
  const DEBOUNCE_MS = 15000;      // Block duplicate detections for 15 seconds
  let currentSlug = null;
  let submissionInFlight = false;  // Only DOM-observe after user actually submits
  const PAGE_LOAD_GRACE_MS = 5000; // Ignore DOM mutations during initial page load
  let pageReady = false;
  let lastProcessedSubmissionKey = sessionStorage.getItem('leetrecall_last_submission_key') || '';
  const pendingSubmissionKeys = new Set();
  const dismissedSubmissionKeys = new Set();

  // Don't react to DOM until page has settled
  setTimeout(() => { pageReady = true; }, PAGE_LOAD_GRACE_MS);

  // ─── Orphaned Script Detection ─────────────────────────────────
  let isOrphaned = false;
  function checkOrphaned() {
    if (isOrphaned) return true;
    if (!chrome.runtime?.id) {
      isOrphaned = true;
      return true;
    }
    try {
      // Throws synchronously if context is invalidated
      chrome.runtime.getManifest();
    } catch (e) {
      isOrphaned = true;
      return true;
    }
    return false;
  }

  // ─── Active Time Tracking ─────────────────────────────────────
  
  let activeTimeMs = 0;
  let lastActiveTimestamp = Date.now();
  let isTrackingActive = true;
  let isManuallyPaused = false;
  let timerWidget = null;
  let timerText = null;

  function initTimerWidget() {
    if (document.getElementById('leetrecall-timer')) return;
    
    timerWidget = document.createElement('div');
    timerWidget.id = 'leetrecall-timer';
    timerWidget.className = 'leetrecall-timer-widget';
    
    timerWidget.innerHTML = `
      <div class="leetrecall-timer-drag-handle" title="Drag to move">⋮⋮</div>
      <div class="leetrecall-timer-icon">⏱️</div>
      <div class="leetrecall-timer-text">00:00</div>
      <div class="leetrecall-timer-controls">
        <button class="leetrecall-timer-btn leetrecall-timer-playpause" title="Pause">⏸</button>
        <button class="leetrecall-timer-btn leetrecall-timer-reset" title="Reset">↺</button>
      </div>
    `;
    
    timerText = timerWidget.querySelector('.leetrecall-timer-text');
    document.body.appendChild(timerWidget);

    const handle = timerWidget.querySelector('.leetrecall-timer-drag-handle');
    makeDraggable(timerWidget, handle);

    const playPauseBtn = timerWidget.querySelector('.leetrecall-timer-playpause');
    const resetBtn = timerWidget.querySelector('.leetrecall-timer-reset');

    if (!isTrackingActive) {
      playPauseBtn.textContent = '▶';
      playPauseBtn.title = 'Play';
    }

    playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isTrackingActive) {
        isManuallyPaused = true;
        pauseTracking();
      } else {
        isManuallyPaused = false;
        resumeTracking();
      }
    });

    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeTracker(currentSlug);
    });
  }

  function formatTimerDisplay(ms) {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function updateTimerUI() {
    if (!timerText) return;
    timerText.textContent = formatTimerDisplay(activeTimeMs);
  }

  function loadTimeTracker(slug) {
    if (checkOrphaned()) return;
    try {
      chrome.storage.local.get(['leetrecall_time'], (result) => {
        if (chrome.runtime.lastError || !result) return;
        const times = result.leetrecall_time || {};
        activeTimeMs = times[slug] || 0;
        lastActiveTimestamp = Date.now();
        
        initTimerWidget();
        updateTimerUI();
        if (!isTrackingActive && timerWidget) timerWidget.classList.add('paused');
      });
    } catch (e) {
      // Ignore
    }
  }

  function saveTimeTracker(slug) {
    if (!slug || checkOrphaned()) return;
    try {
      chrome.storage.local.get(['leetrecall_time'], (result) => {
        if (chrome.runtime.lastError || !result) return;
        const times = result.leetrecall_time || {};
        times[slug] = activeTimeMs;
        chrome.storage.local.set({ leetrecall_time: times });
      });
    } catch (e) {
      // Ignore
    }
  }

  function clearTimeTracker(slug) {
    if (checkOrphaned()) return;
    try {
      chrome.storage.local.get(['leetrecall_time'], (result) => {
        if (chrome.runtime.lastError || !result) return;
        const times = result.leetrecall_time || {};
        delete times[slug];
        chrome.storage.local.set({ leetrecall_time: times });
      });
      activeTimeMs = 0;
      updateTimerUI();
    } catch (e) {
      // Ignore
    }
  }

  function updateActiveTime() {
    if (isTrackingActive) {
      activeTimeMs += (Date.now() - lastActiveTimestamp);
    }
    lastActiveTimestamp = Date.now();
    updateTimerUI();
  }

  function pauseTracking() {
    if (!isTrackingActive) return;
    updateActiveTime();
    isTrackingActive = false;
    saveTimeTracker(currentSlug);
    if (timerWidget) {
      timerWidget.classList.add('paused');
      const btn = timerWidget.querySelector('.leetrecall-timer-playpause');
      if (btn) { btn.textContent = '▶'; btn.title = 'Play'; }
    }
  }

  function resumeTracking() {
    if (isManuallyPaused || isTrackingActive) return;
    lastActiveTimestamp = Date.now();
    isTrackingActive = true;
    if (timerWidget) {
      timerWidget.classList.remove('paused');
      const btn = timerWidget.querySelector('.leetrecall-timer-playpause');
      if (btn) { btn.textContent = '⏸'; btn.title = 'Pause'; }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseTracking();
    else resumeTracking();
  });

  window.addEventListener('blur', pauseTracking);
  window.addEventListener('focus', resumeTracking);

  let tickCount = 0;
  let timerInterval = setInterval(() => {
    if (checkOrphaned()) {
      clearInterval(timerInterval);
      return;
    }
    if (isTrackingActive) {
      updateActiveTime();
      tickCount++;
      if (tickCount % 10 === 0) {
        saveTimeTracker(currentSlug);
      }
    }
  }, 1000);

  // ─── SPA Navigation Detection ─────────────────────────────────

  function getCurrentSlug() {
    const parts = window.location.pathname.split('/');
    const idx = parts.indexOf('problems');
    return idx !== -1 ? parts[idx + 1] : '';
  }

  let lastUrl = window.location.href;
  const urlInterval = setInterval(() => {
    if (checkOrphaned()) {
      clearInterval(urlInterval);
      return;
    }
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
        dismissedSubmissionKeys.clear();
        setTimeout(() => { pageReady = true; }, PAGE_LOAD_GRACE_MS);
        
        // Load time tracker for new slug
        activeTimeMs = 0;
        isManuallyPaused = false;
        loadTimeTracker(newSlug);
        resumeTracking();
        
        console.log(`[LeetRecall] Navigated to: ${newSlug}`);
      }
    }
  }, 1000);
  currentSlug = getCurrentSlug();
  if (currentSlug) {
    loadTimeTracker(currentSlug);
  }

  // ─── Fetch Interception (PRIMARY detection) ────────────────────
  // This is the most reliable method — it fires when LeetCode's
  // submission API actually returns status_msg or statusDisplay.

  // Prevent double-wrapping if extension reloads and injects a new content script.
  // The fetch wrapper dispatches a custom DOM event so any active script instance can receive it.
  if (!window.__leetrecall_fetch_patched) {
    window.__leetrecall_fetch_patched = true;
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      // 1. Detect outbound submission requests
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const options = args[1] || {};
        
        if (url.includes('/submit')) {
          window.dispatchEvent(new CustomEvent('leetrecall:submit-start'));
        } else if (url.includes('/graphql') && typeof options.body === 'string') {
          if (options.body.includes('"submitCode"') || options.body.includes('"questionSubmit"')) {
            window.dispatchEvent(new CustomEvent('leetrecall:submit-start'));
          }
        }
      } catch (e) {}

      const response = await originalFetch.apply(this, args);

      // 2. Detect inbound submission results
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

        if (url.includes('/check/') || url.includes('/graphql') || url.includes('/submit')) {
          const clone = response.clone();
          clone.json().then((data) => {
            try {
              // REST API format
              if (data?.status_msg && data?.state !== 'PENDING' && data?.state !== 'STARTED') {
                window.dispatchEvent(new CustomEvent('leetrecall:submit-result', {
                  detail: { status: data.status_msg, source: 'REST' }
                }));
                return;
              }

              // GraphQL format
              const jsonStr = JSON.stringify(data);
              const match = jsonStr.match(/"(?:statusDisplay|status_msg)"\s*:\s*"([^"]+)"/);
              if (match && match[1] && match[1] !== 'Pending' && match[1] !== 'Judging') {
                window.dispatchEvent(new CustomEvent('leetrecall:submit-result', {
                  detail: { status: match[1], source: 'GraphQL' }
                }));
              }
            } catch (e) {}
          }).catch(() => {});
        }
      } catch (e) {}

      return response;
    };
  }

  // Listen for custom events from the fetch wrapper (works even after extension reload)
  window.addEventListener('leetrecall:submit-start', () => {
    startSubmission();
    console.log('[LeetRecall] Submit detected via fetch');
  });

  window.addEventListener('leetrecall:submit-result', (e) => {
    const { status, source } = e.detail || {};
    if (!status || !submissionInFlight) return;
    console.log(`[LeetRecall] ${source} response received:`, status);
    submissionInFlight = false;
    processStatus(status, '', true);
  });

  // ─── Click & Keyboard Detection (Fallback for setting submissionInFlight) ─
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-e2e-locator="console-submit-button"]') || e.target.closest('button') || e.target.closest('[role="button"]');
    if (btn) {
      const text = btn.textContent.toLowerCase();
      const locator = btn.getAttribute('data-e2e-locator') || '';
      if (text.includes('submit') || locator.includes('submit')) {
        startSubmission();
      }
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      startSubmission();
    }
  }, true);

  function startSubmission() {
    if (checkOrphaned()) return;
    submissionInFlight = true;
    // Mark the old result so a new accepted screen can still be detected later.
    const oldResult = document.querySelector('[data-e2e-locator="submission-result"]');
    if (oldResult) {
      oldResult.setAttribute('data-old-result', 'true');
    }

    [500, 1500, 3000, 6000, 10000].forEach(delay => {
      setTimeout(() => {
        if (submissionInFlight) scanVisibleSubmissionResult();
      }, delay);
    });

    setTimeout(() => {
      submissionInFlight = false;
    }, 12000);
  }

  // ─── DOM Checks (BACKUP — only when submission is in flight) ─

  // DOM fallback: no MutationObserver. Only bounded one-shot checks after submit.

  function scanVisibleSubmissionResult() {
    const detected = detectVisibleSubmissionResult();
    if (!detected) return;

    const wasUserInitiated = submissionInFlight;
    submissionInFlight = false;
    processStatus(detected.status, detected.signature, wasUserInitiated);
  }

  function detectVisibleSubmissionResult() {
    // Only check the specific result element — never read document.body.innerText
    const resultEl = findVisibleSubmissionStatusElement();
    if (!resultEl) return null;

    const resultText = resultEl.textContent?.trim() || '';
    if (!resultText || isPendingStatus(resultText)) return null;

    const status = normalizeSubmissionStatus(resultText);
    if (!status) return null;

    // Build signature from the result element's parent context only (lightweight)
    const contextEl = findSubmissionContextElement(resultEl);
    const contextText = `${resultText}\n${contextEl?.textContent || ''}`;

    return {
      status,
      signature: buildSubmissionSignature(status, contextText),
    };
  }

  function findVisibleSubmissionStatusElement() {
    const direct = document.querySelector('[data-e2e-locator="submission-result"]');
    if (direct && isVisibleElement(direct)) return direct;

    const candidates = document.querySelectorAll([
      '[class*="text-green"]',
      '[class*="text-success"]',
      '[class*="text-red"]',
      '[class*="text-danger"]',
      '[class*="text-yellow"]',
      '[class*="text-warning"]',
      '[class*="text-orange"]',
    ].join(','));
    for (const el of candidates) {
      if (!isVisibleElement(el)) continue;
      const text = (el.textContent || '').trim();
      if (text.length === 0 || text.length > 160) continue;
      if (!normalizeSubmissionStatus(text) || isPendingStatus(text)) continue;

      const context = findSubmissionContextElement(el);
      const contextText = context?.textContent || '';
      if (findStatusInSubmissionText(`${text}\n${contextText}`)) return el;
    }

    return null;
  }

  function findSubmissionContextElement(el) {
    let current = el;
    for (let depth = 0; current && depth < 6; depth++) {
      const text = current.textContent || '';
      if (text.length > 80 && text.length < 5000 && (
        /submitted at/i.test(text) ||
        /\d+\s*\/\s*\d+\s*testcases\s+passed/i.test(text) ||
        (/runtime/i.test(text) && /memory/i.test(text))
      )) {
        return current;
      }
      current = current.parentElement;
    }

    return el.parentElement;
  }

  function isVisibleElement(el) {
    return Boolean(el && el.isConnected && el.getClientRects().length > 0);
  }

  function findStatusInSubmissionText(text) {
    if (!text) return '';

    const testcaseMatch = text.match(
      /\b(Accepted|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compile Error)\b\s+\d+\s*\/\s*\d+\s*testcases\s+passed/i
    );
    if (testcaseMatch) return normalizeSubmissionStatus(testcaseMatch[1]);

    const hasSubmissionContext =
      /submitted at/i.test(text) ||
      (/runtime/i.test(text) && /memory/i.test(text));

    if (!hasSubmissionContext) return '';

    const statusLine = text
      .split('\n')
      .map(line => line.trim())
      .find(line => /^(Accepted|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compile Error)(\s|$)/.test(line));

    return statusLine ? normalizeSubmissionStatus(statusLine) : '';
  }

  function normalizeSubmissionStatus(rawText) {
    const text = rawText.trim();
    if (text.includes('Accepted')) return 'Accepted';
    if (text.includes('Wrong Answer')) return 'Wrong Answer';
    if (text.includes('Time Limit Exceeded')) return 'Time Limit Exceeded';
    if (text.includes('Memory Limit Exceeded')) return 'Memory Limit Exceeded';
    if (text.includes('Runtime Error')) return 'Runtime Error';
    if (text.includes('Compile Error')) return 'Compile Error';
    return '';
  }

  function isPendingStatus(text) {
    return text.includes('Pending') || text.includes('Judging') || text.includes('Started');
  }

  function buildSubmissionSignature(status, text) {
    const submissionUrl = window.location.pathname.match(/\/submissions?\/\d+/)?.[0] || '';
    const submittedAt = text.match(/submitted at[^\n]+/i)?.[0] || '';
    const testcaseLine = text.match(new RegExp(`${status}\\s+\\d+\\s*\\/\\s*\\d+\\s*testcases\\s+passed`, 'i'))?.[0] || '';
    const runtimeLine = text.match(/runtime\s*\n?\s*\d+\s*ms/i)?.[0] || '';

    return [submissionUrl, submittedAt, testcaseLine, runtimeLine, status]
      .filter(Boolean)
      .join('|');
  }

  function processStatus(rawText, signature = '', wasUserInitiated = false) {
    const status = normalizeSubmissionStatus(rawText);
    if (!status) return;

    onSubmissionResult(status, signature, wasUserInitiated);
  }

  // ─── Core Handler ─────────────────────────────────────────────

  function onSubmissionResult(status, signature = '', wasUserInitiated = false) {
    // Guard: bail if extension was reloaded and this script is stale
    if (!chrome.runtime?.id) {
      return;
    }

    const slug = Extractor.getSlug();
    if (!slug) return;

    const submissionKey = signature ? `${slug}:${status}:${signature}` : '';
    if (submissionKey) {
      if (dismissedSubmissionKeys.has(submissionKey)) {
        return;
      }
      if (submissionKey === lastProcessedSubmissionKey) {
        return;
      }
      if (pendingSubmissionKeys.has(submissionKey) && !wasUserInitiated) {
        return;
      }
    }

    // For passive detection (not user-initiated), ask the user for confirmation.
    if (!wasUserInitiated) {
      // Lock immediately so passive detection doesn't spawn more toasts
      if (isLocked && slug === lastDetectedSlug) {
        return;
      }
      isLocked = true;
      lastDetectedSlug = slug;

      let problemInfo;
      try {
        problemInfo = Extractor.extractAll();
        if (!problemInfo || !problemInfo.slug) {
          console.error('[LeetRecall] Failed to extract problem info - no slug found');
          isLocked = false;
          return;
        }
      } catch (e) {
        console.error('[LeetRecall] Error extracting problem info:', e);
        isLocked = false;
        return;
      }

      showConfirmationToast(problemInfo.title, status, () => {
        // User clicked Track: confirm user-initiated tracking
        // Temporarily unlock so the user-initiated path can proceed
        isLocked = false;
        onSubmissionResult(status, signature, true);
      }, () => {
        // User clicked Dismiss
        if (submissionKey) {
          dismissedSubmissionKeys.add(submissionKey);
        }
        // Keep locked for the debounce period to prevent re-detection
        setTimeout(() => {
          isLocked = false;
          lastDetectedSlug = null;
        }, DEBOUNCE_MS);
      });

      if (submissionKey) {
        pendingSubmissionKeys.add(submissionKey);
      }
      return;
    }

    // Hard lock — one celebration/toast per problem per 15 seconds
    if (isLocked && slug === lastDetectedSlug) {
      if (submissionKey) pendingSubmissionKeys.delete(submissionKey);
      return;
    }

    isLocked = true;
    lastDetectedSlug = slug;
    setTimeout(() => {
      isLocked = false;
      lastDetectedSlug = null;
    }, DEBOUNCE_MS);

    // Extract problem info and send to service worker
    let problemInfo;
    try {
      problemInfo = Extractor.extractAll();
      if (!problemInfo || !problemInfo.slug) {
        console.error('[LeetRecall] Failed to extract problem info - no slug found');
        if (submissionKey) pendingSubmissionKeys.delete(submissionKey);
        return;
      }
    } catch (e) {
      console.error('[LeetRecall] Error extracting problem info:', e);
      if (submissionKey) pendingSubmissionKeys.delete(submissionKey);
      return;
    }

    problemInfo.status = status;
    updateActiveTime(); // Make sure active time is totally up to date
    problemInfo.timeSpentMs = activeTimeMs;
    console.log(`[LeetRecall] Submission result: ${status} for ${problemInfo.title}. Time spent: ${Math.round(activeTimeMs / 1000)}s`);

    chrome.runtime.sendMessage(
      { type: 'PROBLEM_SUBMITTED', data: problemInfo },
      (response) => {
        try {
          if (chrome.runtime.lastError) {
            console.error('[LeetRecall] Error sending message:', chrome.runtime.lastError);
            if (submissionKey) pendingSubmissionKeys.delete(submissionKey);
            return;
          }
          if (response?.success) {
            if (submissionKey) {
              lastProcessedSubmissionKey = submissionKey;
              sessionStorage.setItem('leetrecall_last_submission_key', submissionKey);
              pendingSubmissionKeys.delete(submissionKey);
            }
            if (status === 'Accepted') {
              showCelebration(problemInfo.title, response.isNew);
              clearTimeTracker(slug);
              activeTimeMs = 0;
              lastActiveTimestamp = Date.now();
            } else {
              showFailureToast(problemInfo.title, status);
            }
          } else if (submissionKey) {
            pendingSubmissionKeys.delete(submissionKey);
          }
        } catch (e) {
          console.error('[LeetRecall] Error in sendMessage callback:', e);
        }
      }
    );
  }

  function showConfirmationToast(title, status, onConfirm, onDismiss) {
    const existing = document.querySelector('.leetrecall-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'leetrecall-toast';
    toast.style.cursor = 'default';

    toast.innerHTML = `
      <div class="leetrecall-toast-icon">❓</div>
      <div class="leetrecall-toast-content">
        <div class="leetrecall-toast-title">Track Old Submission?</div>
        <div class="leetrecall-toast-message">Detected ${status} submission for ${title}</div>
        <div class="leetrecall-toast-actions">
          <button type="button" class="leetrecall-toast-btn leetrecall-toast-btn-confirm">Track This</button>
          <button type="button" class="leetrecall-toast-btn leetrecall-toast-btn-dismiss">Dismiss</button>
        </div>
      </div>
    `;

    document.body.appendChild(toast);

    let resolved = false;

    const handleConfirm = (e) => {
      if (e) e.stopPropagation();
      if (resolved) return;
      resolved = true;
      onConfirm();
      toast.classList.add('leetrecall-toast-hide');
      setTimeout(() => toast.remove(), 400);
    };

    const handleDismiss = (e) => {
      if (e) e.stopPropagation();
      if (resolved) return;
      resolved = true;
      onDismiss();
      toast.classList.add('leetrecall-toast-hide');
      setTimeout(() => toast.remove(), 400);
    };

    toast.querySelector('.leetrecall-toast-btn-confirm').addEventListener('click', handleConfirm);
    toast.querySelector('.leetrecall-toast-btn-dismiss').addEventListener('click', handleDismiss);

    requestAnimationFrame(() => {
      toast.classList.add('leetrecall-toast-show');
    });

    setTimeout(() => {
      if (document.body.contains(toast) && !resolved) {
        handleDismiss();
      }
    }, 15000);
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

    const toast = document.createElement('div');
    toast.className = 'leetrecall-toast';
    toast.innerHTML = `
      <div class="leetrecall-toast-icon">🧠</div>
      <div class="leetrecall-toast-content">
        <div class="leetrecall-toast-title">LeetRecall${isNew ? ' ✨' : ''}</div>
        <div class="leetrecall-toast-message">${isNew ? 'Tracked' : 'Updated'}: ${title}</div>
        <div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
          <div style="font-size: 11px; color: #8490a5; margin-bottom: 8px;">Rate your confidence:</div>
          <div class="leetrecall-toast-actions" style="display: flex; gap: 6px;">
            <button type="button" class="leetrecall-toast-btn rating-btn" data-rating="1" style="background: rgba(239, 68, 68, 0.2) !important; color: #fca5a5 !important; border: 1px solid rgba(239, 68, 68, 0.3) !important; flex: 1; padding: 6px 4px !important;">Again</button>
            <button type="button" class="leetrecall-toast-btn rating-btn" data-rating="2" style="background: rgba(245, 158, 11, 0.2) !important; color: #fcd34d !important; border: 1px solid rgba(245, 158, 11, 0.3) !important; flex: 1; padding: 6px 4px !important;">Hard</button>
            <button type="button" class="leetrecall-toast-btn rating-btn" data-rating="3" style="background: rgba(16, 185, 129, 0.2) !important; color: #6ee7b7 !important; border: 1px solid rgba(16, 185, 129, 0.3) !important; flex: 1; padding: 6px 4px !important;">Good</button>
            <button type="button" class="leetrecall-toast-btn rating-btn" data-rating="4" style="background: rgba(59, 130, 246, 0.2) !important; color: #93c5fd !important; border: 1px solid rgba(59, 130, 246, 0.3) !important; flex: 1; padding: 6px 4px !important;">Easy</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(toast);

    toast.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
      toast.classList.add('leetrecall-toast-hide');
      setTimeout(() => toast.remove(), 400);
    });

    toast.querySelectorAll('.rating-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rating = parseInt(btn.dataset.rating);
        chrome.runtime.sendMessage({ type: 'RATE_CONFIDENCE', data: { slug: currentSlug, rating } });
        
        btn.style.background = 'var(--accent) !important';
        btn.style.color = 'var(--bg-card) !important';
        btn.textContent = 'Saved!';
        
        setTimeout(() => {
          toast.classList.add('leetrecall-toast-hide');
          setTimeout(() => toast.remove(), 400);
        }, 800);
      });
    });

    requestAnimationFrame(() => {
      toast.classList.add('leetrecall-toast-show');
    });
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

    toast.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
      toast.classList.add('leetrecall-toast-hide');
      setTimeout(() => toast.remove(), 400);
    });

    requestAnimationFrame(() => toast.classList.add('leetrecall-toast-show'));

    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.classList.add('leetrecall-toast-hide');
        setTimeout(() => toast.remove(), 400);
      }
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

  function checkForAutoReset() {
    if (checkOrphaned()) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('lr_reset') === 'true') {
      console.log('[LeetRecall] Auto-reset triggered by URL parameter');
      
      const attemptReset = (retries = 15) => {
        if (retries <= 0) return;
        
        let resetBtn = document.querySelector('[data-e2e-locator="reset-to-default-button"]');
        if (!resetBtn) {
          const elements = Array.from(document.querySelectorAll('button, div[role="button"]'));
          resetBtn = elements.find(b => {
            const label = (b.getAttribute('aria-label') || b.title || '').toLowerCase();
            if (label.includes('reset')) return true;
            
            const html = b.innerHTML.toLowerCase();
            return b.querySelector('svg') && (html.includes('rotate-left') || html.includes('arrow-rotate') || html.includes('undo'));
          });
        }
        
        if (resetBtn) {
          console.log('[LeetRecall] Found reset button, clicking...');
          resetBtn.click();
          
          let confirmRetries = 10;
          const attemptConfirm = () => {
            if (confirmRetries <= 0) return;
            const confirmBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(b => {
              const text = (b.textContent || '').trim().toLowerCase();
              return text === 'confirm' || text === 'yes' || text === 'reset';
            });
            
            if (confirmBtn) {
              console.log('[LeetRecall] Found confirm button, clicking...');
              confirmBtn.click();
              
              const newUrl = window.location.href.replace(/[?&]lr_reset=true/, '');
              window.history.replaceState({}, document.title, newUrl);
            } else {
              confirmRetries--;
              setTimeout(attemptConfirm, 500);
            }
          };
          setTimeout(attemptConfirm, 500);
        } else {
          setTimeout(() => attemptReset(retries - 1), 1000);
        }
      };
      
      attemptReset();
    }
  }

  // Check for review notes on initial load (with delay for page to settle)
  setTimeout(() => {
    checkForReviewNotes();
    checkForAutoReset();
  }, 2000);

  // Also check when navigating to a new problem (SPA)
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

  console.log('[LeetRecall] Content script loaded — watching for submissions');
})();

