/**
 * LeetRecall — Popup Logic
 */

document.addEventListener('DOMContentLoaded', init);

let currentProblem = null;
let dueProblems = [];

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
    renderQueue(dueProblems);
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
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
}

// ─── Rendering ─────────────────────────────────────────

function renderQueue(problems) {
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

  problems.forEach((problem, i) => {
    const card = createProblemCard(problem, i === 0);
    container.appendChild(card);
  });

  // Select first problem
  selectProblem(problems[0]);
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

function selectProblem(problem) {
  currentProblem = problem;
  const ratingSection = document.getElementById('rating-section');
  ratingSection.style.display = 'block';
  updateIntervalHints(problem);
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
  const response = await sendMessage('RATE_CONFIDENCE', { slug, rating });
  if (response.success) {
    await loadData();
  }
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
