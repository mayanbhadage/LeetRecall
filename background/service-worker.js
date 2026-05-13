/**
 * LeetRecall — Service Worker (Background)
 * 
 * Central message hub. Handles:
 * - Problem tracking from content scripts
 * - SM-2 confidence rating calculations
 * - Badge count updates
 * - Periodic alarm for badge refresh
 * - Daily notification reminders
 * - Activity tracking for heatmap
 * - Topic analytics
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

  // Set up daily reminder alarm
  await scheduleDailyReminder();

  // Initial badge update
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
  await scheduleDailyReminder();
});

// ─── Alarm Handler ─────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await updateBadge();
  }
  if (alarm.name === REMINDER_ALARM_NAME) {
    await sendDailyReminder();
    // Reschedule for tomorrow
    await scheduleDailyReminder();
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
    case 'PROBLEM_SUBMITTED':
      return await handleProblemSubmitted(message.data);

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

    case 'GET_ANALYTICS':
      return await handleGetAnalytics();

    case 'GET_ACTIVITY':
      return await handleGetActivity();

    case 'GET_PREVIOUS_NOTES':
      return await handleGetPreviousNotes(message.data);

    case 'SAVE_NOTES':
      return await handleSaveNotes(message.data);

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// ─── Handlers ──────────────────────────────────────────────────────

async function handleProblemSubmitted(data) {
  const { slug, title, url, difficulty, tags, status } = data;
  const isAccepted = status === 'Accepted';
  
  let problem = await Storage.getProblem(slug);
  let isNew = false;

  if (problem) {
    if (isAccepted) {
      problem.solveCount = (problem.solveCount || 0) + 1;
      problem.lastSolvedAt = new Date().toISOString();
    } else {
      problem.failedAttempts = (problem.failedAttempts || 0) + 1;
    }

    if (tags && tags.length > 0) {
      const existing = problem.tags || [];
      const merged = [...new Set([...existing, ...tags])];
      problem.tags = merged;
    }
    console.log(`[LeetRecall] Updated existing problem: ${title} (${status})`);
  } else {
    isNew = true;
    problem = createProblemRecord(data);
    
    if (!isAccepted) {
      problem.solveCount = 0;
      problem.failedAttempts = 1;
    }

    if (isAccepted) {
      const stats = await Storage.getStats();
      stats.totalSolved += 1;
      await updateStreak(stats);
      await Storage.saveStats(stats);
    }
    console.log(`[LeetRecall] Tracked new problem: ${title} (${status})`);
  }

  problem.submissions = problem.submissions || [];
  problem.submissions.push({
    date: new Date().toISOString(),
    status: status,
    timeSpentMs: data.timeSpentMs || 0
  });

  await Storage.saveProblem(slug, problem);

  if (isAccepted) {
    await Storage.recordActivity('solved');
  }

  await updateBadge();
  return { success: true, problem, isNew };
}

async function handleRateConfidence({ slug, rating, notes }) {
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
  
  // Add to history (now includes notes)
  const historyEntry = {
    date: new Date().toISOString(),
    rating: rating,
  };

  // Attach notes if provided (array of note strings)
  if (notes && Array.isArray(notes) && notes.length > 0) {
    historyEntry.notes = notes.filter(n => n.trim().length > 0);
  }

  problem.history.push(historyEntry);

  await Storage.saveProblem(slug, problem);

  // Update stats
  const stats = await Storage.getStats();
  stats.totalReviews += 1;
  await updateStreak(stats);
  await Storage.saveStats(stats);

  // Track activity
  await Storage.recordActivity('reviewed');

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
  // If reminder time changed, reschedule
  if (settings.reminderTime !== undefined) {
    await scheduleDailyReminder();
  }
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

  await Storage.recordActivity('solved');
  await updateBadge();
  return { success: true, problem };
}

async function handleExportData() {
  const problems = await Storage.getProblems();
  const settings = await Storage.getSettings();
  const stats = await Storage.getStats();
  const activity = await Storage.getActivity();

  return {
    success: true,
    data: {
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      problems,
      settings,
      stats,
      activity,
    },
  };
}

async function handleImportData(data) {
  if (data.problems) await Storage.setProblems(data.problems);
  if (data.settings) await Storage.saveSettings(data.settings);
  if (data.stats) await Storage.saveStats(data.stats);
  if (data.activity) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVITY]: data.activity });
  }

  await updateBadge();
  return { success: true };
}

async function handleGetAnalytics() {
  const problems = await Storage.getProblems();
  const list = Object.values(problems);

  // ─── Topic Stats ───
  const topicMap = {};  // tag → { total, avgEfactor, ratings }
  list.forEach(p => {
    (p.tags || []).forEach(tag => {
      if (!topicMap[tag]) topicMap[tag] = { count: 0, totalEfactor: 0, ratings: [], problems: [] };
      topicMap[tag].count++;
      topicMap[tag].totalEfactor += p.efactor;
      topicMap[tag].problems.push(p.id);
      (p.history || []).forEach(h => topicMap[tag].ratings.push(h.rating));
    });
  });

  const topicStats = Object.entries(topicMap).map(([tag, data]) => {
    const avgEfactor = data.totalEfactor / data.count;
    const avgRating = data.ratings.length > 0
      ? data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length
      : 0;

    const times = data.problems.flatMap(slug => {
      const p = problems[slug];
      return (p.submissions || []).filter(s => s.timeSpentMs > 0 && s.status === 'Accepted').map(s => s.timeSpentMs);
    });
    const avgTimeMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    
    const statuses = data.problems.flatMap(slug => {
      const p = problems[slug];
      return (p.submissions || []).map(s => s.status);
    });
    const successRate = statuses.length > 0 ? (statuses.filter(s => s === 'Accepted').length / statuses.length) * 100 : 0;

    return {
      tag,
      count: data.count,
      avgEfactor: Math.round(avgEfactor * 100) / 100,
      avgRating: Math.round(avgRating * 100) / 100,
      avgTimeMs,
      successRate: Math.round(successRate),
      weakScore: Math.round((3 - avgEfactor) * 100) / 100, // higher = weaker
    };
  }).sort((a, b) => b.weakScore - a.weakScore);

  // ─── Accuracy & Time Over Time (last 30 days) ───
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dailyAccuracy = {};
  const dailyTime = {};

  list.forEach(p => {
    (p.history || []).forEach(h => {
      const day = h.date.split('T')[0];
      if (new Date(day) >= thirtyDaysAgo) {
        if (!dailyAccuracy[day]) dailyAccuracy[day] = { good: 0, total: 0 };
        dailyAccuracy[day].total++;
        if (h.rating >= 3) dailyAccuracy[day].good++;
      }
    });

    (p.submissions || []).forEach(s => {
      if (s.timeSpentMs > 0 && s.status === 'Accepted') {
        const day = s.date.split('T')[0];
        if (new Date(day) >= thirtyDaysAgo) {
          if (!dailyTime[day]) dailyTime[day] = { totalMs: 0, count: 0 };
          dailyTime[day].totalMs += s.timeSpentMs;
          dailyTime[day].count++;
        }
      }
    });
  });

  const accuracyTimeline = Object.entries(dailyAccuracy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      accuracy: Math.round((data.good / data.total) * 100),
      total: data.total,
    }));

  const timeTimeline = Object.entries(dailyTime)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      avgTimeMs: data.totalMs / data.count,
      count: data.count,
    }));

  // ─── Mastery distribution ───
  const mastery = { mastered: 0, learning: 0, struggling: 0, new: 0 };
  list.forEach(p => {
    if (p.efactor >= 2.5 && p.repetition >= 3) mastery.mastered++;
    else if (p.efactor >= 2.0) mastery.learning++;
    else if (p.repetition > 0) mastery.struggling++;
    else mastery.new++;
  });

  return {
    success: true,
    analytics: {
      topicStats,
      accuracyTimeline,
      timeTimeline,
      mastery,
      totalProblems: list.length,
    },
  };
}

async function handleGetActivity() {
  const activity = await Storage.getActivity();
  return { success: true, activity };
}

async function handleGetPreviousNotes({ slug }) {
  const problem = await Storage.getProblem(slug);
  if (!problem) {
    return { success: true, notes: [], previousAttempt: null };
  }

  // Find the most recent history entry with notes
  const history = problem.history || [];
  let previousNotes = [];
  let previousAttempt = null;

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].notes && history[i].notes.length > 0) {
      previousNotes = history[i].notes;
      previousAttempt = {
        date: history[i].date,
        rating: history[i].rating,
        ratingLabel: CONFIDENCE_LABELS[history[i].rating] || 'Unknown',
        attemptNumber: i + 1,
      };
      break;
    }
  }

  return {
    success: true,
    notes: previousNotes,
    previousAttempt,
    totalAttempts: history.length,
    isDue: new Date(problem.nextDueDate) <= new Date(),
  };
}

async function handleSaveNotes({ slug, notes }) {
  const problem = await Storage.getProblem(slug);
  if (!problem) {
    return { success: false, error: 'Problem not found' };
  }

  // Update notes on the most recent history entry
  const history = problem.history || [];
  if (history.length > 0) {
    const lastEntry = history[history.length - 1];
    lastEntry.notes = (notes || []).filter(n => n.trim().length > 0);
    await Storage.saveProblem(slug, problem);
  }

  return { success: true };
}

// ─── Notifications ─────────────────────────────────────────────────

async function scheduleDailyReminder() {
  // Clear existing reminder
  await chrome.alarms.clear(REMINDER_ALARM_NAME);

  const settings = await Storage.getSettings();
  if (!settings.notificationsEnabled) return;

  const [hours, minutes] = (settings.reminderTime || '09:00').split(':').map(Number);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);

  // If target time has passed today, schedule for tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const delayMinutes = (target - now) / (1000 * 60);
  chrome.alarms.create(REMINDER_ALARM_NAME, {
    delayInMinutes: delayMinutes,
  });

  console.log(`[LeetRecall] Daily reminder scheduled for ${target.toLocaleString()}`);
}

async function sendDailyReminder() {
  const settings = await Storage.getSettings();
  if (!settings.notificationsEnabled) return;

  const dueProblems = await Storage.getDueProblems();
  if (dueProblems.length === 0) return;

  chrome.notifications.create('leetrecall_daily', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: '🧠 LeetRecall — Time to Review!',
    message: `You have ${dueProblems.length} problem${dueProblems.length > 1 ? 's' : ''} due for review today.`,
    priority: 1,
  });
}

// Open popup/dashboard when notification is clicked
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'leetrecall_daily') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    chrome.notifications.clear(notificationId);
  }
});

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

// ─── Exports for Testing ────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    handleProblemSubmitted,
    handleRateConfidence,
    handleMessage,
  };
}
