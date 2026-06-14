/**
 * LeetRecall — Storage Wrapper
 * Abstracts chrome.storage.local with typed getters/setters.
 * Includes chrome.storage.sync for cross-device persistence.
 */

const SYNC_CHUNK_PREFIX = 'lr_sync_';
const SYNC_MAX_ITEM_BYTES = 8192;   // chrome.storage.sync per-item limit
const SYNC_PROBLEMS_PER_CHUNK = 50; // ~100 bytes each → ~5KB per chunk

const Storage = {
  /**
   * Get all tracked problems.
   * @returns {Promise<Record<string, object>>}
   */
  async getProblems() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.PROBLEMS);
    return result[STORAGE_KEYS.PROBLEMS] || {};
  },

  /**
   * Save all problems (full replace).
   * @param {Record<string, object>} problems
   */
  async setProblems(problems) {
    await chrome.storage.local.set({ [STORAGE_KEYS.PROBLEMS]: problems });
  },

  /**
   * Get a single problem by slug.
   * @param {string} slug
   * @returns {Promise<object|null>}
   */
  async getProblem(slug) {
    const problems = await this.getProblems();
    return problems[slug] || null;
  },

  /**
   * Save or update a single problem.
   * @param {string} slug
   * @param {object} problemData
   */
  async saveProblem(slug, problemData) {
    const problems = await this.getProblems();
    problems[slug] = problemData;
    await this.setProblems(problems);
    // Fire-and-forget sync push (don't block the save)
    this.syncPush(problems).catch(e => console.warn('[LeetRecall] Sync push failed:', e.message));
  },

  /**
   * Delete a single problem.
   * @param {string} slug
   */
  async deleteProblem(slug) {
    const problems = await this.getProblems();
    delete problems[slug];
    await this.setProblems(problems);
    this.syncPush(problems).catch(e => console.warn('[LeetRecall] Sync push failed:', e.message));
  },

  /**
   * Get user settings.
   * @returns {Promise<object>}
   */
  async getSettings() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
  },

  /**
   * Save user settings (partial merge).
   * @param {object} settings
   */
  async saveSettings(settings) {
    const current = await this.getSettings();
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: { ...current, ...settings },
    });
  },

  /**
   * Get aggregate stats.
   * @returns {Promise<object>}
   */
  async getStats() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    return { ...DEFAULT_STATS, ...(result[STORAGE_KEYS.STATS] || {}) };
  },

  /**
   * Save aggregate stats (partial merge).
   * @param {object} stats
   */
  async saveStats(stats) {
    const current = await this.getStats();
    await chrome.storage.local.set({
      [STORAGE_KEYS.STATS]: { ...current, ...stats },
    });
  },

  /**
   * Get problems due today (nextDueDate <= end of today).
   * Respects dailyReviewLimit and prioritizes the oldest ignored problems.
   * @returns {Promise<object[]>}
   */
  async getDueProblems() {
    const problems = await this.getProblems();
    const settings = await this.getSettings();
    const limit = settings.dailyReviewLimit || 3;
    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const todayStr = now.toISOString().split('T')[0];

    const reviewedTodayCount = Object.values(problems).filter(p => {
      if (!p.history) return false;
      const reviewedToday = p.history.some(h => h.date.startsWith(todayStr));
      const wasOldProblem = p.history.some(h => !h.date.startsWith(todayStr));
      return reviewedToday && wasOldProblem;
    }).length;

    let due = Object.values(problems).filter(p => new Date(p.nextDueDate) <= endOfDay);
    
    // Sort by lastSolvedAt (oldest first) to ensure fair rotation of overdue problems
    due.sort((a, b) => new Date(a.lastSolvedAt || 0) - new Date(b.lastSolvedAt || 0));

    // Cap at the REMAINING daily limit
    const remainingLimit = Math.max(0, limit - reviewedTodayCount);
    if (due.length > remainingLimit) {
      due = due.slice(0, remainingLimit);
    }

    // Sort final list by nextDueDate for consistent UI display
    return due.sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate));
  },

  /**
   * Get upcoming problems (not due today, sorted by next due).
   * @returns {Promise<object[]>}
   */
  async getUpcomingProblems() {
    const problems = await this.getProblems();
    const now = new Date();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    return Object.values(problems)
      .filter(p => new Date(p.nextDueDate) > endOfDay)
      .sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate));
  },

  // ─── Activity Heatmap ──────────────────────────────────

  /**
   * Get activity log: { 'YYYY-MM-DD': { solved: N, reviewed: N } }
   * @returns {Promise<object>}
   */
  async getActivity() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ACTIVITY);
    return result[STORAGE_KEYS.ACTIVITY] || {};
  },

  /**
   * Record activity for today.
   * @param {'solved'|'reviewed'} type
   */
  async recordActivity(type) {
    const activity = await this.getActivity();
    const today = new Date().toISOString().split('T')[0];
    if (!activity[today]) activity[today] = { solved: 0, reviewed: 0, attempted: 0 };
    activity[today][type] = (activity[today][type] || 0) + 1;
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVITY]: activity });
  },

  // ─── Cross-Device Sync (chrome.storage.sync) ──────────────

  /**
   * Compress a full problem record to a compact sync-friendly format.
   * Keeps only SM-2 state + essential metadata (~80-120 bytes per problem).
   */
  compactProblem(problem) {
    return {
      t: problem.title || '',
      d: (problem.difficulty || 'U')[0], // E/M/H/U
      r: problem.repetition || 0,
      i: problem.interval || 0,
      ef: problem.efactor || 2.5,
      nd: (problem.nextDueDate || '').split('T')[0],
      sc: problem.solveCount || 0,
      fa: problem.failedAttempts || 0,
      ls: (problem.lastSolvedAt || '').split('T')[0],
      tg: (problem.tags || []).slice(0, 5), // cap at 5 tags for size
      fi: problem.frontendId || '',
      url: problem.url || '',
    };
  },

  /**
   * Expand a compact sync record back to a full problem record.
   * @param {string} slug
   * @param {object} compact
   * @returns {object} Full problem record (missing history/submissions)
   */
  expandProblem(slug, compact) {
    const diffMap = { E: 'Easy', M: 'Medium', H: 'Hard', U: 'Unknown' };
    return {
      id: slug,
      frontendId: compact.fi || '',
      title: compact.t || slug,
      url: compact.url || `https://leetcode.com/problems/${slug}/`,
      difficulty: diffMap[compact.d] || 'Unknown',
      tags: compact.tg || [],
      addedAt: compact.ls ? `${compact.ls}T00:00:00.000Z` : new Date().toISOString(),
      repetition: compact.r || 0,
      interval: compact.i || 0,
      efactor: compact.ef || 2.5,
      nextDueDate: compact.nd ? `${compact.nd}T00:00:00.000Z` : new Date().toISOString(),
      lastSolvedAt: compact.ls ? `${compact.ls}T00:00:00.000Z` : new Date().toISOString(),
      solveCount: compact.sc || 0,
      failedAttempts: compact.fa || 0,
      history: [],
      submissions: [],
    };
  },

  /**
   * Push current local problems to chrome.storage.sync in chunks.
   * Writes are fire-and-forget; failures don't block local operations.
   * @param {Record<string, object>} problems
   */
  async syncPush(problems) {
    if (!chrome.storage?.sync) return;

    const entries = Object.entries(problems);
    const chunks = {};
    let chunkIndex = 0;

    for (let i = 0; i < entries.length; i += SYNC_PROBLEMS_PER_CHUNK) {
      const slice = entries.slice(i, i + SYNC_PROBLEMS_PER_CHUNK);
      const chunkData = {};
      for (const [slug, problem] of slice) {
        chunkData[slug] = this.compactProblem(problem);
      }
      chunks[`${SYNC_CHUNK_PREFIX}${chunkIndex}`] = chunkData;
      chunkIndex++;
    }

    // Add metadata chunk
    chunks[`${SYNC_CHUNK_PREFIX}meta`] = {
      totalChunks: chunkIndex,
      lastSyncAt: new Date().toISOString(),
      totalProblems: entries.length,
    };

    // Write chunks (chrome.storage.sync has 512 max items, 8KB per item)
    try {
      // Clear old sync data first
      const allSyncKeys = await new Promise(resolve => {
        chrome.storage.sync.get(null, result => resolve(Object.keys(result || {})));
      });
      const oldSyncKeys = allSyncKeys.filter(k => k.startsWith(SYNC_CHUNK_PREFIX));
      if (oldSyncKeys.length > 0) {
        await chrome.storage.sync.remove(oldSyncKeys);
      }

      // Write new chunks
      await chrome.storage.sync.set(chunks);
      console.log(`[LeetRecall] Synced ${entries.length} problems in ${chunkIndex} chunks`);
    } catch (e) {
      // Quota exceeded or sync disabled — fail silently
      console.warn('[LeetRecall] Sync push failed:', e.message);
    }
  },

  /**
   * Pull problems from chrome.storage.sync and merge with local.
   * Called on startup and when sync changes are detected.
   * Merge strategy: latest lastSolvedAt wins for SM-2 state.
   * @returns {Promise<{merged: number, added: number}>}
   */
  async syncPull() {
    if (!chrome.storage?.sync) return { merged: 0, added: 0 };

    try {
      const syncData = await new Promise(resolve => {
        chrome.storage.sync.get(null, result => resolve(result || {}));
      });

      const meta = syncData[`${SYNC_CHUNK_PREFIX}meta`];
      if (!meta || !meta.totalChunks) return { merged: 0, added: 0 };

      // Reconstruct all synced problems from chunks
      const syncedProblems = {};
      for (let i = 0; i < meta.totalChunks; i++) {
        const chunkData = syncData[`${SYNC_CHUNK_PREFIX}${i}`];
        if (chunkData) {
          for (const [slug, compact] of Object.entries(chunkData)) {
            syncedProblems[slug] = compact;
          }
        }
      }

      // Merge with local
      const localProblems = await this.getProblems();
      let added = 0;
      let merged = 0;

      for (const [slug, compact] of Object.entries(syncedProblems)) {
        const expanded = this.expandProblem(slug, compact);

        if (!localProblems[slug]) {
          // New problem from another device
          localProblems[slug] = expanded;
          added++;
        } else {
          // Merge: sync wins for SM-2 state if its lastSolvedAt is newer
          const localDate = new Date(localProblems[slug].lastSolvedAt || 0).getTime();
          const syncDate = new Date(expanded.lastSolvedAt || 0).getTime();

          if (syncDate > localDate) {
            // Update SM-2 state from sync but keep local history/submissions
            localProblems[slug].repetition = expanded.repetition;
            localProblems[slug].interval = expanded.interval;
            localProblems[slug].efactor = expanded.efactor;
            localProblems[slug].nextDueDate = expanded.nextDueDate;
            localProblems[slug].lastSolvedAt = expanded.lastSolvedAt;
            localProblems[slug].solveCount = Math.max(localProblems[slug].solveCount || 0, expanded.solveCount);
            localProblems[slug].failedAttempts = Math.max(localProblems[slug].failedAttempts || 0, expanded.failedAttempts);
            // Update title/difficulty if they were better in sync
            if (expanded.title && expanded.title !== slug) localProblems[slug].title = expanded.title;
            if (expanded.difficulty !== 'Unknown') localProblems[slug].difficulty = expanded.difficulty;
            merged++;
          } else {
            // Local is newer — just ensure counts are max
            localProblems[slug].solveCount = Math.max(localProblems[slug].solveCount || 0, expanded.solveCount);
            localProblems[slug].failedAttempts = Math.max(localProblems[slug].failedAttempts || 0, expanded.failedAttempts);
          }
        }
      }

      if (added > 0 || merged > 0) {
        await this.setProblems(localProblems);
        console.log(`[LeetRecall] Sync pull: ${added} added, ${merged} updated`);
      }

      return { merged, added };
    } catch (e) {
      console.warn('[LeetRecall] Sync pull failed:', e.message);
      return { merged: 0, added: 0 };
    }
  },
};

if (typeof module !== 'undefined') {
  module.exports = Storage;
}

