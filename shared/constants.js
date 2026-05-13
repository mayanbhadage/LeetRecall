/**
 * LeetRecall — Shared Constants
 */

const STORAGE_KEYS = {
  PROBLEMS: 'leetrecall_problems',
  SETTINGS: 'leetrecall_settings',
  STATS: 'leetrecall_stats',
  ACTIVITY: 'leetrecall_activity',  // daily activity log for heatmap
};

const DEFAULT_SETTINGS = {
  dailyGoal: 5,
  notificationsEnabled: true,
  reminderTime: '09:00',     // when to send daily reminder
  theme: 'dark',
};

const DEFAULT_STATS = {
  streak: 0,
  totalSolved: 0,
  lastActiveDate: null,
  totalReviews: 0,
};

const CONFIDENCE_LABELS = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

// SM-2 quality mapping: our 1-4 buttons → SM-2's 0-5 scale
const QUALITY_MAP = {
  1: 1, // Again → 1 (complete failure)
  2: 2, // Hard  → 2 (struggled)
  3: 4, // Good  → 4 (correct with effort)
  4: 5, // Easy  → 5 (effortless)
};

const ALARM_NAME = 'leetrecall_badge_refresh';
const ALARM_INTERVAL_MINUTES = 30;
const REMINDER_ALARM_NAME = 'leetrecall_daily_reminder';
