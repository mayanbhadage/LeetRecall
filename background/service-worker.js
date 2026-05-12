/**
 * LeetRecall — Service Worker (Background)
 * 
 * Central message hub. Handles:
 * - Problem tracking from content scripts
 * - SM-2 confidence rating calculations
 * - Badge count updates
 * - Periodic alarm for badge refresh
 */

// Import shared modules
importScripts(
  '../shared/constants.js',
  '../shared/storage.js',
  'sm2.js'
);

// ─── Installation & Startup ────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[LeetRecall] Extension installed:', details.reason);

  // Initialize storage with defaults if first install
  if (details.reason === 'install') {
    await Storage.saveSettings(DEFAULT_SETTINGS);
    await Storage.saveStats(DEFAULT_STATS);
  }

  // Set up periodic alarm for badge refresh
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: ALARM_INTERVAL_MINUTES,
  });

  // Initial badge update
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
});

// ─── Alarm Handler ─────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await updateBadge();
  }
});

// ─── Message Handler ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[LeetRecall] Message handler error:', err);
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'PROBLEM_ACCEPTED':
      return await handleProblemAccepted(message.data);

    case 'RATE_CONFIDENCE':
      return await handleRateConfidence(message.data);

    case 'GET_DUE_PROBLEMS':
      return await handleGetDueProblems();

    case 'GET_ALL_PROBLEMS':
      return await handleGetAllProblems();

    case 'GET_PROBLEM':
      return await handleGetProblem(message.data);

    case 'DELETE_PROBLEM':
      return await handleDeleteProblem(message.data);

    case 'GET_STATS':
      return await handleGetStats();

    case 'GET_SETTINGS':
      return await handleGetSettings();

    case 'SAVE_SETTINGS':
      return await handleSaveSettings(message.data);

    case 'ADD_PROBLEM_MANUAL':
      return await handleAddManual(message.data);

    case 'EXPORT_DATA':
      return await handleExportData();

    case 'IMPORT_DATA':
      return await handleImportData(message.data);

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// ─── Handlers ──────────────────────────────────────────────────────

async function handleProblemAccepted(data) {
  const { slug, title, url, difficulty, tags } = data;
  
  // Check if already tracked
  let problem = await Storage.getProblem(slug);

  if (problem) {
    // Already tracked — update solve count and timestamp
    problem.solveCount += 1;
    problem.lastSolvedAt = new Date().toISOString();
    await Storage.saveProblem(slug, problem);
    console.log(`[LeetRecall] Updated existing problem: ${title}`);
  } else {
    // New problem — create record
    problem = createProblemRecord(data);
    await Storage.saveProblem(slug, problem);

    // Update stats
    const stats = await Storage.getStats();
    stats.totalSolved += 1;
    await updateStreak(stats);
    await Storage.saveStats(stats);

    console.log(`[LeetRecall] Tracked new problem: ${title}`);
  }

  await updateBadge();
  return { success: true, problem };
}

async function handleRateConfidence({ slug, rating }) {
  const problem = await Storage.getProblem(slug);
  if (!problem) {
    return { success: false, error: 'Problem not found' };
  }

  // Run SM-2
  const sm2Result = calculateSM2(problem, rating);
  
  // Update problem
  problem.repetition = sm2Result.repetition;
  problem.interval = sm2Result.interval;
  problem.efactor = sm2Result.efactor;
  problem.nextDueDate = sm2Result.nextDueDate;
  problem.lastSolvedAt = new Date().toISOString();
  
  // Add to history
  problem.history.push({
    date: new Date().toISOString(),
    rating: rating,
  });

  await Storage.saveProblem(slug, problem);

  // Update stats
  const stats = await Storage.getStats();
  stats.totalReviews += 1;
  await updateStreak(stats);
  await Storage.saveStats(stats);

  await updateBadge();

  console.log(`[LeetRecall] Rated ${problem.title}: ${CONFIDENCE_LABELS[rating]} → next in ${sm2Result.interval} days`);

  return { success: true, problem };
}

async function handleGetDueProblems() {
  const problems = await Storage.getDueProblems();
  return { success: true, problems };
}

async function handleGetAllProblems() {
  const problems = await Storage.getProblems();
  return { success: true, problems };
}

async function handleGetProblem({ slug }) {
  const problem = await Storage.getProblem(slug);
  return { success: true, problem };
}

async function handleDeleteProblem({ slug }) {
  await Storage.deleteProblem(slug);
  await updateBadge();
  return { success: true };
}

async function handleGetStats() {
  const stats = await Storage.getStats();
  const problems = await Storage.getProblems();
  const dueProblems = await Storage.getDueProblems();

  return {
    success: true,
    stats: {
      ...stats,
      totalProblems: Object.keys(problems).length,
      dueToday: dueProblems.length,
    },
  };
}

async function handleGetSettings() {
  const settings = await Storage.getSettings();
  return { success: true, settings };
}

async function handleSaveSettings(settings) {
  await Storage.saveSettings(settings);
  return { success: true };
}

async function handleAddManual(data) {
  const slug = data.slug;
  let problem = await Storage.getProblem(slug);

  if (problem) {
    return { success: false, error: 'Problem already tracked' };
  }

  problem = createProblemRecord(data);
  await Storage.saveProblem(slug, problem);

  const stats = await Storage.getStats();
  stats.totalSolved += 1;
  await updateStreak(stats);
  await Storage.saveStats(stats);

  await updateBadge();
  return { success: true, problem };
}

async function handleExportData() {
  const problems = await Storage.getProblems();
  const settings = await Storage.getSettings();
  const stats = await Storage.getStats();

  return {
    success: true,
    data: {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      problems,
      settings,
      stats,
    },
  };
}

async function handleImportData(data) {
  if (data.problems) await Storage.setProblems(data.problems);
  if (data.settings) await Storage.saveSettings(data.settings);
  if (data.stats) await Storage.saveStats(data.stats);

  await updateBadge();
  return { success: true };
}

// ─── Helpers ───────────────────────────────────────────────────────

async function updateBadge() {
  const dueProblems = await Storage.getDueProblems();
  const count = dueProblems.length;

  chrome.action.setBadgeText({
    text: count > 0 ? String(count) : '',
  });

  chrome.action.setBadgeBackgroundColor({
    color: count > 0 ? '#f59e0b' : '#6b7280',
  });
}

async function updateStreak(stats) {
  const today = new Date().toISOString().split('T')[0];

  if (stats.lastActiveDate === today) {
    // Already active today
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (stats.lastActiveDate === yesterdayStr) {
    // Consecutive day — increment streak
    stats.streak += 1;
  } else if (stats.lastActiveDate !== today) {
    // Streak broken
    stats.streak = 1;
  }

  stats.lastActiveDate = today;
}
