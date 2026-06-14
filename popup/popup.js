/**
 * LeetRecall — Popup Logic
 */

document.addEventListener('DOMContentLoaded', init);

let currentProblem = null;
let dueProblems = [];
let pendingNotes = [];  // Notes being composed for the current attempt
let pendingTags = [];   // Custom tags being added for the current attempt
let allExistingTags = new Set(); // For autocomplete

async function init() {
  setupListeners();
  try {
    await loadData();
  } catch (e) {
    console.error('[LeetRecall] Error loading popup data:', e);
  }
}

async function loadData() {
  const [dueRes, statsRes, allProblemsRes, settingsRes] = await Promise.all([
    sendMessage('GET_DUE_PROBLEMS'),
    sendMessage('GET_STATS'),
    sendMessage('GET_ALL_PROBLEMS'),
    sendMessage('GET_SETTINGS'),
  ]);

  // The all-problems map keyed by slug
  const allProblemsMap = allProblemsRes.success ? allProblemsRes.problems : {};

  if (dueRes.success && allProblemsRes.success && settingsRes.success) {
    dueProblems = dueRes.problems;

    // If no due problems, check for a saved practice queue
    if (dueProblems.length === 0) {
      try {
        const stored = await chrome.storage.session.get('practiceQueue');
        const practiceSlugs = stored.practiceQueue || [];
        if (practiceSlugs.length > 0) {
          const practiceProblems = practiceSlugs
            .map(slug => allProblemsMap[slug])
            .filter(Boolean)
            .map(p => ({ ...p, _isPractice: true }));
          if (practiceProblems.length > 0) {
            renderPracticeQueue(practiceProblems);
            updateProgress(dueProblems, allProblemsMap, settingsRes.settings, statsRes?.stats);
            // Skip the normal renderQueue
            if (statsRes.success) updateStats(statsRes.stats);
            if (allProblemsRes.success) {
              renderUpcoming(Object.values(allProblemsMap));
              Object.values(allProblemsMap).forEach(p => {
                if (p.tags) p.tags.forEach(t => allExistingTags.add(t));
              });
              populateTagsDatalist();
            }
            return;
          }
        }
      } catch (e) {
        // session storage might not be available, ignore
      }
    }

    await renderQueue(dueProblems, allProblemsMap);
    updateProgress(dueProblems, allProblemsMap, settingsRes.settings, statsRes?.stats);
  }

  if (statsRes.success) {
    updateStats(statsRes.stats);
  }

  if (allProblemsRes.success) {
    const allProblems = Object.values(allProblemsMap);
    renderUpcoming(allProblems);
    
    // Extract unique tags for autocomplete
    allProblems.forEach(p => {
      if (p.tags) p.tags.forEach(t => allExistingTags.add(t));
    });
    populateTagsDatalist();
  }
}

function setupListeners() {
  document.getElementById('btn-dashboard').addEventListener('click', openDashboard);
  document.getElementById('btn-dashboard-full').addEventListener('click', openDashboard);

  // ─── Practice Now (delegated, since button is dynamic) ──
  document.getElementById('queue-container').addEventListener('click', (e) => {
    if (e.target.closest('#btn-practice-now')) {
      handlePracticeNow();
    }
  });

  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rating = parseInt(btn.dataset.rating);
      if (currentProblem) rateConfidence(getProblemSlug(currentProblem), rating);
    });
  });

  // ─── Notes Toggle ────────────────────────────────
  document.getElementById('notes-toggle').addEventListener('click', () => {
    const body = document.getElementById('notes-input-body');
    const arrow = document.getElementById('notes-toggle-arrow');
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    arrow.textContent = isHidden ? '▾' : '▸';
    if (isHidden) {
      document.getElementById('notes-input-field').focus();
    }
  });

  // ─── Tags Toggle ─────────────────────────────────
  document.getElementById('tags-toggle').addEventListener('click', () => {
    const body = document.getElementById('tags-input-body');
    const arrow = document.getElementById('tags-toggle-arrow');
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    arrow.textContent = isHidden ? '▾' : '▸';
    if (isHidden) {
      document.getElementById('tags-input-field').focus();
    }
  });

  // ─── Add Tag ─────────────────────────────────────
  document.getElementById('btn-add-tag').addEventListener('click', addTagFromInput);
  document.getElementById('tags-input-field').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagFromInput();
    }
  });
  document.getElementById('tags-input-field').addEventListener('input', (e) => {
    // Auto-add tag when user clicks a datalist autocomplete option
    if (e.inputType === 'insertReplacementText') {
      addTagFromInput();
    }
  });
  document.getElementById('tags-input-field').addEventListener('change', (e) => {
    // Fallback: 'change' fires on datalist selection in many browsers
    if (e.target.value.trim() && allExistingTags.has(e.target.value.trim())) {
      addTagFromInput();
    }
  });

  // ─── Add Note ────────────────────────────────────
  document.getElementById('btn-add-note').addEventListener('click', addNoteFromInput);
  document.getElementById('notes-input-field').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNoteFromInput();
    }
  });

  // ─── Dismiss Previous Notes ──────────────────────
  document.getElementById('btn-dismiss-notes').addEventListener('click', () => {
    document.getElementById('notes-review-section').style.display = 'none';
  });
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
}

async function handlePracticeNow() {
  const btn = document.getElementById('btn-practice-now');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="practice-icon">⏳</span> Loading...';
  }

  const res = await sendMessage('GET_PRACTICE_PROBLEMS');
  if (res.success && res.problems.length > 0) {
    const practiceProblems = res.problems.map(p => ({ ...p, _isPractice: true }));
    
    // Persist the practice queue so it survives popup close/reopen
    try {
      const slugs = practiceProblems.map(p => p.id);
      await chrome.storage.session.set({ practiceQueue: slugs });
    } catch (e) {
      // Ignore if session storage unavailable
    }

    renderPracticeQueue(practiceProblems);
  } else {
    if (btn) {
      btn.innerHTML = '<span class="practice-icon">📭</span> No problems to practice';
      btn.disabled = true;
    }
  }
}

function renderPracticeQueue(practiceProblems) {
  const container = document.getElementById('queue-container');
  container.innerHTML = '';
  
  const header = document.createElement('div');
  header.className = 'practice-header';
  header.innerHTML = '<span class="practice-header-icon">🎯</span> Weakest problems to practice';
  container.appendChild(header);

  practiceProblems.forEach((problem, i) => {
    const card = createProblemCard(problem, i === 0);
    card.classList.add('practice-card');
    container.appendChild(card);
  });

  selectProblem(practiceProblems[0]);

  const sectionTitle = document.querySelector('#current-section .section-title');
  if (sectionTitle) sectionTitle.textContent = 'Practice Queue';
}

// ─── Rendering ─────────────────────────────────────────

async function renderQueue(problems, allProblemsMap) {
  const container = document.getElementById('queue-container');
  const emptyState = document.getElementById('empty-state');
  const ratingSection = document.getElementById('rating-section');

  // Detect if user is currently on a LeetCode problem page
  let activeSlug = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0 && tabs[0].url) {
      const url = new URL(tabs[0].url);
      if (url.hostname.includes('leetcode.com') && url.pathname.includes('/problems/')) {
        const parts = url.pathname.split('/');
        const idx = parts.indexOf('problems');
        if (idx !== -1) activeSlug = parts[idx + 1];
      }
    }
  } catch (e) {
    // Ignore permissions/query errors
  }

  container.innerHTML = '';
  
  let problemsToRender = [...(problems || [])];

  // If the currently open tab is a tracked problem but NOT in the due queue, add it to the top!
  if (activeSlug && allProblemsMap && allProblemsMap[activeSlug]) {
    if (!problemsToRender.some(p => p.id === activeSlug)) {
      const activeObj = { ...allProblemsMap[activeSlug], _isCurrentTab: true };
      problemsToRender.unshift(activeObj);
    }
  }

  if (problemsToRender.length === 0) {
    container.appendChild(createEmptyState());
    ratingSection.style.display = 'none';
    currentProblem = null;
    return;
  }

  // Auto-select the problem they are currently viewing
  let selectedIndex = 0;
  if (activeSlug) {
    const matchIdx = problemsToRender.findIndex(p => p.id === activeSlug);
    if (matchIdx !== -1) {
      selectedIndex = matchIdx;
    }
  }

  problemsToRender.forEach((problem, i) => {
    const card = createProblemCard(problem, i === selectedIndex);
    if (problem._isCurrentTab) {
      card.style.border = '1px solid var(--accent)';
      card.title = "Currently open in active tab";
    }
    container.appendChild(card);
  });

  // Select the determined problem
  selectProblem(problemsToRender[selectedIndex]);
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <div class="empty-icon">✨</div>
    <div class="empty-title">All caught up!</div>
    <div class="empty-message">No problems are due for review today.</div>
    <button type="button" class="practice-now-btn" id="btn-practice-now">
      <span class="practice-icon">🔄</span> Practice Weak Problems
    </button>
  `;
  return div;
}

function createProblemCard(problem, isActive) {
  const card = document.createElement('div');
  card.className = `problem-card${isActive ? ' active' : ''}`;
  card.dataset.slug = getProblemSlug(problem);

  const diff = (problem.difficulty || 'unknown').toLowerCase();
  const dueText = getRelativeTime(problem.nextDueDate);
  const isOverdue = new Date(problem.nextDueDate) < new Date();

  const url = `${problem.url || `https://leetcode.com/problems/${getProblemSlug(problem)}/`}?lr_reset=true`;

  card.innerHTML = `
    <div class="problem-difficulty-dot ${diff}"></div>
    <div class="problem-info">
      <div class="problem-title">
        <a href="${url}" target="_blank" title="Solve on LeetCode" style="color: inherit; text-decoration: none;">
          ${escapeHtml(problem.title)} <span style="opacity: 0.6; font-size: 11px; margin-left: 4px;">↗</span>
        </a>
      </div>
      <div class="problem-meta">${problem.difficulty} · Solved ${problem.solveCount}x</div>
    </div>
    <div class="problem-due ${isOverdue ? 'overdue' : ''}">${dueText}</div>
  `;

  card.addEventListener('click', () => {
    document.querySelectorAll('.problem-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectProblem(problem);
  });

  return card;
}

async function selectProblem(problem) {
  currentProblem = problem;
  pendingNotes = [];  // Reset notes for new problem
  renderNotesList();

  const ratingSection = document.getElementById('rating-section');
  ratingSection.style.display = 'block';
  updateIntervalHints(problem);

  // Collapse inputs
  document.getElementById('notes-input-body').style.display = 'none';
  document.getElementById('notes-toggle-arrow').textContent = '▸';
  
  pendingTags = [];
  renderTagsList();
  document.getElementById('tags-input-body').style.display = 'none';
  document.getElementById('tags-toggle-arrow').textContent = '▸';

  // Load previous notes for this problem
  await loadPreviousNotes(getProblemSlug(problem));
}

function updateIntervalHints(problem) {
  [1, 2, 3, 4].forEach(rating => {
    const q = QUALITY_MAP[rating];
    let interval;
    if (q < 3) {
      interval = 1;
    } else {
      const rep = problem.repetition + 1;
      if (rep === 1) interval = 1;
      else if (rep === 2) interval = 6;
      else interval = Math.round(problem.interval * problem.efactor);
    }
    const el = document.getElementById(`interval-${rating}`);
    if (el) el.textContent = interval === 1 ? '1d' : `${interval}d`;
  });
}

function renderUpcoming(allProblems) {
  const list = document.getElementById('upcoming-list');
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const upcoming = Object.values(allProblems)
    .filter(p => new Date(p.nextDueDate) > endOfDay)
    .sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate))
    .slice(0, 5);

  if (upcoming.length === 0) {
    list.innerHTML = '<div class="empty-hint">No upcoming reviews</div>';
    return;
  }

  list.innerHTML = upcoming.map(p => `
    <div class="upcoming-item">
      <span class="upcoming-title">${escapeHtml(p.title)}</span>
      <span class="upcoming-due">${getRelativeTime(p.nextDueDate)}</span>
    </div>
  `).join('');
}

function updateProgress(dueProblems, allProblemsMap, settings, stats) {
  const limit = settings.dailyReviewLimit || 3;
  const todayStr = new Date().toISOString().split('T')[0];
  
  const allProblems = Object.values(allProblemsMap);
  const reviewedToday = allProblems.filter(p => {
    if (!p.history) return false;
    const hasReviewToday = p.history.some(h => h.date.startsWith(todayStr));
    const wasOldProblem = p.history.some(h => !h.date.startsWith(todayStr));
    return hasReviewToday && wasOldProblem;
  }).length;
  
  const remainingDue = dueProblems.length;
  const totalTarget = Math.min(limit, reviewedToday + remainingDue);
  const displayReviewed = Math.min(reviewedToday, totalTarget);

  const pct = totalTarget > 0 ? Math.round((displayReviewed / totalTarget) * 100) : (stats?.totalProblems > 0 ? 100 : 0);
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('due-count').textContent = remainingDue;

  const label = document.getElementById('progress-label');
  if (totalTarget === 0 || remainingDue === 0) {
    label.textContent = stats?.totalProblems > 0 ? 'All reviews complete!' : 'No problems tracked yet';
  } else {
    label.textContent = `${displayReviewed} of ${totalTarget} reviews done today`;
  }
}

function updateStats(stats) {
  const streakEl = document.getElementById('streak-count');
  const badgeEl = document.getElementById('streak-badge');
  streakEl.textContent = stats.streak || 0;
  badgeEl.dataset.streak = stats.streak || 0;
}

// ─── Actions ───────────────────────────────────────────

async function rateConfidence(slug, rating) {
  // Auto-commit any pending input before saving
  const tagInput = document.getElementById('tags-input-field');
  if (tagInput && tagInput.value.trim()) addTagFromInput();
  
  const noteInput = document.getElementById('notes-input-field');
  if (noteInput && noteInput.value.trim()) addNoteFromInput();

  const response = await sendMessage('RATE_CONFIDENCE', {
    slug,
    rating,
    notes: pendingNotes.length > 0 ? pendingNotes : undefined,
    customTags: pendingTags.length > 0 ? pendingTags : undefined,
  });
  if (response.success) {
    pendingNotes = [];
    pendingTags = [];
    renderNotesList();
    renderTagsList();
    document.getElementById('notes-review-section').style.display = 'none';
    // Clear practice queue so it refreshes after rating
    try { await chrome.storage.session.remove('practiceQueue'); } catch (e) {}
    await loadData();
  }
}

// ─── Notes Management ──────────────────────────────────

function addNoteFromInput() {
  const input = document.getElementById('notes-input-field');
  const text = input.value.trim();
  if (!text) return;
  if (pendingNotes.length >= 10) return; // Max 10 notes per attempt

  pendingNotes.push(text);
  input.value = '';
  input.focus();
  renderNotesList();
}

function removeNote(index) {
  pendingNotes.splice(index, 1);
  renderNotesList();
}

function renderNotesList() {
  const container = document.getElementById('notes-items-list');
  if (pendingNotes.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = pendingNotes.map((note, i) => `
    <div class="notes-item">
      <span class="notes-item-bullet">•</span>
      <span class="notes-item-text">${escapeHtml(note)}</span>
      <button class="notes-item-remove" data-index="${i}" title="Remove">×</button>
    </div>
  `).join('');

  container.querySelectorAll('.notes-item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeNote(parseInt(btn.dataset.index)));
  });
}

// ─── Tags Management ───────────────────────────────────

function addTagFromInput() {
  const input = document.getElementById('tags-input-field');
  const tags = parseTagsInput(input.value);
  if (tags.length === 0) return;

  tags.some(tag => {
    if (pendingTags.length >= 10) return true; // Max 10 tags per attempt
    if (pendingTags.some(existing => existing.toLowerCase() === tag.toLowerCase())) return false;
    pendingTags.push(tag);
    return false;
  });
  input.value = '';
  input.focus();
  renderTagsList();
}

function removeTag(index) {
  pendingTags.splice(index, 1);
  renderTagsList();
}

function renderTagsList() {
  const container = document.getElementById('tags-items-list');
  if (pendingTags.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = pendingTags.map((tag, i) => `
    <div class="tags-item">
      <span class="tags-item-text">${escapeHtml(tag)}</span>
      <button class="tags-item-remove" data-index="${i}" title="Remove">×</button>
    </div>
  `).join('');

  container.querySelectorAll('.tags-item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeTag(parseInt(btn.dataset.index)));
  });
}

function populateTagsDatalist() {
  const datalist = document.getElementById('existing-tags-list');
  if (!datalist) return;
  datalist.innerHTML = Array.from(allExistingTags)
    .sort()
    .map(tag => `<option value="${escapeHtml(tag)}">`)
    .join('');
}

function getProblemSlug(problem) {
  return problem.id || problem.slug || problem.titleSlug || '';
}

function parseTagsInput(value) {
  return [...new Map(String(value || '')
    .split(/[,;\n]+/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => [tag.toLowerCase(), tag])).values()];
}

async function loadPreviousNotes(slug) {
  const reviewSection = document.getElementById('notes-review-section');
  const res = await sendMessage('GET_PREVIOUS_NOTES', { slug });

  if (!res.success || !res.notes || res.notes.length === 0) {
    reviewSection.style.display = 'none';
    return;
  }

  // Show previous notes section
  reviewSection.style.display = 'block';

  // Meta info
  const meta = document.getElementById('notes-review-meta');
  const attemptDate = new Date(res.previousAttempt.date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  meta.innerHTML = `
    <span class="notes-meta-date">${attemptDate}</span>
    <span class="notes-meta-sep">·</span>
    <span class="notes-meta-rating">Rated: ${res.previousAttempt.ratingLabel}</span>
  `;

  // Checklist
  const checklist = document.getElementById('notes-checklist');
  checklist.innerHTML = res.notes.map((note, i) => `
    <label class="notes-check-item" id="notes-check-${i}">
      <input type="checkbox" class="notes-checkbox">
      <span class="notes-check-custom"></span>
      <span class="notes-check-text">${escapeHtml(note)}</span>
    </label>
  `).join('');

  // Add checkbox interaction (strikethrough on check)
  checklist.querySelectorAll('.notes-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.notes-check-item').classList.toggle('checked', cb.checked);
    });
  });
}

// ─── Helpers ───────────────────────────────────────────

function sendMessage(type, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, data }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[LeetRecall]', chrome.runtime.lastError);
        resolve({ success: false });
        return;
      }
      resolve(response || { success: false });
    });
  });
}

function getRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.round(diffDays / 7)}w`;
  return `${Math.round(diffDays / 30)}mo`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
