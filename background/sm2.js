/**
 * LeetRecall — SM-2 Spaced Repetition Engine
 * 
 * Implements the SuperMemo SM-2 algorithm for scheduling problem reviews.
 * Maps our 4-button confidence rating to SM-2's quality scale.
 */

/**
 * Calculate next review schedule using SM-2 algorithm.
 * 
 * @param {object} problem - Current problem state
 * @param {number} problem.repetition - Consecutive correct recalls
 * @param {number} problem.interval - Current interval in days
 * @param {number} problem.efactor - Easiness factor (min 1.3)
 * @param {number} rating - User confidence rating (1=Again, 2=Hard, 3=Good, 4=Easy)
 * @returns {object} Updated { repetition, interval, efactor, nextDueDate }
 */
function calculateSM2(problem, rating) {
  // Map our 4-button rating to SM-2 quality (0-5 scale)
  const quality = QUALITY_MAP[rating];

  let { repetition, interval, efactor } = problem;

  // Update easiness factor
  let newEfactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEfactor < 1.3) newEfactor = 1.3;

  let newRepetition, newInterval;

  if (quality < 3) {
    // Failed — reset to beginning
    newRepetition = 0;
    newInterval = 1;
  } else {
    newRepetition = repetition + 1;

    if (newRepetition === 1) {
      newInterval = 1;
    } else if (newRepetition === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.round(interval * newEfactor);
    }
  }

  // Calculate next due date
  const nextDueDate = new Date();
  nextDueDate.setDate(nextDueDate.getDate() + newInterval);
  // Set to start of that day
  nextDueDate.setHours(0, 0, 0, 0);

  return {
    repetition: newRepetition,
    interval: newInterval,
    efactor: Math.round(newEfactor * 100) / 100, // round to 2 decimals
    nextDueDate: nextDueDate.toISOString(),
  };
}

const NUMBERED_TITLE_RE = /^(?:[A-Za-z]+\s*)*\d+[A-Za-z]?(?:\.\d+)?\.\s+/;

function formatProblemTitle(frontendId, title) {
  const cleanTitle = String(title || '').trim();
  const cleanFrontendId = String(frontendId || '').trim();

  if (!cleanTitle || NUMBERED_TITLE_RE.test(cleanTitle)) return cleanTitle;
  if (!cleanFrontendId) return cleanTitle;

  return `${cleanFrontendId}. ${cleanTitle.replace(NUMBERED_TITLE_RE, '')}`;
}

/**
 * Create a new problem record with default SM-2 values.
 * 
 * @param {object} info - Extracted problem metadata
 * @param {string} info.slug
 * @param {string} info.title
 * @param {string} info.url
 * @param {string} info.difficulty
 * @param {string[]} info.tags
 * @returns {object} Full problem record
 */
function createProblemRecord(info) {
  const now = new Date().toISOString();
  const frontendId = info.frontendId || info.questionFrontendId || info.problemNumber || '';

  return {
    id: info.slug,
    frontendId,
    title: formatProblemTitle(frontendId, info.title),
    url: info.url,
    difficulty: info.difficulty || 'Unknown',
    tags: info.tags || [],
    addedAt: now,

    // SM-2 defaults — due immediately for first rating
    repetition: 0,
    interval: 0,
    efactor: 2.5,
    nextDueDate: now,

    // History
    lastSolvedAt: now,
    solveCount: 1,
    history: [],
  };
}

if (typeof module !== 'undefined') {
  module.exports = { calculateSM2, createProblemRecord, formatProblemTitle };
}
