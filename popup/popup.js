/**
 * LeetRecall — Popup Logic
 */

document.addEventListener('DOMContentLoaded', init);

let currentProblem = null;
let dueProblems = [];
let pendingNotes = [];  // Notes being composed for the current attempt

async function init() {
  await loadData();
  setupListeners();
}

async function loadData() {
  const [dueRes, statsRes, upcomingRes] = await Promise.all([
    sendMessage('GET_DUE_PROBLEMS'),
    sendMessage('GET_STATS'),
    sendMessage('GET_ALL_PROBLEMS'),
  ]);

  if (dueRes.success) {
    dueProblems = dueRes.problems;
    await renderQueue(dueProblems);
    updateProgress(dueRes.problems, statsRes?.stats);
  }

  if (statsRes.success) {
    updateStats(statsRes.stats);
  }

  if (upcomingRes.success) {
    renderUpcoming(upcomingRes.problems);
  }
}

function setupListeners() {
  document.getElementById('btn-dashboard').addEventListener('click', openDashboard);
  document.getElementById('btn-dashboard-full').addEventListener('click', openDashboard);

  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rating = parseInt(btn.dataset.rating);
      if (currentProblem) rateConfidence(currentProblem.id, rating);
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

// ─── Rendering ─────────────────────────────────────────

async function renderQueue(problems) {
  const container = document.getElementById('queue-container');
  const emptyState = document.getElementById('empty-state');
  const ratingSection = document.getElementById('rating-section');

  if (!problems || problems.length === 0) {
    container.innerHTML = '';
    container.appendChild(createEmptyState());
    ratingSection.style.display = 'none';
    currentProblem = null;
    return;
  }

  container.innerHTML = '';

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

  // Auto-select the problem they are currently viewing if it's in the queue
  let selectedIndex = 0;
  if (activeSlug) {
    const matchIdx = problems.findIndex(p => p.id === activeSlug);
    if (matchIdx !== -1) {
      selectedIndex = matchIdx;
    }
  }

  problems.forEach((problem, i) => {
    const card = createProblemCard(problem, i === selectedIndex);
    container.appendChild(card);
  });

  // Select the determined problem
  selectProblem(problems[selectedIndex]);
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <div class="empty-icon">✨</div>
    <div class="empty-title">All caught up!</div>
    <div class="empty-message">Solve problems on LeetCode to grow your deck.</div>
  `;
  return div;
}

function createProblemCard(problem, isActive) {
  const card = document.createElement('div');
  card.className = `problem-card${isActive ? ' active' : ''}`;
  card.dataset.slug = problem.id;

  const diff = (problem.difficulty || 'unknown').toLowerCase();
  const dueText = getRelativeTime(problem.nextDueDate);
  const isOverdue = new Date(problem.nextDueDate) < new Date();

  card.innerHTML = `
    <div class="problem-difficulty-dot ${diff}"></div>
    <div class="problem-info">
      <div class="problem-title">${escapeHtml(problem.title)}</div>
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

  // Collapse notes input
  document.getElementById('notes-input-body').style.display = 'none';
  document.getElementById('notes-toggle-arrow').textContent = '▸';

  // Load previous notes for this problem
  await loadPreviousNotes(problem.id);
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

function updateProgress(dueProblems, stats) {
  const total = dueProblems.length;
  const reviewed = dueProblems.filter(p => {
    const today = new Date().toISOString().split('T')[0];
    return p.history?.some(h => h.date.startsWith(today));
  }).length;

  const pct = total > 0 ? Math.round((reviewed / total) * 100) : (stats?.totalProblems > 0 ? 100 : 0);
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('due-count').textContent = total - reviewed;

  const label = document.getElementById('progress-label');
  if (total === 0) {
    label.textContent = stats?.totalProblems > 0 ? 'All reviews complete!' : 'No problems tracked yet';
  } else {
    label.textContent = `${reviewed} of ${total} reviews done today`;
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
  const response = await sendMessage('RATE_CONFIDENCE', {
    slug,
    rating,
    notes: pendingNotes.length > 0 ? pendingNotes : undefined,
  });
  if (response.success) {
    pendingNotes = [];
    renderNotesList();
    document.getElementById('notes-review-section').style.display = 'none';
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
