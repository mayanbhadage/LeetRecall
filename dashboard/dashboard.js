/**
 * LeetRecall — Dashboard Logic
 */

document.addEventListener('DOMContentLoaded', init);

let allProblems = {};
let sortField = 'nextDueDate';
let sortDir = 'asc';

async function init() {
  setupTabs();
  setupSettings();
  await loadDashboard();
}

// ─── Tabs ──────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

      // Load analytics data on first visit
      if (btn.dataset.tab === 'analytics') {
        loadAnalytics();
      }
    });
  });
}

// ─── Data Loading ──────────────────────────────────────

async function loadDashboard() {
  const [problemsRes, statsRes, settingsRes, activityRes] = await Promise.all([
    sendMsg('GET_ALL_PROBLEMS'),
    sendMsg('GET_STATS'),
    sendMsg('GET_SETTINGS'),
    sendMsg('GET_ACTIVITY'),
  ]);

  if (problemsRes.success) {
    allProblems = problemsRes.problems;
    renderStats(allProblems, statsRes?.stats);
    renderDifficultyBars(allProblems);
    renderProgress(allProblems, statsRes?.stats);
    renderTable(allProblems);
    populateTagFilter(allProblems);
  }

  if (activityRes.success) {
    renderHeatmap(activityRes.activity);
  }

  if (settingsRes.success) {
    loadSettingsUI(settingsRes.settings);
  }
}

// ─── Dashboard Tab ─────────────────────────────────────

function renderStats(problems, stats) {
  const list = Object.values(problems);
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const due = list.filter(p => new Date(p.nextDueDate) <= endOfDay);

  document.getElementById('stat-total').textContent = list.length;
  document.getElementById('stat-due').textContent = due.length;
  document.getElementById('stat-streak').textContent = stats?.streak || 0;
  document.getElementById('stat-reviews').textContent = stats?.totalReviews || 0;
}

function renderDifficultyBars(problems) {
  const list = Object.values(problems);
  const total = list.length || 1;
  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  list.forEach(p => { if (counts[p.difficulty] !== undefined) counts[p.difficulty]++; });

  ['easy', 'medium', 'hard'].forEach(d => {
    const key = d.charAt(0).toUpperCase() + d.slice(1);
    const pct = (counts[key] / total) * 100;
    document.getElementById(`bar-${d}`).style.width = `${pct}%`;
    document.getElementById(`count-${d}`).textContent = counts[key];
  });
}

function renderProgress(problems, stats) {
  const list = Object.values(problems);
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const today = now.toISOString().split('T')[0];
  const due = list.filter(p => new Date(p.nextDueDate) <= endOfDay);
  const reviewed = due.filter(p => p.history?.some(h => h.date.startsWith(today)));

  const total = due.length;
  const pct = total > 0 ? Math.round((reviewed.length / total) * 100) : (list.length > 0 ? 100 : 0);

  document.getElementById('dash-progress').style.width = `${pct}%`;
  document.getElementById('dash-progress-text').textContent =
    total > 0 ? `${reviewed.length} of ${total} reviews done (${pct}%)` :
    list.length > 0 ? 'All reviews complete! 🎉' : 'No reviews due';
}

// ─── Activity Heatmap ──────────────────────────────────

function renderHeatmap(activity) {
  const container = document.getElementById('heatmap-container');
  container.innerHTML = '';

  const today = new Date();
  const totalDays = 112; // 16 weeks
  const days = [];

  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const data = activity[key] || { solved: 0, reviewed: 0, attempted: 0 };
    const total = data.solved + data.reviewed + (data.attempted || 0);
    days.push({ date: key, total, day: d.getDay(), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
  }

  // Build grid: 7 rows (days of week) × N columns (weeks)
  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';

  // Day labels
  const labels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  const labelCol = document.createElement('div');
  labelCol.className = 'heatmap-label-col';
  labels.forEach(l => {
    const cell = document.createElement('div');
    cell.className = 'heatmap-day-label';
    cell.textContent = l;
    labelCol.appendChild(cell);
  });
  grid.appendChild(labelCol);

  // Group by week columns
  let currentWeek = [];
  const weeks = [];
  days.forEach((d, i) => {
    if (i === 0) {
      // Pad the first week with empty cells
      for (let p = 0; p < d.day; p++) {
        currentWeek.push(null);
      }
    }
    currentWeek.push(d);
    if (d.day === 6 || i === days.length - 1) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });

  weeks.forEach(week => {
    const col = document.createElement('div');
    col.className = 'heatmap-col';
    for (let row = 0; row < 7; row++) {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      if (row < week.length && week[row]) {
        const d = week[row];
        cell.style.background = getHeatColor(d.total);
        cell.title = `${d.label}: ${d.total} activities`;
        cell.dataset.count = d.total;
      } else {
        cell.style.background = 'transparent';
      }
      col.appendChild(cell);
    }
    grid.appendChild(col);
  });

  container.appendChild(grid);
}

function getHeatColor(count) {
  if (count === 0) return 'var(--bg-elevated)';
  if (count <= 2) return 'rgba(245, 158, 11, 0.2)';
  if (count <= 4) return 'rgba(245, 158, 11, 0.45)';
  if (count <= 6) return 'rgba(245, 158, 11, 0.7)';
  return '#f59e0b';
}

// ─── Analytics Tab ─────────────────────────────────────

async function loadAnalytics() {
  const res = await sendMsg('GET_ANALYTICS');
  if (!res.success) return;

  const { topicStats, accuracyTimeline, mastery } = res.analytics;

  // Mastery distribution
  document.getElementById('mastery-mastered').textContent = mastery.mastered;
  document.getElementById('mastery-learning').textContent = mastery.learning;
  document.getElementById('mastery-struggling').textContent = mastery.struggling;
  document.getElementById('mastery-new').textContent = mastery.new;

  // Weakest topics
  renderWeakTopics(topicStats);

  // Accuracy timeline
  renderAccuracyChart(accuracyTimeline);
}

function renderWeakTopics(topicStats) {
  const container = document.getElementById('weak-topics-container');

  if (!topicStats || topicStats.length === 0) {
    container.innerHTML = '<div class="empty-hint">Solve more problems to see topic analytics</div>';
    return;
  }

  // Show top 10 weakest
  const topics = topicStats.slice(0, 10);
  const maxCount = Math.max(...topics.map(t => t.count));

  container.innerHTML = topics.map(t => {
    const pct = (t.count / maxCount) * 100;
    const efLabel = getConfidenceLabel(t.avgEfactor);
    const color = t.avgEfactor >= 2.5 ? 'var(--green)' : t.avgEfactor >= 2.0 ? 'var(--accent)' : t.avgEfactor >= 1.5 ? 'var(--orange)' : 'var(--red)';
    const timeLabel = formatDuration(t.avgTimeMs);
    const successLabel = t.successRate + '%';
    
    return `
      <div class="topic-row">
        <div class="topic-header">
          <span class="topic-name">${escapeHtml(t.tag)}</span>
          <span class="topic-meta">
            ${t.count} problem${t.count > 1 ? 's' : ''} · 
            Success: ${successLabel} · 
            Avg Time: ${timeLabel} · 
            Confidence: <span style="color:${color}">${efLabel}</span>
          </span>
        </div>
        <div class="topic-bar-track">
          <div class="topic-bar" style="width: ${pct}%; background: ${color};"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAccuracyChart(timeline) {
  const container = document.getElementById('accuracy-chart');

  if (!timeline || timeline.length === 0) {
    container.innerHTML = '<div class="empty-hint">No review data yet</div>';
    return;
  }

  const maxTotal = Math.max(...timeline.map(d => d.total));
  const barWidth = Math.max(12, Math.min(28, Math.floor(700 / timeline.length)));

  container.innerHTML = `
    <div class="accuracy-bars">
      ${timeline.map(d => {
        const height = Math.max(4, (d.accuracy / 100) * 120);
        const color = d.accuracy >= 80 ? 'var(--green)' : d.accuracy >= 60 ? 'var(--accent)' : d.accuracy >= 40 ? 'var(--orange)' : 'var(--red)';
        const date = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `
          <div class="accuracy-bar-wrapper" title="${date}: ${d.accuracy}% retention (${d.total} reviews)">
            <div class="accuracy-bar" style="height: ${height}px; width: ${barWidth}px; background: ${color};"></div>
            <div class="accuracy-bar-label">${date.split(' ')[1]}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ─── Problems Table ────────────────────────────────────

function populateTagFilter(problems) {
  const select = document.getElementById('filter-tag');
  const tags = new Set();
  Object.values(problems).forEach(p => (p.tags || []).forEach(t => tags.add(t)));

  // Clear all but "All Topics"
  while (select.options.length > 1) select.remove(1);

  [...tags].sort().forEach(tag => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    select.appendChild(opt);
  });
}

function renderTable(problems) {
  const tbody = document.getElementById('problems-tbody');
  const emptyEl = document.getElementById('empty-table');
  const searchVal = (document.getElementById('search-input').value || '').toLowerCase();
  const filterDiff = document.getElementById('filter-difficulty').value;
  const filterTag = document.getElementById('filter-tag').value;

  let list = Object.values(problems);

  // Filter
  if (searchVal) {
    list = list.filter(p => {
      const title = getDisplayTitle(p).toLowerCase();
      return title.includes(searchVal) || (p.tags || []).some(t => t.toLowerCase().includes(searchVal));
    });
  }
  if (filterDiff !== 'all') list = list.filter(p => p.difficulty === filterDiff);
  if (filterTag !== 'all') list = list.filter(p => (p.tags || []).includes(filterTag));

  // Sort
  list.sort((a, b) => {
    let va = a[sortField], vb = b[sortField];

    if (sortField === 'avgTime') {
      const getAvg = (p) => {
        if (!p.submissions) return 0;
        const times = p.submissions.filter(s => s.timeSpentMs > 0).map(s => s.timeSpentMs);
        return times.length ? times.reduce((acc, curr) => acc + curr, 0) / times.length : 0;
      };
      va = getAvg(a);
      vb = getAvg(b);
    }

    if (sortField === 'failedAttempts') {
      va = a.failedAttempts || 0;
      vb = b.failedAttempts || 0;
    }

    if (sortField === 'title') { va = getDisplayTitle(a).toLowerCase(); vb = getDisplayTitle(b).toLowerCase(); }
    if (sortField === 'difficulty') { const order = { Easy: 1, Medium: 2, Hard: 3, Unknown: 4 }; va = order[va] || 4; vb = order[vb] || 4; }
    if (typeof va === 'string' && va.includes('T')) { va = new Date(va).getTime(); vb = new Date(vb).getTime(); }
    
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  if (list.length === 0) {
    tbody.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  tbody.innerHTML = list.map(p => {
    const slug = getProblemSlug(p);
    const displayTitle = getDisplayTitle(p);
    const diffClass = `difficulty-${(p.difficulty || 'unknown').toLowerCase()}`;
    const tagsHtml = (p.tags || []).slice(0, 3).map(t =>
      `<span class="tag-pill">${escapeHtml(t)}</span>`
    ).join('') + (p.tags && p.tags.length > 3 ? `<span class="tag-more">+${p.tags.length - 3}</span>` : '');

    // Calculate avgTime
    let avgTimeMs = 0;
    if (p.submissions && p.submissions.length > 0) {
      const times = p.submissions.filter(s => s.timeSpentMs > 0).map(s => s.timeSpentMs);
      if (times.length > 0) avgTimeMs = times.reduce((a, b) => a + b, 0) / times.length;
    }

    return `<tr>
      <td data-label="Title"><a href="${p.url}" target="_blank">${escapeHtml(displayTitle)}</a></td>
      <td data-label="Difficulty"><span class="${diffClass}">${p.difficulty}</span></td>
      <td class="tags-cell" data-label="Tags">
        <div class="tags-container" data-slug="${escapeHtml(slug)}" data-tags="${escapeHtml((p.tags || []).join(', '))}">
          <div class="tags-display">
            ${tagsHtml || '<span class="text-tertiary">—</span>'}
            <button class="btn-edit-tags" title="Edit Tags">✏️</button>
          </div>
        </div>
      </td>
      <td data-label="Added">${formatDate(p.addedAt)}</td>
      <td data-label="Last Solved">${formatDate(p.lastSolvedAt)}</td>
      <td data-label="Confidence">${getConfidenceLabel(p.efactor)}</td>
      <td data-label="Avg Time">${formatDuration(avgTimeMs)}</td>
      <td data-label="Failures">${p.failedAttempts || 0}</td>
      <td data-label="Next Due">${formatDate(p.nextDueDate)}</td>
      <td data-label="Actions"><button type="button" class="btn-delete" data-slug="${escapeHtml(slug)}">Delete</button></td>
    </tr>`;
  }).join('');

  // Delete handlers
  tbody.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm(`Delete "${btn.dataset.slug}" from tracking?`)) {
        await sendMsg('DELETE_PROBLEM', { slug: btn.dataset.slug });
        await loadDashboard();
      }
    });
  });

  // Edit Tags handlers
  tbody.querySelectorAll('.btn-edit-tags').forEach(btn => {
    btn.addEventListener('click', () => {
      const container = btn.closest('.tags-container');
      const slug = container.dataset.slug;
      const currentTags = container.dataset.tags;
      
      container.innerHTML = `
        <div class="tags-edit-mode">
          <input type="text" class="tags-edit-input" value="${escapeHtml(currentTags)}" placeholder="e.g., Array, BFS" />
          <button class="btn-save-tags" title="Save">💾</button>
        </div>
      `;
      
      const input = container.querySelector('.tags-edit-input');
      const saveBtn = container.querySelector('.btn-save-tags');
      input.focus();
      input.select();

      const save = async () => {
        const newTags = parseTagsInput(input.value);
        saveBtn.disabled = true;
        const res = await sendMsg('UPDATE_PROBLEM_TAGS', { slug, tags: newTags });
        if (!res.success) {
          console.error(res);
          saveBtn.disabled = false;
          alert(res.error || 'Failed to save tags. Please reload the extension from chrome://extensions');
          return;
        }
        await loadDashboard();
      };

      saveBtn.addEventListener('click', save);
      input.addEventListener('keydown', (e) => { 
        if (e.key === 'Enter') save(); 
        if (e.key === 'Escape') loadDashboard();
      });
    });
  });

  // Sort headers
  document.querySelectorAll('.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortField) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');

    th.onclick = () => {
      if (sortField === th.dataset.sort) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
      else { sortField = th.dataset.sort; sortDir = 'asc'; }
      renderTable(allProblems);
    };
  });

  // Search & filter
  document.getElementById('search-input').oninput = () => renderTable(allProblems);
  document.getElementById('filter-difficulty').onchange = () => renderTable(allProblems);
  document.getElementById('filter-tag').onchange = () => renderTable(allProblems);
}

// ─── Settings ──────────────────────────────────────────

function setupSettings() {
  document.getElementById('setting-daily-goal').addEventListener('change', async (e) => {
    await sendMsg('SAVE_SETTINGS', { dailyGoal: parseInt(e.target.value) || 5 });
  });

  document.getElementById('setting-notifications').addEventListener('change', async (e) => {
    await sendMsg('SAVE_SETTINGS', { notificationsEnabled: e.target.checked });
  });

  document.getElementById('setting-reminder-time').addEventListener('change', async (e) => {
    await sendMsg('SAVE_SETTINGS', { reminderTime: e.target.value });
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const res = await sendMsg('EXPORT_DATA');
    if (res.success) {
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leetrecall-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (confirm(`Import ${Object.keys(data.problems || {}).length} problems? This will merge with existing data.`)) {
        await sendMsg('IMPORT_DATA', data);
        await loadDashboard();
      }
    } catch (err) {
      alert('Invalid backup file');
    }
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (confirm('This will delete ALL your data. Are you sure?')) {
      if (confirm('Really? This cannot be undone.')) {
        await chrome.storage.local.clear();
        await loadDashboard();
      }
    }
  });
}

function loadSettingsUI(settings) {
  document.getElementById('setting-daily-goal').value = settings.dailyGoal || 5;
  document.getElementById('setting-notifications').checked = settings.notificationsEnabled !== false;
  document.getElementById('setting-reminder-time').value = settings.reminderTime || '09:00';
}

// ─── Helpers ───────────────────────────────────────────

function sendMsg(type, data = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, data }, res => {
      if (chrome.runtime.lastError) { resolve({ success: false }); return; }
      resolve(res || { success: false });
    });
  });
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return 'Today';
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString();
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function getConfidenceLabel(efactor) {
  if (efactor >= 2.5) return 'Easy';
  if (efactor >= 2.0) return 'Good';
  if (efactor >= 1.5) return 'Hard';
  return 'Again';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

const NUMBERED_TITLE_RE = /^(?:[A-Za-z]+\s*)*\d+[A-Za-z]?(?:\.\d+)?\.\s+/;

function getDisplayTitle(problem) {
  if (!problem) return '';
  return formatProblemTitle(getProblemFrontendId(problem), problem.title || problem.id || '');
}

function getProblemFrontendId(problem) {
  return problem.frontendId || problem.questionFrontendId || problem.questionId || problem.problemNumber || '';
}

function getProblemSlug(problem) {
  return problem.id || problem.slug || problem.titleSlug || '';
}

function formatProblemTitle(frontendId, title) {
  const cleanTitle = String(title || '').trim();
  const cleanFrontendId = String(frontendId || '').trim();

  if (!cleanTitle || NUMBERED_TITLE_RE.test(cleanTitle)) return cleanTitle;
  if (!cleanFrontendId) return cleanTitle;

  return `${cleanFrontendId}. ${cleanTitle.replace(NUMBERED_TITLE_RE, '')}`;
}

function parseTagsInput(value) {
  return [...new Map(String(value || '')
    .split(/[,;\n]+/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => [tag.toLowerCase(), tag])).values()];
}
