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
    });
  });
}

// ─── Data Loading ──────────────────────────────────────

async function loadDashboard() {
  const [problemsRes, statsRes, settingsRes] = await Promise.all([
    sendMsg('GET_ALL_PROBLEMS'),
    sendMsg('GET_STATS'),
    sendMsg('GET_SETTINGS'),
  ]);

  if (problemsRes.success) {
    allProblems = problemsRes.problems;
    renderStats(allProblems, statsRes?.stats);
    renderDifficultyBars(allProblems);
    renderProgress(allProblems, statsRes?.stats);
    renderTable(allProblems);
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

// ─── Problems Table ────────────────────────────────────

function renderTable(problems) {
  const tbody = document.getElementById('problems-tbody');
  const emptyEl = document.getElementById('empty-table');
  const searchVal = (document.getElementById('search-input').value || '').toLowerCase();
  const filterDiff = document.getElementById('filter-difficulty').value;

  let list = Object.values(problems);

  // Filter
  if (searchVal) list = list.filter(p => p.title.toLowerCase().includes(searchVal));
  if (filterDiff !== 'all') list = list.filter(p => p.difficulty === filterDiff);

  // Sort
  list.sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (sortField === 'title') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
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
    const diffClass = `difficulty-${(p.difficulty || 'unknown').toLowerCase()}`;
    return `<tr>
      <td><a href="${p.url}" target="_blank">${escapeHtml(p.title)}</a></td>
      <td><span class="${diffClass}">${p.difficulty}</span></td>
      <td>${formatDate(p.addedAt)}</td>
      <td>${formatDate(p.lastSolvedAt)}</td>
      <td>${getConfidenceLabel(p.efactor)}</td>
      <td>${formatDate(p.nextDueDate)}</td>
      <td><button class="btn-delete" data-slug="${p.id}">Delete</button></td>
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
}

// ─── Settings ──────────────────────────────────────────

function setupSettings() {
  document.getElementById('setting-daily-goal').addEventListener('change', async (e) => {
    await sendMsg('SAVE_SETTINGS', { dailyGoal: parseInt(e.target.value) || 5 });
  });

  document.getElementById('setting-notifications').addEventListener('change', async (e) => {
    await sendMsg('SAVE_SETTINGS', { notificationsEnabled: e.target.checked });
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

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
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
